# 配布のしかた

Idea Outliner は静的サイトです。`npm run build` で `dist/` に出力したファイルを、GitHub Pages / GHE Pages に置くだけで動きます。サーバーの設定は要りません。
ファイルは相対パスで出力しているので、`https://<host>/<owner>/<repo>/` のようなサブパスにも置けます。

## 1. 既定の接続先を決める

| 配布先 | 設定 | 動作 |
|---|---|---|
| 公開版 | 何も設定しない | github.com が既定。利用者はほかの GHES にも接続できる |
| 社内版 | `defaultHost` に社内 GHE のホストを指定 | 接続先を社内 GHE に固定する |

社内版では、CSP（Content Security Policy）で通信先を社内 GHE だけに制限します。コメントに埋め込まれた外部の画像も読み込みません。

GHE Pages では、同じ GHE のすべての Pages サイトが同じ origin になります。このためアプリはトークンを localStorage に保存せず、タブを開いている間だけ保持します。サブドメイン分離が無効の GHE では Pages が GHE 本体と同じ origin になるので、GitHub の推奨どおり Pages を使わないでください。

設定は次のどちらかで渡します。環境変数が優先です。

**設定ファイル**（`idea-outliner.config.json`。Git の管理外です）

```bash
cp idea-outliner.config.example.json idea-outliner.config.json
```

```json
{
  "defaultHost": "ghe.example.com",
  "allowOtherHosts": false
}
```

**環境変数**: `IDEA_OUTLINER_DEFAULT_HOST`、`IDEA_OUTLINER_ALLOW_OTHER_HOSTS`

`allowOtherHosts` を省略すると、GHES を指定したときは `false`（固定）、github.com のときは `true` になります。

社内のホスト名はリポジトリにコミットしないでください。

## 2. Pages に置く

### A. GitHub Actions を使う

`.github/workflows/deploy-pages.yml` が、`main` への push で自動的にビルドして公開します。

1. リポジトリの **Settings → Pages** で Source を **GitHub Actions** にする
2. 社内版なら **Settings → Secrets and variables → Actions → Variables** に `IDEA_OUTLINER_DEFAULT_HOST` を追加する
3. `main` に push するか、**Actions** の画面から手動で実行する

GHES の場合は、Actions が有効で、ランナーと公式アクション（`actions/checkout` など）が使える必要があります。`runs-on: ubuntu-latest` は環境に合わせて（例: `self-hosted`）書き換えてください。使えない環境では次の手動の方法を使います。

### B. 手動で置く

```bash
npm ci
npm run build
```

`dist/` の中身を、公開用リポジトリの `gh-pages` ブランチのルートに置きます。

```bash
cd dist && git init -b gh-pages && git add -A && git commit -m "deploy" && git push -f <公開用リポジトリの URL> gh-pages
```

**Settings → Pages** で Source を **Deploy from a branch**、Branch を `gh-pages` / `/ (root)` にします。

## 3. 確認する

表示された URL を開き、接続できることを確かめます。社内版では、接続先のホスト名が固定で表示されます。

接続できない場合は、ブラウザの開発者ツールのコンソールを見てください。CORS のエラーが出ているときは、GHE 管理者に相談してください。

## 配布物に含まれるもの

アプリ本体と `THIRD_PARTY_LICENSES.txt` だけです。外部の CDN からは何も読み込みません。トークンやノートの内容は含まれません。

M0 の検証ページ（`spike.html`）は含まれません。必要なときは `npm run build:spike` でビルドします（[docs/spike/README.md](spike/README.md)）。
