/** アウトラインの表示行を組み立てる（折りたたみの反映）。UI から独立した純粋関数 */
import type { Entry, ItemEntry, MemoEntry } from '../note/format';

export type Row =
  | { kind: 'item'; item: ItemEntry; hasChildren: boolean; collapsed: boolean }
  | { kind: 'memo'; memo: MemoEntry };

/** 各 item が子を持つか（次の item がより深いか。メモを挟んだら別のリスト） */
export function childrenFlags(entries: Entry[]): Map<string, boolean> {
  const flags = new Map<string, boolean>();
  let prev: ItemEntry | null = null;
  for (const e of entries) {
    if (e.kind === 'item') {
      if (prev) flags.set(prev.id, e.depth > prev.depth);
      prev = e;
    } else if (e.kind === 'memo') {
      if (prev) flags.set(prev.id, false);
      prev = null;
    }
  }
  if (prev) flags.set(prev.id, false);
  return flags;
}

export function buildRows(entries: Entry[], collapsed: ReadonlySet<string>): Row[] {
  const flags = childrenFlags(entries);
  const rows: Row[] = [];
  let hideBelow = Infinity; // この深さより深い項目を隠す
  for (const e of entries) {
    if (e.kind === 'memo') {
      hideBelow = Infinity;
      rows.push({ kind: 'memo', memo: e });
      continue;
    }
    if (e.kind !== 'item') continue;
    if (e.depth > hideBelow) continue;
    hideBelow = Infinity;
    const hasChildren = flags.get(e.id) ?? false;
    const isCollapsed = hasChildren && collapsed.has(e.id);
    if (isCollapsed) hideBelow = e.depth;
    rows.push({ kind: 'item', item: e, hasChildren, collapsed: isCollapsed });
  }
  return rows;
}

/** 子を持つ項目の ID（「すべて折りたたむ」用） */
export function parentIds(entries: Entry[]): string[] {
  return [...childrenFlags(entries)].filter(([, has]) => has).map(([id]) => id);
}
