"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  LegalDocumentContent,
  LegalTableCell,
} from "@/lib/legal/content";

type LegalDocumentPageProps = {
  content: LegalDocumentContent;
};

function renderTableCell(cell: LegalTableCell, rowIndex: number, cellIndex: number) {
  const className = `${cell.mono ? "font-mono text-[11px]" : "text-[13px]"} leading-[1.6] text-[#D8D8D8]`;

  if (cell.href) {
    return (
      <Link
        key={`${rowIndex}-${cellIndex}-${cell.text}`}
        href={cell.href}
        target={cell.href.startsWith("http") ? "_blank" : undefined}
        rel={cell.href.startsWith("http") ? "noopener noreferrer" : undefined}
        className={`${className} break-all underline decoration-[#2E2E2E] underline-offset-4 hover:text-white`}
      >
        {cell.text}
      </Link>
    );
  }

  return (
    <span
      key={`${rowIndex}-${cellIndex}-${cell.text}`}
      className={className}
    >
      {cell.text}
    </span>
  );
}

export function LegalDocumentPage({ content }: LegalDocumentPageProps) {
  const [activeSectionId, setActiveSectionId] = useState(() => {
    const fallbackId = content.sections[0]?.id || "";

    if (typeof window === "undefined") {
      return fallbackId;
    }

    const hash = window.location.hash.replace(/^#/, "").trim();
    if (hash && content.sections.some((section) => section.id === hash)) {
      return hash;
    }

    return fallbackId;
  });

  const sectionIds = useMemo(
    () => content.sections.map((section) => section.id),
    [content.sections],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash.replace(/^#/, "").trim();
    if (hash && sectionIds.includes(hash)) {
      window.setTimeout(() => {
        window.document.getElementById(hash)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 80);
      return;
    }

    if (sectionIds[0]) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#${sectionIds[0]}`,
      );
    }
  }, [sectionIds]);

  useEffect(() => {
    if (typeof window === "undefined" || !sectionIds.length) return;

    const observers = sectionIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));

    if (!observers.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio);

        const topEntry = visibleEntries[0];
        if (!topEntry?.target?.id) return;

        const nextId = topEntry.target.id;
        setActiveSectionId((current) => {
          if (current === nextId) return current;
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}#${nextId}`,
          );
          return nextId;
        });
      },
      {
        rootMargin: "-18% 0px -58% 0px",
        threshold: [0.2, 0.4, 0.6, 0.8],
      },
    );

    observers.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
    };
  }, [sectionIds]);

  const handleNavClick = (sectionId: string) => {
    setActiveSectionId(sectionId);
      window.document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    if (typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#${sectionId}`,
      );
    }
  };

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-[#D8D8D8] md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1320px]">
        <header className="flowdesk-fade-up-soft rounded-[10px] border border-[#242424] bg-[linear-gradient(180deg,rgba(18,18,18,0.98),rgba(8,8,8,0.98))] px-5 py-6 md:px-8 md:py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-[860px]">
              <div className="flex items-center gap-4">
                <span className="relative block h-[54px] w-[54px] shrink-0">
                  <Image
                    src="/cdn/logos/logotipo_.svg"
                    alt="Flowdesk"
                    fill
                    sizes="54px"
                    className="object-contain"
                    priority
                  />
                </span>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[#8B8B8B]">
                    {content.badge}
                  </p>
                  <p className="mt-1 text-[12px] text-[#9D9D9D]">
                    Atualizado em {content.updatedAt}
                  </p>
                </div>
              </div>

              <h1 className="mt-6 max-w-[980px] text-[28px] font-medium leading-[1.08] text-[#F4F4F4] md:text-[40px]">
                {content.title}
              </h1>
              <p className="mt-4 max-w-[820px] text-[14px] leading-[1.7] text-[#A6A6A6] md:text-[15px]">
                {content.subtitle}
              </p>

              <div className="mt-6 space-y-3">
                {content.heroParagraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="max-w-[860px] text-[14px] leading-[1.75] text-[#C8C8C8]"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {content.relatedLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-[6px] border border-[#2E2E2E] bg-[#0A0A0A] px-4 py-2 text-[13px] text-[#D8D8D8] transition-colors hover:border-[#4A4A4A] hover:text-white"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flowdesk-fade-up-soft rounded-[10px] border border-[#242424] bg-[#0A0A0A] p-4 lg:sticky lg:top-6 lg:h-fit">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#8B8B8B]">
              Navegacao
            </p>
            <div className="thin-scrollbar mt-4 flex gap-2 overflow-x-auto lg:block lg:space-y-2 lg:overflow-visible">
              {content.sections.map((section) => {
                const active = activeSectionId === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => handleNavClick(section.id)}
                    className={`shrink-0 rounded-[6px] border px-3 py-2 text-left text-[12px] transition-colors lg:block lg:w-full ${
                      active
                        ? "border-[#D8D8D8] bg-[#111111] text-white"
                        : "border-[#2E2E2E] bg-transparent text-[#969696] hover:border-[#4A4A4A] hover:text-[#D8D8D8]"
                    }`}
                  >
                    {section.navLabel}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="space-y-5">
            {content.sections.map((section) => (
              <article
                key={section.id}
                id={section.id}
                className="flowdesk-fade-up-soft rounded-[10px] border border-[#242424] bg-[#0A0A0A] px-5 py-6 md:px-7"
                style={{ scrollMarginTop: "28px" }}
              >
                <h2 className="text-[22px] font-medium leading-[1.2] text-[#F4F4F4]">
                  {section.title}
                </h2>

                {section.intro ? (
                  <p className="mt-4 text-[14px] leading-[1.7] text-[#BFBFBF]">
                    {section.intro}
                  </p>
                ) : null}

                {section.paragraphs?.length ? (
                  <div className="mt-4 space-y-3">
                    {section.paragraphs.map((paragraph) => (
                      <p
                        key={paragraph}
                        className="text-[14px] leading-[1.75] text-[#C6C6C6]"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                ) : null}

                {section.bullets?.length ? (
                  <ul className="mt-4 space-y-2">
                    {section.bullets.map((item) => (
                      <li
                        key={item}
                        className="rounded-[6px] border border-[#1D1D1D] bg-[#0E0E0E] px-4 py-3 text-[13px] leading-[1.65] text-[#BDBDBD]"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {section.tables?.length ? (
                  <div className="mt-5 space-y-5">
                    {section.tables.map((table) => (
                      <div
                        key={`${section.id}-${table.caption || table.columns.join("-")}`}
                        className="overflow-hidden rounded-[8px] border border-[#242424]"
                      >
                        {table.caption ? (
                          <div className="border-b border-[#242424] bg-[#111111] px-4 py-3 text-[12px] text-[#A0A0A0]">
                            {table.caption}
                          </div>
                        ) : null}
                        <div className="thin-scrollbar overflow-x-auto">
                          <table className="min-w-full border-collapse">
                            <thead>
                              <tr className="bg-[#0E0E0E]">
                                {table.columns.map((column) => (
                                  <th
                                    key={column}
                                    className="border-b border-[#242424] px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.18em] text-[#8D8D8D]"
                                  >
                                    {column}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {table.rows.map((row, rowIndex) => (
                                <tr key={`${section.id}-row-${rowIndex}`} className="align-top">
                                  {row.map((cell, cellIndex) => (
                                    <td
                                      key={`${section.id}-cell-${rowIndex}-${cellIndex}`}
                                      className="border-b border-[#1B1B1B] px-4 py-4"
                                    >
                                      {renderTableCell(cell, rowIndex, cellIndex)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {section.note ? (
                  <div className="mt-5 rounded-[8px] border border-[#2E2E2E] bg-[#111111] px-4 py-4 text-[13px] leading-[1.7] text-[#BEBEBE]">
                    {section.note}
                  </div>
                ) : null}
              </article>
            ))}

            <article className="flowdesk-fade-up-soft rounded-[10px] border border-[#242424] bg-[#0A0A0A] px-5 py-6 md:px-7">
              <h2 className="text-[22px] font-medium text-[#F4F4F4]">
                Fontes oficiais e bases consultadas
              </h2>
              <div className="mt-5 space-y-3">
                {content.sources.map((source) => (
                  <div
                    key={source.href}
                    className="rounded-[8px] border border-[#1D1D1D] bg-[#0E0E0E] px-4 py-4"
                  >
                    <Link
                      href={source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[14px] font-medium text-[#F4F4F4] underline decoration-[#2E2E2E] underline-offset-4 hover:text-white"
                    >
                      {source.label}
                    </Link>
                    <p className="mt-2 text-[13px] leading-[1.7] text-[#A9A9A9]">
                      {source.note}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </div>
      </div>
    </main>
  );
}
