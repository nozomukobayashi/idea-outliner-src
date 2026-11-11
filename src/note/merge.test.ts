import { describe, expect, it } from 'vitest';
import { appendItem, cycleChecked, deleteItem, indentItem, moveDown, moveUp, outdentItem, setItemText, splitItem } from '../outline/edit';
import { noteItems, parseNote, serializeNote, type NoteDoc } from './format';
import { merge3, type Resolution } from './merge';

function seq(prefix: string) {
  let n = 0;
  return (existing: ReadonlySet<string>) => {
    let id: string;
    do id = `${prefix}${n++}`;
    while (existing.has(id));
    return id;
  };
}

const BASE = ['- a <!-- id:a -->', '  - b <!-- id:b -->', '  - c <!-- id:c -->', '- d <!-- id:d -->', ''].join('\n');
const P = (s: string) => parseNote(s, { generateId: seq('g') });
const shape = (d: NoteDoc) => noteItems(d).map((i) => `${' '.repeat(i.depth)}${i.id}:${i.text.trim()}`);
const base = () => P(BASE);
const remoteOf = (f: (s: string) => string) => P(f(BASE));

describe('変更がぶつからない場合', () => {
  it('別々の行の編集を両方残す', () => {
    const local = setItemText(base(), 'b', 'b2');
    const r = merge3(base(), local, remoteOf((s) => s.replace('- c', '- c2')));
    expect(r.conflicts).toEqual([]);
    expect(shape(r.doc)).toEqual(['a:a', ' b:b2', ' c:c2', 'd:d']);
  });

  it('同じ変更は衝突しない', () => {
    const local = setItemText(base(), 'b', 'same');
    const r = merge3(base(), local, remoteOf((s) => s.replace('- b', '- same')));
    expect(r.conflicts).toEqual([]);
    expect(shape(r.doc)[1]).toBe(' b:same');
  });

  it('入力途中の末尾の空白だけなら変更とみなさない', () => {
    const local = setItemText(base(), 'b', 'b ');
    const r = merge3(base(), local, remoteOf((s) => s.replace('- b', '- b2')));
    expect(r.conflicts).toEqual([]);
    expect(shape(r.doc)[1]).toBe(' b:b2');
  });

  it('自分が足した行は直前の兄弟の後ろに入る', () => {
    const { doc: local } = splitItem(base(), 'b', 1, true, seq('L'));
    const r = merge3(base(), local, remoteOf((s) => s.replace('- c', '- c2')));
    expect(shape(r.doc)).toEqual(['a:a', ' b:b', ' L0:', ' c:c2', 'd:d']);
  });

  it('両方が足した行は両方残る', () => {
    const { doc: local } = splitItem(base(), 'd', 1, true, seq('L'));
    const r = merge3(base(), local, remoteOf((s) => s.replace('- d <!-- id:d -->\n', '- d <!-- id:d -->\n- r <!-- id:r -->\n')));
    expect(r.conflicts).toEqual([]);
    expect(shape(r.doc).sort()).toEqual(['L0:', 'a:a', ' b:b', ' c:c', 'd:d', 'r:r'].sort());
  });

  it('削除は相手が触っていなければ通る', () => {
    expect(shape(merge3(base(), deleteItem(base(), 'b'), P(BASE)).doc)).toEqual(['a:a', ' c:c', 'd:d']);
    const remote = remoteOf((s) => s.replace('  - b <!-- id:b -->\n', ''));
    expect(shape(merge3(base(), base(), remote).doc)).toEqual(['a:a', ' c:c', 'd:d']);
  });

  it('自分が動かした行は GitHub 側の編集を保ったまま動く', () => {
    const local = moveDown(base(), 'b');
    const r = merge3(base(), local, remoteOf((s) => s.replace('- b', '- b2')));
    expect(r.conflicts).toEqual([]);
    expect(shape(r.doc)).toEqual(['a:a', ' c:c', ' b:b2', 'd:d']);
  });

  it('GitHub 側で動いた行に自分の編集を当てる', () => {
    const local = setItemText(base(), 'b', 'b2');
    const remote = P(['- d <!-- id:d -->', '- a <!-- id:a -->', '  - c <!-- id:c -->', '  - b <!-- id:b -->', ''].join('\n'));
    expect(shape(merge3(base(), local, remote).doc)).toEqual(['d:d', 'a:a', ' c:c', ' b:b2']);
  });

  it('両方が動かしたら自分の位置を優先する', () => {
    const local = outdentItem(base(), 'b');
    const remote = P(['- a <!-- id:a -->', '  - c <!-- id:c -->', '    - b <!-- id:b -->', '- d <!-- id:d -->', ''].join('\n'));
    const r = merge3(base(), local, remote);
    expect(r.conflicts).toEqual([]);
    expect(shape(r.doc)).toEqual(['a:a', ' c:c', 'b:b', 'd:d']);
  });
});

describe('衝突', () => {
  it('同じ行を違う内容に変えたら、その行だけ衝突', () => {
    const local = setItemText(setItemText(base(), 'b', 'L'), 'd', 'd2');
    const r = merge3(base(), local, remoteOf((s) => s.replace('- b', '- R')));
    expect(r.conflicts).toEqual([
      { id: 'b', kind: 'both-edited', base: { text: 'b', checked: null }, local: { text: 'L', checked: null }, remote: { text: 'R', checked: null } },
    ]);
    expect(shape(r.doc)).toEqual(['a:a', ' b:R', ' c:c', 'd:d2']);
  });

  it('チェックと文言を別々に変えても同じ行なら衝突', () => {
    const b = P('- [ ] a <!-- id:a -->\n');
    const local = cycleChecked(b, 'a');
    expect(merge3(b, local, P('- [ ] a2 <!-- id:a -->\n')).conflicts).toHaveLength(1);
  });

  it.each<[Resolution, string[]]>([
    ['local', ['a:a', ' b:L', ' c:c', 'd:d']],
    ['remote', ['a:a', ' b:R', ' c:c', 'd:d']],
  ])('編集の衝突を %s で解決', (res, expected) => {
    const local = setItemText(base(), 'b', 'L');
    const r = merge3(base(), local, remoteOf((s) => s.replace('- b', '- R')), new Map([['b', res]]));
    expect(r.conflicts).toEqual([]);
    expect(shape(r.doc)).toEqual(expected);
  });

  it.each<[Resolution, string[]]>([
    ['local', ['a:a', ' c:c', 'd:d']],
    ['remote', ['a:a', ' b:R', ' c:c', 'd:d']],
  ])('自分の削除と GitHub の編集を %s で解決', (res, expected) => {
    const remote = remoteOf((s) => s.replace('- b', '- R'));
    expect(merge3(base(), deleteItem(base(), 'b'), remote).conflicts[0]?.kind).toBe('local-deleted');
    expect(shape(merge3(base(), deleteItem(base(), 'b'), remote, new Map([['b', res]])).doc)).toEqual(expected);
  });

  it.each<[Resolution, string[]]>([
    ['local', ['a:a', ' b:L', ' c:c', 'd:d']],
    ['remote', ['a:a', ' c:c', 'd:d']],
  ])('自分の編集と GitHub の削除を %s で解決', (res, expected) => {
    const local = setItemText(base(), 'b', 'L');
    const remote = remoteOf((s) => s.replace('  - b <!-- id:b -->\n', ''));
    expect(merge3(base(), local, remote).conflicts[0]?.kind).toBe('remote-deleted');
    expect(shape(merge3(base(), local, remote, new Map([['b', res]])).doc)).toEqual(expected);
  });
});

describe('親の削除と子の追加', () => {
  it('自分が親を消しても、GitHub 側で足された子は残る', () => {
    const remote = remoteOf((s) => s.replace('  - c <!-- id:c -->\n', '  - c <!-- id:c -->\n  - n <!-- id:n -->\n'));
    const r = merge3(base(), deleteItem(base(), 'a'), remote);
    expect(r.conflicts).toEqual([]);
    expect(shape(r.doc)).toEqual(['n:n', 'd:d']);
  });

  it('GitHub 側で親が消えても、自分が足した子は残る', () => {
    const { doc: local } = splitItem(base(), 'b', 1, true, seq('L'));
    const typed = setItemText(local, 'L0', 'new');
    const remote = P('- d <!-- id:d -->\n');
    const r = merge3(base(), typed, remote);
    expect(r.conflicts).toEqual([]);
    expect(shape(r.doc).sort()).toEqual(['L0:new', 'd:d'].sort());
  });
});

describe('手編集との組み合わせ', () => {
  it('触っていない行は GitHub 側の書式のまま', () => {
    const remoteBody = '# 追記\n\n* a <!-- id:a -->\n    + b <!-- id:b -->\n    + c <!-- id:c -->\n* d <!-- id:d -->\n';
    const local = setItemText(base(), 'd', 'd2');
    const out = serializeNote(merge3(base(), local, P(remoteBody)).doc);
    expect(out).toBe('# 追記\n\n* a <!-- id:a -->\n    + b <!-- id:b -->\n    + c <!-- id:c -->\n- d2 <!-- id:d -->\n');
  });

  it('ID のない行はテキストで対応づける（重複しない）', () => {
    const src = '- x\n- y\n';
    const b = parseNote(src, { generateId: seq('b') });
    const local = setItemText(b, 'b0', 'x2');
    const remote = parseNote('- x\n- y\n- z\n', { generateId: seq('r') });
    const r = merge3(b, local, remote);
    expect(r.conflicts).toEqual([]);
    expect(noteItems(r.doc).map((i) => i.text)).toEqual(['x2', 'y', 'z']);
  });

  it('別の人が先に ID を振っていたら、その ID に揃える', () => {
    const b = parseNote('- x\n- y\n', { generateId: seq('b') });
    const local = setItemText(b, 'b1', 'y2');
    const remote = P('- x <!-- id:keep1 -->\n- y <!-- id:keep2 -->\n');
    const r = merge3(b, local, remote);
    expect(r.conflicts).toEqual([]);
    expect(serializeNote(r.doc)).toBe('- x <!-- id:keep1 -->\n- y2 <!-- id:keep2 -->\n');
  });

  it('CRLF の本文に合わせる', () => {
    const local = setItemText(base(), 'd', 'd2');
    const out = serializeNote(merge3(base(), local, P(BASE.replace(/\n/g, '\r\n'))).doc);
    expect(out).toBe('- a <!-- id:a -->\r\n  - b <!-- id:b -->\r\n  - c <!-- id:c -->\r\n- d2 <!-- id:d -->\r\n');
  });

  it('GitHub 側の全削除に自分の新しい行を足す', () => {
    const { doc: local } = appendItem(base(), seq('L'));
    expect(shape(merge3(base(), setItemText(local, 'L0', 'n'), P('')).doc)).toEqual(['L0:n']);
  });
});

describe('ランダムな同時編集（2000 回）', () => {
  function rng(seed: number) {
    return () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }
  const rand = rng(99);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)] as T;

  function mutate(d0: NoteDoc, prefix: string, added: string[]): NoteDoc {
    let d = d0;
    const gen = seq(prefix);
    const steps = Math.floor(rand() * 6);
    for (let s = 0; s < steps; s++) {
      const ids = noteItems(d).map((i) => i.id);
      if (ids.length === 0) break;
      const id = pick(ids);
      const op = Math.floor(rand() * 7);
      if (op === 0) d = indentItem(d, id);
      else if (op === 1) d = outdentItem(d, id);
      else if (op === 2) d = moveUp(d, id);
      else if (op === 3) d = deleteItem(d, id);
      else if (op === 4) d = setItemText(d, id, `${prefix}-edit-${s}`);
      else {
        const r = splitItem(d, id, 1, rand() < 0.5, gen);
        const text = `${prefix}-add-${added.length}`;
        d = setItemText(r.doc, r.focusId, text);
        added.push(r.focusId);
      }
    }
    return d;
  }

  const SRC = ['- a <!-- id:a -->', '  - b <!-- id:b -->', '    - c <!-- id:c -->', '  - d <!-- id:d -->', '- e <!-- id:e -->', '- f <!-- id:f -->', '', 'メモ', '', '- g <!-- id:g -->', ''].join('\n');

  it('行が失われず、重複せず、読み直しても同じ形', () => {
    for (let n = 0; n < 2000; n++) {
      const b = P(SRC);
      const la: string[] = [];
      const ra: string[] = [];
      const local = mutate(b, 'L', la);
      const remote = mutate(b, 'R', ra);
      const remoteDoc = parseNote(serializeNote(remote), { generateId: () => 'NEVER' });

      // すべての衝突を、順に自分 / GitHub で解決する
      const first = merge3(b, local, remoteDoc);
      const res = new Map(first.conflicts.map((c, i) => [c.id, (i % 2 ? 'local' : 'remote') as Resolution]));
      const r = merge3(b, local, remoteDoc, res);
      if (r.conflicts.length > 0) throw new Error('解決後に衝突が残った');

      const ids = noteItems(r.doc).map((i) => i.id);
      if (new Set(ids).size !== ids.length) throw new Error(`ID が重複: ${ids}`);

      // 残っている新しい行: 自分・GitHub のどちらかの最終形にある行は消えない
      for (const id of [...la, ...ra]) {
        const inLocal = noteItems(local).some((i) => i.id === id);
        const inRemote = noteItems(remoteDoc).some((i) => i.id === id);
        if ((inLocal || inRemote) && !ids.includes(id)) throw new Error(`追加した行 ${id} が消えた\n${serializeNote(local)}\n---\n${serializeNote(remoteDoc)}\n---\n${serializeNote(r.doc)}`);
      }

      const body = serializeNote(r.doc);
      const again = parseNote(body, { generateId: () => 'NEVER' });
      const view = (x: NoteDoc) => noteItems(x).map((i) => [i.id, i.depth, i.checked, i.text.trim()]);
      if (JSON.stringify(view(again)) !== JSON.stringify(view(r.doc))) throw new Error(`読み直すと変わる:\n${body}`);
    }
  });

  it('自分が何も変えていなければ GitHub の本文そのまま', () => {
    for (let n = 0; n < 300; n++) {
      const b = P(SRC);
      const remote = parseNote(serializeNote(mutate(b, 'R', [])), { generateId: () => 'NEVER' });
      const body = serializeNote(remote);
      if (serializeNote(merge3(b, b, remote).doc) !== body) throw new Error(`本文が変わった:\n${body}`);
    }
  });
});
