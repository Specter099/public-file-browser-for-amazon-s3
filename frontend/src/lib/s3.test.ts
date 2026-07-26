// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import type { SiteConfig } from "./config.ts";
import { breadcrumbSegments, listPrefix, objectUrl, parentPrefix } from "./s3.ts";

const CONFIG: SiteConfig = {
  siteName: "Test Site",
  identityPoolId: "us-west-2:pool",
  bucketName: "test-bucket",
  filesOpenInNewTab: true,
  visibleStorageClasses: ["STANDARD", "STANDARD_IA"],
};

interface SentCommand {
  input: Record<string, unknown>;
}

/** Minimal fake S3 client that returns one canned ListObjectsV2 response. */
function fakeClient(response: Record<string, unknown>) {
  const send = vi.fn(async (_command: SentCommand) => response);
  return { client: { send } as unknown as S3Client, send };
}

/** The `input` of the nth command the fake client received. */
function inputOfCall(send: ReturnType<typeof fakeClient>["send"], index = 0) {
  const call = send.mock.calls[index];
  if (!call) throw new Error(`client.send was not called ${index + 1} time(s)`);
  return call[0].input;
}

describe("listPrefix", () => {
  it("maps common prefixes to folders and contents to files", async () => {
    const { client } = fakeClient({
      Prefix: "docs/",
      CommonPrefixes: [{ Prefix: "docs/images/" }],
      Contents: [
        {
          Key: "docs/readme.md",
          Size: 120,
          LastModified: new Date("2024-03-01T10:00:00Z"),
          StorageClass: "STANDARD",
        },
      ],
      IsTruncated: false,
    });

    const listing = await listPrefix(client, CONFIG, { prefix: "docs/" });

    expect(listing.entries).toEqual([
      { kind: "folder", key: "docs/images/", name: "images/" },
      {
        kind: "file",
        key: "docs/readme.md",
        name: "readme.md",
        size: 120,
        lastModified: new Date("2024-03-01T10:00:00Z"),
        storageClass: "STANDARD",
      },
    ]);
    expect(listing.isTruncated).toBe(false);
    expect(listing.nextStartAfter).toBeNull();
  });

  it("passes Bucket, Delimiter, Prefix and StartAfter to the API", async () => {
    const { client, send } = fakeClient({ IsTruncated: false });

    await listPrefix(client, CONFIG, { prefix: "a/", startAfter: "a/b.txt" });

    expect(inputOfCall(send)).toEqual({
      Bucket: "test-bucket",
      Delimiter: "/",
      Prefix: "a/",
      StartAfter: "a/b.txt",
    });
  });

  it("omits Prefix and StartAfter at the bucket root", async () => {
    const { client, send } = fakeClient({ IsTruncated: false });

    await listPrefix(client, CONFIG, { prefix: "" });

    expect(inputOfCall(send)).toEqual({ Bucket: "test-bucket", Delimiter: "/" });
  });

  it("hides objects whose storage class is not configured as visible", async () => {
    const { client } = fakeClient({
      Prefix: "",
      Contents: [
        { Key: "visible.txt", Size: 1, LastModified: new Date(), StorageClass: "STANDARD" },
        { Key: "archived.txt", Size: 1, LastModified: new Date(), StorageClass: "GLACIER" },
      ],
      IsTruncated: false,
    });

    const listing = await listPrefix(client, CONFIG, { prefix: "" });

    expect(listing.entries.map((entry) => entry.key)).toEqual(["visible.txt"]);
  });

  it("defaults a missing storage class to STANDARD rather than hiding the object", async () => {
    const { client } = fakeClient({
      Prefix: "",
      Contents: [{ Key: "no-class.txt", Size: 1, LastModified: new Date() }],
      IsTruncated: false,
    });

    const listing = await listPrefix(client, CONFIG, { prefix: "" });

    expect(listing.entries).toHaveLength(1);
  });

  it("skips the prefix echoed back as its own object", async () => {
    const { client } = fakeClient({
      Prefix: "folder/",
      Contents: [
        { Key: "folder/", Size: 0, LastModified: new Date(), StorageClass: "STANDARD" },
        { Key: "folder/real.txt", Size: 5, LastModified: new Date(), StorageClass: "STANDARD" },
      ],
      IsTruncated: false,
    });

    const listing = await listPrefix(client, CONFIG, { prefix: "folder/" });

    expect(listing.entries.map((entry) => entry.key)).toEqual(["folder/real.txt"]);
  });

  it("reports the last key as the next page cursor when truncated", async () => {
    const { client } = fakeClient({
      Prefix: "",
      Contents: [
        { Key: "a.txt", Size: 1, LastModified: new Date(), StorageClass: "STANDARD" },
        { Key: "b.txt", Size: 1, LastModified: new Date(), StorageClass: "STANDARD" },
      ],
      IsTruncated: true,
    });

    const listing = await listPrefix(client, CONFIG, { prefix: "" });

    expect(listing.isTruncated).toBe(true);
    expect(listing.nextStartAfter).toBe("b.txt");
  });

  it("reports no cursor when a truncated response yields no visible entries", async () => {
    // Every object filtered out by storage class; advancing with an undefined
    // cursor would restart the listing from the beginning.
    const { client } = fakeClient({
      Prefix: "",
      Contents: [{ Key: "cold.txt", Size: 1, LastModified: new Date(), StorageClass: "GLACIER" }],
      IsTruncated: true,
    });

    const listing = await listPrefix(client, CONFIG, { prefix: "" });

    expect(listing.nextStartAfter).toBeNull();
  });

  it("tolerates a response with neither Contents nor CommonPrefixes", async () => {
    const { client } = fakeClient({ IsTruncated: false });

    await expect(listPrefix(client, CONFIG, { prefix: "" })).resolves.toEqual({
      entries: [],
      isTruncated: false,
      nextStartAfter: null,
    });
  });
});

describe("parentPrefix", () => {
  it.each([
    ["", ""],
    ["a/", ""],
    ["a/b/", "a/"],
    ["a/b/c/", "a/b/"],
  ])("maps %o to %o", (input, expected) => {
    expect(parentPrefix(input)).toBe(expected);
  });
});

describe("breadcrumbSegments", () => {
  it("returns cumulative prefixes for each path segment", () => {
    expect(breadcrumbSegments("a/b/c/")).toEqual([
      { name: "a", prefix: "a/" },
      { name: "b", prefix: "a/b/" },
      { name: "c", prefix: "a/b/c/" },
    ]);
  });

  it("returns nothing at the bucket root", () => {
    expect(breadcrumbSegments("")).toEqual([]);
  });

  it("ignores empty segments from doubled slashes", () => {
    expect(breadcrumbSegments("a//b/")).toEqual([
      { name: "a", prefix: "a/" },
      { name: "b", prefix: "a/b/" },
    ]);
  });
});

describe("objectUrl", () => {
  it("encodes each path segment but keeps the slashes", () => {
    expect(objectUrl("folder/my file.txt")).toBe("/folder/my%20file.txt");
  });

  it("encodes characters that would otherwise break out of the URL path", () => {
    expect(objectUrl('weird"name#1.txt')).toBe("/weird%22name%231.txt");
    expect(objectUrl("a?b.txt")).toBe("/a%3Fb.txt");
  });
});
