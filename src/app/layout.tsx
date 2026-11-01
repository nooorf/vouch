import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { SiteHeader } from "@/components/site-header";
import { Container } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Vouch: pay on proof", template: "%s · Vouch" },
  description:
    "Vouch holds a client's payment in PayPal, checks each freelance delivery against the agreed brief, and releases money milestone by milestone, with the evidence on screen.",
};

export const viewport: Viewport = {
  themeColor: "#fbfbfb",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <footer className="mt-16 border-t border-line py-10 text-sm text-faint">
          <Container className="flex flex-col justify-between gap-2 sm:flex-row">
            <span>Vouch, built for the PayPal AI Hackathon 2026</span>
            <span>Runs on the PayPal sandbox. No real money moves.</span>
          </Container>
        </footer>
      </body>
    </html>
  );
}
