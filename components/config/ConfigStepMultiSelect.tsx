"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { configStepTwoScale } from "@/components/config/configStepTwoScale";
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
}: ConfigStepMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const isBlocked = disabled || loading;
  const isDropdownOpen = isOpen && !isBlocked;

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

      setDropdownRect({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
      });
    }

    syncDropdownRect();
    window.addEventListener("resize", syncDropdownRect);
    window.addEventListener("scroll", syncDropdownRect, true);

    return () => {
      window.removeEventListener("resize", syncDropdownRect);
      window.removeEventListener("scroll", syncDropdownRect, true);
    };
  }, [isDropdownOpen]);

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

  const visibleRows = Math.min(
    Math.max(options.length, 1),
    configStepTwoScale.maxVisibleOptions,
  );
  const dropdownHeight = visibleRows * configStepTwoScale.optionHeight;

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
      <p
        className="mb-[10px] font-medium tracking-[-0.02em] text-[#A7A7A7]"
        style={{ fontSize: `${configStepTwoScale.labelSize}px` }}
      >
        {label}
      </p>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (isBlocked) return;
          setIsOpen((current) => !current);
        }}
        disabled={isBlocked}
        aria-busy={loading}
        className={`flex w-full border border-[#141414] bg-[#080808] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-65 ${
          loading ? "justify-center" : "items-center"
        }`}
        style={{
          height: `${controlHeightPx ?? configStepTwoScale.controlHeight}px`,
          borderRadius: `16px`,
          paddingLeft: `14px`,
          paddingRight: `12px`,
        }}
      >
        {loading ? (
          <ButtonLoader size={20} />
        ) : (
          <>
            <span
              className={`truncate pr-3 ${selectedNames.length ? "text-[#D5D5D5]" : "text-[#5A5A5A]"}`}
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
              className="flowdesk-selectmenu-scrollbar flowdesk-scale-in-soft fixed z-[420] overflow-y-auto overscroll-contain border bg-[#080808] shadow-[0_24px_64px_rgba(0,0,0,0.5)] backdrop-blur-[12px] transition-all duration-200 ease-out"
              style={{
                top: `${dropdownRect.top}px`,
                left: `${dropdownRect.left}px`,
                width: `${dropdownRect.width}px`,
                height: `${dropdownHeight}px`,
                opacity: 1,
                transform: "translateY(0)",
                borderColor: "#141414",
                borderRadius: `16px`,
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
                      className={`mx-[6px] my-[4px] flex w-[calc(100%-12px)] items-center gap-3 rounded-[12px] px-[14px] text-left transition-colors ${
                        selected
                          ? "bg-[#101010] text-[#E1E1E1]"
                          : "text-[#B5B5B5] hover:bg-[#101010] hover:text-[#E1E1E1]"
                      }`}
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
