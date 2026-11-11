/**
 * 行 ID 単位の 3-way マージ（DESIGN.md §5）。UI から独立した純粋関数。
 *
 * GitHub 上の本文（remote）を土台にして、自分の変更（base → local の差分）を当てる。
 * アプリはメモや空行を編集しないので、自分の変更は項目だけに現れる。
 * remote の項目は元の行（source）を持ったままなので、触っていない行の書式は変わらない。
 */
import { appendAtEnd, indexOfItem, parentIndex, shiftDepth, subtreeEnd } from '../outline/edit';
import { noteItems, normalizeItemText, type Entry, type ItemEntry, type NoteDoc } from './format';

export type ConflictKind =
  /** 両方が同じ行を違う内容に変えた */
  | 'both-edited'
  /** 自分が削除し、GitHub 側で編集された */
  | 'local-deleted'
  /** 自分が編集し、GitHub 側で削除された */
  | 'remote-deleted';

export interface ItemContent {
  text: string;
  checked: boolean | null;
}

export interface MergeConflict {
  id: string;
  kind: ConflictKind;
  base: ItemContent;
  local: ItemContent | null;
  remote: ItemContent | null;
}

export type Resolution = 'local' | 'remote';

export interface MergeResult {
  doc: NoteDoc;
  /** 解決が必要な行。resolutions で指定済みの行は含まない。未解決の行は remote の内容で doc に入る */
  conflicts: MergeConflict[];
}

const contentKey = (i: ItemEntry): string => JSON.stringify([normalizeItemText(i.text), i.checked, i.continuation]);
const contentOf = (i: ItemEntry): ItemContent => ({ text: normalizeItemText(i.text), checked: i.checked });

const byId = (items: ItemEntry[]) => new Map(items.map((i) => [i.id, i]));

/** 各項目の親の ID（ルートは null） */
function parents(entries: readonly Entry[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  entries.forEach((e, i) => {
    if (e.kind !== 'item') return;
    const p = parentIndex(entries, i);
    out.set(e.id, p === null ? null : (entries[p] as ItemEntry).id);
  });
  return out;
}

function childrenLists(entries: readonly Entry[], parentOf: Map<string, string | null>): Map<string | null, string[]> {
  const out = new Map<string | null, string[]>();
  for (const e of entries) {
    if (e.kind !== 'item') continue;
    const p = parentOf.get(e.id) ?? null;
    out.set(p, [...(out.get(p) ?? []), e.id]);
  }
  return out;
}

/** 最長共通部分列。順序が保たれている項目を求める */
function lcs(a: readonly string[], b: readonly string[]): Set<string> {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = dp[i] as number[];
      const next = dp[i + 1] as number[];
      row[j] = a[i] === b[j] ? (next[j + 1] as number) + 1 : Math.max(next[j] as number, row[j + 1] as number);
    }
  }
  const out = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.add(a[i] as string);
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] as number) >= (dp[i]?.[j + 1] as number)) i++;
    else j++;
  }
  return out;
}

/**
 * ID のない行（手編集）や、別の人が別の ID を振った行を揃える。
 * base にない ID の remote の行を、remote にない ID の base の行とテキストで対応づける。
 * すでに GitHub に書かれている ID があればそちらを正とする（コメントの紐づけを保つため）。
 */
function alignIds(base: NoteDoc, local: NoteDoc, remote: NoteDoc): { base: NoteDoc; local: NoteDoc; remote: NoteDoc } {
  const baseIds = new Set(noteItems(base).map((i) => i.id));
  const remoteIds = new Set(noteItems(remote).map((i) => i.id));
  const unclaimed = new Map<string, ItemEntry[]>();
  for (const b of noteItems(base)) {
    if (remoteIds.has(b.id)) continue;
    const k = normalizeItemText(b.text);
    unclaimed.set(k, [...(unclaimed.get(k) ?? []), b]);
  }
  const rename = new Map<string, string>(); // base / local の ID → remote の ID
  const remoteRename = new Map<string, string>(); // remote の ID → base の ID
  for (const r of noteItems(remote)) {
    if (baseIds.has(r.id)) continue;
    const b = unclaimed.get(normalizeItemText(r.text))?.shift();
    if (!b) continue;
    if (r.source?.id) rename.set(b.id, r.id);
    else remoteRename.set(r.id, b.id);
  }
  const apply = (d: NoteDoc, m: Map<string, string>): NoteDoc =>
    m.size === 0 ? d : { ...d, entries: d.entries.map((e) => (e.kind === 'item' && m.has(e.id) ? { ...e, id: m.get(e.id) as string } : e)) };
  return { base: apply(base, rename), local: apply(local, rename), remote: apply(remote, remoteRename) };
}

/** 項目だけを取り除き、子は 1 段上げて残す */
function removeKeepingChildren(out: Entry[], id: string): void {
  const i = indexOfItem(out, id);
  if (i < 0) return;
  const end = subtreeEnd(out, i);
  out.splice(i, end - i, ...shiftDepth(out.slice(i + 1, end), -1));
}

/** 親の下に収まるよう深さを整える（親が消えて深さが飛んだ場合など） */
function normalizeDepths(entries: Entry[]): Entry[] {
  let limit = 0;
  return entries.map((e) => {
    if (e.kind === 'memo' || e.kind === 'meta') {
      limit = 0;
      return e;
    }
    if (e.kind !== 'item') return e;
    const depth = Math.min(e.depth, limit);
    limit = depth + 1;
    return depth === e.depth ? e : { ...e, depth };
  });
}

export function merge3(baseIn: NoteDoc, localIn: NoteDoc, remoteIn: NoteDoc, resolutions: ReadonlyMap<string, Resolution> = new Map()): MergeResult {
  const { base, local, remote } = alignIds(baseIn, localIn, remoteIn);
  const baseMap = byId(noteItems(base));
  const localMap = byId(noteItems(local));
  const remoteMap = byId(noteItems(remote));

  const conflicts: MergeConflict[] = [];
  const toDelete: string[] = [];
  const toEdit: ItemEntry[] = [];
  const restore = new Set<string>(); // GitHub 側で消えたが、自分の編集を残す行

  for (const [id, b] of baseMap) {
    const l = localMap.get(id);
    const r = remoteMap.get(id);
    if (!l && !r) continue;
    const bk = contentKey(b);
    const localChanged = l !== undefined && contentKey(l) !== bk;
    const remoteChanged = r !== undefined && contentKey(r) !== bk;

    if (l && r) {
      if (localChanged && remoteChanged && contentKey(l) !== contentKey(r)) {
        const res = resolutions.get(id);
        if (res === undefined) conflicts.push({ id, kind: 'both-edited', base: contentOf(b), local: contentOf(l), remote: contentOf(r) });
        else if (res === 'local') toEdit.push(l);
      } else if (localChanged) toEdit.push(l);
    } else if (r) {
      // 自分が削除した
      if (remoteChanged) {
        const res = resolutions.get(id);
        if (res === undefined) conflicts.push({ id, kind: 'local-deleted', base: contentOf(b), local: null, remote: contentOf(r) });
        else if (res === 'local') toDelete.push(id);
      } else toDelete.push(id);
    } else if (l && localChanged) {
      // GitHub 側で削除された
      const res = resolutions.get(id);
      if (res === undefined) conflicts.push({ id, kind: 'remote-deleted', base: contentOf(b), local: contentOf(l), remote: null });
      else if (res === 'local') restore.add(id);
    }
  }

  const out: Entry[] = [...remote.entries];
  for (const id of toDelete) removeKeepingChildren(out, id);
  for (const l of toEdit) {
    const i = indexOfItem(out, l.id);
    const r = out[i] as ItemEntry;
    out[i] = { ...r, text: l.text, checked: l.checked, continuation: l.continuation };
  }

  // 位置: base と比べて親か順序が変わった項目と、新しい項目を、自分の文書の順に置いていく
  const baseParents = parents(base.entries);
  const localParents = parents(local.entries);
  const baseChildren = childrenLists(base.entries, baseParents);
  const localChildren = childrenLists(local.entries, localParents);

  const toPlace = new Set<string>(restore);
  for (const l of noteItems(local)) {
    if (!baseMap.has(l.id)) toPlace.add(l.id);
    else if (baseParents.get(l.id) !== localParents.get(l.id) && remoteMap.has(l.id)) toPlace.add(l.id);
  }
  for (const [parent, kids] of localChildren) {
    const commonLocal = kids.filter((k) => baseParents.get(k) === parent && baseMap.has(k));
    const commonBase = (baseChildren.get(parent) ?? []).filter((k) => localParents.get(k) === parent);
    const kept = lcs(commonBase, commonLocal);
    for (const k of commonLocal) if (!kept.has(k) && remoteMap.has(k)) toPlace.add(k);
  }

  for (const l of noteItems(local)) {
    if (!toPlace.has(l.id)) continue;

    // いったん取り外す（GitHub 側で足された子も一緒に動く）
    let moving: Entry[] = [{ ...l, depth: 0 }];
    const at = indexOfItem(out, l.id);
    if (at >= 0) {
      const end = subtreeEnd(out, at);
      moving = shiftDepth(out.slice(at, end), -(out[at] as ItemEntry).depth);
      out.splice(at, end - at);
    }

    // 親: 自分の文書での祖先のうち、残っているいちばん近いもの
    let parentId = localParents.get(l.id) ?? null;
    while (parentId !== null && indexOfItem(out, parentId) < 0) parentId = localParents.get(parentId) ?? null;
    const parentAt = parentId === null ? -1 : indexOfItem(out, parentId);
    const depth = parentAt < 0 ? 0 : (out[parentAt] as ItemEntry).depth + 1;
    const placed = shiftDepth(moving, depth);

    // 位置: 自分の文書で直前の兄弟のうち、同じ親の下に残っているものの後ろ
    const siblings = localChildren.get(localParents.get(l.id) ?? null) ?? [];
    const pos = siblings.indexOf(l.id);
    const underParent = (id: string): number | null => {
      const i = indexOfItem(out, id);
      if (i < 0) return null;
      const p = parentIndex(out, i);
      return (p === null ? -1 : p) === parentAt ? i : null;
    };
    let insertAt: number | null = null;
    for (let s = pos - 1; s >= 0 && insertAt === null; s--) {
      const i = underParent(siblings[s] as string);
      if (i !== null) insertAt = subtreeEnd(out, i);
    }
    if (insertAt === null && parentAt >= 0) insertAt = parentAt + 1;
    if (insertAt === null) {
      for (let s = pos + 1; s < siblings.length && insertAt === null; s++) insertAt = underParent(siblings[s] as string);
    }
    if (insertAt === null) {
      const first = out.findIndex((e) => e.kind === 'item');
      if (first >= 0) insertAt = first;
    }
    if (insertAt === null) {
      const appended = appendAtEnd(out, placed[0] as ItemEntry);
      const head = appended.indexOf(placed[0] as Entry);
      appended.splice(head + 1, 0, ...placed.slice(1));
      out.length = 0;
      out.push(...appended);
    } else {
      out.splice(insertAt, 0, ...placed);
    }
  }

  return { doc: { eol: remote.eol, entries: normalizeDepths(out) }, conflicts };
}
