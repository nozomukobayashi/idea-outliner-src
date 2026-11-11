/** 行から Issue の内容を組み立てる（DESIGN.md §4.3）。UI から独立した純粋関数 */
import { indexOfItem, parentIndex, subtreeEnd } from '../outline/edit';
import { noteMeta, normalizeItemText, type Entry, type ItemEntry, type NoteDoc } from './format';
import { findIssueRefs, type IssueRef } from './issueRefs';

/** GitHub の Issue タイトルの上限 */
export const MAX_TITLE_LENGTH = 256;

/** 行のテキストをタイトルにする。タイトルでは Markdown が表示されないので記号を取り除く */
export function issueTitle(text: string): string {
  const plain = normalizeItemText(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.slice(0, MAX_TITLE_LENGTH);
}

/** 行の子孫を Markdown のリストにする */
export function childrenMarkdown(entries: readonly Entry[], id: string): string {
  const i = indexOfItem(entries, id);
  if (i < 0) return '';
  const base = (entries[i] as ItemEntry).depth + 1;
  const lines: string[] = [];
  for (const e of entries.slice(i + 1, subtreeEnd(entries, i))) {
    if (e.kind !== 'item') continue;
    const box = e.checked === null ? '' : e.checked ? '[x] ' : '[ ] ';
    lines.push(`${'  '.repeat(e.depth - base)}- ${box}${normalizeItemText(e.text)}`);
  }
  return lines.join('\n');
}

export interface IssueBodyInput {
  children: string;
  noteUrl: string;
  lineId: string;
  sourceLabel: string;
}

/** Issue の本文。埋め込みコメントが本文の途中で閉じないよう `>` はエスケープする */
export function issueBody(input: IssueBodyInput): string {
  const source = JSON.stringify({ note: input.noteUrl, line: input.lineId }).replace(/>/g, '\\u003e');
  const parts = [`${input.sourceLabel}: ${input.noteUrl}`, `<!-- idea-outliner:source ${source} -->`];
  if (input.children !== '') parts.unshift(input.children);
  return `${parts.join('\n\n')}\n`;
}

/** サブイシューにできないときに、本文の先頭に親へのリンクを足す */
export const withParentLine = (body: string, parent: IssueRef, parentLabel: string): string =>
  `${parentLabel}: ${parent.owner}/${parent.repo}#${parent.number}\n\n${body}`;

/** 親の行が Issue なら、その参照を返す */
export function parentIssueRef(doc: NoteDoc, id: string): IssueRef | null {
  const i = indexOfItem(doc.entries, id);
  const p = i < 0 ? null : parentIndex(doc.entries, i);
  if (p === null) return null;
  const [ref] = findIssueRefs((doc.entries[p] as ItemEntry).text);
  return ref ? { owner: ref.owner, repo: ref.repo, number: ref.number } : null;
}

/** ノート単位の既定の作成先（メタデータの defaultRepo） */
export function defaultRepoOf(doc: NoteDoc): string | null {
  const value = noteMeta(doc)?.data.defaultRepo;
  return typeof value === 'string' ? value : null;
}

/** 行の末尾に Issue の参照を足す */
export const withIssueRef = (text: string, ref: IssueRef): string => `${text.trimEnd()} ${ref.owner}/${ref.repo}#${ref.number}`;
