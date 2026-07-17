import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import Logo from '@/components/Logo';

export default function TermsPage() {
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
                            <FileText className="w-6 h-6 text-primary-600" />
                        </div>
                        <h1 className="text-3xl font-bold text-gray-900">Terms of Service</h1>
                    </div>

                    <p className="text-gray-500 mb-8 pb-8 border-b">
                        <strong>Effective Date:</strong> February 23, 2026
                    </p>

                    <div className="prose prose-slate max-w-none">
                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">1. Acceptance of Terms</h2>
                            <p className="text-gray-600 leading-relaxed">
                                By accessing RunButter, you agree to these Terms. You must be at least 18 years of age to use this service.
                            </p>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">2. AI Service Disclaimer</h2>
                            <p className="text-gray-600 leading-relaxed mb-4">
                                You acknowledge that RunButter uses Artificial Intelligence to provide psychometric insights.
                            </p>
                            <ul className="list-disc pl-5 space-y-2 text-gray-600">
                                <li><strong>Accuracy:</strong> AI is probabilistic. We do not guarantee 100% accuracy of personality profiles or candidate &quot;fit&quot; scores.</li>
                                <li><strong>No Professional Advice:</strong> AI scores are for informational recruitment purposes and do not constitute professional psychological diagnoses.</li>
                            </ul>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">3. Limitation of Liability</h2>
                            <p className="text-gray-600 leading-relaxed mb-4">
                                RunButter provides a tool for recruiters. We are not responsible for:
                            </p>
                            <ul className="list-disc pl-5 space-y-2 text-gray-600">
                                <li>Any hiring or firing decisions made by users.</li>
                                <li>Any bias or errors resulting from the recruiter’s interpretation of AI data.</li>
                                <li>Direct or indirect damages exceeding the amount paid for the service in the last 12 months.</li>
                            </ul>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">4. Subscription & Billing</h2>
                            <p className="text-gray-600 leading-relaxed">
                                Payments are processed via Stripe. Subscriptions are billed in advance and auto-renew unless cancelled at least 24 hours before the renewal date.
                            </p>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4">5. Prohibited Use</h2>
                            <p className="text-gray-600 leading-relaxed">
                                You agree not to use RunButter to discriminate against candidates based on protected characteristics (race, religion, gender, disability) in violation of local labor laws.
                            </p>
                        </section>

                        <section className="mt-12 pt-8 border-t text-center">
                            <p className="text-gray-600">
                                Questions? Email us at:{' '}
                                <a href="mailto:hello@runbutter.app" className="text-primary-600 font-semibold hover:underline">
                                    hello@runbutter.app
                                </a>
                            </p>
                        </section>
                    </div>
                </div>

                <div className="mt-8 text-center text-gray-500 text-sm">
                    © 2026 runbutter.app. All rights reserved.
                </div>
            </div>
        </div>
    );
}
