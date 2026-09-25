/**
 * Architecture map model.
 *
 * Maps are logical graphs only: nodes, node types, and directed edges. Screen
 * coordinates are deliberately absent — the renderer derives a layout from the
 * graph so the same simulation supports desktop (horizontal) and mobile
 * (vertical) presentations. See spec sections 15 and 35.2.
 */

export type NodeType =
  | "edge"
  | "auth"
  | "api"
  | "application"
  | "database"
  | "ai"
  | "tool";

export interface MapNode {
  id: string;
  type: NodeType;
  label: string;
}

export interface MapEdge {
  /** Node the traffic comes from. */
  from: string;
  /** Node the traffic goes to. */
  to: string;
}

export interface MissionMap {
  /** The public entry point where every attack spawns. */
  entryNodeId: string;
  nodes: MapNode[];
  edges: MapEdge[];
}

export function findNode(
  map: MissionMap,
  nodeId: string,
): MapNode | undefined {
  return map.nodes.find((node) => node.id === nodeId);
}

/** Human-readable label for a node type, used in placement explanations. */
export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  edge: "Edge",
  auth: "Identity",
  api: "API",
  application: "Application",
  database: "Database",
  ai: "AI",
  tool: "Tool",
};
