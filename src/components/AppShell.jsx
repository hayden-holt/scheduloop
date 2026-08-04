import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useBusinessProfile } from "../business/BusinessProfileContext";
import { useTheme } from "../theme/ThemeContext";
import { normalizeBusinessProfileBasics } from "../utils/businessProfileSetup";

const NAV_ITEMS = [
  {
    label: "Dashboard",
    to: "/",
    icon: "dashboard",
    match: ({ pathname, search, hash }) =>
      pathname === "/" &&
      !search.includes("view=setup") &&
      hash !== "#data-imports" &&
      hash !== "#settings",
  },
  {
    label: "Rota",
    to: "/rota",
    icon: "calendar",
    match: ({ pathname }) => pathname === "/rota",
  },
  {
    label: "Data / Imports",
    to: "/?view=setup#data-imports",
    icon: "upload",
    match: ({ pathname, hash }) => pathname === "/" && hash === "#data-imports",
  },
  {
    label: "Settings",
    to: "/settings",
    icon: "settings",
    match: ({ pathname }) => pathname === "/settings",
  },
];

function ShellIcon({ name }) {
  const icons = {
    dashboard: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4" />
        <path d="M16 3v4" />
        <path d="M4 10h16" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4" />
        <path d="M7 9l5-5 5 5" />
        <path d="M5 20h14" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7.7 7.7 0 0 0-2-1.1L14 3h-4l-.4 2.8a7.7 7.7 0 0 0-2 1.1l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1a7.7 7.7 0 0 0 2 1.1L10 21h4l.4-2.8a7.7 7.7 0 0 0 2-1.1l2.4 1 2-3.4-2-1.5c.1-.4.2-.8.2-1.2z" />
      </>
    ),
  };

  return (
    <svg className="app-shell-icon" aria-hidden="true" viewBox="0 0 24 24">
      {icons[name]}
    </svg>
  );
}

function getPageTitle(pathname, search) {
  if (pathname === "/rota") return "Rota";
  if (pathname === "/settings") return "Settings";
  if (search.includes("view=setup")) return "Data / Imports";
  if (pathname === "/") return "Dashboard";
  return "Dashboard";
}

function getPageDetail(pathname, profile) {
  const basics = normalizeBusinessProfileBasics(profile);
  const location = basics.location ? ` · ${basics.location}` : "";

  if (pathname === "/rota") {
    return `${basics.businessName}${location}`;
  }

  return `${basics.businessName}${location}`;
}

function SidebarNav({ location, onNavigate }) {
  return (
    <nav className="app-shell-nav" aria-label="Main navigation">
      {NAV_ITEMS.map((item) => {
        const active = item.match(location);

        return (
          <Link
            key={item.label}
            to={item.to}
            className={"app-shell-nav-link" + (active ? " active" : "")}
            onClick={onNavigate}
          >
            <ShellIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AppShell({ children }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { profile } = useBusinessProfile();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pageTitle = getPageTitle(location.pathname, location.search);
  const pageDetail = useMemo(
    () => getPageDetail(location.pathname, profile),
    [location.pathname, profile]
  );

  return (
    <div className="app-shell">
      <button
        type="button"
        className="app-shell-mobile-toggle"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <span />
        <span />
        <span />
      </button>

      {mobileOpen && (
        <button
          type="button"
          className="app-shell-mobile-backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <aside className={"app-shell-sidebar" + (mobileOpen ? " open" : "")}>
        <div className="app-shell-brand">
          <Link to="/" className="app-shell-logo" onClick={() => setMobileOpen(false)}>
            <img
              src="/scheduloop-logo-mark.svg"
              alt=""
              aria-hidden="true"
              className="app-shell-logo-mark"
            />
            <span>
              <strong>ScheduleLoop</strong>
              <small>Forecast to rota</small>
            </span>
          </Link>
        </div>

        <SidebarNav
          location={location}
          onNavigate={() => setMobileOpen(false)}
        />

        <div className="app-shell-account">
          <span className="app-shell-account-label">Signed in</span>
          <strong>{user?.email || "Manager"}</strong>
          <div className="app-shell-account-actions">
            <button
              type="button"
              className="app-shell-secondary-button"
              onClick={toggleTheme}
            >
              {theme === "dark" ? "Dark" : "Light"}
            </button>
            <button
              type="button"
              className="app-shell-secondary-button"
              onClick={logout}
            >
              Log out
            </button>
          </div>
        </div>
      </aside>

      <div className="app-shell-main">
        <header className="app-shell-topbar">
          <div>
            <p className="section-kicker">ScheduleLoop</p>
            <h1>{pageTitle}</h1>
          </div>
          <div className="app-shell-context-pill">{pageDetail}</div>
        </header>
        {children}
      </div>
    </div>
  );
}

export default AppShell;
