import React, { createContext, useCallback, useContext, useState } from 'react';

export interface Toast {
  id: number;
  kind: 'ok' | 'err';
  msg: string;
}

const ToastCtx = createContext<{ push: (kind: Toast['kind'], msg: string) => void }>({ push: () => undefined });

export function useToasts(): { push: (kind: Toast['kind'], msg: string) => void } {
  return useContext(ToastCtx);
}

export function ToastHost({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, msg }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border bg-white px-4 py-2.5 text-sm shadow-lg"
            style={{ borderColor: t.kind === 'ok' ? '#5C8069' : '#B35B54' }}
          >
            <span className="mr-2">{t.kind === 'ok' ? '✓' : '⚠'}</span>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="card flex flex-col items-center gap-2 py-12 text-center">
      <div className="serif text-xl">{title}</div>
      {hint && <p className="max-w-md text-sm" style={{ color: '#84776D' }}>{hint}</p>}
      {action}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }): React.ReactElement {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="serif text-3xl">{value}</div>
      {sub && <div className="mt-1 text-xs" style={{ color: '#84776D' }}>{sub}</div>}
    </div>
  );
}

export function Field({ label, children, copy }: { label: string; children: React.ReactNode; copy?: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-xl border bg-white p-3" style={{ borderColor: '#E5DDD5' }}>
      <div className="mb-1 flex items-center justify-between">
        <span className="label !mb-0">{label}</span>
        {copy}
      </div>
      <div className="break-words text-sm">{children}</div>
    </div>
  );
}

export function CopyBtn({ onClick, small }: { onClick: () => void; small?: boolean }): React.ReactElement {
  return (
    <button type="button" className={`btn btn-ghost ${small ? '!px-2 !py-1 !text-xs' : ''}`} onClick={onClick} aria-label="Copy to clipboard">
      ⧉ Copy
    </button>
  );
}

export function StatusBadge({ state }: { state: string }): React.ReactElement {
  const cls = state === 'posted' ? 'badge-posted' : state === 'skipped' ? 'badge-skipped' : state === 'needs_review' || state === 'reviewed' ? 'badge-review' : 'badge-planned';
  return <span className={`badge ${cls}`}>{state.replace('_', ' ')}</span>;
}

export function Skeleton({ lines = 3 }: { lines?: number }): React.ReactElement {
  return (
    <div className="flex flex-col gap-2" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-xl" style={{ background: '#F0EBE5' }} />
      ))}
    </div>
  );
}
