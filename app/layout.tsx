import type { Metadata } from "next";
// Bundled with the app, so builds never depend on reaching Google Fonts.
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Guardrails — Acme Outdoor",
  description: "Plain-English rules that every Ryze agent action is checked against, in chat and over MCP.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
