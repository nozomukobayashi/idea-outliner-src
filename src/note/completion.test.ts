import { describe, expect, it } from 'vitest';
import { applyCompletion, completionContext, completionKey } from './completion';

const at = (s: string) => completionContext(s.replace('|', ''), s.indexOf('|'));

describe('completionContext', () => {
  it('owner/ でリポジトリの補完', () => {
    expect(at('やること team-a/|')).toEqual({ kind: 'repo', start: 5, end: 12, query: 'team-a/' });
    expect(at('team-a/we|')).toEqual({ kind: 'repo', start: 0, end: 9, query: 'team-a/we' });
  });

  it('owner/repo# で Issue の補完', () => {
    expect(at('短縮 team-a/web#|')).toEqual({ kind: 'issue', start: 3, end: 14, owner: 'team-a', repo: 'web', query: '' });
    expect(at('team-a/web#12|')).toMatchObject({ kind: 'issue', query: '12' });
    expect(at('team-a/web#ログ|')).toMatchObject({ kind: 'issue', query: 'ログ' });
  });

  it('カーソルが途中でも、その直前で判定する', () => {
    expect(at('a team-a/web#1| の件')).toMatchObject({ kind: 'issue', query: '1' });
  });

  it('括弧の直後でも補完する', () => {
    expect(at('（team-a/|')).toMatchObject({ kind: 'repo', start: 1 });
  });

  it.each([
    ['スラッシュなし', 'team-a|'],
    ['URL の途中', 'https://ghe.example.test/team-a/|'],
    ['単語の途中', 'abc/def/|'],
    ['インラインコードの中', '`team-a/|'],
    ['空白の後', 'team-a/web#12 |'],
    ['行頭のスラッシュ', '/team|'],
  ])('補完しない: %s', (_, s) => {
    expect(at(s)).toBeNull();
  });

  it('閉じたインラインコードの後なら補完する', () => {
    expect(at('`code` team-a/|')).toMatchObject({ kind: 'repo' });
  });
});

describe('applyCompletion', () => {
  it('リポジトリは # まで入れて、続けて Issue を選べるようにする', () => {
    const s = 'やること team-a/we';
    const ctx = completionContext(s, s.length)!;
    expect(applyCompletion(s, ctx, 'team-a/web')).toEqual({ text: 'やること team-a/web#', caret: 16 });
  });

  it('Issue は後ろに空白を足し、続きの文はそのまま', () => {
    const s = 'a team-a/web#1 の件';
    const ctx = completionContext(s, 14)!;
    expect(applyCompletion(s, ctx, 'team-a/web#118')).toEqual({ text: 'a team-a/web#118 の件', caret: 17 });
  });

  it('行末の Issue', () => {
    const s = 'team-a/web#';
    expect(applyCompletion(s, completionContext(s, s.length)!, 'team-a/web#3')).toEqual({ text: 'team-a/web#3 ', caret: 13 });
  });
});

describe('completionKey', () => {
  it('文脈が変わればキーも変わる', () => {
    expect(completionKey(at('team-a/|'))).not.toBe(completionKey(at('team-a/w|')));
    expect(completionKey(null)).toBeNull();
  });
});
