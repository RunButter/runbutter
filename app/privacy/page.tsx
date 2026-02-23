import Link from 'next/link';
import { ArrowLeft, Shield } from 'lucide-react';
import Logo from '@/components/Logo';

export default function PrivacyPage() {
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
                            <Shield className="w-6 h-6 text-primary-600" />
                        </div>
                        <h1 className="text-3xl font-bold text-gray-900">Privacy Policy</h1>
                    </div>

                    <p className="text-gray-500 mb-8 pb-8 border-b">
                        <strong>Last Updated:</strong> February 23, 2026
                    </p>

                    <div className="prose prose-slate max-w-none">
                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">1. Introduction</h2>
                            <p className="text-gray-600 leading-relaxed">
                                HireBTR ("we," "us," or "our") is committed to protecting your privacy. This policy complies with the EU General Data Protection Regulation (GDPR), the California Consumer Privacy Act (CCPA), and the EU AI Act.
                            </p>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">2. AI Transparency Disclosure (Automated Decision-Making)</h2>
                            <p className="text-gray-600 leading-relaxed mb-4">
                                HireBTR uses Artificial Intelligence to analyze candidate responses and generate psychometric profiles (the "Services").
                            </p>
                            <ul className="list-disc pl-5 space-y-2 text-gray-600">
                                <li><strong>Logic Involved:</strong> We utilize Large Language Models (LLMs) to process text and video inputs to identify personality traits based on the "Big Five" psychological model.</li>
                                <li><strong>Significance:</strong> These profiles assist recruiters in evaluating candidate "fit."</li>
                                <li><strong>Human-in-the-Loop:</strong> HireBTR is a support tool. All final hiring decisions are made by human recruiters. We prohibit "solely automated" hiring decisions.</li>
                            </ul>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">3. Information We Collect</h2>
                            <ul className="list-disc pl-5 space-y-2 text-gray-600">
                                <li><strong>Profile Data:</strong> Name, email, and CV.</li>
                                <li><strong>Assessment Data:</strong> Text responses, psychometric scores, and AI-generated trait analysis.</li>
                                <li><strong>Technical Data:</strong> IP address and browser type for security.</li>
                            </ul>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">4. Data Sharing & Third Parties</h2>
                            <p className="text-gray-600 leading-relaxed mb-4">
                                We do not sell your data. We share data only with:
                            </p>
                            <ul className="list-disc pl-5 space-y-2 text-gray-600">
                                <li><strong>Cloud Providers:</strong> Supabase (Database storage).</li>
                                <li><strong>AI Infrastructure:</strong> OpenAI / Anthropic (Processing analysis—data is not used to train their global models).</li>
                            </ul>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">5. Your 2026 Rights</h2>
                            <ul className="list-disc pl-5 space-y-2 text-gray-600">
                                <li><strong>Right to Human Review:</strong> You may request that a human recruiter reviews any AI-generated score.</li>
                                <li><strong>Right to Explanation:</strong> You may request an explanation of the logic used to generate your psychometric profile.</li>
                                <li><strong>Right to Deletion:</strong> You may request the permanent deletion of your profile at any time.</li>
                            </ul>
                        </section>

                        <section className="mt-12 pt-8 border-t">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">Contact</h2>
                            <p className="text-gray-600">
                                If you have any questions about this Privacy Policy, please contact us at:{' '}
                                <a href="mailto:hello@hirebtr.com" className="text-primary-600 font-semibold hover:underline">
                                    hello@hirebtr.com
                                </a>
                            </p>
                        </section>
                    </div>
                </div>

                <div className="mt-8 text-center text-gray-500 text-sm">
                    © 2026 hirebtr.com. All rights reserved.
                </div>
            </div>
        </div>
    );
}
