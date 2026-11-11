/**
 * GitHub / GHES API クライアント。API 呼び出しはすべてここを通す。
 *
 * - URL は Connection から組み立てる（api.github.com を直書きしない）
 * - トークンはエラーメッセージ・例外に絶対に含めない（念のため本文からも伏せ字にする）
 */
import type { Connection } from '../config/connection';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GitHubApiErrorKind =
  /** fetch 自体が失敗（CORS 拒否・名前解決失敗・オフラインなど。ブラウザは理由を区別させてくれない） */
  | 'network'
  /** HTTP ステータスがエラー */
  | 'http'
  /** HTTP 200 だが GraphQL の errors が返った */
  | 'graphql';

export interface GraphQLErrorItem {
  type?: string;
  message: string;
  path?: (string | number)[];
}

export class GitHubApiError extends Error {
  readonly kind: GitHubApiErrorKind;
  readonly status?: number;
  readonly graphqlErrors?: GraphQLErrorItem[];

  constructor(kind: GitHubApiErrorKind, message: string, opts: { status?: number; graphqlErrors?: GraphQLErrorItem[] } = {}) {
    super(message);
    this.name = 'GitHubApiError';
    this.kind = kind;
    this.status = opts.status;
    this.graphqlErrors = opts.graphqlErrors;
  }
}

export interface RestResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface RequestOptions {
  /** 追加のリクエストヘッダー（GraphQL-Features など）。Authorization は上書きできない */
  headers?: Record<string, string>;
}

export interface GitHubClient {
  readonly connection: Connection;
  graphql<T>(query: string, variables?: Record<string, unknown>, opts?: RequestOptions): Promise<T>;
  /** GraphQL の生レスポンス（data と errors の両方）とヘッダーを返す。部分成功を調べたいとき用 */
  graphqlRaw<T>(
    query: string,
    variables?: Record<string, unknown>,
    opts?: RequestOptions,
  ): Promise<{ data: T | null; errors: GraphQLErrorItem[]; headers: Headers }>;
  rest<T>(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<RestResponse<T>>;
}

const REST_API_VERSION = '2022-11-28';

export function createGitHubClient(connection: Connection, token: string, fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)): GitHubClient {
  const redact = (s: string): string => (token ? s.split(token).join('***') : s);

  const baseHeaders = (): Record<string, string> => ({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
  });

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, init);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new GitHubApiError(
        'network',
        redact(`API に接続できませんでした（${detail}）。CORS で拒否されたか、ホストに到達できない可能性があります`),
      );
    }
  }

  async function readBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (text === '') return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  function httpError(res: Response, body: unknown): GitHubApiError {
    let msg = `HTTP ${res.status}`;
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
      msg += `: ${body.message}`;
    } else if (typeof body === 'string' && body.length > 0) {
      msg += `: ${body.slice(0, 200)}`;
    }
    return new GitHubApiError('http', redact(msg), { status: res.status });
  }

  function mergeHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...baseHeaders() };
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (k.toLowerCase() === 'authorization') continue;
      h[k] = v;
    }
    return h;
  }

  const client: GitHubClient = {
    connection,

    async graphqlRaw<T>(query: string, variables: Record<string, unknown> = {}, opts: RequestOptions = {}) {
      const res = await send(connection.graphqlUrl, {
        method: 'POST',
        headers: { ...mergeHeaders(opts.headers), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      const body = await readBody(res);
      if (!res.ok) throw httpError(res, body);
      const obj = (body ?? {}) as { data?: T | null; errors?: GraphQLErrorItem[] };
      const errors = (obj.errors ?? []).map((e) => ({ ...e, message: redact(e.message) }));
      return { data: obj.data ?? null, errors, headers: res.headers };
    },

    async graphql<T>(query: string, variables: Record<string, unknown> = {}, opts: RequestOptions = {}) {
      const { data, errors } = await client.graphqlRaw<T>(query, variables, opts);
      if (errors.length > 0) {
        const msg = errors.map((e) => (e.type ? `[${e.type}] ${e.message}` : e.message)).join(' / ');
        throw new GitHubApiError('graphql', msg, { graphqlErrors: errors });
      }
      if (data === null) throw new GitHubApiError('graphql', 'GraphQL のレスポンスに data がありません');
      return data;
    },

    async rest<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}) {
      const url = connection.restBaseUrl + (path.startsWith('/') ? path : `/${path}`);
      const headers: Record<string, string> = { ...mergeHeaders(opts.headers), 'X-GitHub-Api-Version': REST_API_VERSION };
      const init: RequestInit = { method, headers };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const res = await send(url, init);
      const data = await readBody(res);
      if (!res.ok) throw httpError(res, data);
      return { status: res.status, data: data as T, headers: res.headers };
    },
  };
  return client;
}

/** トークンの種類を接頭辞から推定する（値そのものは扱わない） */
export type TokenKind = 'fine-grained' | 'classic' | 'oauth' | 'app' | 'unknown';

export function detectTokenKind(token: string): TokenKind {
  if (token.startsWith('github_pat_')) return 'fine-grained';
  if (token.startsWith('ghp_')) return 'classic';
  if (token.startsWith('gho_')) return 'oauth';
  if (token.startsWith('ghs_') || token.startsWith('ghu_')) return 'app';
  return 'unknown';
}
