"use client";

import { AppErrorScreen } from "@/components/common/AppErrorScreen";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ reset }: ErrorPageProps) {
  return (
    <AppErrorScreen
      onRetry={() => reset()}
      onBack={() => window.history.back()}
    />
  );
}
