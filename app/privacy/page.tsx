import Link from 'next/link';
import { ArrowLeft, Shield } from 'lucide-react';
import Logo from '@/components/Logo';

export default function PrivacyPage() {
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
                            <Shield className="w-6 h-6 text-accent" />
                        </div>
                        <h1 className="text-3xl font-medium text-primary">Privacy Policy</h1>
                    </div>

                    <p className="text-secondary mb-8 pb-8 border-b">
                        <strong>Last Updated:</strong> February 23, 2026
                    </p>

                    <div className="prose prose-slate max-w-none">
                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">1. Introduction</h2>
                            <p className="text-secondary leading-relaxed">
                                RunButter (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is committed to protecting your privacy. This policy complies with the EU General Data Protection Regulation (GDPR), the California Consumer Privacy Act (CCPA), and the EU AI Act.
                            </p>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">2. AI Transparency Disclosure (Automated Decision-Making)</h2>
                            <p className="text-secondary leading-relaxed mb-4">
                                RunButter uses Artificial Intelligence to analyze candidate responses and generate psychometric profiles (the &quot;Services&quot;).
                            </p>
                            <ul className="list-disc pl-5 space-y-2 text-secondary">
                                <li><strong>Logic Involved:</strong> We utilize Large Language Models (LLMs) to process text and video inputs to identify personality traits based on the &quot;Big Five&quot; psychological model.</li>
                                <li><strong>Significance:</strong> These profiles assist recruiters in evaluating candidate &quot;fit.&quot;</li>
                                <li><strong>Human-in-the-Loop:</strong> RunButter is a support tool. All final hiring decisions are made by human recruiters. We prohibit &quot;solely automated&quot; hiring decisions.</li>
                            </ul>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">3. Information We Collect</h2>
                            <ul className="list-disc pl-5 space-y-2 text-secondary">
                                <li><strong>Profile Data:</strong> Name, email, and CV.</li>
                                <li><strong>Assessment Data:</strong> Text responses, psychometric scores, and AI-generated trait analysis.</li>
                                <li><strong>Technical Data:</strong> IP address and browser type for security.</li>
                            </ul>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">4. Data Sharing & Third Parties</h2>
                            <p className="text-secondary leading-relaxed mb-4">
                                We do not sell your data. We share data only with:
                            </p>
                            <ul className="list-disc pl-5 space-y-2 text-secondary">
                                <li><strong>Cloud Providers:</strong> Supabase (Database storage).</li>
                                <li><strong>AI Infrastructure:</strong> OpenAI / Anthropic (Processing analysis—data is not used to train their global models).</li>
                                <li><strong>Google Calendar:</strong> Only if a recruiter connects their own Google account, and only to schedule interviews (see section 5).</li>
                                <li><strong>Email Delivery:</strong> Resend (sending interview invitations and status updates to candidates).</li>
                            </ul>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">5. Google User Data (Calendar Integration)</h2>
                            <p className="text-secondary leading-relaxed mb-4">
                                Connecting Google Calendar is entirely optional and is initiated by a recruiter for their
                                own Google account. If connected, we request a single permission—
                                <code className="text-[13px]">calendar.events</code>—and use it strictly to schedule interviews.
                            </p>
                            <ul className="list-disc pl-5 space-y-2 text-secondary mb-4">
                                <li><strong>What we do:</strong> create, update, and cancel the interview events you schedule in RunButter, attach a Google Meet link, and invite the candidate.</li>
                                <li><strong>What we store:</strong> the OAuth tokens for your connection, plus the event ID and Meet link of interviews you created here.</li>
                                <li><strong>What we never do:</strong> read, scan, index, or store the rest of your calendar; use Google data for advertising, profiling, or to train any AI model; or sell or transfer it to third parties.</li>
                                <li><strong>Revoking access:</strong> disconnect at any time in Automate → Integrations, or from your Google Account permissions page. Revoking deletes the stored tokens.</li>
                            </ul>
                            <p className="text-secondary leading-relaxed">
                                RunButter&rsquo;s use and transfer of information received from Google APIs to any other app
                                will adhere to the{' '}
                                <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-accent underline">
                                    Google API Services User Data Policy
                                </a>, including the Limited Use requirements.
                            </p>
                        </section>

                        <section className="mb-8">
                            <h2 className="text-xl font-medium text-primary mb-4">6. Your 2026 Rights</h2>
                            <ul className="list-disc pl-5 space-y-2 text-secondary">
                                <li><strong>Right to Human Review:</strong> You may request that a human recruiter reviews any AI-generated score.</li>
                                <li><strong>Right to Explanation:</strong> You may request an explanation of the logic used to generate your psychometric profile.</li>
                                <li><strong>Right to Deletion:</strong> You may request the permanent deletion of your profile at any time.</li>
                            </ul>
                        </section>

                        <section className="mt-12 pt-8 border-t">
                            <h2 className="text-xl font-medium text-primary mb-4">Contact</h2>
                            <p className="text-secondary">
                                If you have any questions about this Privacy Policy, please contact us at:{' '}
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
