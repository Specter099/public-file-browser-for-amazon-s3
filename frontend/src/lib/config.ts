// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/** Deploy-time settings, resolved from the runtime `config.json`. */
export interface SiteConfig {
  siteName: string;
  identityPoolId: string;
  bucketName: string;
  filesOpenInNewTab: boolean;
  visibleStorageClasses: string[];
}

/**
 * Shape of `public/config.json` as shipped. Every value is a string so the file
 * is valid JSON both before and after the seeding Lambda substitutes its
 * `###REPLACE_ME_*###` placeholders -- an unquoted boolean placeholder would
 * make the pre-deploy file unparseable and break local development.
 */
interface RawSiteConfig {
  siteName?: unknown;
  identityPoolId?: unknown;
  bucketName?: unknown;
  filesOpenInNewTab?: unknown;
  visibleStorageClasses?: unknown;
}

export const CONFIG_URL = "/pfb_for_s3/config.json";

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`config.json: "${field}" must be a non-empty string`);
  }
  return value;
}

export function parseConfig(raw: RawSiteConfig): SiteConfig {
  const identityPoolId = requireString(raw.identityPoolId, "identityPoolId");
  // The region is the identity pool ID's prefix (e.g. "us-west-2:uuid"), which
  // is how the pre-rebuild app derived it too.
  if (!identityPoolId.includes(":")) {
    throw new Error('config.json: "identityPoolId" must look like "<region>:<uuid>"');
  }

  return {
    siteName: requireString(raw.siteName, "siteName"),
    identityPoolId,
    bucketName: requireString(raw.bucketName, "bucketName"),
    // Anything other than an explicit "false" keeps the recommended default of
    // opening files in a new tab. Checked as a string rather than coerced with
    // String(): the field is `unknown`, and coercing an object would silently
    // yield "[object Object]" and read as "not false".
    filesOpenInNewTab:
      typeof raw.filesOpenInNewTab !== "string" ||
      raw.filesOpenInNewTab.toLowerCase() !== "false",
    visibleStorageClasses: requireString(raw.visibleStorageClasses, "visibleStorageClasses")
      .toUpperCase()
      .split(",")
      .map((storageClass) => storageClass.trim())
      .filter((storageClass) => storageClass.length > 0),
  };
}

export function regionFromIdentityPoolId(identityPoolId: string): string {
  const [region] = identityPoolId.split(":");
  return region ?? "";
}

export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<SiteConfig> {
  const response = await fetchImpl(CONFIG_URL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Could not load ${CONFIG_URL} (HTTP ${response.status})`);
  }
  return parseConfig((await response.json()) as RawSiteConfig);
}
