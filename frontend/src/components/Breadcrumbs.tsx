// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { breadcrumbSegments } from "../lib/s3.ts";
import { locationToSearch } from "../lib/useBrowserLocation.ts";

export interface BreadcrumbsProps {
  prefix: string;
  onNavigate: (prefix: string) => void;
}

/**
 * Path breadcrumbs.
 *
 * Segment names come from the `?p=` query parameter, i.e. straight from
 * attacker-controllable input. React escapes text children, so the DOM-based
 * XSS the pre-rebuild app had to guard with `escapeHtml()` is structurally
 * absent here -- there is no `dangerouslySetInnerHTML` anywhere in this app.
 */
export function Breadcrumbs({ prefix, onNavigate }: BreadcrumbsProps) {
  const segments = breadcrumbSegments(prefix);

  const linkClass =
    "rounded px-1.5 py-0.5 text-slate-600 transition-colors hover:bg-slate-200/70 " +
    "hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-100";

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-0.5 text-sm">
        <li>
          <a
            href="/"
            className={linkClass}
            onClick={(event) => {
              event.preventDefault();
              onNavigate("");
            }}
          >
            Home
          </a>
        </li>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            <li key={segment.prefix} className="flex min-w-0 items-center gap-0.5">
              <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">
                /
              </span>
              {isLast ? (
                <span
                  aria-current="page"
                  className="truncate rounded px-1.5 py-0.5 font-medium text-slate-900 dark:text-slate-100"
                >
                  {segment.name}
                </span>
              ) : (
                <a
                  href={`/${locationToSearch({ prefix: segment.prefix, startAfter: "" })}`}
                  className={`${linkClass} truncate`}
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate(segment.prefix);
                  }}
                >
                  {segment.name}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
