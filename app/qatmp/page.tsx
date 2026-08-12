'use client';
import { useEffect, useState } from 'react';
import { renderEmail, DOC_PRESETS } from '@/lib/marketing/email-doc';
export default function QA() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  const ctx = (doc: any) => ({
    subject: 'S', preheader: 'A preheader',
    brand: { name: 'Acme', accent: '#4653CE', address: '1 Road, Warsaw' },
    content: { doc }, unsubscribeUrl: '#', trackLink: (u: string) => u,
  });
  return (
    <div className="p-4 bg-canvas grid grid-cols-4 gap-3">
      {DOC_PRESETS.filter(p => p.key !== 'blank').map((p) => (
        <div key={p.key}>
          <div className="text-2xs font-medium text-primary mb-1">{p.name}</div>
          <iframe title={p.key} srcDoc={m ? renderEmail('blocks', ctx(p.build('#4653CE'))) : ''}
            sandbox="" className="w-full h-[560px] border-0 rounded-lg ring-1 ring-subtle bg-white" />
        </div>
      ))}
    </div>
  );
}
