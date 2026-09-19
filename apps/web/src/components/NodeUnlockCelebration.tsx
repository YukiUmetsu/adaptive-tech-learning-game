import { useEffect } from "react";

interface NodeUnlockCelebrationProps {
  nodeTitle: string;
  reducedMotion: boolean;
  onDone: () => void;
}

/**
 * Short, non-blocking celebration when a knowledge node unlocks.
 *
 * It is a live region rather than a modal, so the learner can keep navigating
 * while it plays.
 */
export default function NodeUnlockCelebration({
  nodeTitle,
  reducedMotion,
  onDone,
}: NodeUnlockCelebrationProps) {
  useEffect(() => {
    const timeout = window.setTimeout(onDone, reducedMotion ? 1400 : 900);
    return () => window.clearTimeout(timeout);
  }, [onDone, reducedMotion]);

  return (
    <div
      className={`node-unlock-celebration${
        reducedMotion ? "" : " node-unlock-celebration--animated"
      }`}
      role="status"
      aria-live="polite"
    >
      <p className="node-unlock-title">✨ UNLOCKED! ✨</p>
      <p className="node-unlock-node">{nodeTitle}</p>
    </div>
  );
}
