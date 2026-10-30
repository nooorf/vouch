import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { SandboxBanner, SiteHeader } from "@/components/site-header";
import { Container } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Vouch: pay on proof", template: "%s · Vouch" },
  description:
    "Vouch holds a client's payment in PayPal, checks each freelance delivery against the agreed brief, and releases money milestone by milestone, with the evidence on screen.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f12" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SandboxBanner />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line py-8 text-sm text-muted">
          <Container className="flex flex-col justify-between gap-2 sm:flex-row">
            <span>Vouch · built for the PayPal AI Hackathon 2026</span>
            <span>Runs on the PayPal sandbox. No real money moves.</span>
          </Container>
        </footer>
      </body>
    </html>
  );
}
