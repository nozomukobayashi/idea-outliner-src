import { describe, expect, it } from 'vitest';
import { filterRepos, mergeRepos, ownerFromInput } from './repoSearch';

const repo = (nameWithOwner: string) => ({ nameWithOwner });

describe('ownerFromInput', () => {
  it.each([
    ['team-a', 'team-a'],
    ['team-a/', 'team-a'],
    ['team-a/ideas', 'team-a'],
    ['  team-a/ideas ', 'team-a'],
  ])('%j → %s', (input, expected) => {
    expect(ownerFromInput(input)).toBe(expected);
  });

  it.each(['', 'a', '/x', '-bad', 'a b', 'te_am'])('問い合わせない: %j', (input) => {
    expect(ownerFromInput(input)).toBeNull();
  });
});

describe('mergeRepos', () => {
  it('大文字小文字を無視して重複を除き、順序を保つ', () => {
    expect(mergeRepos([repo('A/x'), repo('b/y')], [repo('a/X'), repo('c/z')]).map((r) => r.nameWithOwner)).toEqual(['A/x', 'b/y', 'c/z']);
  });
});

describe('filterRepos', () => {
  const list = [repo('team-a/ideas'), repo('team-a/web'), repo('other/Ideas-2')];

  it('空の入力はすべて', () => {
    expect(filterRepos(list, ' ', 10).total).toBe(3);
  });

  it('部分一致で、大文字小文字を区別しない', () => {
    expect(filterRepos(list, 'IDEAS', 10).shown.map((r) => r.nameWithOwner)).toEqual(['team-a/ideas', 'other/Ideas-2']);
  });

  it('owner/name の形でも絞り込める', () => {
    expect(filterRepos(list, 'team-a/w', 10).shown.map((r) => r.nameWithOwner)).toEqual(['team-a/web']);
  });

  it('表示は上限で切るが、総数は返す', () => {
    expect(filterRepos(list, '', 2)).toMatchObject({ total: 3, shown: [{}, {}] });
  });
});
