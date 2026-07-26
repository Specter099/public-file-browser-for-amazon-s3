// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState } from "react";

import { isThumbnailable } from "../lib/fileKind.ts";
import { formatSize, formatTimestamp } from "../lib/format.ts";
import { objectUrl, type Entry } from "../lib/s3.ts";
import { locationToSearch } from "../lib/useBrowserLocation.ts";
import { FileIcon } from "./FileIcon.tsx";

export interface ListingGridProps {
  entries: readonly Entry[];
  onNavigate: (prefix: string) => void;
  parent: string | null;
  filesOpenInNewTab: boolean;
}

const tileClass =
  "group flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 transition-colors " +
  "hover:border-brand/60 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 " +
  "dark:hover:border-brand/50 dark:hover:bg-slate-800/60";

const previewClass =
  "flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800";

/**
 * Thumbnail for an image object. Falls back to the file icon if the image fails
 * to load, so a broken or non-image payload with an image extension does not
 * leave an empty tile.
 */
function Thumbnail({ entry }: { entry: Extract<Entry, { kind: "file" }> }) {
  const [failed, setFailed] = useState(false);

  if (failed || !isThumbnailable(entry.key)) {
    return <FileIcon itemKey={entry.key} className="size-10" />;
  }

  return (
    <img
      src={objectUrl(entry.key)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-full object-cover transition-transform group-hover:scale-105"
    />
  );
}

export function ListingGrid({
  entries,
  onNavigate,
  parent,
  filesOpenInNewTab,
}: ListingGridProps) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {parent !== null && (
        <li>
          <a
            href={`/${locationToSearch({ prefix: parent, startAfter: "" })}`}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(parent);
            }}
            className={tileClass}
          >
            <span className={previewClass}>
              <FileIcon variant="folderUp" className="size-10" />
            </span>
            <span className="truncate text-sm font-medium text-slate-500 dark:text-slate-400">
              ..
            </span>
          </a>
        </li>
      )}

      {entries.map((entry) => (
        <li key={entry.key}>
          {entry.kind === "folder" ? (
            <a
              href={`/${locationToSearch({ prefix: entry.key, startAfter: "" })}`}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(entry.key);
              }}
              className={tileClass}
            >
              <span className={previewClass}>
                <FileIcon variant="folder" className="size-10" />
              </span>
              <span
                title={entry.name}
                className="truncate text-sm font-medium text-slate-800 dark:text-slate-200"
              >
                {entry.name}
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-600">Folder</span>
            </a>
          ) : (
            <a
              href={objectUrl(entry.key)}
              {...(filesOpenInNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className={tileClass}
            >
              <span className={previewClass}>
                <Thumbnail entry={entry} />
              </span>
              <span
                title={entry.name}
                className="truncate text-sm font-medium text-slate-800 dark:text-slate-200"
              >
                {entry.name}
              </span>
              <span className="flex justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>{formatSize(entry.size)}</span>
                <span className="hidden truncate sm:inline">
                  {formatTimestamp(entry.lastModified).slice(0, 10)}
                </span>
              </span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
