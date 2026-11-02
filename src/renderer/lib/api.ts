// Typed wrapper around the preload bridge. Inside Electron every call goes to
// the main process. In a plain browser dev server (no bridge) we fall back to
// the DEV-only in-browser mock so the UI can be previewed end to end.

export interface IpcResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

declare global {
  interface Window {
    bpApi?: {
      invoke<T = unknown>(channel: string, args?: unknown): Promise<IpcResult<T>>;
      onProgress(cb: (info: { msg: string; done?: number; total?: number }) => void): () => void;
    };
  }
}

export async function call<T>(channel: string, args?: unknown): Promise<T> {
  if (!window.bpApi) {
    // Lazy import keeps the mock out of the production desktop bundle path.
    const m = await import('./mockBridge');
    const res = await m.mockInvoke(channel, args);
    if (!res.ok) throw new Error(res.error || 'Request failed.');
    return res.data as T;
  }
  const res = await window.bpApi.invoke<T>(channel, args);
  if (!res.ok) throw new Error(res.error || 'Request failed.');
  return res.data as T;
}

export function onSyncProgress(cb: (info: { msg: string; done?: number; total?: number }) => void): () => void {
  if (!window.bpApi) return () => undefined;
  return window.bpApi.onProgress(cb);
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
