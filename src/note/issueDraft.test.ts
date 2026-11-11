import { describe, expect, it } from 'vitest';
import { noteItems, parseNote, serializeNote } from './format';
import { findIssueRefs } from './issueRefs';
import { childrenMarkdown, defaultRepoOf, issueBody, issueTitle, MAX_TITLE_LENGTH, parentIssueRef, withIssueRef, withParentLine } from './issueDraft';

const DOC = [
  '<!-- idea-outliner:v1 {"defaultRepo":"team-a/web"} -->',
  '',
  '- 親 team-a/web#118 <!-- id:p -->',
  '  - [ ] 子 <!-- id:c -->',
  '    - 孫 **太字** <!-- id:g -->',
  '    - [x] 孫 2 <!-- id:h -->',
  '  - 子 2 <!-- id:d -->',
  '- 別 <!-- id:e -->',
  '',
].join('\n');
const doc = () => parseNote(DOC);

describe('issueTitle', () => {
  it.each([
    ['ふつうの文', 'ふつうの文'],
    ['**太字** と `code` と ~~消~~', '太字 と code と 消'],
    ['[リンク](https://example.test) の話', 'リンク の話'],
    ['![画像](https://example.test/a.png)', '画像'],
    ['a <!-- メモ --> b', 'a b'],
    ['  前後の空白  ', '前後の空白'],
  ])('%s', (text, expected) => {
    expect(issueTitle(text)).toBe(expected);
  });

  it('上限で切る', () => {
    expect(issueTitle('あ'.repeat(300))).toHaveLength(MAX_TITLE_LENGTH);
  });
});

describe('childrenMarkdown', () => {
  it('子孫を相対的な深さのリストにする（ID は含めない）', () => {
    expect(childrenMarkdown(doc().entries, 'p')).toBe('- [ ] 子\n  - 孫 **太字**\n  - [x] 孫 2\n- 子 2');
  });

  it('深い行でも先頭の深さが 0 になる', () => {
    expect(childrenMarkdown(doc().entries, 'c')).toBe('- 孫 **太字**\n- [x] 孫 2');
  });

  it('子がなければ空', () => {
    expect(childrenMarkdown(doc().entries, 'e')).toBe('');
  });
});

describe('issueBody', () => {
  const input = { children: '- a', noteUrl: 'https://ghe.example.test/o/r/discussions/7', lineId: 'p', sourceLabel: '元のノート' };

  it('子項目・元ノートへのリンク・埋め込みコメントを含む', () => {
    expect(issueBody(input)).toBe(
      '- a\n\n元のノート: https://ghe.example.test/o/r/discussions/7\n\n<!-- idea-outliner:source {"note":"https://ghe.example.test/o/r/discussions/7","line":"p"} -->\n',
    );
  });

  it('子がなければリンクから始まる', () => {
    expect(issueBody({ ...input, children: '' }).startsWith('元のノート:')).toBe(true);
  });

  it('埋め込みコメントが途中で閉じない', () => {
    const body = issueBody({ ...input, noteUrl: 'https://x.test/a-->b' });
    const comment = /<!-- idea-outliner:source (.*) -->/.exec(body)?.[1] ?? '';
    expect(comment).not.toContain('-->');
    expect(JSON.parse(comment).note).toBe('https://x.test/a-->b');
  });

  it('親へのリンクを先頭に足せる', () => {
    expect(withParentLine('本文\n', { owner: 'o', repo: 'r', number: 3 }, '親')).toBe('親: o/r#3\n\n本文\n');
  });
});

describe('parentIssueRef', () => {
  it('親の行の参照を返す', () => {
    expect(parentIssueRef(doc(), 'c')).toEqual({ owner: 'team-a', repo: 'web', number: 118 });
  });

  it('親が Issue でなければ null（祖先はたどらない）', () => {
    expect(parentIssueRef(doc(), 'g')).toBeNull();
  });

  it('親がなければ null', () => {
    expect(parentIssueRef(doc(), 'p')).toBeNull();
  });
});

describe('defaultRepoOf', () => {
  it('メタデータの defaultRepo', () => {
    expect(defaultRepoOf(doc())).toBe('team-a/web');
  });

  it.each(['- a\n', '<!-- idea-outliner:v1 {} -->\n', '<!-- idea-outliner:v1 {"defaultRepo":1} -->\n'])('なければ null: %j', (src) => {
    expect(defaultRepoOf(parseNote(src))).toBeNull();
  });
});

describe('withIssueRef', () => {
  it('行の末尾に足し、参照として読み直せて、書き出しても壊れない', () => {
    const text = withIssueRef('やること ', { owner: 'o', repo: 'r', number: 12 });
    expect(text).toBe('やること o/r#12');
    expect(findIssueRefs(text)).toHaveLength(1);
    const d = parseNote(`- ${text} <!-- id:a -->\n`);
    expect(noteItems(d)[0]?.text).toBe(text);
    expect(serializeNote(d)).toBe(`- ${text} <!-- id:a -->\n`);
  });
});
