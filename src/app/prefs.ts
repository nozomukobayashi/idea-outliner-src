/** 各ユーザーのブラウザに保存する設定（接続先一覧・最近のワークスペース・折りたたみ状態） */
import { loadJson, saveJson } from '../storage';

interface Prefs {
  connections: string[];
  lastHost: string | null;
  recent: Record<string, string[]>; // host → owner/name[]
  issueRepo?: Record<string, string>; // host → 前回 Issue を作ったリポジトリ
}

const DEFAULT: Prefs = { connections: [], lastHost: null, recent: {} };
const load = (): Prefs => loadJson<Prefs>('prefs', DEFAULT);
const save = (p: Prefs) => saveJson('prefs', p);

export const listConnections = (): string[] => load().connections;
export const lastHost = (): string | null => load().lastHost;

export function rememberConnection(host: string): void {
  const p = load();
  save({ ...p, connections: [host, ...p.connections.filter((h) => h !== host)], lastHost: host });
}

export function forgetConnection(host: string): void {
  const p = load();
  save({ ...p, connections: p.connections.filter((h) => h !== host), lastHost: p.lastHost === host ? null : p.lastHost });
}

export const recentWorkspaces = (host: string): string[] => load().recent[host] ?? [];

export function rememberWorkspace(host: string, nameWithOwner: string): void {
  const p = load();
  const list = [nameWithOwner, ...(p.recent[host] ?? []).filter((r) => r.toLowerCase() !== nameWithOwner.toLowerCase())].slice(0, 8);
  save({ ...p, lastHost: host, recent: { ...p.recent, [host]: list } });
}

export const lastIssueRepo = (host: string): string | null => load().issueRepo?.[host] ?? null;

export function rememberIssueRepo(host: string, nameWithOwner: string): void {
  const p = load();
  save({ ...p, issueRepo: { ...p.issueRepo, [host]: nameWithOwner } });
}

const collapsedKey = (noteKey: string) => `collapsed:${noteKey}`;

export const loadCollapsed = (noteKey: string): Set<string> => new Set(loadJson<{ ids: string[] }>(collapsedKey(noteKey), { ids: [] }).ids);

export const saveCollapsed = (noteKey: string, ids: Set<string>): void => {
  saveJson(collapsedKey(noteKey), { ids: [...ids] });
};
