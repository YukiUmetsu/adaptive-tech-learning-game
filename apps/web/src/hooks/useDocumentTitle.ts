import { useEffect } from "react";

/** Base document title used when a page does not set its own. */
export const BASE_DOCUMENT_TITLE = "Adaptive Learning";

/**
 * Sets `document.title` for the lifetime of the component.
 *
 * Pages call this so the browser tab reflects the current view. The base title
 * is restored on unmount.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = BASE_DOCUMENT_TITLE;
    };
  }, [title]);
}
