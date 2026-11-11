/**
 * 行を Issue にする一連の処理（DESIGN.md §4.3）。
 * Issue の作成に成功した後の失敗では例外を投げない。呼び出し側が行への追記まで進められるようにするため。
 */
import { withParentLine } from '../note/issueDraft';
import type { IssueRef } from '../note/issueRefs';
import { addSubIssue, createIssue, getIssueNodeId, updateIssueBody, type RepoName } from './api';
import type { GitHubClient } from './client';

export type ParentLink =
  /** 親なし */
  | 'none'
  /** サブイシューとして紐づけた */
  | 'linked'
  /** サブイシューにできず、本文に親へのリンクを書いた */
  | 'body-link'
  /** どちらもできなかった */
  | 'failed';

export interface PromoteInput {
  repositoryId: string;
  repo: RepoName;
  title: string;
  body: string;
  labelIds: string[];
  parent: IssueRef | null;
  parentLabel: string;
}

export interface PromoteResult {
  ref: IssueRef;
  url: string;
  parentLink: ParentLink;
}

export async function promoteToIssue(client: GitHubClient, input: PromoteInput): Promise<PromoteResult> {
  const issue = await createIssue(client, { repositoryId: input.repositoryId, title: input.title, body: input.body, labelIds: input.labelIds });
  const ref: IssueRef = { owner: input.repo.owner, repo: input.repo.name, number: issue.number };
  if (!input.parent) return { ref, url: issue.url, parentLink: 'none' };

  try {
    const parentId = await getIssueNodeId(client, input.parent);
    if (parentId === null) throw new Error('parent not found');
    await addSubIssue(client, parentId, issue.id);
    return { ref, url: issue.url, parentLink: 'linked' };
  } catch {
    try {
      await updateIssueBody(client, issue.id, withParentLine(input.body, input.parent, input.parentLabel));
      return { ref, url: issue.url, parentLink: 'body-link' };
    } catch {
      return { ref, url: issue.url, parentLink: 'failed' };
    }
  }
}
