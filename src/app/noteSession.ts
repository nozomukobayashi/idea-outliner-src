/**
 * 開いているノートの編集状態と保存処理（DESIGN.md §5）。画面から独立している。
 *
 * - 編集が止まって数秒後に自動保存する。ノートを開いただけでは保存しない
 * - 保存の直前に最新の本文を取り、読み込み時と違えば 3-way マージする
 * - 同じ行の衝突はユーザーが解決するまで保存しない
 */
import { noteItems, parseNote, serializeNote, type NoteDoc } from '../note/format';
import { merge3, type MergeConflict, type Resolution } from '../note/merge';

export interface SessionApi {
  /** 最新の本文。ノートが消えていたら null */
  fetchBody(): Promise<string | null>;
  /** 本文を保存し、GitHub が保存した本文を返す */
  updateBody(body: string): Promise<string>;
}

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

export class NoteDeletedError extends Error {
  constructor() {
    super('note deleted');
    this.name = 'NoteDeletedError';
  }
}

export const AUTOSAVE_DELAY_MS = 3000;

export class NoteSession {
  doc: NoteDoc;
  /** 最後に GitHub と揃っていた文書（共通の祖先） */
  base: NoteDoc;
  conflicts: MergeConflict[] = [];
  error: unknown = null;

  private baseBody: string;
  private dirty = false;
  private saving: Promise<void> | null = null;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingRemote: { doc: NoteDoc; body: string } | null = null;
  private listeners = new Set<() => void>();

  constructor(
    body: string,
    private readonly api: SessionApi,
    private readonly delayMs = AUTOSAVE_DELAY_MS,
  ) {
    this.baseBody = body;
    this.base = parseNote(body);
    this.doc = this.base;
  }

  get status(): SaveStatus {
    if (this.pendingRemote) return 'conflict';
    if (this.saving) return 'saving';
    if (this.error) return 'error';
    return this.dirty ? 'dirty' : 'saved';
  }

  /** 保存していない変更があるか */
  get busy(): boolean {
    return this.status !== 'saved';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** 編集結果を反映する。衝突の解決待ちの間は受け付けない */
  edit(next: NoteDoc): void {
    if (next === this.doc || this.pendingRemote) return;
    this.doc = next;
    this.dirty = true;
    this.schedule();
    this.emit();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow();
    }, this.delayMs);
  }

  /** すぐ保存する。保存中なら、終わってからもう一度保存する */
  saveNow(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.saving) {
      this.rerun = true;
      return this.saving;
    }
    if (!this.dirty || this.pendingRemote) return Promise.resolve();
    this.error = null;
    this.saving = this.run().finally(() => {
      this.saving = null;
      const again = this.rerun && this.dirty && !this.error;
      this.rerun = false;
      if (again) void this.saveNow();
      else if (this.dirty && !this.error && !this.pendingRemote) this.schedule();
      this.emit();
    });
    this.emit();
    return this.saving;
  }

  private async run(): Promise<void> {
    try {
      const remoteBody = await this.api.fetchBody();
      if (remoteBody === null) throw new NoteDeletedError();

      if (remoteBody !== this.baseBody) {
        // ここから write まで await がないので、マージの間に編集が割り込むことはない
        const remote = parseNote(remoteBody);
        const result = merge3(this.base, this.doc, remote);
        if (result.conflicts.length > 0) {
          this.conflicts = result.conflicts;
          this.pendingRemote = { doc: remote, body: remoteBody };
          return;
        }
        this.adopt(result.doc, remote, remoteBody);
      }

      const sent = this.doc;
      const body = serializeNote(sent);
      const saved = body === remoteBody ? remoteBody : await this.api.updateBody(body);
      this.baseBody = saved;
      this.base = parseNote(saved);
      // 書き込みの間に編集されていたら、未保存のまま残す
      this.dirty = this.doc !== sent;
    } catch (e) {
      this.error = e;
    }
  }

  /** マージ結果を編集中の文書にする。以降の編集はこの文書の上に積まれる */
  private adopt(merged: NoteDoc, remote: NoteDoc, remoteBody: string): void {
    this.doc = merged;
    this.base = remote;
    this.baseBody = remoteBody;
  }

  /** 行の ID がすでに GitHub 上の本文に書かれているか */
  isLineSaved(id: string): boolean {
    return noteItems(this.base).some((i) => i.id === id && i.source?.id === id);
  }

  /**
   * 行の ID が GitHub 上の本文に書かれている状態にする（コメントの紐づけのため）。
   * 編集していなくても ID を書き込むために保存する。書き込めたら true
   */
  async persistLine(id: string): Promise<boolean> {
    if (!this.isLineSaved(id)) this.dirty = true;
    await this.saveNow();
    // 保存中だった場合は saveNow が先の保存を返すので、もう一度確かめる
    if (this.saving) await this.saving;
    return !this.busy && this.isLineSaved(id);
  }

  /** 衝突を解決して保存する。解決している間に GitHub 側が変わっていれば、もう一度マージされる */
  resolveConflicts(resolutions: ReadonlyMap<string, Resolution>): Promise<void> {
    const pending = this.pendingRemote;
    if (!pending) return Promise.resolve();
    const result = merge3(this.base, this.doc, pending.doc, resolutions);
    if (result.conflicts.length > 0) {
      this.conflicts = result.conflicts;
      this.emit();
      return Promise.resolve();
    }
    this.adopt(result.doc, pending.doc, pending.body);
    this.pendingRemote = null;
    this.conflicts = [];
    this.dirty = true;
    return this.saveNow();
  }
}

/* ------------------------------------------------------------ 開いているノートの管理 */

const sessions = new Map<string, NoteSession>();

/**
 * ノートのセッションを得る。未保存の変更があるセッションは捨てず、そのまま返して保存を試みる。
 * （再読み込みや、別のノートを見て戻ってきたときに編集を失わないため）
 */
export function openSession(key: string, body: string, api: SessionApi): NoteSession {
  const existing = sessions.get(key);
  if (existing?.busy) {
    void existing.saveNow();
    return existing;
  }
  const session = new NoteSession(body, api);
  sessions.set(key, session);
  return session;
}

export const hasUnsavedSessions = (): boolean => [...sessions.values()].some((s) => s.busy);
