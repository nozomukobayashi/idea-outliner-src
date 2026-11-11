import { describe, expect, it } from 'vitest';
import { connectionFromHost, InvalidHostError, normalizeHost } from './connection';

describe('normalizeHost', () => {
  it.each([
    ['ghe.example.test', 'ghe.example.test'],
    ['  GHE.Example.Test  ', 'ghe.example.test'],
    ['https://ghe.example.test/', 'ghe.example.test'],
    ['https://ghe.example.test/api/v3', 'ghe.example.test'],
    ['ghe.example.test:8443', 'ghe.example.test:8443'],
    ['http://user:pass@ghe.example.test/x?y#z', 'ghe.example.test'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });

  it.each(['', '   ', 'https://', 'ghe example.test', '-bad.example.test', 'ghe..example.test', 'a_b.test'])(
    '不正な入力 %j はエラー',
    (input) => {
      expect(() => normalizeHost(input)).toThrow(InvalidHostError);
    },
  );
});

describe('connectionFromHost', () => {
  it('空文字は github.com', () => {
    expect(connectionFromHost('').kind).toBe('github');
  });

  it.each(['github.com', 'https://github.com', 'api.github.com', 'www.github.com'])('%s は github.com の URL になる', (input) => {
    expect(connectionFromHost(input)).toEqual({
      kind: 'github',
      host: 'github.com',
      restBaseUrl: 'https://api.github.com',
      graphqlUrl: 'https://api.github.com/graphql',
      webUrl: 'https://github.com',
    });
  });

  it('GHES は /api/v3 と /api/graphql を使う', () => {
    expect(connectionFromHost('https://ghe.example.test/')).toEqual({
      kind: 'ghes',
      host: 'ghe.example.test',
      restBaseUrl: 'https://ghe.example.test/api/v3',
      graphqlUrl: 'https://ghe.example.test/api/graphql',
      webUrl: 'https://ghe.example.test',
    });
  });

  it('ポート付きの GHES', () => {
    expect(connectionFromHost('ghe.example.test:8443').graphqlUrl).toBe('https://ghe.example.test:8443/api/graphql');
  });
});
