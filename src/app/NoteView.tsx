/** ノートの読み込みと、アウトラインの表示・編集 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { RepoRef } from '../config/repo';
import { addComment, fetchIssueStates, getNote, getNoteBody, listComments, updateNoteBody, type IssueInfo, type Note, type NoteComment } from '../github/api';
import type { GitHubClient } from '../github/client';
import { ja } from '../i18n/ja';
import { hasPendingIdAssignments, normalizeItemText, noteItems, type ItemEntry } from '../note/format';
import { findIssueRefs, refKey, uniqueRefs, type IssueRef } from '../note/issueRefs';
import { buildLineComment, groupComments } from '../note/lineComment';
import { applyCompletion, completionContext, completionKey } from '../note/completion';
import {
  appendItem,
  cycleChecked,
  deleteItem,
  indentItem,
  indexOfItem,
  mergeIntoPrevious,
  moveDown,
  moveUp,
  outdentItem,
  parentIndex,
  setItemText,
  splitItem,
  subtreeEnd,
  toggleChecked,
} from '../outline/edit';
import { buildRows, parentIds } from '../outline/rows';
import { dedent, renderBlock, renderInline, type ChipInfo, type ChipState, type RenderOptions } from '../render/markdown';
import { ConflictDialog } from './ConflictDialog';
import { DiscussionPane } from './DiscussionPane';
import { PromoteDialog } from './PromoteDialog';
import { useCompletion, type CompletionItem } from './useCompletion';
import { formatDateTime } from './datetime';
import { ErrorMessage } from './ErrorMessage';
import { useAsync } from './hooks';
import { NoteDeletedError, openSession, type NoteSession } from './noteSession';
import { loadCollapsed, saveCollapsed } from './prefs';

const t = ja.app.note;
const stateLabel = (s: ChipState) => ja.app.issues.states[s];
const DONE_STATES = new Set<ChipState>(['closed', 'not_planned', 'merged']);

export function NoteView(props: { client: GitHubClient; repo: RepoRef; number: number; reloadKey: number }) {
  const { client, repo, number } = props;
  const noteKey = `${client.connection.host}/${repo.owner}/${repo.name}/${number}`;
  const note = useAsync(() => getNote(client, repo, number), [client, noteKey, props.reloadKey]);

  const session = useMemo(() => {
    if (note.status !== 'ok' || !note.data) return null;
    const id = note.data.id;
    return openSession(noteKey, note.data.body, {
      fetchBody: () => getNoteBody(client, id),
      updateBody: (body) => updateNoteBody(client, id, body),
    });
  }, [note]);

  if (note.status === 'loading') return <div class="note-main muted pad">{ja.app.topbar.loading}</div>;
  if (note.status === 'error') return <div class="note-main pad"><ErrorMessage error={note.error} /></div>;
  if (!note.data || !session) return <div class="note-main pad muted">{t.notFound}</div>;
  return <NoteEditor key={noteKey} client={client} note={note.data} noteKey={noteKey} session={session} />;
}

function useSession(session: NoteSession): void {
  const [, force] = useState(0);
  useEffect(() => session.subscribe(() => force((n) => n + 1)), [session]);
}

interface Editing {
  id: string;
  caret: number;
}

function NoteEditor(props: { client: GitHubClient; note: Note; noteKey: string; session: NoteSession }) {
  const { client, note: n, noteKey, session } = props;
  const conn = client.connection;
  useSession(session);
  const doc = session.doc;
  const canEdit = n.canEdit;

  // 別の画面に移るときは、待たずに保存する
  useEffect(() => () => void session.saveNow(), [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void session.saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  // Issue の状態は、保存された本文の参照についてだけ取る（入力の途中で問い合わせないため）
  const savedRefs = useMemo(() => uniqueRefs(noteItems(session.base).map((i) => i.text)), [session.base]);
  const savedRefsKey = savedRefs.map(refKey).join(' ');
  const issues = useAsync(() => fetchIssueStates(client, savedRefs), [savedRefsKey]);
  const lastIssues = useRef(new Map<string, IssueInfo | null>());
  if (issues.status === 'ok') lastIssues.current = issues.data;

  const refs = useMemo(() => uniqueRefs(noteItems(doc).map((i) => i.text)), [doc]);

  const [commentsKey, setCommentsKey] = useState(0);
  const comments = useAsync(() => listComments(client, n.id), [n.id, commentsKey]);
  // 取り直しの間も前の内容を出しておく
  const commentData = useRef<{ comments: NoteComment[]; truncated: boolean }>({ comments: [], truncated: false });
  if (comments.status === 'ok') commentData.current = comments.data;
  const groups = useMemo(() => groupComments(commentData.current.comments, new Set(noteItems(doc).map((i) => i.id))), [commentData.current, doc]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedItem = selectedId === null ? null : (noteItems(doc).find((i) => i.id === selectedId) ?? null);
  const selectLine = (id: string | null) => {
    setSelectedId(id);
    // 狭い画面では議論ペインが下にあるので、見える位置まで動かす
    if (id !== null) requestAnimationFrame(() => document.getElementById('discussion')?.scrollIntoView({ block: 'nearest' }));
  };

  /** 投稿の前に行の ID を保存する。読み込みのたびに別の ID になると、紐づけが切れるため */
  const postComment = async (lineId: string, body: string): Promise<string | null> => {
    if (!(await session.persistLine(lineId))) {
      return noteItems(session.doc).some((i) => i.id === lineId) && session.busy ? ja.app.discussion.saveFirst : ja.app.discussion.lineGone;
    }
    const item = noteItems(session.doc).find((i) => i.id === lineId);
    if (!item) return ja.app.discussion.lineGone;
    await addComment(client, n.id, buildLineComment(lineId, item.text, body));
    setCommentsKey((k) => k + 1);
    return null;
  };

  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(noteKey));
  const updateCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    saveCollapsed(noteKey, next);
  };
  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateCollapsed(next);
  };

  const [editing, setEditing] = useState<Editing | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canPromote = (item: ItemEntry) => canEdit && normalizeItemText(item.text) !== '' && findIssueRefs(item.text).length === 0;
  const startPromote = (id: string) => {
    // ダイアログを開いている間に行を打ち替えないよう、編集を閉じる
    setEditing(null);
    setNotice(null);
    setPromoting(id);
  };

  const issueUrl = (r: IssueRef) => `${conn.webUrl}/${r.owner}/${r.repo}/issues/${r.number}`;
  const infoFor = (r: IssueRef): ChipInfo => {
    const k = refKey(r);
    if (!lastIssues.current.has(k)) return { state: issues.status === 'error' ? 'unknown' : 'loading', url: issueUrl(r) };
    const info = lastIssues.current.get(k);
    return info ? { state: info.state, url: info.url, title: info.title } : { state: 'unknown', url: issueUrl(r) };
  };
  const renderOpts: RenderOptions = { chipFor: infoFor, stateLabel };

  const rows = buildRows(doc.entries, collapsed);
  const visible = rows.flatMap((r) => (r.kind === 'item' ? [r] : []));
  const parents = parentIds(doc.entries);
  const isDone = (item: ItemEntry) => {
    if (item.checked === true) return true;
    const lineRefs = findIssueRefs(item.text);
    return lineRefs.length > 0 && lineRefs.every((r) => DONE_STATES.has(infoFor(r).state));
  };

  const [caretPos, setCaretPos] = useState(0);
  const focusRow = (id: string, caret: number) => {
    setEditing({ id, caret });
    setCaretPos(caret);
  };

  // owner/repo# の補完。Esc で閉じた文脈では、入力が変わるまで出さない
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const completionItem = editing && canEdit ? (noteItems(doc).find((i) => i.id === editing.id) ?? null) : null;
  const completionCtx = completionItem ? completionContext(completionItem.text, caretPos) : null;
  const ctxKey = completionKey(completionCtx);
  const activeCtx = ctxKey !== null && ctxKey !== dismissed ? completionCtx : null;
  const completion = useCompletion(client, activeCtx);
  useEffect(() => setPick(0), [ctxKey]);
  const completionOpen = activeCtx !== null && completion.items.length > 0;
  const acceptCompletion = (index: number) => {
    const choice = completion.items[index];
    if (!completionItem || !activeCtx || !choice) return;
    const r = applyCompletion(completionItem.text, activeCtx, choice.value);
    session.edit(setItemText(session.doc, completionItem.id, r.text));
    focusRow(completionItem.id, r.caret);
  };

  /** 親が折りたたまれていて行が隠れないように開く */
  const revealParent = (id: string) => {
    const i = indexOfItem(session.doc.entries, id);
    const p = i < 0 ? null : parentIndex(session.doc.entries, i);
    if (p === null) return;
    const pid = (session.doc.entries[p] as ItemEntry).id;
    if (collapsed.has(pid)) {
      const next = new Set(collapsed);
      next.delete(pid);
      updateCollapsed(next);
    }
  };

  const removeRow = (id: string) => {
    const i = indexOfItem(session.doc.entries, id);
    if (i < 0) return;
    if (subtreeEnd(session.doc.entries, i) > i + 1 && !confirm(t.deleteWithChildren)) return;
    const at = visible.findIndex((r) => r.item.id === id);
    const prev = visible[at - 1]?.item ?? visible[at + 1]?.item ?? null;
    session.edit(deleteItem(session.doc, id));
    setEditing(prev ? { id: prev.id, caret: prev.text.length } : null);
  };

  const onKeyDown = (e: KeyboardEvent, item: ItemEntry, hasChildren: boolean, isCollapsed: boolean) => {
    // 変換中のキーはすべて IME のもの（確定の Enter で行が分かれないように）
    if (e.isComposing || e.keyCode === 229) return;
    // 候補が出ている間は、↑↓・Enter・Tab・Esc を補完に使う
    if (completionOpen && editing?.id === item.id) {
      const count = completion.items.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : -1) + count) % count);
        return;
      }
      if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        acceptCompletion(pick);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(ctxKey);
        return;
      }
    }
    const ta = e.currentTarget as HTMLTextAreaElement;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const mod = e.metaKey || e.ctrlKey;
    const at = visible.findIndex((r) => r.item.id === item.id);
    const id = item.id;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (mod) {
        session.edit(cycleChecked(session.doc, id));
        focusRow(id, start);
        return;
      }
      const cut = start === end ? session.doc : setItemText(session.doc, id, item.text.slice(0, start) + item.text.slice(end));
      const r = splitItem(cut, id, start, hasChildren && !isCollapsed);
      session.edit(r.doc);
      focusRow(r.focusId, r.caret);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      session.edit(e.shiftKey ? outdentItem(session.doc, id) : indentItem(session.doc, id));
      revealParent(id);
      focusRow(id, start);
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      session.edit(e.key === 'ArrowUp' ? moveUp(session.doc, id) : moveDown(session.doc, id));
      focusRow(id, start);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // 折り返している行では、端にいるときだけ隣の行に移る
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const singleLine = ta.scrollHeight < lineHeight * 1.8;
      const atEdge = e.key === 'ArrowUp' ? start === 0 : end === item.text.length;
      if (!singleLine && !atEdge) return;
      const target = visible[at + (e.key === 'ArrowUp' ? -1 : 1)]?.item;
      if (!target) return;
      e.preventDefault();
      focusRow(target.id, Math.min(start, target.text.length));
    } else if (e.key === 'Backspace' && start === 0 && end === 0) {
      const prev = visible[at - 1]?.item;
      if (item.text === '' && !hasChildren && item.continuation.length === 0) {
        e.preventDefault();
        session.edit(deleteItem(session.doc, id));
        if (prev) focusRow(prev.id, prev.text.length);
        else setEditing(null);
      } else if (prev && !hasChildren) {
        const r = mergeIntoPrevious(session.doc, id, prev.id);
        if (!r) return;
        e.preventDefault();
        session.edit(r.doc);
        focusRow(r.focusId, r.caret);
      }
    } else if (e.key === 'Escape') {
      ta.blur();
    }
  };

  const act = (fn: (id: string) => void) => (e: Event) => {
    e.preventDefault();
    if (editing) fn(editing.id);
  };
  const keepFocus = (e: Event) => e.preventDefault();
  const editingItem = editing ? (visible.find((r) => r.item.id === editing.id)?.item ?? null) : null;

  return (
    <div class="note-layout">
      <article class="note-main">
        <header class="note-header">
          <h1>{n.title}</h1>
          <div class="note-meta row">
            <span>{t.updated(formatDateTime(n.updatedAt))}</span>
            {n.author && <span>{t.by(n.author)}</span>}
            <span>{t.comments(comments.status === 'ok' ? comments.data.comments.length : n.commentCount)}</span>
            <a href={n.url} target="_blank" rel="noopener noreferrer">
              {ja.app.topbar.openOnGitHub}
            </a>
          </div>
          <div class="row">
            {canEdit && <SaveStatusView session={session} />}
            {parents.length > 0 && (
              <>
                <button type="button" class="small" onClick={() => updateCollapsed(new Set())}>
                  {t.expandAll}
                </button>
                <button type="button" class="small" onClick={() => updateCollapsed(new Set(parents))}>
                  {t.collapseAll}
                </button>
              </>
            )}
          </div>
          {notice && (
            <p class="notice row between" role="status">
              <span>{notice}</span>
              <button type="button" class="small" onClick={() => setNotice(null)}>
                {ja.app.promote.dismiss}
              </button>
            </p>
          )}
          {!canEdit && <p class="help">{t.readOnly}</p>}
          {canEdit && hasPendingIdAssignments(session.base) && <p class="help">{t.unsavedIds}</p>}
        </header>

        {canEdit && (
          <div class="line-actions row" role="toolbar" aria-label={t.actions.label} hidden={!editing}>
            <button type="button" class="small" onMouseDown={keepFocus} onClick={act((id) => { session.edit(outdentItem(session.doc, id)); focusRow(id, editing?.caret ?? 0); })}>{t.actions.outdent}</button>
            <button type="button" class="small" onMouseDown={keepFocus} onClick={act((id) => { session.edit(indentItem(session.doc, id)); revealParent(id); focusRow(id, editing?.caret ?? 0); })}>{t.actions.indent}</button>
            <button type="button" class="small" onMouseDown={keepFocus} onClick={act((id) => { session.edit(moveUp(session.doc, id)); focusRow(id, editing?.caret ?? 0); })}>{t.actions.moveUp}</button>
            <button type="button" class="small" onMouseDown={keepFocus} onClick={act((id) => { session.edit(moveDown(session.doc, id)); focusRow(id, editing?.caret ?? 0); })}>{t.actions.moveDown}</button>
            <button type="button" class="small" onMouseDown={keepFocus} onClick={act((id) => { session.edit(cycleChecked(session.doc, id)); focusRow(id, editing?.caret ?? 0); })}>{t.actions.todo}</button>
            {editingItem && canPromote(editingItem) && (
              <button type="button" class="small" onMouseDown={keepFocus} onClick={act(startPromote)}>{ja.app.promote.button}</button>
            )}
            <button type="button" class="small danger" onMouseDown={keepFocus} onClick={act(removeRow)}>{t.actions.delete}</button>
          </div>
        )}

        {rows.length === 0 && <p class="muted">{t.empty}</p>}
        <div class="outline" role="tree">
          {rows.map((row, i) =>
            row.kind === 'memo' ? (
              <div key={`memo-${i}`} class="memo markdown" dangerouslySetInnerHTML={{ __html: renderBlock(row.memo.lines.join('\n'), renderOpts) }} />
            ) : (
              <OutlineRow
                key={row.item.id}
                item={row.item}
                hasChildren={row.hasChildren}
                collapsed={row.collapsed}
                done={isDone(row.item)}
                renderOpts={renderOpts}
                canEdit={canEdit}
                onPromote={canPromote(row.item) ? () => startPromote(row.item.id) : null}
                commentCount={groups.byLine.get(row.item.id)?.length ?? 0}
                selected={selectedId === row.item.id}
                onComment={() => selectLine(row.item.id)}
                editing={editing?.id === row.item.id ? editing : null}
                onToggle={() => toggle(row.item.id)}
                onCheck={() => session.edit(toggleChecked(session.doc, row.item.id))}
                onStartEdit={() => focusRow(row.item.id, row.item.text.length)}
                onInput={(text, caret) => {
                  setCaretPos(caret);
                  const next = setItemText(session.doc, row.item.id, text);
                  session.edit(next);
                  // 行頭の [ ] が TODO に変わると文字数が変わるので、カーソルを合わせ直す
                  const after = next.entries[indexOfItem(next.entries, row.item.id)] as ItemEntry;
                  if (after.text !== text) focusRow(row.item.id, Math.max(0, caret - (text.length - after.text.length)));
                }}
                onCaret={(caret) => {
                  if (editing?.id === row.item.id) editing.caret = caret;
                  setCaretPos(caret);
                }}
                completion={
                  editing?.id === row.item.id && activeCtx
                    ? { items: completion.items, loading: completion.loading, index: pick, onPick: acceptCompletion }
                    : null
                }
                onKeyDown={(e) => onKeyDown(e, row.item, row.hasChildren, row.collapsed)}
                onBlur={() => setEditing((cur) => (cur?.id === row.item.id ? null : cur))}
              />
            ),
          )}
        </div>

        {canEdit && (
          <>
            <button
              type="button"
              class="small add-line"
              onClick={() => {
                const r = appendItem(session.doc);
                session.edit(r.doc);
                focusRow(r.focusId, r.caret);
              }}
            >
              {t.addLine}
            </button>
            <p class="help">{t.shortcuts}</p>
          </>
        )}
      </article>

      <aside class="note-side">
        <section>
          <h2>{ja.app.issues.heading}</h2>
          {refs.length > 0 && (
            <p class="help">
              {ja.app.issues.summary(
                refs.filter((r) => infoFor(r).state === 'open').length,
                refs.filter((r) => DONE_STATES.has(infoFor(r).state)).length,
              )}
            </p>
          )}
          {refs.length === 0 ? (
            <p class="muted">{ja.app.issues.empty}</p>
          ) : (
            <ul class="plain-list issue-list">
              {refs.map((r) => {
                const info = infoFor(r);
                return (
                  <li key={refKey(r)}>
                    <a class={`chip chip-${info.state}`} href={info.url} target="_blank" rel="noopener noreferrer" title={stateLabel(info.state)}>
                      {`${r.owner}/${r.repo}#${r.number}`}
                    </a>
                    <span class="issue-title">{info.title ?? stateLabel(info.state)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <DiscussionPane
          loading={comments.status === 'loading'}
          error={comments.status === 'error' ? comments.error : null}
          truncated={commentData.current.truncated}
          groups={groups}
          items={noteItems(doc)}
          selected={selectedItem}
          canPost={selectedItem !== null && (canEdit || session.isLineSaved(selectedItem.id))}
          noteUrl={n.url}
          renderOpts={renderOpts}
          onSelect={selectLine}
          onPost={postComment}
        />
      </aside>

      {promoting && (
        <PromoteDialog
          client={client}
          session={session}
          noteUrl={n.url}
          itemId={promoting}
          onCancel={() => setPromoting(null)}
          onDone={(message) => {
            setPromoting(null);
            setNotice(message);
          }}
        />
      )}

      {session.status === 'conflict' && <ConflictDialog conflicts={session.conflicts} onResolve={(r) => void session.resolveConflicts(r)} />}
    </div>
  );
}

function SaveStatusView({ session }: { session: NoteSession }) {
  const s = ja.app.save;
  const status = session.status;
  const message = status === 'error' ? (session.error instanceof NoteDeletedError ? s.deleted : s.error) : s[status];
  return (
    <>
      <span class={`save-status save-${status}`} role="status">
        {message}
      </span>
      {status === 'error' && !(session.error instanceof NoteDeletedError) && <ErrorMessage error={session.error} reasonOnly />}
      <button type="button" class="small" disabled={status === 'saved' || status === 'saving' || status === 'conflict'} onClick={() => void session.saveNow()}>
        {s.saveNow}
      </button>
    </>
  );
}

function OutlineRow(props: {
  item: ItemEntry;
  hasChildren: boolean;
  collapsed: boolean;
  done: boolean;
  renderOpts: RenderOptions;
  canEdit: boolean;
  onPromote: (() => void) | null;
  commentCount: number;
  selected: boolean;
  onComment: () => void;
  editing: Editing | null;
  onToggle: () => void;
  onCheck: () => void;
  onStartEdit: () => void;
  onInput: (text: string, caret: number) => void;
  onCaret: (caret: number) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onBlur: () => void;
  completion: CompletionView | null;
}) {
  const { item, editing } = props;
  const contHtml = useMemo(
    () => (item.continuation.some((l) => l.trim() !== '') ? renderBlock(dedent(item.continuation), props.renderOpts) : null),
    [item.continuation, props.renderOpts],
  );
  return (
    <div
      class={`outline-row${props.done && !editing ? ' done' : ''}${props.selected ? ' selected' : ''}`}
      style={{ '--depth': item.depth }}
      role="treeitem"
      aria-level={item.depth + 1}
      aria-expanded={props.hasChildren ? !props.collapsed : undefined}
    >
      <div class="outline-line">
        {props.hasChildren ? (
          <button
            type="button"
            class={`toggle${props.collapsed ? ' is-collapsed' : ''}`}
            aria-label={props.collapsed ? t.expand : t.collapse}
            onClick={props.onToggle}
          />
        ) : (
          <span class="bullet" aria-hidden="true" />
        )}
        {item.checked !== null && (
          <input
            type="checkbox"
            aria-label={t.toggleCheck}
            checked={item.checked || (props.done && !editing)}
            disabled={!props.canEdit}
            onClick={props.onCheck}
          />
        )}
        {editing ? (
          <LineInput
            item={item}
            editing={editing}
            onInput={props.onInput}
            onCaret={props.onCaret}
            onKeyDown={props.onKeyDown}
            onBlur={props.onBlur}
            completion={props.completion}
          />
        ) : (
          <RenderedText item={item} renderOpts={props.renderOpts} canEdit={props.canEdit} onStartEdit={props.onStartEdit} />
        )}
        {!editing && (
          <span class="row-actions">
            {props.onPromote && (
              <button type="button" class="small promote" onClick={props.onPromote}>
                {ja.app.promote.button}
              </button>
            )}
            <button type="button" class={`small comment-button${props.commentCount > 0 ? ' has-comments' : ''}`} onClick={props.onComment}>
              {props.commentCount > 0 ? ja.app.discussion.count(props.commentCount) : ja.app.discussion.comment}
            </button>
          </span>
        )}
      </div>
      {contHtml && <div class="outline-cont markdown" dangerouslySetInnerHTML={{ __html: contHtml }} />}
    </div>
  );
}

function RenderedText(props: { item: ItemEntry; renderOpts: RenderOptions; canEdit: boolean; onStartEdit: () => void }) {
  const { item } = props;
  const html = useMemo(() => renderInline(item.text, props.renderOpts), [item.text, props.renderOpts]);
  const onClick = (e: MouseEvent) => {
    if (!props.canEdit) return;
    // リンクとチップはそのまま開く
    if ((e.target as HTMLElement).closest('a')) return;
    props.onStartEdit();
  };
  if (props.canEdit && item.text.trim() === '') {
    return (
      <span class="outline-text is-empty" onClick={onClick}>
        {t.emptyLine}
      </span>
    );
  }
  return <span class={`outline-text${props.canEdit ? ' editable' : ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

interface CompletionView {
  items: CompletionItem[];
  loading: boolean;
  index: number;
  onPick: (index: number) => void;
}

function LineInput(props: {
  item: ItemEntry;
  editing: Editing;
  onInput: (text: string, caret: number) => void;
  onCaret: (caret: number) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onBlur: () => void;
  completion: CompletionView | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // 行の移動や Enter のたびに editing が新しくなるので、そのときだけカーソルを置き直す。
  // useEffect だと描画の後まで遅れ、その間に打った文字が失われるので useLayoutEffect にする
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(props.editing.caret, props.editing.caret);
  }, [props.editing]);

  // 内容に合わせて高さを変える
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [props.item.text]);

  const c = props.completion;
  const open = c !== null && (c.items.length > 0 || c.loading);
  return (
    <>
      <textarea
        ref={ref}
        class="outline-input"
        rows={1}
        aria-label={t.lineText}
        aria-autocomplete="list"
        aria-expanded={open}
        value={props.item.text}
        spellcheck={false}
        onInput={(e) => props.onInput(e.currentTarget.value, e.currentTarget.selectionStart)}
        onSelect={(e) => props.onCaret(e.currentTarget.selectionStart)}
        onKeyDown={props.onKeyDown}
        onBlur={props.onBlur}
      />
      {open && c && (
        <ul class="completion" role="listbox" aria-label={t.completion.label}>
          {c.items.length === 0 ? (
            <li class="completion-empty">{t.completion.loading}</li>
          ) : (
            c.items.map((it, i) => (
              <li
                key={it.value}
                role="option"
                aria-selected={i === c.index}
                class={i === c.index ? 'active' : ''}
                // 押しても入力欄のフォーカスを外さない
                onMouseDown={(e) => {
                  e.preventDefault();
                  c.onPick(i);
                }}
              >
                {it.kind === 'repo' ? (
                  <span class="mono">{it.value}</span>
                ) : (
                  <>
                    <span class={`chip chip-${it.state}`}>#{it.number}</span>
                    <span class="completion-title">{it.title}</span>
                  </>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </>
  );
}
