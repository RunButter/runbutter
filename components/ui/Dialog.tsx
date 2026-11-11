'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import Button from '@/components/ui/Button';

// In-app confirm + notice dialogs, replacing window.confirm/alert (which render
// unstyled browser chrome and can't be themed). Promise-based so a call site is
// a one-line change:  if (!(await confirm({...}))) return;

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get the danger button + warning icon. */
  danger?: boolean;
}

interface DialogState extends ConfirmOptions {
  kind: 'confirm' | 'notice';
  resolve: (ok: boolean) => void;
}

// A bare string is accepted for brevity at call sites; destructive styling is
// the default for confirms since nearly all of ours are deletes.
type ConfirmArg = string | ConfirmOptions;
const norm = (a: ConfirmArg, danger: boolean): ConfirmOptions =>
  typeof a === 'string' ? { title: a, danger } : { danger, ...a };

interface DialogApi {
  confirm: (o: ConfirmArg) => Promise<boolean>;
  notify: (o: ConfirmArg) => Promise<boolean>;
}

const Ctx = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  // Graceful fallback if a component renders outside the provider.
  return {
    confirm: async (a) => { const o = norm(a, true); return window.confirm(`${o.title}${o.body ? `\n\n${o.body}` : ''}`); },
    notify: async (a) => { const o = norm(a, false); window.alert(`${o.title}${o.body ? `\n\n${o.body}` : ''}`); return true; },
  };
}

export default function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dlg, setDlg] = useState<DialogState | null>(null);

  const confirm = useCallback((a: ConfirmArg) =>
    new Promise<boolean>((resolve) => setDlg({ ...norm(a, true), kind: 'confirm', resolve })), []);
  const notify = useCallback((a: ConfirmArg) =>
    new Promise<boolean>((resolve) => setDlg({ ...norm(a, false), kind: 'notice', resolve })), []);

  const close = useCallback((ok: boolean) => {
    setDlg((d) => { d?.resolve(ok); return null; });
  }, []);

  // Esc cancels, Enter confirms — keyboard parity with the native dialogs.
  useEffect(() => {
    if (!dlg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Enter') { e.preventDefault(); close(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dlg, close]);

  return (
    <Ctx.Provider value={{ confirm, notify }}>
      {children}
      {dlg && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
          role="dialog" aria-modal="true" onClick={() => close(false)}>
          <div className="w-full max-w-sm bg-surface border border-subtle rounded-xl shadow-popover animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}>
            <div className="p-4 flex gap-3">
              <div className={`w-8 h-8 rounded-md shrink-0 flex items-center justify-center ${dlg.danger ? 'bg-danger/10' : 'bg-surface-hover'}`}>
                {dlg.danger ? <AlertTriangle className="w-4 h-4 text-danger" /> : <Info className="w-4 h-4 text-secondary" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium text-primary">{dlg.title}</h2>
                {dlg.body && <p className="mt-1 text-xs text-secondary leading-relaxed whitespace-pre-wrap">{dlg.body}</p>}
              </div>
              <button onClick={() => close(false)} aria-label="Close"
                className="p-1 -m-1 h-6 rounded-md text-tertiary hover:bg-surface-hover shrink-0"><X className="w-4 h-4" /></button>
            </div>
            <div className="h-12 flex items-center justify-end gap-2 px-4 border-t border-subtle">
              {dlg.kind === 'confirm' && (
                <Button variant="ghost" onClick={() => close(false)}>{dlg.cancelLabel || 'Cancel'}</Button>
              )}
              <Button variant={dlg.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
                {dlg.confirmLabel || (dlg.kind === 'notice' ? 'OK' : 'Confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
