// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useCallback, useEffect, useState } from "react";

export interface BrowseLocation {
  /** Current S3 prefix ("" at the bucket root). */
  prefix: string;
  /** `StartAfter` key for paginated listings, or "" on the first page. */
  startAfter: string;
}

/**
 * Reads the browse location from the query string. The parameter names `p` and
 * `s` are unchanged from the pre-rebuild app so existing links keep working.
 */
export function readLocation(search: string): BrowseLocation {
  const params = new URLSearchParams(search);
  return {
    prefix: params.get("p") ?? "",
    startAfter: params.get("s") ?? "",
  };
}

export function locationToSearch({ prefix, startAfter }: BrowseLocation): string {
  const params = new URLSearchParams();
  if (prefix) params.set("p", prefix);
  if (startAfter) params.set("s", startAfter);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Keeps the browse location in sync with the URL, using `history.pushState` for
 * in-page navigation and listening for `popstate` so Back/Forward work.
 */
export function useBrowserLocation(): {
  location: BrowseLocation;
  navigate: (next: BrowseLocation) => void;
} {
  const [location, setLocation] = useState<BrowseLocation>(() =>
    readLocation(window.location.search),
  );

  useEffect(() => {
    const onPopState = () => setLocation(readLocation(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: BrowseLocation) => {
    const search = locationToSearch(next);
    if (search !== window.location.search) {
      window.history.pushState(null, "", `/${search}`);
    }
    setLocation(next);
  }, []);

  return { location, navigate };
}
