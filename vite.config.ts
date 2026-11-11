import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import preact from '@preact/preset-vite';
import { contentSecurityPolicy, resolveBuildConfig, type BuildConfig } from './src/config/buildConfig';

/** 社内向けの値を書く設定ファイル（Git の管理外） */
const CONFIG_FILE = 'idea-outliner.config.json';

function loadConfigFile(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) return {};
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Record<string, unknown>;
}

/**
 * ビルド成果物に CSP を埋め込む（DESIGN.md §8）。
 * 開発サーバーでは HMR がインラインスクリプトや WebSocket を使うので付けない。
 */
function cspPlugin(config: BuildConfig): Plugin {
  const csp = contentSecurityPolicy(config);
  return {
    name: 'idea-outliner-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

/** 同梱したライブラリのライセンス全文を成果物に含める */
function licensesPlugin(): Plugin {
  const packages: [name: string, files: string[]][] = [
    ['preact', ['LICENSE']],
    ['marked', ['LICENSE']],
    ['dompurify', ['LICENSE']],
  ];
  return {
    name: 'idea-outliner-licenses',
    apply: 'build',
    generateBundle() {
      const source = packages
        .flatMap(([name, files]) => files.map((f) => `==== ${name} ====\n\n${readFileSync(`node_modules/${name}/${f}`, 'utf8').trim()}\n`))
        .join('\n');
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source });
    },
  };
}

export default defineConfig(({ mode }) => {
  const buildConfig = resolveBuildConfig(loadConfigFile(), process.env);
  return {
    // GitHub Pages / GHE Pages のサブパス（/owner/repo/）にそのまま置けるよう相対パスで出力する
    base: './',
    plugins: [preact(), cspPlugin(buildConfig), licensesPlugin()],
    define: { __IDEA_OUTLINER_BUILD_CONFIG__: JSON.stringify(buildConfig) },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        input: {
          main: 'index.html',
          // M0 の検証ページは配布物に含めない（npm run build:spike のときだけ）
          ...(mode === 'spike' ? { spike: 'spike.html' } : {}),
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
