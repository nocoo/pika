/**
 * Navigation configuration for the dashboard.
 *
 * Pure data — no React dependency.
 * Imported by sidebar.tsx (adds icons) and breadcrumbs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavItemDef {
  href: string;
  label: string;
  /** Lucide icon name for lookup in sidebar.tsx */
  icon: string;
}

export interface NavGroupDef {
  label: string;
  items: NavItemDef[];
  defaultOpen?: boolean;
}

// ---------------------------------------------------------------------------
// Navigation groups
// ---------------------------------------------------------------------------

export const NAV_GROUPS: NavGroupDef[] = [
  {
    label: "Overview",
    defaultOpen: true,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
    ],
  },
  {
    label: "Browse",
    defaultOpen: true,
    items: [
      { href: "/dashboard/sessions", label: "Sessions", icon: "MessagesSquare" },
      { href: "/dashboard/search", label: "Search", icon: "Search" },
    ],
  },
  {
    label: "Settings",
    defaultOpen: false,
    items: [
      { href: "/dashboard/settings/tags", label: "Tags", icon: "Tags" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Route labels (used for breadcrumbs in app-shell)
// ---------------------------------------------------------------------------

export const ROUTE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  sessions: "Sessions",
  search: "Search",
  settings: "Settings",
  tags: "Tags",
};

export function breadcrumbsFromPathname(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const items: { label: string; href?: string }[] = [{ label: "Home", href: "/dashboard" }];

  let href = "";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    href += `/${seg}`;
    const isLast = i === segments.length - 1;
    const label = ROUTE_LABELS[seg] ?? seg.slice(0, 16);
    items.push(isLast ? { label } : { label, href });
  }

  return items;
}
