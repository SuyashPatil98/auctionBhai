import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { siteMode } from "@/lib/util/site-mode";
import { DemoBanner } from "@/components/layout/DemoBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const mode = siteMode();

export const metadata: Metadata =
  mode === "demo"
    ? {
        title: "LineUp Lab — fantasy football demo",
        description:
          "Portfolio demo of a private fantasy-football app built for the FIFA World Cup 2026. Sign in as any of four pre-seeded managers.",
      }
    : {
        title: "FiFantasy — World Cup 2026",
        description: "Private fantasy football for the FIFA World Cup 2026.",
      };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-screen flex flex-col bg-background text-foreground antialiased">
        {mode === "demo" && <DemoBanner />}
        {children}
      </body>
    </html>
  );
}
