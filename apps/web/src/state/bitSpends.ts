import { api } from "../api/client";
import {
  getPendingBitSpends,
  refundBits,
  refreshWallet,
  settleSpend,
} from "./wallet";

/**
 * Settles queued Bits spends against the server.
 *
 * Spends are recorded locally the moment an upgrade is bought so gameplay never
 * waits on the network. This flushes that queue to
 * `POST /v1/cyber-defense/upgrades`, which is idempotent by `event_id`, so a
 * retry after a dropped response cannot debit twice.
 *
 * Outcomes:
 * - `settled`   — every queued spend was confirmed and the balance adopted.
 * - `insufficient` — the server refused a spend; it is dropped and the
 *   authoritative balance is fetched so the client cannot spend Bits it does not
 *   have.
 * - `unauthorized` — no account is attached; spending is account-scoped, so the
 *   optimistic debit is dropped (nothing is persisted).
 * - `empty`     — nothing was queued.
 * - `offline`   — a transient failure; the queue is retained for a later retry.
 */
export type FlushBitSpendsResult =
  | "empty"
  | "settled"
  | "insufficient"
  | "unauthorized"
  | "offline";

let inFlight: Promise<FlushBitSpendsResult> | null = null;

/** Flushes queued spends, sharing one request run across concurrent callers. */
export function flushBitSpends(): Promise<FlushBitSpendsResult> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<FlushBitSpendsResult> {
  let result: FlushBitSpendsResult = "empty";
  // A spend can be queued while a request is in flight (for example a second
  // upgrade bought during the first flush). Track what this run already handled
  // and re-read the queue until no new spend remains, so nothing is stranded
  // until an unrelated trigger.
  const handled = new Set<string>();

  for (;;) {
    const pending = getPendingBitSpends().filter(
      (spend) => !handled.has(spend.eventId),
    );
    if (pending.length === 0) {
      break;
    }

    let halted = false;
    for (const spend of pending) {
      handled.add(spend.eventId);
      let status: number;
      try {
        const response = await api.POST("/v1/cyber-defense/upgrades", {
          body: {
            event_id: spend.eventId,
            run_id: spend.runId,
            defense_id: spend.defenseId,
            from_level: spend.fromLevel,
          },
        });
        if (response.data) {
          settleSpend(spend.eventId, response.data.bits_balance);
          result = "settled";
          continue;
        }
        status = response.response.status;
      } catch {
        // Network failure: keep the spend queued for the next flush.
        result = "offline";
        halted = true;
        break;
      }

      if (status === 409) {
        refundBits(spend.eventId);
        result = "insufficient";
        continue;
      }
      if (status === 401 || status === 403) {
        refundBits(spend.eventId);
        result = "unauthorized";
        continue;
      }
      // A malformed request or a server fault will never settle on retry's own
      // schedule; stop and leave the rest queued.
      result = "offline";
      halted = true;
      break;
    }

    if (halted) {
      break;
    }
  }

  if (result === "insufficient" || result === "unauthorized") {
    // Adopt the authoritative balance now that the optimistic debits are gone.
    await refreshWallet();
  }
  return result;
}
