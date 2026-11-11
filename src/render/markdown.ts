/**
 * GitHub から取得した Markdown を HTML にして表示するための処理。
 * 本文は他人が書いた信頼できない入力なので、必ず DOMPurify でサニタイズしてから使う（DESIGN.md §8）。
 */
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { findIssueRefs, type IssueRef } from '../note/issueRefs';

export type ChipState = 'open' | 'closed' | 'not_planned' | 'merged' | 'unknown' | 'loading';

export interface ChipInfo {
  state: ChipState;
  url: string;
  title?: string;
}

export interface RenderOptions {
  /** Issue 参照をチップにするための情報。null を返した参照はそのままテキストにする */
  chipFor?: (ref: IssueRef) => ChipInfo | null;
  /** チップの状態ラベル（ツールチップ用） */
  stateLabel?: (state: ChipState) => string;
}

const marked = new Marked({ gfm: true, breaks: false, async: false });

let purifier: ReturnType<typeof DOMPurify> | null = null;

function getPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  const p = DOMPurify(window);
  p.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  purifier = p;
  return p;
}

const PURIFY_CONFIG = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
  FORBID_ATTR: ['style'],
};

function sanitizeToFragment(html: string): DocumentFragment {
  return getPurifier().sanitize(html, { ...PURIFY_CONFIG, RETURN_DOM_FRAGMENT: true });
}

const SKIP_CHIP_PARENTS = new Set(['A', 'CODE', 'PRE']);

/** サニタイズ済みの DOM のテキストノードから Issue 参照を探してチップに置き換える */
function insertChips(root: DocumentFragment, opts: RenderOptions): void {
  const chipFor = opts.chipFor;
  if (!chipFor) return;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    let p = n.parentElement;
    let skip = false;
    while (p) {
      if (SKIP_CHIP_PARENTS.has(p.tagName)) {
        skip = true;
        break;
      }
      p = p.parentElement;
    }
    if (!skip) targets.push(n as Text);
  }

  for (const node of targets) {
    const text = node.data;
    const matches = findIssueRefs(text);
    if (matches.length === 0) continue;
    const frag = doc.createDocumentFragment();
    let pos = 0;
    for (const m of matches) {
      const info = chipFor(m);
      if (!info || !/^https?:\/\//.test(info.url)) continue;
      frag.append(text.slice(pos, m.start));
      const a = doc.createElement('a');
      a.className = `chip chip-${info.state}`;
      a.href = info.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = text.slice(m.start, m.end);
      const label = opts.stateLabel?.(info.state);
      const tip = [label, info.title].filter(Boolean).join(': ');
      if (tip) a.title = tip;
      frag.append(a);
      pos = m.end;
    }
    frag.append(text.slice(pos));
    node.replaceWith(frag);
  }
}

function fragmentToHtml(frag: DocumentFragment): string {
  const div = frag.ownerDocument.createElement('div');
  div.append(frag);
  return div.innerHTML;
}

/** 行テキスト（インライン Markdown）をサニタイズ済み HTML にする */
export function renderInline(text: string, opts: RenderOptions = {}): string {
  const html = marked.parseInline(text) as string;
  const frag = sanitizeToFragment(html);
  insertChips(frag, opts);
  return fragmentToHtml(frag);
}

/** 段落・見出し・コードブロックなどのブロック Markdown をサニタイズ済み HTML にする */
export function renderBlock(markdown: string, opts: RenderOptions = {}): string {
  const html = marked.parse(markdown) as string;
  const frag = sanitizeToFragment(html);
  insertChips(frag, opts);
  return fragmentToHtml(frag);
}

/** 共通の行頭インデントを取り除く（項目の続きの行を表示するとき用） */
export function dedent(lines: string[]): string {
  const widths = lines.filter((l) => l.trim() !== '').map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0);
  const cut = widths.length > 0 ? Math.min(...widths) : 0;
  return lines.map((l) => l.slice(Math.min(cut, /^[ \t]*/.exec(l)?.[0].length ?? 0))).join('\n');
}
