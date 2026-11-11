/** ワークスペース候補の絞り込み。UI から独立した純粋関数 */

export interface NamedRepo {
  nameWithOwner: string;
}

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/** 入力の owner の部分。`team` / `team/` / `team/na` から `team` を取り出す。短すぎる入力では問い合わせない */
export function ownerFromInput(input: string): string | null {
  const owner = input.trim().split('/')[0] ?? '';
  return owner.length >= 2 && OWNER.test(owner) ? owner : null;
}

/** 重複を除いてつなげる（大文字小文字は区別しない） */
export function mergeRepos<R extends NamedRepo>(...lists: readonly (readonly R[])[]): R[] {
  const seen = new Set<string>();
  const out: R[] = [];
  for (const r of lists.flat()) {
    const key = r.nameWithOwner.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** 入力で絞り込み、表示する件数に切り詰める */
export function filterRepos<R extends NamedRepo>(repos: readonly R[], query: string, limit: number): { shown: R[]; total: number } {
  const q = query.trim().toLowerCase();
  const matched = q === '' ? [...repos] : repos.filter((r) => r.nameWithOwner.toLowerCase().includes(q));
  return { shown: matched.slice(0, limit), total: matched.length };
}
