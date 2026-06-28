'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2, Upload, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getWorkspace, loadBranding, saveBranding } from '@/lib/crm/data';

interface Form { logo_url: string; legal_name: string; address: string; accent_color: string; invoice_footer: string }
const EMPTY: Form = { logo_url: '', legal_name: '', address: '', accent_color: '#6366F1', invoice_footer: '' };

export default function BrandingPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [wsId, setWsId] = useState<string | null>(null);
  const [wsName, setWsName] = useState('Your company');
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready) return;
    if (!privy) { setLoading(false); return; }
    getWorkspace(privy).then(async (ws) => {
      if (!ws) { setLoading(false); return; }
      setWsId(ws.id); setWsName(ws.name);
      const b = await loadBranding(privy, ws.id);
      if (b) setForm({ logo_url: b.logo_url || '', legal_name: b.legal_name || '', address: b.address || '', accent_color: b.accent_color || '#6366F1', invoice_footer: b.invoice_footer || '' });
      setLoading(false);
    });
  }, [ready, privy]);

  const set = (patch: Partial<Form>) => { setForm((f) => ({ ...f, ...patch })); setSaved(false); };

  const onLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !wsId) return;
    setUploading(true); setError('');
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${wsId}/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('branding').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upErr) { setError(`Upload failed: ${upErr.message}. Run migration 0017 to create the 'branding' bucket.`); setUploading(false); return; }
    const { data } = supabase.storage.from('branding').getPublicUrl(path);
    set({ logo_url: data.publicUrl });
    setUploading(false);
  };

  const save = async () => {
    if (!privy || !wsId) { setError('Sign in to save branding.'); return; }
    setSaving(true); setError('');
    const res = await saveBranding(privy, wsId, form);
    setSaving(false);
    if (res.error) setError(res.error); else setSaved(true);
  };

  const displayName = form.legal_name || wsName;

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">Branding</h1>
        <span className="text-[11px] text-slate-400">Logo &amp; details on your invoices and offers</span>
        <button onClick={save} disabled={saving || !privy}
          className="ml-auto h-8 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null} {saved ? 'Saved' : 'Save'}
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="max-w-4xl grid lg:grid-cols-2 gap-6">
            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Logo</label>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-lg ring-1 ring-slate-200 flex items-center justify-center overflow-hidden bg-slate-50 shrink-0">
                    {form.logo_url ? <img src={form.logo_url} alt="" className="w-full h-full object-contain" /> : <div className="w-7 h-7 rounded" style={{ background: form.accent_color }} />}
                  </div>
                  <label className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 cursor-pointer">
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
                    <input type="file" accept="image/*" className="hidden" onChange={onLogoFile} disabled={!privy || uploading} />
                  </label>
                  {form.logo_url && <button onClick={() => set({ logo_url: '' })} className="text-[12px] text-slate-400 hover:text-rose-600">Remove</button>}
                </div>
                <input value={form.logo_url} onChange={(e) => set({ logo_url: e.target.value })} placeholder="…or paste a logo image URL"
                  className="mt-2 w-full h-9 px-2.5 text-[12px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1">Legal company name</label>
                <input value={form.legal_name} onChange={(e) => set({ legal_name: e.target.value })} placeholder={wsName}
                  className="w-full h-9 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1">Address</label>
                <textarea value={form.address} onChange={(e) => set({ address: e.target.value })} rows={2} placeholder="Street, city, country"
                  className="w-full px-2.5 py-2 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1">Accent color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.accent_color} onChange={(e) => set({ accent_color: e.target.value })}
                    className="w-9 h-9 rounded-md ring-1 ring-slate-200 cursor-pointer bg-white" />
                  <input value={form.accent_color} onChange={(e) => set({ accent_color: e.target.value })}
                    className="w-28 h-9 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none tabular-nums" />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-slate-600 mb-1">Invoice footer / payment terms</label>
                <textarea value={form.invoice_footer} onChange={(e) => set({ invoice_footer: e.target.value })} rows={3} placeholder="Payment within 14 days · bank details · VAT no…"
                  className="w-full px-2.5 py-2 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
              </div>

              {!privy && <p className="text-[12px] text-amber-600">Sign in to upload a logo and save branding.</p>}
              {error && <p className="text-[12px] text-rose-600">{error}</p>}
            </div>

            {/* Live preview */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Preview</div>
              <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
                <div className="h-1.5" style={{ background: form.accent_color }} />
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {form.logo_url ? <img src={form.logo_url} alt="" className="w-10 h-10 rounded-lg object-contain" /> : <div className="w-10 h-10 rounded-lg" style={{ background: form.accent_color }} />}
                      <div>
                        <div className="text-[15px] font-black text-slate-900">{displayName}</div>
                        <div className="text-[11px] text-slate-400 whitespace-pre-line">{form.address || 'hirebtr.com'}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-slate-900">Invoice</div>
                      <div className="text-[12px] text-slate-400">INV-1001</div>
                    </div>
                  </div>
                  <div className="mt-6 flex justify-between text-[14px] font-black border-t border-slate-100 pt-3">
                    <span className="text-slate-900">Total due</span>
                    <span style={{ color: form.accent_color }}>$4,150.00</span>
                  </div>
                  {form.invoice_footer && <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500 whitespace-pre-line">{form.invoice_footer}</div>}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">This is how your invoices and offers will look.</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
