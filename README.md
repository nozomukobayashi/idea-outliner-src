# Idea Outliner（仮）

GitHub / GitHub Enterprise Server の Discussions と Issues を使った、チームで共有できるアウトライナーです。

- アイディアやメモをアウトラインで書き溜める
- 行ごとにチームで議論する（Discussion のコメント）
- 良いアイディアはそのまま Issue に昇格。Issue の状態がアウトライン上に表示される

サーバーもデータベースも持たず、データはすべてあなたの GitHub / GHE 上に保存されます。

## しくみ

- **アプリ**: 静的サイト。GitHub Pages / GHE Pages に置いて使います
- **アイディア用リポジトリ**（例: `your-team/ideas`）: Discussions を有効にし、ノートを保存します
- **プロジェクトのリポジトリ**: アイディアを Issue にするときの行き先です

共有範囲はアイディア用リポジトリの権限そのままです。アプリを使わない人も、GitHub の Discussions の画面から読んでコメントできます。

## ドキュメント

- [使い方（利用者向けセットアップガイド）](docs/SETUP.md)
- [配布のしかた（Pages へのデプロイ、社内向けビルド）](docs/DEPLOY.md)
- [設計書](docs/DESIGN.md)

## 開発

Node.js 20.19 以降または 22.12 以降が必要です。

```bash
npm install
npm run dev     # http://localhost:5173
npm test
npm run build   # dist/ に出力（Pages にそのまま置ける）
```

## ライセンス

[MIT](LICENSE)。同梱しているライブラリのライセンスは、ビルド成果物の `THIRD_PARTY_LICENSES.txt` にあります。
