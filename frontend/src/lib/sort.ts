// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import type { Entry } from "./s3.ts";

export type SortColumn = "name" | "size" | "modified" | "storageClass";
export type SortDirection = "asc" | "desc";

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortState = { column: "name", direction: "asc" };

/** Byte-order comparison, matching S3's own lexicographic (UTF-8) ordering. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareBy(a: Entry, b: Entry, column: SortColumn): number {
  switch (column) {
    case "size": {
      const aSize = a.kind === "file" ? a.size : -1;
      const bSize = b.kind === "file" ? b.size : -1;
      return aSize - bSize;
    }
    case "modified": {
      const aTime = a.kind === "file" ? a.lastModified.getTime() : -1;
      const bTime = b.kind === "file" ? b.lastModified.getTime() : -1;
      const aSafe = Number.isNaN(aTime) ? -1 : aTime;
      const bSafe = Number.isNaN(bTime) ? -1 : bTime;
      return aSafe - bSafe;
    }
    case "storageClass": {
      const aClass = a.kind === "file" ? a.storageClass : "";
      const bClass = b.kind === "file" ? b.storageClass : "";
      return compareKeys(aClass, bClass);
    }
    case "name":
      return compareKeys(a.key, b.key);
  }
}

/**
 * Orders a listing for display.
 *
 * Folders are grouped above files only when the listing is a single complete
 * page. Once S3 truncates the response the order is strictly lexicographic,
 * because a page's contents are not the next objects of the previous page (S3
 * returns all common prefixes first), so grouping per page would look
 * arbitrary. This mirrors the pre-rebuild `get_display_order()` behavior and
 * the reasoning documented in the project README's FAQ.
 *
 * An explicit non-default sort (the user clicking a column header) always
 * applies to the current page, truncated or not.
 */
export function sortEntries(
  entries: readonly Entry[],
  sort: SortState,
  isTruncated: boolean,
): Entry[] {
  const sorted = [...entries];
  const isDefaultSort = sort.column === DEFAULT_SORT.column && sort.direction === DEFAULT_SORT.direction;
  const groupFolders = !isTruncated || !isDefaultSort;
  const factor = sort.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    if (groupFolders && a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }
    const primary = compareBy(a, b, sort.column) * factor;
    // Stable, predictable tiebreak so equal sizes/dates don't shuffle.
    return primary !== 0 ? primary : compareKeys(a.key, b.key);
  });

  return sorted;
}

/** Case-insensitive substring filter on the displayed entry name. */
export function filterEntries(entries: readonly Entry[], query: string): Entry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
}
