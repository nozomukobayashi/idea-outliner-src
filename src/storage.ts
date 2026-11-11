/**
 * ブラウザの保存領域の薄いラッパー。プライベートウィンドウ等で使えない場合も例外を外に出さない。
 *
 * トークンは既定でタブの間だけ保持する（sessionStorage）。localStorage に書くのはユーザーが選んだときだけで、
 * 他のサイトと origin を共有する環境では書かない（DESIGN.md §3）。
 */
const PREFIX = 'idea-outliner:';
const TOKEN_PREFIX = `${PREFIX}token:`;
const tokenKey = (host: string) => `${TOKEN_PREFIX}${host}`;

/**
 * GHE Pages かどうか。URL は `pages.<host>/...` か `<host>/pages/...` で、
 * どちらも同じ GHE のすべての Pages サイトが同じ origin になる。
 */
export function isSharedPagesOrigin(hostname: string, pathname: string): boolean {
  return hostname.startsWith('pages.') || pathname === '/pages' || pathname.startsWith('/pages/');
}

/** このページでトークンを localStorage に保存してよいか */
export function canPersistToken(): boolean {
  return typeof location === 'undefined' || !isSharedPagesOrigin(location.hostname, location.pathname);
}

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 何もしない
  }
}

// sessionStorage が使えない環境でも、開いている間は動くようにメモリにも持つ
const memoryTokens = new Map<string, string>();

function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // メモリには持っているので何もしない
  }
}

function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // 何もしない
  }
}

export const loadToken = (host: string): string | null =>
  memoryTokens.get(host) ?? sessionGet(tokenKey(host)) ?? (canPersistToken() ? get(tokenKey(host)) : null);

/** トークンをタブの間だけ持つ。persist が true で、保存が許される環境なら localStorage にも書く。書けたら true */
export function saveToken(host: string, token: string, persist = false): boolean {
  memoryTokens.set(host, token);
  sessionSet(tokenKey(host), token);
  if (persist && canPersistToken()) return set(tokenKey(host), token);
  remove(tokenKey(host));
  return false;
}

export function deleteToken(host: string): void {
  memoryTokens.delete(host);
  sessionRemove(tokenKey(host));
  remove(tokenKey(host));
}

/** 共有 origin に以前の保存が残っていたら消す。起動時に呼ぶ */
export function purgeStoredTokensIfShared(): void {
  if (canPersistToken()) return;
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(TOKEN_PREFIX)) localStorage.removeItem(key);
  } catch {
    // 何もしない
  }
}

export function loadJson<T>(name: string, fallback: T): T {
  const raw = get(PREFIX + name);
  if (raw === null) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

export const saveJson = (name: string, value: unknown): boolean => set(PREFIX + name, JSON.stringify(value));
