/** ワークスペース画面: 上部バー・ノート一覧・ノート表示 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { HOST_LOCKED } from '../config/defaults';
import { repoToString, type RepoRef } from '../config/repo';
import { createNote, getWorkspace, listNotes, type Category, type NoteSummary } from '../github/api';
import type { GitHubClient } from '../github/client';
import { ja } from '../i18n/ja';
import { formatShort, formatTime } from './datetime';
import { ErrorMessage } from './ErrorMessage';
import { useAsync } from './hooks';
import { NoteView } from './NoteView';
import { listConnections, rememberWorkspace } from './prefs';
import { newNoteBody } from '../outline/edit';
import { formatRoute } from './route';
import { WorkspacePicker } from './WorkspacePicker';

const t = ja.app;

export function Workspace(props: { client: GitHubClient; repo: RepoRef; number: number | null; onManageConnections: () => void }) {
  const { client, repo } = props;
  const host = client.connection.host;
  const repoKey = `${host}/${repoToString(repo)}`.toLowerCase();
  const [reloadKey, setReloadKey] = useState(0);
  const [listKey, setListKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const ws = useAsync(() => getWorkspace(client, repo), [client, repoKey]);
  const notes = useAsync(() => listNotes(client, repo), [client, repoKey, reloadKey, listKey]);

  useEffect(() => {
    if (ws.status === 'ok' && ws.data?.hasDiscussionsEnabled) rememberWorkspace(host, ws.data.nameWithOwner);
  }, [ws, host]);

  if (ws.status === 'ok' && !ws.data) return <WorkspacePicker client={client} message={t.workspace.notFound} />;
  if (ws.status === 'ok' && ws.data && !ws.data.hasDiscussionsEnabled)
    return <WorkspacePicker client={client} message={t.workspace.discussionsDisabled} />;

  const categories = ws.status === 'ok' && ws.data ? ws.data.categories : [];
  const busy = ws.status === 'loading' || notes.status === 'loading';

  return (
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href={formatRoute({ host, repo, number: null })}>
          {t.name}
        </a>
        <select
          aria-label={t.topbar.connection}
          value={host}
          onChange={(e) => {
            location.hash = formatRoute({ host: e.currentTarget.value, repo: null, number: null });
          }}
        >
          {[host, ...(HOST_LOCKED ? [] : listConnections().filter((h) => h !== host))].map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <a class="workspace-name mono" href={formatRoute({ host, repo: null, number: null })} title={t.topbar.switchWorkspace}>
          {ws.status === 'ok' && ws.data ? ws.data.nameWithOwner : repoToString(repo)}
        </a>
        <span class="grow" />
        <span class="muted small-text" aria-live="polite">
          {busy ? t.topbar.loading : notes.status === 'ok' ? t.topbar.updatedAt(formatTime(notes.at)) : ''}
        </span>
        <button type="button" class="small" onClick={() => setReloadKey((k) => k + 1)} disabled={busy}>
          {t.topbar.reload}
        </button>
        <button type="button" class="small" onClick={props.onManageConnections}>
          {t.topbar.manageConnections}
        </button>
      </header>

      <div class="workspace-body">
        <nav class="sidebar">
          {ws.status === 'error' ? (
            <ErrorMessage error={ws.error} />
          ) : notes.status === 'error' ? (
            <ErrorMessage error={notes.error} />
          ) : notes.status === 'loading' ? (
            <p class="muted pad">{t.topbar.loading}</p>
          ) : (
            <NoteList
              onNew={ws.status === 'ok' ? () => setCreating(true) : null}
              notes={notes.data.notes}
              truncated={notes.data.truncated}
              categories={categories}
              hrefFor={(n) => formatRoute({ host, repo, number: n })}
              active={props.number}
            />
          )}
        </nav>
        <main class="content">
          {props.number ? (
            <NoteView client={client} repo={repo} number={props.number} reloadKey={reloadKey} />
          ) : (
            <p class="muted pad">{t.note.choose}</p>
          )}
        </main>
      </div>
      {creating && ws.status === 'ok' && ws.data && (
        <NewNoteDialog
          client={client}
          repositoryId={ws.data.id}
          categories={ws.data.categories}
          onCancel={() => setCreating(false)}
          onCreated={(number) => {
            setCreating(false);
            setListKey((k) => k + 1);
            location.hash = formatRoute({ host, repo, number });
          }}
        />
      )}
    </div>
  );
}

function NewNoteDialog(props: {
  client: GitHubClient;
  repositoryId: string;
  categories: Category[];
  onCancel: () => void;
  onCreated: (number: number) => void;
}) {
  const n = t.newNote;
  // お知らせ用のカテゴリは管理者しか投稿できないので、既定にしない
  const initial = props.categories.find((c) => c.slug === 'ideas') ?? props.categories.find((c) => c.slug !== 'announcements') ?? props.categories[0];
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(initial?.id ?? '');
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (title.trim() === '') {
      setMessage(n.titleRequired);
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      props.onCreated(await createNote(props.client, { repositoryId: props.repositoryId, categoryId, title: title.trim(), body: newNoteBody() }));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div class="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="new-note-heading">
      <form class="modal" onSubmit={submit}>
        <h2 id="new-note-heading">{n.heading}</h2>
        {props.categories.length === 0 ? (
          <p class="error">{n.noCategory}</p>
        ) : (
          <>
            <label>
              {n.title}
              <input type="text" value={title} autofocus onInput={(e) => setTitle(e.currentTarget.value)} autocomplete="off" />
            </label>
            <label>
              {n.category}
              <select class="block" value={categoryId} onChange={(e) => setCategoryId(e.currentTarget.value)}>
                {props.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {message && <p class="error">{message}</p>}
        {error !== null && <ErrorMessage error={error} />}
        <div class="row">
          <button type="submit" class="primary" disabled={busy || props.categories.length === 0}>
            {n.create}
          </button>
          <button type="button" onClick={props.onCancel}>
            {n.cancel}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}

function NoteList(props: {
  onNew: (() => void) | null;
  notes: NoteSummary[];
  truncated: boolean;
  categories: Category[];
  hrefFor: (n: number) => string;
  active: number | null;
}) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q ? props.notes.filter((n) => n.title.toLowerCase().includes(q)) : props.notes;
    const byCat = new Map<string, NoteSummary[]>();
    for (const n of filtered) byCat.set(n.categoryId, [...(byCat.get(n.categoryId) ?? []), n]);
    const out: { key: string; label: string; notes: NoteSummary[] }[] = [];
    for (const c of props.categories) {
      const list = byCat.get(c.id);
      if (list) out.push({ key: c.id, label: c.name, notes: list });
      byCat.delete(c.id);
    }
    const rest = [...byCat.values()].flat();
    if (rest.length > 0) out.push({ key: '_', label: t.sidebar.uncategorized, notes: rest });
    return out;
  }, [props.notes, props.categories, filter]);

  return (
    <div class="note-list">
      {props.onNew && (
        <button type="button" class="small new-note" onClick={props.onNew}>
          {t.newNote.button}
        </button>
      )}
      <input
        type="search"
        class="filter"
        placeholder={t.sidebar.filter}
        aria-label={t.sidebar.filter}
        value={filter}
        onInput={(e) => setFilter(e.currentTarget.value)}
      />
      {props.notes.length === 0 && <p class="muted pad">{t.sidebar.empty}</p>}
      {props.notes.length > 0 && groups.length === 0 && <p class="muted pad">{t.sidebar.noMatch}</p>}
      {groups.map((g) => (
        <section key={g.key}>
          <h2 class="category">{g.label}</h2>
          <ul class="plain-list">
            {g.notes.map((n) => (
              <li key={n.id}>
                <a href={props.hrefFor(n.number)} class={`note-link${props.active === n.number ? ' active' : ''}`}>
                  <span class="note-title">{n.title}</span>
                  <span class="note-date">{formatShort(n.updatedAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {props.truncated && <p class="help pad">{t.sidebar.truncated}</p>}
    </div>
  );
}
