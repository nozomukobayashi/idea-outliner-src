import { describe, expect, it } from 'vitest';
import { buildLineComment, groupComments, parseLineComment } from './lineComment';

describe('parseLineComment', () => {
  it('設計書 §4.2 の例', () => {
    const body = '<!-- idea-outliner:ref id:q1z5 -->\n> サンプルデータを最初から入れておく\n\n空の状態だと分からない。';
    expect(parseLineComment(body)).toEqual({ lineId: 'q1z5', text: '空の状態だと分からない。' });
  });

  it('ref のないコメントはそのまま', () => {
    expect(parseLineComment('ふつうのコメント\n\n> 引用')).toEqual({ lineId: null, text: 'ふつうのコメント\n\n> 引用' });
  });

  it('CRLF でも読める', () => {
    expect(parseLineComment('<!-- idea-outliner:ref id:a1 -->\r\n> 引用\r\n\r\n本文\r\n2 行目\r\n')).toEqual({ lineId: 'a1', text: '本文\n2 行目' });
  });

  it('本人の引用は残す（空行より後ろは本文）', () => {
    expect(parseLineComment('<!-- idea-outliner:ref id:a1 -->\n> 行\n\n> 本人の引用\n\n返事').text).toBe('> 本人の引用\n\n返事');
  });

  it('引用がなくても読める', () => {
    expect(parseLineComment('<!-- idea-outliner:ref id:a1 -->\n\n本文')).toEqual({ lineId: 'a1', text: '本文' });
    expect(parseLineComment('<!-- idea-outliner:ref id:a1 -->')).toEqual({ lineId: 'a1', text: '' });
  });

  it.each(['本文の途中 <!-- idea-outliner:ref id:a1 -->', '<!-- idea-outliner:ref -->\n本文', '<!-- id:a1 -->\n本文'])('ref とみなさない: %j', (body) => {
    expect(parseLineComment(body).lineId).toBeNull();
  });
});

describe('buildLineComment', () => {
  it('ref・引用・本文の順', () => {
    expect(buildLineComment('q1z5', '行の文 ', ' 本文\n')).toBe('<!-- idea-outliner:ref id:q1z5 -->\n> 行の文\n\n本文\n');
  });

  it('空の行は引用しない', () => {
    expect(buildLineComment('a1', '', '本文')).toBe('<!-- idea-outliner:ref id:a1 -->\n\n本文\n');
  });

  it.each([
    ['ふつう', '本文'],
    ['複数行', '1 行目\n\n2 行目'],
    ['本人の引用から始まる', '> 引用\n\n返事'],
    ['行に Markdown', '**太字** `code`'],
  ])('読み直すと本文に戻る: %s', (_, body) => {
    expect(parseLineComment(buildLineComment('a1', '行 **太字** o/r#1', body))).toEqual({ lineId: 'a1', text: body });
  });
});

describe('groupComments', () => {
  const ref = (id: string, n: number) => ({ n, body: `<!-- idea-outliner:ref id:${id} -->\n> x\n\nc` });
  const plain = (n: number) => ({ n, body: 'c' });

  it('行ごと・削除された行・全体に振り分ける（順序を保つ）', () => {
    const g = groupComments([ref('a', 1), plain(2), ref('gone', 3), ref('a', 4), ref('b', 5)], new Set(['a', 'b']));
    expect(g.byLine.get('a')?.map((c) => c.n)).toEqual([1, 4]);
    expect(g.byLine.get('b')?.map((c) => c.n)).toEqual([5]);
    expect(g.deleted.map((c) => c.n)).toEqual([3]);
    expect(g.general.map((c) => c.n)).toEqual([2]);
  });
});
