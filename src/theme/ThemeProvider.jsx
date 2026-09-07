import { useMemo, useState } from "react";
import { ThemeContext } from "./ThemeContext";

const THEME_KEY = "scheduloop_theme";

function getInitialTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Theme preference is optional UI state.
  }

  return "light";
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  const setTheme = (nextTheme) => {
    setThemeState(nextTheme);
    try {
      window.localStorage.setItem(THEME_KEY, nextTheme);
    } catch {
      // Keep theme usable even if storage is unavailable.
    }
  };

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [theme]
  );

  return (
    <ThemeContext.Provider value={value}>
      <div className="theme-root" data-theme={theme}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
