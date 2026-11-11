import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute } from './route';

describe('parseRoute', () => {
  it.each([
    ['', { host: null, repo: null, number: null }],
    ['#/', { host: null, repo: null, number: null }],
    ['#/github.com', { host: 'github.com', repo: null, number: null }],
    ['#/GHE.example.test/team-a/ideas', { host: 'ghe.example.test', repo: { owner: 'team-a', name: 'ideas' }, number: null }],
    ['#/ghe.example.test/team-a/ideas/12', { host: 'ghe.example.test', repo: { owner: 'team-a', name: 'ideas' }, number: 12 }],
    ['#/ghe.example.test/team-a/ideas/abc', { host: 'ghe.example.test', repo: { owner: 'team-a', name: 'ideas' }, number: null }],
    ['#/ghe.example.test/team-a/ideas/0', { host: 'ghe.example.test', repo: { owner: 'team-a', name: 'ideas' }, number: null }],
    ['#/bad host/x/y', { host: null, repo: null, number: null }],
    ['#/ghe.example.test/x y/z', { host: 'ghe.example.test', repo: null, number: null }],
  ])('%j', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });

  it('formatRoute と往復する', () => {
    const r = { host: 'ghe.example.test:8443', repo: { owner: 'team-a', name: 'ideas.x' }, number: 3 };
    expect(formatRoute(r)).toBe('#/ghe.example.test:8443/team-a/ideas.x/3');
    expect(parseRoute(formatRoute(r))).toEqual(r);
  });
});
