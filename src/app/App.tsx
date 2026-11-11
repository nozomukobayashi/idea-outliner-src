import { useEffect, useMemo, useState } from 'preact/hooks';
import { connectionFromHost } from '../config/connection';
import { BUILD_CONFIG, HOST_LOCKED } from '../config/defaults';
import { createGitHubClient } from '../github/client';
import { loadToken } from '../storage';
import { useHashRoute } from './hooks';
import { hasUnsavedSessions } from './noteSession';
import { lastHost, listConnections, rememberConnection } from './prefs';
import { formatRoute } from './route';
import { Setup } from './Setup';
import { Workspace } from './Workspace';
import { WorkspacePicker } from './WorkspacePicker';

export function App() {
  const route = useHashRoute();
  const [managing, setManaging] = useState(false);

  // ハッシュにホストがなければ、前回の接続先へ
  const fallbackHost = route.host || HOST_LOCKED ? null : (lastHost() ?? listConnections()[0] ?? null);
  useEffect(() => {
    if (fallbackHost && loadToken(fallbackHost)) location.replace(formatRoute({ host: fallbackHost, repo: null, number: null }));
  }, [fallbackHost]);

  // 接続先を固定したビルドでは、ほかのホストへのリンクを開いても既定のホストに戻す
  useEffect(() => {
    if (HOST_LOCKED && route.host && route.host !== BUILD_CONFIG.defaultHost) location.replace(formatRoute({ host: BUILD_CONFIG.defaultHost, repo: null, number: null }));
  }, [route.host]);

  const host = HOST_LOCKED ? BUILD_CONFIG.defaultHost : route.host;
  const token = host ? loadToken(host) : null;
  const client = useMemo(() => (host && token ? createGitHubClient(connectionFromHost(host), token) : null), [host, token]);

  useEffect(() => {
    if (host && token) rememberConnection(host);
  }, [host, token]);

  useEffect(() => setManaging(false), [host]);

  // 保存していない変更があるときは、タブを閉じる前に確認する
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedSessions()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  if (managing || !client) {
    return <Setup key={host ?? ''} initialHost={host ?? undefined} onCancel={client ? () => setManaging(false) : undefined} />;
  }
  if (!route.repo) return <WorkspacePicker client={client} />;
  return <Workspace client={client} repo={route.repo} number={route.number} onManageConnections={() => setManaging(true)} />;
}
