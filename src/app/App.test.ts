// @vitest-environment jsdom
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 接続先を固定したビルドとして動かす
vi.mock('../config/defaults', () => ({
  BUILD_CONFIG: { defaultHost: 'ghe.example.test', allowOtherHosts: false },
  HOST_LOCKED: true,
}));

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function fillToken(root: HTMLElement, value: string) {
  const input = root.querySelector<HTMLInputElement>('input[type=password]');
  if (!input) throw new Error('トークンの入力欄がない');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function submit(root: HTMLElement) {
  root.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('接続先を固定したビルドの接続', () => {
  let root: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    location.hash = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { viewer: { repositories: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }), { status: 200 })),
    );
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it('URL にハッシュがなくても、接続するとワークスペース選択に進む', async () => {
    const { App } = await import('./App');
    render(h(App, {}), root);
    await wait();
    expect(root.querySelector('input[type=password]')).not.toBeNull();

    fillToken(root, 'ghp_dummy');
    await wait();
    submit(root);
    await wait();

    expect(root.querySelector('input[type=password]')).toBeNull();
    expect(root.querySelector('h1')?.textContent).toBe('ワークスペースを選ぶ');
  });
});
