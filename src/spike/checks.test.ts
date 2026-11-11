import { describe, expect, it, vi } from 'vitest';
import { connectionFromHost } from '../config/connection';
import { createGitHubClient, type FetchLike } from '../github/client';
import { checkCorsAndViewer, checkDiscussions, checkSubIssuesCrossRepo, type CheckContext } from './checks';

const TOKEN = 'github_pat_TESTTOKEN';

function ctxWith(fetchImpl: FetchLike, patch: Partial<CheckContext> = {}): { ctx: CheckContext; lines: string[] } {
  const lines: string[] = [];
  const ctx: CheckContext = {
    client: createGitHubClient(connectionFromHost('ghe.example.test'), TOKEN, fetchImpl),
    token: TOKEN,
    ideasRepo: null,
    issuesRepo: null,
    crossRepo: null,
    cleanup: true,
    origin: 'http://localhost:5173',
    log: (l) => lines.push(l),
    ...patch,
  };
  return { ctx, lines };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('checkCorsAndViewer (#1)', () => {
  it('GraphQL と REST が通れば OK。トークンの種類と GHES バージョンを記録する', async () => {
    const f = vi.fn<FetchLike>(async (url) =>
      url.endsWith('/graphql')
        ? json(200, { data: { viewer: { login: 'octo' }, rateLimit: { limit: 5000, remaining: 4999 } } }, { 'X-GitHub-Enterprise-Version': '3.20.8' })
        : json(200, { installed_version: '3.20.8' }),
    );
    const { ctx, lines } = ctxWith(f);
    const r = await checkCorsAndViewer(ctx);
    expect(r.status).toBe('ok');
    expect(lines).toContain('トークンの種類（接頭辞から推定）: fine-grained');
    expect(lines).toContain('X-GitHub-Enterprise-Version: 3.20.8');
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('fetch 自体が失敗したら CORS の可能性として NG', async () => {
    const f = vi.fn<FetchLike>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await checkCorsAndViewer(ctxWith(f).ctx);
    expect(r.status).toBe('ng');
    expect(r.summary).toContain('CORS');
  });

  it('401 は CORS は通っているがトークンが無効', async () => {
    const f = vi.fn<FetchLike>(async () => json(401, { message: 'Bad credentials' }));
    const r = await checkCorsAndViewer(ctxWith(f).ctx);
    expect(r).toMatchObject({ status: 'ng', summary: expect.stringContaining('401') });
  });

  it('REST だけ失敗したら一部 OK', async () => {
    const f = vi.fn<FetchLike>(async (url) =>
      url.endsWith('/graphql') ? json(200, { data: { viewer: { login: 'octo' }, rateLimit: null } }) : json(404, { message: 'Not Found' }),
    );
    expect((await checkCorsAndViewer(ctxWith(f).ctx)).status).toBe('warn');
  });
});

describe('入力不足はスキップ', () => {
  const never = vi.fn<FetchLike>(async () => {
    throw new Error('呼ばれないはず');
  });

  it('#2 はアイディア用リポジトリが必要', async () => {
    expect((await checkDiscussions(ctxWith(never).ctx)).status).toBe('skip');
  });

  it('#4 は別リポジトリが必要', async () => {
    const { ctx } = ctxWith(never, { ideasRepo: { owner: 'o', name: 'r' } });
    expect((await checkSubIssuesCrossRepo(ctx)).status).toBe('skip');
    expect(never).not.toHaveBeenCalled();
  });
});

describe('checkDiscussions (#2)', () => {
  it('Discussions が無効なら NG で、何も作らない', async () => {
    const f = vi.fn<FetchLike>(async () =>
      json(200, { data: { repository: { id: 'R', hasDiscussionsEnabled: false, viewerPermission: 'ADMIN', discussionCategories: { nodes: [] } } } }),
    );
    const r = await checkDiscussions(ctxWith(f, { ideasRepo: { owner: 'o', name: 'r' } }).ctx);
    expect(r.status).toBe('ng');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
