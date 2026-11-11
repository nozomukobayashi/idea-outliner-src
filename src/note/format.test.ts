import { describe, expect, it } from 'vitest';
import {
  canonicalItemLine,
  hasPendingIdAssignments,
  noteItems,
  noteMeta,
  parseNote,
  serializeNote,
  type ItemEntry,
  type NoteDoc,
} from './format';

/** 決まった順に ID を返す生成器 */
function seqIds(prefix = 'n') {
  let n = 0;
  return (existing: ReadonlySet<string>) => {
    let id: string;
    do id = `${prefix}${n++}`;
    while (existing.has(id));
    return id;
  };
}

const parse = (s: string) => parseNote(s, { generateId: seqIds() });
const items = (doc: NoteDoc) => noteItems(doc).map((i) => ({ d: i.depth, c: i.checked, t: i.text, id: i.id }));

const SAMPLE = [
  '<!-- idea-outliner:v1 {"defaultRepo":"team-a/web"} -->',
  '',
  '- 初回ログイン後の体験 <!-- id:k3f9 -->',
  '  - [ ] チュートリアルを3ステップに短縮 team-a/web#118 <!-- id:p2a1 -->',
  '    - [ ] スキップボタンを常時表示 team-a/web#121 <!-- id:x8d0 -->',
  '    - [ ] 進捗バーを表示する <!-- id:m4c7 -->',
  '  - サンプルデータを最初から入れておく <!-- id:q1z5 -->',
  '- 管理者向け <!-- id:a9b2 -->',
  '  - [x] SSO 設定ガイドを書く team-a/api#97 <!-- id:t6e3 -->',
  '',
].join('\n');

describe('設計書 §4.1 の例', () => {
  it('メタデータと行を読める', () => {
    const doc = parse(SAMPLE);
    expect(noteMeta(doc)).toEqual({ version: 1, data: { defaultRepo: 'team-a/web' } });
    expect(items(doc)).toEqual([
      { d: 0, c: null, t: '初回ログイン後の体験', id: 'k3f9' },
      { d: 1, c: false, t: 'チュートリアルを3ステップに短縮 team-a/web#118', id: 'p2a1' },
      { d: 2, c: false, t: 'スキップボタンを常時表示 team-a/web#121', id: 'x8d0' },
      { d: 2, c: false, t: '進捗バーを表示する', id: 'm4c7' },
      { d: 1, c: null, t: 'サンプルデータを最初から入れておく', id: 'q1z5' },
      { d: 0, c: null, t: '管理者向け', id: 'a9b2' },
      { d: 1, c: true, t: 'SSO 設定ガイドを書く team-a/api#97', id: 't6e3' },
    ]);
    expect(hasPendingIdAssignments(doc)).toBe(false);
  });

  it('何も変えずに書き戻すと完全に一致する', () => {
    expect(serializeNote(parse(SAMPLE))).toBe(SAMPLE);
  });
});

/**
 * 「読み込んで何も変更せずに保存したとき、ID 付与以外の差分が出ない」ことの保証（CLAUDE.md）。
 * 手編集されがちな Markdown をいろいろ並べ、ID コメントを取り除いた結果が元と一致することを確かめる。
 */
describe('手編集された Markdown の往復', () => {
  const stripIds = (s: string) => s.replace(/ <!-- id:[a-z0-9]+ -->/g, '');

  const cases: Record<string, string> = {
    '空': '',
    '改行だけ': '\n\n',
    '末尾改行なし': '- a\n- b',
    'ID なしの入れ子': '- a\n  - b\n    - c\n- d\n',
    '4 スペースインデント': '- a\n    - b\n        - c\n    - d\n',
    'タブインデント': '- a\n\t- b\n\t\t- c\n',
    '* と + と番号付き': '* a\n  + b\n1. c\n2) d\n',
    'チェックボックスいろいろ': '- [ ] a\n- [x] b\n- [X] c\n- [ ]\n- []\n- [ ]x\n',
    '空の項目': '-\n- \n- a\n',
    '末尾の空白': '- a   \n- b\t\n',
    '見出しと段落': '# タイトル\n\n本文の段落。\n2 行目。\n\n- a\n- b\n\n## 次\n\n終わり\n',
    '遅延継続行': '- a\nつづき\n- b\n',
    'インデントされた段落': '- a\n\n  段落の続き\n\n- b\n',
    'コードブロック': '- a\n\n  ```js\n  - これは項目ではない\n  ```\n- b\n\n```\n- これも項目ではない\n\n```\n',
    '閉じていないコードブロック': '```\n- x\n- y\n',
    '水平線': '- a\n\n- - -\n\n***\n\n- b\n',
    'HTML': '<details>\n<summary>詳細</summary>\n\n- a\n\n</details>\n',
    'ほかの HTML コメント': '<!-- メモ -->\n- a <!-- 注記 -->\n',
    '壊れたメタデータ': '<!-- idea-outliner:v1 {broken -->\n- a\n',
    '1 行目以外のメタデータ風コメント': '\n<!-- idea-outliner:v1 {} -->\n- a\n',
    'リストの間の空行': '- a\n\n\n- b\n\n  - c\n',
    'インデントの段がずれている': '- a\n   - b\n - c\n  - d\n',
    'いきなり深いインデント': '    - a\n  - b\n- c\n',
    'マーカー直後に空白なし': '-a\n*b\n- ok\n',
    'CRLF': '- a\r\n  - b\r\n\r\nメモ\r\n',
  };

  for (const [name, src] of Object.entries(cases)) {
    it(name, () => {
      const doc = parse(src);
      const out = serializeNote(doc);
      expect(stripIds(out)).toBe(src);
      // ID を付けた結果をもう一度読むと、今度は何も足されない
      const again = parseNote(out, { generateId: () => 'NEVER' });
      expect(hasPendingIdAssignments(again)).toBe(false);
      expect(serializeNote(again)).toBe(out);
    });
  }

  it('ID のない行だけに ID が足され、行の他の部分はそのまま', () => {
    const out = serializeNote(parse('* a   \n  1. [X] b <!-- id:keep -->\n'));
    expect(out).toBe('* a <!-- id:n0 -->   \n  1. [X] b <!-- id:keep -->\n');
  });

  it('重複した ID は 2 つ目以降を振り直す', () => {
    const doc = parse('- a <!-- id:dup -->\n- b <!-- id:dup -->\n');
    expect(noteItems(doc).map((i) => i.id)).toEqual(['dup', 'n0']);
    expect(serializeNote(doc)).toBe('- a <!-- id:dup -->\n- b <!-- id:n0 -->\n');
  });
});

describe('構造の解釈', () => {
  it('インデントの段がずれていても、親の本文の桁で親子を決める', () => {
    // " - c" は a の本文の桁（2）より浅いので a の兄弟
    expect(items(parse('- a\n   - b\n - c\n  - d\n')).map((i) => [i.t, i.d])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
      ['d', 0], // c の本文の桁は 3 なので、インデント 2 の d は c の兄弟
    ]);
  });

  it('深さは 1 段ずつしか増えない', () => {
    expect(items(parse('- a\n        - b\n')).map((i) => i.d)).toEqual([0, 1]);
  });

  it('文書の先頭がインデントされていても深さ 0', () => {
    expect(items(parse('    - a\n  - b\n- c\n')).map((i) => i.d)).toEqual([0, 0, 0]);
  });

  it('メモの後のリストは新しいリスト', () => {
    expect(items(parse('- a\n  - b\n\nメモ\n\n  - c\n')).map((i) => i.d)).toEqual([0, 1, 0]);
  });

  it('連続するメモ行は 1 ブロック、空行で区切られたら別ブロック', () => {
    const doc = parse('# 見出し\n段落\n\n別の段落\n');
    expect(doc.entries.map((e) => e.kind)).toEqual(['memo', 'blank', 'memo', 'blank']);
    expect(doc.entries[0]).toEqual({ kind: 'memo', lines: ['# 見出し', '段落'] });
  });

  it('続きの行は直前の項目に付く', () => {
    const doc = parse('- a\n  - b\n\n  段落\n- c\n');
    const [, b] = noteItems(doc);
    expect(b?.continuation).toEqual(['', '  段落']);
  });

  it('コードブロック内の "- " は項目にしない', () => {
    expect(items(parse('```\n- x\n```\n- y\n')).map((i) => i.t)).toEqual(['y']);
  });

  it('チェックボックスの直後に空白がなければただのテキスト', () => {
    expect(items(parse('- [ ]x\n- []\n')).map((i) => [i.c, i.t])).toEqual([
      [null, '[ ]x'],
      [null, '[]'],
    ]);
  });

  it('行中のほかの HTML コメントはテキストに残す', () => {
    expect(items(parse('- a <!-- 注記 --> b <!-- id:z1 -->\n'))[0]).toMatchObject({ t: 'a <!-- 注記 --> b', id: 'z1' });
  });

  it('壊れたメタデータは raw を残し data は空', () => {
    expect(noteMeta(parse('<!-- idea-outliner:v1 {broken -->\n'))).toEqual({ version: 1, data: {} });
    expect(noteMeta(parse('<!-- idea-outliner:v2 ["x"] -->\n'))).toEqual({ version: 2, data: {} });
  });

  it('改行コードを覚えておく', () => {
    expect(parse('a\r\nb').eol).toBe('\r\n');
    expect(parse('a\nb').eol).toBe('\n');
  });
});

describe('変更した行の書き出し', () => {
  const change = (src: string, f: (it: ItemEntry[]) => void) => {
    const doc = parse(src);
    f(noteItems(doc));
    return serializeNote(doc);
  };

  it('変更した行だけ正規形になり、ほかの行は元のまま', () => {
    const out = change('* a <!-- id:a1 -->\n    * b <!-- id:b1 -->\n', (it) => {
      it[1]!.checked = true;
    });
    expect(out).toBe('* a <!-- id:a1 -->\n  - [x] b <!-- id:b1 -->\n');
  });

  it('深さを変えると正規のインデントになる', () => {
    const out = change('- a <!-- id:a1 -->\n  - b <!-- id:b1 -->\n', (it) => {
      it[1]!.depth = 0;
    });
    expect(out).toBe('- a <!-- id:a1 -->\n- b <!-- id:b1 -->\n');
  });

  it('canonicalItemLine', () => {
    expect(canonicalItemLine({ depth: 2, checked: null, text: 'x', id: 'i1' })).toBe('    - x <!-- id:i1 -->');
    expect(canonicalItemLine({ depth: 0, checked: false, text: '', id: 'i1' })).toBe('- [ ] <!-- id:i1 -->');
  });
});

describe('ID 生成', () => {
  it('既定の生成器はノート内で一意な ID を返す', () => {
    const src = Array.from({ length: 300 }, (_, i) => `- ${i}`).join('\n');
    const ids = noteItems(parseNote(src)).map((i) => i.id);
    expect(new Set(ids).size).toBe(300);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{4,}$/);
  });
});

describe('ランダムな Markdown の往復（ファズ）', () => {
  // 再現できるよう固定シードの擬似乱数を使う
  function rng(seed: number) {
    return () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }
  const pieces = [
    '', ' ', '\t', '  ', '    ', '- ', '* ', '+ ', '1. ', '-', '[ ] ', '[x] ', '[X] ', '[]', 'テキスト', 'abc', '**太字**',
    '`code`', '```', '~~~', '#', '# 見出し', '<!-- id:ab12 -->', '<!-- id:ab12-->', '<!-- メモ -->', '---', '> 引用', 'o/r#1',
  ];
  // 重複 ID の振り直しも「ID 付与」に含めるため、両側から ID コメントをすべて取り除いて比べる
  const stripAllIds = (s: string) => s.replace(/ ?<!--\s*id:[A-Za-z0-9_-]+\s*-->/g, '');

  it('ID 付与以外の差分が出ない（5000 文書）', () => {
    const rand = rng(42);
    for (let n = 0; n < 5000; n++) {
      const lineCount = Math.floor(rand() * 12);
      const lines: string[] = [];
      for (let l = 0; l < lineCount; l++) {
        let line = '';
        const parts = Math.floor(rand() * 5);
        for (let p = 0; p < parts; p++) line += pieces[Math.floor(rand() * pieces.length)];
        lines.push(line);
      }
      const src = lines.join(rand() < 0.1 ? '\r\n' : '\n');
      const doc = parseNote(src, { generateId: seqIds() });
      const out = serializeNote(doc);
      if (stripAllIds(out) !== stripAllIds(src)) throw new Error(`往復で差分: ${JSON.stringify(src)} → ${JSON.stringify(out)}`);
      const again = parseNote(out, { generateId: () => 'NEVER' });
      if (serializeNote(again) !== out) throw new Error(`2 回目で差分: ${JSON.stringify(out)}`);
    }
  });
});
