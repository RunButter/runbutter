'use client';

import { useState } from 'react';
import { getAccessToken } from '@privy-io/react-auth';
import { Sparkles, Check, AlertTriangle, ArrowRight, Table2 } from 'lucide-react';
import { saveCustomObject, saveCustomField } from '@/lib/crm/custom';
import { describeField, type Blueprint } from '@/lib/workspace/blueprint';
import { WORKSPACE_TEMPLATES } from '@/lib/workspace/templates';
import { iconFor } from '@/lib/crm/object-icons';
import Button from '@/components/ui/Button';

/**
 * Describe a business, get a workspace.
 *
 * TWO WAYS IN, BOTH ENDING IN THE SAME REVIEW. A template is instant, free and
 * identical every time; the AI reads a sentence and needs the workspace's own
 * key. Both produce a Blueprint, and NEITHER creates anything until someone has
 * read the plan and pressed the button.
 *
 * That review step is the security model, not politeness: the description is
 * untrusted text and so is anything a model does with it, so the plan is
 * re-validated against the same whitelist the database enforces and then shown
 * to a person. The worst a prompt injection achieves is a silly plan somebody
 * declines.
 *
 * Applying is a loop of ordinary save_custom_object / save_custom_field calls —
 * the same ones the manual builder uses, with the same owner/admin check in
 * SQL. There is no privileged bulk path, because a bulk path is a second place
 * for the rules to be got wrong.
 */
export default function WorkspaceBuilder({ privy, ws, onApplied }: {
  privy: string | null; ws: string | null; onApplied: () => void;
}) {
  const [plan, setPlan] = useState<Blueprint | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState('');

  const apply = async () => {
    if (!privy || !ws || !plan) return;
    setApplying(true); setError('');
    const failures: string[] = [];

    for (const o of plan.objects) {
      setProgress(o.plural);
      const { id, error } = await saveCustomObject(privy, ws, {
        slug: o.slug, singular: o.singular, plural: o.plural,
        icon: o.icon, group_key: o.group, description: o.description,
      });
      if (error || !id) { failures.push(`${o.plural}: ${error || 'could not be created'}`); continue; }

      // Sequential, not Promise.all: save_custom_field demotes the other
      // primaries when one is set, so two landing at once can leave the object
      // with none — and position is assigned from the current max.
      for (let i = 0; i < o.fields.length; i++) {
        const f = o.fields[i];
        const r = await saveCustomField(privy, ws, id, {
          key: f.key, label: f.label, type: f.type,
          options: f.options ?? [], relation_to: f.relation_to ?? null,
          required: f.required ?? false, is_primary: f.primary ?? false,
          position: i + 1,
        });
        if (r.error) failures.push(`${o.plural} → ${f.label}: ${r.error}`);
      }
    }

    setApplying(false); setProgress('');
    // Partial success is reported as partial. Everything that DID land is real
    // and stays, so "it failed" would be a lie and a silent success would hide
    // a missing field until someone went looking for it.
    if (failures.length) setError(`Created what it could. These did not apply:\n${failures.join('\n')}`);
    else setPlan(null);
    onApplied();
  };

  return (
    <section className="card-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-subtle flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent shrink-0" />
        <h3 className="text-sm font-medium text-primary">Start from a trade</h3>
      </div>

      <div className="p-4 space-y-3">
        {/* THE AI INPUT WAS REMOVED, NOT THE FEATURE UNDER IT.
            "Describe your business, get a plan" is the copilot's job now — it
            has propose_object, it can ask a follow-up, and it already knows
            which objects exist, which this box never did. One AI box per
            product beats one per screen: five of them is five prompts to keep
            current and five places to look when an answer is wrong.

            What stays is everything the TEMPLATES need, and that is not a
            courtesy — a template sets exactly the same `plan` state the AI used
            to, so deleting the preview and its Apply button would have silently
            broken all ten while leaving the buttons on screen. Removing an AI
            field is not the same as removing the machinery behind it. */}
        <p className="text-xs text-secondary">
          Ten ready-made shapes for common trades. Pick one to see what it would add — nothing is
          created until you say so. For anything else, ask the copilot.
        </p>


        {error && (
          <div className="rounded-lg bg-danger/10 text-danger px-3 py-2 text-xs whitespace-pre-wrap">{error}</div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-lg bg-warning/10 text-warning px-3 py-2 text-2xs space-y-0.5">
            {warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />{w}
              </p>
            ))}
          </div>
        )}

        {plan && (
          <div className="rounded-lg ring-1 ring-subtle bg-surface-sunken p-3 space-y-3">
            <p className="text-xs text-secondary">{plan.summary}</p>
            {plan.objects.map((o) => (
              <div key={o.slug} className="rounded-lg bg-surface ring-1 ring-subtle p-3">
                <div className="flex items-center gap-2">
                  <Table2 className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="text-sm font-medium text-primary truncate">{o.plural}</span>
                  <span className="text-2xs font-mono text-tertiary truncate">/{o.slug}</span>
                  <span className="text-2xs text-tertiary ml-auto shrink-0">{o.fields.length} fields</span>
                </div>
                <ul className="mt-2 space-y-0.5">
                  {o.fields.map((f) => (
                    <li key={f.key} className="flex items-baseline gap-2 text-2xs">
                      <span className="text-secondary min-w-0 truncate">{f.label}</span>
                      {f.primary && <span className="text-accent shrink-0">headline</span>}
                      <span className="text-tertiary ml-auto shrink-0 truncate max-w-[14rem]">{describeField(f)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={apply} disabled={applying}>
                <Check className="w-3.5 h-3.5" /> {applying ? `Creating ${progress}…` : 'Create these'}
              </Button>
              <Button variant="ghost" onClick={() => setPlan(null)}>Discard</Button>
              <span className="text-2xs text-tertiary">You can edit everything afterwards.</span>
            </div>
          </div>
        )}

        {/* Templates are not a fallback for the AI — they are the version that
            works with no key, on the free plan, identically every time. */}
        <div className="pt-3 border-t border-subtle">
          <p className="text-2xs text-tertiary mb-2">Or start from a trade:</p>
          <div className="flex flex-wrap gap-1.5">
            {WORKSPACE_TEMPLATES.map((t) => {
              const Icon = iconFor(t.icon);
              return (
                <button key={t.id}
                  onClick={() => { setPlan(t.blueprint); setWarnings([]); setError(''); }}
                  title={t.audience}
                  className="h-7 px-2.5 rounded-full ring-1 ring-subtle text-2xs text-secondary hover:bg-surface-hover hover:text-primary inline-flex items-center gap-1.5">
                  <Icon className="w-3 h-3 shrink-0" /> {t.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
