/**
 * ノート本文（DESIGN.md §4.1）のパースとシリアライズ。UI から独立した純粋関数。
 *
 * 方針:
 * - 文書は「行の並び」として持つ（item / memo / blank / meta）。アウトラインの木構造は item の depth で表す
 * - 手編集された Markdown を壊さないため、各 item は元の行（raw）を覚えておき、
 *   内容が変わっていなければ raw をそのまま書き戻す。ID を足すだけなら raw の末尾に ID コメントを足す
 * - 変更された item だけ正規形（2 スペースインデント、`- `、末尾に ID）で書き出す
 */

export type Eol = '\n' | '\r\n';

export interface NoteMeta {
  version: number;
  /** メタデータコメントの JSON 部分。壊れていたら空オブジェクト */
  data: Record<string, unknown>;
}

export interface ItemSource {
  raw: string;
  depth: number;
  checked: boolean | null;
  text: string;
  /** 元の行に書かれていた ID（なければ null） */
  id: string | null;
}

export interface ItemEntry {
  kind: 'item';
  id: string;
  depth: number;
  /** null: ただの箇条書き / false: `[ ]` / true: `[x]` */
  checked: boolean | null;
  /** 行のテキスト（チェックボックスと ID コメントを除いたもの。インライン Markdown を含む） */
  text: string;
  /** 項目に続く、リスト項目ではない行（段落の続き・インデントされた段落やコードブロック）。生のまま保持する */
  continuation: string[];
  /** パース元の情報。アプリで新規作成した行は null */
  source: ItemSource | null;
}

export interface MemoEntry {
  kind: 'memo';
  /** リストではない段落・見出し・コードブロックなど。生のまま保持する */
  lines: string[];
}

export interface BlankEntry {
  kind: 'blank';
  raw: string;
}

export interface MetaEntry {
  kind: 'meta';
  raw: string;
  meta: NoteMeta;
}

export type Entry = ItemEntry | MemoEntry | BlankEntry | MetaEntry;

export interface NoteDoc {
  eol: Eol;
  entries: Entry[];
}

export interface ParseOptions {
  /** ID の生成関数（テスト用に差し替え可能）。既存 ID の集合を受け取り、重複しない ID を返す */
  generateId?: (existing: ReadonlySet<string>) => string;
}

/* ---------------------------------------------------------------- 正規表現 */

const META_RE = /^<!--\s*idea-outliner:v(\d+)(?:\s+(.*?))?\s*-->\s*$/;
/** リスト項目: インデント / マーカー / 空白 / 残り。`-` だけの空項目も許す */
const ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const CHECKBOX_RE = /^\[([ xX])\](?:[ \t]+|$)/;
const ID_COMMENT_RE = /[ \t]*<!--\s*id:([A-Za-z0-9_-]+)\s*-->[ \t]*$/;
const THEMATIC_BREAK_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function defaultGenerateId(existing: ReadonlySet<string>): string {
  for (let len = 4; ; len++) {
    for (let attempt = 0; attempt < 50; attempt++) {
      let id = '';
      for (let i = 0; i < len; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
      if (!existing.has(id)) return id;
    }
  }
}

/** タブを 4 桁区切りで展開したときの、行頭の空白の幅 */
function indentWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (ch === ' ') w++;
    else if (ch === '\t') w += 4 - (w % 4);
    else break;
  }
  return w;
}

const isBlank = (line: string) => line.trim() === '';

interface ParsedItemLine {
  indent: number;
  /** 本文が始まる桁（子項目かどうかの判定に使う） */
  contentCol: number;
  checked: boolean | null;
  text: string;
  id: string | null;
}

function parseItemLine(line: string): ParsedItemLine | null {
  if (THEMATIC_BREAK_RE.test(line)) return null;
  const m = ITEM_RE.exec(line);
  if (!m) return null;
  const [, lead = '', marker = '', gap, restRaw] = m;
  const indent = indentWidth(lead);
  // CommonMark と同じ: 本文がない項目と、空白が 5 つ以上（インデントされたコード扱い）の項目は「マーカー + 1」
  const rawGap = gap === undefined ? 1 : indentWidth(gap);
  const gapWidth = (restRaw ?? '').trim() === '' || rawGap >= 5 ? 1 : rawGap;
  const contentCol = indent + marker.length + gapWidth;

  let rest = restRaw ?? '';
  let id: string | null = null;
  const idm = ID_COMMENT_RE.exec(rest);
  if (idm) {
    id = idm[1] ?? null;
    rest = rest.slice(0, idm.index);
  }
  let checked: boolean | null = null;
  const cm = CHECKBOX_RE.exec(rest);
  if (cm) {
    checked = cm[1] !== ' ';
    rest = rest.slice(cm[0].length);
  }
  return { indent, contentCol, checked, text: rest.trimEnd(), id };
}

/* ---------------------------------------------------------------- パース */

export function parseNote(body: string, opts: ParseOptions = {}): NoteDoc {
  const generateId = opts.generateId ?? defaultGenerateId;
  const eol: Eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body === '' ? [] : body.split(/\r?\n/);
  const entries: Entry[] = [];

  // 子項目の判定に使う、開いているリスト項目の「本文の桁」のスタック
  let stack: number[] = [];
  let lastItem: ItemEntry | null = null;
  /** 直前の行がリスト（項目またはその続き）だったか。遅延継続行の判定に使う */
  let prevWasList = false;
  /** 直前の行がメモの行だったか（連続するメモ行を 1 ブロックにまとめるため） */
  let prevWasMemo = false;
  let pendingBlanks: string[] = [];

  const flushBlanks = () => {
    for (const raw of pendingBlanks) entries.push({ kind: 'blank', raw });
    pendingBlanks = [];
  };

  /** i 行目から始まるフェンスコードブロックの終わり（その行を含む）の位置を返す */
  const fenceEnd = (i: number): number => {
    const m = FENCE_RE.exec(lines[i] ?? '');
    if (!m) return i;
    const fence = m[1] ?? '```';
    const closeRe = new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
    for (let j = i + 1; j < lines.length; j++) {
      if (closeRe.test(lines[j] ?? '')) return j;
    }
    return lines.length - 1; // 閉じていなければ文書の最後まで
  };

  let i = 0;
  if (lines.length > 0) {
    const mm = META_RE.exec(lines[0] ?? '');
    if (mm) {
      let data: Record<string, unknown> = {};
      if (mm[2]) {
        try {
          const parsed: unknown = JSON.parse(mm[2]);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
        } catch {
          // 壊れた JSON は無視して raw だけ保持する
        }
      }
      entries.push({ kind: 'meta', raw: lines[0] ?? '', meta: { version: Number(mm[1]), data } });
      i = 1;
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (isBlank(line)) {
      pendingBlanks.push(line);
      prevWasList = false;
      prevWasMemo = false;
      continue;
    }

    const item = FENCE_RE.test(line) ? null : parseItemLine(line);
    if (item) {
      flushBlanks();
      while (stack.length > 0 && item.indent < (stack[stack.length - 1] ?? 0)) stack.pop();
      const depth = stack.length;
      stack.push(item.contentCol);
      const entry: ItemEntry = {
        kind: 'item',
        id: item.id ?? '',
        depth,
        checked: item.checked,
        text: item.text,
        continuation: [],
        source: { raw: line, depth, checked: item.checked, text: item.text, id: item.id },
      };
      entries.push(entry);
      lastItem = entry;
      prevWasList = true;
      prevWasMemo = false;
      continue;
    }

    // リスト項目ではない行。フェンスなら閉じるまでをひとかたまりとして扱う
    const end = fenceEnd(i);
    const chunk = lines.slice(i, end + 1);
    const w = indentWidth(line);
    const isContinuation = lastItem !== null && stack.length > 0 && (prevWasList || w >= (stack[0] ?? 0));

    if (isContinuation && lastItem) {
      lastItem.continuation.push(...pendingBlanks, ...chunk);
      pendingBlanks = [];
      prevWasList = true;
      prevWasMemo = false;
    } else {
      flushBlanks();
      stack = [];
      lastItem = null;
      const prev = entries[entries.length - 1];
      if (prevWasMemo && prev && prev.kind === 'memo') {
        prev.lines.push(...chunk);
      } else {
        entries.push({ kind: 'memo', lines: [...chunk] });
      }
      prevWasList = false;
      prevWasMemo = true;
    }
    i = end;
  }
  flushBlanks();

  assignIds(entries, generateId);
  return { eol, entries };
}

/** ID がない行と、重複した ID の 2 つ目以降に新しい ID を振る */
function assignIds(entries: Entry[], generateId: (existing: ReadonlySet<string>) => string): void {
  const seen = new Set<string>();
  const all = new Set<string>();
  for (const e of entries) if (e.kind === 'item' && e.id) all.add(e.id);
  for (const e of entries) {
    if (e.kind !== 'item') continue;
    if (e.id && !seen.has(e.id)) {
      seen.add(e.id);
      continue;
    }
    const id = generateId(all);
    all.add(id);
    seen.add(id);
    e.id = id;
  }
}

/* ---------------------------------------------------------------- シリアライズ */

/** 行テキストの正規化。入力途中の余分な空白や改行は、保存する形にはしない */
export const normalizeItemText = (text: string): string => text.replace(/[\r\n]+/g, ' ').trim();

export function canonicalItemLine(item: Pick<ItemEntry, 'depth' | 'checked' | 'text' | 'id'>, indent = item.depth * 2): string {
  const box = item.checked === null ? '' : item.checked ? '[x] ' : '[ ] ';
  const text = normalizeItemText(item.text);
  return `${' '.repeat(indent)}- ${box}${text === '' ? '' : `${text} `}<!-- id:${item.id} -->`;
}

/** 元の行を活かして書ける場合はその行を返す。ID だけ違うなら ID コメントだけ差し替える */
function rawItemLine(item: ItemEntry, src: ItemSource): string {
  if (src.id === item.id) return src.raw;
  // 行末の空白（Markdown の改行指定のことがある）は ID コメントの後ろに残す
  const withoutId = src.raw.replace(ID_COMMENT_RE, '');
  const body = withoutId.trimEnd();
  return `${body} <!-- id:${item.id} -->${withoutId.slice(body.length)}`;
}

/** インデント w の項目が、開いている項目のスタックの中で何段目になるか（parseNote と同じ判定） */
function depthAt(stack: readonly number[], w: number): number {
  let n = stack.length;
  while (n > 0 && w < (stack[n - 1] ?? 0)) n--;
  return n;
}

function reindent(line: string, delta: number): string {
  if (delta === 0 || line.trim() === '') return line;
  if (delta > 0) return ' '.repeat(delta) + line;
  const lead = /^ */.exec(line)?.[0].length ?? 0;
  return line.slice(Math.min(lead, -delta));
}

/** 行の並びの最後でコードフェンスが開いたままなら、閉じるための行を返す */
function unclosedFence(lines: readonly string[]): string | null {
  let open: string | null = null;
  let lead = '';
  for (const line of lines) {
    if (open === null) {
      const m = FENCE_RE.exec(line);
      if (m) {
        open = m[1] ?? '```';
        lead = /^[ \t]*/.exec(line)?.[0] ?? '';
      }
    } else if (new RegExp(`^[ \\t]*${open[0] === '`' ? '`' : '~'}{${open.length},}[ \\t]*$`).test(line)) {
      open = null;
    }
  }
  return open === null ? null : lead + open;
}

/**
 * 文書を本文に戻す。
 * parseNote と同じ「開いている項目のスタック」をたどり、元の行のインデントで読み直しても
 * 同じ深さになる場合だけ元の行を使う。そうでなければ親の本文の桁に合わせて正規形で書く。
 * （例: `1. a` の子は 3 桁以上のインデントが要るので、深さ × 2 では兄弟になってしまう）
 */
export function serializeNote(doc: NoteDoc): string {
  const out: string[] = [];
  let stack: number[] = [];
  let closing: string | null = null; // 直前のかたまりで開いたままのコードフェンス

  const closeFence = () => {
    if (closing !== null) out.push(closing);
    closing = null;
  };

  for (const e of doc.entries) {
    if (e.kind === 'blank') {
      out.push(e.raw);
      continue;
    }
    closeFence();
    if (e.kind === 'meta') {
      out.push(e.raw);
    } else if (e.kind === 'memo') {
      out.push(...e.lines);
      stack = [];
      closing = unclosedFence(e.lines);
    } else {
      const src = e.source;
      const parsed = src ? parseItemLine(src.raw) : null;
      const sameContent = src !== null && src.checked === e.checked && src.text === normalizeItemText(e.text);
      const depth = Math.min(e.depth, stack.length);
      let line: string;
      let contentCol: number;
      if (parsed && sameContent && depthAt(stack, parsed.indent) === depth) {
        line = rawItemLine(e, src as ItemSource);
        contentCol = parsed.contentCol;
      } else {
        const indent = depth === 0 ? 0 : (stack[depth - 1] ?? 0);
        line = canonicalItemLine(e, indent);
        contentCol = indent + 2;
      }
      stack = [...stack.slice(0, depth), contentCol];
      // 本文の桁が変わったら、続きの行もその分だけずらす
      const continuation = e.continuation.map((l) => reindent(l, parsed ? contentCol - parsed.contentCol : 0));
      out.push(line, ...continuation);
      closing = unclosedFence(continuation);
    }
  }
  // 文書の最後で開いたままのフェンスは元からそういう文書なので、閉じない
  return out.join(doc.eol);
}

/* ---------------------------------------------------------------- 補助 */

export const noteItems = (doc: NoteDoc): ItemEntry[] => doc.entries.filter((e): e is ItemEntry => e.kind === 'item');

export const noteMeta = (doc: NoteDoc): NoteMeta | null => {
  const m = doc.entries.find((e): e is MetaEntry => e.kind === 'meta');
  return m ? m.meta : null;
};

/** 読み込み時に ID を振ったなど、保存すると本文が変わる状態か */
export function hasPendingIdAssignments(doc: NoteDoc): boolean {
  return noteItems(doc).some((it) => it.source !== null && it.source.id !== it.id);
}
