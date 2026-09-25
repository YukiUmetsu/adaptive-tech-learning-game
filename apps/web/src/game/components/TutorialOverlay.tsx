import { useEffect, useState, type ReactNode } from "react";

import { BoltIcon, CoinIcon, PlayIcon, ShieldIcon } from "./art/Icons";

/**
 * First-run how-to-play popup.
 *
 * Short, skippable, and re-openable from the HUD "?" button. Replaces the
 * inline instruction text that used to sit permanently in the shop.
 */
export interface TutorialOverlayProps {
  onClose: () => void;
}

interface TutorialStep {
  icon: ReactNode;
  title: string;
  body: string;
}

const STEPS: TutorialStep[] = [
  {
    icon: <ShieldIcon size={44} />,
    title: "Defend the core",
    body: "Attacks travel along the road toward your core. Every hit costs system integrity — lose it all and the mission fails.",
  },
  {
    icon: <PlayIcon size={44} />,
    title: "Build on the pads",
    body: "Tap a tower pad beside the road, choose a control, and deploy it. Each control only fits certain spots, so placement matters.",
  },
  {
    icon: <BoltIcon size={44} />,
    title: "Upgrade and adapt",
    body: "Upgrade towers, call the next wave early for bonus credits, and fire a hero ability when things get rough.",
  },
  {
    icon: <CoinIcon size={44} />,
    title: "Learn as you play",
    body: "Every control maps to a real security defense. After each mission, a short postmortem explains what worked and why.",
  },
];

export default function TutorialOverlay({ onClose }: TutorialOverlayProps) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="cyber-tutorial"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cyber-tutorial-title"
    >
      <div className="cyber-tutorial-card">
        <div className="cyber-tutorial-art" aria-hidden="true">
          {step.icon}
        </div>
        <h2 id="cyber-tutorial-title">{step.title}</h2>
        <p>{step.body}</p>

        <div className="cyber-tutorial-dots" aria-hidden="true">
          {STEPS.map((_, dotIndex) => (
            <span
              key={dotIndex}
              className={`cyber-tutorial-dot${
                dotIndex === index ? " is-active" : ""
              }`}
            />
          ))}
        </div>

        <div className="cyber-tutorial-actions">
          <button
            type="button"
            className="cyber-secondary-button"
            onClick={onClose}
          >
            Skip
          </button>
          <button
            type="button"
            className="cyber-primary-button"
            onClick={() => (last ? onClose() : setIndex((value) => value + 1))}
          >
            {last ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
