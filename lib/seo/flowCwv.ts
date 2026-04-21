import type { Metadata } from "next";

const FALLBACK_PUBLIC_ORIGIN = "https://www.flwdesk.com";

export const FLOWCWV_SITE_NAME = "Flowdesk";
export const FLOWCWV_SITE_ORIGIN = (
  process.env.SITE_URL?.trim() ||
  process.env.APP_PUBLIC_URL?.trim() ||
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  process.env.APP_URL?.trim() ||
  FALLBACK_PUBLIC_ORIGIN
).replace(/\/+$/, "");

export const FLOWCWV_DEFAULT_DESCRIPTION =
  "Flowdesk une hospedagem, VPS, maquinas virtuais, dominios, tecnologia, automacao para Discord, bot com IA para developers e operacao web com foco em performance, seguranca e escala.";

export const FLOWCWV_PRIMARY_KEYWORDS = [
  "flowdesk",
  "flowsecure",
  "core web vitals",
  "hospedagem",
  "hospedagem gerenciada",
  "vps",
  "maquinas virtuais",
  "infraestrutura cloud",
  "dominios",
  "registro de dominios",
  "busca de dominios com ia",
  "tecnologia",
  "bot discord",
  "bot discord com ia",
  "discord para developers",
  "automacao discord",
  "tickets discord",
  "painel discord",
  "saas para discord",
  "ferramentas para developers",
  "infraestrutura para developers",
  "ia para desenvolvedores",
] as const;

const FLOWCWV_SOCIAL_IMAGE_PATH = "/cdn/logos/logo.png";

const FLOWCWV_SERVICE_CATALOG = [
  {
    name: "Hospedagem gerenciada",
    serviceType: "Hospedagem",
    description:
      "Hospedagem com foco em estabilidade, disponibilidade e base tecnica pronta para operacoes web modernas.",
  },
  {
    name: "VPS e maquinas virtuais",
    serviceType: "Infraestrutura",
    description:
      "Recursos de infraestrutura, VPS e maquinas virtuais para workloads de desenvolvimento, bots, paineis e automacoes.",
  },
  {
    name: "Dominios e tecnologia web",
    serviceType: "Dominios",
    description:
      "Busca, organizacao e operacao de dominios com apoio de IA e estrutura orientada a performance.",
  },
  {
    name: "Bot Discord com IA",
    serviceType: "Software",
    description:
      "Sistema web integrado a bot Discord com IA para tickets, atendimento, operacao, automacao e produtividade.",
  },
  {
    name: "Ferramentas para developers",
    serviceType: "Developer tools",
    description:
      "Stack voltada a developers com painel, automacoes, integrações, seguranca e governanca operacional.",
  },
] as const;

type FlowCwvMetadataInput = {
  description?: string;
  keywords?: readonly string[];
  noIndex?: boolean;
  pathname?: string;
  title?: string;
};

export function buildFlowCwvUrl(pathname = "/") {
  return new URL(pathname, FLOWCWV_SITE_ORIGIN).toString();
}

function buildFlowCwvRobots(noIndex?: boolean): NonNullable<Metadata["robots"]> {
  if (noIndex) {
    return {
      index: false,
      follow: false,
      nocache: true,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
        "max-image-preview": "none",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    };
  }

  return {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  };
}

export function buildFlowCwvMetadata(
  input: FlowCwvMetadataInput = {},
): Metadata {
  const pathname = input.pathname || "/";
  const url = buildFlowCwvUrl(pathname);
  const description = input.description || FLOWCWV_DEFAULT_DESCRIPTION;
  const keywords = Array.from(
    new Set([
      ...FLOWCWV_PRIMARY_KEYWORDS,
      ...(input.keywords || []),
    ]),
  );

  return {
    title: input.title,
    description,
    keywords,
    metadataBase: new URL(FLOWCWV_SITE_ORIGIN),
    alternates: {
      canonical: url,
    },
    category: "technology",
    applicationName: FLOWCWV_SITE_NAME,
    openGraph: {
      type: "website",
      url,
      siteName: FLOWCWV_SITE_NAME,
      title: input.title || FLOWCWV_SITE_NAME,
      description,
      locale: "pt_BR",
      images: [
        {
          url: buildFlowCwvUrl(FLOWCWV_SOCIAL_IMAGE_PATH),
          alt: `${FLOWCWV_SITE_NAME} logo`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title || FLOWCWV_SITE_NAME,
      description,
      images: [buildFlowCwvUrl(FLOWCWV_SOCIAL_IMAGE_PATH)],
    },
    robots: buildFlowCwvRobots(input.noIndex),
  };
}

export function buildFlowCwvSiteMetadata(): Metadata {
  return {
    ...buildFlowCwvMetadata(),
    title: {
      default: FLOWCWV_SITE_NAME,
      template: `%s | ${FLOWCWV_SITE_NAME}`,
    },
  };
}

export function buildFlowCwvSiteGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${FLOWCWV_SITE_ORIGIN}#organization`,
        name: FLOWCWV_SITE_NAME,
        url: FLOWCWV_SITE_ORIGIN,
        logo: buildFlowCwvUrl(FLOWCWV_SOCIAL_IMAGE_PATH),
        description: FLOWCWV_DEFAULT_DESCRIPTION,
        knowsAbout: [...FLOWCWV_PRIMARY_KEYWORDS],
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: "Catalogo de solucoes Flowdesk",
          itemListElement: FLOWCWV_SERVICE_CATALOG.map((service, index) => ({
            "@type": "Offer",
            itemOffered: {
              "@type": "Service",
              name: service.name,
              serviceType: service.serviceType,
              description: service.description,
            },
            position: index + 1,
          })),
        },
      },
      {
        "@type": "WebSite",
        "@id": `${FLOWCWV_SITE_ORIGIN}#website`,
        url: FLOWCWV_SITE_ORIGIN,
        name: FLOWCWV_SITE_NAME,
        inLanguage: "pt-BR",
        description: FLOWCWV_DEFAULT_DESCRIPTION,
        publisher: {
          "@id": `${FLOWCWV_SITE_ORIGIN}#organization`,
        },
      },
    ],
  };
}

export function buildFlowCwvHomeGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${FLOWCWV_SITE_ORIGIN}/#webpage`,
        url: FLOWCWV_SITE_ORIGIN,
        name: `${FLOWCWV_SITE_NAME} | Hospedagem, VPS, dominios e bot Discord com IA`,
        description: FLOWCWV_DEFAULT_DESCRIPTION,
        isPartOf: {
          "@id": `${FLOWCWV_SITE_ORIGIN}#website`,
        },
        about: FLOWCWV_SERVICE_CATALOG.map((service) => ({
          "@type": "Thing",
          name: service.name,
        })),
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${FLOWCWV_SITE_ORIGIN}#software`,
        name: FLOWCWV_SITE_NAME,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: FLOWCWV_SITE_ORIGIN,
        description:
          "Plataforma com bot Discord, IA, infraestrutura, dominios e ferramentas para developers e operacoes digitais.",
        featureList: [
          "Bot Discord com IA",
          "Tickets e atendimento automatizado",
          "Infraestrutura e operacao web",
          "Busca de dominios com IA",
          "Ferramentas para developers",
          "Seguranca e FlowSecure",
        ],
        publisher: {
          "@id": `${FLOWCWV_SITE_ORIGIN}#organization`,
        },
      },
      {
        "@type": "ItemList",
        "@id": `${FLOWCWV_SITE_ORIGIN}#services`,
        name: "Servicos e frentes da Flowdesk",
        itemListElement: FLOWCWV_SERVICE_CATALOG.map((service, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Service",
            name: service.name,
            serviceType: service.serviceType,
            description: service.description,
            provider: {
              "@id": `${FLOWCWV_SITE_ORIGIN}#organization`,
            },
            areaServed: "BR",
          },
        })),
      },
    ],
  };
}

export function buildFlowCwvPublicSitemapEntries() {
  const now = new Date();

  return [
    {
      url: buildFlowCwvUrl("/"),
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 1,
    },
    {
      url: buildFlowCwvUrl("/affiliates"),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    },
    {
      url: buildFlowCwvUrl("/domains"),
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    },
    {
      url: buildFlowCwvUrl("/status"),
      lastModified: now,
      changeFrequency: "hourly" as const,
      priority: 0.7,
    },
    {
      url: buildFlowCwvUrl("/privacy"),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    },
    {
      url: buildFlowCwvUrl("/terms"),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    },
  ];
}
