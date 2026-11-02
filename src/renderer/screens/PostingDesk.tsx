import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, fmtDate, todayLocal } from '../lib/api';
import { CopyBtn, Empty, Skeleton, StatusBadge, useToasts } from '../components/ui';
import { TEMPLATES } from '../../shared/types';

interface Entry {
  entry_id: string;
  local_date: string;
  local_time: string;
  timezone: string;
  locked: number;
  id: string;
  product_id: string;
  product_image_id: string | null;
  title: string;
  description: string;
  alt_text: string | null;
  destination_url: string;
  board_name: string;
  template_id: string;
  posting_state: string;
  image_order: number;
  source_path: string | null;
  local_pin_id?: string;
}

export default function PostingDesk({ go }: { go: (s: string) => void }): React.ReactElement {
  const [date, setDate] = useState(todayLocal());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [renderPath, setRenderPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [showPacket, setShowPacket] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);
  const [pinUrl, setPinUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [form, setForm] = useState({ title: '', description: '', alt_text: '', destination_url: '', board_name: '', template_id: 'original' });
  const [boards, setBoards] = useState<Array<{ name: string }>>([]);
  const [suggestion, setSuggestion] = useState<{ title: string; description: string; model: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const selRef = useRef<string | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const { push } = useToasts();

  const load = useCallback(async (d: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await call<{ entries: Entry[] }>('schedule:list', { from: d, to: d });
      setEntries(r.entries);
      setSelectedId((prev) => (r.entries.some((e) => e.id === prev) ? prev : (r.entries[0]?.id ?? null)));
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  useEffect(() => {
    call<Array<{ name: string }>>('boards:list').then(setBoards).catch(() => undefined);
  }, []);

  const selected = useMemo(() => entries.find((e) => e.id === selectedId) ?? null, [entries, selectedId]);

  // Auto-grow the description box to fit all text (falls back to scroll past 60vh).
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [form.description, selectedId]);

  // Load the rendered preview for the selected pin (stale-guard by pin id).
  useEffect(() => {
    selRef.current = selected?.id ?? null;
    setImageUrl(null);
    setRenderPath(null);
    setCopied({});
    setShowPacket(false);
    if (!selected) return;
    let alive = true;
    (async () => {
      try {
        const prep = await call<{ path: string }>('desk:prepareImage', { pinId: selected.id });
        if (!alive || selRef.current !== selected.id) return; // stale response — ignore
        setRenderPath(prep.path);
        const orig = await call<{ dataUrl: string | null }>('images:original', { id: selected.product_image_id ?? '' });
        if (!alive || selRef.current !== selected.id) return;
        setImageUrl(orig.dataUrl);
      } catch (e) {
        if (alive) push('err', e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected, push]);

  // Keep the edit form in sync with the selected pin (resets on switch or reload).
  useEffect(() => {
    if (selected) {
      setForm({
        title: selected.title,
        description: selected.description,
        alt_text: selected.alt_text ?? '',
        destination_url: selected.destination_url,
        board_name: selected.board_name,
        template_id: selected.template_id,
      });
    }
    setSuggestion(null);
  }, [selected]);

  const readOnly = !!selected && selected.posting_state === 'posted';

  async function saveForm(patch: Record<string, unknown>): Promise<void> {
    if (!selected || selected.posting_state === 'posted') return;
    const cur = selected as unknown as Record<string, unknown>;
    const changed = Object.entries(patch).some(([k, v]) => String(cur[k] ?? '') !== String(v ?? ''));
    if (!changed) return; // blur without edits: don't bump the revision
    try {
      await call('pins:update', { id: selected.id, patch });
      await load(date, true);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function enhance(): Promise<void> {
    if (!selected || selected.posting_state === 'posted') return;
    setAiBusy(true);
    setSuggestion(null);
    try {
      const st = await call<{ hasKey: boolean }>('ai:status').catch(() => ({ hasKey: false }));
      if (!st.hasKey) {
        push('err', 'No OpenAI API key yet — add it in Settings → AI copy first (Plus subscription alone is not enough).');
        return;
      }
      const r = await call<{ title: string; description: string; model: string }>('ai:enhance', { pinId: selected.id });
      setSuggestion(r);
      push('ok', `AI suggestions ready (${r.model}) — review below, nothing auto-saved.`);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  async function applySuggestion(which: 'title' | 'description' | 'both'): Promise<void> {
    if (!suggestion) return;
    await saveForm(which === 'both' ? { title: suggestion.title, description: suggestion.description } : { [which]: suggestion[which] });
    setSuggestion(null);
  }

  async function copyText(field: string, text: string, label: string): Promise<void> {
    if (!selected) return;
    try {
      await call('desk:copyText', { pinId: selected.id, field, text });
      setCopied((c) => ({ ...c, [field]: true }));
      push('ok', `${label} copied`);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function copyImage(): Promise<void> {
    if (!selected) return;
    try {
      await call('desk:copyImage', { pinId: selected.id });
      setCopied((c) => ({ ...c, image: true }));
      push('ok', 'Image copied (pixels on clipboard)');
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  function packetText(): string {
    if (!selected) return '';
    return [`Title: ${form.title}`, '', `Description: ${form.description}`, '', `Product link: ${form.destination_url}`, '', `Board: ${form.board_name}`, form.alt_text ? `\nAlt text: ${form.alt_text}` : '', `\nScheduled: ${selected.local_date} ${selected.local_time} (${selected.timezone})`].join('\n');
  }

  async function doMarkPosted(): Promise<void> {
    if (!selected) return;
    try {
      await call('pins:markPosted', { id: selected.id, pinUrl: pinUrl.trim() || undefined, notes: notes.trim() || undefined });
      push('ok', 'Marked Posted — nice work!');
      setConfirmPost(false);
      setPinUrl('');
      setNotes('');
      await load(date);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  async function doSkip(restore: boolean): Promise<void> {
    if (!selected) return;
    try {
      if (restore) await call('pins:restore', { id: selected.id });
      else await call('pins:skip', { id: selected.id });
      push('ok', restore ? 'Pin restored to planned' : 'Pin skipped');
      await load(date);
    } catch (e) {
      push('err', e instanceof Error ? e.message : String(e));
    }
  }

  // Keyboard shortcuts: 1..5 copy, N next. Disabled in text fields.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (!selected) return;
      if (e.key === '1') void copyImage();
      else if (e.key === '2') void copyText('title', form.title, 'Title');
      else if (e.key === '3') void copyText('description', form.description, 'Description');
      else if (e.key === '4') void copyText('link', form.destination_url, 'Product link');
      else if (e.key === '5') void copyText('board', form.board_name, 'Board name');
      else if (e.key === 'n' || e.key === 'N') nextPin();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  function nextPin(): void {
    if (!entries.length) return;
    const i = entries.findIndex((e) => e.id === selectedId);
    const nxt = entries[(i + 1) % entries.length];
    setSelectedId(nxt.id);
  }

  function shiftDay(delta: number): void {
    const [y, m, d] = date.split('-').map(Number);
    const t = new Date(y, m - 1, d + delta);
    setDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);
  }

  if (loading) return <Skeleton lines={5} />;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl">Today's Pins</h1>
          <p className="text-sm" style={{ color: '#84776D' }}>Post manually in your browser — nothing here publishes automatically.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => shiftDay(-1)} aria-label="Previous day">◀</button>
          <input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Posting date" />
          <button type="button" className="btn btn-ghost" onClick={() => shiftDay(1)} aria-label="Next day">▶</button>
          <button type="button" className="btn btn-ghost" onClick={() => setDate(todayLocal())}>Today</button>
        </div>
      </div>

      {entries.length === 0 ? (
        <Empty
          title={`No Pins planned for ${fmtDate(date)}`}
          hint="Late pins stay listed on their own day — nothing is auto-published or lost. Generate a plan in Calendar or pick another date."
          action={<div className="flex gap-2"><button type="button" className="btn btn-clay" onClick={() => go('calendar')}>Go to Calendar</button><button type="button" className="btn btn-ghost" onClick={() => go('calendar')}>Generate Drafts</button></div>}
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)_400px]">
          {/* Queue */}
          <div className="card min-h-0 !p-3 lg:flex lg:flex-col lg:overflow-hidden">
            <div className="label px-1">Queue — {fmtDate(date)} ({entries.length})</div>
            <ul className="flex max-h-[60vh] flex-col gap-2 overflow-auto scroll-thin lg:max-h-none lg:min-h-0 lg:flex-1">
              {entries.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(e.id)}
                    aria-label={`Select pin ${e.local_time} ${e.title}`}
                    className="flex w-full items-center gap-2 rounded-xl border p-2 text-left"
                    style={{ borderColor: e.id === selectedId ? '#B48E78' : '#E5DDD5', background: e.id === selectedId ? '#F0EBE5' : '#fff' }}
                  >
                    <QueueThumb imageId={e.product_image_id} />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold">{e.local_time} · {e.posting_state.replace('_', ' ')}</span>
                      <span className="block truncate text-xs" style={{ color: '#84776D' }}>{e.title}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Preview */}
          <div className="card flex min-h-0 flex-col items-center gap-3 lg:overflow-auto">
            {selected && <p className="text-xs" style={{ color: '#84776D' }}>{selected.title}</p>}
            {selected ? (
              <>
                {imageUrl ? (
                  <img src={imageUrl} alt={selected.alt_text ?? selected.title} className="max-h-[58vh] rounded-xl border object-contain" style={{ borderColor: '#E5DDD5', aspectRatio: '2/3' }} />
                ) : (
                  <div className="flex h-64 w-full items-center justify-center rounded-xl" style={{ background: '#F0EBE5' }}><span className="text-sm" style={{ color: '#84776D' }}>Preparing preview…</span></div>
                )}
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn btn-primary" onClick={copyImage} title="Shortcut: 1">Copy Image</button>
                  <button type="button" className="btn btn-ghost" onClick={async () => { try { await call('desk:prepareImage', { pinId: selected.id }); push('ok', 'Image ready'); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Prepare Image</button>
                  <button type="button" className="btn btn-ghost" disabled={!renderPath} onClick={async () => { try { const r = await call<{ path: string }>('desk:saveAs', { pinId: selected.id }); if (r.path) push('ok', `File saved to ${r.path}`); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Save As…</button>
                  <button type="button" className="btn btn-ghost" disabled={!renderPath} onClick={async () => { try { await call('desk:reveal', { filePath: renderPath }); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Reveal File</button>
                  <button type="button" className="btn btn-ghost" disabled={!renderPath} onClick={() => copyText('path', renderPath ?? '', 'File path')} title="Copy the file path as text (different from Copy Image)">Copy File Path</button>
                </div>
                {renderPath && <p className="max-w-full truncate text-xs" style={{ color: '#84776D' }} title={renderPath}>{renderPath}</p>}
              </>
            ) : <p>Select a pin.</p>}
          </div>

          {/* Pin editor + Copy Desk */}
          <div className="card flex min-h-0 flex-col gap-3 overflow-auto scroll-thin">
            {selected ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{selected.local_time} · {selected.timezone}</span>
                  <StatusBadge state={selected.posting_state} />
                </div>
                {readOnly && <p className="text-xs" style={{ color: '#84776D' }}>Posted pins are read-only history — text is shown for copying only.</p>}
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="label !mb-0" htmlFor="desk-board">Board</label>
                    <CopyBtn small onClick={() => copyText('board', form.board_name, 'Board name')} />
                  </div>
                  <input id="desk-board" className="input" list="desk-board-list" value={form.board_name} disabled={readOnly} onChange={(e) => setForm({ ...form, board_name: e.target.value })} onBlur={() => saveForm({ board_name: form.board_name })} />
                  <datalist id="desk-board-list">{boards.map((b) => <option key={b.name} value={b.name} />)}</datalist>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="label !mb-0" htmlFor="desk-title">Title ({form.title.length}/100)</label>
                    <CopyBtn small onClick={() => copyText('title', form.title, 'Title')} />
                  </div>
                  <input id="desk-title" className="input" value={form.title} disabled={readOnly} onChange={(e) => setForm({ ...form, title: e.target.value })} onBlur={() => saveForm({ title: form.title })} />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="label !mb-0" htmlFor="desk-desc">Description ({form.description.length}/800)</label>
                    <CopyBtn small onClick={() => copyText('description', form.description, 'Description')} />
                  </div>
                  <textarea id="desk-desc" ref={descRef} className="textarea" rows={14} style={{ minHeight: '300px', maxHeight: '60vh', overflowY: 'auto' }} value={form.description} disabled={readOnly} onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => saveForm({ description: form.description })} />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="label !mb-0" htmlFor="desk-link">Product link</label>
                    <CopyBtn small onClick={() => copyText('link', form.destination_url, 'Product link')} />
                  </div>
                  <input id="desk-link" className="input break-all" value={form.destination_url} disabled={readOnly} onChange={(e) => setForm({ ...form, destination_url: e.target.value })} onBlur={() => saveForm({ destination_url: form.destination_url })} />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="label !mb-0" htmlFor="desk-alt">Alt text</label>
                    {form.alt_text && <CopyBtn small onClick={() => copyText('alt', form.alt_text, 'Alt text')} />}
                  </div>
                  <input id="desk-alt" className="input" placeholder="No alt text — optional." value={form.alt_text} disabled={readOnly} onChange={(e) => setForm({ ...form, alt_text: e.target.value })} onBlur={() => saveForm({ alt_text: form.alt_text })} />
                </div>
                <div>
                  <span className="label">Template (1000×1500 output)</span>
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATES.map((t) => (
                      <button key={t.id} type="button" disabled={readOnly} className={`btn ${form.template_id === t.id ? 'btn-primary' : 'btn-ghost'} !px-2 !py-1 !text-xs`} title={t.description} onClick={() => { setForm({ ...form, template_id: t.id }); void saveForm({ template_id: t.id }); }}>{t.name}</button>
                    ))}
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-clay" disabled={aiBusy} onClick={enhance} title="Generate SEO title + description with your OpenAI key. Suggestion only — you choose what to keep.">{aiBusy ? 'AI is writing…' : '✨ AI Enhance'}</button>
                    <button type="button" className="btn btn-ghost" onClick={async () => { try { await call('pins:autofill', { id: selected.id }); push('ok', 'Text regenerated from Shopify facts only'); await load(date, true); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Auto Fill Text</button>
                  </div>
                )}
                {suggestion && (
                  <div className="rounded-xl border p-3" style={{ borderColor: '#B48E78', background: '#faf3e3' }}>
                    <p className="mb-1 text-sm font-semibold">AI suggestion ({suggestion.model}) — review before keeping</p>
                    <p className="text-sm"><strong>Title ({suggestion.title.length}/100):</strong> {suggestion.title}</p>
                    <p className="mt-1 text-sm"><strong>Description ({suggestion.description.length}/800):</strong> {suggestion.description}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-primary !px-2 !py-1 !text-xs" onClick={() => applySuggestion('both')}>Use both</button>
                      <button type="button" className="btn btn-ghost !px-2 !py-1 !text-xs" onClick={() => applySuggestion('title')}>Use title only</button>
                      <button type="button" className="btn btn-ghost !px-2 !py-1 !text-xs" onClick={() => applySuggestion('description')}>Use description only</button>
                      <button type="button" className="btn btn-danger !px-2 !py-1 !text-xs" onClick={() => setSuggestion(null)}>Discard</button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-ghost" onClick={() => setShowPacket((s) => !s)}>{showPacket ? 'Hide packet' : 'Preview packet'}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => copyText('all', packetText(), 'Posting packet')}>Copy All Text</button>
                  <button type="button" className="btn btn-ghost" onClick={async () => { try { await call('desk:openPinterest'); push('ok', 'Pinterest opened in your browser — upload & publish there'); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Open Pinterest</button>
                </div>
                {showPacket && <pre className="whitespace-pre-wrap rounded-xl border p-3 text-xs" style={{ borderColor: '#E5DDD5', background: '#F7F4F0' }}>{packetText()}</pre>}

                <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#E5DDD5' }} aria-label="Posting checklist">
                  <div className="label">Checklist (local only)</div>
                  <ChecklistItem done={!!copied.image} label="Image ready / copied" />
                  <ChecklistItem done={!!copied.title} label="Title copied" />
                  <ChecklistItem done={!!copied.description} label="Description copied" />
                  <ChecklistItem done={!!copied.link} label="Link copied" />
                </div>
                <p className="text-xs" style={{ color: '#84776D' }}>Shortcuts: 1 image · 2 title · 3 description · 4 link · 5 board · N next pin</p>

                <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: '#E5DDD5' }}>
                  {selected.posting_state === 'posted' ? (
                    <button type="button" className="btn btn-ghost" onClick={async () => { try { await call('pins:undoPosted', { id: selected.id }); push('ok', 'Posting undone'); await load(date); } catch (e) { push('err', e instanceof Error ? e.message : String(e)); } }}>Undo Posted</button>
                  ) : (
                    <button type="button" className="btn btn-clay" onClick={() => setConfirmPost(true)}>✓ Mark Posted</button>
                  )}
                  {selected.posting_state === 'skipped'
                    ? <button type="button" className="btn btn-ghost" onClick={() => doSkip(true)}>Restore</button>
                    : selected.posting_state !== 'posted' && <button type="button" className="btn btn-danger" onClick={() => doSkip(false)}>Skip</button>}
                  <button type="button" className="btn btn-primary" onClick={nextPin} title="Shortcut: N">Next Pin →</button>
                </div>
              </>
            ) : <p>Select a pin.</p>}
          </div>
        </div>
      )}

      {confirmPost && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true" aria-label="Confirm posted">
          <div className="card w-full max-w-md">
            <h2 className="mb-2 text-xl">Mark as Posted?</h2>
            <p className="mb-3 text-sm" style={{ color: '#84776D' }}>Only confirm if you personally published this Pin on Pinterest just now. Copying, exporting or opening Pinterest never marks it posted.</p>
            <label className="label" htmlFor="pinurl">Pinterest Pin URL (optional)</label>
            <input id="pinurl" className="input mb-2" placeholder="https://www.pinterest.com/pin/…" value={pinUrl} onChange={(e) => setPinUrl(e.target.value)} />
            <label className="label" htmlFor="postnotes">Notes (optional)</label>
            <textarea id="postnotes" className="textarea mb-3" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmPost(false)}>Cancel</button>
              <button type="button" className="btn btn-clay" onClick={doMarkPosted}>Confirm Posted</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }): React.ReactElement {
  return <div className="flex items-center gap-2 py-0.5"><span aria-hidden>{done ? '☑' : '☐'}</span><span style={{ color: done ? '#3c6047' : '#84776D' }}>{label}</span></div>;
}

function QueueThumb({ imageId }: { imageId: string | null }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imageId) return;
    let alive = true;
    call<{ dataUrl: string | null }>('images:thumb', { id: imageId }).then((r) => {
      if (alive) setUrl(r.dataUrl);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [imageId]);
  if (!url) return <span className="h-12 w-9 shrink-0 rounded" style={{ background: '#F0EBE5' }} />;
  return <img src={url} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />;
}
