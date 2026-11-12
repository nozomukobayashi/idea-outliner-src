/** 行の編集中に `owner/repo#番号` を補完するための判定。UI から独立した純粋関数 */

export type CompletionContext =
  /** `owner/` まで打った状態。リポジトリを補完する */
  | { kind: 'repo'; start: number; end: number; query: string }
  /** `owner/repo#` まで打った状態。Issue を補完する */
  | { kind: 'issue'; start: number; end: number; owner: string; repo: string; query: string };

const OWNER = '[A-Za-z0-9][A-Za-z0-9-]*';
const REPO = '[A-Za-z0-9_.-]';
// 直前が行頭・空白・括弧のときだけ（URL の途中などでは出さない）
const BOUNDARY = '(?:^|[\\s(（「『【])';
const ISSUE_RE = new RegExp(`${BOUNDARY}(${OWNER})/(${REPO}+)#([^\\s#]*)$`);
const REPO_RE = new RegExp(`${BOUNDARY}(${OWNER}/${REPO}*)$`);

/** カーソル位置の直前を見て、補完の文脈を返す。補完しない場所なら null */
export function completionContext(text: string, caret: number): CompletionContext | null {
  const before = text.slice(0, caret);
  // インラインコードの中では補完しない
  if ((before.match(/`/g) ?? []).length % 2 === 1) return null;

  const issue = ISSUE_RE.exec(before);
  if (issue) {
    const [, owner = '', repo = '', query = ''] = issue;
    return { kind: 'issue', start: caret - (owner.length + repo.length + query.length + 2), end: caret, owner, repo, query };
  }
  const repo = REPO_RE.exec(before);
  if (repo) {
    const query = repo[1] ?? '';
    return { kind: 'repo', start: caret - query.length, end: caret, query };
  }
  return null;
}

/**
 * 候補を確定して、置き換えたテキストと新しいカーソル位置を返す。
 * リポジトリなら続けて Issue を選べるよう `#` まで入れる。Issue なら後ろに空白を足す。
 */
export function applyCompletion(text: string, ctx: CompletionContext, value: string): { text: string; caret: number } {
  const insert = ctx.kind === 'repo' ? `${value}#` : `${value} `;
  const after = text.slice(ctx.end);
  const next = text.slice(0, ctx.start) + insert + (ctx.kind === 'issue' && after.startsWith(' ') ? after.slice(1) : after);
  return { text: next, caret: ctx.start + insert.length };
}

/** 文脈を区別するキー（同じ文脈で問い合わせを繰り返さないため） */
export function completionKey(ctx: CompletionContext | null): string | null {
  if (!ctx) return null;
  return ctx.kind === 'repo' ? `repo|${ctx.start}|${ctx.query}` : `issue|${ctx.start}|${ctx.owner}/${ctx.repo}|${ctx.query}`;
}
