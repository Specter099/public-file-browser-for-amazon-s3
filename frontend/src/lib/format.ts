// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"] as const;

/**
 * Formats a byte count using binary (1024-based) steps, matching the
 * pre-rebuild `s3FileSize()` helper. Bytes are shown as whole numbers; larger
 * units get one decimal place.
 */
export function formatSize(bytes: number, precision = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(precision)} ${SIZE_UNITS[unitIndex]}`;
}

export function formatExactBytes(bytes: number): string {
  return `${bytes.toLocaleString()} Bytes`;
}

/** Renders a date as `yyyy-LL-dd HH:mm:ss` in the viewer's local time. */
export function formatTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

const RELATIVE_STEPS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
  { unit: "second", ms: 1000 },
];

/**
 * Human-readable relative time ("3 days ago"), replacing the Luxon
 * `toRelative()` call the pre-rebuild app used for the mouseover title.
 */
export function formatRelative(date: Date, now: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) return "";
  const deltaMs = date.getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const { unit, ms } of RELATIVE_STEPS) {
    if (Math.abs(deltaMs) >= ms) {
      return formatter.format(Math.round(deltaMs / ms), unit);
    }
  }
  return formatter.format(0, "second");
}
