import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteItems, serializeNote } from '../note/format';
import { setItemText, splitItem } from '../outline/edit';
import { hasUnsavedSessions, NoteDeletedError, NoteSession, openSession, type SessionApi } from './noteSession';

const BODY = '- a <!-- id:a -->\n- b <!-- id:b -->\n';

/** GitHub 上の本文を 1 つ持つ偽の API */
function fakeRemote(initial = BODY) {
  const state = { body: initial as string | null };
  const api = {
    fetchBody: vi.fn<SessionApi['fetchBody']>(async () => state.body),
    updateBody: vi.fn<SessionApi['updateBody']>(async (b) => {
      state.body = b;
      return b;
    }),
  };
  return { state, api };
}

const text = (s: NoteSession) => noteItems(s.doc).map((i) => i.text);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('自動保存', () => {
  it('開いただけでは保存しない（ID のない本文でも）', async () => {
    const { api } = fakeRemote('- no id\n');
    const s = new NoteSession('- no id\n', api, 1000);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.fetchBody).not.toHaveBeenCalled();
    expect(api.updateBody).not.toHaveBeenCalled();
    expect(s.status).toBe('saved');
  });

  it('入力が止まってから保存する', async () => {
    const { api, state } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    s.edit(setItemText(s.doc, 'a', 'x'));
    await vi.advanceTimersByTimeAsync(800);
    s.edit(setItemText(s.doc, 'a', 'xy'));
    await vi.advanceTimersByTimeAsync(800);
    expect(api.updateBody).not.toHaveBeenCalled();
    expect(s.status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(300);
    expect(api.updateBody).toHaveBeenCalledTimes(1);
    expect(state.body).toBe('- xy <!-- id:a -->\n- b <!-- id:b -->\n');
    expect(s.status).toBe('saved');
  });

  it('変化のない編集では保存しない', async () => {
    const { api } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    s.edit(s.doc);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.fetchBody).not.toHaveBeenCalled();
  });

  it('元に戻して本文が同じなら書き込まない', async () => {
    const { api } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    s.edit(setItemText(s.doc, 'a', 'x'));
    s.edit(setItemText(s.doc, 'a', 'a'));
    await s.saveNow();
    expect(api.updateBody).not.toHaveBeenCalled();
    expect(s.status).toBe('saved');
  });

  it('編集すると ID のない行にも ID が書き込まれる', async () => {
    const { state, api } = fakeRemote('- x\n- y\n');
    const s = new NoteSession('- x\n- y\n', api, 1000);
    const [first] = noteItems(s.doc);
    s.edit(setItemText(s.doc, first!.id, 'x2'));
    await s.saveNow();
    expect(state.body).toMatch(/^- x2 <!-- id:\w+ -->\n- y <!-- id:\w+ -->\n$/);
  });
});

describe('保存中の編集', () => {
  it('書き込み中の編集は失わず、あとで保存する', async () => {
    const { api, state } = fakeRemote();
    let release!: (v: string) => void;
    api.updateBody.mockImplementationOnce(
      (b) =>
        new Promise((r) => {
          release = (v) => {
            state.body = b;
            r(v);
          };
        }),
    );
    const s = new NoteSession(BODY, api, 1000);
    s.edit(setItemText(s.doc, 'a', 'first'));
    const p = s.saveNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.status).toBe('saving');

    s.edit(setItemText(s.doc, 'b', 'second'));
    release('- first <!-- id:a -->\n- b <!-- id:b -->\n');
    await p;
    expect(s.status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(1100);
    expect(state.body).toBe('- first <!-- id:a -->\n- second <!-- id:b -->\n');
    expect(s.status).toBe('saved');
  });

  it('保存中に saveNow すると終わってから続けて保存する', async () => {
    const { api, state } = fakeRemote();
    const s = new NoteSession(BODY, api, 100000);
    s.edit(setItemText(s.doc, 'a', '1'));
    const p = s.saveNow();
    s.edit(setItemText(s.doc, 'a', '2'));
    void s.saveNow();
    await p;
    await vi.advanceTimersByTimeAsync(0);
    expect(state.body).toContain('- 2 ');
    expect(s.status).toBe('saved');
  });
});

describe('同時編集', () => {
  it('GitHub 側の本文が変わっていて別の行ならマージして保存する', async () => {
    const { api, state } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    state.body = '- a <!-- id:a -->\n- R <!-- id:b -->\n';
    s.edit(setItemText(s.doc, 'a', 'L'));
    await s.saveNow();
    expect(state.body).toBe('- L <!-- id:a -->\n- R <!-- id:b -->\n');
    expect(text(s)).toEqual(['L', 'R']);
    expect(s.status).toBe('saved');
  });

  it('同じ行なら保存せず衝突にする', async () => {
    const { api, state } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    state.body = '- R <!-- id:a -->\n- b <!-- id:b -->\n';
    s.edit(setItemText(s.doc, 'a', 'L'));
    await s.saveNow();
    expect(api.updateBody).not.toHaveBeenCalled();
    expect(s.status).toBe('conflict');
    expect(s.conflicts.map((c) => c.id)).toEqual(['a']);
  });

  it('衝突の解決待ちの間は編集も自動保存も止まる', async () => {
    const { api, state } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    state.body = '- R <!-- id:a -->\n- b <!-- id:b -->\n';
    s.edit(setItemText(s.doc, 'a', 'L'));
    await s.saveNow();
    const before = s.doc;
    s.edit(setItemText(s.doc, 'b', 'ignored'));
    expect(s.doc).toBe(before);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.updateBody).not.toHaveBeenCalled();
  });

  it.each([
    ['local', '- L <!-- id:a -->\n- b <!-- id:b -->\n'],
    ['remote', '- R <!-- id:a -->\n- b <!-- id:b -->\n'],
  ] as const)('衝突を %s で解決して保存する', async (res, expected) => {
    const { api, state } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    state.body = '- R <!-- id:a -->\n- b <!-- id:b -->\n';
    s.edit(setItemText(s.doc, 'a', 'L'));
    await s.saveNow();
    await s.resolveConflicts(new Map([['a', res]]));
    expect(state.body).toBe(expected);
    expect(s.status).toBe('saved');
    expect(s.conflicts).toEqual([]);
  });

  it('解決している間に GitHub 側がさらに変わってもマージする', async () => {
    const { api, state } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    state.body = '- R <!-- id:a -->\n- b <!-- id:b -->\n';
    s.edit(setItemText(s.doc, 'a', 'L'));
    await s.saveNow();
    state.body = '- R <!-- id:a -->\n- R2 <!-- id:b -->\n';
    await s.resolveConflicts(new Map([['a', 'local']]));
    expect(state.body).toBe('- L <!-- id:a -->\n- R2 <!-- id:b -->\n');
  });

  it('保存後は GitHub が返した本文を祖先にする（正規化されても誤検知しない）', async () => {
    const { api, state } = fakeRemote();
    api.updateBody.mockImplementation(async (b) => {
      state.body = b.replace(/\n/g, '\r\n');
      return state.body;
    });
    const s = new NoteSession(BODY, api, 1000);
    s.edit(setItemText(s.doc, 'a', 'x'));
    await s.saveNow();
    expect(serializeNote(s.base)).toBe(state.body);
    s.edit(setItemText(s.doc, 'b', 'y'));
    await s.saveNow();
    expect(s.status).toBe('saved');
    expect(noteItems(s.doc).map((i) => i.text)).toEqual(['x', 'y']);
  });
});

describe('失敗', () => {
  it('通信に失敗したら変更を残し、次の保存でやり直す', async () => {
    const { api, state } = fakeRemote();
    api.updateBody.mockRejectedValueOnce(new Error('boom'));
    const s = new NoteSession(BODY, api, 1000);
    s.edit(setItemText(s.doc, 'a', 'x'));
    await s.saveNow();
    expect(s.status).toBe('error');
    expect(s.busy).toBe(true);
    expect(text(s)).toEqual(['x', 'b']);
    await s.saveNow();
    expect(s.status).toBe('saved');
    expect(state.body).toContain('- x ');
  });

  it('ノートが消えていたらエラーにする', async () => {
    const { api, state } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    state.body = null;
    s.edit(setItemText(s.doc, 'a', 'x'));
    await s.saveNow();
    expect(s.error).toBeInstanceOf(NoteDeletedError);
    expect(api.updateBody).not.toHaveBeenCalled();
  });
});

describe('persistLine', () => {
  it('ID のない行は、編集していなくても書き込む', async () => {
    const { api, state } = fakeRemote('- x\n');
    const s = new NoteSession('- x\n', api, 1000);
    const id = noteItems(s.doc)[0]!.id;
    expect(s.isLineSaved(id)).toBe(false);
    expect(await s.persistLine(id)).toBe(true);
    expect(state.body).toBe(`- x <!-- id:${id} -->\n`);
    expect(s.isLineSaved(id)).toBe(true);
  });

  it('すでに書かれていれば通信しない', async () => {
    const { api } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    expect(await s.persistLine('a')).toBe(true);
    expect(api.fetchBody).not.toHaveBeenCalled();
  });

  it('新しく足した行は保存してから true', async () => {
    const { api, state } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    const r = splitItem(s.doc, 'b', 1, true);
    s.edit(r.doc);
    expect(await s.persistLine(r.focusId)).toBe(true);
    expect(state.body).toContain(`id:${r.focusId}`);
  });

  it('保存に失敗したら false', async () => {
    const { api } = fakeRemote('- x\n');
    api.updateBody.mockRejectedValueOnce(new Error('boom'));
    const s = new NoteSession('- x\n', api, 1000);
    expect(await s.persistLine(noteItems(s.doc)[0]!.id)).toBe(false);
  });

  it('衝突中は false', async () => {
    const { api, state } = fakeRemote();
    const s = new NoteSession(BODY, api, 1000);
    state.body = '- R <!-- id:a -->\n- b <!-- id:b -->\n';
    s.edit(setItemText(s.doc, 'a', 'L'));
    expect(await s.persistLine('a')).toBe(false);
    expect(s.status).toBe('conflict');
  });

  it('別の人が先に ID を振っていたら、古い ID では false（行の選び直しが要る）', async () => {
    const { api, state } = fakeRemote('- x\n');
    const s = new NoteSession('- x\n', api, 1000);
    const id = noteItems(s.doc)[0]!.id;
    state.body = '- x <!-- id:theirs -->\n';
    expect(await s.persistLine(id)).toBe(false);
    expect(s.isLineSaved('theirs')).toBe(true);
  });
});

describe('openSession', () => {
  it('未保存のセッションは再読み込みで捨てない', async () => {
    const { api } = fakeRemote();
    const s = openSession('k1', BODY, api);
    s.edit(setItemText(s.doc, 'a', 'x'));
    expect(hasUnsavedSessions()).toBe(true);
    const again = openSession('k1', BODY, api);
    expect(again).toBe(s);
    await s.saveNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(hasUnsavedSessions()).toBe(false);
  });

  it('保存済みなら最新の本文で作り直す', () => {
    const { api } = fakeRemote();
    const s = openSession('k2', BODY, api);
    const next = openSession('k2', '- new <!-- id:n -->\n', api);
    expect(next).not.toBe(s);
    expect(text(next)).toEqual(['new']);
  });
});
