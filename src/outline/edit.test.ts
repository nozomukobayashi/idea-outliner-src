import { describe, expect, it } from 'vitest';
import { noteItems, parseNote, serializeNote, type NoteDoc } from '../note/format';
import {
  appendItem,
  cycleChecked,
  deleteItem,
  indentItem,
  mergeIntoPrevious,
  moveDown,
  moveUp,
  newNoteBody,
  outdentItem,
  setItemText,
  splitItem,
  toggleChecked,
} from './edit';

function seq() {
  let n = 0;
  return (existing: ReadonlySet<string>) => {
    let id: string;
    do id = `new${n++}`;
    while (existing.has(id));
    return id;
  };
}

const TREE = ['- a <!-- id:a -->', '  - b <!-- id:b -->', '    - c <!-- id:c -->', '  - d <!-- id:d -->', '- e <!-- id:e -->', ''].join('\n');
const doc = (s = TREE) => parseNote(s, { generateId: seq() });
const shape = (d: NoteDoc) => noteItems(d).map((i) => `${' '.repeat(i.depth)}${i.id}`);

describe('インデント', () => {
  it('子孫ごと直前の兄弟の子になる', () => {
    expect(shape(indentItem(doc(), 'd'))).toEqual(['a', ' b', '  c', '  d', 'e']);
    expect(shape(indentItem(doc(), 'e'))).toEqual(['a', ' b', '  c', ' d', ' e']);
  });

  it('兄弟がなければ何もしない', () => {
    const d = doc();
    expect(indentItem(d, 'a')).toBe(d);
    expect(indentItem(d, 'b')).toBe(d);
  });

  it('子孫も一緒に深くなる', () => {
    const d = doc('- a <!-- id:a -->\n- b <!-- id:b -->\n  - c <!-- id:c -->\n');
    expect(shape(indentItem(d, 'b'))).toEqual(['a', ' b', '  c']);
  });
});

describe('アウトデント', () => {
  it('親の子孫の後ろに移り、後ろの兄弟を巻き込まない', () => {
    expect(shape(outdentItem(doc(), 'b'))).toEqual(['a', ' d', 'b', ' c', 'e']);
  });

  it('深さ 0 では何もしない', () => {
    const d = doc();
    expect(outdentItem(d, 'a')).toBe(d);
  });
});

describe('並べ替え', () => {
  it('子孫ごと兄弟と入れ替わる', () => {
    expect(shape(moveUp(doc(), 'd'))).toEqual(['a', ' d', ' b', '  c', 'e']);
    expect(shape(moveDown(doc(), 'b'))).toEqual(['a', ' d', ' b', '  c', 'e']);
    expect(shape(moveUp(doc(), 'e'))).toEqual(['e', 'a', ' b', '  c', ' d']);
  });

  it('端では何もしない', () => {
    const d = doc();
    expect(moveUp(d, 'a')).toBe(d);
    expect(moveDown(d, 'e')).toBe(d);
    expect(moveUp(d, 'b')).toBe(d);
    expect(moveDown(d, 'd')).toBe(d);
  });

  it('メモを越えない', () => {
    const d = doc('- a <!-- id:a -->\n\nメモ\n\n- b <!-- id:b -->\n');
    expect(moveUp(d, 'b')).toBe(d);
    expect(moveDown(d, 'a')).toBe(d);
  });

  it('間の空行は位置を保つ', () => {
    const out = serializeNote(moveDown(doc('- a <!-- id:a -->\n\n- b <!-- id:b -->\n'), 'a'));
    expect(out).toBe('- b <!-- id:b -->\n\n- a <!-- id:a -->\n');
  });
});

describe('Enter', () => {
  it('行末では空の兄弟を足す', () => {
    const r = splitItem(doc(), 'e', 1, true, seq());
    expect(shape(r.doc)).toEqual(['a', ' b', '  c', ' d', 'e', 'new0']);
    expect(r).toMatchObject({ focusId: 'new0', caret: 0 });
  });

  it('子が見えていれば最初の子を足す', () => {
    expect(shape(splitItem(doc(), 'a', 1, true, seq()).doc)).toEqual(['a', ' new0', ' b', '  c', ' d', 'e']);
  });

  it('折りたたまれていれば子孫の後ろに兄弟を足す', () => {
    expect(shape(splitItem(doc(), 'a', 1, false, seq()).doc)).toEqual(['a', ' b', '  c', ' d', 'new0', 'e']);
  });

  it('途中で分ける', () => {
    const d = splitItem(doc('- あいう <!-- id:a -->\n'), 'a', 1, true, seq()).doc;
    expect(noteItems(d).map((i) => i.text)).toEqual(['あ', 'いう']);
  });

  it('行頭では上に空行を足し、元の行の ID を動かさない', () => {
    const r = splitItem(doc('- x <!-- id:a -->\n'), 'a', 0, true, seq());
    expect(noteItems(r.doc).map((i) => [i.id, i.text])).toEqual([
      ['new0', ''],
      ['a', 'x'],
    ]);
    expect(r.focusId).toBe('a');
  });

  it('TODO の行からは未完了の TODO ができる', () => {
    const r = splitItem(doc('- [x] t <!-- id:a -->\n'), 'a', 3, true, seq());
    expect(noteItems(r.doc)[1]?.checked).toBe(false);
  });

  it('続きの行の後ろに足す', () => {
    const r = splitItem(doc('- a <!-- id:a -->\n\n  段落\n'), 'a', 1, true, seq());
    expect(serializeNote(r.doc)).toBe('- a <!-- id:a -->\n\n  段落\n- <!-- id:new0 -->\n');
  });
});

describe('テキストとチェック', () => {
  it('入力途中の末尾の空白は持つが、保存する本文には出さない', () => {
    const d = setItemText(doc('- a <!-- id:a -->\n'), 'a', 'a b ');
    expect(noteItems(d)[0]?.text).toBe('a b ');
    expect(serializeNote(d)).toBe('- a b <!-- id:a -->\n');
  });

  it('空白を足しただけなら元の行のまま', () => {
    const src = '* a <!-- id:a -->\n';
    expect(serializeNote(setItemText(doc(src), 'a', 'a '))).toBe(src);
  });

  it('改行は空白にする', () => {
    expect(noteItems(setItemText(doc('- a <!-- id:a -->\n'), 'a', 'x\ny'))[0]?.text).toBe('x y');
  });

  it('箇条書きの行頭の [ ] は TODO にする', () => {
    const [i] = noteItems(setItemText(doc('- a <!-- id:a -->\n'), 'a', '[ ] x'));
    expect(i).toMatchObject({ checked: false, text: 'x' });
  });

  it('同じ内容なら何もしない', () => {
    const d = doc('- a <!-- id:a -->\n');
    expect(setItemText(d, 'a', 'a')).toBe(d);
  });

  it('チェックの切り替え', () => {
    const d = doc('- [ ] a <!-- id:a -->\n- b <!-- id:b -->\n');
    expect(noteItems(toggleChecked(d, 'a'))[0]?.checked).toBe(true);
    expect(toggleChecked(d, 'b')).toBe(d);
  });

  it('箇条書き → TODO → 完了 → 箇条書き', () => {
    let d = doc('- a <!-- id:a -->\n');
    const states = [];
    for (let n = 0; n < 3; n++) {
      d = cycleChecked(d, 'a');
      states.push(noteItems(d)[0]?.checked);
    }
    expect(states).toEqual([false, true, null]);
  });
});

describe('削除と連結', () => {
  it('子孫ごと削除する', () => {
    expect(shape(deleteItem(doc(), 'b'))).toEqual(['a', ' d', 'e']);
  });

  it('直前の行に連結する', () => {
    const r = mergeIntoPrevious(doc('- ab <!-- id:a -->\n- cd <!-- id:b -->\n'), 'b', 'a');
    expect(noteItems(r!.doc).map((i) => i.text)).toEqual(['abcd']);
    expect(r).toMatchObject({ focusId: 'a', caret: 2 });
  });

  it('子のある行は連結しない', () => {
    expect(mergeIntoPrevious(doc(), 'b', 'a')).toBeNull();
  });
});

describe('追加', () => {
  it.each([
    ['空の本文', '', '- <!-- id:new0 -->'],
    ['メモだけ', 'メモ\n', 'メモ\n\n- <!-- id:new0 -->\n'],
    ['改行なしのメモ', 'メモ', 'メモ\n\n- <!-- id:new0 -->'],
    ['メタデータだけ', '<!-- idea-outliner:v1 {} -->\n\n', '<!-- idea-outliner:v1 {} -->\n\n- <!-- id:new0 -->\n'],
    ['リストの後ろにメモ', '- a <!-- id:a -->\n\nメモ\n', '- a <!-- id:a -->\n- <!-- id:new0 -->\n\nメモ\n'],
  ])('%s', (_, src, expected) => {
    expect(serializeNote(appendItem(doc(src), seq()).doc)).toBe(expected);
  });

  it('新規ノートの本文は読み直せる', () => {
    const d = parseNote(newNoteBody(seq()));
    expect(noteItems(d)).toHaveLength(1);
    expect(d.entries[0]?.kind).toBe('meta');
  });
});

describe('手編集の書式の上で編集しても構造が崩れない', () => {
  const reparsed = (d: NoteDoc) => parseNote(serializeNote(d), { generateId: () => 'NEVER' });

  it('番号付きリストの子（親の本文の桁に合わせる）', () => {
    const d = indentItem(doc('1. a <!-- id:a -->\n2. b <!-- id:b -->\n'), 'b');
    expect(serializeNote(d)).toBe('1. a <!-- id:a -->\n   - b <!-- id:b -->\n');
    expect(shape(reparsed(d))).toEqual(['a', ' b']);
  });

  it('4 スペース字下げの子に孫を足す', () => {
    const r = splitItem(doc('- a <!-- id:a -->\n    - b <!-- id:b -->\n'), 'b', 1, true, seq());
    const d = indentItem(r.doc, r.focusId);
    expect(shape(reparsed(d))).toEqual(['a', ' b', '  new0']);
  });

  it('続きの行も一緒にずれる', () => {
    const d = indentItem(doc('- a <!-- id:a -->\n- b <!-- id:b -->\n\n  段落\n'), 'b');
    expect(serializeNote(d)).toBe('- a <!-- id:a -->\n  - b <!-- id:b -->\n\n    段落\n');
  });

  it('閉じていないコードブロックの後ろに足すと閉じる', () => {
    const r = splitItem(doc('- a <!-- id:a -->\n  ```\n  x'), 'a', 1, true, seq());
    expect(shape(reparsed(r.doc))).toEqual(['a', 'new0']);
  });

  // 操作をランダムに重ねても、書き出して読み直すと同じ形になること
  function rng(seed: number) {
    return () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }
  const SOURCES = [
    TREE,
    '1. a\n2. b\n   - c\n\n     段落\n3) d\n',
    '* a\n    * b\n        * c\n    * d\n\nメモ\n\n+ e\n\t+ f\n',
    '    - a\n  - b\n- c\n   - d\n - e\n',
    '# 見出し\n\n- [ ] a\n\n  ```\n  - x\n  ```\n- [x] b\nつづき\n\n---\n\n- c\n',
    '-\n-   \n  - a\n- ```\n',
    '- a\n  ```\n  開いたまま\n',
    '',
    'メモだけ',
  ];

  it('ランダムな操作列（3000 回）', () => {
    const rand = rng(7);
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)] as T;
    for (let n = 0; n < 3000; n++) {
      const gen = seq();
      let d = parseNote(pick(SOURCES), { generateId: gen });
      const steps = 1 + Math.floor(rand() * 12);
      for (let s = 0; s < steps; s++) {
        const ids = noteItems(d).map((i) => i.id);
        if (ids.length === 0) {
          d = appendItem(d, gen).doc;
          continue;
        }
        const id = pick(ids);
        const op = Math.floor(rand() * 9);
        if (op === 0) d = indentItem(d, id);
        else if (op === 1) d = outdentItem(d, id);
        else if (op === 2) d = moveUp(d, id);
        else if (op === 3) d = moveDown(d, id);
        else if (op === 4) d = deleteItem(d, id);
        else if (op === 5) d = splitItem(d, id, Math.floor(rand() * 3), rand() < 0.5, gen).doc;
        else if (op === 6) d = setItemText(d, id, pick(['新しい文', '**x** ', '', '- 入れ子風', '1. 番号風', '`code`']));
        else if (op === 7) d = cycleChecked(d, id);
        else d = appendItem(d, gen).doc;
      }
      const body = serializeNote(d);
      const again = reparsed(d);
      const view = (x: NoteDoc) => noteItems(x).map((i) => [i.id, i.depth, i.checked, i.text.trim()]);
      if (JSON.stringify(view(again)) !== JSON.stringify(view(d))) {
        throw new Error(`読み直すと変わる:\n${body}\n${JSON.stringify(view(d))}\n${JSON.stringify(view(again))}`);
      }
      if (serializeNote(again) !== body) throw new Error(`2 回目で差分:\n${body}`);
    }
  });
});
