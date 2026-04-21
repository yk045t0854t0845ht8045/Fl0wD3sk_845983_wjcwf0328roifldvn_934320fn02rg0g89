import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";

import { AdsenseScript } from "@/components/ads/AdsenseScript";
import { CookieConsentManager } from "@/components/cookies/CookieConsentManager";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { FlowCwvStructuredData } from "@/components/seo/FlowCwvStructuredData";
import { COOKIE_CONSENT_COOKIE_NAME } from "@/lib/cookies/consent";
import {
  buildFlowCwvSiteGraph,
  buildFlowCwvSiteMetadata,
} from "@/lib/seo/flowCwv";
import { RoutePrefetcher } from "@/components/RoutePrefetcher";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = buildFlowCwvSiteMetadata();

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialConsentValue =
    cookieStore.get(COOKIE_CONSENT_COOKIE_NAME)?.value ?? null;

  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta name="theme-color" content="#040404" />
        <link rel="dns-prefetch" href="//cdn.discordapp.com" />
        <link rel="dns-prefetch" href="//media.discordapp.net" />
        <link rel="preconnect" href="https://cdn.discordapp.com" crossOrigin="" />
        <link rel="preconnect" href="https://media.discordapp.net" crossOrigin="" />
      </head>
      <body className="min-h-full flex flex-col">
        <AdsenseScript />
        <FlowCwvStructuredData
          id="flowcwv-site-graph"
          payload={buildFlowCwvSiteGraph()}
        />
        <NotificationsProvider>
          <RoutePrefetcher />
          {children}
          <CookieConsentManager initialConsentValue={initialConsentValue} />
        </NotificationsProvider>
      </body>
    </html>
  );
}
