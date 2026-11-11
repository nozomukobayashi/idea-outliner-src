/**
 * アウトラインの編集操作。UI から独立した純粋関数で、入力の文書は書き換えない。
 * 何も変わらない操作は、受け取った doc をそのまま返す（=== で判定できる）。
 */
import { defaultGenerateId, noteItems, type Entry, type ItemEntry, type NoteDoc } from '../note/format';

export type IdGenerator = (existing: ReadonlySet<string>) => string;

const asItem = (e: Entry | undefined): ItemEntry | null => (e && e.kind === 'item' ? e : null);

export const indexOfItem = (entries: readonly Entry[], id: string): number => entries.findIndex((e) => e.kind === 'item' && e.id === id);

/** 項目とその子孫の範囲の終わり（含まない）。後ろに続く空行は範囲に入れない */
export function subtreeEnd(entries: readonly Entry[], i: number): number {
  const depth = asItem(entries[i])?.depth ?? 0;
  let end = i + 1;
  for (let j = i + 1; j < entries.length; j++) {
    const e = entries[j] as Entry;
    if (e.kind === 'memo' || e.kind === 'meta') break;
    if (e.kind === 'item') {
      if (e.depth <= depth) break;
      end = j + 1;
    }
  }
  return end;
}

function prevSibling(entries: readonly Entry[], i: number): number | null {
  const depth = asItem(entries[i])?.depth ?? 0;
  for (let j = i - 1; j >= 0; j--) {
    const e = entries[j] as Entry;
    if (e.kind === 'memo' || e.kind === 'meta') return null;
    if (e.kind === 'item') {
      if (e.depth < depth) return null;
      if (e.depth === depth) return j;
    }
  }
  return null;
}

function nextSibling(entries: readonly Entry[], i: number): number | null {
  const depth = asItem(entries[i])?.depth ?? 0;
  for (let j = subtreeEnd(entries, i); j < entries.length; j++) {
    const e = entries[j] as Entry;
    if (e.kind === 'memo' || e.kind === 'meta') return null;
    if (e.kind === 'item') return e.depth === depth ? j : null;
  }
  return null;
}

export function parentIndex(entries: readonly Entry[], i: number): number | null {
  const depth = asItem(entries[i])?.depth ?? 0;
  for (let j = i - 1; j >= 0; j--) {
    const e = entries[j] as Entry;
    if (e.kind === 'memo' || e.kind === 'meta') return null;
    if (e.kind === 'item' && e.depth < depth) return j;
  }
  return null;
}

/** 範囲内の項目の深さをずらす */
export function shiftDepth(range: readonly Entry[], delta: number): Entry[] {
  return range.map((e) => (e.kind === 'item' ? { ...e, depth: e.depth + delta } : e));
}

function newItem(doc: NoteDoc, fields: Pick<ItemEntry, 'depth' | 'checked' | 'text'>, generateId: IdGenerator): ItemEntry {
  const existing = new Set(noteItems(doc).map((i) => i.id));
  return { kind: 'item', id: generateId(existing), continuation: [], source: null, ...fields };
}

function replaceItem(doc: NoteDoc, i: number, item: ItemEntry): NoteDoc {
  const entries = [...doc.entries];
  entries[i] = item;
  return { ...doc, entries };
}

const CHECKBOX_PREFIX = /^\[([ xX])\][ \t]/;

/**
 * 行のテキストを変える。入力途中の末尾の空白はそのまま持つ（保存するときに整える）。
 * ただの箇条書きの行頭に `[ ] ` と打ったら TODO にする（本文に書くと次の読み込みで TODO になるため）。
 */
export function setItemText(doc: NoteDoc, id: string, text: string): NoteDoc {
  const i = indexOfItem(doc.entries, id);
  const item = asItem(doc.entries[i]);
  if (!item) return doc;
  let next = text.replace(/[\r\n]+/g, ' ');
  let checked = item.checked;
  const m = checked === null ? CHECKBOX_PREFIX.exec(next) : null;
  if (m) {
    checked = m[1] !== ' ';
    next = next.slice(m[0].length);
  }
  if (next === item.text && checked === item.checked) return doc;
  return replaceItem(doc, i, { ...item, text: next, checked });
}

/** チェックを切り替える（TODO の行だけ） */
export function toggleChecked(doc: NoteDoc, id: string): NoteDoc {
  const i = indexOfItem(doc.entries, id);
  const item = asItem(doc.entries[i]);
  if (!item || item.checked === null) return doc;
  return replaceItem(doc, i, { ...item, checked: !item.checked });
}

/** 箇条書き → TODO → 完了 → 箇条書き */
export function cycleChecked(doc: NoteDoc, id: string): NoteDoc {
  const i = indexOfItem(doc.entries, id);
  const item = asItem(doc.entries[i]);
  if (!item) return doc;
  const checked = item.checked === null ? false : item.checked === false ? true : null;
  return replaceItem(doc, i, { ...item, checked });
}

export interface InsertResult {
  doc: NoteDoc;
  /** 次にカーソルを置く行 */
  focusId: string;
  /** その行のカーソル位置 */
  caret: number;
}

/**
 * Enter の動作。カーソル位置で行を分け、後ろの部分を新しい行にする。
 * 子が見えている行では最初の子として、それ以外は子孫の後ろに兄弟として追加する。
 * 行頭で Enter したときは上に空行を足す（ID やコメントの紐づけを元の行に残すため）。
 */
export function splitItem(doc: NoteDoc, id: string, offset: number, childrenVisible: boolean, generateId: IdGenerator = defaultGenerateId): InsertResult {
  const i = indexOfItem(doc.entries, id);
  const item = asItem(doc.entries[i]);
  if (!item) return { doc, focusId: id, caret: offset };
  const checked = item.checked === null ? null : false;
  const entries = [...doc.entries];

  if (offset === 0 && item.text !== '') {
    entries.splice(i, 0, newItem(doc, { depth: item.depth, checked, text: '' }, generateId));
    return { doc: { ...doc, entries }, focusId: id, caret: 0 };
  }

  const hasChildren = subtreeEnd(entries, i) > i + 1;
  const asChild = hasChildren && childrenVisible;
  const created = newItem(doc, { depth: asChild ? item.depth + 1 : item.depth, checked, text: item.text.slice(offset).trimStart() }, generateId);
  entries[i] = { ...item, text: item.text.slice(0, offset).trimEnd() };
  entries.splice(asChild ? i + 1 : subtreeEnd(entries, i), 0, created);
  return { doc: { ...doc, entries }, focusId: created.id, caret: 0 };
}

/** 項目を子孫ごと削除する */
export function deleteItem(doc: NoteDoc, id: string): NoteDoc {
  const i = indexOfItem(doc.entries, id);
  if (i < 0) return doc;
  const entries = [...doc.entries];
  entries.splice(i, subtreeEnd(entries, i) - i);
  return { ...doc, entries };
}

/** 直前の兄弟の子にする（子孫ごと） */
export function indentItem(doc: NoteDoc, id: string): NoteDoc {
  const i = indexOfItem(doc.entries, id);
  if (i < 0 || prevSibling(doc.entries, i) === null) return doc;
  const end = subtreeEnd(doc.entries, i);
  const entries = [...doc.entries];
  entries.splice(i, end - i, ...shiftDepth(doc.entries.slice(i, end), 1));
  return { ...doc, entries };
}

/** 親の兄弟にする（子孫ごと）。後ろの兄弟を巻き込まないよう、親の子孫の後ろに移す */
export function outdentItem(doc: NoteDoc, id: string): NoteDoc {
  const i = indexOfItem(doc.entries, id);
  const p = i < 0 ? null : parentIndex(doc.entries, i);
  if (p === null) return doc;
  const end = subtreeEnd(doc.entries, i);
  const parentEnd = subtreeEnd(doc.entries, p);
  const moved = shiftDepth(doc.entries.slice(i, end), -1);
  return {
    ...doc,
    entries: [...doc.entries.slice(0, i), ...doc.entries.slice(end, parentEnd), ...moved, ...doc.entries.slice(parentEnd)],
  };
}

function swapWithPrev(doc: NoteDoc, i: number, p: number): NoteDoc {
  const { entries } = doc;
  const pEnd = subtreeEnd(entries, p);
  const end = subtreeEnd(entries, i);
  return {
    ...doc,
    entries: [...entries.slice(0, p), ...entries.slice(i, end), ...entries.slice(pEnd, i), ...entries.slice(p, pEnd), ...entries.slice(end)],
  };
}

export function moveUp(doc: NoteDoc, id: string): NoteDoc {
  const i = indexOfItem(doc.entries, id);
  const p = i < 0 ? null : prevSibling(doc.entries, i);
  return p === null ? doc : swapWithPrev(doc, i, p);
}

export function moveDown(doc: NoteDoc, id: string): NoteDoc {
  const i = indexOfItem(doc.entries, id);
  const n = i < 0 ? null : nextSibling(doc.entries, i);
  return n === null ? doc : swapWithPrev(doc, n, i);
}

/** 項目のない文書の末尾に項目を置くときの位置と、必要な区切りの空行 */
export function appendAtEnd(entries: readonly Entry[], item: ItemEntry): Entry[] {
  const out = [...entries];
  const last = out[out.length - 1];
  if (!last) return [item];
  if (last.kind !== 'blank') return [...out, { kind: 'blank', raw: '' }, item];
  const beforeLast = out[out.length - 2];
  // 最後の空行は本文末尾の改行。その手前も空行なら、すでに区切られている
  if (!beforeLast || beforeLast.kind === 'blank') {
    out.splice(out.length - 1, 0, item);
    return out;
  }
  out.splice(out.length - 1, 0, { kind: 'blank', raw: '' }, item);
  return out;
}

/** 文書の最後のリストの末尾に、深さ 0 の空行を足す */
export function appendItem(doc: NoteDoc, generateId: IdGenerator = defaultGenerateId): InsertResult {
  const created = newItem(doc, { depth: 0, checked: null, text: '' }, generateId);
  let last = -1;
  doc.entries.forEach((e, i) => {
    if (e.kind === 'item') last = i;
  });
  if (last < 0) return { doc: { ...doc, entries: appendAtEnd(doc.entries, created) }, focusId: created.id, caret: 0 };
  const entries = [...doc.entries];
  entries.splice(last + 1, 0, created);
  return { doc: { ...doc, entries }, focusId: created.id, caret: 0 };
}

/**
 * Backspace（行頭）の動作。子のない行を直前の行に連結する。
 * prevId は表示上の直前の行。連結できない場合は null を返す。
 */
export function mergeIntoPrevious(doc: NoteDoc, id: string, prevId: string): InsertResult | null {
  const i = indexOfItem(doc.entries, id);
  const p = indexOfItem(doc.entries, prevId);
  const item = asItem(doc.entries[i]);
  const prev = asItem(doc.entries[p]);
  if (!item || !prev || subtreeEnd(doc.entries, i) > i + 1 || item.continuation.length > 0) return null;
  const caret = prev.text.length;
  const entries = [...doc.entries];
  entries[p] = { ...prev, text: prev.text + item.text };
  entries.splice(i, 1);
  return { doc: { ...doc, entries }, focusId: prevId, caret };
}

/** 新規ノートの本文 */
export function newNoteBody(generateId: IdGenerator = defaultGenerateId): string {
  return `<!-- idea-outliner:v1 {} -->\n\n- <!-- id:${generateId(new Set())} -->\n`;
}
