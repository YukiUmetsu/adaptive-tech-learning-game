import { useState, type ReactNode } from "react";

import { useAuth } from "../auth/context";
import { useSignOut } from "../hooks/useSignOut";
import {
  BREAK_AFTER_OPTIONS,
  BREAK_DURATION_OPTIONS,
  DAILY_MISSION_MINUTE_OPTIONS,
  IDLE_TIMEOUT_OPTIONS,
  resetPreferences,
  updatePreferences,
  useUserPreferences,
  type AnimationIntensity,
  type StudyBalance,
} from "../state/preferences";
import { setSoundMuted, useSoundMuted } from "../state/sound";

interface ChoiceOption<T> {
  value: T;
  label: string;
}

const MINUTES = (value: number) => `${value} min`;

const STUDY_BALANCE_CHOICES: ChoiceOption<StudyBalance>[] = [
  { value: "balanced", label: "Balanced" },
  { value: "more_practice", label: "More practice" },
  { value: "more_learning", label: "More learning" },
];

const ANIMATION_CHOICES: ChoiceOption<AnimationIntensity>[] = [
  { value: "full", label: "Full" },
  { value: "reduced", label: "Reduced" },
  { value: "minimal", label: "Minimal" },
];

function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="settings-section"
      aria-labelledby={`${id}-heading`}
    >
      <h2 id={`${id}-heading`}>{title}</h2>
      {description ? <p className="muted">{description}</p> : null}
      <div className="settings-fields">{children}</div>
    </section>
  );
}

function SettingsToggle({
  label,
  note,
  checked,
  disabled,
  badge,
  onChange,
}: {
  label: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  badge?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`settings-toggle${disabled ? " settings-toggle--disabled" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="settings-toggle-text">
        <span className="settings-toggle-title">
          {label}
          {badge ? <span className="badge settings-toggle-badge">{badge}</span> : null}
        </span>
        {note ? <span className="muted settings-toggle-note">{note}</span> : null}
      </span>
    </label>
  );
}

function SettingsChoice<T extends string | number>({
  legend,
  name,
  note,
  value,
  options,
  disabled,
  onChange,
}: {
  legend: string;
  name: string;
  note?: string;
  value: T;
  options: ChoiceOption<T>[];
  disabled?: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <fieldset className="settings-choice" disabled={disabled}>
      <legend className="settings-field-label">{legend}</legend>
      {note ? <p className="muted settings-field-note">{note}</p> : null}
      <div className="settings-choice-options">
        {options.map((option) => (
          <label
            key={String(option.value)}
            className={`settings-chip${
              option.value === value ? " settings-chip--active" : ""
            }`}
          >
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Personal Settings V1.
 *
 * Configuration only: these values never affect scoring, concept state,
 * rewards, or Daily Mission completion. Every control persists immediately
 * through the shared preferences store; there is no Save button. Only the
 * destructive reset asks for confirmation.
 */
export default function SettingsPage() {
  const preferences = useUserPreferences();
  const { user } = useAuth();
  const signOut = useSignOut();
  const muted = useSoundMuted();
  const [confirmingReset, setConfirmingReset] = useState(false);

  const { study, focus, audio, accessibility, gamification } = preferences;

  return (
    <section className="settings-page">
      <header className="settings-head">
        <h1>Settings</h1>
        <p className="muted">
          Personalize how Adaptive Learning works for you. Changes save
          automatically on this device.
        </p>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <a href="#study">Study</a>
          <a href="#focus">Focus &amp; Breaks</a>
          <a href="#audio">Audio &amp; Feedback</a>
          <a href="#accessibility">Accessibility</a>
          <a href="#gamification">Gamification</a>
          <a href="#account">Account</a>
          <a href="#privacy">Privacy &amp; Data</a>
        </nav>

        <div className="settings-content">
          <SettingsSection
            id="study"
            title="Study"
            description="Shape how Daily Missions are planned and how much control you keep between items."
          >
            <SettingsChoice
              legend="Daily Mission target length"
              name="dailyMissionMinutes"
              value={study.dailyMissionMinutes}
              options={DAILY_MISSION_MINUTE_OPTIONS.map((minutes) => ({
                value: minutes,
                label: MINUTES(minutes),
              }))}
              onChange={(dailyMissionMinutes) =>
                updatePreferences({ study: { dailyMissionMinutes } })
              }
            />

            <SettingsChoice
              legend="Study balance"
              name="studyBalance"
              note="Lean toward new material or toward retrieval practice."
              value={study.studyBalance}
              options={STUDY_BALANCE_CHOICES}
              onChange={(studyBalance) =>
                updatePreferences({ study: { studyBalance } })
              }
            />

            <SettingsToggle
              label="Auto-continue Daily Mission items"
              note="Move straight to the next item without an extra confirmation."
              checked={study.autoContinueMissionItems}
              onChange={(autoContinueMissionItems) =>
                updatePreferences({ study: { autoContinueMissionItems } })
              }
            />

            <p className="muted settings-hint">
              These preferences are saved now and will shape Daily Mission
              planning in a coming update.
            </p>
          </SettingsSection>

          <SettingsSection
            id="focus"
            title="Focus & Breaks"
            description="Focus tracking counts active study time, not simply time the page is open."
          >
            <SettingsToggle
              label="Focus tracker"
              note="Shows the floating Focus widget while you study, tracks active time, and gently suggests breaks."
              checked={focus.enabled}
              onChange={(enabled) => updatePreferences({ focus: { enabled } })}
            />

            <SettingsToggle
              label="Automatically detect study"
              note="Start a focus session when you begin studying."
              checked={focus.autoDetectStudy}
              onChange={(autoDetectStudy) =>
                updatePreferences({ focus: { autoDetectStudy } })
              }
            />

            <SettingsToggle
              label="Break reminders"
              note="Suggest a short break after a stretch of focused study."
              checked={focus.breakReminders}
              onChange={(breakReminders) =>
                updatePreferences({ focus: { breakReminders } })
              }
            />

            <SettingsChoice
              legend="Suggest break after"
              name="breakAfterMinutes"
              value={focus.breakAfterMinutes}
              options={BREAK_AFTER_OPTIONS.map((minutes) => ({
                value: minutes,
                label: MINUTES(minutes),
              }))}
              onChange={(breakAfterMinutes) =>
                updatePreferences({ focus: { breakAfterMinutes } })
              }
            />

            <SettingsChoice
              legend="Default break duration"
              name="breakDurationMinutes"
              value={focus.breakDurationMinutes}
              options={BREAK_DURATION_OPTIONS.map((minutes) => ({
                value: minutes,
                label: MINUTES(minutes),
              }))}
              onChange={(breakDurationMinutes) =>
                updatePreferences({ focus: { breakDurationMinutes } })
              }
            />

            <SettingsChoice
              legend="Auto-pause after inactivity"
              name="idleTimeoutMinutes"
              value={focus.idleTimeoutMinutes}
              options={IDLE_TIMEOUT_OPTIONS.map((minutes) => ({
                value: minutes,
                label: MINUTES(minutes),
              }))}
              onChange={(idleTimeoutMinutes) =>
                updatePreferences({ focus: { idleTimeoutMinutes } })
              }
            />
          </SettingsSection>

          <SettingsSection
            id="audio"
            title="Audio & Feedback"
            description="Short synthesized sounds play after answers and rewards."
          >
            <SettingsToggle
              label="Sound effects"
              note="Turn all game sounds on or off."
              checked={!muted}
              onChange={(enabled) => setSoundMuted(!enabled)}
            />

            <SettingsToggle
              label="Answer feedback sounds"
              note="Chimes for correct and incorrect answers."
              checked={audio.answerFeedbackSounds}
              disabled={!audio.enabled}
              onChange={(answerFeedbackSounds) =>
                updatePreferences({ audio: { answerFeedbackSounds } })
              }
            />

            <SettingsToggle
              label="Daily Mission completion sounds"
              note="A short flourish when you finish a mission."
              checked={audio.missionCompletionSounds}
              disabled={!audio.enabled}
              onChange={(missionCompletionSounds) =>
                updatePreferences({ audio: { missionCompletionSounds } })
              }
            />
          </SettingsSection>

          <SettingsSection
            id="accessibility"
            title="Accessibility"
            description="The app always respects your system's reduced-motion setting; these options can reduce motion further."
          >
            <SettingsToggle
              label="Reduced motion"
              note="Prefer static, equally informative states over decorative animation."
              checked={accessibility.reducedMotion}
              onChange={(reducedMotion) =>
                updatePreferences({ accessibility: { reducedMotion } })
              }
            />

            <SettingsChoice
              legend="Animation intensity"
              name="animationIntensity"
              note="Full plays every animation; Reduced and Minimal calm the interface."
              value={accessibility.animationIntensity}
              options={ANIMATION_CHOICES}
              onChange={(animationIntensity) =>
                updatePreferences({ accessibility: { animationIntensity } })
              }
            />
          </SettingsSection>

          <SettingsSection
            id="gamification"
            title="Gamification"
            description="Control the celebratory feedback around progress and rewards."
          >
            <SettingsToggle
              label="Companion reactions"
              note="A study companion is not part of the app yet."
              badge="Coming soon"
              checked={gamification.companionReactions}
              disabled
              onChange={() => {}}
            />

            <SettingsToggle
              label="Reward animations"
              note="Celebration flourishes when you unlock nodes and complete modules."
              checked={gamification.rewardAnimations}
              onChange={(rewardAnimations) =>
                updatePreferences({ gamification: { rewardAnimations } })
              }
            />

            <SettingsToggle
              label="Bits animations"
              note="Bits counting up and flying into your wallet."
              checked={gamification.bitsAnimations}
              onChange={(bitsAnimations) =>
                updatePreferences({ gamification: { bitsAnimations } })
              }
            />
          </SettingsSection>

          <SettingsSection id="account" title="Account">
            <dl className="settings-account">
              <div>
                <dt>Signed in as</dt>
                <dd>{user?.name ?? user?.email ?? "your account"}</dd>
              </div>
              {user?.email ? (
                <div>
                  <dt>Email</dt>
                  <dd>{user.email}</dd>
                </div>
              ) : null}
            </dl>
            <div className="settings-actions">
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </SettingsSection>

          <SettingsSection id="privacy" title="Privacy &amp; Data">
            <ul className="settings-privacy-list">
              <li>
                Learning progress may be stored locally and synced to the server
                according to the existing architecture.
              </li>
              <li>
                Personal Settings V1 are stored locally in this browser only.
              </li>
              <li>
                Upcoming Focus timing data will be treated as productivity data,
                not mastery evidence.
              </li>
            </ul>

            <div className="settings-reset">
              {confirmingReset ? (
                <div
                  className="settings-confirm"
                  role="alert"
                  aria-label="Confirm reset"
                >
                  <p>
                    Reset all Personal Settings to their defaults? This does not
                    affect your learning progress, Daily Missions, Bits, or
                    account.
                  </p>
                  <div className="settings-confirm-actions">
                    <button
                      type="button"
                      className="settings-danger"
                      onClick={() => {
                        resetPreferences();
                        setConfirmingReset(false);
                      }}
                    >
                      Reset preferences
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingReset(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingReset(true)}
                >
                  Reset local preferences
                </button>
              )}
            </div>
          </SettingsSection>
        </div>
      </div>
    </section>
  );
}
