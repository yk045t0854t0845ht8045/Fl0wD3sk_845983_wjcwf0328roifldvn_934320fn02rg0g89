"use client";

type DropdownPlacement = "top" | "bottom";

type DropdownRect = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: DropdownPlacement;
};

const VIEWPORT_MARGIN_PX = 12;
const TRIGGER_GAP_PX = 8;
const MIN_DROPDOWN_HEIGHT_PX = 168;

export function resolveConfigStepDropdownRect(input: {
  triggerRect: DOMRect;
  desiredHeight: number;
}) : DropdownRect {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const safeDesiredHeight = Math.max(1, Math.round(input.desiredHeight));

  const availableBelow = Math.max(
    0,
    viewportHeight - input.triggerRect.bottom - TRIGGER_GAP_PX - VIEWPORT_MARGIN_PX,
  );
  const availableAbove = Math.max(
    0,
    input.triggerRect.top - TRIGGER_GAP_PX - VIEWPORT_MARGIN_PX,
  );
  const fallbackHeight = Math.min(
    safeDesiredHeight,
    Math.max(MIN_DROPDOWN_HEIGHT_PX, Math.max(availableAbove, availableBelow)),
  );

  const shouldOpenUp =
    availableBelow < safeDesiredHeight && availableAbove > availableBelow;
  const preferredAvailable = shouldOpenUp ? availableAbove : availableBelow;
  const maxHeight = Math.min(
    safeDesiredHeight,
    Math.max(preferredAvailable, fallbackHeight),
  );

  const unclampedTop = shouldOpenUp
    ? input.triggerRect.top - TRIGGER_GAP_PX - maxHeight
    : input.triggerRect.bottom + TRIGGER_GAP_PX;
  const top = Math.max(
    VIEWPORT_MARGIN_PX,
    Math.min(unclampedTop, viewportHeight - VIEWPORT_MARGIN_PX - maxHeight),
  );

  const maxWidth = Math.max(180, viewportWidth - VIEWPORT_MARGIN_PX * 2);
  const width = Math.min(input.triggerRect.width, maxWidth);
  const left = Math.max(
    VIEWPORT_MARGIN_PX,
    Math.min(input.triggerRect.left, viewportWidth - VIEWPORT_MARGIN_PX - width),
  );

  return {
    top,
    left,
    width,
    maxHeight,
    placement: shouldOpenUp ? "top" : "bottom",
  };
}

export type { DropdownRect, DropdownPlacement };
