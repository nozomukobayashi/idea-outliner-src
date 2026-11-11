/**
 * DESIGN.md §9 の確認項目 #1〜#4 を実際の API で試す。
 * ログは開発者向けの診断出力（UI 文言ではない）。
 */
import { detectTokenKind, GitHubApiError, type GitHubClient } from '../github/client';
import { describeBodyDiff, repoToString, type RepoRef } from './util';

export type CheckStatus = 'ok' | 'warn' | 'ng' | 'skip';

export interface CheckOutcome {
  status: CheckStatus;
  summary: string;
}

export interface CheckContext {
  client: GitHubClient;
  token: string;
  ideasRepo: RepoRef | null;
  issuesRepo: RepoRef | null;
  crossRepo: RepoRef | null;
  /** 検証で作った Discussion / Issue を後片付けするか */
  cleanup: boolean;
  log: (line: string) => void;
  /** 実行中のページの origin（CORS の確認用） */
  origin: string;
}

export const TITLE_PREFIX = '[idea-outliner spike]';
const SUB_ISSUES_HEADERS = { 'GraphQL-Features': 'sub_issues' };

const errText = (e: unknown): string => (e instanceof GitHubApiError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : String(e));

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ #1 */

export async function checkCorsAndViewer(ctx: CheckContext): Promise<CheckOutcome> {
  const { client, log } = ctx;
  log(`実行元 origin: ${ctx.origin}`);
  log(`接続先: ${client.connection.kind}（GraphQL: ${client.connection.graphqlUrl}）`);
  log(`トークンの種類（接頭辞から推定）: ${detectTokenKind(ctx.token)}`);

  let login: string;
  try {
    const r = await client.graphqlRaw<{ viewer: { login: string }; rateLimit: { limit: number; remaining: number } | null }>(
      'query { viewer { login } rateLimit { limit remaining } }',
    );
    if (r.errors.length > 0 || !r.data) {
      log(`GraphQL エラー: ${r.errors.map((e) => e.message).join(' / ')}`);
      return { status: 'ng', summary: 'GraphQL には到達したが viewer を取得できなかった' };
    }
    login = r.data.viewer.login;
    log(`viewer.login: ${login}`);
    if (r.data.rateLimit) log(`rateLimit: ${r.data.rateLimit.remaining}/${r.data.rateLimit.limit}`);
    const scopes = r.headers.get('x-oauth-scopes');
    log(`X-OAuth-Scopes: ${scopes ?? '（取得できず。fine-grained PAT か、CORS で公開されていないヘッダー）'}`);
    const ver = r.headers.get('x-github-enterprise-version');
    if (ver) log(`X-GitHub-Enterprise-Version: ${ver}`);
  } catch (e) {
    log(`失敗: ${errText(e)}`);
    if (e instanceof GitHubApiError && e.kind === 'network') {
      return { status: 'ng', summary: 'ブラウザから API に接続できない（CORS 拒否の可能性。開発者ツールのコンソールを確認）' };
    }
    if (e instanceof GitHubApiError && e.status === 401) {
      return { status: 'ng', summary: 'API には到達したがトークンが無効（401）。CORS は通っている' };
    }
    return { status: 'ng', summary: 'viewer の取得に失敗' };
  }

  // REST も同じ origin から呼べるか。GHES ならバージョンも分かる
  try {
    const meta = await client.rest<{ installed_version?: string }>('GET', '/meta');
    log(`REST /meta: OK${meta.data?.installed_version ? `（installed_version: ${meta.data.installed_version}）` : ''}`);
  } catch (e) {
    log(`REST /meta: 失敗 ${errText(e)}`);
    return { status: 'warn', summary: `GraphQL は OK（${login}）、REST は失敗` };
  }
  return { status: 'ok', summary: `GraphQL・REST とも OK（viewer: ${login}）` };
}

/* ------------------------------------------------------------------ #2 */

interface RepoForDiscussions {
  repository: {
    id: string;
    hasDiscussionsEnabled: boolean;
    viewerPermission: string | null;
    discussionCategories: { nodes: { id: string; name: string; slug: string; isAnswerable: boolean }[] };
  } | null;
}

const DISCUSSION_FIELDS = 'id number url updatedAt lastEditedAt body';

/** §4.1 の形式に近い本文（他人の Issue に言及しないよう owner/repo#n は入れない） */
export function sampleNoteBody(): string {
  return [
    '<!-- idea-outliner:v1 {"spike":true} -->',
    '',
    '- 初回ログイン後の体験 <!-- id:k3f9 -->',
    '  - [ ] チュートリアルを3ステップに短縮 <!-- id:p2a1 -->',
    '    - [ ] スキップボタンを常時表示 <!-- id:x8d0 -->',
    '  - サンプルデータを最初から入れておく <!-- id:q1z5 -->',
    '- 管理者向け <!-- id:a9b2 -->',
    '  - [x] SSO 設定ガイドを書く <!-- id:t6e3 -->',
    '',
    'リストではない段落（メモブロック）。**太字** と `code` を含む。',
    '',
  ].join('\n');
}

export function sampleCommentBody(): string {
  return ['<!-- idea-outliner:ref id:q1z5 -->', '> サンプルデータを最初から入れておく', '', 'スパイク検証用のコメントです。', ''].join('\n');
}

export async function checkDiscussions(ctx: CheckContext): Promise<CheckOutcome> {
  const { client, log } = ctx;
  if (!ctx.ideasRepo) return { status: 'skip', summary: 'アイディア用リポジトリが未入力' };
  const repo = ctx.ideasRepo;

  // 1. リポジトリとカテゴリ
  let repoId: string;
  let categoryId: string;
  try {
    const d = await client.graphql<RepoForDiscussions>(
      `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id hasDiscussionsEnabled viewerPermission
          discussionCategories(first: 50) { nodes { id name slug isAnswerable } }
        }
      }`,
      { owner: repo.owner, name: repo.name },
    );
    if (!d.repository) return { status: 'ng', summary: 'リポジトリが見つからない' };
    log(`hasDiscussionsEnabled: ${d.repository.hasDiscussionsEnabled} / viewerPermission: ${d.repository.viewerPermission}`);
    if (!d.repository.hasDiscussionsEnabled) return { status: 'ng', summary: 'Discussions が無効なリポジトリ' };
    const cats = d.repository.discussionCategories.nodes;
    log(`カテゴリ: ${cats.map((c) => `${c.name}(${c.slug}${c.isAnswerable ? ', Q&A' : ''})`).join(', ') || '（なし）'}`);
    const pick =
      cats.find((c) => ['ideas', 'general'].includes(c.slug)) ??
      cats.find((c) => !c.isAnswerable && c.slug !== 'announcements') ??
      cats[0];
    if (!pick) return { status: 'ng', summary: 'カテゴリが 1 つもない' };
    repoId = d.repository.id;
    categoryId = pick.id;
    log(`使用するカテゴリ: ${pick.name}`);
  } catch (e) {
    log(`リポジトリ取得失敗: ${errText(e)}`);
    return { status: 'ng', summary: 'リポジトリ・カテゴリの取得に失敗' };
  }

  // 2. 作成
  type D = { id: string; number: number; url: string; updatedAt: string; lastEditedAt: string | null; body: string };
  let disc: D;
  const body1 = sampleNoteBody();
  try {
    const r = await client.graphql<{ createDiscussion: { discussion: D } }>(
      `mutation($input: CreateDiscussionInput!) { createDiscussion(input: $input) { discussion { ${DISCUSSION_FIELDS} } } }`,
      { input: { repositoryId: repoId, categoryId, title: `${TITLE_PREFIX} 検証用ノート ${stamp()}`, body: body1 } },
    );
    disc = r.createDiscussion.discussion;
    log(`createDiscussion: OK #${disc.number} ${disc.url}`);
    for (const n of describeBodyDiff(body1, disc.body).notes) log(`  本文の往復（作成）: ${n}`);
  } catch (e) {
    log(`createDiscussion 失敗: ${errText(e)}`);
    return { status: 'ng', summary: 'Discussion を作成できない' };
  }

  const problems: string[] = [];
  try {
    // 3. 更新（updatedAt の変化を見るため 1 秒以上空ける）
    await sleep(1500);
    const body2 = body1.replace('- 管理者向け', '- 管理者向け（更新）');
    const u = await client.graphql<{ updateDiscussion: { discussion: D } }>(
      `mutation($input: UpdateDiscussionInput!) { updateDiscussion(input: $input) { discussion { ${DISCUSSION_FIELDS} } } }`,
      { input: { discussionId: disc.id, body: body2 } },
    );
    const after = u.updateDiscussion.discussion;
    log(`updateDiscussion: OK updatedAt ${disc.updatedAt} → ${after.updatedAt} / lastEditedAt ${disc.lastEditedAt} → ${after.lastEditedAt}`);
    if (after.updatedAt === disc.updatedAt) problems.push('本文を更新しても updatedAt が変わらない（§5 の競合検知に使えない）');
    for (const n of describeBodyDiff(body2, after.body).notes) log(`  本文の往復（更新）: ${n}`);

    // 4. 保存直前の updatedAt 取得（§5 手順 2）
    const q = await client.graphql<{ node: { updatedAt: string; lastEditedAt: string | null; body: string } | null }>(
      'query($id: ID!) { node(id: $id) { ... on Discussion { updatedAt lastEditedAt body } } }',
      { id: disc.id },
    );
    log(`再取得: updatedAt ${q.node?.updatedAt} / lastEditedAt ${q.node?.lastEditedAt}`);

    // 5. コメント
    await sleep(1500);
    const cbody = sampleCommentBody();
    const c = await client.graphql<{ addDiscussionComment: { comment: { id: string; url: string; body: string } } }>(
      'mutation($input: AddDiscussionCommentInput!) { addDiscussionComment(input: $input) { comment { id url body } } }',
      { input: { discussionId: disc.id, body: cbody } },
    );
    log(`addDiscussionComment: OK ${c.addDiscussionComment.comment.url}`);
    for (const n of describeBodyDiff(cbody, c.addDiscussionComment.comment.body).notes) log(`  本文の往復（コメント）: ${n}`);

    // 6. コメントの読み出しと、コメントで Discussion の updatedAt が動くか
    const q2 = await client.graphql<{
      node: { updatedAt: string; lastEditedAt: string | null; comments: { totalCount: number; nodes: { body: string }[] } } | null;
    }>(
      'query($id: ID!) { node(id: $id) { ... on Discussion { updatedAt lastEditedAt comments(first: 10) { totalCount nodes { body } } } } }',
      { id: disc.id },
    );
    const found = q2.node?.comments.nodes.some((n) => n.body.includes('idea-outliner:ref id:q1z5'));
    log(`コメント読み出し: totalCount ${q2.node?.comments.totalCount}、ref コメント ${found ? 'あり' : 'なし'}`);
    if (!found) problems.push('投稿したコメントの ref が読み出せない');
    if (q2.node && q.node && q2.node.updatedAt !== q.node.updatedAt) {
      log(`注意: コメント追加で Discussion の updatedAt が変わった（${q.node.updatedAt} → ${q2.node.updatedAt}）。§5 では本文比較も併用する`);
    } else {
      log('コメント追加では Discussion の updatedAt は変わらない');
    }
    if (q2.node && q.node) {
      log(
        q2.node.lastEditedAt === q.node.lastEditedAt
          ? `コメント追加では lastEditedAt は変わらない（${q2.node.lastEditedAt}）。本文の変更検知に使える可能性`
          : `コメント追加で lastEditedAt も変わった（${q.node.lastEditedAt} → ${q2.node.lastEditedAt}）`,
      );
    }
  } catch (e) {
    log(`失敗: ${errText(e)}`);
    problems.push('更新またはコメントで失敗');
  }

  // 7. 後片付け
  if (ctx.cleanup) {
    try {
      await client.graphql('mutation($id: ID!) { deleteDiscussion(input: { id: $id }) { clientMutationId } }', { id: disc.id });
      log('deleteDiscussion: OK（後片付け済み）');
    } catch (e) {
      log(`deleteDiscussion 失敗（手動で削除してください: ${disc.url}）: ${errText(e)}`);
    }
  } else {
    log(`後片付けなし: ${disc.url}`);
  }

  if (problems.length > 0) return { status: 'ng', summary: problems.join(' / ') };
  return { status: 'ok', summary: '作成・更新・コメント・読み出しすべて OK' };
}

/* ------------------------------------------------------------------ #3, #4 */

interface CreatedIssue {
  id: string; // node id
  databaseId: number;
  number: number;
  url: string;
  repo: RepoRef;
}

async function getRepoId(client: GitHubClient, repo: RepoRef): Promise<string> {
  const d = await client.graphql<{ repository: { id: string; hasIssuesEnabled: boolean } | null }>(
    'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id hasIssuesEnabled } }',
    { owner: repo.owner, name: repo.name },
  );
  if (!d.repository) throw new Error(`リポジトリが見つからない: ${repoToString(repo)}`);
  if (!d.repository.hasIssuesEnabled) throw new Error(`Issues が無効: ${repoToString(repo)}`);
  return d.repository.id;
}

async function createIssueGql(client: GitHubClient, repoId: string, repo: RepoRef, title: string): Promise<CreatedIssue> {
  const r = await client.graphql<{ createIssue: { issue: { id: string; databaseId: number; number: number; url: string } } }>(
    'mutation($input: CreateIssueInput!) { createIssue(input: $input) { issue { id databaseId number url } } }',
    { input: { repositoryId: repoId, title: `${TITLE_PREFIX} ${title} ${stamp()}`, body: 'Idea Outliner のスパイク検証で作成した Issue です。' } },
  );
  return { ...r.createIssue.issue, repo };
}

async function createIssueRest(client: GitHubClient, repo: RepoRef, title: string): Promise<CreatedIssue> {
  const r = await client.rest<{ id: number; node_id: string; number: number; html_url: string }>(
    'POST',
    `/repos/${repo.owner}/${repo.name}/issues`,
    { title: `${TITLE_PREFIX} ${title} ${stamp()}`, body: 'Idea Outliner のスパイク検証で作成した Issue です（REST）。' },
  );
  return { id: r.data.node_id, databaseId: r.data.id, number: r.data.number, url: r.data.html_url, repo };
}

async function addSubIssueGql(client: GitHubClient, parent: CreatedIssue, child: CreatedIssue): Promise<void> {
  await client.graphql(
    'mutation($input: AddSubIssueInput!) { addSubIssue(input: $input) { issue { number } subIssue { number } } }',
    { input: { issueId: parent.id, subIssueId: child.id } },
    { headers: SUB_ISSUES_HEADERS },
  );
}

async function addSubIssueRest(client: GitHubClient, parent: CreatedIssue, child: CreatedIssue): Promise<void> {
  await client.rest('POST', `/repos/${parent.repo.owner}/${parent.repo.name}/issues/${parent.number}/sub_issues`, {
    sub_issue_id: child.databaseId,
  });
}

async function listSubIssuesGql(client: GitHubClient, parent: CreatedIssue): Promise<string[]> {
  const d = await client.graphql<{
    node: { subIssues: { nodes: { number: number; repository: { nameWithOwner: string } }[] } } | null;
  }>(
    'query($id: ID!) { node(id: $id) { ... on Issue { subIssues(first: 20) { nodes { number repository { nameWithOwner } } } } } }',
    { id: parent.id },
    { headers: SUB_ISSUES_HEADERS },
  );
  return (d.node?.subIssues.nodes ?? []).map((n) => `${n.repository.nameWithOwner}#${n.number}`);
}

async function closeIssues(ctx: CheckContext, issues: CreatedIssue[]): Promise<void> {
  if (!ctx.cleanup) {
    for (const i of issues) ctx.log(`後片付けなし: ${i.url}`);
    return;
  }
  for (const i of issues) {
    try {
      await ctx.client.graphql('mutation($id: ID!) { closeIssue(input: { issueId: $id, stateReason: NOT_PLANNED }) { clientMutationId } }', {
        id: i.id,
      });
      ctx.log(`クローズ: ${i.url}`);
    } catch (e) {
      ctx.log(`クローズ失敗（手動で閉じてください: ${i.url}）: ${errText(e)}`);
    }
  }
}

export async function checkSubIssuesSameRepo(ctx: CheckContext): Promise<CheckOutcome> {
  const { client, log } = ctx;
  const repo = ctx.issuesRepo ?? ctx.ideasRepo;
  if (!repo) return { status: 'skip', summary: 'Issue 用リポジトリが未入力' };
  log(`対象: ${repoToString(repo)}`);

  const created: CreatedIssue[] = [];
  let gqlOk = false;
  let restOk = false;
  try {
    const repoId = await getRepoId(client, repo);
    const parent = await createIssueGql(client, repoId, repo, '親');
    created.push(parent);
    log(`親 Issue: #${parent.number}`);

    // GraphQL
    try {
      const child = await createIssueGql(client, repoId, repo, '子（GraphQL）');
      created.push(child);
      await addSubIssueGql(client, parent, child);
      log(`addSubIssue (GraphQL): OK #${parent.number} ← #${child.number}`);
      gqlOk = true;
    } catch (e) {
      log(`addSubIssue (GraphQL): 失敗 ${errText(e)}`);
    }

    // REST
    try {
      const child = await createIssueRest(client, repo, '子（REST）');
      created.push(child);
      await addSubIssueRest(client, parent, child);
      log(`POST .../sub_issues (REST): OK #${parent.number} ← #${child.number}`);
      restOk = true;
    } catch (e) {
      log(`POST .../sub_issues (REST): 失敗 ${errText(e)}`);
    }

    // 読み出し
    try {
      log(`subIssues (GraphQL): ${(await listSubIssuesGql(client, parent)).join(', ') || '（なし）'}`);
    } catch (e) {
      log(`subIssues (GraphQL) 読み出し失敗: ${errText(e)}`);
    }
    try {
      const r = await client.rest<{ number: number }[]>('GET', `/repos/${repo.owner}/${repo.name}/issues/${parent.number}/sub_issues`);
      log(`sub_issues (REST): ${r.data.map((i) => `#${i.number}`).join(', ') || '（なし）'}`);
    } catch (e) {
      log(`sub_issues (REST) 読み出し失敗: ${errText(e)}`);
    }

    // Issue チップ用: 状態をまとめて取得できるか（§4.3）
    try {
      const d = await client.graphql<{ nodes: ({ number: number; state: string } | null)[] }>(
        'query($ids: [ID!]!) { nodes(ids: $ids) { ... on Issue { number state } } }',
        { ids: created.map((c) => c.id) },
      );
      log(`状態の一括取得: ${d.nodes.map((n) => (n ? `#${n.number}=${n.state}` : 'null')).join(', ')}`);
    } catch (e) {
      log(`状態の一括取得失敗: ${errText(e)}`);
    }
  } catch (e) {
    log(`失敗: ${errText(e)}`);
    await closeIssues(ctx, created);
    return { status: 'ng', summary: 'Issue の作成に失敗' };
  }

  await closeIssues(ctx, created);
  if (gqlOk && restOk) return { status: 'ok', summary: 'サブイシューの紐づけ: GraphQL・REST とも OK' };
  if (gqlOk || restOk) return { status: 'warn', summary: `サブイシューの紐づけ: ${gqlOk ? 'GraphQL のみ' : 'REST のみ'} OK` };
  return { status: 'ng', summary: 'サブイシューの紐づけ不可 → 本文リンク方式にフォールバック' };
}

export async function checkSubIssuesCrossRepo(ctx: CheckContext): Promise<CheckOutcome> {
  const { client, log } = ctx;
  const repoA = ctx.issuesRepo ?? ctx.ideasRepo;
  const repoB = ctx.crossRepo;
  if (!repoA || !repoB) return { status: 'skip', summary: '別リポジトリが未入力' };
  log(`親: ${repoToString(repoA)} / 子: ${repoToString(repoB)}`);

  const created: CreatedIssue[] = [];
  let via: string | null = null;
  try {
    const parent = await createIssueGql(client, await getRepoId(client, repoA), repoA, '親（リポジトリ間）');
    created.push(parent);
    const child = await createIssueGql(client, await getRepoId(client, repoB), repoB, '子（別リポジトリ）');
    created.push(child);
    log(`親 #${parent.number} / 子 ${repoToString(repoB)}#${child.number}`);
    try {
      await addSubIssueGql(client, parent, child);
      log('addSubIssue (GraphQL): OK');
      via = 'GraphQL';
    } catch (e) {
      log(`addSubIssue (GraphQL): 失敗 ${errText(e)}`);
      try {
        await addSubIssueRest(client, parent, child);
        log('POST .../sub_issues (REST): OK');
        via = 'REST';
      } catch (e2) {
        log(`POST .../sub_issues (REST): 失敗 ${errText(e2)}`);
      }
    }
    if (via) {
      try {
        log(`subIssues: ${(await listSubIssuesGql(client, parent)).join(', ')}`);
      } catch (e) {
        log(`subIssues 読み出し失敗: ${errText(e)}`);
      }
    }
  } catch (e) {
    log(`失敗: ${errText(e)}`);
    await closeIssues(ctx, created);
    return { status: 'ng', summary: 'Issue の作成に失敗' };
  }
  await closeIssues(ctx, created);
  return via
    ? { status: 'ok', summary: `リポジトリをまたいだサブイシュー OK（${via}）` }
    : { status: 'ng', summary: 'リポジトリをまたいだサブイシュー不可 → 同一リポジトリのみサブイシュー化' };
}
