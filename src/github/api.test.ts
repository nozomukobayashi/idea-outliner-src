import { describe, expect, it, vi } from 'vitest';
import { connectionFromHost } from '../config/connection';
import { addComment, buildIssueStatesQuery, createNote, getIssueTarget, getWorkspace, fetchIssueStates, getNote, getNoteBody, listComments, listNotes, listOwnerRepos, listViewerRepos, searchIssues, updateNoteBody } from './api';
import { createGitHubClient, type FetchLike } from './client';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const clientWith = (f: FetchLike) => createGitHubClient(connectionFromHost('ghe.example.test'), 'ghp_x', f);
const sentBody = (f: ReturnType<typeof vi.fn<FetchLike>>, call = 0) => JSON.parse(f.mock.calls[call]![1]!.body as string);

describe('buildIssueStatesQuery', () => {
  it('リポジトリごとにまとめ、owner / name は変数で渡す', () => {
    const q = buildIssueStatesQuery([
      { owner: 'team-a', repo: 'web', number: 118 },
      { owner: 'Team-A', repo: 'Web', number: 121 },
      { owner: 'team-a', repo: 'api', number: 97 },
      { owner: 'team-a', repo: 'web', number: 118 },
    ]);
    expect(q.variables).toEqual({ o0: 'team-a', n0: 'web', o1: 'team-a', n1: 'api' });
    expect(q.query).toContain('r0: repository(owner: $o0, name: $n0)');
    expect(q.query).toContain('i118: issueOrPullRequest(number: 118)');
    expect(q.query).toContain('i121: issueOrPullRequest(number: 121)');
    expect(q.query).not.toContain('team-a');
    expect([...q.aliases]).toEqual([
      ['r0.i118', 'team-a/web#118'],
      ['r0.i121', 'team-a/web#121'],
      ['r1.i97', 'team-a/api#97'],
    ]);
  });

  it('不正な番号は無視する', () => {
    expect(buildIssueStatesQuery([{ owner: 'o', repo: 'r', number: 0 }]).aliases.size).toBe(0);
    expect(buildIssueStatesQuery([{ owner: 'o', repo: 'r', number: 1.5 }]).aliases.size).toBe(0);
  });
});

describe('fetchIssueStates', () => {
  it('状態を変換し、見つからないものは null にする（部分成功）', async () => {
    const f = vi.fn<FetchLike>(async () =>
      json({
        data: {
          r0: {
            i1: { __typename: 'Issue', state: 'OPEN', stateReason: null, title: 'a', url: 'https://ghe.example.test/o/r/issues/1' },
            i2: { __typename: 'Issue', state: 'CLOSED', stateReason: 'COMPLETED', title: 'b', url: 'u2' },
            i3: { __typename: 'Issue', state: 'CLOSED', stateReason: 'NOT_PLANNED', title: 'c', url: 'u3' },
            i4: { __typename: 'PullRequest', state: 'MERGED', title: 'd', url: 'u4' },
            i5: null,
          },
          r1: null,
        },
        errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }],
      }),
    );
    const refs = [1, 2, 3, 4, 5].map((number) => ({ owner: 'o', repo: 'r', number }));
    const m = await fetchIssueStates(clientWith(f), [...refs, { owner: 'x', repo: 'gone', number: 9 }]);
    expect(m.get('o/r#1')).toEqual({ state: 'open', title: 'a', url: 'https://ghe.example.test/o/r/issues/1' });
    expect(m.get('o/r#2')?.state).toBe('closed');
    expect(m.get('o/r#3')?.state).toBe('not_planned');
    expect(m.get('o/r#4')?.state).toBe('merged');
    expect(m.get('o/r#5')).toBeNull();
    expect(m.get('x/gone#9')).toBeNull();
  });

  it('参照がなければ通信しない', async () => {
    const f = vi.fn<FetchLike>();
    expect((await fetchIssueStates(clientWith(f), [])).size).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('listNotes', () => {
  it('ページをたどって全件取る', async () => {
    const node = (n: number) => ({ id: `D${n}`, number: n, title: `t${n}`, updatedAt: 'x', url: 'u', category: { id: 'C' }, author: null });
    const f = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(json({ data: { repository: { discussions: { nodes: [node(1)], pageInfo: { hasNextPage: true, endCursor: 'c1' } } } } }))
      .mockResolvedValueOnce(json({ data: { repository: { discussions: { nodes: [node(2)], pageInfo: { hasNextPage: false, endCursor: null } } } } }));
    const r = await listNotes(clientWith(f), { owner: 'o', name: 'r' });
    expect(r.notes.map((n) => n.number)).toEqual([1, 2]);
    expect(r.truncated).toBe(false);
    expect(sentBody(f, 1).variables.after).toBe('c1');
  });
});

describe('getNote', () => {
  it('本文とコメント数を返す', async () => {
    const f = vi.fn<FetchLike>(async () =>
      json({
        data: {
          repository: {
            discussion: { id: 'D', number: 3, title: 't', updatedAt: 'x', url: 'u', body: '- a', viewerCanUpdate: true, category: { id: 'C' }, author: { login: 'me' }, comments: { totalCount: 2 } },
          },
        },
      }),
    );
    expect(await getNote(clientWith(f), { owner: 'o', name: 'r' }, 3)).toEqual({
      id: 'D', number: 3, title: 't', updatedAt: 'x', url: 'u', categoryId: 'C', author: 'me', body: '- a', commentCount: 2, canEdit: true,
    });
  });
});

describe('保存', () => {
  it('getNoteBody は消えたノートで null', async () => {
    expect(await getNoteBody(clientWith(vi.fn<FetchLike>(async () => json({ data: { node: null } }))), 'D')).toBeNull();
  });

  it('空の本文は null にしない', async () => {
    expect(await getNoteBody(clientWith(vi.fn<FetchLike>(async () => json({ data: { node: { body: '' } } }))), 'D')).toBe('');
  });

  it('updateNoteBody は本文を変数で送り、保存された本文を返す', async () => {
    const f = vi.fn<FetchLike>(async () => json({ data: { updateDiscussion: { discussion: { body: 'saved' } } } }));
    expect(await updateNoteBody(clientWith(f), 'D', '- x')).toBe('saved');
    expect(sentBody(f).variables.input).toEqual({ discussionId: 'D', body: '- x' });
  });

  it('createNote は番号を返す', async () => {
    const f = vi.fn<FetchLike>(async () => json({ data: { createDiscussion: { discussion: { number: 7 } } } }));
    const input = { repositoryId: 'R', categoryId: 'C', title: 't', body: 'b' };
    expect(await createNote(clientWith(f), input)).toBe(7);
    expect(sentBody(f).variables.input).toEqual(input);
  });
});

describe('コメント', () => {
  const raw = (n: number, extra = {}) => ({ id: `C${n}`, url: `u${n}`, body: `b${n}`, createdAt: 't', isMinimized: false, author: { login: 'me' }, ...extra });

  it('ページをたどり、返信と著者なしを扱う', async () => {
    const f = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        json({ data: { node: { comments: { nodes: [raw(1, { replies: { totalCount: 60, nodes: [raw(2, { author: null })] } }), null], pageInfo: { hasNextPage: true, endCursor: 'c1' } } } } }),
      )
      .mockResolvedValueOnce(json({ data: { node: { comments: { nodes: [raw(3, { replies: { totalCount: 0, nodes: [] } })], pageInfo: { hasNextPage: false, endCursor: null } } } } }));
    const r = await listComments(clientWith(f), 'D');
    expect(r.truncated).toBe(false);
    expect(r.comments.map((c) => c.id)).toEqual(['C1', 'C3']);
    expect(r.comments[0]).toMatchObject({ author: 'me', replyCount: 60, replies: [{ id: 'C2', author: null }] });
    expect(sentBody(f, 1).variables).toEqual({ id: 'D', after: 'c1' });
  });

  it('addComment は本文を変数で送る', async () => {
    const f = vi.fn<FetchLike>(async () => json({ data: { addDiscussionComment: { comment: { id: 'C' } } } }));
    await addComment(clientWith(f), 'D', '<!-- x -->\nbody');
    expect(sentBody(f).variables.input).toEqual({ discussionId: 'D', body: '<!-- x -->\nbody' });
  });
});

describe('リポジトリの候補', () => {
  const r = (n: string) => ({ nameWithOwner: n, hasDiscussionsEnabled: true, hasIssuesEnabled: true });
  const page = (nodes: unknown[], endCursor: string | null) => ({ nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } });

  it('組織のリポジトリを含むよう ownerAffiliations を指定する', async () => {
    const f = vi.fn<FetchLike>(async () => json({ data: { viewer: { repositories: page([r('org/a')], null) } } }));
    await listViewerRepos(clientWith(f));
    const { query } = sentBody(f);
    expect(query).toMatch(/ownerAffiliations:\s*\[[^\]]*ORGANIZATION_MEMBER/);
    expect(query).toMatch(/[^r]affiliations:\s*\[[^\]]*ORGANIZATION_MEMBER/i);
  });

  it('100 件を超えてもページをたどる', async () => {
    const f = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(json({ data: { viewer: { repositories: page([r('a/1'), null], 'c1') } } }))
      .mockResolvedValueOnce(json({ data: { viewer: { repositories: page([r('a/2')], null) } } }));
    expect((await listViewerRepos(clientWith(f))).map((x) => x.nameWithOwner)).toEqual(['a/1', 'a/2']);
    expect(sentBody(f, 1).variables.after).toBe('c1');
  });

  it('無限に取り続けない', async () => {
    const f = vi.fn<FetchLike>(async () => json({ data: { viewer: { repositories: page([r('a/1')], 'next') } } }));
    await listViewerRepos(clientWith(f));
    expect(f).toHaveBeenCalledTimes(10);
  });

  it('owner を指定して一覧する', async () => {
    const f = vi.fn<FetchLike>(async () => json({ data: { repositoryOwner: { repositories: page([r('org/a')], null) } } }));
    expect((await listOwnerRepos(clientWith(f), 'org')).map((x) => x.nameWithOwner)).toEqual(['org/a']);
    expect(sentBody(f).variables).toEqual({ owner: 'org', after: null });
  });

  it('存在しない owner は空（エラーにしない）', async () => {
    const f = vi.fn<FetchLike>(async () => json({ data: { repositoryOwner: null }, errors: [{ type: 'NOT_FOUND', message: 'x' }] }));
    expect(await listOwnerRepos(clientWith(f), 'nobody')).toEqual([]);
  });
});

describe('見えないリポジトリ', () => {
  const notFound = () => json({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] });
  const forbidden = () => json({ data: { repository: null }, errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible' }] });
  const repo = { owner: 'o', name: 'r' };

  it.each([
    ['getWorkspace', (f: FetchLike) => getWorkspace(clientWith(f), repo)],
    ['getIssueTarget', (f: FetchLike) => getIssueTarget(clientWith(f), repo)],
    ['getNote', (f: FetchLike) => getNote(clientWith(f), repo, 1)],
  ])('%s: NOT_FOUND は null、それ以外は例外', async (_, call) => {
    expect(await call(vi.fn<FetchLike>(async () => notFound()))).toBeNull();
    await expect(call(vi.fn<FetchLike>(async () => forbidden()))).rejects.toThrow('FORBIDDEN');
  });
});

describe('Issue の補完', () => {
  const issue = (number: number, title: string, state = 'OPEN', stateReason: string | null = null) => ({ number, title, state, stateReason });
  const repo = { owner: 'o', name: 'r' };

  it('空なら最近の Issue', async () => {
    const f = vi.fn<FetchLike>(async () => json({ data: { repository: { issues: { nodes: [issue(12, 'a'), issue(3, 'b', 'CLOSED', 'NOT_PLANNED')] } } } }));
    expect(await searchIssues(clientWith(f), repo, '')).toEqual([
      { number: 12, title: 'a', state: 'open' },
      { number: 3, title: 'b', state: 'not_planned' },
    ]);
    expect(sentBody(f).query).not.toContain('exact:');
  });

  it('数字なら番号の前方一致で、ちょうどの番号を先頭にする', async () => {
    const f = vi.fn<FetchLike>(async () =>
      json({ data: { repository: { issues: { nodes: [issue(120, 'x'), issue(12, 'y'), issue(5, 'z')] }, exact: issue(12, 'y') } } }),
    );
    expect((await searchIssues(clientWith(f), repo, '12')).map((i) => i.number)).toEqual([12, 120]);
    expect(sentBody(f).query).toContain('exact: issue(number: 12)');
  });

  it('文字なら題名で検索し、別のリポジトリの結果は除く', async () => {
    const f = vi.fn<FetchLike>(async () =>
      json({ data: { search: { nodes: [{ ...issue(7, 'ログ出力'), repository: { nameWithOwner: 'o/r' } }, { ...issue(8, '他'), repository: { nameWithOwner: 'x/y' } }, {}] } } }),
    );
    expect(await searchIssues(clientWith(f), repo, 'ログ "repo:x/y"')).toEqual([{ number: 7, title: 'ログ出力', state: 'open' }]);
    expect(sentBody(f).variables.q).toBe('repo:o/r is:issue in:title ログ  repo:x/y');
  });

  it('見えないリポジトリは空', async () => {
    const f = vi.fn<FetchLike>(async () => json({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'x' }] }));
    expect(await searchIssues(clientWith(f), repo, '')).toEqual([]);
  });
});
