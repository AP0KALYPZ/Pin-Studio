import { contextBridge, ipcRenderer } from 'electron';

// Allowlisted IPC surface. The renderer can never touch fs, tokens, or shell directly.
const CHANNELS = new Set([
  'app:state',
  'catalog:stats', 'catalog:importFolder',
  'products:list', 'products:get', 'products:update',
  'images:list', 'images:thumb', 'images:original', 'images:review', 'images:reviewFiltered', 'images:rebuildThumbs',
  'boards:list', 'boards:create', 'boards:delete',
  'schedule:settings:get', 'schedule:settings:set', 'schedule:preview', 'schedule:coverage', 'schedule:apply', 'schedule:undo',
  'schedule:list', 'schedule:move', 'schedule:lock', 'schedule:delete',
  'pins:get', 'pins:update', 'pins:autofill', 'pins:markPosted', 'pins:undoPosted', 'pins:skip', 'pins:restore',
  'ai:status', 'ai:setKey', 'ai:clearKey', 'ai:enhance',
  'desk:prepareImage', 'desk:copyImage', 'desk:copyText', 'desk:openPinterest', 'desk:reveal', 'desk:saveAs',
  'exports:pack', 'exports:revealDir',
  'backup:create', 'backup:list', 'backup:inspect', 'data:resetLibrary',
  'settings:get', 'settings:set',
  'shopify:status', 'shopify:connect', 'shopify:disconnect', 'shopify:sync',
  'dialog:pickFolder', 'activity:list', 'insights:get',
]);

export interface IpcResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

const api = {
  invoke<T = unknown>(channel: string, args?: unknown): Promise<IpcResult<T>> {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    return ipcRenderer.invoke(channel, args) as Promise<IpcResult<T>>;
  },
  onProgress(cb: (info: { msg: string; done?: number; total?: number }) => void): () => void {
    const listener = (_e: unknown, info: { msg: string; done?: number; total?: number }) => cb(info);
    ipcRenderer.on('shopify:progress', listener as (...a: unknown[]) => void);
    return () => ipcRenderer.removeListener('shopify:progress', listener as (...a: unknown[]) => void);
  },
};

export type BridgeApi = typeof api;

contextBridge.exposeInMainWorld('bpApi', api);
