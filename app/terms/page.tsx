import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { termsContent } from "@/lib/legal/content";
import { buildFlowCwvMetadata } from "@/lib/seo/flowCwv";

export const metadata: Metadata = buildFlowCwvMetadata({
  title: "Termos de Uso | Flowdesk",
  description:
    "Termos de Uso, licenciamento, pagamentos, reembolso e regras operacionais da Flowdesk.",
  pathname: "/terms",
  keywords: ["termos de uso", "licenciamento", "pagamentos", "reembolso"],
});

export default function TermsPage() {
  return <LegalDocumentPage content={termsContent} />;
}
