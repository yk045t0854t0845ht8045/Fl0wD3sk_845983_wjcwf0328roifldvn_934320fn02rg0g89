import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { privacyContent } from "@/lib/legal/content";
import { buildFlowCwvMetadata } from "@/lib/seo/flowCwv";

export const metadata: Metadata = buildFlowCwvMetadata({
  title: "Politica de Privacidade | Flowdesk",
  description:
    "Politica de Privacidade, LGPD, dados tratados e provedores terceiros utilizados pela Flowdesk.",
  pathname: "/privacy",
  keywords: ["politica de privacidade", "lgpd", "dados pessoais", "seguranca"],
});

export default function PrivacyPage() {
  return <LegalDocumentPage content={privacyContent} />;
}
