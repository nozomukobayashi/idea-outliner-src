/**
 * アプリで使う GitHub のデータ取得。通信はすべて GitHubClient を通す。
 * GitHub から返る文字列（タイトル・本文など）は信頼できない入力として扱い、表示側でサニタイズする。
 */
import type { IssueRef } from '../note/issueRefs';
import { refKey } from '../note/issueRefs';
import { GitHubApiError, type GitHubClient, type GraphQLErrorItem } from './client';

export interface RepoName {
  owner: string;
  name: string;
}

export interface RepoSuggestion {
  nameWithOwner: string;
  hasDiscussionsEnabled: boolean;
  hasIssuesEnabled: boolean;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
  slug: string;
}

export interface Workspace {
  id: string;
  nameWithOwner: string;
  url: string;
  hasDiscussionsEnabled: boolean;
  viewerPermission: string | null;
  categories: Category[];
}

export interface NoteSummary {
  id: string;
  number: number;
  title: string;
  updatedAt: string;
  url: string;
  categoryId: string;
  author: string | null;
}

export interface Note extends NoteSummary {
  body: string;
  commentCount: number;
  /** 本文を編集できるか */
  canEdit: boolean;
}

export type IssueState = 'open' | 'closed' | 'not_planned' | 'merged';

export interface IssueInfo {
  state: IssueState;
  title: string;
  url: string;
}

const MAX_REPO_PAGES = 10; // 100 件 × 10 ページまで
const REPO_NODES = 'nodes { nameWithOwner hasDiscussionsEnabled hasIssuesEnabled } pageInfo { hasNextPage endCursor }';

interface RepoPage {
  nodes: (RepoSuggestion | null)[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

async function collectRepos(fetchPage: (after: string | null) => Promise<RepoPage | null>): Promise<RepoSuggestion[]> {
  const repos: RepoSuggestion[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_REPO_PAGES; page++) {
    const conn: RepoPage | null = await fetchPage(after);
    if (!conn) break;
    for (const n of conn.nodes) if (n) repos.push(n);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return repos;
}

/**
 * 自分が関わっているリポジトリ（ワークスペース選択の候補）。更新が新しい順。
 * ownerAffiliations の既定は [OWNER, COLLABORATOR] なので、組織のリポジトリを含めるには明示が要る。
 */
export function listViewerRepos(client: GitHubClient): Promise<RepoSuggestion[]> {
  return collectRepos(async (after) => {
    const d = await client.graphql<{ viewer: { repositories: RepoPage } }>(
      `query($after: String) {
        viewer {
          repositories(first: 100, after: $after, orderBy: { field: UPDATED_AT, direction: DESC },
                       ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
                       affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
            ${REPO_NODES}
          }
        }
      }`,
      { after },
    );
    return d.viewer.repositories;
  });
}

/** 指定した owner のリポジトリのうち、自分が見られるもの（メンバーでない組織の internal など）。owner がなければ空 */
export function listOwnerRepos(client: GitHubClient, owner: string): Promise<RepoSuggestion[]> {
  return collectRepos(async (after) => {
    const { data } = await client.graphqlRaw<{ repositoryOwner: { repositories: RepoPage } | null }>(
      `query($owner: String!, $after: String) {
        repositoryOwner(login: $owner) {
          repositories(first: 100, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
            ${REPO_NODES}
          }
        }
      }`,
      { owner, after },
    );
    return data?.repositoryOwner?.repositories ?? null;
  });
}

/**
 * GitHub は見えないリポジトリを NOT_FOUND のエラーで返す。これは「ない」として扱い、それ以外のエラーは例外にする。
 * （権限のないトークンでも同じ応答になるので、画面ではトークンの確認を案内する）
 */
function throwUnlessNotFound(errors: GraphQLErrorItem[]): void {
  if (errors.every((e) => e.type === 'NOT_FOUND')) return;
  throw new GitHubApiError('graphql', errors.map((e) => (e.type ? `[${e.type}] ${e.message}` : e.message)).join(' / '), { graphqlErrors: errors });
}

export async function getWorkspace(client: GitHubClient, repo: RepoName): Promise<Workspace | null> {
  const { data: d, errors } = await client.graphqlRaw<{
    repository: (Omit<Workspace, 'categories'> & { discussionCategories: { nodes: Category[] } }) | null;
  }>(
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id nameWithOwner url hasDiscussionsEnabled viewerPermission
        discussionCategories(first: 100) { nodes { id name emoji slug } }
      }
    }`,
    { owner: repo.owner, name: repo.name },
  );
  if (!d?.repository) {
    throwUnlessNotFound(errors);
    return null;
  }
  const { discussionCategories, ...rest } = d.repository;
  return { ...rest, categories: discussionCategories.nodes };
}

const MAX_NOTE_PAGES = 10; // 100 件 × 10 ページまで

interface RawNoteSummary {
  id: string;
  number: number;
  title: string;
  updatedAt: string;
  url: string;
  category: { id: string } | null;
  author: { login: string } | null;
}

const toSummary = (n: RawNoteSummary): NoteSummary => ({
  id: n.id,
  number: n.number,
  title: n.title,
  updatedAt: n.updatedAt,
  url: n.url,
  categoryId: n.category?.id ?? '',
  author: n.author?.login ?? null,
});

/** ノート（Discussion）の一覧。更新が新しい順 */
export async function listNotes(client: GitHubClient, repo: RepoName): Promise<{ notes: NoteSummary[]; truncated: boolean }> {
  const notes: NoteSummary[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_NOTE_PAGES; page++) {
    const d: {
      repository: {
        discussions: { nodes: (RawNoteSummary | null)[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
      } | null;
    } = await client.graphql(
      `query($owner: String!, $name: String!, $after: String) {
        repository(owner: $owner, name: $name) {
          discussions(first: 100, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes { id number title updatedAt url category { id } author { login } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { owner: repo.owner, name: repo.name, after },
    );
    if (!d.repository) break;
    const conn = d.repository.discussions;
    for (const n of conn.nodes) if (n) notes.push(toSummary(n));
    if (!conn.pageInfo.hasNextPage) return { notes, truncated: false };
    after = conn.pageInfo.endCursor;
  }
  return { notes, truncated: after !== null };
}

export async function getNote(client: GitHubClient, repo: RepoName, number: number): Promise<Note | null> {
  const { data: d, errors } = await client.graphqlRaw<{
    repository: { discussion: (RawNoteSummary & { body: string; viewerCanUpdate: boolean; comments: { totalCount: number } }) | null } | null;
  }>(
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        discussion(number: $number) {
          id number title updatedAt url body viewerCanUpdate category { id } author { login } comments { totalCount }
        }
      }
    }`,
    { owner: repo.owner, name: repo.name, number },
  );
  const n = d?.repository?.discussion;
  if (!n) {
    throwUnlessNotFound(errors);
    return null;
  }
  return { ...toSummary(n), body: n.body, commentCount: n.comments.totalCount, canEdit: n.viewerCanUpdate };
}

/** 保存直前に最新の本文を取る（DESIGN.md §5）。ノートが消えていたら null */
export async function getNoteBody(client: GitHubClient, noteId: string): Promise<string | null> {
  const d = await client.graphql<{ node: { body?: string } | null }>('query($id: ID!) { node(id: $id) { ... on Discussion { body } } }', { id: noteId });
  return d.node?.body ?? null;
}

/** 本文を更新し、GitHub が保存した本文を返す */
export async function updateNoteBody(client: GitHubClient, noteId: string, body: string): Promise<string> {
  const d = await client.graphql<{ updateDiscussion: { discussion: { body: string } } }>(
    'mutation($input: UpdateDiscussionInput!) { updateDiscussion(input: $input) { discussion { body } } }',
    { input: { discussionId: noteId, body } },
  );
  return d.updateDiscussion.discussion.body;
}

/** ノートを作り、番号を返す */
export async function createNote(client: GitHubClient, input: { repositoryId: string; categoryId: string; title: string; body: string }): Promise<number> {
  const d = await client.graphql<{ createDiscussion: { discussion: { number: number } } }>(
    'mutation($input: CreateDiscussionInput!) { createDiscussion(input: $input) { discussion { number } } }',
    { input },
  );
  return d.createDiscussion.discussion.number;
}

/* ------------------------------------------------------------ コメント */

export interface NoteReply {
  id: string;
  url: string;
  body: string;
  author: string | null;
  createdAt: string;
  isMinimized: boolean;
}

export interface NoteComment extends NoteReply {
  replies: NoteReply[];
  /** GitHub 上の返信の総数（表示しきれない分があるか判定する） */
  replyCount: number;
}

interface RawReply {
  id: string;
  url: string;
  body: string;
  author: { login: string } | null;
  createdAt: string;
  isMinimized: boolean;
}

const toReply = (r: RawReply): NoteReply => ({ id: r.id, url: r.url, body: r.body, author: r.author?.login ?? null, createdAt: r.createdAt, isMinimized: r.isMinimized });

const COMMENT_FIELDS = 'id url body createdAt isMinimized author { login }';
const MAX_COMMENT_PAGES = 10; // 100 件 × 10 ページまで

/** ノートのコメント（古い順）と、その返信 */
export async function listComments(client: GitHubClient, noteId: string): Promise<{ comments: NoteComment[]; truncated: boolean }> {
  const comments: NoteComment[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const d: {
      node: {
        comments?: {
          nodes: ((RawReply & { replies: { totalCount: number; nodes: (RawReply | null)[] } }) | null)[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } | null;
    } = await client.graphql(
      `query($id: ID!, $after: String) {
        node(id: $id) {
          ... on Discussion {
            comments(first: 100, after: $after) {
              nodes { ${COMMENT_FIELDS} replies(first: 50) { totalCount nodes { ${COMMENT_FIELDS} } } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }`,
      { id: noteId, after },
    );
    const conn = d.node?.comments;
    if (!conn) break;
    for (const c of conn.nodes) {
      if (!c) continue;
      comments.push({ ...toReply(c), replies: c.replies.nodes.flatMap((r) => (r ? [toReply(r)] : [])), replyCount: c.replies.totalCount });
    }
    if (!conn.pageInfo.hasNextPage) return { comments, truncated: false };
    after = conn.pageInfo.endCursor;
  }
  return { comments, truncated: after !== null };
}

export async function addComment(client: GitHubClient, noteId: string, body: string): Promise<void> {
  await client.graphql('mutation($input: AddDiscussionCommentInput!) { addDiscussionComment(input: $input) { comment { id } } }', {
    input: { discussionId: noteId, body },
  });
}

/* ------------------------------------------------------------ Issue の作成 */

const SUB_ISSUES_HEADERS = { 'GraphQL-Features': 'sub_issues' };

export interface Label {
  id: string;
  name: string;
}

export interface IssueTarget {
  id: string;
  nameWithOwner: string;
  hasIssuesEnabled: boolean;
  labels: Label[];
}

/** Issue の作成先の情報。見つからなければ null */
export async function getIssueTarget(client: GitHubClient, repo: RepoName): Promise<IssueTarget | null> {
  const { data, errors } = await client.graphqlRaw<{
    repository: { id: string; nameWithOwner: string; hasIssuesEnabled: boolean; labels: { nodes: Label[] } | null } | null;
  }>(
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id nameWithOwner hasIssuesEnabled
        labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { id name } }
      }
    }`,
    { owner: repo.owner, name: repo.name },
  );
  const r = data?.repository;
  if (!r) {
    throwUnlessNotFound(errors);
    return null;
  }
  return { id: r.id, nameWithOwner: r.nameWithOwner, hasIssuesEnabled: r.hasIssuesEnabled, labels: r.labels?.nodes ?? [] };
}

export async function createIssue(
  client: GitHubClient,
  input: { repositoryId: string; title: string; body: string; labelIds: string[] },
): Promise<{ id: string; number: number; url: string }> {
  const d = await client.graphql<{ createIssue: { issue: { id: string; number: number; url: string } } }>(
    'mutation($input: CreateIssueInput!) { createIssue(input: $input) { issue { id number url } } }',
    { input },
  );
  return d.createIssue.issue;
}

/** Issue のノード ID。PR など Issue でないものは GraphQL のエラーになる */
export async function getIssueNodeId(client: GitHubClient, ref: IssueRef): Promise<string | null> {
  const d = await client.graphql<{ repository: { issue: { id: string } | null } | null }>(
    'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { id } } }',
    { owner: ref.owner, name: ref.repo, number: ref.number },
  );
  return d.repository?.issue?.id ?? null;
}

export async function addSubIssue(client: GitHubClient, parentId: string, childId: string): Promise<void> {
  await client.graphql(
    'mutation($input: AddSubIssueInput!) { addSubIssue(input: $input) { issue { number } } }',
    { input: { issueId: parentId, subIssueId: childId } },
    { headers: SUB_ISSUES_HEADERS },
  );
}

export async function updateIssueBody(client: GitHubClient, issueId: string, body: string): Promise<void> {
  await client.graphql('mutation($input: UpdateIssueInput!) { updateIssue(input: $input) { issue { id } } }', { input: { id: issueId, body } });
}

/* ------------------------------------------------------------ Issue の状態 */

const REFS_PER_QUERY = 100;

/**
 * Issue の状態をまとめて取得する GraphQL を組み立てる。
 * owner / name は変数で渡し、番号は検証済みの整数だけを埋め込む。
 */
export function buildIssueStatesQuery(refs: IssueRef[]): { query: string; variables: Record<string, string>; aliases: Map<string, string> } {
  const byRepo = new Map<string, { owner: string; repo: string; numbers: Set<number> }>();
  for (const r of refs) {
    if (!Number.isSafeInteger(r.number) || r.number <= 0) continue;
    const k = `${r.owner}/${r.repo}`.toLowerCase();
    const entry = byRepo.get(k) ?? { owner: r.owner, repo: r.repo, numbers: new Set<number>() };
    entry.numbers.add(r.number);
    byRepo.set(k, entry);
  }
  const varDefs: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, string> = {};
  const aliases = new Map<string, string>(); // "rI.nN" → refKey
  let ri = 0;
  for (const { owner, repo, numbers } of byRepo.values()) {
    varDefs.push(`$o${ri}: String!`, `$n${ri}: String!`);
    variables[`o${ri}`] = owner;
    variables[`n${ri}`] = repo;
    const sub = [...numbers].map((num) => {
      aliases.set(`r${ri}.i${num}`, refKey({ owner, repo, number: num }));
      return `i${num}: issueOrPullRequest(number: ${num}) { __typename ...on Issue { state stateReason title url } ...on PullRequest { state title url } }`;
    });
    fields.push(`r${ri}: repository(owner: $o${ri}, name: $n${ri}) { ${sub.join(' ')} }`);
    ri++;
  }
  const query = `query(${varDefs.join(', ')}) { ${fields.join(' ')} }`;
  return { query, variables, aliases };
}

interface RawIssueLike {
  __typename: 'Issue' | 'PullRequest';
  state: string;
  stateReason?: string | null;
  title: string;
  url: string;
}

function toIssueInfo(n: RawIssueLike): IssueInfo {
  let state: IssueState;
  if (n.__typename === 'PullRequest') state = n.state === 'MERGED' ? 'merged' : n.state === 'CLOSED' ? 'closed' : 'open';
  else if (n.state === 'OPEN') state = 'open';
  else state = n.stateReason === 'NOT_PLANNED' ? 'not_planned' : 'closed';
  return { state, title: n.title, url: n.url };
}

/**
 * Issue の状態をまとめて取得する。見つからない・権限がない参照は null。
 * 一部のリポジトリが見つからなくても、取れたものは返す。
 */
export async function fetchIssueStates(client: GitHubClient, refs: IssueRef[]): Promise<Map<string, IssueInfo | null>> {
  const result = new Map<string, IssueInfo | null>();
  for (let i = 0; i < refs.length; i += REFS_PER_QUERY) {
    const chunk = refs.slice(i, i + REFS_PER_QUERY);
    const { query, variables, aliases } = buildIssueStatesQuery(chunk);
    if (aliases.size === 0) continue;
    const { data } = await client.graphqlRaw<Record<string, Record<string, RawIssueLike | null> | null>>(query, variables);
    for (const [alias, key] of aliases) {
      const [r, n] = alias.split('.') as [string, string];
      const node = data?.[r]?.[n] ?? null;
      result.set(key, node ? toIssueInfo(node) : null);
    }
  }
  return result;
}
