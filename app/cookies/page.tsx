import Link from 'next/link';
import { ArrowLeft, Cookie } from 'lucide-react';
import Logo from '@/components/Logo';

export default function CookiesPage() {
    return (
        <div className="min-h-screen bg-slate-50 py-12 px-6">
            <div className="max-w-3xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <Link href="/" className="flex items-center gap-2 text-primary-600 hover:text-primary-700 transition">
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back to Home</span>
                    </Link>
                    <Logo iconOnly />
                </div>

                <div className="bg-white rounded-2xl shadow-sm border p-8 md:p-12">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                            <Cookie className="w-6 h-6 text-primary-600" />
                        </div>
                        <h1 className="text-3xl font-bold text-gray-900">Cookie Policy</h1>
                    </div>

                    <p className="text-gray-500 mb-8 pb-8 border-b">
                        <strong>Effective Date:</strong> February 23, 2026
                    </p>

                    <div className="prose prose-slate max-w-none">
                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">What Are Cookies?</h2>
                            <p className="text-gray-600 leading-relaxed text-sm">
                                Cookies are small text files stored on your device that help us provide a seamless experience. We use them for authentication, security, and to remember your preferences.
                            </p>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">Types of Cookies We Use</h2>
                            <div className="space-y-4">
                                <div className="p-4 bg-gray-50 rounded-lg">
                                    <h3 className="font-semibold text-gray-900 mb-1">Essential Cookies</h3>
                                    <p className="text-gray-600 text-sm">Required for core functionality like secure login (Privy) and database sessions (Supabase).</p>
                                </div>
                                <div className="p-4 bg-gray-50 rounded-lg">
                                    <h3 className="font-semibold text-gray-900 mb-1">Functional Cookies</h3>
                                    <p className="text-gray-600 text-sm">Allow us to remember your settings, such as your selected language or dashboard theme.</p>
                                </div>
                                <div className="p-4 bg-gray-50 rounded-lg">
                                    <h3 className="font-semibold text-gray-900 mb-1">Analytical Cookies</h3>
                                    <p className="text-gray-600 text-sm">Help us understand how you interact with the app so we can improve the user experience.</p>
                                </div>
                            </div>
                        </section>

                        <section className="mt-12 pt-8 border-t text-center">
                            <p className="text-gray-600">
                                For more info, contact us at:{' '}
                                <a href="mailto:hello@runbutter.app" className="text-primary-600 font-semibold hover:underline">
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
