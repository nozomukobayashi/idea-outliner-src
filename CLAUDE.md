# CLAUDE.md

このリポジトリは Idea Outliner：GitHub / GHES の Discussions と Issues を土台にした、チームで共有するアウトライナー（静的 Web アプリ）。

## 最初に読むもの
- 設計: `docs/DESIGN.md`（仕様の正。迷ったらここに従い、変える場合は先に設計書を更新する）

## 現在の段階
- M2（書く）完了（github.com の実データで作成・保存・自動マージ・衝突解決を確認済み。GitHub 画面で手編集した本文への書き込みと、実際の日本語入力は未確認）
- M3（Issue 化）完了（github.com の実データで Issue 作成と行への追記を確認済み。ラベルとサブイシューは API が成功するところまで確認し、GitHub の画面では未確認。別リポジトリへの紐づけも未確認）
- M4（議論）完了（github.com の実データで投稿・行への紐づけ・再読み込みを確認済み）
- M5（配布）完了（GHE Pages への手動デプロイで確認済み。Actions でのデプロイは未確認）
- M1（読むだけ）完了（github.com の実データで確認済み）
- M0（スパイク）完了（§9 の項目は社内 GHES でもすべて OK）。結果は `docs/spike/M0-results.md`、手順は `docs/spike/README.md`

## 前提と制約
- サーバーなしの静的サイト。ビルド成果物は `dist/` で、GitHub Pages / GHE Pages にそのまま置ける形を保つ
- github.com と GHES（3.20 以降）の両方で動くこと。API の URL は接続設定から組み立て、`api.github.com` を直書きしない
- 外部 CDN から読み込まない。依存はすべてバンドルする
- トークンは既定でタブの間だけ保持する（sessionStorage）。localStorage への保存はユーザーが選んだときだけで、GHE Pages のような共有 origin では保存しない。ログ・エラーメッセージ・URL に出さない
- GitHub から取得した本文・コメントは信頼できない入力として扱い、表示前に DOMPurify でサニタイズする
- 社内のホスト名・リポジトリ名などをコードやテストに直書きしない（設定ファイルやテスト用の仮の値を使う）。ビルド時の設定は `idea-outliner.config.json`（Git の管理外）か環境変数で渡す

## 技術スタック
TypeScript / Vite / Preact / Vitest。GraphQL を主に使い、必要なところだけ REST。

## コマンド
- `npm run dev` 開発サーバー
- `npm run build` `dist/` に出力（`npm run build:spike` は M0 の検証ページも含める）
- `npm test` テスト
- `npm run typecheck` 型チェック

## コードの配置
- `src/config/` 接続設定・リポジトリ名 / `src/github/` API クライアント（`client.ts`）と取得処理（`api.ts`）
- `src/note/` ノート本文のパース・シリアライズ、3-way マージ、Issue 参照 / `src/outline/` 表示行の組み立てと編集操作 / `src/render/` Markdown 表示（サニタイズ）
- `src/app/` 画面（Preact）と保存処理（`noteSession.ts`） / `src/i18n/ja.ts` UI 文言 / `src/spike/` M0 の検証ページ（`spike.html`）

## コードの方針
- ノート本文のパース・シリアライズ（`docs/DESIGN.md` §4.1）と 3-way マージ（§5）は UI から独立した純粋関数にし、Vitest で厚めにテストする
- パーサーは手編集された Markdown を壊さないこと。読み込んで何も変更せずに保存したとき、ID 付与以外の差分が出ないことをテストで保証する
- GitHub API 呼び出しは 1 つのクライアントモジュールに集約し、接続設定（REST / GraphQL / Web の URL）を受け取る形にする
- UI 文言は日本語。将来の多言語化に備えて文言は 1 か所にまとめる

## コミット
- 小さめの単位でコミットする。メッセージは日本語で可
- マイルストーンの区切りで `docs/DESIGN.md` 冒頭のステータスと、このファイルの「現在の段階」を更新する
