import { api } from "../api/client";
import type { DomainDiscoveryInput } from "../api/types";
import {
  loadPendingAuxiliary,
  loadPendingDiscovery,
  markAuxiliarySynced,
  markDiscoverySynced,
  type PendingAuxiliaryEvent,
  type PendingDiscoveryUpdate,
} from "./auxiliaryQueue";
import { getDeviceId } from "./persistence";

function toDiscoveryUpdate(entry: PendingDiscoveryUpdate) {
  return {
    track_version: entry.trackVersion,
    content_version: entry.contentVersion,
    domains: entry.domains,
  };
}

function toAuxiliaryEvent(entry: PendingAuxiliaryEvent) {
  return {
    event_id: entry.eventId,
    track_id: entry.trackId,
    recommendation_id: entry.recommendationId,
    event: entry.event,
    action: entry.action,
    domain_id: entry.domainId,
    node_id: entry.nodeId,
    question_id: entry.questionId,
  };
}

/**
 * Flushes pending discovery and telemetry in one `/v1/sync` request.
 *
 * This is called only at natural boundaries (dashboard open, mission sync,
 * Daily Mission transitions, returning online); there is no polling timer. The
 * request carries no learning events, and only sections the server accepted are
 * removed from the queue, so a partial failure retries just the failed work.
 * Every failure is swallowed: auxiliary work is never allowed to block study.
 */
export async function flushAuxiliary(): Promise<void> {
  const discovery = loadPendingDiscovery();
  const auxiliary = loadPendingAuxiliary();
  if (discovery.length === 0 && auxiliary.length === 0) {
    return;
  }

  try {
    const result = await api.POST("/v1/sync", {
      body: {
        device_id: getDeviceId(),
        events: [],
        discovery_updates: discovery.map(toDiscoveryUpdate),
        auxiliary_events: auxiliary.map(toAuxiliaryEvent),
      },
    });
    if (result.error || !result.data) {
      return;
    }
    if (result.data.discovery?.accepted) {
      markDiscoverySynced(discovery.map((entry) => entry.trackVersion));
    }
    if (result.data.auxiliary?.accepted) {
      markAuxiliarySynced(auxiliary.map((entry) => entry.id));
    }
  } catch {
    // Keep the queue for the next boundary.
  }
}

/**
 * Loads server-persisted discovery for a track.
 *
 * Best-effort: any failure returns `null` and the caller keeps using local
 * progress. This is an enhancement, never a prerequisite for rendering.
 */
export async function loadServerDiscovery(
  trackId: string,
): Promise<DomainDiscoveryInput[] | null> {
  try {
    const result = await api.GET("/v1/tracks/{track_id}/discovery", {
      params: { path: { track_id: trackId } },
    });
    if (result.error || !result.data) {
      return null;
    }
    return result.data.domains ?? [];
  } catch {
    return null;
  }
}
