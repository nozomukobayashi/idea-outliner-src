# M0 スパイク：検証ページの使い方

`docs/DESIGN.md` §9 の確認項目を、ブラウザから GitHub / GHES の API を直接呼んで確かめるためのページ。
検証ページのコードは `src/spike/` にある。接続設定（`src/config/`）と API クライアント（`src/github/`）は M1 以降もそのまま使う。

## 準備

- アイディア用の**検証用**リポジトリ（Discussions を有効にし、カテゴリを 1 つ以上作っておく）
- #4 用に、同じ owner の別リポジトリ（任意）
- PAT
  - fine-grained: 対象リポジトリに Discussions / Issues (read/write)、Metadata (read)
  - classic: `repo`
- #2 の後片付け（Discussion の削除）にはリポジトリの maintain 以上の権限が必要。削除できなかった場合はログに URL が出るので手で消す

> #2〜#4 は指定したリポジトリに Discussion・Issue を実際に作る。タイトルには `[idea-outliner spike]` が付く。
> 「後片付け」にチェックを入れておくと、Discussion は削除、Issue は「Not planned」でクローズする（Issue の削除は管理者権限が必要なので行わない）。

## ローカルで動かす（github.com での確認・動作確認用）

```bash
npm install
npm run dev
```

http://localhost:5173/spike.html を開く（M1 以降、`/` は本体のアプリ）。ホスト名を空欄（または `github.com`）にすると github.com に接続する。

localhost からの実行は、社内 GHE の CORS（#1）の確認にはならない。#1 は必ず GHE Pages 上で行う。

## 社内 GHE Pages に置く（#1 の本番確認）

```bash
npm run build:spike
```

検証ページは配布用の `npm run build` には含まれません。`dist/` の中身を、検証用リポジトリの Pages 公開元（例: `gh-pages` ブランチのルート）にそのまま置く。
アセットは相対パスで出力しているので、`https://<pages のホスト>/<owner>/<repo>/` のようなサブパスでも動く。

手動で置く例（`dist/` を `gh-pages` ブランチとして push する）:

```bash
cd dist && git init -b gh-pages && git add -A && git commit -m "spike" && git push -f <検証用リポジトリの URL> gh-pages
```

リポジトリの Settings → Pages で公開元を `gh-pages` ブランチに設定し、表示された URL の末尾に `spike.html` を付けて開く。

## 実行と記録

1. ホスト名とトークンを入れる（「このブラウザに保存」は任意。保存先は localStorage のみ）
2. リポジトリを入れて、#1 から順に「実行」（または「すべて実行」）
3. #5・#6 は手動で確認して、結果とメモを入れる
4. 「結果レポート」をコピーして `docs/spike/M0-results.md` に貼る
   - 既定でホスト名・リポジトリ名・ユーザー名は `<HOST>` などに伏せ字になる。リポジトリにコミットする前に、社内の情報が残っていないか目で確認すること

## 各チェックで見ていること

| # | 内容 | 補足 |
|---|---|---|
| 1 | GraphQL `viewer { login }` と REST `/meta` | ログに実行元 origin・トークンの種類（接頭辞から推定）・GHES のバージョン（取れた場合）を出す |
| 2 | Discussion の作成 → 本文更新 → 再取得 → 行コメント → 読み出し → 削除 | 本文が GitHub でどう正規化されるか（改行コード・末尾改行・HTML コメント）、本文更新で `updatedAt` が変わるか、コメント追加で Discussion の `updatedAt` が変わるかも記録する（パーサーと §5 の競合検知の前提） |
| 3 | 同一リポジトリでの親子 Issue | GraphQL `addSubIssue` と REST `POST .../sub_issues` の両方を試す。Issue 状態の一括取得（§4.3 のチップ用）も確認 |
| 4 | 別リポジトリの Issue をサブイシューに | GraphQL がダメなら REST も試す。GHE 画面の「Add sub-issue」でも確認すると確実 |
| 5 | GHES で fine-grained PAT が使えるか | 発行できたらそのトークンで #1 を実行する |
| 6 | GHE Pages の公開範囲 | GHE 管理者に確認 |
