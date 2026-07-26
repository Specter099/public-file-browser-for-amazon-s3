// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
// Imported from the narrow cognito-identity package rather than the
// `@aws-sdk/credential-providers` umbrella: the umbrella pulls in the Node-only
// providers (SSO, IMDS, process, filesystem), which Vite then has to externalize
// for the browser and which bloat the bundle for no benefit here.
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";

import { regionFromIdentityPoolId, type SiteConfig } from "./config.ts";

/** A "folder" (S3 common prefix) in the current listing. */
export interface FolderEntry {
  kind: "folder";
  /** Full S3 prefix, including the trailing slash. */
  key: string;
  /** Prefix with the parent prefix trimmed off, for display. */
  name: string;
}

/** A file (S3 object) in the current listing. */
export interface FileEntry {
  kind: "file";
  key: string;
  name: string;
  size: number;
  lastModified: Date;
  storageClass: string;
}

export type Entry = FolderEntry | FileEntry;

export interface Listing {
  entries: Entry[];
  /**
   * True when S3 truncated the response. The pre-rebuild app used this to
   * switch to strict lexicographic ordering; see `sortEntries`.
   */
  isTruncated: boolean;
  /** Key to pass as `startAfter` for the next page, or null on the last page. */
  nextStartAfter: string | null;
}

export interface ListPrefixOptions {
  prefix: string;
  startAfter?: string;
}

export function createS3Client(config: SiteConfig): S3Client {
  const region = regionFromIdentityPoolId(config.identityPoolId);
  return new S3Client({
    region,
    // Unauthenticated (guest) identity: the pool's unauth role grants only
    // s3:ListBucket on the files bucket.
    credentials: fromCognitoIdentityPool({
      clientConfig: { region },
      identityPoolId: config.identityPoolId,
    }),
  });
}

function trimPrefix(key: string, prefix: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export async function listPrefix(
  client: S3Client,
  config: SiteConfig,
  { prefix, startAfter }: ListPrefixOptions,
): Promise<Listing> {
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: config.bucketName,
      Delimiter: "/",
      ...(prefix ? { Prefix: prefix } : {}),
      ...(startAfter ? { StartAfter: startAfter } : {}),
    }),
  );

  const resolvedPrefix = response.Prefix ?? prefix;
  const entries: Entry[] = [];

  for (const commonPrefix of response.CommonPrefixes ?? []) {
    if (!commonPrefix.Prefix) continue;
    entries.push({
      kind: "folder",
      key: commonPrefix.Prefix,
      name: trimPrefix(commonPrefix.Prefix, resolvedPrefix),
    });
  }

  for (const object of response.Contents ?? []) {
    // S3 can echo the prefix itself back as an object; it is not a child.
    if (!object.Key || object.Key === resolvedPrefix) continue;

    const storageClass = object.StorageClass ?? "STANDARD";
    if (!config.visibleStorageClasses.includes(storageClass)) continue;

    entries.push({
      kind: "file",
      key: object.Key,
      name: trimPrefix(object.Key, resolvedPrefix),
      size: object.Size ?? 0,
      lastModified: object.LastModified ?? new Date(NaN),
      storageClass,
    });
  }

  const isTruncated = response.IsTruncated === true;
  const lastEntry = entries.at(-1);

  return {
    entries,
    isTruncated,
    nextStartAfter: isTruncated && lastEntry ? lastEntry.key : null,
  };
}

/** Parent prefix of `prefix`, or "" when already at the bucket root. */
export function parentPrefix(prefix: string): string {
  if (!prefix) return "";
  const withoutTrailingSlash = prefix.replace(/\/$/, "");
  const lastSlash = withoutTrailingSlash.lastIndexOf("/");
  return lastSlash === -1 ? "" : withoutTrailingSlash.slice(0, lastSlash + 1);
}

/** Breadcrumb segments for a prefix, each with the prefix to navigate to. */
export function breadcrumbSegments(prefix: string): Array<{ name: string; prefix: string }> {
  const segments: Array<{ name: string; prefix: string }> = [];
  let accumulated = "";
  for (const name of prefix.split("/")) {
    if (!name) continue;
    accumulated += `${name}/`;
    segments.push({ name, prefix: accumulated });
  }
  return segments;
}

/** Public CloudFront path for an object key (served from the files origin). */
export function objectUrl(key: string): string {
  return `/${key.split("/").map(encodeURIComponent).join("/")}`;
}
