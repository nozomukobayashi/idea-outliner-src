/** 右側の議論ペイン: 行ごとのコメントの表示と投稿（DESIGN.md §4.2） */
import { useState } from 'preact/hooks';
import type { NoteComment, NoteReply } from '../github/api';
import { ja } from '../i18n/ja';
import { normalizeItemText, type ItemEntry } from '../note/format';
import { parseLineComment, type CommentGroups } from '../note/lineComment';
import { renderBlock, type RenderOptions } from '../render/markdown';
import { formatDateTime } from './datetime';
import { ErrorMessage } from './ErrorMessage';

const t = ja.app.discussion;

export interface DiscussionPaneProps {
  loading: boolean;
  error: unknown;
  truncated: boolean;
  groups: CommentGroups<NoteComment>;
  items: ItemEntry[];
  selected: ItemEntry | null;
  canPost: boolean;
  noteUrl: string;
  renderOpts: RenderOptions;
  onSelect: (id: string | null) => void;
  /** 投稿する。投稿できなかった理由があれば文字列で返す */
  onPost: (lineId: string, body: string) => Promise<string | null>;
}

export function DiscussionPane(props: DiscussionPaneProps) {
  const { groups, selected } = props;
  const lineLabel = (item: ItemEntry) => normalizeItemText(item.text) || t.emptyLine;

  if (selected) {
    const comments = groups.byLine.get(selected.id) ?? [];
    return (
      <section id="discussion">
        <div class="row between">
          <h2>{t.lineHeading}</h2>
          <button type="button" class="small" onClick={() => props.onSelect(null)}>
            {t.showAll}
          </button>
        </div>
        <blockquote class="line-quote">{lineLabel(selected)}</blockquote>
        {props.error !== null && <ErrorMessage error={props.error} />}
        {props.loading && comments.length === 0 && <p class="muted">{t.loading}</p>}
        {!props.loading && props.error === null && comments.length === 0 && <p class="muted">{t.noLineComments}</p>}
        <CommentList comments={comments} renderOpts={props.renderOpts} />
        {props.canPost ? <CommentForm key={selected.id} onPost={(body) => props.onPost(selected.id, body)} /> : <p class="help">{t.noId}</p>}
      </section>
    );
  }

  const commented = props.items.filter((i) => groups.byLine.has(i.id));
  const isEmpty = commented.length === 0 && groups.general.length === 0 && groups.deleted.length === 0;
  return (
    <section id="discussion">
      <h2>{t.heading}</h2>
      {props.error !== null && <ErrorMessage error={props.error} />}
      {props.loading && isEmpty && <p class="muted">{t.loading}</p>}
      {!props.loading && props.error === null && isEmpty && <p class="muted">{t.empty}</p>}

      {commented.length > 0 && (
        <>
          <h3 class="group-heading">{t.lines}</h3>
          <ul class="plain-list thread-list">
            {commented.map((item) => (
              <li key={item.id}>
                <button type="button" class="thread-link" onClick={() => props.onSelect(item.id)}>
                  <span class="thread-title">{lineLabel(item)}</span>
                  <span class="thread-count">{groups.byLine.get(item.id)?.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {groups.general.length > 0 && (
        <>
          <h3 class="group-heading">{t.general}</h3>
          <CommentList comments={groups.general} renderOpts={props.renderOpts} />
        </>
      )}
      {groups.deleted.length > 0 && (
        <>
          <h3 class="group-heading">{t.deleted}</h3>
          <CommentList comments={groups.deleted} renderOpts={props.renderOpts} showQuote />
        </>
      )}
      {props.truncated && <p class="help">{t.truncated}</p>}
      <a href={props.noteUrl} target="_blank" rel="noopener noreferrer">
        {t.openOnGitHub}
      </a>
    </section>
  );
}

function CommentList(props: { comments: NoteComment[]; renderOpts: RenderOptions; showQuote?: boolean }) {
  return (
    <ul class="plain-list comment-list">
      {props.comments.map((c) => (
        <li key={c.id}>
          <CommentView comment={c} renderOpts={props.renderOpts} showQuote={props.showQuote} />
          {c.replies.length > 0 && (
            <ul class="plain-list reply-list">
              {c.replies.map((r) => (
                <li key={r.id}>
                  <CommentView comment={r} renderOpts={props.renderOpts} />
                </li>
              ))}
            </ul>
          )}
          {c.replyCount > c.replies.length && <p class="help">{t.moreReplies}</p>}
        </li>
      ))}
    </ul>
  );
}

/** 削除された行へのコメントでは、どの行の話か分かるよう引用も残す */
function displayText(body: string, showQuote: boolean | undefined): string {
  if (!showQuote) return parseLineComment(body).text;
  return body.replace(/^\s*<!--[\s\S]*?-->[ \t]*\r?\n?/, '');
}

function CommentView(props: { comment: NoteReply; renderOpts: RenderOptions; showQuote?: boolean }) {
  const { comment: c } = props;
  return (
    <article class="comment">
      <header class="comment-meta">
        <span class="comment-author">{c.author ?? t.unknownAuthor}</span>
        <a href={c.url} target="_blank" rel="noopener noreferrer" title={t.open}>
          {formatDateTime(c.createdAt)}
        </a>
      </header>
      {c.isMinimized ? (
        <p class="muted">{t.minimized}</p>
      ) : (
        <div class="markdown" dangerouslySetInnerHTML={{ __html: renderBlock(displayText(c.body, props.showQuote), props.renderOpts) }} />
      )}
    </article>
  );
}

function CommentForm(props: { onPost: (body: string) => Promise<string | null> }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    if (busy || body.trim() === '') return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const reason = await props.onPost(body);
      if (reason) setMessage(reason);
      else setBody('');
    } catch (e) {
      // 投稿に失敗しても、書いた本文は残す
      setError(e);
    }
    setBusy(false);
  }

  return (
    <form
      class="comment-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        rows={3}
        value={body}
        aria-label={t.placeholder}
        placeholder={t.placeholder}
        onInput={(e) => setBody(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {message && <p class="error">{message}</p>}
      {error !== null && <ErrorMessage error={error} reasonOnly />}
      <div class="row between">
        <span class="help">{t.shortcut}</span>
        <button type="submit" class="small primary" disabled={busy || body.trim() === ''}>
          {busy ? t.posting : t.post}
        </button>
      </div>
    </form>
  );
}
