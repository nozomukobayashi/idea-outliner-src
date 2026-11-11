import { describe, expect, it } from 'vitest';
import { anonymize, describeBodyDiff, parseRepo } from './util';

describe('parseRepo', () => {
  it.each([
    ['team-a/ideas', { owner: 'team-a', name: 'ideas' }],
    [' team-a/ideas.git ', { owner: 'team-a', name: 'ideas' }],
    ['a_b/c.d-e', { owner: 'a_b', name: 'c.d-e' }],
  ])('%s', (input, expected) => {
    expect(parseRepo(input)).toEqual(expected);
  });

  it.each(['', 'team-a', 'a/b/c', '/b', 'a/', 'a b/c', 'a/..'])('不正: %j', (input) => {
    expect(parseRepo(input)).toBeNull();
  });
});

describe('describeBodyDiff', () => {
  it('一致', () => {
    expect(describeBodyDiff('a\nb', 'a\nb')).toEqual({ identical: true, notes: ['送信した本文と完全に一致'] });
  });

  it('LF → CRLF', () => {
    const r = describeBodyDiff('a\nb\n', 'a\r\nb\r\n');
    expect(r.identical).toBe(false);
    expect(r.notes).toEqual(['改行が LF → CRLF に変換されている', '改行コード以外は一致']);
  });

  it('末尾の改行だけ違う', () => {
    const r = describeBodyDiff('a\nb\n', 'a\nb');
    expect(r.notes[0]).toContain('末尾の空白・改行だけが異なる');
  });

  it('HTML コメントが消えた', () => {
    const r = describeBodyDiff('- x <!-- id:ab12 -->\n- y', '- x\n- y');
    expect(r.notes).toContain('HTML コメントの数が変わった（送信 1 / 受信 0）');
    expect(r.notes.at(-1)).toContain('1 行目付近で相違');
  });

  it('相違行を示す', () => {
    const r = describeBodyDiff('a\nb\nc', 'a\nb\nX');
    expect(r.notes.at(-1)).toContain('3 行目付近');
  });
});

describe('anonymize', () => {
  it('ホスト名とリポジトリ名を置き換える', () => {
    const text = 'https://ghe.example.test/team-a/ideas と team-a/ideas-extra';
    expect(
      anonymize(text, [
        ['ghe.example.test', '<HOST>'],
        ['team-a/ideas', '<IDEAS_REPO>'],
        ['team-a/ideas-extra', '<CROSS_REPO>'],
      ]),
    ).toBe('https://<HOST>/<IDEAS_REPO> と <CROSS_REPO>');
  });

  it('大文字を含む値は小文字表記も置き換える', () => {
    expect(anonymize('Team-A/Ideas team-a/ideas', [['Team-A/Ideas', '<R>']])).toBe('<R> <R>');
  });

  it('空文字は無視する', () => {
    expect(anonymize('abc', [['', 'X']])).toBe('abc');
  });
});
