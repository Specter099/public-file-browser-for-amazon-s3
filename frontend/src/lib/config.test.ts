// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { describe, expect, it, vi } from "vitest";

import { CONFIG_URL, loadConfig, parseConfig, regionFromIdentityPoolId } from "./config.ts";

const VALID = {
  siteName: "AnyCompany Public Files",
  identityPoolId: "us-west-2:11111111-2222-3333-4444-555555555555",
  bucketName: "public-file-browser-files-abc123",
  filesOpenInNewTab: "true",
  visibleStorageClasses: "STANDARD,STANDARD_IA",
};

describe("parseConfig", () => {
  it("parses a fully substituted config", () => {
    expect(parseConfig(VALID)).toEqual({
      siteName: "AnyCompany Public Files",
      identityPoolId: "us-west-2:11111111-2222-3333-4444-555555555555",
      bucketName: "public-file-browser-files-abc123",
      filesOpenInNewTab: true,
      visibleStorageClasses: ["STANDARD", "STANDARD_IA"],
    });
  });

  it('treats "false" as same-tab and anything else as new-tab', () => {
    expect(parseConfig({ ...VALID, filesOpenInNewTab: "false" }).filesOpenInNewTab).toBe(false);
    expect(parseConfig({ ...VALID, filesOpenInNewTab: "False" }).filesOpenInNewTab).toBe(false);
    expect(parseConfig({ ...VALID, filesOpenInNewTab: "true" }).filesOpenInNewTab).toBe(true);
    // A placeholder the Lambda failed to substitute must not silently become
    // "same tab" -- new tab is the documented recommended default.
    expect(
      parseConfig({ ...VALID, filesOpenInNewTab: "###REPLACE_ME_FILES_OPEN_MODE###" })
        .filesOpenInNewTab,
    ).toBe(true);
  });

  it("normalizes storage classes to upper case and trims whitespace", () => {
    expect(
      parseConfig({ ...VALID, visibleStorageClasses: " standard , glacier_ir " })
        .visibleStorageClasses,
    ).toEqual(["STANDARD", "GLACIER_IR"]);
  });

  it("drops empty entries from a trailing comma", () => {
    expect(
      parseConfig({ ...VALID, visibleStorageClasses: "STANDARD," }).visibleStorageClasses,
    ).toEqual(["STANDARD"]);
  });

  it.each(["siteName", "identityPoolId", "bucketName", "visibleStorageClasses"] as const)(
    "rejects a missing %s",
    (field) => {
      const raw: Record<string, unknown> = { ...VALID };
      delete raw[field];
      expect(() => parseConfig(raw)).toThrow(new RegExp(`"${field}"`));
    },
  );

  it("rejects an identity pool ID that carries no region prefix", () => {
    expect(() => parseConfig({ ...VALID, identityPoolId: "not-a-pool-id" })).toThrow(
      /identityPoolId/,
    );
  });
});

describe("regionFromIdentityPoolId", () => {
  it("takes the region from the pool ID prefix", () => {
    expect(regionFromIdentityPoolId("eu-central-1:abc")).toBe("eu-central-1");
  });
});

describe("loadConfig", () => {
  it("fetches and parses the runtime config", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(VALID), { status: 200 }));

    const config = await loadConfig(fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith(CONFIG_URL, { cache: "no-cache" });
    expect(config.siteName).toBe("AnyCompany Public Files");
  });

  it("throws a useful message when config.json is missing", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));

    await expect(loadConfig(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/404/);
  });
});
