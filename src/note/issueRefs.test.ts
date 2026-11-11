import { describe, expect, it } from 'vitest';
import { findIssueRefs, refKey, uniqueRefs } from './issueRefs';

const refs = (t: string) => findIssueRefs(t).map((r) => `${r.owner}/${r.repo}#${r.number}`);

describe('findIssueRefs', () => {
  it('owner/repo#番号 を拾う', () => {
    expect(refs('チュートリアル短縮 team-a/web#118 と team-a/api#97')).toEqual(['team-a/web#118', 'team-a/api#97']);
  });

  it('位置を返す', () => {
    const [r] = findIssueRefs('x o/r#1 y');
    expect(r).toMatchObject({ start: 2, end: 7 });
  });

  it('リポジトリ名の . _ - を許す', () => {
    expect(refs('a-b/c.d_e-f#3')).toEqual(['a-b/c.d_e-f#3']);
  });

  it.each([
    ['URL の一部', 'https://example.test/o/r#1'],
    ['番号の後に英字', 'o/r#1abc'],
    ['インラインコードの中', '`o/r#1`'],
    ['番号なし', 'o/r#'],
    ['# だけ', '#12'],
    ['リポジトリ名が ..', 'o/..#1'],
  ])('拾わない: %s', (_, t) => {
    expect(refs(t)).toEqual([]);
  });

  it('句読点や括弧の隣は拾う', () => {
    expect(refs('（o/r#1）、o/r#2。')).toEqual(['o/r#1', 'o/r#2']);
  });
});

describe('uniqueRefs', () => {
  it('大文字小文字を無視して重複を除く', () => {
    expect(uniqueRefs(['O/R#1 o/r#1', 'o/r#2']).map(refKey)).toEqual(['o/r#1', 'o/r#2']);
  });
});
