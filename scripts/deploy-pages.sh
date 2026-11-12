#!/usr/bin/env bash
# 社内 GHE Pages へのデプロイを 1 つのコマンドで行う。
#
#   scripts/deploy-pages.sh <Pages 用リポジトリの URL>   初回
#   scripts/deploy-pages.sh                              2 回目以降（URL は覚えている）
#
# やること: 最新を取得 → 依存を入れる → ビルド → 接続先が固定されているか確認 → gh-pages ブランチに push
# Node.js が古ければ（20.19 / 22.12 未満）、新しい Node.js を一時的に使う。
# オプション: --no-pull（最新を取得しない） --dry-run（push しない）
set -euo pipefail

cd "$(dirname "$0")/.."

PULL=1
DRY_RUN=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "知らないオプションです: $arg" >&2
      exit 1
      ;;
    *) TARGET="$arg" ;;
  esac
done

# 置き先の URL は、このリポジトリの .git/config に覚えておく（コミットされない）
if [ -n "$TARGET" ]; then
  git config tane.deployUrl "$TARGET"
else
  TARGET="$(git config tane.deployUrl || true)"
fi
if [ -z "$TARGET" ] && [ "$DRY_RUN" = 0 ]; then
  echo "置き先のリポジトリの URL を指定してください（初回のみ）:" >&2
  echo "  scripts/deploy-pages.sh https://<GHE のホスト>/<owner>/<repo>.git" >&2
  exit 1
fi

# 接続先のホスト名。設定ファイルも環境変数もなければ聞いて、設定ファイルに書く（Git の管理外）
CONFIG=idea-outliner.config.json
if [ -z "${IDEA_OUTLINER_DEFAULT_HOST:-}" ] && [ ! -f "$CONFIG" ]; then
  if [ ! -t 0 ] && [ -n "${CI:-}" ]; then
    echo "接続先のホスト名がありません（IDEA_OUTLINER_DEFAULT_HOST か $CONFIG を用意してください）。" >&2
    exit 1
  fi
  read -r -p "社内 GHE のホスト名（例: ghe.example.com）: " HOST_INPUT
  HOST_INPUT="${HOST_INPUT#https://}"
  HOST_INPUT="${HOST_INPUT%%/*}"
  if [ -z "$HOST_INPUT" ]; then
    echo "ホスト名が空です。" >&2
    exit 1
  fi
  printf '{"defaultHost":"%s"}\n' "$HOST_INPUT" >"$CONFIG"
fi

if [ "$PULL" = 1 ]; then
  echo "==> 最新を取得します"
  git pull --ff-only
fi

# ビルドに必要な Node.js のバージョンを満たすか
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major minor
  v="$(node -v | sed 's/^v//')"
  major="${v%%.*}"
  minor="$(echo "$v" | cut -d. -f2)"
  { [ "$major" -eq 20 ] && [ "$minor" -ge 19 ]; } || { [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; } || [ "$major" -ge 23 ]
}
if node_ok; then
  RUN=()
else
  echo "==> Node.js $(node -v 2>/dev/null || echo 'なし') ではビルドできないため、Node.js 22 を一時的に使います"
  RUN=(npx -y -p node@22 --)
fi

echo "==> 依存を入れます"
${RUN[@]+"${RUN[@]}"} npm ci --no-audit --no-fund

echo "==> ビルドします"
${RUN[@]+"${RUN[@]}"} npm run build

CSP_CONNECT="$(grep -o "connect-src[^;]*" dist/index.html || true)"
echo "    $CSP_CONNECT"
case "$CSP_CONNECT" in
  "connect-src 'self' https://"*) ;;
  *)
    echo "接続先が固定されていません。$CONFIG の defaultHost を確認してください。push はしません。" >&2
    exit 1
    ;;
esac
if echo "$CSP_CONNECT" | grep -q "example\.com"; then
  echo "接続先が例のまま（example.com）です。$CONFIG を確認してください。push はしません。" >&2
  exit 1
fi

if [ "$DRY_RUN" = 1 ]; then
  echo "==> --dry-run なので push しません（dist/ を確認してください）"
  exit 0
fi

echo "==> gh-pages ブランチに push します"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -R dist/. "$WORK"/
(
  cd "$WORK"
  git init -q -b gh-pages
  git add -A
  git -c user.name="tane deploy" -c user.email="tane-deploy@localhost" commit -q -m "deploy $(date '+%Y-%m-%d %H:%M')"
  git push -f "$TARGET" gh-pages
)
echo "==> 完了しました。1〜2 分後に Pages を再読み込みしてください。"
