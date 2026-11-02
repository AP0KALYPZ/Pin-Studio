import React, { useEffect, useState } from 'react';
import { ToastHost } from './components/ui';
import Overview from './screens/Overview';
import PostingDesk from './screens/PostingDesk';
import { Library, Products } from './screens/Catalog';
import Calendar from './screens/Calendar';
import { Exports } from './screens/Studio';
import { Insights, Settings } from './screens/Manage';

const NAV = [
  { id: 'overview', label: 'Overview', icon: '✦' },
  { id: 'today', label: "Today's Pins", icon: '📌' },
  { id: 'products', label: 'Products', icon: '🛍' },
  { id: 'library', label: 'Image Library', icon: '🖼' },
  { id: 'calendar', label: 'Calendar', icon: '🗓' },
  { id: 'exports', label: 'Exports', icon: '📦' },
  { id: 'insights', label: 'Insights', icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
] as const;

type Screen = (typeof NAV)[number]['id'];

export default function App(): React.ReactElement {
  const [screen, setScreen] = useState<Screen>('today');
  const [collapsed, setCollapsed] = useState(false);
  const [bridgeMissing, setBridgeMissing] = useState(false);

  useEffect(() => {
    if (!window.bpApi) setBridgeMissing(true);
  }, []);

  function go(s: string): void {
    setScreen(s as Screen);
  }

  return (
    <ToastHost>
      <div className="flex h-screen overflow-hidden">
        <aside className="flex shrink-0 flex-col border-r bg-white transition-all" style={{ width: collapsed ? 72 : 224, borderColor: '#E5DDD5' }} aria-label="Main navigation">
          <div className="flex items-center justify-between px-4 py-4">
            {!collapsed && <div><div className="serif text-lg font-bold">Pin Studio</div><div className="text-[11px] uppercase tracking-widest" style={{ color: '#84776D' }}>Manual posting desk</div></div>}
            <button type="button" className="btn btn-ghost !px-2 !py-1" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? '»' : '«'}</button>
          </div>
          <nav className="flex flex-1 flex-col gap-1 overflow-auto px-2 scroll-thin">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setScreen(n.id)}
                aria-current={screen === n.id ? 'page' : undefined}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium"
                style={{ background: screen === n.id ? '#453A35' : 'transparent', color: screen === n.id ? '#F7F4F0' : '#302925' }}
                title={n.label}
              >
                <span aria-hidden>{n.icon}</span>
                {!collapsed && <span>{n.label}</span>}
                {n.id === 'today' && !collapsed && <span className="ml-auto rounded-full px-2 text-[11px]" style={{ background: screen === 'today' ? '#B48E78' : '#F0EBE5' }}>★</span>}
              </button>
            ))}
          </nav>
          {!collapsed && <div className="p-3 text-[11px] leading-snug" style={{ color: '#84776D' }}>Manual posting only.<br />No Pinterest API.</div>}
        </aside>

        <main className="min-w-0 flex-1 overflow-auto scroll-thin p-6" style={{ minWidth: 0 }}>
          {bridgeMissing && (
            <div className="mb-4 rounded-xl border px-4 py-2 text-sm" style={{ borderColor: '#B35B54', background: '#f3e2e1' }} role="alert">
              BROWSER PREVIEW — running without the desktop app. Shopify sync, image copy, and file access need the installed Electron app.
            </div>
          )}
          {screen === 'overview' && <Overview go={go} />}
          {screen === 'today' && <PostingDesk go={go} />}
          {screen === 'products' && <Products go={go} />}
          {screen === 'library' && <Library />}
          {screen === 'calendar' && <Calendar go={go} />}
          {screen === 'exports' && <Exports />}
          {screen === 'insights' && <Insights />}
          {screen === 'settings' && <Settings go={go} />}
        </main>
      </div>
    </ToastHost>
  );
}
