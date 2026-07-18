import Link from 'next/link';
import { ArrowLeft, Cookie } from 'lucide-react';
import Logo from '@/components/Logo';

export default function CookiesPage() {
    return (
        <div className="min-h-screen bg-surface-sunken py-12 px-6">
            <div className="max-w-3xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <Link href="/" className="flex items-center gap-2 text-accent hover:text-accent transition">
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back to Home</span>
                    </Link>
                    <Logo iconOnly />
                </div>

                <div className="bg-surface rounded-2xl shadow-sm border p-8 md:p-12">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
                            <Cookie className="w-6 h-6 text-accent" />
                        </div>
                        <h1 className="text-3xl font-medium text-primary">Cookie Policy</h1>
                    </div>

                    <p className="text-secondary mb-8 pb-8 border-b">
                        <strong>Effective Date:</strong> February 23, 2026
                    </p>

                    <div className="prose prose-slate max-w-none">
                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">What Are Cookies?</h2>
                            <p className="text-secondary leading-relaxed text-sm">
                                Cookies are small text files stored on your device that help us provide a seamless experience. We use them for authentication, security, and to remember your preferences.
                            </p>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">Types of Cookies We Use</h2>
                            <div className="space-y-4">
                                <div className="p-4 bg-surface-sunken rounded-lg">
                                    <h3 className="font-semibold text-primary mb-1">Essential Cookies</h3>
                                    <p className="text-secondary text-sm">Required for core functionality like secure login (Privy) and database sessions (Supabase).</p>
                                </div>
                                <div className="p-4 bg-surface-sunken rounded-lg">
                                    <h3 className="font-semibold text-primary mb-1">Functional Cookies</h3>
                                    <p className="text-secondary text-sm">Allow us to remember your settings, such as your selected language or dashboard theme.</p>
                                </div>
                                <div className="p-4 bg-surface-sunken rounded-lg">
                                    <h3 className="font-semibold text-primary mb-1">Analytical Cookies</h3>
                                    <p className="text-secondary text-sm">Help us understand how you interact with the app so we can improve the user experience.</p>
                                </div>
                            </div>
                        </section>

                        <section className="mt-12 pt-8 border-t text-center">
                            <p className="text-secondary">
                                For more info, contact us at:{' '}
                                <a href="mailto:hello@runbutter.app" className="text-accent font-semibold hover:underline">
                                    hello@runbutter.app
                                </a>
                            </p>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
