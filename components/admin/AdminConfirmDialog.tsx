"use client";

type AdminConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isPending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function AdminConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  isPending = false,
  onConfirm,
  onClose,
}: AdminConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center px-[20px] py-[24px]">
      <button
        type="button"
        aria-label="Fechar confirmacao"
        className="absolute inset-0 bg-[rgba(0,0,0,0.72)]"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-[520px] rounded-[24px] border border-[#141414] bg-[#090909] p-[24px] shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
        <h3 className="text-[24px] leading-[1.04] font-medium tracking-[-0.04em] text-[#EFEFEF]">
          {title}
        </h3>
        <p className="mt-[14px] text-[14px] leading-[1.7] text-[#808080]">
          {description}
        </p>

        <div className="mt-[24px] flex flex-col gap-[10px] sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-[14px] border border-[#1A1A1A] bg-[#101010] px-[18px] py-[12px] text-[14px] font-medium text-[#B8B8B8] transition-colors hover:border-[#242424] hover:bg-[#121212] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-[14px] bg-[linear-gradient(180deg,#FFFFFF_0%,#D1D1D1_100%)] px-[18px] py-[12px] text-[14px] font-semibold text-[#262626] transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
