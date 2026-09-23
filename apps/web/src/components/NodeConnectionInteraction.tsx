import { useLayoutEffect, useRef, useState } from "react";

import type { GraphNode } from "../api/types";
import { useMediaQuery } from "../hooks/useMediaQuery";
import DesktopNodeConnection from "./DesktopNodeConnection";
import MobileNodeConnection from "./MobileNodeConnection";

interface NodeConnectionInteractionProps {
  nodes: GraphNode[];
  value: string[][];
  disabled?: boolean;
  onChange: (next: string[][]) => void;
  /**
   * Optional mobile-only starting source supplied by the question. Desktop
   * ignores it; the wide graph stays unchanged.
   */
  startNodeId?: string;
}

/**
 * Width at or below which the connection puzzle uses the tap-based mobile
 * builder instead of the positioned node graph.
 */
export const CONNECTION_MOBILE_MAX_WIDTH = 768;

/** Media-query fallback used before the panel has been measured. */
export const CONNECTION_MOBILE_QUERY = `(max-width: ${
  CONNECTION_MOBILE_MAX_WIDTH - 1
}px)`;

/**
 * Connect nodes with directed relationships.
 *
 * The answer (`string[][]` of `[from, to]`) and all scoring/submission behavior
 * are shared. Only the presentation is responsive: a wide panel keeps the
 * positioned graph with connection lines, while a narrow panel uses a
 * one-decision-at-a-time tap builder with no SVG lines.
 *
 * The layout follows the measured panel width rather than device identity,
 * because the question panel can be narrow inside a wider window. It falls back
 * to a media query before the first measurement (SSR, jsdom) and when the width
 * is unavailable, so the desktop graph remains the safe default.
 */
export default function NodeConnectionInteraction({
  nodes,
  value,
  disabled = false,
  onChange,
  startNodeId,
}: NodeConnectionInteractionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const narrowByMedia = useMediaQuery(CONNECTION_MOBILE_QUERY);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const update = () => setContainerWidth(element.clientWidth);
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A measured width always wins; `0` means "not measured yet", so use the
  // media query as a best-effort fallback rather than dropping to mobile.
  const isMobile =
    containerWidth > 0
      ? containerWidth < CONNECTION_MOBILE_MAX_WIDTH
      : narrowByMedia;

  return (
    <div className="connection" ref={containerRef}>
      {isMobile ? (
        <MobileNodeConnection
          nodes={nodes}
          value={value}
          disabled={disabled}
          onChange={onChange}
          startNodeId={startNodeId}
        />
      ) : (
        <DesktopNodeConnection
          nodes={nodes}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      )}
    </div>
  );
}
