import { useMemo, useState } from "react";

import type { GameCatalog } from "../data";
import type { CyberOperationRun } from "../state/cyberProfile";

/**
 * Engineering Lab pre-deploy loadout.
 *
 * The room lets the player substitute up to its level in offered controls
 * before deploying. The server owns the allowance and re-validates the result,
 * so this panel only expresses the intent; it can never make an impossible run.
 * The player may always leave everything unchanged.
 */
export interface OperationLoadoutProps {
  run: CyberOperationRun;
  catalog: GameCatalog;
  /** Substitutions allowed by the player's Engineering Lab level. */
  allowance: number;
  busy: boolean;
  message: string | null;
  onApply: (swaps: { remove: string; add: string }[]) => void;
}

export default function OperationLoadout({
  run,
  catalog,
  allowance,
  busy,
  message,
  onApply,
}: OperationLoadoutProps) {
  const [swaps, setSwaps] = useState<Record<string, string>>({});
  const offered = run.operation.available_defenses;
  const offeredSet = useMemo(() => new Set(offered), [offered]);
  const chosen = Object.values(swaps).filter(Boolean);
  const activeCount = chosen.length;

  const setSwap = (remove: string, add: string) => {
    setSwaps((current) => {
      const next = { ...current };
      if (!add) {
        delete next[remove];
      } else {
        next[remove] = add;
      }
      return next;
    });
  };

  const apply = () => {
    onApply(
      Object.entries(swaps)
        .filter(([, add]) => Boolean(add))
        .map(([remove, add]) => ({ remove, add })),
    );
  };

  return (
    <section className="cyber-op-panel cyber-op-loadout" aria-labelledby="op-loadout-title">
      <h2 id="op-loadout-title">Engineering Lab</h2>
      <p className="cyber-op-hint">
        Swap up to {allowance} offered control{allowance === 1 ? "" : "s"} before
        you deploy. The default loadout is always valid.
      </p>
      <ul className="cyber-op-loadout-list">
        {offered.map((defenseId) => {
          const current = swaps[defenseId] ?? "";
          const atCap = activeCount >= allowance && !current;
          const alternatives = catalog.defenses.filter(
            (defense) =>
              defense.id !== defenseId &&
              !offeredSet.has(defense.id) &&
              !chosen.includes(defense.id),
          );
          return (
            <li key={defenseId}>
              <span className="cyber-op-loadout-name">
                {catalog.defensesById[defenseId]?.name ?? defenseId}
              </span>
              <select
                aria-label={`Replace ${catalog.defensesById[defenseId]?.name ?? defenseId}`}
                value={current}
                disabled={busy || atCap}
                onChange={(event) => setSwap(defenseId, event.target.value)}
              >
                <option value="">Keep</option>
                {alternatives.map((defense) => (
                  <option key={defense.id} value={defense.id}>
                    {defense.name}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      <div className="cyber-op-loadout-actions">
        <button
          type="button"
          className="cyber-secondary-button"
          onClick={apply}
          disabled={busy || activeCount === 0}
        >
          {busy ? "Applying…" : "Apply loadout"}
        </button>
        {message ? <span className="cyber-notice">{message}</span> : null}
      </div>
    </section>
  );
}
