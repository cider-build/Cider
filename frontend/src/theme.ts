import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "cider-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function stored(): Theme | null {
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

export function applyStoredTheme() {
  document.documentElement.dataset.theme = stored() ?? systemTheme();
  requestAnimationFrame(() => {
    document.documentElement.dataset.themeReady = "";
  });
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme | undefined) ?? "light",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (stored() !== null) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      setTheme(query.matches ? "dark" : "light");
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }

  return { theme, toggle };
}
