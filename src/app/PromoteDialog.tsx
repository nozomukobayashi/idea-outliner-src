/** 行を Issue にするダイアログ（DESIGN.md §4.3） */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { parseRepo } from '../config/repo';
import { getIssueTarget, listViewerRepos } from '../github/api';
import type { GitHubClient } from '../github/client';
import { promoteToIssue, type PromoteResult } from '../github/promote';
import { ja } from '../i18n/ja';
import type { ItemEntry } from '../note/format';
import { childrenMarkdown, defaultRepoOf, issueBody, issueTitle, MAX_TITLE_LENGTH, parentIssueRef, withIssueRef } from '../note/issueDraft';
import type { IssueRef } from '../note/issueRefs';
import { indexOfItem, setItemText } from '../outline/edit';
import { ErrorMessage } from './ErrorMessage';
import { useAsync } from './hooks';
import type { NoteSession } from './noteSession';
import { lastIssueRepo, rememberIssueRepo } from './prefs';

const t = ja.app.promote;
const refText = (r: IssueRef) => `${r.owner}/${r.repo}#${r.number}`;

/** 結果をユーザーに伝える文 */
export function promoteNotice(result: PromoteResult, parent: IssueRef | null): string {
  const created = t.created(refText(result.ref));
  if (!parent) return created;
  if (result.parentLink === 'body-link') return `${created} ${t.linkedFallback(refText(parent))}`;
  if (result.parentLink === 'failed') return `${created} ${t.linkFailed(refText(parent))}`;
  return created;
}

export function PromoteDialog(props: {
  client: GitHubClient;
  session: NoteSession;
  noteUrl: string;
  itemId: string;
  onCancel: () => void;
  onDone: (notice: string) => void;
}) {
  const { client, session, itemId } = props;
  const host = client.connection.host;
  const findItem = (): ItemEntry | null => {
    const e = session.doc.entries[indexOfItem(session.doc.entries, itemId)];
    return e && e.kind === 'item' ? e : null;
  };

  const [repoInput, setRepoInput] = useState(() => defaultRepoOf(session.doc) ?? lastIssueRepo(host) ?? '');
  const [title, setTitle] = useState(() => issueTitle(findItem()?.text ?? ''));
  const [labelIds, setLabelIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // 入力のたびに問い合わせないよう、止まってから確認する
  const [repoQuery, setRepoQuery] = useState(repoInput);
  useEffect(() => {
    const timer = setTimeout(() => setRepoQuery(repoInput), 300);
    return () => clearTimeout(timer);
  }, [repoInput]);
  const repo = useMemo(() => parseRepo(repoQuery), [repoQuery]);

  const target = useAsync(repo ? () => getIssueTarget(client, repo) : null, [repoQuery]);
  const suggestions = useAsync(() => listViewerRepos(client), [client]);
  useEffect(() => setLabelIds(new Set()), [repoQuery]);

  const settled = repo !== null && repoQuery === repoInput;
  const ready = settled && target.status === 'ok' && target.data?.hasIssuesEnabled === true;
  const parent = parentIssueRef(session.doc, itemId);
  const previewBody = (): string =>
    issueBody({ children: childrenMarkdown(session.doc.entries, itemId), noteUrl: props.noteUrl, lineId: itemId, sourceLabel: t.issueBody.source });

  async function submit(e: Event) {
    e.preventDefault();
    if (!ready || target.status !== 'ok' || !target.data || !repo) return;
    const trimmed = title.trim();
    if (trimmed === '') {
      setMessage(t.titleRequired);
      return;
    }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      // 先に保存する。Issue を作った後で行に追記できないと、どの行からも辿れない Issue が残るため
      await session.saveNow();
      if (session.busy) {
        setMessage(t.saveFirst);
        setBusy(false);
        return;
      }
      if (!findItem()) {
        setMessage(t.lineGone);
        setBusy(false);
        return;
      }
      const currentParent = parentIssueRef(session.doc, itemId);
      const [owner = repo.owner, name = repo.name] = target.data.nameWithOwner.split('/');
      const result = await promoteToIssue(client, {
        repositoryId: target.data.id,
        repo: { owner, name },
        title: trimmed,
        body: previewBody(),
        labelIds: [...labelIds],
        parent: currentParent,
        parentLabel: t.issueBody.parent,
      });
      rememberIssueRepo(host, target.data.nameWithOwner);
      const item = findItem();
      if (item) session.edit(setItemText(session.doc, itemId, withIssueRef(item.text, result.ref)));
      void session.saveNow();
      props.onDone(promoteNotice(result, currentParent));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const toggleLabel = (id: string) => {
    const next = new Set(labelIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLabelIds(next);
  };

  return (
    <div class="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="promote-heading">
        <form class="modal" onSubmit={submit}>
          <h2 id="promote-heading">{t.heading}</h2>
          <label>
            {t.repo}
            <input
              type="text"
              list="promote-repos"
              value={repoInput}
              placeholder="owner/name"
              onInput={(e) => setRepoInput(e.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
            />
          </label>
          <datalist id="promote-repos">
            {suggestions.status === 'ok' &&
              suggestions.data.filter((r) => r.hasIssuesEnabled).map((r) => <option key={r.nameWithOwner} value={r.nameWithOwner} />)}
          </datalist>
          {repoInput.trim() !== '' && parseRepo(repoInput) === null && <p class="error">{ja.app.errors.invalidRepo}</p>}
          {settled && target.status === 'loading' && <p class="help">{t.loadingRepo}</p>}
          {settled && (target.status === 'error' || (target.status === 'ok' && !target.data)) && <p class="error">{t.repoNotFound}</p>}
          {settled && target.status === 'ok' && target.data && !target.data.hasIssuesEnabled && <p class="error">{t.issuesDisabled}</p>}

          <label>
            {t.title}
            <input type="text" value={title} maxLength={MAX_TITLE_LENGTH} onInput={(e) => setTitle(e.currentTarget.value)} autocomplete="off" />
          </label>

          {ready && target.status === 'ok' && target.data && (
            <fieldset class="labels">
              <legend>{t.labels}</legend>
              {target.data.labels.length === 0 && <p class="help">{t.noLabels}</p>}
              {target.data.labels.map((l) => (
                <label key={l.id} class="label-choice">
                  <input type="checkbox" checked={labelIds.has(l.id)} onChange={() => toggleLabel(l.id)} />
                  {l.name}
                </label>
              ))}
            </fieldset>
          )}

          {parent && <p class="help">{t.parent(refText(parent))}</p>}

          <div class="preview-label">{t.body}</div>
          <pre class="body-preview">{previewBody()}</pre>

          {message && <p class="error">{message}</p>}
          {error !== null && <ErrorMessage error={error} reasonOnly />}
          <div class="row">
            <button type="submit" class="primary" disabled={busy || !ready}>
              {busy ? t.creating : t.create}
            </button>
            <button type="button" disabled={busy} onClick={props.onCancel}>
              {t.cancel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
