import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canPersistToken, deleteToken, isSharedPagesOrigin, loadToken, purgeStoredTokensIfShared, saveToken } from './storage';

const KEY = 'idea-outliner:token:h.example.test';
const HOST = 'h.example.test';

/** Object.keys で保存キーが列挙できる localStorage の代役 */
function fakeStorage() {
  const s: Record<string, unknown> = {};
  Object.defineProperties(s, {
    getItem: { value: (k: string) => (k in s ? (s[k] as string) : null) },
    setItem: { value: (k: string, v: string) => void (s[k] = v) },
    removeItem: { value: (k: string) => void delete s[k] },
  });
  return s as Record<string, unknown> & Storage;
}

let store: ReturnType<typeof fakeStorage>;
let session: ReturnType<typeof fakeStorage>;
const at = (hostname: string, pathname = '/app/') => vi.stubGlobal('location', { hostname, pathname });

beforeEach(() => {
  store = fakeStorage();
  session = fakeStorage();
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', session);
  at('team.github.io');
  deleteToken(HOST);
});
afterEach(() => vi.unstubAllGlobals());

describe('isSharedPagesOrigin', () => {
  it.each([
    ['pages.ghe.example.test', '/team/app/', true],
    ['ghe.example.test', '/pages/team/app/', true],
    ['ghe.example.test', '/pages', true],
    ['team.github.io', '/app/', false],
    ['localhost', '/', false],
    ['ghe.example.test', '/pagesfoo/', false],
    ['mypages.example.test', '/', false],
  ])('%s%s → %s', (host, path, expected) => {
    expect(isSharedPagesOrigin(host, path)).toBe(expected);
  });
});

describe('トークン', () => {
  it('既定ではタブの間だけ持ち、localStorage に書かない', () => {
    expect(saveToken(HOST, 'secret')).toBe(false);
    expect(loadToken(HOST)).toBe('secret');
    expect(session.getItem(KEY)).toBe('secret');
    expect(store.getItem(KEY)).toBeNull();
  });

  it('再読み込みしても読める（メモリが消えても sessionStorage から）', async () => {
    saveToken(HOST, 'secret');
    vi.resetModules();
    const fresh = await import('./storage');
    expect(fresh.loadToken(HOST)).toBe('secret');
  });

  it('タブを閉じると消える（新しいタブの sessionStorage は空）', async () => {
    saveToken(HOST, 'secret');
    vi.stubGlobal('sessionStorage', fakeStorage());
    vi.resetModules();
    const fresh = await import('./storage');
    expect(fresh.loadToken(HOST)).toBeNull();
  });

  it('sessionStorage が使えなくてもメモリで動く', () => {
    const denied = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('sessionStorage', { getItem: denied, setItem: denied, removeItem: denied });
    saveToken(HOST, 'secret');
    expect(loadToken(HOST)).toBe('secret');
    deleteToken(HOST);
    expect(loadToken(HOST)).toBeNull();
  });

  it('選んだときだけ localStorage に書く', () => {
    expect(saveToken(HOST, 'secret', true)).toBe(true);
    expect(store.getItem(KEY)).toBe('secret');
  });

  it('保存しない形で入れ直すと、前の保存を消す', () => {
    saveToken(HOST, 'old', true);
    saveToken(HOST, 'new');
    expect(store.getItem(KEY)).toBeNull();
    expect(loadToken(HOST)).toBe('new');
  });

  it('保存済みのトークンを読める（再読み込み後）', () => {
    store.setItem(KEY, 'saved');
    expect(loadToken(HOST)).toBe('saved');
  });

  it('削除するとメモリからも sessionStorage からも localStorage からも消える', () => {
    saveToken(HOST, 'secret', true);
    deleteToken(HOST);
    expect(loadToken(HOST)).toBeNull();
    expect(session.getItem(KEY)).toBeNull();
    expect(store.getItem(KEY)).toBeNull();
  });
});

describe('共有 origin（GHE Pages）', () => {
  beforeEach(() => at('pages.ghe.example.test'));

  it('保存を選んでも localStorage に書かない', () => {
    expect(canPersistToken()).toBe(false);
    expect(saveToken(HOST, 'secret', true)).toBe(false);
    expect(store.getItem(KEY)).toBeNull();
    expect(session.getItem(KEY)).toBe('secret');
    expect(loadToken(HOST)).toBe('secret');
  });

  it('起動時の掃除でタブの保持は消さない', () => {
    saveToken(HOST, 'secret');
    purgeStoredTokensIfShared();
    expect(session.getItem(KEY)).toBe('secret');
  });

  it('残っていた保存は読まない', () => {
    store.setItem(KEY, 'stale');
    expect(loadToken(HOST)).toBeNull();
  });

  it('起動時にトークンだけ消す', () => {
    store.setItem(KEY, 'stale');
    store.setItem('idea-outliner:prefs', '{}');
    store.setItem('other-app:token', 'keep');
    purgeStoredTokensIfShared();
    expect(store.getItem(KEY)).toBeNull();
    expect(store.getItem('idea-outliner:prefs')).toBe('{}');
    expect(store.getItem('other-app:token')).toBe('keep');
  });
});

describe('共有 origin でないとき', () => {
  it('purge は何も消さない', () => {
    store.setItem(KEY, 'saved');
    purgeStoredTokensIfShared();
    expect(store.getItem(KEY)).toBe('saved');
  });
});
