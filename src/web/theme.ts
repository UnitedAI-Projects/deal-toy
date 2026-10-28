import { useEffect, useState } from "react";
export type ThemeChoice = "system" | "light" | "dark";
const key = "deal-toy-theme";
function stored(): ThemeChoice {
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}
/** Light modern or dark modern; follows the system until the user picks one. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(stored);
  const media = matchMedia("(prefers-color-scheme: dark)");
  const [systemDark, setSystemDark] = useState(media.matches);
  useEffect(() => {
    const listener = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  const theme: "light" | "dark" =
    choice === "system" ? (systemDark ? "dark" : "light") : choice;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const choose = (next: ThemeChoice) => {
    setChoice(next);
    try {
      if (next === "system") localStorage.removeItem(key);
      else localStorage.setItem(key, next);
    } catch {
      // Storage can be unavailable; the choice still applies for this visit.
    }
  };
  return { theme, choice, choose };
}
