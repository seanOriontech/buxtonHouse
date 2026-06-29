"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = { href: string; label: string };
type NavSection = { heading: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    heading: "Insights",
    items: [
      { href: "/", label: "Overview" },
      { href: "/category-overview", label: "Category breakdown" },
      { href: "/trends", label: "Trends" },
      { href: "/hot-water-ring", label: "HW Ring Main" },
      { href: "/occupancy", label: "Occupancy" },
    ],
  },
  {
    heading: "Utilities",
    items: [
      { href: "/utilities/budget", label: "Budget" },
      { href: "/utilities/apartment-living", label: "Apartment Living" },
      { href: "/utilities/apartment-insights", label: "Apartment Insights" },
      { href: "/utilities/communal-living", label: "Communal Living" },
      { href: "/utilities/communal-insights", label: "Communal Insights" },
    ],
  },
  {
    heading: "Catalogue",
    items: [
      { href: "/rooms", label: "Rooms" },
      { href: "/rooms-by-type", label: "Rooms by type" },
      { href: "/meters", label: "Meters" },
      { href: "/aux-tags", label: "Aux Tags" },
      { href: "/living-types", label: "Living types" },
      { href: "/room-types", label: "Room types" },
    ],
  },
  {
    heading: "Billing",
    items: [
      { href: "/tariffs", label: "Tariffs" },
      { href: "/allowance-periods", label: "Rates" },
    ],
  },
];

const STORAGE_KEY = "sidenav.collapsed";
const THEME_KEY = "theme";
const EXPANDED_W = "15rem";
const COLLAPSED_W = "0px";

type Theme = "dark" | "light";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light", theme === "light");
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function setSidenavWidth(collapsed: boolean) {
  // Only override on md+. On small screens the CSS default keeps it at 0.
  if (typeof window === "undefined") return;
  if (window.matchMedia("(min-width: 768px)").matches) {
    document.documentElement.style.setProperty("--sidenav-w", collapsed ? COLLAPSED_W : EXPANDED_W);
  } else {
    document.documentElement.style.removeProperty("--sidenav-w");
  }
}

export function SideNav() {
  const pathname = usePathname() ?? "/";
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");

  // Sync theme state with whatever the pre-paint script already applied.
  useEffect(() => {
    const stored = readStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  function toggleTheme() {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch {}
      return next;
    });
  }

  // Restore state on mount + react to viewport changes.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const initial = stored === "1";
    setCollapsed(initial);
    setSidenavWidth(initial);
    const mql = window.matchMedia("(min-width: 768px)");
    const handler = () => setSidenavWidth(collapsed);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSidenavWidth(collapsed);
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  return (
    <>
      {/* Floating reopener — only visible when collapsed. */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Open navigation"
          className="fixed left-3 top-3 z-40 hidden h-9 w-9 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950/90 text-neutral-300 backdrop-blur hover:border-neutral-600 hover:text-white md:flex"
        >
          {/* hamburger glyph */}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="7"  x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
      )}

      <aside
        className={
          "fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-neutral-800 bg-neutral-950/95 backdrop-blur transition-transform duration-200 md:flex " +
          (collapsed ? "-translate-x-full" : "translate-x-0")
        }
      >
        <div className="flex h-14 items-center justify-between border-b border-neutral-800 px-5">
          <Link href="/" className="font-semibold tracking-tight">
            Buxton <span className="text-emerald-400">Utilities</span>
          </Link>
          <button
            onClick={() => setCollapsed(true)}
            aria-label="Collapse navigation"
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-900 hover:text-white"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 6 9 12 15 18" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {SECTIONS.map((section) => (
            <div key={section.heading} className="mb-6 last:mb-0">
              <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
                {section.heading}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={
                          "block rounded-md px-2 py-1.5 text-base transition-colors " +
                          (active
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "text-neutral-300 hover:bg-neutral-900 hover:text-white")
                        }
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Theme toggle pinned to the bottom of the sidebar */}
        <div className="border-t border-neutral-800 px-3 py-3">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "lite" : "dark"} mode`}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-300 transition-colors hover:bg-neutral-900 hover:text-white"
          >
            <span className="inline-flex items-center gap-2">
              {theme === "dark" ? (
                /* sun icon */
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <line x1="12" y1="2" x2="12" y2="5" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                  <line x1="2"  y1="12" x2="5"  y2="12" />
                  <line x1="19" y1="12" x2="22" y2="12" />
                  <line x1="4.5"  y1="4.5"  x2="6.5"  y2="6.5" />
                  <line x1="17.5" y1="17.5" x2="19.5" y2="19.5" />
                  <line x1="4.5"  y1="19.5" x2="6.5"  y2="17.5" />
                  <line x1="17.5" y1="6.5"  x2="19.5" y2="4.5" />
                </svg>
              ) : (
                /* moon icon */
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
              <span>{theme === "dark" ? "Lite mode" : "Dark mode"}</span>
            </span>
            <span className="text-xs text-neutral-500">{theme === "dark" ? "off" : "on"}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
