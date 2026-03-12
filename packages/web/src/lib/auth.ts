import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { D1AuthAdapter } from "./auth-adapter.js";
import { getD1Client } from "./d1.js";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: D1AuthAdapter(() => getD1Client()),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
});
