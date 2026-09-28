import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";

import CoreArt from "../game/components/art/CoreArt";
import EnemyArt from "../game/components/art/EnemyArt";
import HackerArt from "../game/components/art/HackerArt";
import { STORY_NODES } from "../game/data/story";
import type { StoryNodeDefinition } from "../game/models/story";
import { acknowledgeStoryNodes } from "../game/persistence/storyAck";
import { trackCyberEvent } from "../game/state/cyberTelemetry";
import {
  refreshCyberProfile,
  useCyberProfile,
  useCyberProfileLoading,
} from "../game/state/cyberProfile";

interface ChapterGroup {
  chapterId: string;
  chapterTitle: string;
  nodes: StoryNodeDefinition[];
}

/** Groups story nodes by chapter, preserving the authored order. */
function groupByChapter(nodes: StoryNodeDefinition[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  const byId = new Map<string, ChapterGroup>();

  for (const node of nodes) {
    let group = byId.get(node.chapterId);
    if (!group) {
      group = {
        chapterId: node.chapterId,
        chapterTitle: node.chapterTitle,
        nodes: [],
      };
      byId.set(node.chapterId, group);
      groups.push(group);
    }
    group.nodes.push(node);
  }

  return groups;
}

/** A distinct enemy/threat glyph for each chapter. */
function ChapterGlyph({ chapterId }: { chapterId: string }) {
  switch (chapterId) {
    case "chapter-1":
      return (
        <svg viewBox="-40 -40 80 80">
          <CoreArt integrity={1} />
        </svg>
      );
    case "chapter-2":
      return (
        <svg viewBox="-26 -26 52 52">
          <HackerArt />
        </svg>
      );
    case "chapter-3":
      return (
        <svg viewBox="-16 -16 32 32">
          <EnemyArt attackType="sql_injection" />
        </svg>
      );
    case "chapter-4":
      return (
        <svg viewBox="-16 -16 32 32">
          <EnemyArt attackType="ransomware" />
        </svg>
      );
    case "chapter-5":
      return (
        <svg viewBox="-22 -22 44 44">
          <EnemyArt attackType="ddos" boss />
        </svg>
      );
    default:
      return null;
  }
}

function LockGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11 V8 a4 4 0 0 1 8 0 v3" />
    </svg>
  );
}

function BookGlyph() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 5 a2 2 0 0 1 2-2 h12 v18 H6 a2 2 0 0 1-2-2 Z" />
      <path d="M8 3 v18" />
    </svg>
  );
}

/**
 * Story archive page (Stage2.md step 16).
 *
 * A chapter timeline: completed beats read as unlocked cards, current chapters
 * glow, and future beats are greyed out and never render their body text in the
 * DOM, so nothing is spoiled ahead of time.
 */
export default function CyberDefenseStoryPage() {
  const profile = useCyberProfile();
  const loading = useCyberProfileLoading();

  useEffect(() => {
    void refreshCyberProfile();
  }, []);

  const chapters = useMemo(() => groupByChapter(STORY_NODES), []);
  const completedNodes = profile?.story.completed_nodes ?? [];
  const activeChapter = profile?.story.active_chapter ?? null;

  // Viewing the archive counts as reading: acknowledge completed nodes so the
  // dashboard stops offering an unseen story beat.
  const completedKey = completedNodes.join(",");
  useEffect(() => {
    if (completedKey.length > 0) {
      const ids = completedKey.split(",");
      acknowledgeStoryNodes(ids);
      for (const nodeId of ids) {
        trackCyberEvent("cyber_story_seen", { result: nodeId });
      }
    }
  }, [completedKey]);

  const totalNodes = STORY_NODES.length;
  const completedCount = completedNodes.length;

  return (
    <section className="cyber-story" aria-labelledby="cyber-story-title">
      <header className="cyber-page-head">
        <div>
          <p className="home-eyebrow">Cyber Defense</p>
          <h1 id="cyber-story-title">Story Archive</h1>
        </div>
        <ul className="cyber-page-chips">
          <li title="Story beats unlocked">
            <span className="cyber-page-chip-icon" aria-hidden="true">
              <BookGlyph />
            </span>
            <span className="cyber-page-chip-value">
              {completedCount} / {totalNodes}
            </span>
          </li>
        </ul>
      </header>

      <p className="cyber-home-lede">
        The campaign so far. Story is optional — skipped scenes count as read and
        stay available here.
      </p>

      {profile === null && loading ? (
        <p className="muted">Loading story…</p>
      ) : null}

      <div className="cyber-story-chapters">
        {chapters.map((chapter, index) => {
          const isActive = activeChapter === chapter.chapterId;
          const headingId = `story-${chapter.chapterId}`;
          const chapterComplete =
            chapter.nodes.length > 0 &&
            chapter.nodes.every((node) => completedNodes.includes(node.id));
          const status = chapterComplete
            ? "complete"
            : isActive
              ? "current"
              : "locked";

          return (
            <section
              key={chapter.chapterId}
              className={`cyber-chapter is-${status}`}
              aria-labelledby={headingId}
            >
              <span className="cyber-chapter-rail" aria-hidden="true">
                <span className="cyber-chapter-badge">
                  {chapterComplete ? "✓" : index + 1}
                </span>
              </span>

              <div className="cyber-chapter-body">
                <div className="cyber-chapter-head">
                  <span className="cyber-chapter-art" aria-hidden="true">
                    <ChapterGlyph chapterId={chapter.chapterId} />
                  </span>
                  <div className="cyber-chapter-title">
                    <h2 id={headingId}>{chapter.chapterTitle}</h2>
                    <p className="cyber-chapter-status">
                      {status === "complete"
                        ? "Complete"
                        : status === "current"
                          ? "Current chapter"
                          : "Locked"}
                    </p>
                    {isActive ? (
                      <p className="cyber-chapter-here">You are here</p>
                    ) : null}
                  </div>
                </div>

                <ul className="cyber-story-nodes">
                  {chapter.nodes.map((node) => {
                    const complete = completedNodes.includes(node.id);
                    return (
                      <li
                        key={node.id}
                        className={`cyber-story-node${
                          complete ? " is-complete" : " is-locked"
                        }`}
                      >
                        <div className="cyber-story-node-head">
                          <span className="cyber-story-node-mark" aria-hidden="true">
                            {complete ? "✓" : <LockGlyph />}
                          </span>
                          <h3>{node.title}</h3>
                        </div>
                        {complete ? (
                          <div className="cyber-story-node-body">
                            {node.body.map((paragraph, bodyIndex) => (
                              <p key={bodyIndex}>{paragraph}</p>
                            ))}
                          </div>
                        ) : (
                          <p className="cyber-story-node-locked">
                            <span className="sr-only">Locked story node. </span>
                            Locked — reach this point in the campaign to read it.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })}
      </div>

      <div className="cyber-story-footer">
        <Link className="cyber-secondary-button" to="/game">
          Back to dashboard
        </Link>
      </div>
    </section>
  );
}
