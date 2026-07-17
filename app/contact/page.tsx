'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, MessageSquare, Send, CheckCircle2, Globe, Clock, ShieldCheck } from 'lucide-react';
import Logo from '@/components/Logo';

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
            <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
                <div className="max-w-md w-full bg-white rounded-[40px] p-12 shadow-2xl border border-gray-100 text-center animate-in fade-in zoom-in duration-500">
                    <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-8 border border-green-100">
                        <CheckCircle2 className="w-10 h-10 text-green-600" />
                    </div>
                    <h1 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">Message Received!</h1>
                    <p className="text-gray-600 mb-8 font-medium leading-relaxed">
                        Thank you for reaching out. A member of the runbutter.app team will get back to you at <strong>hello@runbutter.app</strong> within 24 hours.
                    </p>
                    <Link href="/" className="btn-primary w-full py-4 text-center">
                        Back to Home
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Navigation Header */}
            <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-2 hover:bg-gray-100 rounded-full transition">
                            <ArrowLeft className="w-5 h-5 text-gray-600" />
                        </Link>
                        <Logo />
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-16 lg:py-24">
                <div className="grid lg:grid-cols-2 gap-16 items-start">
                    {/* Left Side: Contact Info */}
                    <div className="space-y-12">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-[10px] font-black uppercase tracking-widest mb-6 border border-primary-200">
                                <Globe className="w-3 h-3" />
                                Global Support
                            </div>
                            <h1 className="text-5xl lg:text-6xl font-black text-gray-900 leading-tight mb-6">
                                Let&apos;s talk about <br />
                                <span className="text-primary-600">better hiring.</span>
                            </h1>
                            <p className="text-xl text-gray-600 font-medium leading-relaxed max-w-lg">
                                Whether you have a question about our pricing, features, or enterprise solutions, our team is ready to help.
                            </p>
                        </div>

                        <div className="space-y-6">
                            <div className="flex items-start gap-4 p-6 bg-white rounded-3xl border border-gray-100 shadow-sm">
                                <div className="w-12 h-12 bg-primary-50 rounded-2xl flex items-center justify-center text-primary-600 shrink-0">
                                    <Mail className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-black text-gray-900 uppercase text-xs tracking-widest mb-1">Email Us Directly</h3>
                                    <a href="mailto:hello@runbutter.app" className="text-lg font-bold text-primary-600 hover:underline">
                                        hello@runbutter.app
                                    </a>
                                </div>
                            </div>

                            <div className="flex items-start gap-4 p-6 bg-white rounded-3xl border border-gray-100 shadow-sm opacity-80">
                                <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 shrink-0">
                                    <Clock className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-black text-gray-900 uppercase text-xs tracking-widest mb-1">Response Time</h3>
                                    <p className="text-lg font-bold text-gray-700">Under 24 Hours</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-4 p-6 bg-white rounded-3xl border border-gray-100 shadow-sm opacity-80">
                                <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 shrink-0">
                                    <ShieldCheck className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-black text-gray-900 uppercase text-xs tracking-widest mb-1">Data Security</h3>
                                    <p className="text-lg font-bold text-gray-700">Privacy First Platform</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Side: Contact Form */}
                    <div className="bg-white rounded-[40px] p-8 md:p-12 shadow-2xl border border-gray-100 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary-50 rounded-bl-full -mr-10 -mt-10 opacity-50 transition-transform group-hover:scale-110 duration-700" />

                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center text-primary-600">
                                    <MessageSquare className="w-5 h-5" />
                                </div>
                                <h2 className="text-2xl font-black text-gray-900">Send a Message</h2>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-6">
                                <div className="grid md:grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Full Name</label>
                                        <input
                                            required
                                            name="name"
                                            type="text"
                                            placeholder="John Doe"
                                            className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all font-medium"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Work Email</label>
                                        <input
                                            required
                                            name="email"
                                            type="email"
                                            placeholder="john@company.com"
                                            className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all font-medium"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Subject</label>
                                    <select
                                        name="subject"
                                        className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all font-medium appearance-none cursor-pointer"
                                    >
                                        <option>Enterprise Query</option>
                                        <option>Technical Support</option>
                                        <option>General Question</option>
                                        <option>Demo Request</option>
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Message</label>
                                    <textarea
                                        required
                                        name="message"
                                        rows={5}
                                        placeholder="How can we help you scale your hiring?"
                                        className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all font-medium resize-none"
                                    />
                                </div>

                                {error && (
                                    <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl text-sm font-bold animate-in slide-in-from-top-2 duration-300">
                                        {error}
                                    </div>
                                )}

                                <button
                                    disabled={loading}
                                    type="submit"
                                    className="w-full btn-primary py-5 text-lg font-black flex items-center justify-center gap-3 shadow-[0_20px_40px_rgba(79,70,229,0.2)] hover:shadow-none transition-all disabled:opacity-50"
                                >
                                    {loading ? (
                                        <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            Send Message
                                            <Send className="w-5 h-5" />
                                        </>
                                    )}
                                </button>
                                <p className="text-center text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                                    By clicking send, you agree to our privacy policy.
                                </p>
                            </form>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
