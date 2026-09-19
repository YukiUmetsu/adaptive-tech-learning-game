import { useEffect, useRef, useState } from "react";

import { useBitsBalance, useSettledBits } from "../state/wallet";
import BitsIcon from "./BitsIcon";

interface BitsHudProps {
  /** `sm` is the compact navbar size; `md` is the dashboard size. */
  size?: "sm" | "md";
}

/**
 * Persistent Bits balance shown in the top-right of the app shell.
 *
 * Reads the single shared wallet store, so there is exactly one source of
 * truth. A brief pulse marks an authoritative increase (settlement during
 * sync); optimistic per-answer previews update the number without celebrating
 * money that has not been reconciled yet. The whole element exposes an
 * accessible `"{n} Bits"` label.
 */
export default function BitsHud({ size = "md" }: BitsHudProps) {
  const bits = useBitsBalance();
  const settled = useSettledBits();
  const previousSettled = useRef(settled);
  const firstUpdate = useRef(true);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (firstUpdate.current) {
      firstUpdate.current = false;
      previousSettled.current = settled;
      return;
    }

    if (settled <= previousSettled.current) {
      previousSettled.current = settled;
      return;
    }

    previousSettled.current = settled;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 700);
    return () => clearTimeout(timer);
  }, [settled]);

  return (
    <span
      className={`bits-hud bits-hud-${size}${pulsing ? " bits-hud-pulse" : ""}`}
      aria-label={`${bits.toLocaleString()} Bits`}
      data-testid="bits-hud"
    >
      <BitsIcon className="bits-icon" />
      <span className="bits-amount" data-testid="bits-amount">
        {bits.toLocaleString()}
      </span>
      <span className="bits-label">Bits</span>
    </span>
  );
}
