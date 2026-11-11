// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { dedent, renderBlock, renderInline, type ChipInfo } from './markdown';

const chip = (state: ChipInfo['state'] = 'open') => (r: { owner: string; repo: string; number: number }): ChipInfo => ({
  state,
  url: `https://ghe.example.test/${r.owner}/${r.repo}/issues/${r.number}`,
  title: 'タイトル',
});

describe('サニタイズ', () => {
  it.each([
    ['script', '<script>alert(1)</script>x', /<script/i],
    ['onerror', '<img src=x onerror="alert(1)">', /onerror/i],
    ['javascript: リンク', '[a](javascript:alert(1))', /javascript:/i],
    ['iframe', '<iframe src="https://evil.test"></iframe>', /<iframe/i],
    ['style 属性', '<span style="position:fixed">x</span>', /style=/i],
    ['form', '<form action="https://evil.test"><input name=a></form>', /<form|<input/i],
  ])('%s を取り除く', (_, src, bad) => {
    expect(renderInline(src)).not.toMatch(bad);
    expect(renderBlock(src)).not.toMatch(bad);
  });

  it('リンクは別タブで開き、参照元を送らない', () => {
    expect(renderInline('[a](https://example.test)')).toBe(
      '<a href="https://example.test" target="_blank" rel="noopener noreferrer">a</a>',
    );
  });

  it('インライン Markdown を HTML にする', () => {
    expect(renderInline('**太字** と `code`')).toBe('<strong>太字</strong> と <code>code</code>');
  });

  it('HTML コメントは表示しない', () => {
    expect(renderInline('a <!-- 注記 --> b')).not.toContain('注記');
  });
});

describe('Issue チップ', () => {
  it('参照をチップにする', () => {
    const html = renderInline('短縮 team-a/web#118 する', { chipFor: chip('closed'), stateLabel: (s) => s });
    expect(html).toBe(
      '短縮 <a class="chip chip-closed" href="https://ghe.example.test/team-a/web/issues/118" target="_blank" rel="noopener noreferrer" title="closed: タイトル">team-a/web#118</a> する',
    );
  });

  it('コードやリンクの中はチップにしない', () => {
    expect(renderInline('`o/r#1` [o/r#2](https://example.test)', { chipFor: chip() })).not.toContain('chip');
  });

  it('chipFor が null を返した参照はテキストのまま', () => {
    expect(renderInline('o/r#1', { chipFor: () => null })).toBe('o/r#1');
  });

  it('http(s) 以外の URL ではチップにしない', () => {
    expect(renderInline('o/r#1', { chipFor: () => ({ state: 'open', url: 'javascript:alert(1)' }) })).toBe('o/r#1');
  });

  it('参照の周りのテキストが HTML として解釈されない', () => {
    // marked が実体参照にしたものは、テキストノードとしてそのまま戻る
    const html = renderInline('&lt;b&gt; o/r#1', { chipFor: chip() });
    expect(html).not.toContain('<b>');
    expect(html).toContain('chip-open');
  });

  it('ブロックでもチップにする', () => {
    expect(renderBlock('# 見出し o/r#1\n\n段落', { chipFor: chip() })).toContain('chip-open');
  });
});

describe('dedent', () => {
  it('共通のインデントを取り除く', () => {
    expect(dedent(['', '  段落', '    続き'])).toBe('\n段落\n  続き');
  });
});
