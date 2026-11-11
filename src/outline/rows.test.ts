import { describe, expect, it } from 'vitest';
import { parseNote } from '../note/format';
import { buildRows, parentIds } from './rows';

const src = [
  '- a <!-- id:a -->',
  '  - b <!-- id:b -->',
  '    - c <!-- id:c -->',
  '  - d <!-- id:d -->',
  '- e <!-- id:e -->',
  '',
  'メモ',
  '',
  '  - f <!-- id:f -->',
  '    - g <!-- id:g -->',
].join('\n');
const entries = parseNote(src).entries;
const show = (collapsed: string[]) =>
  buildRows(entries, new Set(collapsed)).map((r) =>
    r.kind === 'memo' ? 'memo' : `${r.item.id}${r.hasChildren ? (r.collapsed ? '+' : '-') : ''}`,
  );

describe('buildRows', () => {
  it('すべて展開', () => {
    expect(show([])).toEqual(['a-', 'b-', 'c', 'd', 'e', 'memo', 'f-', 'g']);
  });

  it('折りたたんだ項目の子孫を隠す', () => {
    expect(show(['b'])).toEqual(['a-', 'b+', 'd', 'e', 'memo', 'f-', 'g']);
    expect(show(['a'])).toEqual(['a+', 'e', 'memo', 'f-', 'g']);
  });

  it('子のない項目の折りたたみ指定は無視', () => {
    expect(show(['c', 'e'])).toEqual(['a-', 'b-', 'c', 'd', 'e', 'memo', 'f-', 'g']);
  });

  it('メモを挟んだら別のリスト', () => {
    expect(show(['e', 'f'])).toEqual(['a-', 'b-', 'c', 'd', 'e', 'memo', 'f+']);
  });
});

describe('parentIds', () => {
  it('子を持つ項目', () => {
    expect(parentIds(entries)).toEqual(['a', 'b', 'f']);
  });
});
