import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { D1AuthAdapter } from "./auth-adapter";
import { getD1Client } from "./d1";
import type { JWT } from "next-auth/jwt";
import type { Session, User } from "next-auth";

// ---------------------------------------------------------------------------
// Exported helpers (testable without next-auth runtime)
// ---------------------------------------------------------------------------

/** Determine whether to use __Secure- prefixed cookies. */
export function shouldUseSecureCookies(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.AUTH_URL?.startsWith("https://") === true ||
    process.env.USE_SECURE_COOKIES === "true"
  );
}

/** Persist user ID into the JWT token. */
export function jwtCallback({
  token,
  user,
}: {
  token: JWT;
  user?: User;
}): JWT {
  if (user?.id) {
    token.userId = user.id;
  }
  return token;
}

/** Expose user ID in the session object. */
export function sessionCallback({
  session,
  token,
}: {
  session: Session;
  token: JWT;
}): Session {
  if (token.userId && session.user) {
    session.user.id = token.userId as string;
  }
  return session;
}

// ---------------------------------------------------------------------------
// NextAuth configuration — function form (matches pew)
// ---------------------------------------------------------------------------
//
// Using `NextAuth((req) => config)` gives us access to the request object
// inside callbacks and ensures auth() works correctly in route handlers.
// `req` is a NextRequest from route handlers, or undefined from Server
// Components (no request context).
// ---------------------------------------------------------------------------

const useSecureCookies = shouldUseSecureCookies();

export const { handlers, signIn, signOut, auth } = NextAuth(() => ({
  adapter: D1AuthAdapter(getD1Client()),
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  // Cookie configuration for reverse proxy environments.
  // Without explicit config, @auth/core auto-detects __Secure- prefix based on
  // request protocol. Behind a TLS-terminating proxy that forwards HTTP internally,
  // the set (HTTPS) and read (HTTP) see different prefixes → session cookie mismatch.
  cookies: {
    pkceCodeVerifier: {
      name: useSecureCookies
        ? "__Secure-authjs.pkce.code_verifier"
        : "authjs.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    state: {
      name: useSecureCookies ? "__Secure-authjs.state" : "authjs.state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: useSecureCookies
        ? "__Secure-authjs.callback-url"
        : "authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    sessionToken: {
      name: useSecureCookies
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: useSecureCookies
        ? "__Host-authjs.csrf-token"
        : "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback,
  },
}));
