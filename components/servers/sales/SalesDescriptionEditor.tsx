"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bold,
  ChevronDown,
  Code2,
  Eye,
  ImagePlus,
  Italic,
  Link2,
  List,
  MoreHorizontal,
  Paintbrush,
  PlayCircle,
  Sparkles,
  Table2,
  Underline,
} from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { ServerButton } from "@/components/servers/ServerUi";

type DescriptionKind = "product" | "category";

type AiDescriptionResponse = {
  ok: boolean;
  message?: string;
  description?: string;
};

function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function stripBlockMarkdown(value: string) {
  return value
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*]\s+/gm, "");
}

function renderInlineMarkdown(value: string) {
  const parts: ReactNode[] = [];
  const pattern =
    /(!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|<u>(.*?)<\/u>|<mark(?:\s+data-color="(#[0-9a-fA-F]{6})")?>(.*?)<\/mark>|\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > cursor) {
      parts.push(value.slice(cursor, match.index));
    }

    if (match[2] !== undefined) {
      parts.push(
        <span key={`image-${match.index}`} className="font-semibold text-[#EDEDED]">
          [imagem: {match[2] || "sem descricao"}]
        </span>,
      );
    } else if (match[4] !== undefined) {
      parts.push(
        <span key={`link-${match.index}`} className="font-semibold text-[#F2F2F2] underline underline-offset-4">
          {match[4]}
        </span>,
      );
    } else if (match[6] !== undefined) {
      parts.push(
        <span key={`underline-${match.index}`} className="underline decoration-[#EDEDED] underline-offset-4">
          {renderInlineMarkdown(match[6])}
        </span>,
      );
    } else if (match[8] !== undefined) {
      const color = isHexColor(match[7] || "") ? match[7] : "#F5D04C";
      parts.push(
        <mark
          key={`mark-${match.index}`}
          className="rounded-[5px] px-[4px] py-[1px] font-medium text-[#080808]"
          style={{ backgroundColor: color }}
        >
          {renderInlineMarkdown(match[8])}
        </mark>,
      );
    } else if (match[9] !== undefined) {
      parts.push(
        <strong key={`bold-${match.index}`} className="font-semibold text-[#F4F4F4]">
          {renderInlineMarkdown(match[9])}
        </strong>,
      );
    } else if (match[10] !== undefined) {
      parts.push(
        <em key={`italic-${match.index}`} className="italic text-[#DFDFDF]">
          {renderInlineMarkdown(match[10])}
        </em>,
      );
    } else if (match[11] !== undefined) {
      parts.push(
        <code key={`code-${match.index}`} className="rounded-[7px] bg-[#151515] px-[5px] py-[2px] text-[12px] text-[#F1F1F1]">
          {match[11]}
        </code>,
      );
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    parts.push(value.slice(cursor));
  }

  return parts.length ? parts : value;
}

function parseMarkdownTable(block: string) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2 || !lines.every((line) => line.includes("|"))) return null;
  if (!/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[1])) return null;

  const rows = lines.map((line) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim()),
  );
  return {
    headers: rows[0],
    rows: rows.slice(2),
  };
}

function MarkdownPreview({ value }: { value: string }) {
  const trimmed = value.trim();

  if (!trimmed) {
    return (
      <p className="text-[13px] leading-[1.65] text-[#686868]">
        A descricao aparecera aqui conforme voce digitar.
      </p>
    );
  }

  return (
    <div className="space-y-[10px]">
      {trimmed.split(/\n{2,}/).map((block, index) => {
        const table = parseMarkdownTable(block);
        if (table) {
          return (
            <div
              key={`${index}-${block}`}
              className="overflow-hidden rounded-[12px] border border-[#242424]"
            >
              <table className="w-full border-collapse text-left text-[12px] text-[#CFCFCF]">
                <thead className="bg-[#151515] text-[#F1F1F1]">
                  <tr>
                    {table.headers.map((header, headerIndex) => (
                      <th key={`${header}-${headerIndex}`} className="border-r border-[#252525] px-[10px] py-[8px] last:border-r-0">
                        {renderInlineMarkdown(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, rowIndex) => (
                    <tr key={`${rowIndex}-${row.join("|")}`} className="border-t border-[#202020]">
                      {table.headers.map((_, cellIndex) => (
                        <td key={cellIndex} className="border-r border-[#202020] px-[10px] py-[8px] last:border-r-0">
                          {renderInlineMarkdown(row[cellIndex] || "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.startsWith("```") && block.endsWith("```")) {
          return (
            <pre
              key={`${index}-${block}`}
              className="overflow-x-auto rounded-[12px] border border-[#1D1D1D] bg-[#111] p-[12px] text-[12px] leading-[1.6] text-[#DCDCDC]"
            >
              {block.replace(/^```\n?/, "").replace(/\n?```$/, "")}
            </pre>
          );
        }

        const headingMatch = block.match(/^(#{1,3})\s+([\s\S]+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const HeadingTag = (`h${level}` as "h1" | "h2" | "h3");
          const sizeClass =
            level === 1
              ? "text-[22px] leading-[1.25]"
              : level === 2
                ? "text-[18px] leading-[1.35]"
                : "text-[15px] leading-[1.45]";
          return (
            <HeadingTag
              key={`${index}-${block}`}
              className={`break-words font-semibold text-[#F1F1F1] ${sizeClass}`}
            >
              {renderInlineMarkdown(headingMatch[2])}
            </HeadingTag>
          );
        }

        if (/^[-*]\s+/m.test(block)) {
          return (
            <ul key={`${index}-${block}`} className="space-y-[6px] pl-[18px] text-[13px] leading-[1.6] text-[#CFCFCF]">
              {block.split("\n").map((line, lineIndex) => {
                const item = line.replace(/^[-*]\s+/, "").trim();
                return item ? (
                  <li key={`${lineIndex}-${line}`} className="list-disc pl-[2px]">
                    {renderInlineMarkdown(item)}
                  </li>
                ) : null;
              })}
            </ul>
          );
        }

        return (
          <p
            key={`${index}-${block}`}
            className="whitespace-pre-wrap break-words text-[13px] leading-[1.65] text-[#CFCFCF]"
          >
            {renderInlineMarkdown(block)}
          </p>
        );
      })}
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flowdesk-server-button inline-flex h-[36px] w-[36px] items-center justify-center rounded-[12px] border border-[#202020] bg-[#101010] text-[#BDBDBD] transition hover:border-[#353535] hover:bg-[#161616] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

export function SalesDescriptionEditor({
  guildId,
  kind,
  title,
  value,
  onChange,
  disabled = false,
  maxLength,
  placeholder,
}: {
  guildId: string;
  kind: DescriptionKind;
  title: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  maxLength: number;
  placeholder: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const historyRef = useRef<{ past: string[]; future: string[] }>({
    past: [],
    future: [],
  });
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [highlightColor, setHighlightColor] = useState("#F5D04C");

  const safeHighlightColor = useMemo(
    () => (isHexColor(highlightColor) ? highlightColor : "#F5D04C"),
    [highlightColor],
  );

  const restoreTextareaSelection = useCallback((position: number) => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const safePosition = Math.max(0, Math.min(position, textarea.value.length));
      textarea.focus();
      textarea.setSelectionRange(safePosition, safePosition);
    });
  }, []);

  const commitEditorValue = useCallback(
    (nextValue: string, options: { remember?: boolean; selectionPosition?: number } = {}) => {
      const clippedValue = nextValue.slice(0, maxLength);
      if (clippedValue === value) return;

      if (options.remember !== false) {
        const history = historyRef.current;
        if (history.past[history.past.length - 1] !== value) {
          history.past = [...history.past, value].slice(-80);
        }
        history.future = [];
      }

      onChange(clippedValue);
      if (typeof options.selectionPosition === "number") {
        restoreTextareaSelection(options.selectionPosition);
      }
    },
    [maxLength, onChange, restoreTextareaSelection, value],
  );

  const undoEditorValue = useCallback(
    (direction: "undo" | "redo") => {
      const history = historyRef.current;
      const source = direction === "undo" ? history.past : history.future;
      if (!source.length) return false;

      const nextValue = source[source.length - 1];
      if (direction === "undo") {
        history.past = source.slice(0, -1);
        history.future = [value, ...history.future].slice(0, 80);
      } else {
        history.future = source.slice(1);
        history.past = [...history.past, value].slice(-80);
      }

      onChange(nextValue);
      restoreTextareaSelection(nextValue.length);
      return true;
    },
    [onChange, restoreTextareaSelection, value],
  );

  const applyFormat = useCallback(
    (format: "paragraph" | "heading1" | "heading2" | "heading3" | "bold" | "italic" | "underline" | "link" | "image" | "video" | "table" | "list" | "code" | "highlight") => {
      if (disabled) return;

      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? value.length;
      const end = textarea?.selectionEnd ?? value.length;
      const selected = value.slice(start, end);
      const fallbackText =
        format === "link"
          ? "texto do link"
          : format === "image"
            ? "descricao da imagem"
            : format === "video"
              ? "video"
            : format === "code"
              ? "codigo"
              : "texto";
      const source = selected || fallbackText;
      let replacement = source;

      if (format === "paragraph") {
        replacement = stripBlockMarkdown(source);
      } else if (format === "heading1") {
        replacement = stripBlockMarkdown(source)
          .split("\n")
          .map((line) => (line.trim() ? `# ${line.trim()}` : line))
          .join("\n");
      } else if (format === "heading2") {
        replacement = stripBlockMarkdown(source)
          .split("\n")
          .map((line) => (line.trim() ? `## ${line.trim()}` : line))
          .join("\n");
      } else if (format === "heading3") {
        replacement = stripBlockMarkdown(source)
          .split("\n")
          .map((line) => (line.trim() ? `### ${line.trim()}` : line))
          .join("\n");
      } else if (format === "bold") {
        replacement = `**${source}**`;
      } else if (format === "italic") {
        replacement = `_${source}_`;
      } else if (format === "underline") {
        replacement = `<u>${source}</u>`;
      } else if (format === "highlight") {
        replacement = `<mark data-color="${safeHighlightColor}">${source}</mark>`;
      } else if (format === "link") {
        replacement = `[${source}](https://exemplo.com)`;
      } else if (format === "image") {
        replacement = `![${source}](https://exemplo.com/imagem.png)`;
      } else if (format === "video") {
        replacement = `[${source}](https://exemplo.com/video.mp4)`;
      } else if (format === "table") {
        replacement = `| Item | Detalhe |\n| --- | --- |\n| ${source} |  |\n`;
      } else if (format === "list") {
        replacement = source
          .split("\n")
          .map((line) => `- ${line.replace(/^[-*]\s+/, "")}`)
          .join("\n");
      } else if (format === "code") {
        replacement = `\`${source}\``;
      }

      const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
      const selectionStart = Math.min(start + replacement.length, maxLength);
      commitEditorValue(nextValue, { selectionPosition: selectionStart });

      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(selectionStart, selectionStart);
      });
    },
    [commitEditorValue, disabled, maxLength, safeHighlightColor, value],
  );

  const generateDescription = useCallback(async () => {
    if (disabled || !title.trim() || isGenerating) return;

    setIsGenerating(true);
    setAiMessage(null);

    try {
      const response = await fetch("/api/auth/me/guilds/sales-description-ai", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId,
          kind,
          title,
          currentDescription: value,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as AiDescriptionResponse;

      if (!response.ok || !payload.ok || !payload.description) {
        throw new Error(payload.message || "Falha ao gerar descricao com IA.");
      }

      commitEditorValue(payload.description, {
        selectionPosition: payload.description.slice(0, maxLength).length,
      });
    } catch (error) {
      setAiMessage(
        error instanceof Error ? error.message : "Falha ao gerar descricao com IA.",
      );
    } finally {
      setIsGenerating(false);
    }
  }, [commitEditorValue, disabled, guildId, isGenerating, kind, maxLength, title, value]);

  return (
    <div className="mt-[10px] overflow-hidden rounded-[16px] border border-[#252525] bg-[#0D0D0D]">
      <div className="flex flex-wrap items-center gap-[6px] bg-[#111] px-[10px] py-[8px] text-[#BDBDBD]">
        <button
          type="button"
          onClick={() => applyFormat("paragraph")}
          disabled={disabled}
          className="flowdesk-server-button rounded-[10px] px-[10px] py-[7px] text-[13px] text-[#CFCFCF] transition hover:bg-[#191919] disabled:cursor-not-allowed disabled:opacity-45"
        >
          Paragrafo <ChevronDown className="ml-[6px] inline h-[14px] w-[14px]" />
        </button>
        <button
          type="button"
          onClick={() => applyFormat("heading1")}
          disabled={disabled}
          className="flowdesk-server-button h-[36px] rounded-[10px] px-[9px] text-[13px] font-semibold text-[#CFCFCF] transition hover:bg-[#191919] disabled:cursor-not-allowed disabled:opacity-45"
          title="Titulo grande"
        >
          H1
        </button>
        <button
          type="button"
          onClick={() => applyFormat("heading2")}
          disabled={disabled}
          className="flowdesk-server-button h-[36px] rounded-[10px] px-[9px] text-[13px] font-semibold text-[#CFCFCF] transition hover:bg-[#191919] disabled:cursor-not-allowed disabled:opacity-45"
          title="Titulo medio"
        >
          H2
        </button>
        <button
          type="button"
          onClick={() => applyFormat("heading3")}
          disabled={disabled}
          className="flowdesk-server-button h-[36px] rounded-[10px] px-[9px] text-[13px] font-semibold text-[#CFCFCF] transition hover:bg-[#191919] disabled:cursor-not-allowed disabled:opacity-45"
          title="Titulo pequeno"
        >
          H3
        </button>
        <IconButton label="Negrito" onClick={() => applyFormat("bold")} disabled={disabled}>
          <Bold className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton label="Italico" onClick={() => applyFormat("italic")} disabled={disabled}>
          <Italic className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton label="Sublinhado" onClick={() => applyFormat("underline")} disabled={disabled}>
          <Underline className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton label="Destaque" onClick={() => applyFormat("highlight")} disabled={disabled}>
          <Paintbrush className="h-[16px] w-[16px]" />
        </IconButton>
        <label
          className="flowdesk-server-button inline-flex h-[36px] w-[36px] items-center justify-center rounded-[12px] border border-[#202020] bg-[#101010] transition hover:border-[#353535] hover:bg-[#161616]"
          title="Cor do destaque"
        >
          <span
            className="h-[16px] w-[16px] rounded-full border border-[rgba(255,255,255,0.28)]"
            style={{ backgroundColor: safeHighlightColor }}
          />
          <input
            type="color"
            value={safeHighlightColor}
            onChange={(event) => setHighlightColor(event.target.value)}
            disabled={disabled}
            className="sr-only"
            aria-label="Cor do destaque"
          />
        </label>
        <span className="mx-[4px] h-[24px] w-px bg-[#252525]" />
        <IconButton label="Lista" onClick={() => applyFormat("list")} disabled={disabled}>
          <List className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton label="Link" onClick={() => applyFormat("link")} disabled={disabled}>
          <Link2 className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton label="Imagem" onClick={() => applyFormat("image")} disabled={disabled}>
          <ImagePlus className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton label="Video" onClick={() => applyFormat("video")} disabled={disabled}>
          <PlayCircle className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton label="Tabela" onClick={() => applyFormat("table")} disabled={disabled}>
          <Table2 className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton label="Mais opcoes" disabled={disabled}>
          <MoreHorizontal className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton label="Codigo" onClick={() => applyFormat("code")} disabled={disabled}>
          <Code2 className="h-[16px] w-[16px]" />
        </IconButton>
        <IconButton
          label={isPreviewOpen ? "Ocultar preview" : "Mostrar preview"}
          onClick={() => setIsPreviewOpen((current) => !current)}
          disabled={disabled}
        >
          <Eye className="h-[16px] w-[16px]" />
        </IconButton>
        <ServerButton
          onClick={() => void generateDescription()}
          disabled={disabled || !title.trim() || isGenerating}
          size="sm"
          className="ml-auto h-[34px]"
        >
          {isGenerating ? <ButtonLoader size={14} /> : <Sparkles className="h-[15px] w-[15px]" />}
          IA
        </ServerButton>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => commitEditorValue(event.target.value)}
        onKeyDown={(event) => {
          const key = event.key.toLowerCase();
          const isModifier = event.ctrlKey || event.metaKey;
          if (!isModifier || event.altKey) return;

          if (key === "z" && !event.shiftKey) {
            if (undoEditorValue("undo")) event.preventDefault();
          } else if (key === "y" || (key === "z" && event.shiftKey)) {
            if (undoEditorValue("redo")) event.preventDefault();
          }
        }}
        maxLength={maxLength}
        rows={9}
        disabled={disabled}
        placeholder={placeholder}
        className="flowdesk-description-textarea min-h-[224px] w-full resize-y bg-transparent px-[14px] py-[14px] text-[14px] leading-[1.65] text-[#EDEDED] outline-none placeholder:text-[#5D5D5D] focus:bg-transparent disabled:cursor-not-allowed disabled:opacity-60"
      />
      {aiMessage ? (
        <div className="border-t border-[#241A12] bg-[#130D08] px-[14px] py-[10px] text-[12px] text-[#EFB47B]">
          {aiMessage}
        </div>
      ) : null}
      {isPreviewOpen ? (
        <div className="border-t border-[#171717] bg-[#0A0A0A] px-[14px] py-[14px]">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#666]">
            Previa da descricao
          </p>
          <div className="mt-[8px]">
            <MarkdownPreview value={value} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
