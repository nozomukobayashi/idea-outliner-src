/** 行へのコメントの形式（DESIGN.md §4.2）。UI から独立した純粋関数 */
import { normalizeItemText } from './format';

const REF_RE = /^\s*<!--\s*idea-outliner:ref\s+id:([A-Za-z0-9_-]+)\s*-->[ \t]*(?:\r?\n|$)/;

export interface ParsedLineComment {
  /** 紐づく行の ID。ref がなければ null */
  lineId: string | null;
  /** 表示する本文（ref と、GitHub で読む人向けの引用を除いたもの） */
  text: string;
}

export function parseLineComment(body: string): ParsedLineComment {
  const m = REF_RE.exec(body);
  if (!m) return { lineId: null, text: body };
  const lines = body.slice(m[0].length).replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && (lines[i] as string).startsWith('>')) i++;
  while (i < lines.length && (lines[i] as string).trim() === '') i++;
  return { lineId: m[1] ?? null, text: lines.slice(i).join('\n').trimEnd() };
}

export function buildLineComment(lineId: string, lineText: string, body: string): string {
  const quote = normalizeItemText(lineText);
  const head = `<!-- idea-outliner:ref id:${lineId} -->`;
  return `${quote === '' ? head : `${head}\n> ${quote}`}\n\n${body.trim()}\n`;
}

export interface CommentLike {
  body: string;
}

export interface CommentGroups<C> {
  byLine: Map<string, C[]>;
  /** 紐づく行が本文にないコメント */
  deleted: C[];
  /** ref のないコメント */
  general: C[];
}

export function groupComments<C extends CommentLike>(comments: readonly C[], lineIds: ReadonlySet<string>): CommentGroups<C> {
  const groups: CommentGroups<C> = { byLine: new Map(), deleted: [], general: [] };
  for (const c of comments) {
    const { lineId } = parseLineComment(c.body);
    if (lineId === null) groups.general.push(c);
    else if (lineIds.has(lineId)) groups.byLine.set(lineId, [...(groups.byLine.get(lineId) ?? []), c]);
    else groups.deleted.push(c);
  }
  return groups;
}
