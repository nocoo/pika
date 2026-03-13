import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pika",
  description: "Replay and search your coding agent sessions",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
