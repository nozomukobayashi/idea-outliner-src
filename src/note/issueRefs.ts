/** 行テキスト中の Issue 参照（`owner/repo#番号`）を扱う。DESIGN.md §4.1 / §4.3 */

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

export interface IssueRefMatch extends IssueRef {
  start: number;
  end: number;
}

// 前が英数字・/・. などなら別の文字列の一部（URL など）とみなして拾わない
const REF_RE = /(?<![A-Za-z0-9_./#-])([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)#(\d+)(?![A-Za-z0-9_])/g;

/** インラインコード（`...`）の範囲。中の参照は拾わない */
function codeSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

export function findIssueRefs(text: string): IssueRefMatch[] {
  const spans = codeSpans(text);
  const out: IssueRefMatch[] = [];
  for (const m of text.matchAll(REF_RE)) {
    const start = m.index;
    if (spans.some(([s, e]) => start >= s && start < e)) continue;
    const [, owner = '', repo = '', num = ''] = m;
    if (repo === '.' || repo === '..') continue;
    out.push({ owner, repo, number: Number(num), start, end: start + m[0].length });
  }
  return out;
}

export const refKey = (r: IssueRef): string => `${r.owner}/${r.repo}#${r.number}`.toLowerCase();

/** 重複を除いた参照の一覧（出てきた順） */
export function uniqueRefs(texts: Iterable<string>): IssueRef[] {
  const seen = new Set<string>();
  const out: IssueRef[] = [];
  for (const t of texts) {
    for (const { owner, repo, number } of findIssueRefs(t)) {
      const k = refKey({ owner, repo, number });
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ owner, repo, number });
    }
  }
  return out;
}
