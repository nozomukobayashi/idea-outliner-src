# M0 スパイク結果

検証ページ（`src/spike/`）の結果レポートを実行ごとに貼り、下に所見をまとめる。手順は [README.md](README.md)。

## まとめ

| # | 確認内容 | github.com | 社内 GHES |
|---|---|---|---|
| 1 | ブラウザから API を呼べるか（CORS） | OK（localhost から） | OK |
| 2 | Discussions の GraphQL（作成・更新・コメント） | OK | OK |
| 3 | サブイシュー（同一リポジトリ） | OK（GraphQL・REST とも） | OK |
| 4 | リポジトリをまたいだサブイシュー | 未確認（スキップ） | OK |
| 5 | GHES で fine-grained PAT が使えるか | —（github.com では fine-grained で全項目 OK） | OK |
| 6 | GHE Pages の公開範囲 | — | OK |

社内 GHES の結果は、社用 PC で確認した利用者の報告による（項目ごとのレポートは社外に持ち出していない）。

## 所見

### 本文の往復（パーサー向け）
- github.com の API 経由では、Discussion 本文・コメント本文とも**送ったものがそのまま返る**（改行コード・末尾改行・HTML コメントが変わらない）
- ただし GitHub の Web 画面で手編集された本文は CRLF になることがある。パーサーは CRLF も読めるようにし、書き戻すときは読み込んだときの改行コードに合わせる（M1 で確認・テスト）

### 同時編集の検知（§5 に反映済み）
- 本文を更新すると Discussion の `updatedAt` は変わる
- **コメントを追加しただけでも Discussion の `updatedAt` が変わる**。`updatedAt` だけで判断すると、行コメントが付くたびに「他人が編集した」扱いになる
- 対応: 保存直前に `updatedAt` と一緒に本文も取り、本文が読み込み時と同じならそのまま保存する（DESIGN.md §5 を更新）
- 次の実行から #2 は `lastEditedAt` も記録する。コメントで変わらないなら、本文変更の検知にはこちらを使える可能性がある

### Issue
- 状態（OPEN / CLOSED）は `nodes(ids:)` でまとめて取得できる（§4.3 のチップ用）

### トークン（社内 GHES での確認）
- 自分の配下のリポジトリでは fine-grained PAT で動いたが、組織のリポジトリは同じトークンで NOT_FOUND になり、classic PAT（`repo`）では開けた
- fine-grained PAT は 1 つの owner の配下しか扱えない。組織のリポジトリには Resource owner を組織にしたトークンが要る（組織のポリシーで使えない場合は classic PAT）
- classic PAT で接続すると、ワークスペースの候補に組織のリポジトリが出ることを確認した（`ownerAffiliations` の修正後）

## 残り
なし（M0 完了）

---

## 実行記録

### 2026-11-10 github.com（localhost から）

```text
| # | 確認内容 | 結果 | 要約 |
|---|---|---|---|
| 1 | Pages からブラウザで API を呼べるか（CORS） | OK | GraphQL・REST とも OK（viewer: <OWNER>） |
| 2 | Discussions の GraphQL（作成・更新・コメント） | OK | 作成・更新・コメント・読み出しすべて OK |
| 3 | サブイシュー（同一リポジトリ） | OK | サブイシューの紐づけ: GraphQL・REST とも OK |
| 4 | リポジトリをまたいだサブイシュー | スキップ | 別リポジトリが未入力 |
| 5 | GHES で fine-grained PAT が使えるか | 未確認 |  |
| 6 | GHE Pages の公開範囲（社内限定にできるか） | 未確認 |  |
```

#1

```text
実行元 origin: http://localhost:5173
接続先: github（GraphQL: https://api.github.com/graphql）
トークンの種類（接頭辞から推定）: fine-grained
viewer.login: <OWNER>
rateLimit: 4999/5000
X-OAuth-Scopes: （取得できず。fine-grained PAT か、CORS で公開されていないヘッダー）
REST /meta: OK
```

#2

```text
hasDiscussionsEnabled: true / viewerPermission: ADMIN
カテゴリ: Announcements(announcements), General(general), Ideas(ideas), Polls(polls), Q&A(q-a, Q&A), Show and tell(show-and-tell)
使用するカテゴリ: General
createDiscussion: OK #2 https://github.com/<IDEAS_REPO>/discussions/2
  本文の往復（作成）: 送信した本文と完全に一致
updateDiscussion: OK updatedAt 2026-11-10T14:17:58Z → 2026-11-10T14:18:01Z
  本文の往復（更新）: 送信した本文と完全に一致
再取得: updatedAt 2026-11-10T14:18:01Z
addDiscussionComment: OK https://github.com/<IDEAS_REPO>/discussions/2#discussioncomment-19520835
  本文の往復（コメント）: 送信した本文と完全に一致
コメント読み出し: totalCount 1、ref コメント あり
注意: コメント追加で Discussion の updatedAt が変わった（2026-11-10T14:18:01Z → 2026-11-10T14:18:05Z）。§5 では本文比較も併用する
deleteDiscussion: OK（後片付け済み）
```

#3

```text
対象: <IDEAS_REPO>
親 Issue: #3
addSubIssue (GraphQL): OK #3 ← #4
POST .../sub_issues (REST): OK #3 ← #5
subIssues (GraphQL): <IDEAS_REPO>#4, <IDEAS_REPO>#5
sub_issues (REST): #4, #5
状態の一括取得: #3=OPEN, #4=OPEN, #5=OPEN
クローズ: https://github.com/<IDEAS_REPO>/issues/3
クローズ: https://github.com/<IDEAS_REPO>/issues/4
クローズ: https://github.com/<IDEAS_REPO>/issues/5
```
