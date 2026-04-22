"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { configStepTwoScale } from "@/components/config/configStepTwoScale";
import { resolveConfigStepDropdownRect } from "@/components/config/configStepDropdownPosition";
import { ButtonLoader } from "@/components/login/ButtonLoader";

type SelectOption = {
  id: string;
  name: string;
};

type ConfigStepMultiSelectProps = {
  label: string;
  placeholder: string;
  options: SelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  controlHeightPx?: number;
  variant?: "default" | "immersive";
};

export function ConfigStepMultiSelect({
  label,
  placeholder,
  options,
  values,
  onChange,
  disabled = false,
  loading = false,
  controlHeightPx,
  variant = "default",
}: ConfigStepMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: "top" | "bottom";
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const isBlocked = disabled || loading;
  const isDropdownOpen = isOpen && !isBlocked;
  const isImmersive = variant === "immersive";
  const shouldRenderLabel = Boolean(String(label || "").trim()) && !isImmersive;
  const visibleRows = Math.min(
    Math.max(options.length, 1),
    configStepTwoScale.maxVisibleOptions,
  );
  const dropdownHeight = visibleRows * configStepTwoScale.optionHeight;

  useEffect(() => {
    if (!isDropdownOpen) return;

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    window.addEventListener("mousedown", handleOutsideClick);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!isDropdownOpen) return;

    function syncDropdownRect() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      setDropdownRect(
        resolveConfigStepDropdownRect({
          triggerRect: rect,
          desiredHeight: dropdownHeight,
        }),
      );
    }

    syncDropdownRect();
    window.addEventListener("resize", syncDropdownRect);
    window.addEventListener("scroll", syncDropdownRect, true);

    return () => {
      window.removeEventListener("resize", syncDropdownRect);
      window.removeEventListener("scroll", syncDropdownRect, true);
    };
  }, [dropdownHeight, isDropdownOpen]);

  const selectedNames = useMemo(() => {
    const selectedSet = new Set(values);
    return options
      .filter((option) => selectedSet.has(option.id))
      .map((option) => option.name);
  }, [options, values]);

  const selectedLabel = useMemo(() => {
    if (!selectedNames.length) return placeholder;
    if (selectedNames.length === 1) return selectedNames[0];
    return `${selectedNames.length} cargos selecionados`;
  }, [placeholder, selectedNames]);
  const labelClassName = isImmersive
    ? "mb-[12px] text-[11px] font-medium tracking-[0.18em] uppercase text-[#6E6E6E]"
    : "mb-[10px] font-medium tracking-[-0.02em] text-[#A7A7A7]";
  const triggerClassName = isImmersive
    ? `flex w-full border border-[#181818] bg-[linear-gradient(180deg,#0D0D0D_0%,#080808_100%)] text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-[border-color,background-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-65 ${
        loading ? "justify-center" : "items-center hover:border-[#242424]"
      }`
    : `flex w-full border border-[#141414] bg-[#080808] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-65 ${
        loading ? "justify-center" : "items-center"
      }`;
  const triggerPaddingLeft = isImmersive ? 16 : 14;
  const triggerPaddingRight = isImmersive ? 14 : 12;
  const triggerRadius = isImmersive ? 18 : 16;
  const dropdownClassName = isImmersive
    ? "flowdesk-selectmenu-scrollbar flowdesk-scale-in-soft fixed z-[6200] overflow-y-auto overscroll-contain border border-[#1A1A1A] bg-[#070707] shadow-[0_28px_80px_rgba(0,0,0,0.56)] backdrop-blur-[16px] transition-all duration-200 ease-out [touch-action:pan-y]"
    : "flowdesk-selectmenu-scrollbar flowdesk-scale-in-soft fixed z-[6200] overflow-y-auto overscroll-contain border bg-[#080808] shadow-[0_24px_64px_rgba(0,0,0,0.5)] backdrop-blur-[12px] transition-all duration-200 ease-out [touch-action:pan-y]";
  const optionClassName = (selected: boolean) =>
    isImmersive
      ? `mx-[6px] my-[4px] flex w-[calc(100%-12px)] items-center gap-3 rounded-[14px] border px-[14px] text-left transition-colors ${
          selected
            ? "border-[rgba(128,184,255,0.22)] bg-[rgba(16,23,34,0.92)] text-[#EAF2FF]"
            : "border-transparent text-[#BABABA] hover:border-[#1E1E1E] hover:bg-[#101010] hover:text-[#E7E7E7]"
        }`
      : `mx-[6px] my-[4px] flex w-[calc(100%-12px)] items-center gap-3 rounded-[12px] px-[14px] text-left transition-colors ${
          selected
            ? "bg-[#101010] text-[#E1E1E1]"
            : "text-[#B5B5B5] hover:bg-[#101010] hover:text-[#E1E1E1]"
        }`;

  function toggleValue(roleId: string) {
    const isSelected = values.includes(roleId);
    if (isSelected) {
      onChange(values.filter((id) => id !== roleId));
      return;
    }

    onChange([...values, roleId]);
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${isDropdownOpen ? "z-[260]" : "z-[1]"}`}
    >
      {shouldRenderLabel ? (
        <p className={labelClassName} style={{ fontSize: `${configStepTwoScale.labelSize}px` }}>
          {label}
        </p>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (isBlocked) return;
          setIsOpen((current) => !current);
        }}
        disabled={isBlocked}
        aria-busy={loading}
        className={triggerClassName}
        style={{
          height: `${controlHeightPx ?? configStepTwoScale.controlHeight}px`,
          borderRadius: `${triggerRadius}px`,
          paddingLeft: `${triggerPaddingLeft}px`,
          paddingRight: `${triggerPaddingRight}px`,
        }}
      >
        {loading ? (
          <ButtonLoader size={20} />
        ) : (
          <>
            <span
              className={`truncate pr-3 ${
                selectedNames.length
                  ? isImmersive
                    ? "text-[#EFEFEF]"
                    : "text-[#D5D5D5]"
                  : isImmersive
                    ? "text-[#616161]"
                    : "text-[#5A5A5A]"
              }`}
              style={{ fontSize: `${configStepTwoScale.controlTextSize}px` }}
            >
              {selectedLabel}
            </span>

            <span
              className="ml-auto inline-flex items-center justify-center"
              style={{
                width: `${configStepTwoScale.arrowSize}px`,
                height: `${configStepTwoScale.arrowSize}px`,
              }}
            >
              <Image
                src="/icons/seta.png"
                alt="Abrir lista"
                width={configStepTwoScale.arrowSize}
                height={configStepTwoScale.arrowSize}
                className={
                  isDropdownOpen
                    ? "rotate-180 transition-transform duration-300 ease-out"
                    : "rotate-0 transition-transform duration-300 ease-out"
                }
              />
            </span>
          </>
        )}
      </button>

      {isDropdownOpen && dropdownRect
        ? createPortal(
            <div
              ref={dropdownRef}
              className={dropdownClassName}
              style={{
                top: `${dropdownRect.top}px`,
                left: `${dropdownRect.left}px`,
                width: `${dropdownRect.width}px`,
                maxHeight: `${dropdownRect.maxHeight}px`,
                opacity: 1,
                transform: "translateY(0)",
                transformOrigin:
                  dropdownRect.placement === "top" ? "bottom center" : "top center",
                borderColor: isImmersive ? "#1A1A1A" : "#141414",
                borderRadius: `${triggerRadius}px`,
              }}
            >
              {options.length ? (
                options.map((option) => {
                  const selected = values.includes(option.id);

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleValue(option.id)}
                      className={optionClassName(selected)}
                      style={{
                        height: `${configStepTwoScale.optionHeight}px`,
                        fontSize: `${configStepTwoScale.optionTextSize}px`,
                      }}
                    >
                      <span
                        className={`inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border ${
                          selected
                            ? "border-[#D8D8D8] bg-[#D8D8D8] text-black"
                            : "border-[#242424] bg-transparent text-transparent"
                        }`}
                      >
                        {selected ? (
                          <svg
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                            className="h-[11px] w-[11px]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 8.5l3.1 3.1L13 4.7" />
                          </svg>
                        ) : null}
                      </span>
                      <span className="truncate">{option.name}</span>
                    </button>
                  );
                })
              ) : (
                <div
                  className="flex h-full items-center justify-center px-4 text-center text-[#8A8A8A]"
                  style={{ fontSize: `${configStepTwoScale.optionTextSize}px` }}
                >
                  Nenhuma opcao disponivel
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
