import { Menu } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { breadcrumbsFromPathname } from "@/lib/navigation";
import { Breadcrumbs } from "./breadcrumbs";
import { Sidebar } from "./sidebar";
import { SidebarProvider, useSidebar } from "./sidebar-context";
import { ThemeToggle } from "./theme-toggle";

interface AppShellProps {
  children: React.ReactNode;
}

function AppShellInner({ children }: AppShellProps) {
  const isMobile = useIsMobile();
  const { mobileOpen, setMobileOpen } = useSidebar();
  const { pathname } = useLocation();

  useEffect(() => {
    void pathname;
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const breadcrumbs = breadcrumbsFromPathname(pathname);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {!isMobile && <Sidebar />}

      {isMobile && mobileOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-zinc-950/50 backdrop-blur-xs appearance-none border-none p-0"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
          />
          <div className="fixed inset-y-0 left-0 z-50 w-[var(--sidebar-width)]">
            <Sidebar />
          </div>
        </>
      )}

      <main className="flex flex-1 flex-col min-h-screen min-w-0">
        <header className="flex h-14 shrink-0 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Menu
                  className="h-5 w-5"
                  aria-hidden="true"
                  strokeWidth={1.5}
                />
              </button>
            )}
            <Breadcrumbs items={breadcrumbs} />
          </div>
          <div className="flex items-center gap-1">
            <a
              href="https://github.com/nocoo/pika"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <svg
                className="h-[18px] w-[18px]"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.69-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.73-1.53-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11.06 11.06 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.24 2.75.12 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
              </svg>
              <span className="sr-only">GitHub repository</span>
            </a>
            <ThemeToggle />
          </div>
        </header>

        <div className="flex-1 px-2 pb-2 md:px-3 md:pb-3">
          <div className="h-full rounded-[var(--radius-card)] bg-card p-3 md:p-5 overflow-y-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppShellInner>{children}</AppShellInner>
    </SidebarProvider>
  );
}
