import { Menu } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { breadcrumbsFromPathname } from "@/lib/navigation";
import { Breadcrumbs } from "./breadcrumbs";
import { GithubIcon } from "./github-icon";
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
              <GithubIcon className="h-[18px] w-[18px]" aria-hidden="true" />
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
