import { useMemo, useState } from 'preact/hooks';
import { connectionFromHost, type Connection } from '../config/connection';
import { createGitHubClient } from '../github/client';
import { ja } from '../i18n/ja';
import { canPersistToken, deleteToken, loadJson, loadToken, saveJson, saveToken } from '../storage';
import {
  checkCorsAndViewer,
  checkDiscussions,
  checkSubIssuesCrossRepo,
  checkSubIssuesSameRepo,
  type CheckContext,
  type CheckOutcome,
} from './checks';
import { buildReport, classifyOrigin, type AutoCheckId, type AutoResult, type ManualCheckId, type ManualStatus } from './report';
import { parseRepo, repoToString, type RepoRef } from './util';

const t = ja.spike;

interface Settings {
  host: string;
  ideasRepo: string;
  issuesRepo: string;
  crossRepo: string;
  cleanup: boolean;
}

const DEFAULT_SETTINGS: Settings = { host: '', ideasRepo: '', issuesRepo: '', crossRepo: '', cleanup: true };

const CHECKS: Record<AutoCheckId, (ctx: CheckContext) => Promise<CheckOutcome>> = {
  '1': checkCorsAndViewer,
  '2': checkDiscussions,
  '3': checkSubIssuesSameRepo,
  '4': checkSubIssuesCrossRepo,
};
const AUTO_IDS = ['1', '2', '3', '4'] as const;
const MANUAL_IDS = ['5', '6'] as const;

function tryConnection(host: string): Connection | null {
  try {
    return connectionFromHost(host);
  } catch {
    return null;
  }
}

function optionalRepo(s: string): { ref: RepoRef | null; invalid: boolean } {
  if (s.trim() === '') return { ref: null, invalid: false };
  const ref = parseRepo(s);
  return { ref, invalid: ref === null };
}

export function SpikeApp() {
  const [settings, setSettings] = useState<Settings>(() => loadJson('spike-settings', DEFAULT_SETTINGS));
  const conn = useMemo(() => tryConnection(settings.host), [settings.host]);
  const [token, setToken] = useState<string>(() => (conn ? (loadToken(conn.host) ?? '') : ''));
  const [tokenSaved, setTokenSaved] = useState<boolean>(() => (conn ? loadToken(conn.host) !== null : false));
  const [results, setResults] = useState<Partial<Record<AutoCheckId, AutoResult>>>({});
  const [running, setRunning] = useState<AutoCheckId | null>(null);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const [manual, setManual] = useState<Record<ManualCheckId, { status: ManualStatus; memo: string }>>(() =>
    loadJson('spike-manual', { '5': { status: 'unknown', memo: '' }, '6': { status: 'unknown', memo: '' } }),
  );
  const [redact, setRedact] = useState(true);
  const [copied, setCopied] = useState(false);
  const [viewerLogin, setViewerLogin] = useState('');

  const ideas = optionalRepo(settings.ideasRepo);
  const issues = optionalRepo(settings.issuesRepo);
  const cross = optionalRepo(settings.crossRepo);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveJson('spike-settings', next);
    if (patch.host !== undefined) {
      const c = tryConnection(next.host);
      const saved = c ? loadToken(c.host) : null;
      setToken(saved ?? '');
      setTokenSaved(saved !== null);
    }
  };

  const updateManual = (id: ManualCheckId, patch: Partial<{ status: ManualStatus; memo: string }>) => {
    const next = { ...manual, [id]: { ...manual[id], ...patch } };
    setManual(next);
    saveJson('spike-manual', next);
  };

  const canRun = conn !== null && token.trim() !== '' && !ideas.invalid && !issues.invalid && !cross.invalid && running === null;

  async function run(id: AutoCheckId) {
    if (!conn || token.trim() === '') return;
    const lines: string[] = [];
    setRunning(id);
    setLiveLog([]);
    const ctx: CheckContext = {
      client: createGitHubClient(conn, token.trim()),
      token: token.trim(),
      ideasRepo: ideas.ref,
      issuesRepo: issues.ref,
      crossRepo: cross.ref,
      cleanup: settings.cleanup,
      origin: location.origin,
      log: (line) => {
        lines.push(line);
        setLiveLog([...lines]);
        const m = /^viewer\.login: (.+)$/.exec(line);
        if (m?.[1]) setViewerLogin(m[1]);
      },
    };
    let outcome: CheckOutcome;
    try {
      outcome = await CHECKS[id](ctx);
    } catch (e) {
      lines.push(`予期しないエラー: ${e instanceof Error ? e.message : String(e)}`);
      outcome = { status: 'ng', summary: '予期しないエラー' };
    }
    setResults((prev) => ({ ...prev, [id]: { ...outcome, log: lines, ranAt: new Date().toISOString() } }));
    setRunning(null);
  }

  async function runAll() {
    for (const id of AUTO_IDS) await run(id);
  }

  const report = useMemo(() => {
    const redactions: [string, string][] = [];
    if (conn && conn.kind === 'ghes') redactions.push([conn.host, '<HOST>']);
    if (ideas.ref) redactions.push([repoToString(ideas.ref), '<IDEAS_REPO>'], [ideas.ref.owner, '<OWNER>']);
    if (issues.ref) redactions.push([repoToString(issues.ref), '<ISSUES_REPO>'], [issues.ref.owner, '<OWNER>']);
    if (cross.ref) redactions.push([repoToString(cross.ref), '<CROSS_REPO>'], [cross.ref.owner, '<OWNER>']);
    if (viewerLogin) redactions.push([viewerLogin, '<USER>']);
    return buildReport({
      generatedAt: new Date().toISOString(),
      connectionKind: conn?.kind ?? 'github',
      originKind: classifyOrigin(location.origin, conn?.host ?? ''),
      auto: results,
      manual,
      redactions: redact ? redactions : null,
    });
  }, [results, manual, redact, conn, ideas.ref, issues.ref, cross.ref, viewerLogin]);

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境ではテキストエリアから手でコピーしてもらう
    }
  }

  return (
    <main>
      <h1>{t.title}</h1>
      <p class="lead">{t.lead}</p>

      <section>
        <h2>{t.connection.heading}</h2>
        <label>
          {t.connection.host}
          <input
            type="text"
            value={settings.host}
            placeholder={t.connection.hostPlaceholder}
            onInput={(e) => update({ host: e.currentTarget.value })}
            autocomplete="off"
            spellcheck={false}
          />
        </label>
        {conn === null && <p class="error">{t.errors.invalidHost}</p>}
        {conn && (
          <dl class="urls">
            <dt>REST</dt>
            <dd>{conn.restBaseUrl}</dd>
            <dt>GraphQL</dt>
            <dd>{conn.graphqlUrl}</dd>
            <dt>Web</dt>
            <dd>{conn.webUrl}</dd>
          </dl>
        )}
        <label>
          {t.connection.token}
          <input
            type="password"
            value={token}
            onInput={(e) => {
              setToken(e.currentTarget.value);
              setTokenSaved(false);
            }}
            autocomplete="off"
            spellcheck={false}
          />
        </label>
        <p class="help">{canPersistToken() ? t.connection.tokenHelp : t.connection.sharedOrigin}</p>
        <div class="row">
          {canPersistToken() && (
            <button
              type="button"
              disabled={!conn || token.trim() === ''}
              onClick={() => conn && setTokenSaved(saveToken(conn.host, token.trim(), true))}
            >
              {t.connection.saveToken}
            </button>
          )}
          <button
            type="button"
            disabled={!conn}
            onClick={() => {
              if (!conn) return;
              deleteToken(conn.host);
              setToken('');
              setTokenSaved(false);
            }}
          >
            {t.connection.deleteToken}
          </button>
          {tokenSaved && <span class="muted">{t.connection.tokenSaved}</span>}
        </div>
      </section>

      <section>
        <h2>{t.repos.heading}</h2>
        <RepoInput label={t.repos.ideas} value={settings.ideasRepo} invalid={ideas.invalid} onInput={(v) => update({ ideasRepo: v })} />
        <RepoInput label={t.repos.issues} value={settings.issuesRepo} invalid={issues.invalid} onInput={(v) => update({ issuesRepo: v })} />
        <RepoInput label={t.repos.cross} value={settings.crossRepo} invalid={cross.invalid} onInput={(v) => update({ crossRepo: v })} />
        <label class="check">
          <input type="checkbox" checked={settings.cleanup} onChange={(e) => update({ cleanup: e.currentTarget.checked })} />
          {t.repos.cleanup}
        </label>
        <p class="warning">{t.repos.warning}</p>
      </section>

      <section>
        <div class="row between">
          <h2>{t.checks.heading}</h2>
          <button type="button" disabled={!canRun} onClick={runAll}>
            {t.checks.runAll}
          </button>
        </div>
        {AUTO_IDS.map((id) => {
          const r = results[id];
          const isRunning = running === id;
          const log = isRunning ? liveLog : (r?.log ?? []);
          return (
            <article class="card" key={id}>
              <header class="row between">
                <h3>
                  #{id} {ja.checkTitles[id]}
                </h3>
                <div class="row">
                  <Badge status={isRunning ? 'running' : (r?.status ?? 'none')} />
                  <button type="button" disabled={!canRun} onClick={() => run(id)}>
                    {isRunning ? t.checks.running : t.checks.run}
                  </button>
                </div>
              </header>
              <p class="help">{ja.checkHints[id]}</p>
              {r && !isRunning && <p class="summary">{r.summary}</p>}
              {log.length > 0 && <pre class="log">{log.join('\n')}</pre>}
            </article>
          );
        })}
      </section>

      <section>
        <h2>{t.manual.heading}</h2>
        {MANUAL_IDS.map((id) => (
          <article class="card" key={id}>
            <header class="row between">
              <h3>
                #{id} {ja.checkTitles[id]}
              </h3>
              <select value={manual[id].status} onChange={(e) => updateManual(id, { status: e.currentTarget.value as ManualStatus })}>
                <option value="unknown">{t.manual.unknown}</option>
                <option value="ok">{t.manual.ok}</option>
                <option value="ng">{t.manual.ng}</option>
              </select>
            </header>
            <p class="help">{ja.checkHints[id]}</p>
            <label>
              {t.manual.memo}
              <textarea rows={2} value={manual[id].memo} onInput={(e) => updateManual(id, { memo: e.currentTarget.value })} />
            </label>
          </article>
        ))}
      </section>

      <section>
        <div class="row between">
          <h2>{t.report.heading}</h2>
          <div class="row">
            <label class="check">
              <input type="checkbox" checked={redact} onChange={(e) => setRedact(e.currentTarget.checked)} />
              {t.report.anonymize}
            </label>
            <button type="button" onClick={copyReport}>
              {copied ? t.report.copied : t.report.copy}
            </button>
          </div>
        </div>
        <p class="help">{t.report.help}</p>
        <textarea class="report" readOnly rows={16} value={report} />
      </section>
    </main>
  );
}

function RepoInput(props: { label: string; value: string; invalid: boolean; onInput: (v: string) => void }) {
  return (
    <label>
      {props.label}
      <input
        type="text"
        value={props.value}
        placeholder={t.repos.placeholder}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        autocomplete="off"
        spellcheck={false}
      />
      {props.invalid && <span class="error">{t.errors.invalidRepo}</span>}
    </label>
  );
}

function Badge({ status }: { status: AutoResult['status'] | 'running' | 'none' }) {
  const label = status === 'running' ? t.checks.running : status === 'none' ? t.checks.notRun : t.status[status];
  return <span class={`badge badge-${status}`}>{label}</span>;
}
