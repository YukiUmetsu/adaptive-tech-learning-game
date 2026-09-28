/**
 * Story progression model.
 *
 * Story is short, skippable, and never blocks gameplay. The server owns the
 * authoritative completed-node set; this client data provides the readable
 * text for nodes the server reports as complete. See Stage2.md step 16.
 */

export type StoryTriggerKind =
  | "campaign_mission_completed"
  | "operations_completed"
  | "adversary_rank_reached"
  | "threat_level_cleared"
  | "story_node_completed";

export interface StoryNodeDefinition {
  id: string;
  chapterId: string;
  chapterTitle: string;
  title: string;
  /** Two to four short paragraphs. */
  body: string[];
  /** Optional earlier node required first. */
  requires?: string;
}

/** Finds the next unseen story node given completed ids. */
export function nextUnseenStoryNode(
  nodes: StoryNodeDefinition[],
  completedNodeIds: string[],
): StoryNodeDefinition | null {
  for (const node of nodes) {
    if (completedNodeIds.includes(node.id)) {
      continue;
    }
    if (node.requires && !completedNodeIds.includes(node.requires)) {
      continue;
    }
    return node;
  }
  return null;
}
