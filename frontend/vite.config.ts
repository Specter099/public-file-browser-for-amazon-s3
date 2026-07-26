// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from "vitest/config";

// CloudFront routes `pfb_for_s3/*` to the website bucket and everything else to
// the files bucket, so every app asset must live under this prefix. The
// distribution's DefaultRootObject is `pfb_for_s3/index.html`, which is what
// makes the site reachable at `/`.
const BASE = "/pfb_for_s3/";

const TAG_PATTERN = /<(script|link)\b([^>]*?)\s*\/?>/g;
const REFERENCE_PATTERN = /\b(?:src|href)="([^"]+)"/;

export function sriDigest(contents: Uint8Array | string): string {
  return `sha384-${createHash("sha384").update(contents).digest("base64")}`;
}

/**
 * Adds Subresource Integrity attributes to the built index.html.
 *
 * The pre-rebuild site hard-coded a sha384 hash per vendored `<script>`; a
 * bundled build emits content-hashed chunks instead, so the hashes have to be
 * computed at build time from the actual emitted bytes.
 *
 * Two things this gets deliberately right, both of which are silent-breakage
 * traps:
 *
 *  1. Hashes are computed in `closeBundle` from the files as written to disk,
 *     not from chunk contents in `generateBundle`. Chunk code is still
 *     rewritten after `generateBundle` runs, so hashing there yields digests
 *     that do not match what the browser fetches -- the browser then refuses to
 *     execute the bundle and the page silently renders nothing.
 *  2. Only bundled assets get an integrity attribute. Files copied from
 *     `public/` are excluded, because `icon/site.webmanifest` has its site name
 *     substituted by the seeding Lambda at deploy time; pinning a build-time
 *     hash to it would break the deployed manifest.
 */
function subresourceIntegrity(): Plugin {
  let base = BASE;
  let outDir = "";
  const bundledFileNames = new Set<string>();

  return {
    name: "pfb-subresource-integrity",
    apply: "build",
    enforce: "post",

    configResolved(config) {
      base = config.base;
      outDir = path.resolve(config.root, config.build.outDir);
    },

    generateBundle(_options, bundle) {
      // Record which files came from the bundle; hashing happens once they are
      // on disk. Public-directory files never appear here.
      for (const fileName of Object.keys(bundle)) {
        if (!fileName.endsWith(".html")) bundledFileNames.add(fileName);
      }
    },

    closeBundle() {
      const htmlPath = path.join(outDir, "index.html");
      const html = readFileSync(htmlPath, "utf8");

      const patched = html.replace(
        TAG_PATTERN,
        (tag: string, tagName: string, attrs: string) => {
          if (/\bintegrity=/.test(attrs)) return tag;

          const reference = REFERENCE_PATTERN.exec(attrs)?.[1];
          if (reference === undefined) return tag;

          // Built HTML references assets by public URL (base + fileName);
          // bundle keys are base-relative, so strip the base to look them up.
          const fileName = reference.startsWith(base)
            ? reference.slice(base.length)
            : reference.replace(/^\.?\//, "");

          if (!bundledFileNames.has(fileName)) return tag;

          const integrity = sriDigest(readFileSync(path.join(outDir, fileName)));
          return `<${tagName}${attrs} integrity="${integrity}">`;
        },
      );

      writeFileSync(htmlPath, patched);
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss(), subresourceIntegrity()],
  build: {
    // Staged under a `website/` directory so `npm run bundle` can zip it with
    // the same internal layout the seeding Lambda already expects.
    outDir: "../build/website",
    emptyOutDir: true,
    // Vite adds `crossorigin` to emitted tags; SRI needs the fetch to be
    // same-origin or CORS-enabled, and the assets are same-origin here.
    sourcemap: false,
    rollupOptions: {
      output: {
        // HTML-attribute SRI cannot cover a dynamically imported chunk: it is
        // fetched by the runtime, not by a tag in index.html. The AWS SDK
        // lazily `import()`s its Cognito identity client, which would leave
        // that chunk with no integrity check at all -- a silent hole in the
        // coverage this build otherwise claims. Emitting a single chunk keeps
        // every byte of JS behind an integrity attribute.
        inlineDynamicImports: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx"],
    },
  },
});
