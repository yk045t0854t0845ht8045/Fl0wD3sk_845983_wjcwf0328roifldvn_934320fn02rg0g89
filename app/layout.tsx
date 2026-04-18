import type { Metadata } from "next";
import Script from "next/script";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";

import { CookieConsentManager } from "@/components/cookies/CookieConsentManager";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { COOKIE_CONSENT_COOKIE_NAME } from "@/lib/cookies/consent";
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

export const metadata: Metadata = {
  title: "Flowdesk",
  description: "Login do painel Flowdesk",
};

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
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4997317332626224"
          crossOrigin="anonymous"
          strategy="afterInteractive"
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
