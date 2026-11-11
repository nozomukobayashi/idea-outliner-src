import { describe, expect, it } from 'vitest';
import { buildReport, classifyOrigin, type ReportInput } from './report';

const base: ReportInput = {
  generatedAt: '2026-01-01T00:00:00Z',
  connectionKind: 'ghes',
  originKind: 'localhost',
  auto: {
    '1': { status: 'ok', summary: 'viewer: octo', log: ['GraphQL: https://ghe.example.test/api/graphql', 'viewer.login: octo'], ranAt: 't' },
    '2': { status: 'ng', summary: 'a | b', log: ['team-a/ideas#1'], ranAt: 't' },
  },
  manual: { '5': { status: 'ok', memo: '発行できた\n使えた' }, '6': { status: 'unknown', memo: '' } },
  redactions: null,
};

describe('buildReport', () => {
  it('表と各チェックのログを出す', () => {
    const md = buildReport(base);
    expect(md).toContain('| 1 | Pages からブラウザで API を呼べるか（CORS） | OK | viewer: octo |');
    expect(md).toContain('| 2 | Discussions の GraphQL（作成・更新・コメント） | NG | a \\| b |');
    expect(md).toContain('| 3 | サブイシュー（同一リポジトリ） | 未確認 |  |');
    expect(md).toContain('| 5 | GHES で fine-grained PAT が使えるか | OK | 発行できた<br>使えた |');
    expect(md).toContain('## #1 ');
    expect(md).not.toContain('## #3 ');
  });

  it('ログが空（スキップ）のときは空のコードブロックを出さない', () => {
    const md = buildReport({ ...base, auto: { '4': { status: 'skip', summary: '別リポジトリが未入力', log: [], ranAt: 't' } } });
    expect(md).toContain('（ログなし: 別リポジトリが未入力）');
    expect(md).not.toContain('```text\n```');
  });

  it('伏せ字指定があればホスト名などを置き換える', () => {
    const md = buildReport({
      ...base,
      redactions: [
        ['ghe.example.test', '<HOST>'],
        ['team-a/ideas', '<IDEAS_REPO>'],
        ['octo', '<USER>'],
      ],
    });
    expect(md).not.toContain('ghe.example.test');
    expect(md).not.toContain('team-a/ideas');
    expect(md).not.toContain('octo');
    expect(md).toContain('https://<HOST>/api/graphql');
  });
});

describe('classifyOrigin', () => {
  it.each([
    ['http://localhost:5173', 'ghe.example.test', 'localhost'],
    ['http://127.0.0.1:4173', 'ghe.example.test', 'localhost'],
    ['https://octo.github.io', 'github.com', 'GitHub Pages (github.io)'],
    ['https://ghe.example.test', 'ghe.example.test', 'GHE Pages（接続先と同じドメイン）'],
    ['https://pages.ghe.example.test', 'ghe.example.test', 'GHE Pages（接続先と同じドメイン）'],
    ['https://other.example.test', 'ghe.example.test', 'その他のホスト'],
  ])('%s', (origin, host, expected) => {
    expect(classifyOrigin(origin, host)).toBe(expected);
  });
});
