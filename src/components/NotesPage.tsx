import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { useCloud } from '../lib/cloud';

const firstLine = (t: string) => t.split('\n').find((l) => l.trim())?.trim() ?? '';
const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

export function NotesPage() {
  const notes = useStore((s) => s.notes);
  const activeNote = useStore((s) => s.ui.activeNote);
  const { addNote, updateNote, deleteNote, setUI } = useStore();
  const cloud = useCloud();
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...notes]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((n) => !s || n.title.toLowerCase().includes(s) || n.text.toLowerCase().includes(s));
  }, [notes, q]);
  const current = notes.find((n) => n.id === activeNote) ?? list[0] ?? null;

  const create = () => setUI({ activeNote: addNote() });

  let cloudText: JSX.Element;
  if (!cloud.connected) {
    cloudText = (
      <>
        Saved in this browser.{' '}
        <button className="link" onClick={() => setUI({ settingsOpen: true, settingsTab: 'sync' })}>
          Turn on auto-save
        </button>{' '}
        to also keep notes safe on GitHub.
      </>
    );
  } else if (cloud.state === 'saved') cloudText = <>Saved in this browser and on GitHub ✓</>;
  else if (cloud.state === 'error' || cloud.state === 'offline') cloudText = <>Saved in this browser. GitHub save failed: {cloud.message ?? 'offline'}. It will retry.</>;
  else cloudText = <>Saved in this browser. Saving to GitHub…</>;

  return (
    <div className="notes-page">
      <aside className="notes-list">
        <div className="row">
          <button className="btn primary" onClick={create}>
            + New note
          </button>
          <input className="search" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="notes-items">
          {list.map((n) => (
            <button key={n.id} className={'note-item' + (current?.id === n.id ? ' active' : '')} onClick={() => setUI({ activeNote: n.id })}>
              <div className="note-item-title">{n.title.trim() || firstLine(n.text) || 'Untitled note'}</div>
              <div className="note-item-meta">
                <span>{when(n.updatedAt)}</span>
                <span className="note-item-preview">{n.title.trim() ? firstLine(n.text) : ''}</span>
              </div>
            </button>
          ))}
          {!list.length && <div className="muted small pad">{notes.length ? 'No notes match.' : 'No notes yet.'}</div>}
        </div>
      </aside>
      <section className="note-editor">
        {current ? (
          <>
            <div className="row">
              <input
                className="note-title"
                placeholder="Title"
                value={current.title}
                onChange={(e) => updateNote(current.id, { title: e.target.value })}
              />
              <button
                className="btn small"
                onClick={() => {
                  if (confirm(`Delete “${current.title.trim() || firstLine(current.text) || 'Untitled note'}”? This can’t be undone.`)) {
                    deleteNote(current.id);
                    setUI({ activeNote: null });
                  }
                }}
              >
                Delete
              </button>
            </div>
            <textarea
              className="note-text"
              placeholder="Write anything: what to build next, node locations, hard drive choices, train routes…"
              value={current.text}
              onChange={(e) => updateNote(current.id, { text: e.target.value })}
              autoFocus={!current.text}
            />
            <div className="small muted note-status">
              {cloudText} <span className="spacer" /> Edited {new Date(current.updatedAt).toLocaleString()}
            </div>
          </>
        ) : (
          <div className="empty-notes">
            <h2>Notes</h2>
            <p className="muted">Keep plans, coordinates, to-do lists, anything. Notes save as you type.</p>
            <button className="btn primary" onClick={create}>
              + New note
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
