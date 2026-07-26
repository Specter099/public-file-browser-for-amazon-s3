// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { formatExactBytes, formatRelative, formatSize, formatTimestamp } from "../lib/format.ts";
import { objectUrl, type Entry } from "../lib/s3.ts";
import type { SortColumn, SortState } from "../lib/sort.ts";
import { locationToSearch } from "../lib/useBrowserLocation.ts";
import { FileIcon } from "./FileIcon.tsx";

export interface ListingTableProps {
  entries: readonly Entry[];
  sort: SortState;
  onSortChange: (column: SortColumn) => void;
  onNavigate: (prefix: string) => void;
  parent: string | null;
  filesOpenInNewTab: boolean;
}

const COLUMNS: ReadonlyArray<{
  column: SortColumn;
  label: string;
  /** Hidden on small screens to keep the table readable on phones. */
  responsiveClass: string;
  alignClass: string;
}> = [
  { column: "name", label: "Name", responsiveClass: "", alignClass: "text-left" },
  { column: "size", label: "Size", responsiveClass: "", alignClass: "text-right" },
  { column: "modified", label: "Last modified", responsiveClass: "hidden sm:table-cell", alignClass: "text-right" },
  { column: "storageClass", label: "Storage class", responsiveClass: "hidden lg:table-cell", alignClass: "text-left" },
];

function SortIndicator({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`size-3.5 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`}
    >
      <path d={direction === "asc" && active ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
    </svg>
  );
}

export function ListingTable({
  entries,
  sort,
  onSortChange,
  onNavigate,
  parent,
  filesOpenInNewTab,
}: ListingTableProps) {
  const linkClass =
    "flex items-center gap-2.5 rounded font-medium text-slate-800 hover:text-brand " +
    "hover:underline dark:text-slate-200 dark:hover:text-brand";

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800">
            {COLUMNS.map(({ column, label, responsiveClass, alignClass }) => {
              const active = sort.column === column;
              return (
                <th
                  key={column}
                  scope="col"
                  aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                  className={`${responsiveClass} ${alignClass} px-3 py-2 font-medium`}
                >
                  <button
                    type="button"
                    onClick={() => onSortChange(column)}
                    className={
                      "group inline-flex items-center gap-1 text-xs tracking-wide text-slate-500 " +
                      "uppercase transition-colors hover:text-slate-900 dark:text-slate-400 " +
                      "dark:hover:text-slate-100" +
                      (alignClass === "text-right" ? " flex-row-reverse" : "")
                    }
                  >
                    {label}
                    <SortIndicator active={active} direction={sort.direction} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {parent !== null && (
            <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
              <td className="px-3 py-2" colSpan={COLUMNS.length}>
                <a
                  href={`/${locationToSearch({ prefix: parent, startAfter: "" })}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate(parent);
                  }}
                  className={linkClass}
                >
                  <FileIcon variant="folderUp" />
                  <span className="text-slate-500 dark:text-slate-400">..</span>
                </a>
              </td>
            </tr>
          )}

          {entries.map((entry) => (
            <tr
              key={entry.key}
              className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40"
            >
              <td className="max-w-0 px-3 py-2">
                {entry.kind === "folder" ? (
                  <a
                    href={`/${locationToSearch({ prefix: entry.key, startAfter: "" })}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onNavigate(entry.key);
                    }}
                    className={linkClass}
                  >
                    <FileIcon variant="folder" />
                    <span className="truncate">{entry.name}</span>
                  </a>
                ) : (
                  <a
                    href={objectUrl(entry.key)}
                    {...(filesOpenInNewTab
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    className={linkClass}
                  >
                    <FileIcon itemKey={entry.key} />
                    <span className="truncate">{entry.name}</span>
                  </a>
                )}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap text-slate-600 dark:text-slate-400">
                {entry.kind === "file" ? (
                  <span title={formatExactBytes(entry.size)}>{formatSize(entry.size)}</span>
                ) : (
                  <span className="text-slate-400 dark:text-slate-600">—</span>
                )}
              </td>
              <td className="hidden px-3 py-2 text-right whitespace-nowrap text-slate-600 sm:table-cell dark:text-slate-400">
                {entry.kind === "file" ? (
                  <span title={formatRelative(entry.lastModified)}>
                    {formatTimestamp(entry.lastModified)}
                  </span>
                ) : (
                  <span className="text-slate-400 dark:text-slate-600">—</span>
                )}
              </td>
              <td className="hidden px-3 py-2 whitespace-nowrap lg:table-cell">
                {entry.kind === "file" && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {entry.storageClass}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
