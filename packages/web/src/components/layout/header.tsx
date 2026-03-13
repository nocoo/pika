"use client";

import { useSession, signOut } from "next-auth/react";

export function Header() {
  const { data: session } = useSession();
  const user = session?.user;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
      <div />
      {user && (
        <div className="flex items-center gap-3">
          {user.image ? (
            <img
              src={user.image}
              alt=""
              className="h-7 w-7 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              {(user.email?.[0] ?? "?").toUpperCase()}
            </div>
          )}
          <span className="text-sm text-muted-foreground">{user.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
