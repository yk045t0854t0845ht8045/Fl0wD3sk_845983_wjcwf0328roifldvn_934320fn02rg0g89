
"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  GripVertical,
  ImageIcon,
  Link2,
  List,
  Minus,
  Plus,
  Shapes,
  Trash2,
} from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import {
  countTicketPanelFunctionButtons,
  createTicketPanelComponentByType,
  createTicketPanelComponentId,
  createTicketPanelContainerChildByType,
  createTicketPanelContentAccessoryByType,
  normalizeTicketPanelLayout,
  type TicketPanelButtonStyle,
  type TicketPanelComponent,
  type TicketPanelComponentType,
  type TicketPanelContainerChild,
  type TicketPanelContainerComponent,
  type TicketPanelContentAccessory,
  type TicketPanelContentAccessoryType,
  type TicketPanelContentComponent,
  type TicketPanelLayout,
  type TicketPanelSelectComponent,
  type TicketPanelSelectOption,
  type TicketPanelSeparatorComponent,
} from "@/lib/servers/ticketPanelBuilder";

type Props = {
  guildId: string;
  value: TicketPanelLayout;
  onChange: (next: TicketPanelLayout) => void;
  disabled?: boolean;
  canSendEmbed?: boolean;
  isSendingEmbed?: boolean;
  onSendEmbed?: () => void;
};

type Scope = { parentId: string | null; componentId: string };
type MenuAnchor = {
  bottom: number;
  left: number;
  right: number;
  top: number;
  width: number;
};
type GuildEmojiSuggestion = {
  id: string;
  name: string;
  animated: boolean;
  url: string;
};
type EmojiAutocompleteState = {
  scope: Scope;
  query: string;
  replaceStart: number;
  replaceEnd: number;
  anchor: MenuAnchor;
};
type OpenMenu =
  | { kind: "root" }
  | { kind: "container"; containerId: string }
  | { kind: "accessory"; scope: Scope }
  | null;
type DragState =
  | { kind: "root"; componentId: string }
  | { kind: "child"; parentId: string; componentId: string }
  | null;

type ActionComponent = Extract<TicketPanelContainerChild | TicketPanelComponent, { type: "button" | "link_button" | "select" }>;

type MenuItem<T extends string> = {
  value: T;
  label: string;
  description: string;
  icon: typeof AlignLeft;
};

const ROOT_ITEMS: MenuItem<TicketPanelComponentType>[] = [
  { value: "content", label: "Conteudo", description: "Bloco de texto com acessorio lateral.", icon: AlignLeft },
  { value: "container", label: "Container", description: "Container vazio para montar o embed do seu jeito.", icon: List },
  { value: "image", label: "Imagem", description: "Imagem grande dentro da mensagem.", icon: ImageIcon },
  { value: "file", label: "Arquivo", description: "Anexo ou arquivo destacado.", icon: FileText },
  { value: "separator", label: "Separador", description: "Cria respiro visual entre blocos.", icon: Minus },
  { value: "button", label: "Botao", description: "Acao principal dentro da mensagem.", icon: Plus },
  { value: "link_button", label: "Botao de link", description: "CTA externo com URL propria.", icon: Link2 },
  { value: "select", label: "Menu de selecao", description: "Lista de opcoes para atendimento.", icon: ChevronDown },
];

const CHILD_ITEMS = ROOT_ITEMS.filter((item) => item.value !== "container") as MenuItem<Exclude<TicketPanelComponentType, "container">>[];
const ACCESSORY_ITEMS: MenuItem<TicketPanelContentAccessoryType>[] = [
  { value: "button", label: "Botao", description: "Acao do lado direito do texto.", icon: Plus },
  { value: "link_button", label: "Botao de link", description: "Link lateral ao lado do texto.", icon: Link2 },
  { value: "thumbnail", label: "Miniatura", description: "Miniatura posicionada na direita.", icon: ImageIcon },
];

const BUTTON_STYLES: Array<{ value: TicketPanelButtonStyle; label: string; preview: string }> = [
  { value: "primary", label: "Primario", preview: "border-[#5865F2] bg-[#5865F2] text-white" },
  { value: "secondary", label: "Secundario", preview: "border-[#4A4D55] bg-[#4A4D55] text-white" },
  { value: "success", label: "Sucesso", preview: "border-[#2D7D46] bg-[#2D7D46] text-white" },
  { value: "danger", label: "Perigo", preview: "border-[#A1373B] bg-[#A1373B] text-white" },
];

const PRESET_ACCENT_COLORS = ["#5865F2", "#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#9B5CFF"];
const CUSTOM_EMOJI_REGEX = /<(a?):([a-zA-Z0-9_]+):(\d{17,20})>/g;
const INLINE_MARKDOWN_REGEX = /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;
const emojiPreviewUrlCache = new Map<string, string | null>();
const guildEmojiAutocompleteCache = new Map<string, GuildEmojiSuggestion[]>();

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function scopeKey(scope: Scope) {
  return scope.parentId ? `${scope.parentId}:${scope.componentId}` : scope.componentId;
}

function isAction(component: TicketPanelContainerChild | TicketPanelComponent): component is ActionComponent {
  return component.type === "button" || component.type === "link_button" || component.type === "select";
}

function splitCustomEmojiTokens(text: string) {
  const tokens: Array<
    | { type: "text"; value: string }
    | { type: "emoji"; animated: boolean; name: string; id: string; raw: string }
  > = [];

  let lastIndex = 0;
  for (const match of text.matchAll(CUSTOM_EMOJI_REGEX)) {
    const fullMatch = match[0];
    const animatedFlag = match[1];
    const name = match[2];
    const id = match[3];
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      tokens.push({
        type: "text",
        value: text.slice(lastIndex, matchIndex),
      });
    }

    tokens.push({
      type: "emoji",
      animated: animatedFlag === "a",
      name,
      id,
      raw: fullMatch,
    });
    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: "text",
      value: text.slice(lastIndex),
    });
  }

  return tokens.length ? tokens : [{ type: "text" as const, value: text }];
}

function normalizeExternalUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function getEmojiAutocompleteMatch(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(?:^|[\s([{])(<a?:[a-zA-Z0-9_]{0,32}|:[a-zA-Z0-9_]{0,32})$/);
  if (!match) {
    return null;
  }

  const token = match[1];
  const query = token.startsWith(":")
    ? token.slice(1)
    : token.replace(/^<a?:/, "");

  return {
    query,
    replaceStart: cursor - token.length,
    replaceEnd: cursor,
  };
}

function CustomEmojiPreview({
  guildId,
  emojiId,
  name,
  animated,
  raw,
}: {
  guildId: string;
  emojiId: string;
  name: string;
  animated: boolean;
  raw: string;
}) {
  const cacheKey = `${guildId}:${emojiId}:${animated ? "a" : "s"}`;
  const cachedEmojiUrl = emojiPreviewUrlCache.has(cacheKey)
    ? emojiPreviewUrlCache.get(cacheKey)
    : undefined;
  const [fetchedEmojiUrl, setFetchedEmojiUrl] = useState<string | null | undefined>(
    cachedEmojiUrl,
  );
  const emojiUrl = cachedEmojiUrl !== undefined ? cachedEmojiUrl : fetchedEmojiUrl;

  useEffect(() => {
    let isMounted = true;

    if (!guildId || !emojiId) {
      return;
    }

    if (cachedEmojiUrl !== undefined) {
      return;
    }

    const controller = new AbortController();

    const loadEmoji = async () => {
      try {
        const params = new URLSearchParams({
          guildId,
          emojiId,
        });

        const response = await fetch(
          `/api/auth/me/guilds/custom-emoji?${params.toString()}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; url?: string | null }
          | null;

        const resolvedUrl =
          response.ok && payload?.ok && typeof payload.url === "string"
            ? payload.url
            : null;

        emojiPreviewUrlCache.set(cacheKey, resolvedUrl);
        if (isMounted) {
          setFetchedEmojiUrl(resolvedUrl);
        }
      } catch {
        emojiPreviewUrlCache.set(cacheKey, null);
        if (isMounted) {
          setFetchedEmojiUrl(null);
        }
      }
    };

    void loadEmoji();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [cacheKey, cachedEmojiUrl, emojiId, guildId]);

  if (!emojiUrl) {
    return <span>{raw}</span>;
  }

  return (
    <img
      src={emojiUrl}
      alt={`:${name}:`}
      className="inline-block h-[1.18em] w-[1.18em] align-[-0.22em] object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.22)]"
      loading="lazy"
      draggable={false}
      data-animated={animated ? "true" : "false"}
    />
  );
}

function InlineMarkdownText({
  text,
  guildId,
  emphasized = false,
}: {
  text: string;
  guildId: string;
  emphasized?: boolean;
}) {
  const tokens = useMemo(() => splitCustomEmojiTokens(text), [text]);

  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === "emoji") {
          return (
            <CustomEmojiPreview
              key={`${guildId}-${token.id}-${index}`}
              guildId={guildId}
              emojiId={token.id}
              animated={token.animated}
              name={token.name}
              raw={token.raw}
            />
          );
        }

        if (emphasized) {
          return (
            <strong
              key={`${token.value}-${index}`}
              className="font-semibold text-[#F2F3F5]"
            >
              {token.value}
            </strong>
          );
        }

        return <span key={`${token.value}-${index}`}>{token.value}</span>;
      })}
    </>
  );
}

function renderInlineMarkdown(text: string, guildId: string) {
  return text
    .split(INLINE_MARKDOWN_REGEX)
    .filter((segment) => segment.length > 0)
    .map((segment, index) => {
      if (/^`[^`]+`$/.test(segment)) {
        return (
          <code
            key={`${segment}-${index}`}
            className="rounded-[8px] border border-[#2A2C31] bg-[#111216] px-[6px] py-[2px] text-[0.95em] text-[#E7E9EC]"
          >
            {segment.slice(1, -1)}
          </code>
        );
      }

      if (/^\*\*.*\*\*$/.test(segment)) {
        return (
          <InlineMarkdownText
            key={`${segment}-${index}`}
            text={segment.slice(2, -2)}
            guildId={guildId}
            emphasized
          />
        );
      }

      const linkMatch = segment.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch) {
        const safeUrl = normalizeExternalUrl(linkMatch[2]);
        if (!safeUrl) {
          return (
            <InlineMarkdownText
              key={`${segment}-${index}`}
              text={segment}
              guildId={guildId}
            />
          );
        }

        return (
          <button
            key={`${safeUrl}-${index}`}
            type="button"
            data-preview-link={safeUrl}
            className="inline rounded-none border-none bg-transparent p-0 align-baseline text-left text-[#7FB3FF] underline decoration-[rgba(127,179,255,0.55)] underline-offset-[2px] transition-colors hover:text-[#A6CBFF]"
          >
            <InlineMarkdownText
              text={linkMatch[1]}
              guildId={guildId}
            />
          </button>
        );
      }

      return (
        <InlineMarkdownText
          key={`${segment}-${index}`}
          text={segment}
          guildId={guildId}
        />
      );
    });
}

function renderMarkdownPreview(markdown: string, guildId: string) {
  const lines = markdown.split(/\r?\n/);

  if (!lines.some((line) => line.trim().length > 0)) {
    return (
      <p className="text-[13px] leading-[1.65] text-[#7C8088]">
        Conteudo vazio.
      </p>
    );
  }

  const rendered: React.ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      rendered.push(<div key={`space-${index}`} className="h-[8px]" />);
      continue;
    }

    if (trimmed.startsWith("```")) {
      const sameLineCode = trimmed.endsWith("```") && trimmed.length > 6;
      if (sameLineCode) {
        rendered.push(
          <pre
            key={`code-inline-${index}`}
            className="overflow-x-auto rounded-[16px] border border-[#23262B] bg-[#101114] px-[14px] py-[12px] text-[12px] leading-[1.7] text-[#E4E7EB]"
          >
            <code>{trimmed.slice(3, -3).trim()}</code>
          </pre>,
        );
        continue;
      }

      const codeLines: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && !(lines[cursor] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[cursor] ?? "");
        cursor += 1;
      }

      rendered.push(
        <pre
          key={`code-${index}`}
          className="overflow-x-auto rounded-[16px] border border-[#23262B] bg-[#101114] px-[14px] py-[12px] text-[12px] leading-[1.7] text-[#E4E7EB]"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );

      index = cursor < lines.length ? cursor : lines.length;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      rendered.push(
        <div
          key={`quote-${index}`}
          className="rounded-r-[14px] border-l-[3px] border-[#3A3D44] bg-[#111216] px-[12px] py-[9px] text-[13px] leading-[1.65] text-[#C5C8CE]"
        >
          {renderInlineMarkdown(trimmed.replace(/^>\s?/, ""), guildId)}
        </div>,
      );
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      rendered.push(<p key={`h3-${index}`} className="text-[13px] font-semibold text-[#F2F3F5]">{renderInlineMarkdown(trimmed.replace(/^###\s+/, ""), guildId)}</p>);
      continue;
    }

    if (/^##\s+/.test(trimmed)) {
      rendered.push(<p key={`h2-${index}`} className="text-[15px] font-semibold text-[#F2F3F5]">{renderInlineMarkdown(trimmed.replace(/^##\s+/, ""), guildId)}</p>);
      continue;
    }

    if (/^#\s+/.test(trimmed)) {
      rendered.push(<p key={`h1-${index}`} className="text-[17px] font-semibold text-[#F7F7F8]">{renderInlineMarkdown(trimmed.replace(/^#\s+/, ""), guildId)}</p>);
      continue;
    }

    if (/^-#\s+/.test(trimmed)) {
      rendered.push(<p key={`sub-${index}`} className="text-[11px] leading-[1.55] text-[#90959D]">{renderInlineMarkdown(trimmed.replace(/^-#\s+/, ""), guildId)}</p>);
      continue;
    }

    rendered.push(<p key={`p-${index}`} className="text-[13px] leading-[1.65] text-[#C5C8CE]">{renderInlineMarkdown(trimmed, guildId)}</p>);
  }

  return rendered;
}

function buttonClass(style: TicketPanelButtonStyle) {
  return BUTTON_STYLES.find((item) => item.value === style)?.preview || BUTTON_STYLES[0].preview;
}

function separatorPadding(spacing: TicketPanelSeparatorComponent["spacing"]) {
  return spacing === "sm" ? "py-2" : spacing === "lg" ? "py-6" : "py-4";
}

function getComponentTypeLabel(type: TicketPanelComponentType) {
  switch (type) {
    case "content":
      return "Conteudo";
    case "container":
      return "Container";
    case "image":
      return "Imagem";
    case "file":
      return "Arquivo";
    case "separator":
      return "Separador";
    case "button":
      return "Botao";
    case "link_button":
      return "Botao de link";
    case "select":
      return "Menu de selecao";
    default:
      return "Componente";
  }
}

function isValidHexColor(value: string) {
  return /^#(?:[0-9a-fA-F]{6})$/.test(value.trim());
}

function moveById<T extends { id: string }>(items: T[], id: string, direction: -1 | 1) {
  const index = items.findIndex((item) => item.id === id);
  const nextIndex = index + direction;
  if (index === -1 || nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(nextIndex, 0, moved);
  return next;
}

function reorderById<T extends { id: string }>(items: T[], sourceId: string, targetId: string) {
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

function Menu<T extends string>({ items, onSelect, align = "left", anchor }: { items: MenuItem<T>[]; onSelect: (value: T) => void; align?: "left" | "right"; anchor: MenuAnchor | null }) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; placement: "top" | "bottom" } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return;

    const updatePosition = () => {
      if (!menuRef.current) return;

      const viewportPadding = 12;
      const offset = 8;
      const menuWidth = menuRef.current.offsetWidth || 300;
      const menuHeight = menuRef.current.offsetHeight || 332;
      const availableBelow = window.innerHeight - anchor.bottom;
      const availableAbove = anchor.top;
      const shouldOpenUpward =
        availableBelow < menuHeight + viewportPadding &&
        availableAbove > availableBelow;

      const nextLeft =
        align === "right"
          ? Math.min(
              window.innerWidth - menuWidth - viewportPadding,
              Math.max(viewportPadding, anchor.right - menuWidth),
            )
          : Math.min(
              window.innerWidth - menuWidth - viewportPadding,
              Math.max(viewportPadding, anchor.left),
            );

      const nextTop = shouldOpenUpward
        ? Math.max(viewportPadding, anchor.top - menuHeight - offset)
        : Math.min(
            window.innerHeight - menuHeight - viewportPadding,
            anchor.bottom + offset,
          );

      setPosition({ top: nextTop, left: nextLeft, placement: shouldOpenUpward ? "top" : "bottom" });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, anchor]);

  if (!anchor || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      data-ticket-menu="true"
      className={cn(
        "flowdesk-scale-in-soft fixed z-[420] w-[300px] rounded-[20px] border border-[#171717] bg-[#090909] p-[10px] shadow-[0_28px_70px_rgba(0,0,0,0.52)]",
        (position?.placement ?? "bottom") === "top" ? "origin-bottom" : "origin-top",
      )}
      style={position ? { top: position.top, left: position.left } : { top: anchor.bottom + 8, left: anchor.left }}
    >
      <div className="flowdesk-selectmenu-scrollbar max-h-[332px] space-y-[4px] overflow-y-auto pr-[4px]">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.value} type="button" onClick={() => onSelect(item.value)} className="flex w-full items-start gap-[12px] rounded-[14px] px-[12px] py-[11px] text-left transition-colors duration-200 hover:bg-[#101010] active:bg-[#141414]">
              <span className="mt-[1px] inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] border border-[#171717] bg-[#0D0D0D] text-[#BDBDBD]"><Icon className="h-[15px] w-[15px]" strokeWidth={2.1} /></span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-[#E8E8E8]">{item.label}</span>
                <span className="mt-[2px] block text-[12px] leading-[1.45] text-[#7B7B7B]">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

function EmojiAutocompleteMenu({
  anchor,
  items,
  activeIndex,
  loading,
  onHover,
  onSelect,
}: {
  anchor: MenuAnchor | null;
  items: GuildEmojiSuggestion[];
  activeIndex: number;
  loading: boolean;
  onHover: (index: number) => void;
  onSelect: (emoji: GuildEmojiSuggestion) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; placement: "top" | "bottom" } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return;

    const updatePosition = () => {
      if (!menuRef.current) return;

      const viewportPadding = 12;
      const offset = 8;
      const menuWidth = menuRef.current.offsetWidth || Math.max(anchor.width, 320);
      const menuHeight = menuRef.current.offsetHeight || 320;
      const availableBelow = window.innerHeight - anchor.bottom;
      const availableAbove = anchor.top;
      const shouldOpenUpward =
        availableBelow < menuHeight + viewportPadding &&
        availableAbove > availableBelow;

      const nextLeft = Math.min(
        window.innerWidth - menuWidth - viewportPadding,
        Math.max(viewportPadding, anchor.left),
      );

      const nextTop = shouldOpenUpward
        ? Math.max(viewportPadding, anchor.top - menuHeight - offset)
        : Math.min(
            window.innerHeight - menuHeight - viewportPadding,
            anchor.bottom + offset,
          );

      setPosition({
        top: nextTop,
        left: nextLeft,
        placement: shouldOpenUpward ? "top" : "bottom",
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, items.length, loading]);

  if (!anchor || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      data-ticket-emoji="true"
      className={cn(
        "flowdesk-scale-in-soft fixed z-[425] overflow-hidden rounded-[22px] border border-[#171717] bg-[#090909] shadow-[0_28px_70px_rgba(0,0,0,0.52)]",
        (position?.placement ?? "bottom") === "top" ? "origin-bottom" : "origin-top",
      )}
      style={position ? { top: position.top, left: position.left, width: Math.max(anchor.width, 320) } : { top: anchor.bottom + 8, left: anchor.left, width: Math.max(anchor.width, 320) }}
    >
      <div className="border-b border-[#141414] px-[14px] py-[12px]">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#6B6B6B]">
          Emojis do servidor
        </p>
      </div>
      <div className="flowdesk-selectmenu-scrollbar max-h-[312px] overflow-y-auto p-[8px]">
        {loading ? (
          <div className="flex items-center justify-center gap-[10px] px-[12px] py-[18px] text-[13px] text-[#8B8B8B]">
            <ButtonLoader size={14} colorClassName="text-[#8B8B8B]" />
            Carregando emojis...
          </div>
        ) : items.length ? (
          items.map((emoji, index) => (
            <button
              key={emoji.id}
              type="button"
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(emoji)}
              className={cn(
                "flex w-full items-center gap-[12px] rounded-[14px] px-[12px] py-[10px] text-left transition-colors duration-200",
                index === activeIndex ? "bg-[#111111]" : "hover:bg-[#101010] active:bg-[#141414]",
              )}
            >
              <img
                src={emoji.url}
                alt=""
                className="h-[26px] w-[26px] shrink-0 object-contain"
                loading="lazy"
                draggable={false}
              />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-[#EAEAEA]">
                  {emoji.name}
                </span>
                <span className="mt-[2px] block truncate font-mono text-[11px] text-[#7C7C7C]">
                  {emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`}
                </span>
              </span>
            </button>
          ))
        ) : (
          <div className="px-[12px] py-[18px] text-[13px] leading-[1.6] text-[#7E7E7E]">
            Nenhum emoji encontrado para esse trecho.
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Field({ value, onChange, placeholder, textarea = false, disabled, rows = 4 }: { value: string; onChange: (value: string) => void; placeholder: string; textarea?: boolean; disabled?: boolean; rows?: number }) {
  const className = "w-full rounded-[16px] border border-[#171717] bg-[#080808] px-[14px] text-[14px] text-[#E2E2E2] outline-none transition-colors duration-200 placeholder:text-[#4F4F4F] focus:border-[#262626] disabled:cursor-not-allowed disabled:opacity-55";
  if (textarea) {
    return <textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} placeholder={placeholder} rows={rows} disabled={disabled} className={cn(className, "min-h-[118px] resize-y py-[12px] leading-[1.55]")} />;
  }
  return <input type="text" value={value} onChange={(event) => onChange(event.currentTarget.value)} placeholder={placeholder} disabled={disabled} className={cn(className, "h-[48px]")} />;
}

function ActionButton({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: React.MouseEventHandler<HTMLButtonElement>; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group relative inline-flex h-[42px] items-center justify-center overflow-visible rounded-[14px] px-[14px] text-[13px] leading-none font-medium",
        disabled ? "cursor-not-allowed opacity-50" : "",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-[14px] border border-[#171717] bg-[#0C0C0C] transition-transform duration-150 ease-out",
          !disabled ? "group-hover:scale-[1.02] group-active:scale-[0.985]" : "",
        )}
      />
      <span className="relative z-10 inline-flex items-center justify-center gap-[8px] whitespace-nowrap text-[#B7B7B7]">
        {children}
      </span>
    </button>
  );
}

function IconButton({ label, onClick, disabled, children, draggable, onDragStart, onDragEnd }: { label: string; onClick?: () => void; disabled?: boolean; children: React.ReactNode; draggable?: boolean; onDragStart?: React.DragEventHandler<HTMLButtonElement>; onDragEnd?: React.DragEventHandler<HTMLButtonElement> }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[12px] border border-[#171717] bg-[#0C0C0C] text-[#AFAFAF] transition-colors duration-200 hover:bg-[#111111] hover:text-[#F1F1F1] disabled:cursor-not-allowed disabled:opacity-45">{children}</button>;
}

function previewAccessory(accessory: TicketPanelContentAccessory | null, onOpenLink: (url: string, label: string) => void) {
  if (!accessory) return null;
  if (accessory.type === "thumbnail") {
    return <div className="inline-flex h-[72px] w-[72px] shrink-0 overflow-hidden rounded-[18px] border border-[#2B2D31] bg-[#17181B]">{accessory.imageUrl ? <img src={accessory.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[#7D7D7D]"><ImageIcon className="h-[24px] w-[24px]" /></div>}</div>;
  }
  if (accessory.type === "link_button") {
    const safeUrl = normalizeExternalUrl(accessory.url || "");
    return <button type="button" disabled={!safeUrl} onClick={() => safeUrl ? onOpenLink(safeUrl, accessory.label || "Abrir link") : undefined} className="inline-flex min-h-[36px] items-center justify-center rounded-[12px] border border-[#2B2D31] bg-[#26282C] px-[13px] text-[12px] font-medium text-[#F2F3F5] disabled:cursor-not-allowed disabled:opacity-55">{accessory.label || "Abrir link"}</button>;
  }
  return <button type="button" disabled={accessory.disabled} className={cn("inline-flex min-h-[36px] items-center justify-center rounded-[12px] border px-[13px] text-[12px] font-medium", buttonClass(accessory.style), accessory.disabled && "cursor-not-allowed opacity-55")}>{accessory.label || "Acao"}</button>;
}

function previewAction(item: ActionComponent, onOpenLink: (url: string, label: string) => void) {
  if (item.type === "select") {
    return <div key={item.id} className="inline-flex min-h-[38px] min-w-[210px] items-center justify-between gap-[12px] rounded-[12px] border border-[#2B2D31] bg-[#1E1F22] px-[14px] text-[13px] text-[#F2F3F5]"><span className="truncate">{item.placeholder || "Escolha uma opcao"}</span><ChevronDown className="h-[14px] w-[14px] shrink-0 text-[#A0A0A0]" /></div>;
  }
  if (item.type === "link_button") {
    const safeUrl = normalizeExternalUrl(item.url || "");
    return <button key={item.id} type="button" disabled={!safeUrl} onClick={() => safeUrl ? onOpenLink(safeUrl, item.label || "Abrir link") : undefined} className="inline-flex min-h-[38px] items-center justify-center rounded-[12px] border border-[#2B2D31] bg-[#26282C] px-[14px] text-[13px] font-medium text-[#F2F3F5] disabled:cursor-not-allowed disabled:opacity-55">{item.label || "Abrir link"}</button>;
  }
  return <button key={item.id} type="button" disabled={item.disabled} className={cn("inline-flex min-h-[38px] items-center justify-center rounded-[12px] border px-[14px] text-[13px] font-medium", buttonClass(item.style), item.disabled && "cursor-not-allowed opacity-55")}>{item.label || "Acao"}</button>;
}

function TicketMessageBuilder({
  guildId,
  value,
  onChange,
  disabled = false,
  canSendEmbed = false,
  isSendingEmbed = false,
  onSendEmbed,
}: Props) {
  const layout = useMemo(() => normalizeTicketPanelLayout(value), [value]);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [customAccentContainerId, setCustomAccentContainerId] = useState<string | null>(null);
  const [customAccentDrafts, setCustomAccentDrafts] = useState<Record<string, string>>({});
  const [pendingPreviewLink, setPendingPreviewLink] = useState<{ url: string; label: string } | null>(null);
  const [emojiCatalog, setEmojiCatalog] = useState<GuildEmojiSuggestion[]>([]);
  const [emojiCatalogLoading, setEmojiCatalogLoading] = useState(false);
  const [emojiAutocomplete, setEmojiAutocomplete] = useState<EmojiAutocompleteState | null>(null);
  const [emojiHighlightIndex, setEmojiHighlightIndex] = useState(0);
  const contentTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const functionalButtonCount = useMemo(() => countTicketPanelFunctionButtons(layout), [layout]);
  const hasFunctionalButton = functionalButtonCount > 0;
  const rootItems = useMemo(
    () => (hasFunctionalButton ? ROOT_ITEMS.filter((item) => item.value !== "button") : ROOT_ITEMS),
    [hasFunctionalButton],
  );
  const childItems = useMemo(
    () => (hasFunctionalButton ? CHILD_ITEMS.filter((item) => item.value !== "button") : CHILD_ITEMS),
    [hasFunctionalButton],
  );

  const getMenuAnchor = useCallback((element: HTMLElement): MenuAnchor => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    if (!guildId) {
      setEmojiCatalog([]);
      return;
    }

    const cachedCatalog = guildEmojiAutocompleteCache.get(guildId);
    if (cachedCatalog) {
      setEmojiCatalog(cachedCatalog);
      return;
    }

    const controller = new AbortController();

    const loadEmojiCatalog = async () => {
      try {
        setEmojiCatalogLoading(true);

        const params = new URLSearchParams({
          guildId,
          limit: "100",
        });

        const response = await fetch(`/api/auth/me/guilds/custom-emoji?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; emojis?: GuildEmojiSuggestion[] }
          | null;

        const nextCatalog =
          response.ok && payload?.ok && Array.isArray(payload.emojis)
            ? payload.emojis
            : [];

        guildEmojiAutocompleteCache.set(guildId, nextCatalog);
        if (isMounted) {
          setEmojiCatalog(nextCatalog);
        }
      } catch {
        if (isMounted) {
          setEmojiCatalog([]);
        }
      } finally {
        if (isMounted) {
          setEmojiCatalogLoading(false);
        }
      }
    };

    void loadEmojiCatalog();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [guildId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-ticket-menu='true']")) {
        setOpenMenu(null);
        setMenuAnchor(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setMenuAnchor(null);
        setPendingPreviewLink(null);
        setEmojiAutocomplete(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    const handleEmojiOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-ticket-emoji='true']")) {
        setEmojiAutocomplete(null);
      }
    };

    document.addEventListener("mousedown", handleEmojiOutside);
    return () => {
      document.removeEventListener("mousedown", handleEmojiOutside);
    };
  }, []);

  const handlePreviewLinkIntent = useCallback((url: string, label: string) => {
    const safeUrl = normalizeExternalUrl(url);
    if (!safeUrl) return;
    setPendingPreviewLink({ url: safeUrl, label });
  }, []);

  const handleConfirmPreviewLink = useCallback(() => {
    if (!pendingPreviewLink) return;
    window.open(pendingPreviewLink.url, "_blank", "noopener,noreferrer");
    setPendingPreviewLink(null);
  }, [pendingPreviewLink]);

  const filteredEmojiSuggestions = useMemo(() => {
    if (!emojiAutocomplete) return [];
    const query = emojiAutocomplete.query.trim().toLowerCase();

    return emojiCatalog
      .filter((emoji) => {
        if (!query) return true;
        return emoji.name.toLowerCase().includes(query);
      })
      .sort((left, right) => {
        if (!query) return left.name.localeCompare(right.name);
        const leftStarts = left.name.toLowerCase().startsWith(query);
        const rightStarts = right.name.toLowerCase().startsWith(query);
        if (leftStarts !== rightStarts) {
          return leftStarts ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, 8);
  }, [emojiAutocomplete, emojiCatalog]);

  useEffect(() => {
    setEmojiHighlightIndex(0);
  }, [emojiAutocomplete?.query, emojiAutocomplete?.scope.parentId, emojiAutocomplete?.scope.componentId]);

  const syncEmojiAutocomplete = useCallback((scope: Scope, element: HTMLTextAreaElement, currentValue: string) => {
    const cursor = element.selectionStart ?? currentValue.length;
    const match = getEmojiAutocompleteMatch(currentValue, cursor);

    if (!match) {
      setEmojiAutocomplete((current) =>
        current && scopeKey(current.scope) === scopeKey(scope) ? null : current,
      );
      return;
    }

    setEmojiAutocomplete({
      scope,
      query: match.query,
      replaceStart: match.replaceStart,
      replaceEnd: match.replaceEnd,
      anchor: getMenuAnchor(element),
    });
  }, [getMenuAnchor]);

  const commit = useCallback((next: TicketPanelLayout) => onChange(normalizeTicketPanelLayout(next)), [onChange]);
  const updateRoot = useCallback((id: string, updater: (component: TicketPanelComponent) => TicketPanelComponent) => commit(layout.map((component) => component.id === id ? updater(component) : component)), [commit, layout]);
  const updateContainerChildren = useCallback((containerId: string, updater: (children: TicketPanelContainerChild[]) => TicketPanelContainerChild[]) => {
    commit(layout.map((component) => component.type === "container" && component.id === containerId ? { ...component, children: updater(component.children) } : component));
  }, [commit, layout]);
  const updateChild = useCallback((containerId: string, id: string, updater: (component: TicketPanelContainerChild) => TicketPanelContainerChild) => {
    updateContainerChildren(containerId, (children) => children.map((child) => child.id === id ? updater(child) : child));
  }, [updateContainerChildren]);
  const updateContentMarkdown = useCallback((scope: Scope, markdown: string) => {
    if (scope.parentId) {
      updateChild(scope.parentId, scope.componentId, (current) =>
        current.type === "content" ? { ...current, markdown } : current,
      );
      return;
    }

    updateRoot(scope.componentId, (current) =>
      current.type === "content" ? { ...current, markdown } : current,
    );
  }, [updateChild, updateRoot]);

  const applyEmojiSuggestion = useCallback((scope: Scope, emoji: GuildEmojiSuggestion) => {
    const textarea = contentTextareaRefs.current[scopeKey(scope)];
    if (!textarea || !emojiAutocomplete || scopeKey(emojiAutocomplete.scope) !== scopeKey(scope)) {
      return;
    }

    const currentValue = textarea.value;
    const markup = emoji.animated
      ? `<a:${emoji.name}:${emoji.id}>`
      : `<:${emoji.name}:${emoji.id}>`;
    const nextValue =
      currentValue.slice(0, emojiAutocomplete.replaceStart) +
      markup +
      currentValue.slice(emojiAutocomplete.replaceEnd);

    updateContentMarkdown(scope, nextValue);
    setEmojiAutocomplete(null);

    requestAnimationFrame(() => {
      const target = contentTextareaRefs.current[scopeKey(scope)];
      if (!target) return;
      const nextCursor = emojiAutocomplete.replaceStart + markup.length;
      target.focus();
      target.setSelectionRange(nextCursor, nextCursor);
    });
  }, [emojiAutocomplete, updateContentMarkdown]);

  const removeComponent = useCallback((scope: Scope) => {
    if (scope.parentId) {
      updateContainerChildren(scope.parentId, (children) => children.filter((child) => child.id !== scope.componentId));
      return;
    }
    commit(layout.filter((component) => component.id !== scope.componentId));
  }, [commit, layout, updateContainerChildren]);

  const moveComponent = useCallback((scope: Scope, direction: -1 | 1) => {
    if (scope.parentId) {
      updateContainerChildren(scope.parentId, (children) => moveById(children, scope.componentId, direction));
      return;
    }
    commit(moveById(layout, scope.componentId, direction));
  }, [commit, layout, updateContainerChildren]);

  const onDropAt = useCallback((scope: Scope) => {
    if (!dragState) return;
    if (dragState.kind === "root" && !scope.parentId) commit(reorderById(layout, dragState.componentId, scope.componentId));
    if (dragState.kind === "child" && scope.parentId && dragState.parentId === scope.parentId) updateContainerChildren(scope.parentId, (children) => reorderById(children, dragState.componentId, scope.componentId));
    setDragState(null);
  }, [commit, dragState, layout, updateContainerChildren]);

  const groupedPreview = (items: Array<TicketPanelComponent | TicketPanelContainerChild>) => {
    const groups: Array<{ kind: "actions"; items: ActionComponent[] } | { kind: "component"; item: TicketPanelComponent | TicketPanelContainerChild }> = [];
    let pending: ActionComponent[] = [];
    const flush = () => {
      if (!pending.length) return;
      groups.push({ kind: "actions", items: pending });
      pending = [];
    };
    items.forEach((item) => {
      if (isAction(item)) {
        pending.push(item);
        return;
      }
      flush();
      groups.push({ kind: "component", item });
    });
    flush();
    return groups;
  };

  const renderContentAccessoryEditor = (content: TicketPanelContentComponent, scope: Scope) => (
    <>
      <div className="flex items-start justify-end pt-[2px]">
        <div className="relative" data-ticket-menu="true">
          <button
            type="button"
            disabled={disabled}
            onClick={(event) => {
              const shouldClose = openMenu && openMenu.kind === "accessory" && scopeKey(openMenu.scope) === scopeKey(scope);
              setOpenMenu(shouldClose ? null : { kind: "accessory", scope });
              setMenuAnchor(shouldClose ? null : getMenuAnchor(event.currentTarget));
            }}
            className={cn(
              "inline-flex h-[42px] w-[42px] items-center justify-center rounded-[14px] border transition-colors duration-200",
              content.accessory
                ? "border-[#F2F2F2] bg-[#111111] text-[#F2F2F2]"
                : "border-[#171717] bg-[#0C0C0C] text-[#B7B7B7] hover:bg-[#111111] hover:text-[#EDEDED]",
              disabled && "cursor-not-allowed opacity-50",
            )}
            aria-label={content.accessory ? "Trocar acessorio" : "Adicionar acessorio"}
            title={content.accessory ? "Trocar acessorio" : "Adicionar acessorio"}
          >
            <Shapes className="h-[17px] w-[17px]" strokeWidth={2} />
          </button>
          {openMenu && openMenu.kind === "accessory" && scopeKey(openMenu.scope) === scopeKey(scope) ? <Menu items={ACCESSORY_ITEMS.filter((item) => item.value !== "button" || content.accessory?.type === "button" || !hasFunctionalButton)} anchor={menuAnchor} onSelect={(type) => { const nextAccessory = createTicketPanelContentAccessoryByType(type); if (scope.parentId) updateChild(scope.parentId, scope.componentId, (current) => current.type === "content" ? { ...current, accessory: nextAccessory } : current); else updateRoot(scope.componentId, (current) => current.type === "content" ? { ...current, accessory: nextAccessory } : current); setOpenMenu(null); setMenuAnchor(null); }} align="right" /> : null}
        </div>
      </div>
      {content.accessory ? (
        <div className="space-y-[12px] rounded-[16px] border border-[#171717] bg-[#080808] p-[12px] xl:col-span-2">
          <div className="flex items-center justify-between gap-[12px]"><p className="text-[13px] font-medium text-[#E8E8E8]">{content.accessory.type === "thumbnail" ? "Miniatura" : content.accessory.type === "link_button" ? "Botao de link" : "Botao"}</p><IconButton label="Remover acessorio" disabled={disabled} onClick={() => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "content" ? { ...current, accessory: null } : current) : updateRoot(scope.componentId, (current) => current.type === "content" ? { ...current, accessory: null } : current)}><Trash2 className="h-[15px] w-[15px]" strokeWidth={2.1} /></IconButton></div>
          {content.accessory.type === "thumbnail" ? <div className="grid gap-[12px]"><Field value={content.accessory.imageUrl} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "content" && current.accessory?.type === "thumbnail" ? { ...current, accessory: { ...current.accessory, imageUrl: next.slice(0, 1000), alt: "" } } : current) : updateRoot(scope.componentId, (current) => current.type === "content" && current.accessory?.type === "thumbnail" ? { ...current, accessory: { ...current.accessory, imageUrl: next.slice(0, 1000), alt: "" } } : current)} placeholder="URL da miniatura" disabled={disabled} /></div> : null}
          {content.accessory.type === "button" ? <div className="space-y-[12px]"><Field value={content.accessory.label} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "content" && current.accessory?.type === "button" ? { ...current, accessory: { ...current.accessory, label: next.slice(0, 80) } } : current) : updateRoot(scope.componentId, (current) => current.type === "content" && current.accessory?.type === "button" ? { ...current, accessory: { ...current.accessory, label: next.slice(0, 80) } } : current)} placeholder="Texto do botao funcional" disabled={disabled} /><p className="text-[12px] leading-[1.55] text-[#787878]">A mensagem inteira aceita apenas um botao funcional para abrir o ticket.</p><div className="grid grid-cols-2 gap-[8px] min-[920px]:grid-cols-4">{BUTTON_STYLES.map((style) => <button key={style.value} type="button" disabled={disabled} onClick={() => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "content" && current.accessory?.type === "button" ? { ...current, accessory: { ...current.accessory, style: style.value } } : current) : updateRoot(scope.componentId, (current) => current.type === "content" && current.accessory?.type === "button" ? { ...current, accessory: { ...current.accessory, style: style.value } } : current)} className={cn("rounded-[14px] border px-[10px] py-[10px] text-[12px] font-medium transition-colors duration-200", content.accessory?.type === "button" && content.accessory.style === style.value ? "border-[#F2F2F2] bg-[#111111] text-[#F2F2F2]" : "border-[#171717] bg-[#0A0A0A] text-[#818181] hover:bg-[#101010]")}>{style.label}</button>)}</div></div> : null}
          {content.accessory.type === "link_button" ? <div className="grid gap-[12px]"><Field value={content.accessory.label} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "content" && current.accessory?.type === "link_button" ? { ...current, accessory: { ...current.accessory, label: next.slice(0, 80) } } : current) : updateRoot(scope.componentId, (current) => current.type === "content" && current.accessory?.type === "link_button" ? { ...current, accessory: { ...current.accessory, label: next.slice(0, 80) } } : current)} placeholder="Texto do botao" disabled={disabled} /><Field value={content.accessory.url} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "content" && current.accessory?.type === "link_button" ? { ...current, accessory: { ...current.accessory, url: next.slice(0, 1000) } } : current) : updateRoot(scope.componentId, (current) => current.type === "content" && current.accessory?.type === "link_button" ? { ...current, accessory: { ...current.accessory, url: next.slice(0, 1000) } } : current)} placeholder="https://seu-link.com" disabled={disabled} /></div> : null}
        </div>
      ) : null}
    </>
  );

  const renderSelectOptions = (component: TicketPanelSelectComponent, scope: Scope) => (
    <div className="space-y-[10px] rounded-[18px] border border-[#171717] bg-[#0B0B0B] p-[14px]">
      <div className="flex items-center justify-between gap-[12px]"><div><p className="text-[12px] font-medium uppercase tracking-[0.18em] text-[#646464]">Opcoes</p><p className="mt-[5px] text-[13px] leading-[1.55] text-[#7F7F7F]">Configure as escolhas que vao aparecer no menu.</p></div><ActionButton disabled={disabled} onClick={() => { const nextOption = { id: createTicketPanelComponentId("opt"), label: `Opcao ${component.options.length + 1}`, description: "Explique rapidamente o que acontece ao selecionar esta opcao." }; if (scope.parentId) updateChild(scope.parentId, scope.componentId, (current) => current.type === "select" ? { ...current, options: [...current.options, nextOption] } : current); else updateRoot(scope.componentId, (current) => current.type === "select" ? { ...current, options: [...current.options, nextOption] } : current); }} className="h-[38px] rounded-[12px] px-[12px] text-[12px]"><Plus className="h-[14px] w-[14px]" />Adicionar opcao</ActionButton></div>
      <div className="space-y-[10px]">{component.options.map((option, index) => <div key={option.id} className="rounded-[16px] border border-[#171717] bg-[#080808] p-[12px]"><div className="flex items-center justify-between gap-[12px]"><p className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#6A6A6A]">Opcao {index + 1}</p><IconButton label="Remover opcao" disabled={disabled} onClick={() => { if (scope.parentId) updateChild(scope.parentId, scope.componentId, (current) => current.type === "select" ? { ...current, options: current.options.filter((item) => item.id !== option.id) } : current); else updateRoot(scope.componentId, (current) => current.type === "select" ? { ...current, options: current.options.filter((item) => item.id !== option.id) } : current); }}><Trash2 className="h-[15px] w-[15px]" strokeWidth={2.1} /></IconButton></div><div className="mt-[10px] grid gap-[10px]"><Field value={option.label} onChange={(next) => { const update = (options: TicketPanelSelectOption[]) => options.map((item) => item.id === option.id ? { ...item, label: next.slice(0, 80) } : item); if (scope.parentId) updateChild(scope.parentId, scope.componentId, (current) => current.type === "select" ? { ...current, options: update(current.options) } : current); else updateRoot(scope.componentId, (current) => current.type === "select" ? { ...current, options: update(current.options) } : current); }} placeholder="Titulo da opcao" disabled={disabled} /><Field value={option.description} onChange={(next) => { const update = (options: TicketPanelSelectOption[]) => options.map((item) => item.id === option.id ? { ...item, description: next.slice(0, 160) } : item); if (scope.parentId) updateChild(scope.parentId, scope.componentId, (current) => current.type === "select" ? { ...current, options: update(current.options) } : current); else updateRoot(scope.componentId, (current) => current.type === "select" ? { ...current, options: update(current.options) } : current); }} placeholder="Descricao curta da opcao" disabled={disabled} /></div></div>)}</div>
    </div>
  );

  const renderLeafEditor = (component: Exclude<TicketPanelComponent | TicketPanelContainerChild, TicketPanelContainerComponent>, scope: Scope, nested = false) => {
    if (component.type === "content") return <div className="grid items-start gap-[6px] xl:grid-cols-[minmax(0,1fr)_42px]" data-ticket-emoji="true"><div className="min-w-0 w-full space-y-[12px]"><textarea ref={(element) => { contentTextareaRefs.current[scopeKey(scope)] = element; }} value={component.markdown} onChange={(event) => { const nextValue = event.currentTarget.value.slice(0, 4000); updateContentMarkdown(scope, nextValue); syncEmojiAutocomplete(scope, event.currentTarget, nextValue); }} onClick={(event) => syncEmojiAutocomplete(scope, event.currentTarget, event.currentTarget.value)} onKeyUp={(event) => syncEmojiAutocomplete(scope, event.currentTarget, event.currentTarget.value)} onSelect={(event) => syncEmojiAutocomplete(scope, event.currentTarget, event.currentTarget.value)} onKeyDown={(event) => { if (!emojiAutocomplete || scopeKey(emojiAutocomplete.scope) !== scopeKey(scope) || !filteredEmojiSuggestions.length) { return; } if (event.key === "ArrowDown") { event.preventDefault(); setEmojiHighlightIndex((current) => (current + 1) % filteredEmojiSuggestions.length); return; } if (event.key === "ArrowUp") { event.preventDefault(); setEmojiHighlightIndex((current) => (current - 1 + filteredEmojiSuggestions.length) % filteredEmojiSuggestions.length); return; } if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); applyEmojiSuggestion(scope, filteredEmojiSuggestions[emojiHighlightIndex] || filteredEmojiSuggestions[0]); return; } if (event.key === "Escape") { event.preventDefault(); setEmojiAutocomplete(null); } }} placeholder={"## Titulo do embed\nEscreva o texto livremente aqui.\n-# Observacao pequena\nUse **negrito** quando quiser destaque.\nDigite : para autocompletar emojis do servidor."} rows={nested ? 7 : 9} disabled={disabled} className="min-h-[118px] w-full resize-y rounded-[16px] border border-[#171717] bg-[#080808] px-[14px] py-[12px] text-[14px] leading-[1.55] text-[#E2E2E2] outline-none transition-colors duration-200 placeholder:text-[#4F4F4F] focus:border-[#262626] disabled:cursor-not-allowed disabled:opacity-55" /><div className="flex flex-wrap gap-[8px]">{["#", "##", "###", "-#", "**negrito**", ":emoji"].map((token) => <span key={token} className="inline-flex h-[28px] items-center rounded-full border border-[#171717] bg-[#0A0A0A] px-[10px] text-[11px] font-medium text-[#8A8A8A]">{token}</span>)}</div></div>{renderContentAccessoryEditor(component, scope)}</div>;
    if (component.type === "image") return <div className="grid gap-[12px]"><Field value={component.url} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "image" ? { ...current, url: next.slice(0, 1000), alt: "" } : current) : updateRoot(scope.componentId, (current) => current.type === "image" ? { ...current, url: next.slice(0, 1000), alt: "" } : current)} placeholder="URL da imagem" disabled={disabled} /></div>;
    if (component.type === "file") return <div className="grid gap-[12px] xl:grid-cols-2"><Field value={component.name} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "file" ? { ...current, name: next.slice(0, 120) } : current) : updateRoot(scope.componentId, (current) => current.type === "file" ? { ...current, name: next.slice(0, 120) } : current)} placeholder="Nome do arquivo" disabled={disabled} /><Field value={component.sizeLabel} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "file" ? { ...current, sizeLabel: next.slice(0, 60) } : current) : updateRoot(scope.componentId, (current) => current.type === "file" ? { ...current, sizeLabel: next.slice(0, 60) } : current)} placeholder="Ex.: PDF | 1.2 MB" disabled={disabled} /></div>;
    if (component.type === "separator") return <div className="grid grid-cols-3 gap-[8px]">{(["sm", "md", "lg"] as TicketPanelSeparatorComponent["spacing"][]).map((spacing) => <button key={spacing} type="button" disabled={disabled} onClick={() => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "separator" ? { ...current, spacing } : current) : updateRoot(scope.componentId, (current) => current.type === "separator" ? { ...current, spacing } : current)} className={cn("rounded-[14px] border px-[12px] py-[11px] text-[12px] font-medium transition-colors duration-200", component.spacing === spacing ? "border-[#F2F2F2] bg-[#111111] text-[#F2F2F2]" : "border-[#171717] bg-[#0A0A0A] text-[#818181] hover:bg-[#101010]")}>{spacing === "sm" ? "Espaco curto" : spacing === "md" ? "Espaco medio" : "Espaco amplo"}</button>)}</div>;
    if (component.type === "button") return <div className="space-y-[12px]"><Field value={component.label} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "button" ? { ...current, label: next.slice(0, 80) } : current) : updateRoot(scope.componentId, (current) => current.type === "button" ? { ...current, label: next.slice(0, 80) } : current)} placeholder="Texto do botao funcional" disabled={disabled} /><p className="text-[12px] leading-[1.55] text-[#787878]">Use este CTA como o botao principal que abre o ticket. O builder aceita apenas um desse tipo.</p><div className="grid grid-cols-2 gap-[8px] min-[920px]:grid-cols-4">{BUTTON_STYLES.map((style) => <button key={style.value} type="button" disabled={disabled} onClick={() => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "button" ? { ...current, style: style.value } : current) : updateRoot(scope.componentId, (current) => current.type === "button" ? { ...current, style: style.value } : current)} className={cn("rounded-[14px] border px-[10px] py-[10px] text-[12px] font-medium transition-colors duration-200", component.style === style.value ? "border-[#F2F2F2] bg-[#111111] text-[#F2F2F2]" : "border-[#171717] bg-[#0A0A0A] text-[#818181] hover:bg-[#101010]")}>{style.label}</button>)}</div></div>;
    if (component.type === "link_button") return <div className="grid gap-[12px] xl:grid-cols-2"><Field value={component.label} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "link_button" ? { ...current, label: next.slice(0, 80) } : current) : updateRoot(scope.componentId, (current) => current.type === "link_button" ? { ...current, label: next.slice(0, 80) } : current)} placeholder="Texto do botao" disabled={disabled} /><Field value={component.url} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "link_button" ? { ...current, url: next.slice(0, 1000) } : current) : updateRoot(scope.componentId, (current) => current.type === "link_button" ? { ...current, url: next.slice(0, 1000) } : current)} placeholder="https://seu-link.com" disabled={disabled} /></div>;
    return <div className="space-y-[12px]"><Field value={component.placeholder} onChange={(next) => scope.parentId ? updateChild(scope.parentId, scope.componentId, (current) => current.type === "select" ? { ...current, placeholder: next.slice(0, 100) } : current) : updateRoot(scope.componentId, (current) => current.type === "select" ? { ...current, placeholder: next.slice(0, 100) } : current)} placeholder="Placeholder do menu" disabled={disabled} />{renderSelectOptions(component, scope)}</div>;
  };

  const cardShell = (component: TicketPanelComponent | TicketPanelContainerChild, scope: Scope, body: React.ReactNode, nested = false) => {
    const canDrop = dragState && ((dragState.kind === "root" && !scope.parentId) || (dragState.kind === "child" && scope.parentId && dragState.parentId === scope.parentId));
    return (
      <div
        key={scopeKey(scope)}
        onDragOver={(event) => {
          if (!canDrop || disabled) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          if (!canDrop || disabled) return;
          event.preventDefault();
          onDropAt(scope);
        }}
        className={cn(
          "overflow-visible rounded-[24px] border border-[#141414] bg-[#090909] p-[18px] shadow-[0_20px_60px_rgba(0,0,0,0.28)] transition-colors duration-200",
          nested && "rounded-[20px] bg-[#0B0B0B] p-[16px]",
          canDrop && dragState && "border-[#2C2C2C]",
        )}
      >
        <div className="flex items-start justify-between gap-[14px]">
          <div className="min-w-0 flex flex-1 items-start gap-[14px]">
            <div className="shrink-0 pt-[2px]">
              <IconButton
                label="Mover componente"
                disabled={disabled}
                draggable={!disabled}
                onDragStart={(event) => {
                  if (disabled) return;
                  const nextDrag: DragState = scope.parentId
                    ? {
                        kind: "child",
                        parentId: scope.parentId,
                        componentId: scope.componentId,
                      }
                    : { kind: "root", componentId: scope.componentId };
                  setDragState(nextDrag);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", scopeKey(scope));
                }}
                onDragEnd={() => setDragState(null)}
              >
                <GripVertical className="h-[15px] w-[15px]" strokeWidth={2.1} />
              </IconButton>
            </div>

            <div className="min-w-0 flex-1">
              {component.type === "content" ? (
                <div className="h-[34px]" />
              ) : (
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-[8px] rounded-full border border-[#161616] bg-[#0D0D0D] px-[10px] py-[6px] text-[11px] font-medium uppercase tracking-[0.16em] text-[#757575]">
                    {getComponentTypeLabel(component.type)}
                  </div>
                  <p className="mt-[10px] text-[13px] leading-[1.55] text-[#7B7B7B]">
                    {component.type === "container"
                      ? "Este container nasce vazio. Adicione conteudos, separadores, botoes e menus dentro dele."
                      : component.type === "separator"
                        ? "Crie respiro visual entre componentes."
                        : component.type === "image"
                          ? "Mostre uma imagem maior dentro da mensagem."
                          : component.type === "file"
                            ? "Mostre um arquivo ou material complementar."
                            : component.type === "button"
                              ? "Configure o unico botao funcional que abre o ticket."
                              : component.type === "link_button"
                                ? "Direcione o usuario para um link externo."
                                : "Monte um menu com opcoes do ticket."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-[8px]">
            <IconButton label="Subir componente" disabled={disabled} onClick={() => moveComponent(scope, -1)}>
              <ChevronUp className="h-[15px] w-[15px]" strokeWidth={2.1} />
            </IconButton>
            <IconButton label="Descer componente" disabled={disabled} onClick={() => moveComponent(scope, 1)}>
              <ChevronDown className="h-[15px] w-[15px]" strokeWidth={2.1} />
            </IconButton>
            <IconButton label="Remover componente" disabled={disabled} onClick={() => removeComponent(scope)}>
              <Trash2 className="h-[15px] w-[15px]" strokeWidth={2.1} />
            </IconButton>
          </div>
        </div>

        <div className="mt-[18px]">{body}</div>
      </div>
    );
  };

  const renderContainer = (container: TicketPanelContainerComponent) => {
    const isCustomAccentOpen = customAccentContainerId === container.id;
    const customAccentDraft =
      customAccentDrafts[container.id] ??
      (container.accentColor && !PRESET_ACCENT_COLORS.includes(container.accentColor)
        ? container.accentColor
        : "");

    return cardShell(
      container,
      { parentId: null, componentId: container.id },
      <div className="space-y-[16px]">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-[#646464]">
            Borda do container
          </p>
          <div className="mt-[10px] flex flex-wrap gap-[10px]">
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setCustomAccentContainerId(null);
                updateRoot(container.id, (current) =>
                  current.type === "container"
                    ? { ...current, accentColor: "" }
                    : current,
                );
              }}
              className={cn(
                "inline-flex h-[34px] items-center justify-center rounded-full border px-[12px] text-[11px] font-medium uppercase tracking-[0.12em] transition-colors duration-200",
                container.accentColor === ""
                  ? "border-[#F2F2F2] bg-[#111111] text-[#F2F2F2]"
                  : "border-[#171717] bg-[#0A0A0A] text-[#818181] hover:bg-[#101010]",
              )}
            >
              Default
            </button>

            {PRESET_ACCENT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setCustomAccentContainerId(null);
                  updateRoot(container.id, (current) =>
                    current.type === "container"
                      ? { ...current, accentColor: color }
                      : current,
                  );
                }}
                className={cn(
                  "inline-flex h-[34px] w-[34px] rounded-full border-2 transition-transform duration-200",
                  container.accentColor === color
                    ? "scale-105 border-white"
                    : "border-transparent",
                )}
                style={{ backgroundColor: color }}
                aria-label={`Definir cor ${color}`}
              />
            ))}

            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setCustomAccentContainerId((current) =>
                  current === container.id ? null : container.id,
                );
                setCustomAccentDrafts((current) => ({
                  ...current,
                  [container.id]: customAccentDraft || "#5865F2",
                }));
              }}
              className={cn(
                "inline-flex h-[34px] items-center justify-center rounded-full border px-[12px] text-[11px] font-medium uppercase tracking-[0.12em] transition-colors duration-200",
                isCustomAccentOpen
                  ? "border-[#F2F2F2] bg-[#111111] text-[#F2F2F2]"
                  : "border-[#171717] bg-[#0A0A0A] text-[#818181] hover:bg-[#101010]",
              )}
            >
              RGB
            </button>
          </div>

          {isCustomAccentOpen ? (
            <div className="mt-[12px] flex flex-col gap-[10px] rounded-[16px] border border-[#171717] bg-[#0A0A0A] p-[12px] sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-[10px]">
                <span
                  className="inline-flex h-[34px] w-[34px] shrink-0 rounded-full border border-[#171717]"
                  style={{
                    backgroundColor: isValidHexColor(customAccentDraft)
                      ? customAccentDraft
                      : "#080808",
                  }}
                />
                <Field
                  value={customAccentDraft}
                  onChange={(next) =>
                    setCustomAccentDrafts((current) => ({
                      ...current,
                      [container.id]: next.slice(0, 7),
                    }))
                  }
                  placeholder="#5865F2"
                  disabled={disabled}
                />
              </div>
              <ActionButton
                disabled={disabled || !isValidHexColor(customAccentDraft)}
                onClick={() => {
                  if (!isValidHexColor(customAccentDraft)) return;
                  updateRoot(container.id, (current) =>
                    current.type === "container"
                      ? { ...current, accentColor: customAccentDraft }
                      : current,
                  );
                }}
                className="h-[40px] rounded-[12px] px-[12px] text-[12px]"
              >
                Aplicar HEX
              </ActionButton>
            </div>
          ) : null}
        </div>

        {container.children.length ? (
          <div className="space-y-[14px] rounded-[22px] border border-[#171717] bg-[#070707] p-[14px]">
            {container.children.map((child) =>
              cardShell(
                child,
                { parentId: container.id, componentId: child.id },
                renderLeafEditor(
                  child,
                  { parentId: container.id, componentId: child.id },
                  true,
                ),
                true,
              ),
            )}
          </div>
        ) : (
          <div className="rounded-[22px] border border-dashed border-[#1E1E1E] bg-[#070707] px-[18px] py-[24px] text-center">
            <p className="text-[14px] font-medium text-[#DADADA]">Container vazio</p>
            <p className="mt-[8px] text-[13px] leading-[1.55] text-[#717171]">
              Adicione conteudos, botoes, separadores ou menus dentro deste bloco para montar o embed.
            </p>
          </div>
        )}

        <div className="relative z-[40]" data-ticket-menu="true">
          <ActionButton
            disabled={disabled}
            onClick={(event) => {
              const shouldClose = openMenu && openMenu.kind === "container" && openMenu.containerId === container.id;
              setOpenMenu(shouldClose ? null : { kind: "container", containerId: container.id });
              setMenuAnchor(shouldClose ? null : getMenuAnchor(event.currentTarget));
            }}
            className="h-[44px] rounded-[14px] px-[14px]"
          >
            <Plus className="h-[15px] w-[15px]" />
            Adicionar conteudo
            <ChevronDown className="h-[14px] w-[14px]" />
          </ActionButton>
          {openMenu &&
          openMenu.kind === "container" &&
          openMenu.containerId === container.id ? (
            <Menu
              items={childItems}
              anchor={menuAnchor}
              onSelect={(type) => {
                updateContainerChildren(container.id, (children) => [
                  ...children,
                  createTicketPanelContainerChildByType(type),
                ]);
                setOpenMenu(null);
                setMenuAnchor(null);
              }}
            />
          ) : null}
        </div>
      </div>,
    );
  };

  const renderPreview = (items: Array<TicketPanelComponent | TicketPanelContainerChild>, nested = false) => groupedPreview(items).map((group, index) => {
    if (group.kind === "actions") return <div key={`actions-${index}`} className={cn("flex flex-wrap gap-[8px]", nested && "pt-[2px]")}>{group.items.map((item) => previewAction(item, handlePreviewLinkIntent))}</div>;
    const item = group.item;
    if (item.type === "content") return <div key={item.id} className={cn("grid gap-[14px]", item.accessory ? "min-[520px]:grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1")}><div className="min-w-0 space-y-[6px]" onClick={(event) => {
      const target = event.target as HTMLElement | null;
      const linkTarget = target?.closest("[data-preview-link]") as HTMLElement | null;
      if (!linkTarget) return;
      const href = linkTarget.getAttribute("data-preview-link");
      if (href) {
        event.preventDefault();
        handlePreviewLinkIntent(href, linkTarget.textContent?.trim() || "Abrir link");
      }
    }}>{renderMarkdownPreview(item.markdown, guildId)}</div>{item.accessory ? <div className="justify-self-start min-[520px]:justify-self-end">{previewAccessory(item.accessory, handlePreviewLinkIntent)}</div> : null}</div>;
    if (item.type === "container") return <div key={item.id} className="relative overflow-hidden rounded-[20px] border border-[#2B2D31] bg-[#15171B]">{item.accentColor ? <div className="absolute bottom-0 left-0 top-0 w-[4px]" style={{ backgroundColor: item.accentColor }} /> : null}<div className={cn("space-y-[14px] px-[18px] py-[16px]", item.accentColor ? "pl-[20px]" : "pl-[18px]")}>{item.children.length ? renderPreview(item.children, true) : <div className="rounded-[16px] border border-dashed border-[#2E3136] bg-[#111216] px-[14px] py-[16px] text-[12px] leading-[1.55] text-[#8D9198]">Container vazio. Adicione conteudos, botoes ou separadores para montar o embed final.</div>}</div></div>;
    if (item.type === "image") return <div key={item.id} className="overflow-hidden rounded-[18px] border border-[#2B2D31] bg-[#17181B]">{item.url ? <img src={item.url} alt="" className="max-h-[240px] w-full object-cover" /> : <div className="flex h-[180px] items-center justify-center text-[#73767D]"><ImageIcon className="h-[28px] w-[28px]" /></div>}</div>;
    if (item.type === "file") return <div key={item.id} className="flex items-center justify-between gap-[14px] rounded-[18px] border border-[#2B2D31] bg-[#17181B] px-[16px] py-[14px]"><div className="flex min-w-0 items-center gap-[12px]"><span className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[12px] bg-[#0F1012] text-[#D5D7DB]"><FileText className="h-[18px] w-[18px]" /></span><div className="min-w-0"><p className="truncate text-[13px] font-medium text-[#F2F3F5]">{item.name || "Arquivo-flowdesk.pdf"}</p><p className="mt-[3px] text-[12px] text-[#8E939A]">{item.sizeLabel || "PDF | 1.2 MB"}</p></div></div><span className="rounded-full border border-[#2B2D31] bg-[#111216] px-[10px] py-[6px] text-[11px] font-medium uppercase tracking-[0.14em] text-[#A3A7AE]">Anexo</span></div>;
    if (item.type === "separator") return <div key={item.id} className={separatorPadding(item.spacing)}><div className="h-[1px] w-full bg-[#2B2D31]" /></div>;
    return null;
  });

  return (
    <section className="relative isolate space-y-[20px] overflow-visible">
      <div className="relative isolate overflow-visible rounded-[30px] border border-[#121212] bg-[#080808] p-[22px] shadow-[0_26px_70px_rgba(0,0,0,0.3)]">
        <div className="flex flex-col gap-[18px] lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-[720px]">
            <p className="text-[12px] font-medium uppercase tracking-[0.2em] text-[#666666]">
              Mensagem do ticket
            </p>
            <h3 className="mt-[10px] text-[22px] leading-none font-medium tracking-[-0.04em] text-[#DCDCDC]">
              Monte o painel como um builder visual
            </h3>
            <p className="mt-[12px] max-w-[660px] text-[14px] leading-[1.7] text-[#7C7C7C]">
              Agora o container nasce vazio, voce adiciona o conteudo dentro dele e cada bloco
              de texto pode receber botao, link ou miniatura na direita. O texto agora e livre em
              markdown e a mensagem aceita apenas um botao funcional para abrir o ticket.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-[10px]">
            <button
              type="button"
              disabled={disabled || !canSendEmbed || isSendingEmbed}
              onClick={() => onSendEmbed?.()}
              className={cn(
                "group relative inline-flex h-[46px] shrink-0 items-center justify-center overflow-visible whitespace-nowrap rounded-[12px] px-6 text-[16px] leading-none font-semibold",
                disabled || !canSendEmbed ? "cursor-not-allowed" : "",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-0 rounded-[12px] transition-transform duration-150 ease-out",
                  disabled || !canSendEmbed
                    ? "bg-[#111111]"
                    : "bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] group-hover:scale-[1.02] group-active:scale-[0.985]",
                )}
              />
              <span
                className={cn(
                  "relative z-10 inline-flex items-center justify-center gap-[8px] whitespace-nowrap leading-none",
                  disabled || !canSendEmbed ? "text-[#B7B7B7]" : "text-[#282828]",
                )}
              >
                {isSendingEmbed ? (
                  <>
                    <ButtonLoader
                      size={16}
                      colorClassName={disabled || !canSendEmbed ? "text-[#B7B7B7]" : "text-[#282828]"}
                    />
                    Enviando embed
                  </>
                ) : (
                  "Enviar embed"
                )}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="relative isolate overflow-visible grid gap-[18px] xl:grid-cols-[minmax(0,1fr)_436px]">
        <div className="relative z-[30] space-y-[16px] overflow-visible">
          {layout.length ? (
            <>
              {layout.map((component) =>
                component.type === "container"
                  ? renderContainer(component)
                  : cardShell(
                      component,
                      { parentId: null, componentId: component.id },
                      renderLeafEditor(component, { parentId: null, componentId: component.id }),
                    ),
              )}

              <div className="relative z-[40] inline-flex" data-ticket-menu="true">
                <ActionButton
                  disabled={disabled}
                  onClick={(event) => {
                    const shouldClose = openMenu && openMenu.kind === "root";
                    setOpenMenu(shouldClose ? null : { kind: "root" });
                    setMenuAnchor(shouldClose ? null : getMenuAnchor(event.currentTarget));
                  }}
                  className="h-[44px] rounded-[14px] px-[14px]"
                >
                  <Plus className="h-[15px] w-[15px]" />
                  Adicionar componente
                  <ChevronDown className="h-[14px] w-[14px]" />
                </ActionButton>
                {openMenu && openMenu.kind === "root" ? (
                  <Menu
                    items={rootItems}
                    anchor={menuAnchor}
                    onSelect={(type) => {
                      commit([...layout, createTicketPanelComponentByType(type)]);
                      setOpenMenu(null);
                      setMenuAnchor(null);
                    }}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="relative z-[40] inline-flex" data-ticket-menu="true">
                <ActionButton
                  disabled={disabled}
                  onClick={(event) => {
                    const shouldClose = openMenu && openMenu.kind === "root";
                    setOpenMenu(shouldClose ? null : { kind: "root" });
                    setMenuAnchor(shouldClose ? null : getMenuAnchor(event.currentTarget));
                  }}
                  className="h-[44px] rounded-[14px] px-[14px]"
                >
                  <Plus className="h-[15px] w-[15px]" />
                  Adicionar componente
                  <ChevronDown className="h-[14px] w-[14px]" />
                </ActionButton>
                {openMenu && openMenu.kind === "root" ? (
                  <Menu
                    items={rootItems}
                    anchor={menuAnchor}
                    onSelect={(type) => {
                      commit([...layout, createTicketPanelComponentByType(type)]);
                      setOpenMenu(null);
                      setMenuAnchor(null);
                    }}
                  />
                ) : null}
              </div>

              <div className="rounded-[30px] border border-dashed border-[#1B1B1B] bg-[#090909] px-[24px] py-[34px] text-center">
                <p className="text-[16px] font-medium text-[#E4E4E4]">Nenhum componente adicionado ainda</p>
                <p className="mt-[8px] text-[14px] leading-[1.65] text-[#7A7A7A]">
                  Comece por um conteudo ou por um container vazio e monte o embed do seu jeito.
                </p>
              </div>
            </>
          )}
        </div>

        <div className={cn("min-w-0 xl:self-start", !layout.length && "pt-[60px]")}>
          <div className="xl:sticky xl:top-[24px]">
            <div className="rounded-[30px] border border-[#121212] bg-[#080808] p-[20px] shadow-[0_26px_70px_rgba(0,0,0,0.3)]">
              <div>
                <div className="flex items-start gap-[12px]">
                  <div className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full bg-[#060606] text-[18px] font-semibold text-[#F3F4F6]">
                    F
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-[8px]">
                      <p className="text-[16px] font-semibold text-[#F2F3F5]">Flowdesk</p>
                      <span className="rounded-[8px] bg-[#5865F2] px-[8px] py-[3px] text-[11px] font-semibold uppercase tracking-[0.08em] text-white">
                        App
                      </span>
                      <span className="text-[12px] text-[#A3A7AE]">Agora mesmo</span>
                    </div>
                  </div>
                </div>

                {layout.length ? (
                  <div className="mt-[14px] space-y-[14px]">
                    {renderPreview(layout)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {emojiAutocomplete ? (
        <EmojiAutocompleteMenu
          anchor={emojiAutocomplete.anchor}
          items={filteredEmojiSuggestions}
          activeIndex={Math.min(emojiHighlightIndex, Math.max(filteredEmojiSuggestions.length - 1, 0))}
          loading={emojiCatalogLoading}
          onHover={setEmojiHighlightIndex}
          onSelect={(emoji) => applyEmojiSuggestion(emojiAutocomplete.scope, emoji)}
        />
      ) : null}

      {pendingPreviewLink && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[430] flex items-center justify-center bg-black/78 px-4 py-6 backdrop-blur-[3px]"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setPendingPreviewLink(null);
                }
              }}
            >
              <div className="relative w-full max-w-[520px] overflow-hidden rounded-[26px]">
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[26px] border border-[#0E0E0E]" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-[-2px] rounded-[26px] flowdesk-tag-border-glow" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-[-1px] rounded-[26px] flowdesk-tag-border-core" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-[1px] rounded-[25px] bg-[#070707]" />

                <div className="relative z-10 px-[20px] py-[20px] sm:px-[24px] sm:py-[24px]">
                  <div className="relative inline-flex overflow-hidden rounded-full">
                    <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border border-[#0E0E0E]" />
                    <span aria-hidden="true" className="pointer-events-none absolute inset-[-2px] rounded-full flowdesk-tag-border-glow" />
                    <span aria-hidden="true" className="pointer-events-none absolute inset-[-1px] rounded-full flowdesk-tag-border-core" />
                    <span aria-hidden="true" className="pointer-events-none absolute inset-[1px] rounded-full bg-[#070707]" />
                    <span className="relative z-10 inline-flex h-[30px] items-center px-[13px] text-[11px] font-medium uppercase tracking-[0.2em] text-[#8C8C8C]">
                      Link externo
                    </span>
                  </div>
                  <h4 className="mt-[10px] text-[24px] leading-none font-medium tracking-[-0.04em] text-[#DCDCDC]">
                    Voce sera redirecionado
                  </h4>
                  <p className="mt-[12px] text-[14px] leading-[1.7] text-[#7C7C7C]">
                    Vamos abrir <span className="text-[#D6D6D6]">{pendingPreviewLink.label || "este link"}</span> em uma nova aba. Confirme para continuar.
                  </p>

                  <div className="mt-[18px] rounded-[18px] border border-[#171717] bg-[#090909] px-[14px] py-[13px] text-[13px] leading-[1.6] text-[#A9A9A9]">
                    <span className="break-all text-[#E0E0E0]">{pendingPreviewLink.url}</span>
                  </div>

                  <div className="mt-[18px] flex flex-col-reverse gap-[10px] sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setPendingPreviewLink(null)}
                      className="group relative inline-flex h-[46px] items-center justify-center overflow-visible rounded-[12px] px-6 text-[16px] leading-none font-semibold"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-[12px] bg-[#111111] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                      />
                      <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap text-[#B7B7B7]">
                        Cancelar
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmPreviewLink}
                      className="group relative inline-flex h-[46px] items-center justify-center overflow-visible rounded-[12px] px-6 text-[16px] leading-none font-semibold"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-[12px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] transition-transform duration-150 ease-out group-hover:scale-[1.02] group-active:scale-[0.985]"
                      />
                      <span className="relative z-10 inline-flex items-center justify-center whitespace-nowrap text-[#282828]">
                        Confirmar redirecionamento
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}

export { TicketMessageBuilder };
