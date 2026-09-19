# Product and Problem Statement

## Problem

Technical certification learners face four recurring problems:

1. They do not know what to study next.
2. They confuse recognition with recall.
3. They forget previously learned material before the exam.
4. Conventional study tools provide weak motivation to return.

Typical course progress ("72% complete") measures content consumed, not knowledge retrievable now.

## Product

A certification-focused learning game that maintains a learner knowledge state and chooses the next useful study mission.

Example:

> **Today's plan — 8 min**  
> Kubernetes networking is fading, IAM is stronger than expected, and your exam is 41 days away.  
> 2 connection puzzles → 1 reconstruction → 1 troubleshooting challenge → mini boss.  
> **Why:** networking has the highest combination of exam weight and forgetting risk.

Actions:

- Start
- Why this plan?
- Show alternatives
- Change one item

## Target user

Initial target:

- Adult technical learners.
- Preparing for cloud, Linux, security, AI, DevOps, or related certifications.
- Learners who benefit from short sessions and visible progress.
- Users who prefer active puzzles over long passive study sessions.

## Initial certification families

- AWS
- Microsoft Azure
- Google Cloud
- Linux Foundation
- Security certifications
- AI/ML certifications

Start with 1-2 certifications. Do not launch a broad catalog before the learning loop is validated.

## Core product requirements

### Goal planning

User provides:

- certification
- target exam date
- available study time
- optional current experience level

System produces:

- diagnostic
- objective-weighted campaign
- daily recommendation
- readiness trend
- explicit reason for plan changes

### Learning interactions

Prefer interactions that produce richer evidence than multiple choice:

| Interaction | Measures |
|---|---|
| Connect nodes | relationship recall |
| Reorder blocks | sequence/procedure recall |
| Memory reconstruction | unaided structural recall |
| Assemble equation | formula recall |
| Drag to categories | classification |
| 2D matrix placement | relative conceptual understanding |
| Troubleshooting | diagnosis/application |
| Boss battle | integrated transfer |

### Feedback

After each interaction:

1. Immediate visual/haptic feedback.
2. One-sentence explanation.
3. Record structured mistake information.
4. Continue without modal interruption.

Learners pick from three quiz modes, not from raw interaction types:

| Mode | Questions | Purpose |
|---|---:|---|
| Quick Quiz | 10 | adaptive cross-domain practice |
| Domain Quiz | ~20 | one exam domain |
| Full Practice | 65 | weighted full-certification coverage |

The interaction types above are the tactile scoring primitives underneath these
modes. Correct answers award **Bits**, a server-authoritative spendable currency
kept separate from mastery.

### Progress

Show both:

- **exam progress:** readiness by objective/concept
- **game progress:** world, buildings, collection, companion

Do not treat XP as proof of mastery.

## Non-goals for V1

- General K-12 education.
- Real-time multiplayer.
- User-generated certification dumps.
- LLM-generated question per request.
- Cash-purchased loot boxes.
- Complex social feeds.
- Full native iOS/Android apps before web retention is validated.

## Success metrics

Primary:

- D1 / D7 / D30 learner retention.
- Study days per active learner.
- Meaningful retrieval minutes per week.
- Calibration of recall predictions.
- Improvement in delayed recall.
- Certification campaign completion.

Guardrails:

- easy-question farming rate
- hint avoidance caused by reward design
- excessive session duration
- reward exploitation / economy inflation
- gacha engagement replacing learning engagement

## Accessibility

Every core interaction must have a non-drag alternative: keyboard/tap selection, reduced motion, no color-only feedback, optional timers, and large touch targets. PWA V1 should not promise consistent iPhone haptics; native packaging can add platform haptic APIs later.
