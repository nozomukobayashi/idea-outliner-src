import { describe, expect, it, vi } from 'vitest';
import { connectionFromHost } from '../config/connection';
import { createGitHubClient, detectTokenKind, GitHubApiError, type FetchLike } from './client';

const TOKEN = 'ghp_TESTTOKEN0000000000000000000000000000';
const ghes = connectionFromHost('ghe.example.test');
const dotcom = connectionFromHost('github.com');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(res: Response | (() => Promise<Response>)) {
  return vi.fn<FetchLike>(async () => (typeof res === 'function' ? res() : res));
}

async function captureError(p: Promise<unknown>): Promise<GitHubApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof GitHubApiError) return e;
    throw e;
  }
  throw new Error('例外が発生しませんでした');
}

describe('graphql', () => {
  it('接続設定の GraphQL URL に Bearer トークン付きで POST する', async () => {
    const f = mockFetch(jsonResponse(200, { data: { viewer: { login: 'octo' } } }));
    const client = createGitHubClient(ghes, TOKEN, f);
    const data = await client.graphql<{ viewer: { login: string } }>('{ viewer { login } }', { a: 1 });
    expect(data.viewer.login).toBe('octo');

    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://ghe.example.test/api/graphql');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init?.body as string)).toEqual({ query: '{ viewer { login } }', variables: { a: 1 } });
  });

  it('追加ヘッダーで Authorization は上書きできない', async () => {
    const f = mockFetch(jsonResponse(200, { data: {} }));
    const client = createGitHubClient(dotcom, TOKEN, f);
    await client.graphql('{x}', {}, { headers: { authorization: 'evil', 'GraphQL-Features': 'sub_issues' } });
    const headers = f.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.authorization).toBeUndefined();
    expect(headers['GraphQL-Features']).toBe('sub_issues');
  });

  it('errors があれば graphql エラーにする', async () => {
    const f = mockFetch(jsonResponse(200, { data: null, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve' }] }));
    const err = await captureError(createGitHubClient(dotcom, TOKEN, f).graphql('{x}'));
    expect(err.kind).toBe('graphql');
    expect(err.message).toContain('NOT_FOUND');
    expect(err.graphqlErrors).toHaveLength(1);
  });

  it('graphqlRaw は部分成功の data と errors を両方返す', async () => {
    const f = mockFetch(jsonResponse(200, { data: { a: 1 }, errors: [{ message: 'partial' }] }));
    const r = await createGitHubClient(dotcom, TOKEN, f).graphqlRaw<{ a: number }>('{x}');
    expect(r.data).toEqual({ a: 1 });
    expect(r.errors[0]!.message).toBe('partial');
  });
});

describe('rest', () => {
  it('REST ベース URL にパスをつなぎ、API バージョンを付ける', async () => {
    const f = mockFetch(jsonResponse(201, { id: 5 }));
    const r = await createGitHubClient(ghes, TOKEN, f).rest<{ id: number }>('POST', '/repos/o/r/issues', { title: 't' });
    expect(r).toMatchObject({ status: 201, data: { id: 5 } });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://ghe.example.test/api/v3/repos/o/r/issues');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('HTTP エラーはステータスと GitHub のメッセージを含む', async () => {
    const f = mockFetch(jsonResponse(404, { message: 'Not Found' }));
    const err = await captureError(createGitHubClient(dotcom, TOKEN, f).rest('GET', 'repos/o/r'));
    expect(err).toMatchObject({ kind: 'http', status: 404, message: 'HTTP 404: Not Found' });
  });

  it('空のレスポンス（204）を扱える', async () => {
    const f = mockFetch(new Response(null, { status: 204 }));
    const r = await createGitHubClient(dotcom, TOKEN, f).rest('DELETE', '/x');
    expect(r.data).toBeNull();
  });
});

describe('トークンを漏らさない', () => {
  it('ネットワークエラーのメッセージからトークンを伏せる', async () => {
    const f = vi.fn<FetchLike>(async () => {
      throw new TypeError(`Failed to fetch ${TOKEN}`);
    });
    const err = await captureError(createGitHubClient(ghes, TOKEN, f).graphql('{x}'));
    expect(err.kind).toBe('network');
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain('CORS');
  });

  it('HTTP エラー本文にトークンが含まれていても伏せる', async () => {
    const f = mockFetch(jsonResponse(401, { message: `Bad credentials ${TOKEN}` }));
    const err = await captureError(createGitHubClient(ghes, TOKEN, f).rest('GET', '/user'));
    expect(err.message).not.toContain(TOKEN);
  });

  it('GraphQL エラーにトークンが含まれていても伏せる', async () => {
    const f = mockFetch(jsonResponse(200, { errors: [{ message: `x ${TOKEN}` }] }));
    const err = await captureError(createGitHubClient(ghes, TOKEN, f).graphql('{x}'));
    expect(err.message).not.toContain(TOKEN);
    expect(JSON.stringify(err.graphqlErrors)).not.toContain(TOKEN);
  });

  it('URL にトークンを含めない', async () => {
    const f = mockFetch(async () => jsonResponse(200, { data: {} }));
    const c = createGitHubClient(ghes, TOKEN, f);
    await c.graphql('{x}');
    await c.rest('GET', '/user');
    for (const [url] of f.mock.calls) expect(url).not.toContain(TOKEN);
  });
});

describe('detectTokenKind', () => {
  it.each([
    ['github_pat_abc', 'fine-grained'],
    ['ghp_abc', 'classic'],
    ['gho_abc', 'oauth'],
    ['ghs_abc', 'app'],
    ['0123456789abcdef', 'unknown'],
  ])('%s → %s', (t, kind) => {
    expect(detectTokenKind(t)).toBe(kind);
  });
});
