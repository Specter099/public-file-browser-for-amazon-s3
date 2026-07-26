#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
//
// Verifies the built index.html: every bundled asset tag carries an integrity
// attribute, each declared digest matches the file on disk, and nothing that
// gets rewritten at deploy time is pinned to a build-time hash.
//
// This runs as part of `npm run bundle` so a bad build fails loudly. Without
// it, a wrong hash is invisible until a browser refuses to execute the bundle
// and the page renders blank.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const outDir = path.resolve(process.argv[2] ?? "../build/website");
const htmlPath = path.join(outDir, "index.html");

/** Referenced by <link>/<script> but rewritten by the seeding Lambda, so it
 *  must NOT carry an integrity attribute. */
const DEPLOY_TIME_MUTABLE = ["icon/site.webmanifest"];

const failures = [];
const checked = [];

let html;
try {
  html = readFileSync(htmlPath, "utf8");
} catch (cause) {
  console.error(`verify-sri: cannot read ${htmlPath}: ${cause.message}`);
  process.exit(1);
}

const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? [];

for (const tag of tags) {
  const reference = /\b(?:src|href)="([^"]+)"/.exec(tag)?.[1];
  if (!reference) continue;

  const fileName = reference.replace(/^\/pfb_for_s3\//, "").replace(/^\.?\//, "");
  const declared = /\bintegrity="([^"]+)"/.exec(tag)?.[1];

  if (DEPLOY_TIME_MUTABLE.includes(fileName)) {
    if (declared) {
      failures.push(
        `${fileName} carries integrity="${declared}" but is rewritten at deploy time; ` +
          `the deployed file will not match this hash`,
      );
    }
    continue;
  }

  // Only bundled assets are expected to be hashed. Everything else in the
  // public directory (icons, browserconfig) is served verbatim and unhashed.
  const isBundledAsset = fileName.startsWith("assets/");
  if (!isBundledAsset) continue;

  if (!declared) {
    failures.push(`${fileName} is a bundled asset with no integrity attribute`);
    continue;
  }

  let contents;
  try {
    contents = readFileSync(path.join(outDir, fileName));
  } catch {
    failures.push(`${fileName} is referenced with integrity but is missing from ${outDir}`);
    continue;
  }

  const actual = `sha384-${createHash("sha384").update(contents).digest("base64")}`;
  if (actual !== declared) {
    failures.push(`${fileName} integrity mismatch\n    declared: ${declared}\n    actual:   ${actual}`);
  } else {
    checked.push(fileName);
  }
}

if (checked.length === 0 && failures.length === 0) {
  console.error("verify-sri: no bundled assets with integrity attributes found -- is the build empty?");
  process.exit(1);
}

for (const failure of failures) {
  console.error(`verify-sri: FAIL ${failure}`);
}

if (failures.length > 0) {
  console.error(`\nverify-sri: ${failures.length} problem(s) found.`);
  process.exit(1);
}

console.log(`verify-sri: OK - ${checked.length} bundled asset(s) verified against ${htmlPath}`);
