import type { StoryNodeDefinition } from "../models/story";

/**
 * Stage 2 story beats.
 *
 * Ids, chapters, and triggers mirror `crates/domain/src/cyber_story.rs`. The
 * server decides which nodes are complete; this is the readable text.
 */
export const STORY_NODES: StoryNodeDefinition[] = [
  {
    id: "chapter-1-complete",
    chapterId: "chapter-1",
    chapterTitle: "Chapter 1 — First Contact",
    title: "Chapter 1 Complete",
    body: [
      "The botnet is contained and the storefront is stable.",
      "The pattern behind the attacks is bigger than one flood. Repeatable Operations are now unlocked.",
    ],
  },
  {
    id: "chapter-2-ghost7",
    chapterId: "chapter-2",
    chapterTitle: "Chapter 2 — Pattern Recognition",
    title: "A Recurring Signature",
    body: [
      "A recurring signature shows up in the identity logs: GHOST-7.",
      "It rarely forces a door. It waits for a reused credential instead.",
    ],
    requires: "chapter-1-complete",
  },
  {
    id: "chapter-2-clue",
    chapterId: "chapter-2",
    chapterTitle: "Chapter 2 — Pattern Recognition",
    title: "The Quiet Signal",
    body: [
      "GHOST-7 changed tactics. Some of its traffic no longer announces itself.",
      "Detection is no longer optional against this adversary.",
    ],
    requires: "chapter-2-ghost7",
  },
  {
    id: "chapter-3-null",
    chapterId: "chapter-3",
    chapterTitle: "Chapter 3 — Multiple Vectors",
    title: "Coordinated Attacks",
    body: [
      "The attacks are coordinating. While one front distracts you, another probes the application.",
      "NULL specializes in exactly that misdirection.",
    ],
    requires: "chapter-2-ghost7",
  },
  {
    id: "chapter-3-viper",
    chapterId: "chapter-3",
    chapterTitle: "Chapter 3 — Multiple Vectors",
    title: "Impact",
    body: [
      "VIPER does not care about stealth. It wants to encrypt everything it can reach.",
      "Containment and recovery are now part of the same fight.",
    ],
    requires: "chapter-3-null",
  },
  {
    id: "chapter-4-biolab",
    chapterId: "chapter-4",
    chapterTitle: "Chapter 4 — Targeted Research",
    title: "Targeted Research",
    body: [
      "The targeting was never random. A specific research network is being mapped.",
      "Every adversary is a different instrument pointed at the same target.",
    ],
    requires: "chapter-3-null",
  },
  {
    id: "chapter-5-climax",
    chapterId: "chapter-5",
    chapterTitle: "Chapter 5 — Stage 2 Climax",
    title: "The Confrontation",
    body: [
      "GHOST-7 has stopped hiding. This is the operation the last months were building toward.",
      "Hold the line.",
    ],
    requires: "chapter-4-biolab",
  },
  {
    id: "chapter-5-hook",
    chapterId: "chapter-5",
    chapterTitle: "Chapter 5 — Stage 2 Climax",
    title: "Open Thread",
    body: [
      "The immediate threat is over, but the adversary's sponsor was never identified.",
      "The story continues in a later stage.",
    ],
    requires: "chapter-5-climax",
  },
];

export const STORY_NODES_BY_ID: Record<string, StoryNodeDefinition> =
  Object.fromEntries(STORY_NODES.map((node) => [node.id, node]));
