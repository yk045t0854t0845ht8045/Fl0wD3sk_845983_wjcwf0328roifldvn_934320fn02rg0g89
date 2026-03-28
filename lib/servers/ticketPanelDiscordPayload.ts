import {
  DEFAULT_TICKET_PANEL_BUTTON_LABEL,
  deriveLegacyTicketPanelFields,
  normalizeTicketPanelLayout,
  type TicketPanelButtonComponent,
  type TicketPanelButtonStyle,
  type TicketPanelComponent,
  type TicketPanelContainerComponent,
  type TicketPanelContainerChild,
  type TicketPanelContentAccessory,
  type TicketPanelContentComponent,
  type TicketPanelLayout,
  type TicketPanelLinkButtonComponent,
  type TicketPanelSelectComponent,
} from "@/lib/servers/ticketPanelBuilder";

const OPEN_TICKET_CUSTOM_ID = "ticket:open";
const PREVIEW_SELECT_CUSTOM_ID = "ticket:preview:select";

const COMPONENT_TYPE = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  SECTION: 9,
  TEXT_DISPLAY: 10,
  THUMBNAIL: 11,
  MEDIA_GALLERY: 12,
  SEPARATOR: 14,
  CONTAINER: 17,
} as const;

const BUTTON_STYLE = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const;

const SEPARATOR_SPACING = {
  SMALL: 1,
  LARGE: 2,
} as const;

const MESSAGE_FLAG_IS_COMPONENTS_V2 = 32768;

type JsonRecord = Record<string, unknown>;

type BuildState = {
  hasInteractiveOpenAction: boolean;
};

type AnyPanelComponent = TicketPanelComponent | TicketPanelContainerChild;

function resolveButtonStyle(style: TicketPanelButtonStyle) {
  switch (style) {
    case "secondary":
      return BUTTON_STYLE.SECONDARY;
    case "success":
      return BUTTON_STYLE.SUCCESS;
    case "danger":
      return BUTTON_STYLE.DANGER;
    default:
      return BUTTON_STYLE.PRIMARY;
  }
}

function buildTextContent(markdown: string) {
  const safeMarkdown = markdown.trim();
  if (safeMarkdown) {
    return safeMarkdown;
  }
  return "### Novo painel de ticket";
}

function buildTextDisplay(content: string): JsonRecord {
  return {
    type: COMPONENT_TYPE.TEXT_DISPLAY,
    content,
  };
}

function buildButton(
  component:
    | TicketPanelButtonComponent
    | TicketPanelLinkButtonComponent
    | Extract<TicketPanelContentAccessory, { type: "button" | "link_button" }>,
  state: BuildState,
): JsonRecord {
  if (component.type === "link_button") {
    return {
      type: COMPONENT_TYPE.BUTTON,
      style: BUTTON_STYLE.LINK,
      label: component.label.trim() || "Abrir link",
      url: component.url.trim() || "https://flowdesk.com.br",
    };
  }

  state.hasInteractiveOpenAction = true;
  return {
    type: COMPONENT_TYPE.BUTTON,
    custom_id: OPEN_TICKET_CUSTOM_ID,
    style: resolveButtonStyle(component.style),
    label: component.label.trim() || DEFAULT_TICKET_PANEL_BUTTON_LABEL,
    disabled: Boolean(component.disabled),
  };
}

function chunkButtons(buttons: JsonRecord[]) {
  const rows: JsonRecord[] = [];

  for (let index = 0; index < buttons.length; index += 5) {
    rows.push({
      type: COMPONENT_TYPE.ACTION_ROW,
      components: buttons.slice(index, index + 5),
    });
  }

  return rows;
}

function buildSelectRow(component: TicketPanelSelectComponent): JsonRecord {
  const options = (
    component.options.length
      ? component.options
      : [{ id: "fallback", label: "Opcao", description: "" }]
  ).slice(0, 25);

  return {
    type: COMPONENT_TYPE.ACTION_ROW,
    components: [
      {
        type: COMPONENT_TYPE.STRING_SELECT,
        custom_id: PREVIEW_SELECT_CUSTOM_ID,
        placeholder: component.placeholder.trim() || "Escolha uma opcao",
        disabled: true,
        options: options.map((option, index) => ({
          label: option.label.trim() || `Opcao ${index + 1}`,
          description: option.description.trim() || undefined,
          value: option.id || `option_${index + 1}`,
        })),
      },
    ],
  };
}

function addActionsToComponents(
  target: JsonRecord[],
  actions: Array<
    TicketPanelButtonComponent | TicketPanelLinkButtonComponent | TicketPanelSelectComponent
  >,
  state: BuildState,
) {
  const bufferedButtons: JsonRecord[] = [];

  const flushButtons = () => {
    if (!bufferedButtons.length) return;
    target.push(...chunkButtons(bufferedButtons.splice(0, bufferedButtons.length)));
  };

  for (const action of actions) {
    if (action.type === "select") {
      flushButtons();
      target.push(buildSelectRow(action));
      continue;
    }

    bufferedButtons.push(buildButton(action, state));
  }

  flushButtons();
}

function addContentComponent(
  target: JsonRecord[],
  content: TicketPanelContentComponent,
  state: BuildState,
) {
  const textContent = buildTextContent(content.markdown);

  if (!content.accessory) {
    target.push(buildTextDisplay(textContent));
    return;
  }

  if (content.accessory.type === "thumbnail" && content.accessory.imageUrl.trim()) {
    target.push({
      type: COMPONENT_TYPE.SECTION,
      components: [buildTextDisplay(textContent)],
      accessory: {
        type: COMPONENT_TYPE.THUMBNAIL,
        media: {
          url: content.accessory.imageUrl.trim(),
        },
      },
    });
    return;
  }

  if (
    (content.accessory.type === "button" ||
      content.accessory.type === "link_button") &&
    (content.accessory.type !== "link_button" || content.accessory.url.trim())
  ) {
    target.push({
      type: COMPONENT_TYPE.SECTION,
      components: [buildTextDisplay(textContent)],
      accessory: buildButton(content.accessory, state),
    });
    return;
  }

  target.push(buildTextDisplay(textContent));
}

function addDisplayComponent(
  target: JsonRecord[],
  component: Exclude<
    AnyPanelComponent,
    TicketPanelButtonComponent | TicketPanelLinkButtonComponent | TicketPanelSelectComponent | TicketPanelContainerComponent
  >,
  state: BuildState,
) {
  if (component.type === "content") {
    addContentComponent(target, component, state);
    return;
  }

  if (component.type === "image" && component.url.trim()) {
    target.push({
      type: COMPONENT_TYPE.MEDIA_GALLERY,
      items: [
        {
          media: {
            url: component.url.trim(),
          },
        },
      ],
    });
    return;
  }

  if (component.type === "file") {
    const fileText = [
      `### ${component.name.trim() || "Arquivo"}`,
      component.sizeLabel.trim() ? `-# ${component.sizeLabel.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    target.push(buildTextDisplay(fileText));
    return;
  }

  if (component.type === "separator") {
    target.push({
      type: COMPONENT_TYPE.SEPARATOR,
      divider: true,
      spacing: mapSeparatorSpacing(component.spacing),
    });
  }
}

function mapSeparatorSpacing(spacing: "sm" | "md" | "lg") {
  if (spacing === "lg") return SEPARATOR_SPACING.LARGE;
  return SEPARATOR_SPACING.SMALL;
}

function buildComponentList(
  components: AnyPanelComponent[],
  state: BuildState,
) {
  const built: JsonRecord[] = [];
  let pendingActions: Array<
    TicketPanelButtonComponent | TicketPanelLinkButtonComponent | TicketPanelSelectComponent
  > = [];

  const flushPendingActions = () => {
    if (!pendingActions.length) return;
    addActionsToComponents(built, pendingActions, state);
    pendingActions = [];
  };

  for (const component of components) {
    if (
      component.type === "button" ||
      component.type === "link_button" ||
      component.type === "select"
    ) {
      pendingActions.push(component);
      continue;
    }

    flushPendingActions();

    if (component.type === "container") {
      built.push({
        type: COMPONENT_TYPE.CONTAINER,
        accent_color: component.accentColor.trim()
          ? Number.parseInt(component.accentColor.slice(1), 16)
          : undefined,
        components: buildComponentList(component.children, state),
      });
      continue;
    }

    addDisplayComponent(built, component, state);
  }

  flushPendingActions();
  return built;
}

export function buildTicketPanelDispatchPayload(layoutInput: TicketPanelLayout) {
  const layout = normalizeTicketPanelLayout(layoutInput);
  const derived = deriveLegacyTicketPanelFields(layout);
  const state: BuildState = {
    hasInteractiveOpenAction: false,
  };

  const components = buildComponentList(layout, state);

  if (!state.hasInteractiveOpenAction) {
    components.push({
      type: COMPONENT_TYPE.ACTION_ROW,
      components: [
        {
          type: COMPONENT_TYPE.BUTTON,
          custom_id: OPEN_TICKET_CUSTOM_ID,
          style: BUTTON_STYLE.PRIMARY,
          label: derived.panelButtonLabel || DEFAULT_TICKET_PANEL_BUTTON_LABEL,
        },
      ],
    });
  }

  return {
    flags: MESSAGE_FLAG_IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] as string[] },
    components,
  };
}

export function ticketPanelMessageLooksManaged(message: unknown) {
  if (!message || typeof message !== "object") return false;
  const record = message as Record<string, unknown>;
  const author = record.author as Record<string, unknown> | undefined;
  if (!author || author.bot !== true) return false;

  const walk = (components: unknown): boolean => {
    if (!Array.isArray(components)) return false;
    for (const component of components) {
      if (!component || typeof component !== "object") continue;
      const recordComponent = component as Record<string, unknown>;
      if (recordComponent.custom_id === OPEN_TICKET_CUSTOM_ID) {
        return true;
      }
      if (walk(recordComponent.components)) {
        return true;
      }
      if (recordComponent.accessory && walk([recordComponent.accessory])) {
        return true;
      }
    }
    return false;
  };

  return walk(record.components);
}
