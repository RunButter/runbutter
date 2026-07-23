'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2, Upload, Check, Building2, ArrowRight } from 'lucide-react';
import { getWorkspace, loadBranding, saveBranding } from '@/lib/crm/data';
import { uploadImage } from '@/lib/crm/upload';

interface Form {
  logo_url: string; legal_name: string; address: string; accent_color: string; invoice_footer: string;
  tax_id: string; country: string; vat_id: string; reg_no: string; bdo: string; iban: string; bank_name: string;
}
const EMPTY: Form = {
  logo_url: '', legal_name: '', address: '', accent_color: '#4653CE', invoice_footer: '',
  tax_id: '', country: 'PL', vat_id: '', reg_no: '', bdo: '', iban: '', bank_name: '',
};

// Which legal identifiers an invoice needs differs by country — the selector
// below drives which fields show and how they're labelled.
type IdField = { key: 'tax_id' | 'vat_id' | 'reg_no' | 'bdo'; label: string; placeholder?: string };
const COUNTRY_IDENTITY: Record<string, IdField[]> = {
  PL: [
    { key: 'tax_id', label: 'NIP', placeholder: '10-digit NIP — used for KSeF' },
    { key: 'reg_no', label: 'KRS / REGON', placeholder: 'court or statistical registry no.' },
    { key: 'bdo', label: 'BDO number', placeholder: 'waste database no. (if applicable)' },
  ],
  DE: [
    { key: 'vat_id', label: 'USt-IdNr. (VAT ID)', placeholder: 'DE…' },
    { key: 'reg_no', label: 'Handelsregister', placeholder: 'HRB…' },
  ],
  FR: [
    { key: 'vat_id', label: 'TVA intracommunautaire', placeholder: 'FR…' },
    { key: 'reg_no', label: 'SIREN / SIRET' },
  ],
  OTHER: [
    { key: 'vat_id', label: 'VAT / Tax ID' },
    { key: 'reg_no', label: 'Company registry no.' },
  ],
};
const COUNTRIES = ['PL', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'CZ', 'SK', 'SE', 'DK', 'FI', 'IE', 'PT', 'RO', 'HU', 'GR', 'BG', 'HR', 'LT', 'LV', 'EE', 'SI', 'LU', 'CY', 'MT', 'GB', 'US', 'OTHER'];
const identityFields = (country: string) => COUNTRY_IDENTITY[country] || COUNTRY_IDENTITY.OTHER;

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
      if (b) setForm({
        logo_url: b.logo_url || '', legal_name: b.legal_name || '', address: b.address || '',
        accent_color: b.accent_color || '#4653CE', invoice_footer: b.invoice_footer || '',
        tax_id: b.tax_id || '', country: b.country || 'PL', vat_id: b.vat_id || '',
        reg_no: b.reg_no || '', bdo: b.bdo || '', iban: b.iban || '', bank_name: b.bank_name || '',
      });
      setLoading(false);
    });
  }, [ready, privy]);

  const set = (patch: Partial<Form>) => { setForm((f) => ({ ...f, ...patch })); setSaved(false); };

  const onLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !wsId) return;
    if (!privy) { setError('Sign in to upload a logo.'); return; }
    setUploading(true); setError('');
    const { url, error: upErr } = await uploadImage(privy, wsId, file, 'logo');
    if (upErr) { setError(upErr); setUploading(false); return; }
    set({ logo_url: url! });
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
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary">Branding</h1>
        <span className="text-[11px] text-tertiary">Logo &amp; details on your invoices and offers</span>
        <button onClick={save} disabled={saving || !privy}
          className="ml-auto h-8 px-3 rounded-md text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null} {saved ? 'Saved' : 'Save'}
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : privy && !wsId ? (
          // Signed in but no workspace yet — send them to finish company setup
          // instead of the misleading "Sign in to save" dead-end.
          <div className="max-w-md mx-auto mt-10 rounded-xl bg-surface ring-1 ring-subtle shadow-card p-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-accent-soft ring-1 ring-subtle flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-6 h-6 text-accent" />
            </div>
            <h2 className="text-lg font-semibold text-primary">Finish setting up your company</h2>
            <p className="mt-1.5 text-[13px] text-secondary">Create your workspace first — then you can add your logo, legal details and bank info here.</p>
            <Link href="/auth/register" className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm">
              Set up company <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        ) : (
          <div className="max-w-4xl grid lg:grid-cols-2 gap-6">
            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-secondary mb-1.5">Logo</label>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-lg ring-1 ring-subtle flex items-center justify-center overflow-hidden bg-surface-sunken shrink-0">
                    {form.logo_url ? <img src={form.logo_url} alt="" className="w-full h-full object-contain" /> : <div className="w-7 h-7 rounded" style={{ background: form.accent_color }} />}
                  </div>
                  <label className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken cursor-pointer">
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
                    <input type="file" accept="image/*" className="hidden" onChange={onLogoFile} disabled={!privy || uploading} />
                  </label>
                  {form.logo_url && <button onClick={() => set({ logo_url: '' })} className="text-[12px] text-tertiary hover:text-danger">Remove</button>}
                </div>
                <input value={form.logo_url} onChange={(e) => set({ logo_url: e.target.value })} placeholder="…or paste a logo image URL"
                  className="mt-2 w-full h-9 px-2.5 text-[12px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-secondary mb-1">Legal company name</label>
                <input value={form.legal_name} onChange={(e) => set({ legal_name: e.target.value })} placeholder={wsName}
                  className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" />
              </div>

              {/* Country-driven legal identity */}
              <div className="rounded-xl ring-1 ring-subtle p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-tertiary">Legal identity — shown on invoices</span>
                  <select value={form.country} onChange={(e) => set({ country: e.target.value })}
                    className="h-8 px-2 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none">
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {identityFields(form.country).map((f) => (
                  <div key={f.key}>
                    <label className="block text-[12px] font-semibold text-secondary mb-1">{f.label}</label>
                    <input value={form[f.key]} onChange={(e) => set({ [f.key]: e.target.value } as any)} placeholder={f.placeholder}
                      className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none tabular-nums" />
                  </div>
                ))}
              </div>

              {/* Bank details (universal) */}
              <div className="rounded-xl ring-1 ring-subtle p-3.5 space-y-3">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-tertiary">Bank — for payment on invoices</span>
                <div>
                  <label className="block text-[12px] font-semibold text-secondary mb-1">IBAN / account number</label>
                  <input value={form.iban} onChange={(e) => set({ iban: e.target.value })} placeholder="PL00 0000 0000 0000 0000 0000 0000"
                    className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none tabular-nums" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-secondary mb-1">Bank name</label>
                  <input value={form.bank_name} onChange={(e) => set({ bank_name: e.target.value })}
                    className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-secondary mb-1">Address</label>
                <textarea value={form.address} onChange={(e) => set({ address: e.target.value })} rows={2} placeholder="Street, city, country"
                  className="w-full px-2.5 py-2 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-secondary mb-1">Accent color</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.accent_color} onChange={(e) => set({ accent_color: e.target.value })}
                    className="w-9 h-9 rounded-md ring-1 ring-subtle cursor-pointer bg-surface" />
                  <input value={form.accent_color} onChange={(e) => set({ accent_color: e.target.value })}
                    className="w-28 h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none tabular-nums" />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-secondary mb-1">Invoice footer / payment terms</label>
                <textarea value={form.invoice_footer} onChange={(e) => set({ invoice_footer: e.target.value })} rows={3} placeholder="Payment within 14 days · bank details · VAT no…"
                  className="w-full px-2.5 py-2 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" />
              </div>

              {!privy && <p className="text-[12px] text-warning">Sign in to upload a logo and save branding.</p>}
              {error && <p className="text-[12px] text-danger">{error}</p>}
            </div>

            {/* Live preview */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-tertiary mb-2">Preview</div>
              <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card shadow-sm overflow-hidden">
                <div className="h-1.5" style={{ background: form.accent_color }} />
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {form.logo_url ? <img src={form.logo_url} alt="" className="w-10 h-10 rounded-lg object-contain" /> : <div className="w-10 h-10 rounded-lg" style={{ background: form.accent_color }} />}
                      <div>
                        <div className="text-[15px] font-semibold text-primary">{displayName}</div>
                        <div className="text-[11px] text-tertiary whitespace-pre-line">{form.address || 'runbutter.app'}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-primary">Invoice</div>
                      <div className="text-[12px] text-tertiary">INV-1001</div>
                    </div>
                  </div>
                  <div className="mt-6 flex justify-between text-[14px] font-semibold border-t border-subtle pt-3">
                    <span className="text-primary">Total due</span>
                    <span style={{ color: form.accent_color }}>$4,150.00</span>
                  </div>
                  {form.invoice_footer && <div className="mt-4 pt-3 border-t border-subtle text-[11px] text-secondary whitespace-pre-line">{form.invoice_footer}</div>}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-tertiary">This is how your invoices and offers will look.</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
