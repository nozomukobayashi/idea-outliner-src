/** ワークスペース（アイディア用リポジトリ）の選択 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { parseRepo } from '../config/repo';
import { listOwnerRepos, listViewerRepos } from '../github/api';
import type { GitHubClient } from '../github/client';
import { ja } from '../i18n/ja';
import { useAsync } from './hooks';
import { recentWorkspaces } from './prefs';
import { filterRepos, mergeRepos, ownerFromInput } from './repoSearch';
import { formatRoute } from './route';

const t = ja.app.workspace;
const MAX_SHOWN = 50;

export function WorkspacePicker(props: { client: GitHubClient; message?: string | null }) {
  const host = props.client.connection.host;
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recent = recentWorkspaces(host);
  const suggestions = useAsync(() => listViewerRepos(props.client), [props.client]);

  // 入力のたびに問い合わせないよう、止まってから owner の配下を探す
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), 300);
    return () => clearTimeout(timer);
  }, [input]);
  const owner = ownerFromInput(query);
  const ownerRepos = useAsync(owner ? () => listOwnerRepos(props.client, owner) : null, [props.client, owner]);

  const result = useMemo(() => {
    const viewer = suggestions.status === 'ok' ? suggestions.data : [];
    const byOwner = owner && ownerRepos.status === 'ok' ? ownerRepos.data : [];
    return filterRepos(mergeRepos(viewer, byOwner).filter((r) => r.hasDiscussionsEnabled), input, MAX_SHOWN);
  }, [suggestions, ownerRepos, owner, input]);
  const searching = suggestions.status === 'loading' || (owner !== null && ownerRepos.status === 'loading');

  const hrefFor = (nameWithOwner: string) => {
    const repo = parseRepo(nameWithOwner);
    return repo ? formatRoute({ host, repo, number: null }) : '#/';
  };

  function open(e: Event) {
    e.preventDefault();
    const repo = parseRepo(input);
    if (!repo) {
      setError(ja.app.errors.invalidRepo);
      return;
    }
    location.hash = formatRoute({ host, repo, number: null });
  }

  return (
    <div class="center-page">
      <div class="panel">
        <h1>{t.heading}</h1>
        <p class="muted">{t.lead}</p>
        {props.message && <p class="error">{props.message}</p>}
        <form class="row" onSubmit={open}>
          <input
            type="text"
            class="grow"
            aria-label={t.input}
            placeholder="owner/name"
            value={input}
            onInput={(e) => setInput(e.currentTarget.value)}
            autocomplete="off"
            spellcheck={false}
          />
          <button type="submit" class="primary">
            {t.open}
          </button>
        </form>
        {error && <p class="error">{error}</p>}
        <p class="help">{t.inputHint}</p>

        {recent.length > 0 && (
          <>
            <h2>{t.recent}</h2>
            <ul class="plain-list">
              {recent.map((r) => (
                <li key={r}>
                  <a href={hrefFor(r)}>{r}</a>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2>{t.suggestions}</h2>
        {searching && <p class="muted">{result.total === 0 ? t.loadingSuggestions : t.searching}</p>}
        {!searching && result.total === 0 && <p class="muted">{t.noSuggestions}</p>}
        {result.total > 0 && (
          <ul class="plain-list">
            {result.shown.map((r) => (
              <li key={r.nameWithOwner}>
                <a href={hrefFor(r.nameWithOwner)}>{r.nameWithOwner}</a>
              </li>
            ))}
          </ul>
        )}
        {result.total > result.shown.length && <p class="help">{t.more(result.shown.length, result.total)}</p>}
      </div>
    </div>
  );
}
