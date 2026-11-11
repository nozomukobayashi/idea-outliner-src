/**
 * ビルド時の設定（DESIGN.md §3 / §8）。vite.config.ts と画面の両方から使うので、ブラウザ・Node どちらの API にも依存しない。
 * 社内向けの値はリポジトリに含めず、設定ファイルか環境変数で差し込む。
 */
import { connectionFromHost } from './connection';

export interface BuildConfig {
  /** 既定の接続先のホスト */
  defaultHost: string;
  /** 利用者がほかの接続先を使えるか。false なら CSP で既定の接続先だけに固定する */
  allowOtherHosts: boolean;
}

export const DEFAULT_BUILD_CONFIG: BuildConfig = { defaultHost: 'github.com', allowOtherHosts: true };

export class InvalidBuildConfigError extends Error {
  constructor(message: string) {
    super(`ビルド設定が正しくありません: ${message}`);
    this.name = 'InvalidBuildConfigError';
  }
}

function parseBool(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new InvalidBuildConfigError(`${name} は true か false にしてください`);
}

/** 設定ファイルの内容と環境変数から設定を決める。環境変数を優先する */
export function resolveBuildConfig(file: Record<string, unknown>, env: Record<string, string | undefined>): BuildConfig {
  const rawHost = env.IDEA_OUTLINER_DEFAULT_HOST?.trim() || file.defaultHost;
  const allow = parseBool(env.IDEA_OUTLINER_ALLOW_OTHER_HOSTS?.trim() || undefined, 'IDEA_OUTLINER_ALLOW_OTHER_HOSTS') ?? parseBool(file.allowOtherHosts, 'allowOtherHosts');
  if (rawHost === undefined || rawHost === '') return { ...DEFAULT_BUILD_CONFIG, allowOtherHosts: allow ?? true };
  if (typeof rawHost !== 'string') throw new InvalidBuildConfigError('defaultHost は文字列にしてください');
  let host: string;
  try {
    host = connectionFromHost(rawHost).host;
  } catch {
    throw new InvalidBuildConfigError(`defaultHost の形式が正しくありません: ${rawHost}`);
  }
  // GHES を既定にしたビルドは社内向けなので、指定がなければ固定する
  return { defaultHost: host, allowOtherHosts: allow ?? host === 'github.com' };
}

const IP_HOST = /^\d+\.\d+\.\d+\.\d+(:\d+)?$/;

/** 画像を読み込んでよい場所。社内向けビルドでは、悪意あるコメントの画像で外部に通信させない */
function imageSources(host: string): string[] {
  if (host === 'github.com') return ['https://github.com', 'https://*.github.com', 'https://*.githubusercontent.com'];
  return IP_HOST.test(host) ? [`https://${host}`] : [`https://${host}`, `https://*.${host}`];
}

/** ビルド成果物に埋め込む CSP */
export function contentSecurityPolicy(config: BuildConfig): string {
  const connection = connectionFromHost(config.defaultHost);
  const connect = config.allowOtherHosts ? ['https:'] : [new URL(connection.graphqlUrl).origin];
  const images = config.allowOtherHosts ? ['https:'] : imageSources(connection.host);
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: ${images.join(' ')}`,
    `connect-src 'self' ${connect.join(' ')}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');
}
