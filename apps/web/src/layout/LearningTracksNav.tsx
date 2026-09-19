import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { useCatalog } from "../hooks/useCatalog";
import { CATALOG, selectTrackGroups } from "../state/catalogMeta";

/**
 * How long the menu stays open after the pointer leaves before closing.
 *
 * A short delay lets the pointer travel from the trigger into the dropdown
 * (including a slight diagonal) without the menu flickering shut.
 */
const CLOSE_DELAY_MS = 120;

/**
 * "Learning Tracks" nav item with a hover/focus dropdown of available tracks.
 *
 * Track data comes from the same catalog join as the Learning Tracks page, so
 * the two never drift. The parent link always navigates to the tracks page; the
 * dropdown is a convenience for jumping straight to a track.
 *
 * Hover is mouse-only (touch taps navigate instead), and the parent link stays
 * usable while the catalog is loading or unavailable.
 */
export default function LearningTracksNav() {
  const { state } = useCatalog();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const closeTimer = useRef<number | null>(null);
  // Bumped when ArrowDown should move focus into the menu once it is mounted.
  const [focusRequest, setFocusRequest] = useState(0);

  const groups =
    state.status === "loaded"
      ? selectTrackGroups(CATALOG, state.data.certifications)
      : [];
  const hasMenu = groups.length > 0;

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);

  // Clear any pending timer when the component unmounts.
  useEffect(() => cancelClose, [cancelClose]);

  // A track click or any other navigation closes the menu.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Move focus into the menu after an ArrowDown, once items exist. The counter
  // makes this run even when the menu was already open (for example opened by
  // hover or focus first).
  useEffect(() => {
    if (focusRequest > 0 && open) {
      firstItemRef.current?.focus();
    }
  }, [focusRequest, open]);

  // Touch and pen do not hover; a tap should follow the parent link instead of
  // opening the menu. Mouse (and synthetic events with no pointer type) hover.
  const isHoverPointer = (pointerType: string) =>
    pointerType !== "touch" && pointerType !== "pen";

  const handlePointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!hasMenu || !isHoverPointer(event.pointerType)) {
      return;
    }
    cancelClose();
    setOpen(true);
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isHoverPointer(event.pointerType)) {
      return;
    }
    scheduleClose();
  };

  const handleFocus = () => {
    if (hasMenu) {
      cancelClose();
      setOpen(true);
    }
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!wrapperRef.current?.contains(event.relatedTarget as Node | null)) {
      cancelClose();
      setOpen(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      cancelClose();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === "ArrowDown" && hasMenu) {
      event.preventDefault();
      cancelClose();
      setOpen(true);
      setFocusRequest((count) => count + 1);
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="nav-tracks"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <NavLink
        ref={triggerRef}
        to="/tracks"
        className="nav-tracks-trigger"
        aria-haspopup={hasMenu ? "true" : undefined}
        aria-expanded={hasMenu ? open : undefined}
      >
        Learning Tracks
        {hasMenu ? (
          <span className="nav-tracks-caret" aria-hidden="true">
            ▾
          </span>
        ) : null}
      </NavLink>

      {open && hasMenu ? (
        <div className="nav-tracks-menu">
          <nav className="nav-tracks-panel" aria-label="Learning tracks">
            {groups.map((group) => (
              <div className="nav-tracks-group" key={group.id}>
                <p className="nav-tracks-group-label">{group.label}</p>
                <ul>
                  {group.tracks.map((track, index) => (
                    <li key={track.id}>
                      <NavLink
                        ref={
                          group.id === groups[0].id && index === 0
                            ? firstItemRef
                            : undefined
                        }
                        to={`/tracks/${track.id}`}
                        className="nav-tracks-link"
                        onClick={() => setOpen(false)}
                      >
                        <span className="nav-tracks-name">{track.shortName}</span>
                        {track.certification ? (
                          <span className="nav-tracks-meta">
                            {track.examCode}
                          </span>
                        ) : null}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
