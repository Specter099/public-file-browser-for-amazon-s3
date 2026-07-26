// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "pfb-theme";

function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // localStorage can throw in private-browsing modes; fall back to system.
    return "system";
  }
}

/**
 * Theme preference, persisted to localStorage.
 *
 * "system" applies no class at all and lets the stylesheet's
 * `prefers-color-scheme` rules decide. That keeps the pre-paint default correct
 * without an inline bootstrap script, which would otherwise have to be
 * allowlisted by any future Content-Security-Policy.
 */
export function useTheme(): {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", preference === "dark");
    root.classList.toggle("light", preference === "light");
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === "system") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // Persisting is best-effort; the in-memory preference still applies.
    }
  }, []);

  return { preference, setPreference };
}
