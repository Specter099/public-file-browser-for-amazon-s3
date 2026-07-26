// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { loadConfig } from "./lib/config.ts";
import { createS3Client } from "./lib/s3.ts";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root container");

const root = createRoot(container);

/**
 * config.json carries the deploy-time settings, so it has to resolve before the
 * app can talk to S3. Rendering is deferred until then rather than threading a
 * "config not ready" state through every component.
 */
loadConfig()
  .then((config) => {
    root.render(
      <StrictMode>
        <App config={config} client={createS3Client(config)} />
      </StrictMode>,
    );
  })
  .catch((cause: unknown) => {
    const detail = cause instanceof Error ? cause.message : String(cause);
    root.render(
      <div className="min-h-dvh bg-slate-50 p-6 dark:bg-slate-950">
        <div
          role="alert"
          className="mx-auto max-w-xl rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
        >
          <p className="font-medium">This file browser is not configured correctly.</p>
          <p className="mt-1">{detail}</p>
        </div>
      </div>,
    );
  });
