/** ビルド時に埋め込まれた設定。テストなど埋め込みがない環境では既定値を使う */
import { DEFAULT_BUILD_CONFIG, type BuildConfig } from './buildConfig';

declare const __IDEA_OUTLINER_BUILD_CONFIG__: BuildConfig | undefined;

export const BUILD_CONFIG: BuildConfig = typeof __IDEA_OUTLINER_BUILD_CONFIG__ === 'undefined' ? DEFAULT_BUILD_CONFIG : __IDEA_OUTLINER_BUILD_CONFIG__;

/** 接続先が既定のホストに固定されているか */
export const HOST_LOCKED = !BUILD_CONFIG.allowOtherHosts;
