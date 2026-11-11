/** 同時編集の衝突を、行ごとに選んで解決するダイアログ。本文はプレーンテキストとして表示する */
import { useState } from 'preact/hooks';
import { ja } from '../i18n/ja';
import type { ItemContent, MergeConflict, Resolution } from '../note/merge';

const t = ja.app.conflict;

function describe(c: ItemContent | null): string {
  if (!c) return t.deleted;
  const box = c.checked === null ? '' : c.checked ? '[x] ' : '[ ] ';
  return box + (c.text === '' ? t.emptyText : c.text);
}

export function ConflictDialog(props: { conflicts: MergeConflict[]; onResolve: (r: ReadonlyMap<string, Resolution>) => void }) {
  const [choices, setChoices] = useState<Record<string, Resolution>>({});
  const complete = props.conflicts.every((c) => choices[c.id]);

  return (
    <div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="conflict-heading">
        <h2 id="conflict-heading">{t.heading}</h2>
        <p class="muted">{t.lead}</p>
        {props.conflicts.map((c) => (
          <fieldset key={c.id} class="conflict">
            <legend>
              {t.original}: {describe(c.base)}
            </legend>
            {(['local', 'remote'] as const).map((side) => (
              <label key={side} class="choice">
                <input
                  type="radio"
                  name={`conflict-${c.id}`}
                  checked={choices[c.id] === side}
                  onChange={() => setChoices({ ...choices, [c.id]: side })}
                />
                <span>
                  <span class="choice-label">{side === 'local' ? t.mine : t.theirs}</span>
                  <span class="choice-text">{describe(side === 'local' ? c.local : c.remote)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        <button type="button" class="primary" disabled={!complete} onClick={() => props.onResolve(new Map(Object.entries(choices)))}>
          {t.apply}
        </button>
      </div>
    </div>
  );
}
