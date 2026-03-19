"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { configStepTwoScale } from "@/components/config/configStepTwoScale";
import { ButtonLoader } from "@/components/login/ButtonLoader";

type SelectOption = {
  id: string;
  name: string;
};

type ConfigStepSelectProps = {
  label: string;
  placeholder: string;
  options: SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
  controlHeightPx?: number;
};

export function ConfigStepSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled = false,
  loading = false,
  controlHeightPx,
}: ConfigStepSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollClass = "config-step-select-scroll";
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

  const selectedOption = useMemo(
    () => options.find((option) => option.id === value) || null,
    [options, value],
  );
  const visibleRows = Math.min(
    Math.max(options.length, 1),
    configStepTwoScale.maxVisibleOptions,
  );
  const dropdownHeight = visibleRows * configStepTwoScale.optionHeight;

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
              className={`truncate pr-2 ${selectedOption ? "text-[#D8D8D8]" : "text-[#242424]"}`}
              style={{ fontSize: `${configStepTwoScale.controlTextSize}px` }}
            >
              {selectedOption ? selectedOption.name : placeholder}
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
          options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onChange(option.id);
                setIsOpen(false);
              }}
              className={`flex w-full items-center px-[14px] text-left transition-colors ${
                value === option.id
                  ? "bg-[#111111] text-[#D8D8D8]"
                  : "text-[#D8D8D8] hover:bg-[#111111]"
              }`}
              style={{
                height: `${configStepTwoScale.optionHeight}px`,
                fontSize: `${configStepTwoScale.optionTextSize}px`,
              }}
            >
              {option.name}
            </button>
          ))
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
