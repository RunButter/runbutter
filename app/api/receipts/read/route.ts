import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, tooMany } from '@/lib/security/http';
import { openSecret } from '@/lib/crypto/secrets';
import { callAIVision, defaultModel, type AIProvider } from '@/lib/ai/providers';
import { recordAIUsage } from '@/lib/ai/usage';
import { BUCKET } from '@/lib/files/storage';
import { parseReceiptText, suggestCategory } from '@/lib/finance/receipt-parse';
import { normalizeVisionReply, VISION_SYSTEM, type ReceiptFields } from '@/lib/finance/receipt-read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/receipts/read { fileId, workspaceId } → { fields, source, note }
 *
 * Reads an uploaded receipt (already through /api/files/upload and
 * /api/files/extract) into expense fields. WRITES NO EXPENSE: the fields open
 * a form a person checks and saves (save_receipt_expense, 0137).
 *
 *   text  — the file had a text layer (an emailed PDF receipt): regex, free.
 *   ocr   — the server's own OCR read the photo (OCR_API_URL / MINERU_URL).
 *   ai    — a photo with no text, read by the WORKSPACE'S AI key (BYO, the
 *           cost rule); its text is stored on the file so search finds it.
 *   none  — nothing could read it; the person types it in.
 *
 * get_file is the authorisation: it raises for a file outside the caller's
 * workspaces. The category comes from the workspace's own history first.
 */

const VISION_MAX_BYTES = 8 * 1024 * 1024;
const VISION_MIME = /^(image\/(png|jpe?g|webp|gif)|application\/pdf)$/i;

export async function POST(req: Request) {
  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: v.status === 'unavailable' ? 'Sign-in could not be checked just now. Try again.' : 'Sign in again.' },
      { status: v.status === 'unavailable' ? 503 : 401 });
  }
  const rl = rateLimit(`receipts-read:${v.userId}`, 60, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const fileId = typeof b?.fileId === 'string' && /^[0-9a-f-]{36}$/i.test(b.fileId) ? b.fileId : null;
  const ws = typeof b?.workspaceId === 'string' && /^[0-9a-f-]{36}$/i.test(b.workspaceId) ? b.workspaceId : null;
  if (!fileId || !ws) return NextResponse.json({ error: 'Missing file.' }, { status: 400 });

  const admin = createAdminClient();
  const { data: file, error: fErr } = await admin.rpc('get_file', { p_privy: v.userId, p_file: fileId });
  if (fErr || !file || (file as any).workspace_id !== ws) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  const f = file as any;

  let fields: ReceiptFields = { vendor: null, date: null, amount: null, currency: null, tax: null, invoice_number: null, vat_id: null };
  let source: 'text' | 'ocr' | 'ai' | 'none' = 'none';
  let note = '';

  const text = String(f.content || '');
  if (text.trim().length >= 20) {
    const p = parseReceiptText(text);
    fields = {
      vendor: p.vendorGuess, date: p.date, amount: p.total, currency: p.currency, tax: null,
      invoice_number: p.invoiceNumber, vat_id: p.vatId || (p.nip ? `PL${p.nip}` : null),
    };
    source = f.extract_status === 'text_layer' ? 'text' : 'ocr';
  }

  // A photo with no text (or a text layer with no readable total): the
  // workspace's own AI key, when there is one.
  const mime = String(f.mime_type || '').toLowerCase();
  if (fields.amount === null && VISION_MIME.test(mime) && Number(f.size_bytes || 0) <= VISION_MAX_BYTES) {
    const { data: secret } = await admin.rpc('get_ai_secret', { p_privy: v.userId, p_workspace: ws });
    if (secret) {
      const s = secret as any;
      const provider = s.provider as AIProvider;
      const model = s.model || defaultModel(provider, 'fast');
      const usageRow = { workspace: ws, privy: v.userId, feature: 'receipts' as const, provider, model };
      try {
        const apiKey = openSecret(s.cipher, s.iv, s.tag);
        const { data: blob, error: dErr } = await admin.storage.from(BUCKET).download(f.storage_path);
        if (dErr || !blob) throw new Error('The file could not be read from storage.');
        const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
        const out = await callAIVision(provider, apiKey, model, VISION_SYSTEM, 'Read this receipt.', { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, base64 }, s.base_url || undefined, 1500);
        await recordAIUsage(admin, { ...usageRow, usage: out.usage });
        const got = normalizeVisionReply(out.text);
        if (got) {
          // Keep what the text layer found; fill only what it did not.
          fields = Object.fromEntries(Object.entries(fields).map(([k, val]) => [k, val ?? (got.fields as any)[k]])) as ReceiptFields;
          source = 'ai';
          // The receipt's words become searchable in Files, like any document.
          if (got.text && !text.trim()) {
            await admin.rpc('set_file_content', { p_privy: v.userId, p_file: fileId, p_content: got.text, p_status: 'vision', p_pages: null, p_error: null });
          }
        } else note = 'The AI could not read this receipt — fill it in.';
      } catch (e: any) {
        await recordAIUsage(admin, { ...usageRow, usage: { input: 0, output: 0, cached: 0 }, ok: false });
        note = `The AI could not read it (${String(e?.message || 'error').slice(0, 160)}) — fill it in.`;
      }
    } else if (source === 'none') {
      note = 'This is a photo with no text. Add an AI key in Settings → AI (or set up OCR) to read photos automatically — or fill it in.';
    }
  }
  if (source === 'none' && !note) note = 'Nothing readable in this file — fill it in.';

  // The category this workspace used for this vendor before, else a keyword guess.
  let category: string | null = null;
  if (fields.vendor) {
    const { data: rows } = await admin.rpc('list_records', { p_privy: v.userId, p_workspace: ws, p_object: 'expenses' });
    const history = (Array.isArray(rows) ? rows : []).slice(0, 500).map((r: any) => ({ vendor: String(r.vendor || ''), category: String(r.category || '') }));
    category = suggestCategory(fields.vendor, history).category;
  }

  return NextResponse.json({ fields: { ...fields, category }, source, note });
}
