// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Coarse file categories, used to pick an icon and to decide which files can be
 * shown as thumbnails in grid view.
 */
export type FileKind =
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "pdf"
  | "spreadsheet"
  | "document"
  | "presentation"
  | "code"
  | "text"
  | "binary"
  | "font"
  | "other";

const EXTENSIONS: ReadonlyArray<readonly [FileKind, readonly string[]]> = [
  ["image", [".jpg", ".jpeg", ".bmp", ".gif", ".heic", ".png", ".raw", ".svg", ".tiff", ".webp", ".avif", ".ico"]],
  ["video", [".mov", ".mp4", ".webm", ".mkv", ".avi", ".m4v"]],
  ["audio", [".aac", ".wav", ".m4p", ".m4a", ".mp3", ".flac", ".ogg"]],
  ["archive", [".zip", ".pkg", ".tar.gz", ".tgz", ".gz", ".tar", ".bz2", ".xz", ".7z", ".rar"]],
  ["pdf", [".pdf"]],
  ["spreadsheet", [".csv", ".tsv", ".xls", ".xlsx", ".ods"]],
  ["document", [".doc", ".docx", ".odt", ".rtf", ".pages"]],
  ["presentation", [".ppt", ".pptx", ".odp", ".key"]],
  [
    "code",
    [
      ".css", ".js", ".mjs", ".cjs", ".json", ".php", ".py", ".rb", ".sass", ".scss", ".sh",
      ".sql", ".xml", ".yml", ".yaml", ".html", ".htm", ".java", ".c", ".h", ".cpp", ".cs",
      ".go", ".rs", ".ts", ".tsx", ".jsx", ".swift", ".kt", ".toml", ".ini",
    ],
  ],
  ["text", [".md", ".mdx", ".txt", ".log"]],
  ["binary", [".exe", ".dll", ".bin", ".so", ".dmg", ".deb", ".rpm"]],
  ["font", [".otf", ".ttf", ".woff", ".woff2", ".eot"]],
];

/** Extensions safe to render inline as an <img> thumbnail. */
const THUMBNAILABLE = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp", ".ico",
]);

export function fileKind(key: string): FileKind {
  const lower = key.toLowerCase();
  for (const [kind, extensions] of EXTENSIONS) {
    if (extensions.some((extension) => lower.endsWith(extension))) return kind;
  }
  return "other";
}

/**
 * Whether a key can be shown as an inline image thumbnail.
 *
 * SVG is excluded even though it is an image, but for rendering reasons rather
 * than security ones: an SVG with no intrinsic size renders unpredictably in a
 * fixed thumbnail box, and one built for a different background can be
 * invisible. Scripts inside an SVG loaded through `<img>` do not execute, so
 * this is not a script-injection mitigation -- that exposure comes from
 * *clicking* an `.svg` or `.html` object, which serves it as a top-level
 * document on the same CloudFront origin. That is inherent to the
 * single-distribution design and applies equally to both views; the mitigation
 * is `Content-Disposition` on the files origin, a deferred item tracked in
 * CLAUDE.md.
 */
export function isThumbnailable(key: string): boolean {
  const lower = key.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return false;
  return THUMBNAILABLE.has(lower.slice(dot));
}
