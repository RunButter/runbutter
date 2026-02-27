'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, uploadLogo } from '@/lib/supabase';
import { usePrivy } from '@privy-io/react-auth';
import {
    Building2,
    Upload,
    Loader2,
    CheckCircle,
    AlertCircle,
    Globe,
    ArrowLeft,
    Trash2
} from 'lucide-react';
import Link from 'next/link';
import LogoContainer from '@/components/LogoContainer';

export default function SettingsPage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [company, setCompany] = useState<any>(null);
    const [formData, setFormData] = useState({
        name: '',
        subdomain: '',
    });
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);

    const loadSettings = useCallback(async (privyUserId: string) => {
        try {
            setLoading(true);
            // Set the session variable for RLS
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });

            // Get company info
            const { data: companyUser, error: companyError } = await supabase
                .from('company_users')
                .select('*, company:companies(*)')
                .eq('privy_user_id', privyUserId)
                .maybeSingle();

            if (companyError) throw companyError;

            if (!companyUser) {
                router.push('/auth/register');
                return;
            }

            setCompany(companyUser.company);
            setFormData({
                name: companyUser.company.name,
                subdomain: companyUser.company.subdomain,
            });
            setLogoPreview(companyUser.company.logo_url);
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
            if (logoFile) {
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
            const { error: updateError } = await supabase
                .from('companies')
                .update({
                    name: formData.name,
                    logo_url: logoUrl,
                })
                .eq('id', company.id);

            if (updateError) throw updateError;

            setSuccess('Settings updated successfully!');
            setCompany({ ...company, name: formData.name, logo_url: logoUrl });
        } catch (err: any) {
            console.error('Error saving settings:', err);
            setError(err.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    if (!ready || loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-12 h-12 text-primary-600 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b">
                <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-full transition">
                            <ArrowLeft className="w-5 h-5 text-gray-600" />
                        </Link>
                        <h1 className="text-2xl font-bold text-gray-800">Company Settings</h1>
                    </div>
                    <button
                        onClick={handleSubmit}
                        disabled={saving}
                        className="btn-primary"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
                    </button>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-6 py-8">
                <div className="grid gap-6">
                    {/* Status Messages */}
                    {success && (
                        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700">
                            <CheckCircle className="w-5 h-5" />
                            {success}
                        </div>
                    )}
                    {error && (
                        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
                            <AlertCircle className="w-5 h-5" />
                            {error}
                        </div>
                    )}

                    {/* Branding Section */}
                    <section className="bg-white rounded-2xl shadow-sm border p-8">
                        <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                            <Building2 className="w-6 h-6 text-primary-600" />
                            Company Identity
                        </h2>

                        <form onSubmit={handleSubmit} className="space-y-8">
                            <div className="grid md:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
                                        <input
                                            type="text"
                                            className="input-field"
                                            placeholder="Acme Inc."
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required
                                        />
                                        <p className="mt-1 text-xs text-gray-500">This name appears on the application pages and in emails.</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Subdomain (Read-only)</label>
                                        <div className="relative">
                                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                            <input
                                                type="text"
                                                className="input-field pl-10 bg-gray-50 cursor-not-allowed"
                                                value={formData.subdomain}
                                                readOnly
                                            />
                                        </div>
                                        <p className="mt-1 text-xs text-gray-500">Your portal: {formData.subdomain}.hirebtr.com</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="block text-sm font-medium text-gray-700">Company Logo</label>

                                    {logoPreview ? (
                                        <div className="relative group w-fit">
                                            <LogoContainer
                                                src={logoPreview}
                                                alt="Preview"
                                                width="240px"
                                                height="120px"
                                                showBorder={true}
                                                className="bg-gray-50"
                                            />
                                            <button
                                                type="button"
                                                onClick={removeItemLogo}
                                                className="absolute -top-2 -right-2 p-1.5 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition shadow-sm"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-center w-[240px] h-[120px] border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
                                            <div className="text-center">
                                                <Building2 className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                                                <p className="text-xs text-gray-500">No logo uploaded</p>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-4">
                                        <label className="cursor-pointer bg-white px-4 py-2 border rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition flex items-center gap-2">
                                            <Upload className="w-4 h-4" />
                                            {logoPreview ? 'Change Logo' : 'Upload Logo'}
                                            <input
                                                type="file"
                                                className="hidden"
                                                accept="image/*"
                                                onChange={handleLogoChange}
                                            />
                                        </label>
                                        <p className="text-xs text-gray-500">PNG, JPG, WebP. Max 2MB.</p>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </section>

                    {/* Tips Section */}
                    <div className="p-6 bg-primary-50 rounded-2xl border border-primary-100">
                        <h3 className="font-bold text-primary-900 mb-2">Why add branding?</h3>
                        <p className="text-sm text-primary-800 leading-relaxed">
                            Adding your company logo and name creates a professional experience for candidates.
                            Companies with complete profiles see a 24% higher completion rate on assessments.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
}
