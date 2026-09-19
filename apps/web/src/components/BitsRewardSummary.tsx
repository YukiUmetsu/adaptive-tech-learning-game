import { useCountUp } from "../hooks/useCountUp";
import BitsIcon from "./BitsIcon";

interface BitsRewardSummaryProps {
  /** Bits earned in this run. */
  earned: number;
  /** Current wallet balance after reconciliation. */
  total: number;
  /** Whether the count-up should play (first view of a completed mission only). */
  animate: boolean;
}

interface BitsAmountProps {
  earned: number;
  total: number;
}

function BitsAmount({ earned, total }: BitsAmountProps) {
  const displayed = useCountUp(earned, { enabled: true });

  return (
    <>
      <p className="bits-earned" data-testid="bits-earned">
        <span className="bits-plus">+</span>
        {displayed}
        <span className="bits-unit"> Bits</span>
      </p>
      <p className="bits-total" data-testid="bits-total">
        <BitsIcon className="bits-total-icon" /> {total.toLocaleString()} total
      </p>
    </>
  );
}

function StaticAmount({ earned, total }: BitsAmountProps) {
  return (
    <>
      <p className="bits-earned" data-testid="bits-earned">
        <span className="bits-plus">+</span>
        {earned}
        <span className="bits-unit"> Bits</span>
      </p>
      <p className="bits-total" data-testid="bits-total">
        <BitsIcon className="bits-total-icon" /> {total.toLocaleString()} total
      </p>
    </>
  );
}

/**
 * The largest reward element on the completion screen.
 *
 * Bits count up from zero on the first view; on later views the final amount is
 * shown directly so the animation never replays.
 */
export default function BitsRewardSummary({
  earned,
  total,
  animate,
}: BitsRewardSummaryProps) {
  return (
    <section
      className="bits-reward-summary"
      aria-label={`Earned ${earned} Bits, ${total} total`}
    >
      {animate ? (
        <BitsAmount earned={earned} total={total} />
      ) : (
        <StaticAmount earned={earned} total={total} />
      )}
    </section>
  );
}
