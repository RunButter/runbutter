'use client';
import { useEffect, useState } from 'react';
import { renderEmail, DOC_PRESETS } from '@/lib/marketing/email-doc';
const BRAND = { name: 'Klera', logoUrl: null, accent: '#4653CE', address: '1 Road, Warsaw', footer: null };
export default function QA() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  const html = (doc: any) => renderEmail('blocks', {
    subject: 'S', preheader: 'P', brand: BRAND, content: { doc },
    unsubscribeUrl: '#', trackLink: (u: string) => u });
  const show = ['feedback', 'announcement', 'event'];
  return (
    <div className="p-4 bg-canvas space-y-6">
      {DOC_PRESETS.filter(p => show.includes(p.key)).map((p) => (
        <div key={p.key}>
          <div className="text-xs font-medium text-primary mb-2">{p.name}</div>
          <div className="flex gap-4 items-start">
            <div><div className="text-3xs text-tertiary mb-1">desktop 700px</div>
              <iframe title={p.key+'d'} srcDoc={m ? html(p.build('#4653CE')) : ''} sandbox=""
                className="w-[700px] h-[820px] border-0 rounded-lg ring-1 ring-subtle bg-white" /></div>
            <div><div className="text-3xs text-tertiary mb-1">mobile 390px</div>
              <iframe title={p.key+'m'} srcDoc={m ? html(p.build('#4653CE')) : ''} sandbox=""
                className="w-[390px] h-[820px] border-0 rounded-lg ring-1 ring-subtle bg-white" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}
