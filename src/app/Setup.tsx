/** 接続先とトークンの設定画面（初回と「接続を管理」） */
import { useState } from 'preact/hooks';
import { connectionFromHost } from '../config/connection';
import { BUILD_CONFIG, HOST_LOCKED } from '../config/defaults';
import { ja } from '../i18n/ja';
import { canPersistToken, deleteToken, loadToken, saveToken } from '../storage';
import { forgetConnection, listConnections, rememberConnection } from './prefs';
import { formatRoute, parseRoute } from './route';

const t = ja.app.setup;

export function Setup(props: { initialHost?: string; onCancel?: () => void; onConnected: () => void }) {
  const [host, setHost] = useState(() => {
    const initial = props.initialHost ?? BUILD_CONFIG.defaultHost;
    return initial !== 'github.com' || HOST_LOCKED ? initial : '';
  });
  const [token, setToken] = useState('');
  const [persist, setPersist] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(() => listConnections().filter((h) => loadToken(h) !== null && (!HOST_LOCKED || h === BUILD_CONFIG.defaultHost)));

  const credentialName = host.trim() === '' ? BUILD_CONFIG.defaultHost : host.trim();

  function connect(e: Event) {
    e.preventDefault();
    let normalized: string;
    try {
      normalized = connectionFromHost(host).host;
    } catch {
      setError(ja.app.errors.invalidHost);
      return;
    }
    if (token.trim() === '') {
      setError(ja.app.errors.noToken);
      return;
    }
    saveToken(normalized, token.trim(), persist);
    rememberConnection(normalized);
    setToken('');
    // 同じホストなら URL はそのまま（再読み込み後の入れ直しでは、開いていたノートに戻す）
    if (!HOST_LOCKED && parseRoute(location.hash).host !== normalized) location.hash = formatRoute({ host: normalized, repo: null, number: null });
    props.onConnected();
  }

  function remove(h: string) {
    if (!confirm(t.deleteTokenConfirm)) return;
    deleteToken(h);
    forgetConnection(h);
    setSaved((s) => s.filter((x) => x !== h));
  }

  return (
    <div class="center-page">
      <form class="panel" onSubmit={connect}>
        <h1>{t.heading}</h1>
        <p class="muted">{t.lead}</p>
        {/* ブラウザのパスワード保存に、接続先ごとの資格情報として認識させるためのもの */}
        <input type="text" name="username" value={credentialName} autocomplete="username" readOnly hidden />
        <label>
          {t.host}
          <input
            type="text"
            value={host}
            placeholder={t.hostPlaceholder}
            readOnly={HOST_LOCKED}
            onInput={(e) => setHost(e.currentTarget.value)}
            autocomplete="off"
            spellcheck={false}
          />
        </label>
        <label>
          {t.token}
          <input type="password" name="password" value={token} onInput={(e) => setToken(e.currentTarget.value)} autocomplete="current-password" spellcheck={false} />
        </label>
        {canPersistToken() ? (
          <>
            <label class="check-row">
              <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.currentTarget.checked)} />
              {t.persist}
            </label>
            {!persist && <p class="help">{t.notPersisted}</p>}
          </>
        ) : (
          <p class="help">{t.sharedOrigin}</p>
        )}
        <p class="help">{t.tokenHelp}</p>
        {error && <p class="error">{error}</p>}
        <div class="row">
          <button type="submit" class="primary">
            {t.connect}
          </button>
          {props.onCancel && (
            <button type="button" onClick={props.onCancel}>
              {t.cancel}
            </button>
          )}
        </div>

        {saved.length > 0 && (
          <>
            <h2>{t.saved}</h2>
            <ul class="plain-list">
              {saved.map((h) => (
                <li key={h} class="row between">
                  <span class="mono">{h}</span>
                  <span class="row">
                    <a class="button" href={formatRoute({ host: h, repo: null, number: null })} onClick={props.onCancel}>
                      {t.use}
                    </a>
                    <button type="button" onClick={() => remove(h)}>
                      {t.deleteToken}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </form>
    </div>
  );
}
