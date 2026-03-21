import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { termsContent } from "@/lib/legal/content";

export const metadata: Metadata = {
  title: "Termos de Uso | Flowdesk",
  description:
    "Termos de Uso, licenciamento, pagamentos, reembolso e regras operacionais da Flowdesk.",
};

export default function TermsPage() {
  return <LegalDocumentPage content={termsContent} />;
}
