import { ja } from '../i18n/ja';
import type { CheckStatus } from './checks';
import { anonymize } from './util';

export type AutoCheckId = '1' | '2' | '3' | '4';
export type ManualCheckId = '5' | '6';
export type ManualStatus = 'unknown' | 'ok' | 'ng';

export interface AutoResult {
  status: CheckStatus;
  summary: string;
  log: string[];
  ranAt: string;
}

export interface ReportInput {
  generatedAt: string;
  connectionKind: 'github' | 'ghes';
  /** 実行元 origin の種類（localhost / Pages など） */
  originKind: string;
  auto: Partial<Record<AutoCheckId, AutoResult>>;
  manual: Record<ManualCheckId, { status: ManualStatus; memo: string }>;
  /** 伏せ字にする値。null なら伏せない */
  redactions: [string, string][] | null;
}

const statusLabel = (s: CheckStatus | ManualStatus | undefined): string => {
  if (!s || s === 'unknown') return '未確認';
  return ja.spike.status[s];
};

export function classifyOrigin(origin: string, connectionHost: string): string {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return 'その他';
  }
  if (origin.startsWith('file:')) return 'ローカルファイル';
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')) return 'localhost';
  if (host.endsWith('.github.io')) return 'GitHub Pages (github.io)';
  const base = connectionHost.split(':')[0] ?? connectionHost;
  if (host === base || host.endsWith(`.${base}`)) return 'GHE Pages（接続先と同じドメイン）';
  return 'その他のホスト';
}

export function buildReport(input: ReportInput): string {
  const lines: string[] = [];
  lines.push('# M0 スパイク結果', '');
  lines.push(`- 実行日時: ${input.generatedAt}`);
  lines.push(`- 接続先: ${input.connectionKind === 'github' ? 'github.com' : 'GHES'}`);
  lines.push(`- 実行元: ${input.originKind}`, '');

  lines.push('| # | 確認内容 | 結果 | 要約 |', '|---|---|---|---|');
  for (const id of ['1', '2', '3', '4'] as const) {
    const r = input.auto[id];
    lines.push(`| ${id} | ${ja.checkTitles[id]} | ${statusLabel(r?.status)} | ${cell(r?.summary ?? '')} |`);
  }
  for (const id of ['5', '6'] as const) {
    const m = input.manual[id];
    lines.push(`| ${id} | ${ja.checkTitles[id]} | ${statusLabel(m.status)} | ${cell(m.memo)} |`);
  }
  lines.push('');

  for (const id of ['1', '2', '3', '4'] as const) {
    const r = input.auto[id];
    if (!r) continue;
    lines.push(`## #${id} ${ja.checkTitles[id]}`, '', `実行: ${r.ranAt}`, '');
    if (r.log.length > 0) lines.push('```text', ...r.log, '```', '');
    else lines.push(`（ログなし: ${r.summary}）`, '');
  }

  const text = lines.join('\n');
  return input.redactions ? anonymize(text, input.redactions) : text;
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
