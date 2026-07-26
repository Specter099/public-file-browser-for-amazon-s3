// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import type { ThemePreference } from "../lib/useTheme.ts";

export type ViewMode = "table" | "grid";

export interface ToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
  resultCount: number;
  totalCount: number;
}

const THEME_ORDER: readonly ThemePreference[] = ["system", "light", "dark"];

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "Match system theme",
  light: "Light theme",
  dark: "Dark theme",
};

const THEME_ICON: Record<ThemePreference, string> = {
  system: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18",
  light: "M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  dark: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z",
};

const segmentClass = (active: boolean) =>
  [
    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
    active
      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200",
  ].join(" ");

export function Toolbar({
  query,
  onQueryChange,
  view,
  onViewChange,
  preference,
  onPreferenceChange,
  resultCount,
  totalCount,
}: ToolbarProps) {
  const nextPreference =
    THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length] ?? "system";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative flex-1 sm:max-w-xs">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter this folder…"
          aria-label="Filter this folder by name"
          className={
            "w-full rounded-lg border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-sm " +
            "text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none " +
            "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          }
        />
      </div>

      <div className="flex items-center gap-2">
        <p
          aria-live="polite"
          className="mr-1 hidden text-xs text-slate-500 sm:block dark:text-slate-400"
        >
          {query.trim()
            ? `${resultCount} of ${totalCount} shown`
            : `${totalCount} item${totalCount === 1 ? "" : "s"}`}
        </p>

        <div
          role="group"
          aria-label="View mode"
          className="flex gap-0.5 rounded-lg bg-slate-200/70 p-0.5 dark:bg-slate-800"
        >
          <button
            type="button"
            onClick={() => onViewChange("table")}
            aria-pressed={view === "table"}
            className={segmentClass(view === "table")}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => onViewChange("grid")}
            aria-pressed={view === "grid"}
            className={segmentClass(view === "grid")}
          >
            Grid
          </button>
        </div>

        <button
          type="button"
          onClick={() => onPreferenceChange(nextPreference)}
          title={THEME_LABEL[preference]}
          aria-label={`${THEME_LABEL[preference]}. Activate to switch to: ${THEME_LABEL[nextPreference]}`}
          className={
            "rounded-lg border border-slate-300 bg-white p-2 text-slate-600 transition-colors " +
            "hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 " +
            "dark:hover:text-slate-100"
          }
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="size-4"
          >
            <path d={THEME_ICON[preference]} />
          </svg>
        </button>
      </div>
    </div>
  );
}
