"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollClass = "config-step-multiselect-scroll";
  const isBlocked = disabled || loading;

  useEffect(() => {
    if (!isOpen) return;

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target)) {
        setIsOpen(false);
      }
    }

    window.addEventListener("mousedown", handleOutsideClick);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isBlocked) {
      setIsOpen(false);
    }
  }, [isBlocked]);

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
    <div ref={containerRef} className="relative w-full">
      <p
        className="mb-2 font-medium text-[#D8D8D8]"
        style={{ fontSize: `${configStepTwoScale.labelSize}px` }}
      >
        {label}
      </p>

      <button
        type="button"
        onClick={() => {
          if (isBlocked) return;
          setIsOpen((current) => !current);
        }}
        disabled={isBlocked}
        aria-busy={loading}
        className={`flex w-full border border-[#2E2E2E] bg-[#0A0A0A] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-65 ${
          loading ? "justify-center" : "items-center"
        }`}
        style={{
          height: `${controlHeightPx ?? configStepTwoScale.controlHeight}px`,
          borderRadius: `${configStepTwoScale.controlRadius}px`,
          paddingLeft: `${configStepTwoScale.controlSidePadding}px`,
          paddingRight: `${Math.max(8, configStepTwoScale.controlSidePadding - 4)}px`,
        }}
      >
        {loading ? (
          <ButtonLoader size={20} />
        ) : (
          <>
            <span
              className={`truncate pr-2 ${selectedNames.length ? "text-[#D8D8D8]" : "text-[#242424]"}`}
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
                  isOpen
                    ? "rotate-180 transition-transform duration-300 ease-out"
                    : "rotate-0 transition-transform duration-300 ease-out"
                }
              />
            </span>
          </>
        )}
      </button>

      <div
        className={`${scrollClass} absolute left-0 right-0 z-30 overflow-y-auto border bg-[#0A0A0A] transition-all duration-200 ease-out`}
        style={{
          marginTop: isOpen ? "8px" : "0px",
          height: isOpen ? `${dropdownHeight}px` : "0px",
          opacity: isOpen ? 1 : 0,
          transform: isOpen ? "translateY(0)" : "translateY(-8px)",
          borderColor: isOpen ? "#2E2E2E" : "transparent",
          borderRadius: `${configStepTwoScale.controlRadius}px`,
          pointerEvents: isOpen ? "auto" : "none",
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
                className={`flex w-full items-center gap-3 px-[14px] text-left transition-colors ${
                  selected
                    ? "bg-[#111111] text-[#D8D8D8]"
                    : "text-[#D8D8D8] hover:bg-[#111111]"
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
                      : "border-[#2E2E2E] bg-transparent text-transparent"
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
            className="flex h-full items-center justify-center px-4 text-center text-[#D8D8D8]"
            style={{ fontSize: `${configStepTwoScale.optionTextSize}px` }}
          >
            Nenhuma opcao disponivel
          </div>
        )}
      </div>

      <style jsx>{`
        .${scrollClass} {
          scrollbar-width: thin;
          scrollbar-color: #2e2e2e #0a0a0a;
        }

        .${scrollClass}::-webkit-scrollbar {
          width: 6px;
        }

        .${scrollClass}::-webkit-scrollbar-track {
          background: #0a0a0a;
          border-radius: 999px;
        }

        .${scrollClass}::-webkit-scrollbar-thumb {
          background: #2e2e2e;
          border-radius: 999px;
          border: 1px solid #0a0a0a;
        }
      `}</style>
    </div>
  );
}
