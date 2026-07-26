// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { fileKind, type FileKind } from "../lib/fileKind.ts";

/*
 * Inline SVG paths (Lucide, ISC-licensed geometry redrawn as single paths) so the
 * app ships no icon font. The pre-rebuild site pulled in the full Bootstrap
 * Icons webfont plus its stylesheet for this.
 */
const PATHS: Record<FileKind | "folder" | "folderUp", string> = {
  folder: "M3 7a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  folderUp: "M3 7a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 16v-5m0 0-2 2m2-2 2 2",
  image: "M4 5h16v14H4zM4 15l4-4 3 3 3-3 6 6M15 9.5a1 1 0 1 0 2 0 1 1 0 0 0-2 0",
  video: "M4 6h11v12H4zM15 10l5-3v10l-5-3z",
  audio: "M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  archive: "M6 3h12v18H6zM11 3v4h2V3M11 9v2h2V9M11 13v2h2v-2",
  pdf: "M6 3h8l4 4v14H6zM14 3v4h4M9 17v-5h1.5a1.5 1.5 0 0 1 0 3H9m5 2v-5h2",
  spreadsheet: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14",
  document: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  presentation: "M3 4h18v11H3zM12 15v5m-4 0h8M8 11l3-3 2 2 3-4",
  code: "M6 3h8l4 4v14H6zM14 3v4h4M10 12l-2 2 2 2M14 12l2 2-2 2",
  text: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h4",
  binary: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h2v4H9zM13 12h2v4h-2z",
  font: "M6 3h8l4 4v14H6zM14 3v4h4M9 16l2-5 2 5M9.7 14.5h2.6",
  other: "M6 3h8l4 4v14H6zM14 3v4h4",
};

const CLASS_BY_KIND: Partial<Record<FileKind | "folder" | "folderUp", string>> = {
  folder: "text-brand",
  folderUp: "text-brand",
  image: "text-emerald-600 dark:text-emerald-400",
  video: "text-purple-600 dark:text-purple-400",
  audio: "text-pink-600 dark:text-pink-400",
  archive: "text-amber-600 dark:text-amber-400",
  pdf: "text-red-600 dark:text-red-400",
  spreadsheet: "text-green-700 dark:text-green-400",
  document: "text-blue-600 dark:text-blue-400",
  presentation: "text-orange-600 dark:text-orange-400",
  code: "text-cyan-700 dark:text-cyan-400",
};

export interface FileIconProps {
  /** Object key or prefix; ignored when `variant` is a folder. */
  itemKey?: string;
  variant?: "folder" | "folderUp" | "file";
  className?: string;
}

export function FileIcon({ itemKey = "", variant = "file", className = "size-5" }: FileIconProps) {
  const kind = variant === "file" ? fileKind(itemKey) : variant;
  const colorClass = CLASS_BY_KIND[kind] ?? "text-slate-500 dark:text-slate-400";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`${className} shrink-0 ${colorClass}`}
    >
      <path d={PATHS[kind]} />
    </svg>
  );
}
