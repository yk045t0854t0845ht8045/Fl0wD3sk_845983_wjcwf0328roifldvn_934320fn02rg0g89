import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import { privacyContent } from "@/lib/legal/content";

export const metadata: Metadata = {
  title: "Politica de Privacidade | Flowdesk",
  description:
    "Politica de Privacidade, LGPD, dados tratados e provedores terceiros utilizados pela Flowdesk.",
};

export default function PrivacyPage() {
  return <LegalDocumentPage content={privacyContent} />;
}
