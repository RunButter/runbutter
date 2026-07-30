'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, Send, CheckCircle2, Clock, ShieldCheck, Github, Loader2 } from 'lucide-react';
import Logo from '@/components/Logo';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const REPO_URL = 'https://github.com/RunButter/runbutter';

export default function ContactPage() {
    const [submitted, setSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const formData = new FormData(e.currentTarget);
        const data = {
            name: formData.get('name'),
            email: formData.get('email'),
            subject: formData.get('subject'),
            message: formData.get('message'),
        };

        try {
            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.error || 'Failed to send message');
            }
            setSubmitted(true);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (submitted) {
        return (
            <div className="min-h-screen bg-canvas flex items-center justify-center px-6">
                <div className="max-w-md w-full rounded-xl bg-surface ring-1 ring-subtle shadow-card p-8 text-center">
                    <div className="w-12 h-12 rounded-xl bg-success/10 ring-1 ring-success/30 flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 className="w-6 h-6 text-success" />
                    </div>
                    <h1 className="text-lg font-semibold text-primary">Message received</h1>
                    <p className="mt-1.5 text-sm text-secondary leading-relaxed">
                        Thanks for reaching out. We reply from <strong className="font-medium text-primary">hello@runbutter.app</strong>, usually within one business day.
                    </p>
                    <Link href="/" className="mt-5 inline-flex items-center justify-center h-10 w-full rounded-md bg-inverse text-inverse-fg text-sm font-semibold shadow-sm hover:bg-inverse/90 transition-colors">
                        Back to home
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-canvas">
            <header className="sticky top-0 z-50 border-b border-subtle bg-canvas/80 backdrop-blur-md">
                <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-3">
                    <Link href="/" aria-label="Back" className="p-1.5 -ml-1.5 rounded-md text-secondary hover:bg-surface-hover transition-colors">
                        <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <Link href="/"><Logo mono /></Link>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-14 lg:py-20">
                <div className="grid lg:grid-cols-[1fr_1.2fr] gap-10 lg:gap-14 items-start">
                    {/* Left: context */}
                    <div>
                        <h1 className="text-3xl md:text-4xl font-medium tracking-tight text-primary leading-tight">
                            Talk to us about running your company on RunButter
                        </h1>
                        <p className="mt-4 text-secondary leading-relaxed max-w-[46ch]">
                            Enterprise plans, self-hosting, migrations, or a question about whether it fits how your team works. A real person answers.
                        </p>

                        <div className="mt-8 space-y-3">
                            <InfoRow icon={Mail} label="Email us directly">
                                <a href="mailto:hello@runbutter.app" className="text-sm font-medium text-accent hover:underline">hello@runbutter.app</a>
                            </InfoRow>
                            <InfoRow icon={Clock} label="Response time">
                                <span className="text-sm text-secondary">Usually within one business day</span>
                            </InfoRow>
                            <InfoRow icon={ShieldCheck} label="Your data">
                                <span className="text-sm text-secondary">Open source, self-hostable, GDPR controls built in</span>
                            </InfoRow>
                        </div>

                        <a href={REPO_URL} target="_blank" rel="noopener noreferrer"
                            className="mt-6 inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-surface text-primary text-sm font-medium ring-1 ring-subtle shadow-sm hover:bg-surface-hover transition-colors">
                            <Github className="w-4 h-4" /> Read the code on GitHub
                        </a>
                    </div>

                    {/* Right: form */}
                    <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-6 md:p-7">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="name" required>Full name</Label>
                                    <Input id="name" name="name" type="text" required placeholder="Ada Kowalczyk" />
                                </div>
                                <div>
                                    <Label htmlFor="email" required>Work email</Label>
                                    <Input id="email" name="email" type="email" required placeholder="ada@company.com" />
                                </div>
                            </div>

                            <div>
                                <Label htmlFor="subject">What is this about?</Label>
                                <Select id="subject" name="subject" defaultValue="General question">
                                    <option>General question</option>
                                    <option>Enterprise plan</option>
                                    <option>Self-hosting</option>
                                    <option>Migrating from another tool</option>
                                    <option>Technical support</option>
                                </Select>
                            </div>

                            <div>
                                <Label htmlFor="message" required>Message</Label>
                                <Textarea id="message" name="message" required rows={6}
                                    placeholder="Tell us what you are trying to run, and what is in your way." />
                            </div>

                            {error && (
                                <p className="rounded-md bg-danger/10 ring-1 ring-danger/30 px-3 py-2 text-xs text-danger">{error}</p>
                            )}

                            <button type="submit" disabled={loading}
                                className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-md bg-inverse text-inverse-fg text-sm font-semibold shadow-sm hover:bg-inverse/90 transition-colors disabled:opacity-50 disabled:pointer-events-none">
                                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <>Send message <Send className="w-4 h-4" /></>}
                            </button>
                            <p className="text-center text-2xs text-tertiary">
                                By sending this you agree to our <Link href="/privacy" className="underline hover:text-secondary">privacy policy</Link>.
                            </p>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
}

function InfoRow({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-3 rounded-xl bg-surface ring-1 ring-subtle shadow-card p-4">
            <div className="w-8 h-8 rounded-lg bg-surface-sunken ring-1 ring-subtle flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-tertiary" />
            </div>
            <div className="min-w-0">
                <div className="text-2xs font-semibold uppercase tracking-wide text-tertiary">{label}</div>
                <div className="mt-0.5">{children}</div>
            </div>
        </div>
    );
}
