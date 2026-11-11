import { GitHubApiError } from '../github/client';
import { ja } from '../i18n/ja';

export const isUnauthorized = (e: unknown): boolean => e instanceof GitHubApiError && e.status === 401;

/** API エラーの表示。メッセージはクライアント側でトークンを伏せ済み */
export function ErrorMessage(props: { error: unknown; /** 見出し側で何の失敗か示しているときは、理由だけを出す */ reasonOnly?: boolean }) {
  if (isUnauthorized(props.error)) return <p class="error">{ja.app.errors.unauthorized}</p>;
  const msg = props.error instanceof Error ? props.error.message : String(props.error);
  return <p class="error">{props.reasonOnly ? msg : ja.app.errors.generic(msg)}</p>;
}
