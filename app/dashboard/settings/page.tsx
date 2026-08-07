'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, uploadLogo } from '@/lib/supabase';
import { listHrCompanies } from '@/lib/hr/company';
import { usePrivy } from '@privy-io/react-auth';
import {
    Building2,
    Upload,
    Loader2,
    CheckCircle,
    AlertCircle,
    Globe,
    ArrowLeft,
    Trash2,
    Plus,
    Send,
    Zap
} from 'lucide-react';
import Link from 'next/link';
import LogoContainer from '@/components/LogoContainer';
import { rpc } from '@/lib/rpc';
import { useDialog } from '@/components/ui/Dialog';

export default function SettingsPage() {
  const { confirm: confirmDialog } = useDialog();
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isGoogleConnected, setIsGoogleConnected] = useState(false);

    const [company, setCompany] = useState<any>(null);
    const [formData, setFormData] = useState({
        name: '',
        subdomain: '',
    });
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);

    // Webhook integrations (Slack / Discord / Zapier / Make / generic)
    const [webhooks, setWebhooks] = useState<any[]>([]);
    const [newHook, setNewHook] = useState({ label: '', type: 'slack', url: '' });
    const [hookSaving, setHookSaving] = useState(false);
    const [hookTesting, setHookTesting] = useState<string | null>(null);
    const [hookMsg, setHookMsg] = useState('');

    const loadSettings = useCallback(async (privyUserId: string) => {
        try {
            setLoading(true);
            // Set the session variable for RLS

            // Via listHrCompanies, not a direct read. Two bugs in the old one:
            // 0077 revoked the grant, so it raised `permission denied` — and
            // .maybeSingle() throws "multiple rows returned" for anyone in two
            // companies. Either way the code below treats it as "no company"
            // and pushes an EXISTING customer to /auth/register, which is the
            // exact failure 0077's own header warns about.
            const mine = await listHrCompanies(privyUserId);
            const active = mine.find((c) => c.active) ?? mine[0];
            const companyUser = active
                ? {
                    company: {
                        id: active.companyId, name: active.name,
                        subdomain: active.subdomain, logo_url: active.logoUrl,
                    },
                    role: active.role,
                  }
                : null;

            if (!companyUser) {
                router.push('/auth/register');
                return;
            }

            setCompany(companyUser.company);
            setFormData({
                name: companyUser.company.name,
                // The form is a controlled input, so it needs '' rather than null.
                subdomain: companyUser.company.subdomain ?? '',
            });
            setLogoPreview(companyUser.company.logo_url);

            // Check Google Integration Status (integration_tokens is no longer
            // anon-readable — go through the verified RPC).
            const { data: connected } = await rpc('hr_google_connected', { p_privy: privyUserId });
            setIsGoogleConnected(connected === true);

            // Load the company's webhook integrations
            const { data: hooks } = await rpc('get_webhook_endpoints', { p_privy_user_id: privyUserId });
            setWebhooks(Array.isArray(hooks) ? hooks : []);

        } catch (err: any) {
            console.error('Error loading settings:', err);
            setError('Failed to load company settings');
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => {
        if (ready) {
            if (!authenticated) {
                router.push('/auth/login');
            } else if (user) {
                loadSettings(user.id);
            }
        }
    }, [ready, authenticated, user, router, loadSettings]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('success') === 'google_connected') {
                setSuccess('Google Calendar successfully connected!');
                window.history.replaceState({}, '', '/dashboard/settings');
            } else if (params.get('error')) {
                setError('Failed to connect Google Calendar. Check your API Keys.');
                window.history.replaceState({}, '', '/dashboard/settings');
            }
        }
    }, []);

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) {
                setError('Logo must be less than 2MB');
                return;
            }
            setLogoFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setLogoPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const removeItemLogo = async () => {
        setLogoFile(null);
        setLogoPreview(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!company) return;

        setSaving(true);
        setError('');
        setSuccess('');

        try {
            let logoUrl = company.logo_url;

            // 1. Upload new logo if selected
            if (logoFile && user) {
                // Ensure RLS session variable is set for this connection

                const uploadedUrl = await uploadLogo(logoFile, company.id);
                if (uploadedUrl) {
                    logoUrl = uploadedUrl;
                } else {
                    throw new Error('Failed to upload logo');
                }
            } else if (logoPreview === null && company.logo_url) {
                // Logo was removed
                logoUrl = null;
            }

            // 2. Update company info
            // rename_workspace (0093) writes BOTH workspaces.name and
            // companies.name, so the sidebar and the careers page cannot drift
            // apart; save_workspace_branding carries the logo. The direct
            // `companies` update this replaces has been denied since 0077.
            const { error: nameError } = await rpc('rename_workspace', {
                p_privy: user!.id, p_workspace: company.id, p_name: formData.name,
            });
            if (nameError) {
                throw new Error(/rename_workspace|does not exist/i.test(nameError.message || '')
                    ? 'Renaming needs migration 0093.'
                    : nameError.message);
            }

            if (logoUrl !== undefined) {
                const { error: brandError } = await rpc('save_workspace_branding', {
                    p_privy: user!.id, p_workspace: company.id, p_data: { logo_url: logoUrl },
                });
                if (brandError) throw new Error(brandError.message);
            }

            setSuccess('Settings updated successfully!');
            setCompany({ ...company, name: formData.name, logo_url: logoUrl });
        } catch (err: any) {
            console.error('Error saving settings:', err);
            setError(err.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const refreshWebhooks = async () => {
        if (!user) return;
        const { data } = await rpc('get_webhook_endpoints', { p_privy_user_id: user.id });
        setWebhooks(Array.isArray(data) ? data : []);
    };

    const addWebhook = async () => {
        if (!user || !newHook.url.trim()) { setHookMsg('Paste a webhook URL first.'); return; }
        setHookSaving(true); setHookMsg('');
        try {
            const { error } = await rpc('upsert_webhook_endpoint', {
                p_privy_user_id: user.id, p_id: null,
                p_label: newHook.label.trim() || newHook.type,
                p_type: newHook.type, p_url: newHook.url.trim(),
                p_events: null, p_is_active: true,
            });
            if (error) throw error;
            setNewHook({ label: '', type: 'slack', url: '' });
            await refreshWebhooks();
        } catch (e: any) {
            setHookMsg(e?.message || 'Failed to add integration');
        } finally {
            setHookSaving(false);
        }
    };

    const removeWebhook = async (id: string) => {
        if (!user || !await confirmDialog('Remove this integration?')) return;
        try {
            const { error } = await rpc('delete_webhook_endpoint', { p_privy_user_id: user.id, p_id: id });
            if (error) throw error;
            setWebhooks((prev) => prev.filter((w) => w.id !== id));
        } catch (e: any) {
            setHookMsg(e?.message || 'Failed to remove integration');
        }
    };

    const testWebhook = async (hook: { id?: string; url: string; type: string }) => {
        if (!user || !hook.url.trim()) { setHookMsg('Paste a webhook URL first.'); return; }
        setHookTesting(hook.id || 'new'); setHookMsg('');
        try {
            const res = await fetch('/api/webhooks/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ privyUserId: user.id, url: hook.url.trim(), type: hook.type }),
            });
            const data = await res.json();
            setHookMsg(res.ok && data.ok ? '✅ Test sent — check your channel/tool.' : (data.error || 'Test failed.'));
        } catch (e: any) {
            setHookMsg(e?.message || 'Test failed');
        } finally {
            setHookTesting(null);
        }
    };

    if (!ready || loading) {
        return (
            <div className="min-h-screen bg-surface-sunken flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-accent animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-surface-sunken">
            <header className="bg-canvas">
                <div className="max-w-5xl px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        {/* Explicitly the HR overview, not bare /dashboard —
                            that now lands on the company OS home, and a back
                            button inside HR settings should stay inside HR. */}
                        <Link href="/dashboard/overview" className="p-2 hover:bg-surface-hover rounded-full transition">
                            <ArrowLeft className="w-5 h-5 text-secondary" />
                        </Link>
                        <h1 className="text-xl sm:text-2xl font-medium text-primary">Company Settings</h1>
                    </div>
                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="btn-primary w-full sm:w-auto mt-1 sm:mt-0"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
                    </button>
                </div>
            </header>

            <main className="max-w-5xl px-6 py-8">
                <div className="grid gap-6">
                    {/* Status Messages */}
                    {success && (
                        <div className="flex items-center gap-3 p-4 bg-success/10 border border-success/30 rounded-xl text-success">
                            <CheckCircle className="w-5 h-5" />
                            {success}
                        </div>
                    )}
                    {error && (
                        <div className="flex items-center gap-3 p-4 bg-danger/10 border border-danger/30 rounded-xl text-danger">
                            <AlertCircle className="w-5 h-5" />
                            {error}
                        </div>
                    )}

                    {/* Branding Section */}
                    <section className="bg-surface rounded-2xl shadow-sm border p-8">
                        <h2 className="text-xl font-semibold text-primary mb-6 flex items-center gap-2">
                            <Building2 className="w-6 h-6 text-accent" />
                            Company Identity
                        </h2>

                        <form onSubmit={handleSubmit} className="space-y-8">
                            <div className="grid md:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-sm font-medium text-secondary mb-2">Company Name</label>
                                        <input
                                            type="text"
                                            className="input-field"
                                            placeholder="Acme Inc."
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required
                                        />
                                        <p className="mt-1 text-xs text-secondary">This name appears on the application pages and in emails.</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-secondary mb-2">Subdomain (Read-only)</label>
                                        <div className="relative">
                                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
                                            <input
                                                type="text"
                                                className="input-field pl-10 bg-surface-sunken cursor-not-allowed"
                                                value={formData.subdomain}
                                                readOnly
                                            />
                                        </div>
                                        <p className="mt-1 text-xs text-secondary">Your portal: {formData.subdomain}.runbutter.app</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="block text-sm font-medium text-secondary">Company Logo</label>

                                    {logoPreview ? (
                                        <div className="relative group w-fit">
                                            <LogoContainer
                                                src={logoPreview}
                                                alt="Preview"
                                                width="240px"
                                                height="120px"
                                                showBorder={true}
                                                className="bg-surface-sunken"
                                            />
                                            <button
                                                type="button"
                                                onClick={removeItemLogo}
                                                className="absolute -top-2 -right-2 p-1.5 bg-danger/10 text-danger rounded-full hover:bg-red-200 transition shadow-sm"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center w-[240px] h-[120px] border-2 border-dashed border-subtle rounded-xl bg-surface-sunken">
                                            <div className="text-center">
                                                <Building2 className="w-8 h-8 text-tertiary mx-auto mb-2" />
                                                <p className="text-xs text-secondary">No logo uploaded</p>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-4">
                                        <label className="cursor-pointer bg-surface px-4 py-2 border rounded-lg text-sm font-medium text-secondary hover:bg-surface-sunken transition flex items-center gap-2">
                                            <Upload className="w-4 h-4" />
                                            {logoPreview ? 'Change Logo' : 'Upload Logo'}
                                            <input
                                                type="file"
                                                className="hidden"
                                                accept="image/*"
                                                onChange={handleLogoChange}
                                            />
                                        </label>
                                        <p className="text-xs text-secondary">PNG, JPG, WebP. Max 2MB.</p>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </section>

                    {/* Integrations Section */}
                    {company && user && (
                        <section className="bg-surface rounded-2xl shadow-sm border p-8">
                            <h2 className="text-xl font-semibold text-primary mb-6 flex items-center gap-2">
                                <Globe className="w-6 h-6 text-accent" />
                                Connected Apps & Integrations
                            </h2>

                            <div className="space-y-6">
                                <div className="p-6 border border-subtle rounded-xl flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-surface-sunken rounded-lg flex items-center justify-center border border-subtle shadow-sm font-semibold text-xl text-secondary">
                                            G
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-primary">Google Calendar</h3>
                                            <p className="text-sm text-secondary">Automatically schedule interviews and generate Google Meet links.</p>
                                        </div>
                                    </div>
                                    <div>
                                        {isGoogleConnected ? (
                                            <div className="flex items-center gap-2 px-4 py-2 bg-success/10 text-success font-semibold rounded-lg border border-success/30">
                                                <CheckCircle className="w-4 h-4" /> Connected
                                            </div>
                                        ) : (
                                            <Link 
                                                href={`/api/auth/google?userId=${user.id}&companyId=${company.id}`}
                                                className="btn-secondary py-2 px-6 inline-block"
                                            >
                                                Connect Calendar
                                            </Link>
                                        )}
                                    </div>
                                </div>

                                {/* Webhooks & notifications */}
                                <div className="p-6 border border-subtle rounded-xl">
                                    <div className="flex items-start gap-4 mb-5">
                                        <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center border border-accent/30 text-accent shrink-0">
                                            <Zap className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-primary">Webhooks &amp; notifications</h3>
                                            <p className="text-sm text-secondary">
                                                Get pinged on new applications, stage changes, and hires. Paste an incoming
                                                webhook URL from <strong>Slack</strong> or <strong>Discord</strong>, or a
                                                catch-hook from <strong>Zapier / Make / n8n</strong> to reach thousands of other apps.
                                            </p>
                                        </div>
                                    </div>

                                    {webhooks.length > 0 && (
                                        <div className="space-y-2 mb-5">
                                            {webhooks.map((w) => (
                                                <div key={w.id} className="flex items-center gap-3 p-3 bg-surface-sunken rounded-lg border border-subtle">
                                                    <span className="text-3xs font-medium uppercase tracking-widest px-2 py-1 rounded-md bg-surface border border-subtle text-secondary shrink-0">{w.type}</span>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-sm font-semibold text-primary truncate">{w.label || w.type}</div>
                                                        <div className="text-xs text-tertiary truncate">{w.url}</div>
                                                    </div>
                                                    <button onClick={() => testWebhook(w)} disabled={hookTesting === w.id}
                                                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-subtle text-secondary hover:border-accent/30 hover:text-accent flex items-center gap-1.5 shrink-0">
                                                        {hookTesting === w.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Test
                                                    </button>
                                                    <button onClick={() => removeWebhook(w.id)} className="p-2 rounded-lg text-tertiary hover:text-danger hover:bg-danger/10 shrink-0">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div className="space-y-3">
                                        <div className="flex flex-col sm:flex-row gap-3">
                                            <select value={newHook.type} onChange={(e) => setNewHook({ ...newHook, type: e.target.value })}
                                                className="input-field sm:w-44">
                                                <option value="slack">Slack</option>
                                                <option value="discord">Discord</option>
                                                <option value="generic">Zapier / Make / other</option>
                                            </select>
                                            <input value={newHook.url} onChange={(e) => setNewHook({ ...newHook, url: e.target.value })}
                                                placeholder="https://hooks.slack.com/services/…" className="input-field flex-1" />
                                        </div>
                                        <div className="flex flex-col sm:flex-row gap-3">
                                            <input value={newHook.label} onChange={(e) => setNewHook({ ...newHook, label: e.target.value })}
                                                placeholder="Label (optional, e.g. #hiring channel)" className="input-field flex-1" />
                                            <button onClick={() => testWebhook({ url: newHook.url, type: newHook.type })} disabled={hookTesting === 'new' || !newHook.url}
                                                className="btn-secondary">
                                                {hookTesting === 'new' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Test
                                            </button>
                                            <button onClick={addWebhook} disabled={hookSaving} className="btn-primary">
                                                {hookSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
                                            </button>
                                        </div>
                                    </div>

                                    {hookMsg && <p className="text-sm mt-3 text-secondary">{hookMsg}</p>}

                                    <p className="text-xs text-tertiary mt-4 leading-relaxed">
                                        <strong>Slack:</strong> create an Incoming Webhook at api.slack.com/messaging/webhooks. ·{' '}
                                        <strong>Discord:</strong> Channel → Edit → Integrations → Webhooks. ·{' '}
                                        <strong>Zapier/Make:</strong> start a flow with a “Webhooks → Catch Hook” trigger and paste its URL.
                                    </p>
                                </div>
                            </div>
                        </section>
                    )}

                    {/* Tips Section */}
                    <div className="p-6 bg-accent/10 rounded-2xl border border-accent/30">
                        <h3 className="font-semibold text-accent mb-2">Why add branding?</h3>
                        <p className="text-sm text-accent leading-relaxed">
                            Adding your company logo and name creates a professional experience for candidates.
                            Companies with complete profiles see a 24% higher completion rate on assessments.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
