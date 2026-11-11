import { describe, expect, it, vi } from 'vitest';
import { connectionFromHost } from '../config/connection';
import { createGitHubClient, GitHubApiError, type FetchLike } from './client';
import { promoteToIssue, type PromoteInput } from './promote';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Handlers {
  addSubIssue?: () => Response;
  updateIssue?: () => Response;
  parent?: () => Response;
  createIssue?: () => Response;
}

function setup(h: Handlers = {}) {
  const calls: { name: string; variables: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const f = vi.fn<FetchLike>(async (_url, init) => {
    const { query, variables } = JSON.parse(init?.body as string);
    const headers = init?.headers as Record<string, string>;
    const name = ['createIssue', 'addSubIssue', 'updateIssue', 'issue(number'].find((n) => query.includes(n)) ?? 'other';
    calls.push({ name, variables, headers });
    if (name === 'createIssue') return h.createIssue?.() ?? json({ data: { createIssue: { issue: { id: 'I_new', number: 12, url: 'https://ghe.example.test/o/r/issues/12' } } } });
    if (name === 'issue(number') return h.parent?.() ?? json({ data: { repository: { issue: { id: 'I_parent' } } } });
    if (name === 'addSubIssue') return h.addSubIssue?.() ?? json({ data: { addSubIssue: { issue: { number: 1 } } } });
    if (name === 'updateIssue') return h.updateIssue?.() ?? json({ data: { updateIssue: { issue: { id: 'I_new' } } } });
    return json({ data: {} });
  });
  return { client: createGitHubClient(connectionFromHost('ghe.example.test'), 'ghp_x', f), calls };
}

const input: PromoteInput = {
  repositoryId: 'R',
  repo: { owner: 'o', name: 'r' },
  title: 't',
  body: 'b\n',
  labelIds: ['L1'],
  parent: { owner: 'o', repo: 'p', number: 3 },
  parentLabel: '親',
};
const names = (calls: { name: string }[]) => calls.map((c) => c.name);
const fail = () => json({ errors: [{ message: 'not supported' }] });

describe('promoteToIssue', () => {
  it('親がなければ作るだけ', async () => {
    const { client, calls } = setup();
    const r = await promoteToIssue(client, { ...input, parent: null });
    expect(r).toEqual({ ref: { owner: 'o', repo: 'r', number: 12 }, url: 'https://ghe.example.test/o/r/issues/12', parentLink: 'none' });
    expect(names(calls)).toEqual(['createIssue']);
    expect(calls[0]?.variables.input).toEqual({ repositoryId: 'R', title: 't', body: 'b\n', labelIds: ['L1'] });
  });

  it('親があればサブイシューにする', async () => {
    const { client, calls } = setup();
    const r = await promoteToIssue(client, input);
    expect(r.parentLink).toBe('linked');
    expect(names(calls)).toEqual(['createIssue', 'issue(number', 'addSubIssue']);
    expect(calls[2]?.variables.input).toEqual({ issueId: 'I_parent', subIssueId: 'I_new' });
    expect(calls[2]?.headers['GraphQL-Features']).toBe('sub_issues');
  });

  it('サブイシューにできなければ本文に親へのリンクを書く', async () => {
    const { client, calls } = setup({ addSubIssue: fail });
    const r = await promoteToIssue(client, input);
    expect(r.parentLink).toBe('body-link');
    expect(calls.at(-1)?.variables.input).toEqual({ id: 'I_new', body: '親: o/p#3\n\nb\n' });
  });

  it('親が取得できない（PR など）ときも本文に書く', async () => {
    const { client } = setup({ parent: fail });
    expect((await promoteToIssue(client, input)).parentLink).toBe('body-link');
  });

  it('紐づけに全部失敗しても作った Issue は返す（作り直させない）', async () => {
    const { client, calls } = setup({ addSubIssue: fail, updateIssue: fail });
    const r = await promoteToIssue(client, input);
    expect(r).toMatchObject({ ref: { number: 12 }, parentLink: 'failed' });
    expect(names(calls).filter((n) => n === 'createIssue')).toHaveLength(1);
  });

  it('作成そのものの失敗は例外にする', async () => {
    const { client, calls } = setup({ createIssue: () => json({ message: 'Forbidden' }, 403) });
    await expect(promoteToIssue(client, input)).rejects.toBeInstanceOf(GitHubApiError);
    expect(names(calls)).toEqual(['createIssue']);
  });
});
