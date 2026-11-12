/** 行の編集中の `owner/repo#` の候補を取ってくる */
import { useEffect, useState } from 'preact/hooks';
import { listOwnerRepos, listViewerRepos, searchIssues, type IssueState, type RepoSuggestion } from '../github/api';
import type { GitHubClient } from '../github/client';
import { completionKey, type CompletionContext } from '../note/completion';
import { mergeRepos } from './repoSearch';

export type CompletionItem =
  | { kind: 'repo'; value: string }
  | { kind: 'issue'; value: string; number: number; title: string; state: IssueState };

export interface CompletionState {
  key: string | null;
  items: CompletionItem[];
  loading: boolean;
}

const LIMIT = 8;
const DELAY_MS = 200;

// リポジトリの一覧は重いので、接続先ごとに一度だけ取る
const viewerRepos = new WeakMap<GitHubClient, Promise<RepoSuggestion[]>>();
const ownerRepos = new WeakMap<GitHubClient, Map<string, Promise<RepoSuggestion[]>>>();

function cachedViewerRepos(client: GitHubClient): Promise<RepoSuggestion[]> {
  let p = viewerRepos.get(client);
  if (!p) {
    p = listViewerRepos(client).catch(() => []);
    viewerRepos.set(client, p);
  }
  return p;
}

function cachedOwnerRepos(client: GitHubClient, owner: string): Promise<RepoSuggestion[]> {
  const byOwner = ownerRepos.get(client) ?? new Map<string, Promise<RepoSuggestion[]>>();
  ownerRepos.set(client, byOwner);
  const key = owner.toLowerCase();
  let p = byOwner.get(key);
  if (!p) {
    p = listOwnerRepos(client, owner).catch(() => []);
    byOwner.set(key, p);
  }
  return p;
}

async function repoItems(client: GitHubClient, query: string): Promise<CompletionItem[]> {
  const owner = query.split('/')[0] ?? '';
  const [mine, theirs] = await Promise.all([cachedViewerRepos(client), cachedOwnerRepos(client, owner)]);
  const q = query.toLowerCase();
  return mergeRepos(mine, theirs)
    .filter((r) => r.hasIssuesEnabled && r.nameWithOwner.toLowerCase().startsWith(q))
    .slice(0, LIMIT)
    .map((r) => ({ kind: 'repo', value: r.nameWithOwner }));
}

async function issueItems(client: GitHubClient, ctx: Extract<CompletionContext, { kind: 'issue' }>): Promise<CompletionItem[]> {
  const found = await searchIssues(client, { owner: ctx.owner, name: ctx.repo }, ctx.query, LIMIT);
  return found.map((i) => ({ kind: 'issue', value: `${ctx.owner}/${ctx.repo}#${i.number}`, number: i.number, title: i.title, state: i.state }));
}

const EMPTY: CompletionState = { key: null, items: [], loading: false };

/** ctx が変わると、少し待ってから候補を取り直す。古い問い合わせの結果は捨てる */
export function useCompletion(client: GitHubClient, ctx: CompletionContext | null): CompletionState {
  const key = completionKey(ctx);
  const [state, setState] = useState<CompletionState>(EMPTY);
  useEffect(() => {
    if (!ctx || !key) {
      setState(EMPTY);
      return;
    }
    let alive = true;
    setState((s) => ({ key, items: s.key === key ? s.items : [], loading: true }));
    const timer = setTimeout(() => {
      (ctx.kind === 'repo' ? repoItems(client, ctx.query) : issueItems(client, ctx)).then(
        (items) => alive && setState({ key, items, loading: false }),
        () => alive && setState({ key, items: [], loading: false }),
      );
    }, DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // ctx の中身は key で表しているので、key だけを見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
  return state.key === key ? state : { key, items: [], loading: key !== null };
}
