import { useState } from "react";
import { UserMinus, AlertTriangle } from "lucide-react";
import { ButtonLoader } from "@/components/login/ButtonLoader";
import { useRouter } from "next/navigation";
import { DangerActionModal } from "../DangerActionModal";

export function DeleteAccountTab() {
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();

  async function handleDeleteConfirm() {
    
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me/account", { method: "DELETE" });
      if (res.ok) {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.assign("/login");
      } else {
        const data = await res.json();
        alert(data.message || "Falha ao excluir a conta.");
      }
    } catch (err) {
      console.error(err);
      setLoading(false);
      setModalOpen(false);
    }
  }

  function handleOpenModal() {
    setModalOpen(true);
  }

  return (
    <div className="mt-[32px]">
      <div className="rounded-[18px] border border-[#3E1A1A] bg-[rgba(30,10,10,0.4)] p-[24px]">
        <div className="flex items-center gap-[12px] text-[#DB8A8A]">
          <AlertTriangle className="h-[24px] w-[24px]" />
          <h2 className="text-[18px] font-semibold text-[#E9E9E9]">Gostaria mesmo de excluir sua conta?</h2>
        </div>
        <p className="mt-[12px] text-[#B0B0B0] max-w-[600px] leading-[1.6]">
          Ao excluir sua conta:
          <ul className="mt-[8px] list-disc ml-[20px] space-y-[4px]">
             <li>Você perderá o acesso aos seus dados de pagamento e configurações em todos os painéis.</li>
             <li>Suas equipes ativas perderão a posse caso você seja o administrador primário.</li>
             <li>Quaisquer assinaturas ou chaves de API ligadas à sua conta serão invalidadas / tornadas inacessíveis.</li>
          </ul>
        </p>
        <button 
          onClick={handleOpenModal}
          disabled={loading}
          className="mt-[24px] flex h-[44px] items-center justify-center gap-[8px] rounded-[12px] bg-[#BB3535] px-[24px] text-[15px] font-medium text-white transition hover:bg-[#8D2525] disabled:opacity-50"
        >
          {loading ? <ButtonLoader size={18} /> : <UserMinus className="h-[18px] w-[18px]" />}
          Sim, excluir minha conta permanentemente
        </button>
        <DangerActionModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onConfirm={handleDeleteConfirm}
          isProcessing={loading}
          title="Excluir Permanentemente"
          description="Isso é irreversível. Você perderá o acesso a todas as configurações, painéis, pagamentos e tickets associados. As chaves de API desta conta serão revogadas e todas instâncias ativas do seu time onde você é o criador podem deixar de funcionar caso a licença seja excluída."
          confirmText="Sim, excluir minha conta"
        />
      </div>
    </div>
  );
}
