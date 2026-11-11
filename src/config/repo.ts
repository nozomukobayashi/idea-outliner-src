/** リポジトリ名（owner/name）の扱い */

export interface RepoRef {
  owner: string;
  name: string;
}

const REPO_PART = /^[A-Za-z0-9_.-]+$/;

/** `owner/name` 形式を解釈する。不正なら null */
export function parseRepo(input: string): RepoRef | null {
  const s = input.trim().replace(/\.git$/, '');
  const parts = s.split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  if (!REPO_PART.test(owner) || !REPO_PART.test(name) || name === '.' || name === '..') return null;
  return { owner, name };
}

export const repoToString = (r: RepoRef): string => `${r.owner}/${r.name}`;
