"use client";

import Script from "next/script";
import { AppErrorScreen } from "@/components/common/AppErrorScreen";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ reset }: ErrorPageProps) {
  return (
    <>
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
    </>
  );
}