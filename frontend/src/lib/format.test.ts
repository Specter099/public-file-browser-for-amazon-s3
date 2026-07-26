// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { describe, expect, it } from "vitest";

import { formatExactBytes, formatRelative, formatSize, formatTimestamp } from "./format.ts";

describe("formatSize", () => {
  it("shows bytes as whole numbers below 1 KiB", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1)).toBe("1 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("uses binary (1024-based) steps, matching the pre-rebuild helper", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 ** 2)).toBe("1.0 MB");
    expect(formatSize(1024 ** 3)).toBe("1.0 GB");
    expect(formatSize(1024 ** 4)).toBe("1.0 TB");
  });

  it("honors the precision argument", () => {
    expect(formatSize(1536, 0)).toBe("2 KB");
    expect(formatSize(1536, 2)).toBe("1.50 KB");
  });

  it("saturates at the largest unit rather than producing an undefined suffix", () => {
    expect(formatSize(1024 ** 9)).toBe("1024.0 YB");
  });

  it("returns an empty string for negative or non-finite input", () => {
    expect(formatSize(-1)).toBe("");
    expect(formatSize(Number.NaN)).toBe("");
    expect(formatSize(Number.POSITIVE_INFINITY)).toBe("");
  });
});

describe("formatExactBytes", () => {
  it("renders a thousands-separated byte count", () => {
    expect(formatExactBytes(1234567)).toBe(`${(1234567).toLocaleString()} Bytes`);
  });
});

describe("formatTimestamp", () => {
  it("renders local time as yyyy-LL-dd HH:mm:ss", () => {
    // Constructed from local-time parts so the assertion is timezone-independent.
    const date = new Date(2024, 1, 20, 9, 5, 3);
    expect(formatTimestamp(date)).toBe("2024-02-20 09:05:03");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatTimestamp(new Date(Number.NaN))).toBe("");
  });
});

describe("formatRelative", () => {
  const now = new Date("2024-06-15T12:00:00Z");

  it("describes past timestamps", () => {
    expect(formatRelative(new Date("2024-06-12T12:00:00Z"), now)).toBe("3 days ago");
    expect(formatRelative(new Date("2024-06-15T11:00:00Z"), now)).toBe("1 hour ago");
  });

  it("describes sub-second differences without falling through to an empty unit", () => {
    expect(formatRelative(new Date("2024-06-15T12:00:00Z"), now)).toBe("now");
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatRelative(new Date(Number.NaN), now)).toBe("");
  });
});
