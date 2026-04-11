"use client";

import Script from "next/script";
import { AppErrorScreen } from "@/components/common/AppErrorScreen";

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalErrorPage({ reset }: GlobalErrorPageProps) {
  return (
    <html>
      <body className="bg-[#040404]">
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4997317332626224"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />

        <AppErrorScreen
          onRetry={() => reset()}
          onBack={() => window.history.back()}
        />
      </body>
    </html>
  );
}