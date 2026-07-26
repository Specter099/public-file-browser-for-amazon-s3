// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useCallback, useEffect, useMemo, useState } from "react";
import type { S3Client } from "@aws-sdk/client-s3";

import { Breadcrumbs } from "./components/Breadcrumbs.tsx";
import { ListingGrid } from "./components/ListingGrid.tsx";
import { ListingTable } from "./components/ListingTable.tsx";
import { Toolbar, type ViewMode } from "./components/Toolbar.tsx";
import type { SiteConfig } from "./lib/config.ts";
import { listPrefix, parentPrefix, type Listing } from "./lib/s3.ts";
import { DEFAULT_SORT, filterEntries, sortEntries, type SortColumn, type SortState } from "./lib/sort.ts";
import { useBrowserLocation } from "./lib/useBrowserLocation.ts";
import { useTheme } from "./lib/useTheme.ts";

export interface AppProps {
  config: SiteConfig;
  client: S3Client;
}

export function App({ config, client }: AppProps) {
  const { location, navigate } = useBrowserLocation();
  const { preference, setPreference } = useTheme();

  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("table");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const { prefix, startAfter } = location;

  useEffect(() => {
    document.title = `${config.siteName} - /${prefix}`;
  }, [config.siteName, prefix]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    listPrefix(client, config, { prefix, ...(startAfter ? { startAfter } : {}) })
      .then((result) => {
        if (cancelled) return;
        setListing(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setListing(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not list the bucket contents. Please try again.",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, config, prefix, startAfter]);

  // A filter applies to the folder being viewed, so drop it on navigation.
  const goTo = useCallback(
    (nextPrefix: string, nextStartAfter = "") => {
      setQuery("");
      navigate({ prefix: nextPrefix, startAfter: nextStartAfter });
    },
    [navigate],
  );

  const onSortChange = useCallback((column: SortColumn) => {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );
  }, []);

  const allEntries = listing?.entries ?? [];
  const isTruncated = listing?.isTruncated ?? false;

  const visibleEntries = useMemo(
    () => sortEntries(filterEntries(allEntries, query), sort, isTruncated),
    [allEntries, query, sort, isTruncated],
  );

  // Only offer ".." below the bucket root.
  const parent = prefix ? parentPrefix(prefix) : null;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
            {config.siteName}
          </p>
          <h1 className="sr-only">{config.siteName}</h1>
          <Breadcrumbs prefix={prefix} onNavigate={goTo} />
        </header>

        <Toolbar
          query={query}
          onQueryChange={setQuery}
          view={view}
          onViewChange={setView}
          preference={preference}
          onPreferenceChange={setPreference}
          resultCount={visibleEntries.length}
          totalCount={allEntries.length}
        />

        <main>
          {error !== null ? (
            <div
              role="alert"
              className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
            >
              <p className="font-medium">Could not load this folder.</p>
              <p className="mt-1 text-red-700 dark:text-red-300">{error}</p>
            </div>
          ) : isLoading ? (
            <p role="status" className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              Loading…
            </p>
          ) : visibleEntries.length === 0 && parent === null ? (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {query.trim() ? "Nothing matches your filter." : "This bucket is empty."}
            </p>
          ) : view === "table" ? (
            <ListingTable
              entries={visibleEntries}
              sort={sort}
              onSortChange={onSortChange}
              onNavigate={goTo}
              parent={parent}
              filesOpenInNewTab={config.filesOpenInNewTab}
            />
          ) : (
            <ListingGrid
              entries={visibleEntries}
              onNavigate={goTo}
              parent={parent}
              filesOpenInNewTab={config.filesOpenInNewTab}
            />
          )}

          {!isLoading && error === null && visibleEntries.length === 0 && parent !== null && (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {query.trim() ? "Nothing matches your filter." : "This folder is empty."}
            </p>
          )}
        </main>

        {listing?.nextStartAfter != null && !query.trim() && (
          <nav className="flex justify-center">
            <button
              type="button"
              onClick={() => goTo(prefix, listing.nextStartAfter ?? "")}
              className={
                "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium " +
                "text-slate-700 transition-colors hover:border-brand hover:text-brand " +
                "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand"
              }
            >
              Next page →
            </button>
          </nav>
        )}

        <footer className="pt-2 text-xs text-slate-400 dark:text-slate-600">
          Powered by{" "}
          <a
            href="https://github.com/aws-samples/public-file-browser-for-amazon-s3"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-slate-600 dark:hover:text-slate-400"
          >
            Public File Browser for Amazon S3
          </a>
        </footer>
      </div>
    </div>
  );
}
