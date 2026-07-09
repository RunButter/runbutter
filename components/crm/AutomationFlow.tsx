'use client';

import { Bolt, Radio, Clock, Filter, Webhook, Mail, FilePlus, PencilLine, Zap, ChevronRight } from 'lucide-react';
import type { Automation } from '@/lib/crm/automations';

// n8n-style visual flow for one automation: trigger → filter → action nodes on
// a dotted-grid canvas, connected by edges. Read view only — clicking any node
// opens the step builder. Dependency-free (no react-flow): our flows are
// linear chains, so plain flex + connectors render them faithfully.

const ACTION_META: Record<string, { label: string; icon: any }> = {
  send_webhook: { label: 'Send webhook', icon: Webhook },
  send_email: { label: 'Send email', icon: Mail },
  create_record: { label: 'Create record', icon: FilePlus },
  update_record: { label: 'Update record', icon: PencilLine },
};

const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1) : '');

function Node({ icon: Icon, title, sub, tone, ring, onClick }: {
  icon: any; title: string; sub?: string; tone: string; ring: string; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`shrink-0 text-left rounded-xl bg-white ring-1 ${ring} shadow-sm px-3 py-2 min-w-[130px] transition-all ${onClick ? 'hover:shadow-md hover:-translate-y-[1px] cursor-pointer' : 'cursor-default'}`}>
      <span className={`inline-flex w-6 h-6 rounded-md items-center justify-center mb-1 ${tone}`}><Icon className="w-3.5 h-3.5" /></span>
      <div className="text-[12px] font-bold text-slate-800 leading-tight">{title}</div>
      {sub && <div className="text-[11px] text-slate-400 leading-tight truncate max-w-[160px]">{sub}</div>}
    </button>
  );
}

function Edge() {
  return (
    <div className="shrink-0 flex items-center text-slate-300" aria-hidden="true">
      <span className="w-5 sm:w-8 h-px bg-slate-300" />
      <ChevronRight className="w-3.5 h-3.5 -ml-1.5" />
    </div>
  );
}

export default function AutomationFlow({ automation: a, onEdit }: { automation: Automation; onEdit?: () => void }) {
  const trigger = a.trigger_type === 'webhook'
    ? { icon: Radio, title: 'Webhook', sub: 'Incoming POST' }
    : a.trigger_type === 'schedule'
      ? { icon: Clock, title: 'Schedule', sub: `Every ${a.schedule?.every || 'day'}` }
      : { icon: Bolt, title: cap(a.object), sub: a.event === 'created' ? 'is created' : 'is updated' };

  return (
    <div className="mt-3 rounded-xl ring-1 ring-slate-200/60 bg-slate-50/80 [background-image:radial-gradient(#d3dce6_1px,transparent_1px)] [background-size:14px_14px] p-3.5 overflow-x-auto">
      <div className="flex items-center min-w-max">
        <Node icon={trigger.icon} title={trigger.title} sub={trigger.sub} tone="bg-amber-50 text-amber-600" ring="ring-amber-200/70" onClick={onEdit} />
        {a.conditions.length > 0 && (
          <>
            <Edge />
            <Node icon={Filter} title="Filter" sub={`${a.conditions.length} condition${a.conditions.length > 1 ? 's' : ''}`}
              tone="bg-slate-100 text-slate-500" ring="ring-slate-200/70" onClick={onEdit} />
          </>
        )}
        {(a.actions || []).map((ac, i) => {
          const m = ACTION_META[ac.type] || { label: ac.type, icon: Zap };
          const sub = ac.type === 'send_webhook' ? (ac.config?.label || 'Pick a connection')
            : ac.type === 'create_record' ? cap(ac.config?.object || 'record')
            : ac.type === 'send_email' ? (ac.config?.to || 'Recipient')
            : cap(a.object);
          return (
            <span key={i} className="flex items-center">
              <Edge />
              <Node icon={m.icon} title={m.label} sub={sub} tone="bg-primary-50 text-primary-600" ring="ring-primary-200/70" onClick={onEdit} />
            </span>
          );
        })}
        {(a.actions || []).length === 0 && (
          <>
            <Edge />
            <Node icon={Zap} title="No action yet" sub="Click to add one" tone="bg-slate-100 text-slate-400" ring="ring-slate-200/70" onClick={onEdit} />
          </>
        )}
      </div>
    </div>
  );
}
