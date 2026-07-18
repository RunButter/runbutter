import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import Logo from '@/components/Logo';

export default function TermsPage() {
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
                            <FileText className="w-6 h-6 text-accent" />
                        </div>
                        <h1 className="text-3xl font-medium text-primary">Terms of Service</h1>
                    </div>

                    <p className="text-secondary mb-8 pb-8 border-b">
                        <strong>Effective Date:</strong> February 23, 2026
                    </p>

                    <div className="prose prose-slate max-w-none">
                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">1. Acceptance of Terms</h2>
                            <p className="text-secondary leading-relaxed">
                                By accessing RunButter, you agree to these Terms. You must be at least 18 years of age to use this service.
                            </p>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">2. AI Service Disclaimer</h2>
                            <p className="text-secondary leading-relaxed mb-4">
                                You acknowledge that RunButter uses Artificial Intelligence to provide psychometric insights.
                            </p>
                            <ul className="list-disc pl-5 space-y-2 text-secondary">
                                <li><strong>Accuracy:</strong> AI is probabilistic. We do not guarantee 100% accuracy of personality profiles or candidate &quot;fit&quot; scores.</li>
                                <li><strong>No Professional Advice:</strong> AI scores are for informational recruitment purposes and do not constitute professional psychological diagnoses.</li>
                            </ul>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">3. Limitation of Liability</h2>
                            <p className="text-secondary leading-relaxed mb-4">
                                RunButter provides a tool for recruiters. We are not responsible for:
                            </p>
                            <ul className="list-disc pl-5 space-y-2 text-secondary">
                                <li>Any hiring or firing decisions made by users.</li>
                                <li>Any bias or errors resulting from the recruiter’s interpretation of AI data.</li>
                                <li>Direct or indirect damages exceeding the amount paid for the service in the last 12 months.</li>
                            </ul>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">4. Subscription & Billing</h2>
                            <p className="text-secondary leading-relaxed">
                                Payments are processed via Stripe. Subscriptions are billed in advance and auto-renew unless cancelled at least 24 hours before the renewal date.
                            </p>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">5. Prohibited Use</h2>
                            <p className="text-secondary leading-relaxed">
                                You agree not to use RunButter to discriminate against candidates based on protected characteristics (race, religion, gender, disability) in violation of local labor laws.
                            </p>
                        </section>

                        <section className="mt-12 pt-8 border-t text-center">
                            <p className="text-secondary">
                                Questions? Email us at:{' '}
                                <a href="mailto:hello@runbutter.app" className="text-accent font-semibold hover:underline">
                                    hello@runbutter.app
                                </a>
                            </p>
                        </section>
                    </div>
                </div>

                <div className="mt-8 text-center text-secondary text-sm">
                    © 2026 runbutter.app. All rights reserved.
                </div>
            </div>
        </div>
    );
}
