/** スパイク用の小さな純粋関数群 */

export { parseRepo, repoToString, type RepoRef } from '../config/repo';

/**
 * 送った本文と GitHub から返った本文の違いを説明する。
 * パーサーが「何も変えずに保存したら差分ゼロ」を保証するには、GitHub 側の正規化を知っておく必要がある。
 */
export function describeBodyDiff(sent: string, received: string): { identical: boolean; notes: string[] } {
  if (sent === received) return { identical: true, notes: ['送信した本文と完全に一致'] };

  const notes: string[] = [];
  const hasCrlf = received.includes('\r\n');
  const sentHasCrlf = sent.includes('\r\n');
  if (hasCrlf && !sentHasCrlf) notes.push('改行が LF → CRLF に変換されている');
  if (!hasCrlf && sentHasCrlf) notes.push('改行が CRLF → LF に変換されている');

  const norm = (s: string) => s.replace(/\r\n/g, '\n');
  const a = norm(sent);
  const b = norm(received);
  if (a === b) {
    notes.push('改行コード以外は一致');
    return { identical: false, notes };
  }
  if (a.trimEnd() === b.trimEnd()) {
    notes.push(`末尾の空白・改行だけが異なる（送信 ${JSON.stringify(trailing(a))} / 受信 ${JSON.stringify(trailing(b))}）`);
    return { identical: false, notes };
  }
  if (a.trim() === b.trim()) {
    notes.push('先頭・末尾の空白・改行だけが異なる');
    return { identical: false, notes };
  }

  const countComments = (s: string) => (s.match(/<!--[\s\S]*?-->/g) ?? []).length;
  const ca = countComments(a);
  const cb = countComments(b);
  if (ca !== cb) notes.push(`HTML コメントの数が変わった（送信 ${ca} / 受信 ${cb}）`);

  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const line = a.slice(0, i).split('\n').length;
  notes.push(`${line} 行目付近で相違: 送信 ${JSON.stringify(a.slice(i, i + 40))} / 受信 ${JSON.stringify(b.slice(i, i + 40))}`);
  return { identical: false, notes };
}

function trailing(s: string): string {
  const m = s.match(/\s*$/);
  return m ? m[0] : '';
}

/** レポート共有用に、ホスト名やリポジトリ名を仮の名前に置き換える */
export function anonymize(text: string, replacements: [secret: string, placeholder: string][]): string {
  // 長いものから置換して、部分一致による取りこぼしを防ぐ
  const sorted = replacements.filter(([s]) => s.length > 0).sort((x, y) => y[0].length - x[0].length);
  let out = text;
  for (const [secret, placeholder] of sorted) {
    out = out.split(secret).join(placeholder);
    const lower = secret.toLowerCase();
    if (lower !== secret) out = out.split(lower).join(placeholder);
  }
  return out;
}
