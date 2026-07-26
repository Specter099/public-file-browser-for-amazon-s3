// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { describe, expect, it } from "vitest";

import type { Entry } from "./s3.ts";
import { DEFAULT_SORT, filterEntries, sortEntries } from "./sort.ts";

function folder(key: string): Entry {
  return { kind: "folder", key, name: key };
}

function file(key: string, size = 0, isoDate = "2024-01-01T00:00:00Z", storageClass = "STANDARD"): Entry {
  return {
    kind: "file",
    key,
    name: key,
    size,
    lastModified: new Date(isoDate),
    storageClass,
  };
}

const names = (entries: readonly Entry[]) => entries.map((entry) => entry.key);

describe("sortEntries", () => {
  it("groups folders above files on a complete page", () => {
    const entries = [file("b.txt"), folder("a/"), file("a.txt"), folder("z/")];
    expect(names(sortEntries(entries, DEFAULT_SORT, false))).toEqual([
      "a/",
      "z/",
      "a.txt",
      "b.txt",
    ]);
  });

  it("orders a paginated page strictly lexicographically, interleaving folders", () => {
    // Once pagination is in play, a page is not "the next objects" of the
    // previous page, so per-page folder grouping would look arbitrary.
    // Documented behavior.
    const entries = [file("b.txt"), folder("a/"), file("a.txt"), folder("z/")];
    expect(names(sortEntries(entries, DEFAULT_SORT, true))).toEqual([
      "a.txt",
      "a/",
      "b.txt",
      "z/",
    ]);
  });

  it("applies an explicit sort to a truncated page, and regroups folders", () => {
    const entries = [file("b.txt", 10), folder("a/"), file("a.txt", 30)];
    const sorted = sortEntries(entries, { column: "size", direction: "desc" }, true);
    expect(names(sorted)).toEqual(["a/", "a.txt", "b.txt"]);
  });

  it("sorts by size ascending and descending", () => {
    const entries = [file("big", 900), file("small", 5), file("mid", 100)];
    expect(names(sortEntries(entries, { column: "size", direction: "asc" }, false))).toEqual([
      "small",
      "mid",
      "big",
    ]);
    expect(names(sortEntries(entries, { column: "size", direction: "desc" }, false))).toEqual([
      "big",
      "mid",
      "small",
    ]);
  });

  it("sorts by last modified", () => {
    const entries = [
      file("older", 1, "2023-01-01T00:00:00Z"),
      file("newest", 1, "2025-01-01T00:00:00Z"),
      file("newer", 1, "2024-01-01T00:00:00Z"),
    ];
    expect(names(sortEntries(entries, { column: "modified", direction: "asc" }, false))).toEqual([
      "older",
      "newer",
      "newest",
    ]);
  });

  it("sorts by storage class", () => {
    const entries = [
      file("c", 1, "2024-01-01T00:00:00Z", "STANDARD_IA"),
      file("a", 1, "2024-01-01T00:00:00Z", "GLACIER_IR"),
      file("b", 1, "2024-01-01T00:00:00Z", "ONEZONE_IA"),
    ];
    expect(
      names(sortEntries(entries, { column: "storageClass", direction: "asc" }, false)),
    ).toEqual(["a", "b", "c"]);
  });

  it("breaks ties on key so equal values keep a stable order", () => {
    const entries = [file("z", 5), file("a", 5), file("m", 5)];
    expect(names(sortEntries(entries, { column: "size", direction: "asc" }, false))).toEqual([
      "a",
      "m",
      "z",
    ]);
  });

  it("does not mutate the input array", () => {
    const entries = [file("b"), file("a")];
    const snapshot = names(entries);
    sortEntries(entries, DEFAULT_SORT, false);
    expect(names(entries)).toEqual(snapshot);
  });

  it("orders keys by byte value, as S3 itself does", () => {
    // Upper-case sorts before lower-case in UTF-8 byte order; a locale-aware
    // comparison would disagree and diverge from S3's own pagination order.
    const entries = [file("apple"), file("Banana")];
    expect(names(sortEntries(entries, DEFAULT_SORT, false))).toEqual(["Banana", "apple"]);
  });
});

describe("filterEntries", () => {
  const entries = [folder("Photos/"), file("report.pdf"), file("README.md")];

  it("returns everything for an empty or whitespace query", () => {
    expect(filterEntries(entries, "")).toHaveLength(3);
    expect(filterEntries(entries, "   ")).toHaveLength(3);
  });

  it("matches case-insensitively on a substring", () => {
    expect(names(filterEntries(entries, "re"))).toEqual(["report.pdf", "README.md"]);
    expect(names(filterEntries(entries, "PHOTOS"))).toEqual(["Photos/"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterEntries(entries, "zzz")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [file("a"), file("b")];
    filterEntries(input, "a");
    expect(input).toHaveLength(2);
  });
});
