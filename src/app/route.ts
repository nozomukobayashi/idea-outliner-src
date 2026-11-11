/**
 * 画面の場所を URL のハッシュで表す: `#/<host>/<owner>/<repo>[/<number>]`
 * ホストを含めるので、同じ GHE を使うチームメンバー間でリンクを共有できる（トークンは含めない）。
 */
import { normalizeHost } from '../config/connection';
import { parseRepo, type RepoRef } from '../config/repo';

export interface Route {
  host: string | null;
  repo: RepoRef | null;
  number: number | null;
}

export const EMPTY_ROUTE: Route = { host: null, repo: null, number: null };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  if (parts.length === 0) return EMPTY_ROUTE;
  let host: string;
  try {
    host = normalizeHost(parts[0] ?? '');
  } catch {
    return EMPTY_ROUTE;
  }
  if (parts.length < 3) return { host, repo: null, number: null };
  const repo = parseRepo(`${parts[1]}/${parts[2]}`);
  if (!repo) return { host, repo: null, number: null };
  const n = parts[3] !== undefined && /^\d+$/.test(parts[3]) ? Number(parts[3]) : null;
  return { host, repo, number: n !== null && n > 0 ? n : null };
}

export function formatRoute(r: Route): string {
  if (!r.host) return '#/';
  let s = `#/${r.host}`;
  if (r.repo) {
    s += `/${encodeURIComponent(r.repo.owner)}/${encodeURIComponent(r.repo.name)}`;
    if (r.number) s += `/${r.number}`;
  }
  return s;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
