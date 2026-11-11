/**
 * 接続先（github.com / GHES）の設定。
 * ユーザーはホスト名だけを入力し、REST / GraphQL / Web の URL はここで組み立てる（DESIGN.md §3）。
 */

export type ConnectionKind = 'github' | 'ghes';

export interface Connection {
  kind: ConnectionKind;
  /** 正規化済みのホスト名（github.com またはポート付きを含む GHES のホスト） */
  host: string;
  restBaseUrl: string;
  graphqlUrl: string;
  webUrl: string;
}

const GITHUB_COM_HOSTS = new Set(['github.com', 'www.github.com', 'api.github.com']);

// ホスト名（任意でポート付き）。IP アドレスもこの形に収まる
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/;

export class InvalidHostError extends Error {
  constructor(input: string) {
    super(`ホスト名の形式が正しくありません: ${input}`);
    this.name = 'InvalidHostError';
  }
}

/**
 * 入力されたホスト名を正規化する。
 * `https://ghe.example.com/` や `ghe.example.com/api/v3` のような入力も受け付ける。
 */
export function normalizeHost(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.replace(/[/?#].*$/, '');
  s = s.replace(/^[^@]*@/, ''); // user:pass@ を取り除く
  if (s === '' || !HOST_PATTERN.test(s)) {
    throw new InvalidHostError(input);
  }
  return s;
}

/** ホスト名から接続設定を組み立てる。空文字なら github.com とみなす */
export function connectionFromHost(input: string): Connection {
  const host = input.trim() === '' ? 'github.com' : normalizeHost(input);
  if (GITHUB_COM_HOSTS.has(host)) {
    return {
      kind: 'github',
      host: 'github.com',
      restBaseUrl: 'https://api.github.com',
      graphqlUrl: 'https://api.github.com/graphql',
      webUrl: 'https://github.com',
    };
  }
  const origin = `https://${host}`;
  return {
    kind: 'ghes',
    host,
    restBaseUrl: `${origin}/api/v3`,
    graphqlUrl: `${origin}/api/graphql`,
    webUrl: origin,
  };
}
