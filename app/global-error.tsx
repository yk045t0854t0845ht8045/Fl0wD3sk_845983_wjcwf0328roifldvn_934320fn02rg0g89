"use client";

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalErrorPage({ reset }: GlobalErrorPageProps) {
  return (
    <html>
      <body className="bg-black">
        <main className="flex min-h-screen items-center justify-center bg-black px-6">
          <section className="w-full max-w-[420px] text-center">
            <h1 className="text-[24px] font-medium text-[#D8D8D8]">
              This page could not load
            </h1>
            <p className="mt-2 text-[13px] text-[#9A9A9A]">
              Reload to try again, or go back.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => reset()}
                className="h-[40px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] text-[13px] text-[#D8D8D8] transition-colors hover:bg-[#121212]"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => window.history.back()}
                className="h-[40px] rounded-[3px] border border-[#2E2E2E] bg-[#0A0A0A] text-[13px] text-[#D8D8D8] transition-colors hover:bg-[#121212]"
              >
                Back
              </button>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
