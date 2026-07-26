// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output and dependencies are never linted. `../build` is where Vite
    // stages the bundle before it is zipped into sam/seed_s3_data/website.zip.
    ignores: ["dist/**", "../build/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  // Type-aware rules: these need the TypeScript program, which is why
  // languageOptions.parserOptions below points at the tsconfig. They catch a
  // class of bug the non-type-aware set cannot -- floating promises being the
  // one that matters most here, since every S3 call returns one.
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Unused parameters prefixed with _ are intentional (e.g. the ILocalBundling
      // signature, unused event args), matching the tsconfig's own convention.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      // Test doubles for async APIs are written `async () => value` so they
      // return a promise with the right shape. There is nothing to await, and
      // rewriting them as `() => Promise.resolve(value)` is strictly noisier.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // Config and scripts run in Node, not the browser, and are not part of the
    // app's TypeScript program.
    files: ["vite.config.ts", "vitest.setup.ts", "eslint.config.js", "scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["eslint.config.js", "scripts/**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
);
