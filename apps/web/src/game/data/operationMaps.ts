import type { MissionMap } from "../models/map";

/**
 * Architecture maps available to Operations.
 *
 * Map ids mirror `crates/domain/src/cyber_operation.rs`. The shapes match the
 * Stage 1 campaign maps so the same renderer and pathing work unchanged.
 */
export const OPERATION_MAPS: Record<string, MissionMap> = {
  "edge-basic": {
    entryNodeId: "internet",
    nodes: [
      { id: "internet", type: "edge", label: "Internet" },
      { id: "edge", type: "edge", label: "Edge" },
      { id: "api", type: "api", label: "API" },
    ],
    edges: [
      { from: "internet", to: "edge" },
      { from: "edge", to: "api" },
    ],
  },
  "web-stack": {
    entryNodeId: "internet",
    nodes: [
      { id: "internet", type: "edge", label: "Internet" },
      { id: "api", type: "api", label: "API" },
      { id: "app", type: "application", label: "Application" },
      { id: "db", type: "database", label: "Database" },
    ],
    edges: [
      { from: "internet", to: "api" },
      { from: "api", to: "app" },
      { from: "app", to: "db" },
    ],
  },
  "identity-stack": {
    entryNodeId: "internet",
    nodes: [
      { id: "internet", type: "edge", label: "Internet" },
      { id: "api", type: "api", label: "API" },
      { id: "auth", type: "auth", label: "Identity" },
      { id: "app", type: "application", label: "Application" },
    ],
    edges: [
      { from: "internet", to: "api" },
      { from: "api", to: "auth" },
      { from: "auth", to: "app" },
    ],
  },
  "full-stack": {
    entryNodeId: "internet",
    nodes: [
      { id: "internet", type: "edge", label: "Internet" },
      { id: "edge", type: "edge", label: "Edge" },
      { id: "api", type: "api", label: "API" },
      { id: "auth", type: "auth", label: "Identity" },
      { id: "app", type: "application", label: "Application" },
      { id: "db", type: "database", label: "Database" },
    ],
    edges: [
      { from: "internet", to: "edge" },
      { from: "edge", to: "api" },
      { from: "api", to: "auth" },
      { from: "auth", to: "app" },
      { from: "app", to: "db" },
    ],
  },
  "deep-stack": {
    entryNodeId: "internet",
    nodes: [
      { id: "internet", type: "edge", label: "Internet" },
      { id: "edge", type: "edge", label: "Edge" },
      { id: "api", type: "api", label: "API" },
      { id: "app", type: "application", label: "Application" },
      { id: "db", type: "database", label: "Database" },
    ],
    edges: [
      { from: "internet", to: "edge" },
      { from: "edge", to: "api" },
      { from: "api", to: "app" },
      { from: "app", to: "db" },
    ],
  },
};

/** Fallback map if the server ever sends an unknown id. */
export const DEFAULT_OPERATION_MAP: MissionMap = OPERATION_MAPS["full-stack"];
