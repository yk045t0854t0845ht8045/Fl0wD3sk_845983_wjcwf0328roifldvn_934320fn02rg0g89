export const DEFAULT_TICKET_PANEL_TITLE = "Abrir atendimento";
export const DEFAULT_TICKET_PANEL_DESCRIPTION =
  "Escolha uma opcao abaixo para falar com a equipe responsavel.";
export const DEFAULT_TICKET_PANEL_BUTTON_LABEL = "Abrir ticket";

export type TicketPanelComponentType =
  | "content"
  | "container"
  | "image"
  | "file"
  | "separator"
  | "button"
  | "link_button"
  | "select";

export type TicketPanelButtonStyle =
  | "primary"
  | "secondary"
  | "success"
  | "danger";

export type TicketPanelContentAccessoryType =
  | "button"
  | "link_button"
  | "thumbnail"
  | "user_thumbnail";

type TicketPanelComponentBase = {
  id: string;
  type: TicketPanelComponentType;
};

export type TicketPanelThumbnailAccessory = {
  type: "thumbnail";
  imageUrl: string;
  alt: string;
};

export type TicketPanelUserThumbnailAccessory = {
  type: "user_thumbnail";
  alt: string;
};

export type TicketPanelButtonAccessory = {
  type: "button";
  label: string;
  style: TicketPanelButtonStyle;
  disabled: boolean;
};

export type TicketPanelLinkButtonAccessory = {
  type: "link_button";
  label: string;
  url: string;
};

export type TicketPanelContentAccessory =
  | TicketPanelThumbnailAccessory
  | TicketPanelUserThumbnailAccessory
  | TicketPanelButtonAccessory
  | TicketPanelLinkButtonAccessory;

export type TicketPanelContentComponent = TicketPanelComponentBase & {
  type: "content";
  markdown: string;
  accessory: TicketPanelContentAccessory | null;
};

export type TicketPanelImageComponent = TicketPanelComponentBase & {
  type: "image";
  url: string;
  alt: string;
};

export type TicketPanelFileComponent = TicketPanelComponentBase & {
  type: "file";
  name: string;
  sizeLabel: string;
};

export type TicketPanelSeparatorComponent = TicketPanelComponentBase & {
  type: "separator";
  spacing: "sm" | "md" | "lg";
};

export type TicketPanelButtonComponent = TicketPanelComponentBase & {
  type: "button";
  label: string;
  style: TicketPanelButtonStyle;
  disabled: boolean;
};

export type TicketPanelLinkButtonComponent = TicketPanelComponentBase & {
  type: "link_button";
  label: string;
  url: string;
};

export type TicketPanelSelectOption = {
  id: string;
  label: string;
  description: string;
};

export type TicketPanelSelectComponent = TicketPanelComponentBase & {
  type: "select";
  placeholder: string;
  options: TicketPanelSelectOption[];
};

export type TicketPanelContainerChild =
  | TicketPanelContentComponent
  | TicketPanelImageComponent
  | TicketPanelFileComponent
  | TicketPanelSeparatorComponent
  | TicketPanelButtonComponent
  | TicketPanelLinkButtonComponent
  | TicketPanelSelectComponent;

export type TicketPanelContainerComponent = TicketPanelComponentBase & {
  type: "container";
  accentColor: string;
  children: TicketPanelContainerChild[];
};

export type TicketPanelComponent =
  | TicketPanelContentComponent
  | TicketPanelContainerComponent
  | TicketPanelImageComponent
  | TicketPanelFileComponent
  | TicketPanelSeparatorComponent
  | TicketPanelButtonComponent
  | TicketPanelLinkButtonComponent
  | TicketPanelSelectComponent;

export type TicketPanelLayout = TicketPanelComponent[];

export type LegacyTicketPanelFields = {
  panelTitle: string;
  panelDescription: string;
  panelButtonLabel: string;
};

function stripMarkdownDecorators(value: string) {
  return value
    .replace(/^\s{0,3}(?:#{1,6}|-#)\s*/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .trim();
}

function buildMarkdownFromLegacy(legacy?: Partial<LegacyTicketPanelFields>) {
  const title = trimText(legacy?.panelTitle) || DEFAULT_TICKET_PANEL_TITLE;
  const description =
    trimText(legacy?.panelDescription) || DEFAULT_TICKET_PANEL_DESCRIPTION;

  return [`## ${title}`, description].filter(Boolean).join("\n");
}

function trimText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function clampText(value: string, maxLength: number) {
  return value.slice(0, maxLength);
}

function getCandidateString(
  candidate: Record<string, unknown>,
  key: string,
  fallback: string,
  maxLength: number,
) {
  if (typeof candidate[key] === "string") {
    return clampText(candidate[key] as string, maxLength);
  }

  return clampText(fallback, maxLength);
}

function sanitizeAccentColor(value: unknown) {
  const normalized = trimText(value);
  if (!normalized) return "";
  return /^#(?:[0-9a-fA-F]{6})$/.test(normalized) ? normalized : "";
}

function sanitizeButtonStyle(value: unknown): TicketPanelButtonStyle {
  if (
    value === "primary" ||
    value === "secondary" ||
    value === "success" ||
    value === "danger"
  ) {
    return value;
  }

  return "primary";
}

function sanitizeSeparatorSpacing(
  value: unknown,
): TicketPanelSeparatorComponent["spacing"] {
  if (value === "sm" || value === "md" || value === "lg") {
    return value;
  }
  return "md";
}

export function createTicketPanelComponentId(prefix = "cmp") {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export function getDefaultTicketPanelSelectOptions(): TicketPanelSelectOption[] {
  return [
    {
      id: createTicketPanelComponentId("opt"),
      label: "Suporte geral",
      description: "Fale com a equipe principal.",
    },
    {
      id: createTicketPanelComponentId("opt"),
      label: "Financeiro",
      description: "Questoes de cobranca e pagamento.",
    },
  ];
}

export function createTicketPanelContentAccessoryByType(
  type: TicketPanelContentAccessoryType,
): TicketPanelContentAccessory {
  if (type === "thumbnail") {
    return {
      type,
      imageUrl: "",
      alt: "",
    };
  }

  if (type === "user_thumbnail") {
    return {
      type,
      alt: "",
    };
  }

  if (type === "link_button") {
    return {
      type,
      label: "Abrir link",
      url: "https://flowdesk.com.br",
    };
  }

  return {
    type: "button",
    label: "Acao",
    style: "primary",
    disabled: false,
  };
}

export function createDefaultTicketPanelLayout(
  legacy?: Partial<LegacyTicketPanelFields>,
): TicketPanelLayout {
  const buttonLabel =
    trimText(legacy?.panelButtonLabel) || DEFAULT_TICKET_PANEL_BUTTON_LABEL;

  return [
    {
      id: createTicketPanelComponentId("content"),
      type: "content",
      markdown: buildMarkdownFromLegacy(legacy),
      accessory: null,
    },
    {
      id: createTicketPanelComponentId("separator"),
      type: "separator",
      spacing: "md",
    },
    {
      id: createTicketPanelComponentId("button"),
      type: "button",
      label: buttonLabel,
      style: "primary",
      disabled: false,
    },
  ];
}

export function createTicketPanelComponentByType(
  type: TicketPanelComponentType,
): TicketPanelComponent {
  switch (type) {
    case "content":
      return {
        id: createTicketPanelComponentId("content"),
        type,
        markdown:
          "## Novo conteudo\nExplique aqui como o usuario deve usar este bloco dentro da mensagem.",
        accessory: null,
      };
    case "container":
      return {
        id: createTicketPanelComponentId("container"),
        type,
        accentColor: "",
        children: [],
      };
    case "image":
      return {
        id: createTicketPanelComponentId("image"),
        type,
        url: "",
        alt: "",
      };
    case "file":
      return {
        id: createTicketPanelComponentId("file"),
        type,
        name: "Guia-flowdesk.pdf",
        sizeLabel: "PDF | 1.2 MB",
      };
    case "separator":
      return {
        id: createTicketPanelComponentId("separator"),
        type,
        spacing: "md",
      };
    case "button":
      return {
        id: createTicketPanelComponentId("button"),
        type,
        label: "Acao principal",
        style: "primary",
        disabled: false,
      };
    case "link_button":
      return {
        id: createTicketPanelComponentId("link"),
        type,
        label: "Abrir link",
        url: "https://flowdesk.com.br",
      };
    case "select":
      return {
        id: createTicketPanelComponentId("select"),
        type,
        placeholder: "Escolha uma opcao",
        options: getDefaultTicketPanelSelectOptions(),
      };
  }
}

export function createTicketPanelContainerChildByType(
  type: Exclude<TicketPanelComponentType, "container">,
): TicketPanelContainerChild {
  return createTicketPanelComponentByType(type) as TicketPanelContainerChild;
}

function normalizeSelectOptions(value: unknown): TicketPanelSelectOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const options = value
    .map((option) => {
      if (!option || typeof option !== "object") return null;
      const candidate = option as Record<string, unknown>;

      return {
        id: trimText(candidate.id) || createTicketPanelComponentId("opt"),
        label: getCandidateString(candidate, "label", "", 80),
        description: getCandidateString(candidate, "description", "", 160),
      } satisfies TicketPanelSelectOption;
    })
    .filter((option): option is TicketPanelSelectOption => option !== null);

  return options;
}

function normalizeContentAccessory(
  value: unknown,
): TicketPanelContentAccessory | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;

  if (candidate.type === "thumbnail") {
    return {
      type: "thumbnail",
      imageUrl: getCandidateString(candidate, "imageUrl", "", 1000),
      alt: "",
    };
  }

  if (candidate.type === "user_thumbnail") {
    return {
      type: "user_thumbnail",
      alt: "",
    };
  }

  if (candidate.type === "link_button") {
    return {
      type: "link_button",
      label: getCandidateString(candidate, "label", "Abrir link", 80),
      url: getCandidateString(candidate, "url", "https://flowdesk.com.br", 1000),
    };
  }

  if (candidate.type === "button") {
    return {
      type: "button",
      label: getCandidateString(candidate, "label", "Acao", 80),
      style: sanitizeButtonStyle(candidate.style),
      disabled: Boolean(candidate.disabled),
    };
  }

  return null;
}

function normalizeContentComponent(
  candidate: Record<string, unknown>,
  id: string,
  legacy?: Partial<LegacyTicketPanelFields>,
): TicketPanelContentComponent {
  const markdownFromField = getCandidateString(candidate, "markdown", "", 4000);
  const contentFromField = getCandidateString(candidate, "content", "", 4000);
  const title = getCandidateString(candidate, "title", "", 120);
  const description = getCandidateString(candidate, "description", "", 1200);
  const fallbackMarkdown = buildMarkdownFromLegacy(legacy);

  const markdown =
    markdownFromField ||
    contentFromField ||
    (title || description
      ? [title ? `## ${title}` : "", description].filter(Boolean).join("\n")
      : fallbackMarkdown);

  return {
    id,
    type: "content",
    markdown: clampText(markdown, 4000),
    accessory: normalizeContentAccessory(candidate.accessory),
  };
}

function normalizeNonContainerComponent(
  value: unknown,
  legacy?: Partial<LegacyTicketPanelFields>,
): TicketPanelContainerChild | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const type = candidate.type;
  const id =
    trimText(candidate.id) ||
    createTicketPanelComponentId(typeof type === "string" ? type : "cmp");

  switch (type) {
    case "content":
      return normalizeContentComponent(candidate, id, legacy);
    case "image":
      return {
        id,
        type,
        url: getCandidateString(candidate, "url", "", 1000),
        alt: "",
      };
    case "file":
      return {
        id,
        type,
        name: getCandidateString(candidate, "name", "Arquivo-flowdesk.pdf", 120),
        sizeLabel: getCandidateString(candidate, "sizeLabel", "PDF | 1.2 MB", 60),
      };
    case "separator":
      return {
        id,
        type,
        spacing: sanitizeSeparatorSpacing(candidate.spacing),
      };
    case "button":
      return {
        id,
        type,
        label: getCandidateString(
          candidate,
          "label",
          DEFAULT_TICKET_PANEL_BUTTON_LABEL,
          80,
        ),
        style: sanitizeButtonStyle(candidate.style),
        disabled: Boolean(candidate.disabled),
      };
    case "link_button":
      return {
        id,
        type,
        label: getCandidateString(candidate, "label", "Abrir link", 80),
        url: getCandidateString(candidate, "url", "https://flowdesk.com.br", 1000),
      };
    case "select":
      return {
        id,
        type,
        placeholder: getCandidateString(
          candidate,
          "placeholder",
          "Escolha uma opcao",
          100,
        ),
        options: normalizeSelectOptions(candidate.options),
      };
    default:
      return null;
  }
}

function normalizeContainerChildren(value: unknown): TicketPanelContainerChild[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((child) => normalizeNonContainerComponent(child))
    .filter((child): child is TicketPanelContainerChild => child !== null);
}

export function normalizeTicketPanelLayout(
  value: unknown,
  legacyFallback?: Partial<LegacyTicketPanelFields>,
): TicketPanelLayout {
  if (!Array.isArray(value)) {
    return createDefaultTicketPanelLayout(legacyFallback);
  }

  if (value.length === 0) {
    return [];
  }

  const normalized = value
    .map((component) => {
      if (!component || typeof component !== "object") return null;
      const candidate = component as Record<string, unknown>;
      const type = candidate.type;
      const id =
        trimText(candidate.id) ||
        createTicketPanelComponentId(
          typeof type === "string" ? type : "cmp",
        );

      if (type === "container") {
        let children = normalizeContainerChildren(candidate.children);

        if (
          children.length === 0 &&
          (trimText(candidate.title) || trimText(candidate.description))
        ) {
          children = [
            normalizeContentComponent(candidate, createTicketPanelComponentId("content")),
          ];
        }

        return {
          id,
          type,
          accentColor: sanitizeAccentColor(candidate.accentColor),
          children,
        } satisfies TicketPanelContainerComponent;
      }

      return normalizeNonContainerComponent(candidate, legacyFallback);
    })
    .filter((component): component is TicketPanelComponent => component !== null);

  return normalized;
}

function mapAccessoryWithNewIds(
  accessory: TicketPanelContentAccessory | null,
): TicketPanelContentAccessory | null {
  if (!accessory) return null;
  return { ...accessory };
}

function mapContainerChildWithNewIds(
  component: TicketPanelContainerChild,
): TicketPanelContainerChild {
  if (component.type === "content") {
    return {
      ...component,
      id: createTicketPanelComponentId(component.type),
      accessory: mapAccessoryWithNewIds(component.accessory),
    };
  }

  if (component.type === "select") {
    return {
      ...component,
      id: createTicketPanelComponentId(component.type),
      options: component.options.map((option) => ({
        ...option,
        id: createTicketPanelComponentId("opt"),
      })),
    };
  }

  return {
    ...component,
    id: createTicketPanelComponentId(component.type),
  };
}

export function cloneTicketPanelComponentWithNewIds(
  component: TicketPanelComponent,
): TicketPanelComponent {
  if (component.type === "container") {
    return {
      ...component,
      id: createTicketPanelComponentId(component.type),
      children: component.children.map(mapContainerChildWithNewIds),
    };
  }

  return mapContainerChildWithNewIds(component);
}

function walkComponent(
  component: TicketPanelComponent,
  visitor: (component: TicketPanelContainerChild) => void,
) {
  if (component.type === "container") {
    component.children.forEach((child) => {
      visitor(child);
    });
    return;
  }

  visitor(component);
}

export function deriveLegacyTicketPanelFields(
  layout: TicketPanelLayout,
): LegacyTicketPanelFields {
  const normalized = normalizeTicketPanelLayout(layout);
  let contentLike: TicketPanelContentComponent | null = null;
  let buttonLike:
    | TicketPanelButtonComponent
    | TicketPanelLinkButtonComponent
    | TicketPanelSelectComponent
    | null = null;

  for (const component of normalized) {
    walkComponent(component, (current) => {
      if (!contentLike && current.type === "content") {
        contentLike = current;
      }

      if (
        !buttonLike &&
        (current.type === "button" ||
          current.type === "link_button" ||
          current.type === "select")
      ) {
        buttonLike = current;
      }
    });
  }

  const resolvedContentLike = contentLike as TicketPanelContentComponent | null;
  const resolvedButtonLike = buttonLike as
    | TicketPanelButtonComponent
    | TicketPanelLinkButtonComponent
    | TicketPanelSelectComponent
    | null;

  const markdownLines = (resolvedContentLike?.markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const firstMeaningfulLine = markdownLines[0] || "";
  const titleCandidate = stripMarkdownDecorators(firstMeaningfulLine);
  const remainingLines = markdownLines.slice(1);
  const descriptionCandidate = remainingLines
    .map((line) => stripMarkdownDecorators(line))
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    panelTitle: clampText(titleCandidate || DEFAULT_TICKET_PANEL_TITLE, 80),
    panelDescription:
      clampText(
        descriptionCandidate ||
          titleCandidate ||
          DEFAULT_TICKET_PANEL_DESCRIPTION,
        400,
      ),
    panelButtonLabel:
      clampText(
        (resolvedButtonLike && "placeholder" in resolvedButtonLike
          ? resolvedButtonLike.placeholder
          : resolvedButtonLike?.label) || DEFAULT_TICKET_PANEL_BUTTON_LABEL,
        40,
      ),
  };
}

export function countTicketPanelFunctionButtons(layout: TicketPanelLayout) {
  const normalized = normalizeTicketPanelLayout(layout);
  let count = 0;

  for (const component of normalized) {
    walkComponent(component, (current) => {
      if (current.type === "button") {
        count += 1;
      }

      if (
        current.type === "content" &&
        current.accessory?.type === "button"
      ) {
        count += 1;
      }
    });
  }

  return count;
}

export function ticketPanelLayoutHasAtMostOneFunctionButton(
  layout: TicketPanelLayout,
) {
  return countTicketPanelFunctionButtons(layout) <= 1;
}

export function ticketPanelLayoutHasRequiredParts(layout: TicketPanelLayout) {
  const normalized = normalizeTicketPanelLayout(layout);
  let hasContent = false;
  let hasAction = false;

  for (const component of normalized) {
    walkComponent(component, (current) => {
      if (current.type === "content" && current.markdown.trim().length > 0) {
        hasContent = true;
      }

      if (
        current.type === "button" ||
        current.type === "link_button" ||
        current.type === "select"
      ) {
        hasAction = true;
      }
    });

    if (hasContent && hasAction) {
      return true;
    }
  }

  return hasContent && hasAction;
}
