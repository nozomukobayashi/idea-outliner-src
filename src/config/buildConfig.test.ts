import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, InvalidBuildConfigError, resolveBuildConfig } from './buildConfig';

describe('resolveBuildConfig', () => {
  it('指定がなければ github.com で、ほかの接続先も使える', () => {
    expect(resolveBuildConfig({}, {})).toEqual({ defaultHost: 'github.com', allowOtherHosts: true });
  });

  it('GHES を既定にすると固定される', () => {
    expect(resolveBuildConfig({ defaultHost: 'https://GHE.example.test/' }, {})).toEqual({ defaultHost: 'ghe.example.test', allowOtherHosts: false });
  });

  it('GHES でも明示すればほかの接続先を許せる', () => {
    expect(resolveBuildConfig({ defaultHost: 'ghe.example.test', allowOtherHosts: true }, {}).allowOtherHosts).toBe(true);
  });

  it('github.com を明示しても既定では固定しない', () => {
    expect(resolveBuildConfig({ defaultHost: 'github.com' }, {}).allowOtherHosts).toBe(true);
  });

  it('環境変数を設定ファイルより優先する', () => {
    const c = resolveBuildConfig({ defaultHost: 'a.example.test', allowOtherHosts: false }, { IDEA_OUTLINER_DEFAULT_HOST: 'b.example.test', IDEA_OUTLINER_ALLOW_OTHER_HOSTS: 'true' });
    expect(c).toEqual({ defaultHost: 'b.example.test', allowOtherHosts: true });
  });

  it('空の環境変数は未指定として扱う（Actions の未設定の変数）', () => {
    expect(resolveBuildConfig({ defaultHost: 'a.example.test' }, { IDEA_OUTLINER_DEFAULT_HOST: '', IDEA_OUTLINER_ALLOW_OTHER_HOSTS: '' })).toEqual({ defaultHost: 'a.example.test', allowOtherHosts: false });
  });

  it.each([
    [{ defaultHost: 'bad host' }, {}],
    [{ defaultHost: 1 }, {}],
    [{ allowOtherHosts: 'yes' }, {}],
    [{}, { IDEA_OUTLINER_ALLOW_OTHER_HOSTS: 'maybe' }],
  ])('不正な設定はエラー: %j %j', (file, env) => {
    expect(() => resolveBuildConfig(file, env)).toThrow(InvalidBuildConfigError);
  });
});

describe('contentSecurityPolicy', () => {
  const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `));

  it('公開版は https 全体に接続できる', () => {
    const csp = contentSecurityPolicy({ defaultHost: 'github.com', allowOtherHosts: true });
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https:");
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data: https:");
  });

  it('社内向けは接続先のホストだけ', () => {
    const csp = contentSecurityPolicy({ defaultHost: 'ghe.example.test', allowOtherHosts: false });
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://ghe.example.test");
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data: https://ghe.example.test https://*.ghe.example.test");
  });

  it('github.com に固定すると API のホストになる', () => {
    const csp = contentSecurityPolicy({ defaultHost: 'github.com', allowOtherHosts: false });
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://api.github.com");
  });

  it('ポート付き・IP のホスト', () => {
    expect(directive(contentSecurityPolicy({ defaultHost: 'ghe.example.test:8443', allowOtherHosts: false }), 'connect-src')).toBe("connect-src 'self' https://ghe.example.test:8443");
    expect(directive(contentSecurityPolicy({ defaultHost: '10.0.0.5', allowOtherHosts: false }), 'img-src')).toBe("img-src 'self' data: https://10.0.0.5");
  });

  it('スクリプトは自サイトのものだけ', () => {
    const csp = contentSecurityPolicy({ defaultHost: 'github.com', allowOtherHosts: true });
    expect(directive(csp, 'script-src')).toBe("script-src 'self'");
    expect(csp).not.toContain('unsafe');
  });
});
