"use client";

import { AppErrorScreen } from "@/components/common/AppErrorScreen";

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalErrorPage({ reset }: GlobalErrorPageProps) {
  return (
    <html>
      <body className="bg-[#040404]">
        <AppErrorScreen
          onRetry={() => reset()}
          onBack={() => window.history.back()}
        />
      </body>
    </html>
  );
}
