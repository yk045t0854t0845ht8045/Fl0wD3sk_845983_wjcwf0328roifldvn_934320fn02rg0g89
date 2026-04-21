export const TERMS_PATH = "/terms";
export const PRIVACY_PATH = "/privacy";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.trim() ||
  process.env.APP_URL?.trim() ||
  process.env.SITE_URL?.trim() ||
  "https://www.flwdesk.com";
const SUPABASE_PUBLIC_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  process.env.SUPABASE_URL?.trim() ||
  "https://supabase.com";
const DISCORD_INVITE_URL =
  process.env.NEXT_PUBLIC_DISCORD_INVITE_URL?.trim() ||
  "https://discord.com";

export type LegalTableCell = {
  text: string;
  href?: string;
  mono?: boolean;
};

export type LegalTable = {
  caption?: string;
  columns: string[];
  rows: LegalTableCell[][];
};

export type LegalSource = {
  label: string;
  href: string;
  note: string;
};

export type LegalSection = {
  id: string;
  navLabel: string;
  title: string;
  intro?: string;
  paragraphs?: string[];
  bullets?: string[];
  tables?: LegalTable[];
  note?: string;
};

export type LegalDocumentContent = {
  slug: "terms" | "privacy";
  title: string;
  subtitle: string;
  badge: string;
  updatedAt: string;
  relatedLinks: Array<{
    label: string;
    href: string;
  }>;
  heroParagraphs: string[];
  sections: LegalSection[];
  sources: LegalSource[];
};

const officialUrlsTable: LegalTable = {
  caption: "URLs e dominios oficiais autorizados",
  columns: ["Canal", "URL autorizada", "Uso principal"],
  rows: [
    [
      { text: "Painel web" },
      {
        text: `${APP_URL} / https://pay.flwdesk.com`,
        href: APP_URL,
        mono: true,
      },
      { text: "Login, configuracao, gerenciamento, paginas legais e checkout oficial." },
    ],
    [
      { text: "OAuth e APIs do Discord" },
      {
        text: "https://discord.com / https://api.discord.com",
        href: "https://discord.com",
        mono: true,
      },
      {
        text: "Autenticacao, leitura de servidores, canais, cargos e validacoes de administracao.",
      },
    ],
    [
      { text: "Checkout e APIs do Mercado Pago" },
      {
        text: "https://www.mercadopago.com.br / https://api.mercadopago.com",
        href: "https://www.mercadopago.com.br",
        mono: true,
      },
      {
        text: "PIX, checkout de cartao, antifraude, notificacoes e conciliacao.",
      },
    ],
    [
      { text: "Infraestrutura de dados" },
      { text: SUPABASE_PUBLIC_URL, href: SUPABASE_PUBLIC_URL, mono: true },
      {
        text: "Persistencia de sessoes, configuracoes, pedidos, logs e metodos mascarados.",
      },
    ],
    [
      { text: "Canal oficial da comunidade" },
      { text: DISCORD_INVITE_URL, href: DISCORD_INVITE_URL, mono: true },
      { text: "Suporte operacional, avisos e comunidade oficial." },
    ],
  ],
};

const thirdPartyProvidersTable: LegalTable = {
  caption: "Prestadores e provedores terceiros utilizados",
  columns: [
    "Prestador",
    "URL principal",
    "Finalidade",
    "Categorias de dados tratadas",
  ],
  rows: [
    [
      { text: "Discord" },
      { text: "https://discord.com", href: "https://discord.com", mono: true },
      {
        text: "Autenticacao OAuth, verificacao de administracao em servidores e operacao do bot.",
      },
      {
        text: "ID Discord, nome de usuario, display name, avatar, email, lista de servidores administrados, canais e cargos.",
      },
    ],
    [
      { text: "Mercado Pago" },
      {
        text: "https://www.mercadopago.com.br",
        href: "https://www.mercadopago.com.br",
        mono: true,
      },
      {
        text: "Processamento de PIX, checkout de cartao, antifraude, cofre de cartao, webhooks e conciliacao.",
      },
      {
        text: "Nome do pagador, CPF/CNPJ, email, token de cartao, dados de transacao, status, QR Code, identificadores do pedido e do pagamento.",
      },
    ],
    [
      { text: "Supabase" },
      { text: SUPABASE_PUBLIC_URL, href: SUPABASE_PUBLIC_URL, mono: true },
      {
        text: "Banco de dados, sessao autenticada, configuracoes do sistema e trilhas de auditoria.",
      },
      {
        text: "Perfil autenticado, configuracoes de guilda, historico de cobranca, favoritos, logs tecnicos e metodos mascarados.",
      },
    ],
    [
      { text: "Vercel" },
      { text: "https://vercel.com", href: "https://vercel.com", mono: true },
      { text: "Hospedagem, entrega do painel web e logs tecnicos de execucao." },
      {
        text: "Metadados tecnicos de requisicao, diagnostico de deploy e telemetria operacional minima.",
      },
    ],
  ],
};

const companyIdentityTable: LegalTable = {
  caption: "Identificacao da operacao e dados institucionais",
  columns: ["Item", "Informacao publicada"],
  rows: [
    [
      { text: "Nome comercial" },
      { text: "Flowdesk" },
    ],
    [
      { text: "Natureza da operacao" },
      {
        text: "Operacao digital de software e servicos para Discord, sem atendimento presencial publicado nesta versao.",
      },
    ],
    [
      { text: "CNPJ" },
      {
        text: "Nao informado/publicado nesta versao contratual. Quando houver formalizacao empresarial com CNPJ divulgado, os documentos serao atualizados.",
      },
    ],
    [
      { text: "UF de referencia operacional" },
      { text: "Sao Paulo/SP, Brasil" },
    ],
    [
      { text: "Endereco fisico de atendimento" },
      {
        text: "Nao disponibilizado ao publico nesta versao. O atendimento e realizado por canais digitais oficiais.",
      },
    ],
  ],
};

const companyContactTable: LegalTable = {
  caption: "Canais oficiais de contato e suporte",
  columns: ["Canal", "Detalhe", "Uso recomendado"],
  rows: [
    [
      { text: "Painel autenticado" },
      { text: APP_URL, href: APP_URL, mono: true },
      { text: "Fluxos de login, configuracao, pagamentos e comunicacoes operacionais do produto." },
    ],
    [
      { text: "Comunidade oficial no Discord" },
      { text: DISCORD_INVITE_URL, href: DISCORD_INVITE_URL, mono: true },
      { text: "Suporte operacional, comunicados e orientacoes gerais." },
    ],
    [
      { text: "Base territorial e foro de referencia" },
      { text: "Sao Paulo/SP, Brasil" },
      { text: "Referencia juridica e operacional, sem prejuizo do foro legalmente assegurado ao consumidor." },
    ],
  ],
};

const privacyDataTable: LegalTable = {
  caption: "Categorias de dados tratadas pela Flowdesk",
  columns: ["Categoria", "Exemplos", "Origem", "Necessidade para o sistema"],
  rows: [
    [
      { text: "Identificacao da conta" },
      {
        text: "ID Discord, username, display name, avatar e email quando fornecido pelo Discord",
      },
      { text: "OAuth do Discord" },
      {
        text: "Necessario para login, seguranca de sessao e vinculo da conta ao painel.",
      },
    ],
    [
      { text: "Estrutura do servidor" },
      { text: "servidores em que o usuario e admin, canais, categorias e cargos" },
      { text: "APIs do Discord" },
      {
        text: "Necessario para configurar tickets, logs, staff e permissao do bot.",
      },
    ],
    [
      { text: "Configuracao operacional" },
      {
        text: "IDs de canais, categorias, cargos, favoritos, progresso de setup, guilda ativa",
      },
      { text: "Interacoes do painel" },
      {
        text: "Necessario para salvar a configuracao e retomar o fluxo de onboarding.",
      },
    ],
    [
      { text: "Dados de pagamento" },
      {
        text: "nome do pagador, CPF/CNPJ, valor, status, metodo, order number, provider IDs, QR Code, ticket URL",
      },
      { text: "Formulario do checkout e retorno do Mercado Pago" },
      {
        text: "Necessario para cobrar, conciliar, liberar licenca, combater fraude e auditar eventos financeiros.",
      },
    ],
    [
      { text: "Metodos salvos" },
      {
        text: "bandeira, BIN mascarado, 4 ultimos digitos, validade, apelido, IDs do cofre no provedor",
      },
      { text: "Cadastro de metodo no painel" },
      {
        text: "Necessario para recorrencia, escolha de metodo e seguranca operacional. A Flowdesk nao armazena numero completo nem CVV.",
      },
    ],
    [
      { text: "Telemetria e seguranca" },
      {
        text: "requestId, IP aproximado, user-agent, cooldowns, logs de auditoria, eventos antifraude",
      },
      { text: "Infraestrutura da plataforma" },
      {
        text: "Necessario para seguranca, prevencao a abuso, suporte e investigacao de falhas.",
      },
    ],
  ],
};

const privacyThirdPartyTable: LegalTable = {
  caption: "Compartilhamento e operadores terceiros",
  columns: [
    "Operador / controlador independente",
    "URL",
    "Finalidade",
    "Observacoes",
  ],
  rows: [
    [
      { text: "Discord" },
      { text: "https://discord.com", href: "https://discord.com", mono: true },
      {
        text: "Login OAuth, leitura de servidores, canais e cargos, e operacao do bot.",
      },
      {
        text: "A Flowdesk depende de permissao do usuario e das APIs oficiais do Discord.",
      },
    ],
    [
      { text: "Mercado Pago" },
      {
        text: "https://www.mercadopago.com.br",
        href: "https://www.mercadopago.com.br",
        mono: true,
      },
      {
        text: "Processamento de pagamentos, cofre seguro de cartao, antifraude, callbacks e conciliacao.",
      },
      {
        text: "Dados completos de cartao e CVV permanecem no ambiente seguro do processador, nao no banco da Flowdesk.",
      },
    ],
    [
      { text: "Supabase" },
      { text: SUPABASE_PUBLIC_URL, href: SUPABASE_PUBLIC_URL, mono: true },
      { text: "Persistencia de banco de dados, sessoes e configuracoes." },
      {
        text: "Armazena dados operacionais, auditoria, pedidos e metodos mascarados.",
      },
    ],
    [
      { text: "Vercel" },
      { text: "https://vercel.com", href: "https://vercel.com", mono: true },
      { text: "Hospedagem da aplicacao web e logs tecnicos de execucao." },
      {
        text: "Pode processar metadados tecnicos necessarios a observabilidade e seguranca.",
      },
    ],
  ],
};

export const termsContent: LegalDocumentContent = {
  slug: "terms",
  title: "Termos de Uso, Licenciamento e Pagamentos",
  subtitle:
    "Condicoes juridicas e operacionais do uso do painel Flowdesk, do bot, dos pagamentos e da licenca por servidor.",
  badge: "Documento contratual",
  updatedAt: "21/03/2026",
  relatedLinks: [
    { label: "Ver Politica de Privacidade", href: PRIVACY_PATH },
    { label: "Voltar para login", href: "/login" },
  ],
  heroParagraphs: [
    "Estes Termos regulam o uso do painel Flowdesk, do bot de tickets, dos recursos de configuracao e do licenciamento por servidor Discord. Ao fazer login, configurar um servidor, gerar um pagamento, ativar um plano ou continuar usando a plataforma, voce declara que leu, entendeu e concorda com estas condicoes.",
    "A Flowdesk opera como software e servico sob licenca, nao como transferencia definitiva de propriedade intelectual. O acesso pode ser limitado, suspenso, alterado ou encerrado quando houver risco tecnico, obrigacao legal, fraude, inadimplencia, uso abusivo ou descontinuidade do produto, observada a legislacao aplicavel.",
  ],
  sections: [
    {
      id: "visao-geral",
      navLabel: "Visao geral",
      title: "1. Visao geral do servico",
      paragraphs: [
        "A Flowdesk oferece um sistema web integrado a um bot Discord para configuracao, operacao e gerenciamento de tickets, logs, equipe de atendimento, cobrancas e licencas por servidor.",
        "Cada ativacao e vinculada a um servidor Discord especifico. O licenciamento e sempre concedido para uso do sistema dentro do escopo contratado, sem transferencia de propriedade do codigo, do painel, das interfaces, dos fluxos ou da marca.",
      ],
      bullets: [
        "o acesso e pessoal, autenticado e vinculado a conta usada no login",
        "a licenca e concedida por servidor, nao por uso irrestrito",
        "recursos podem depender de provedores terceiros e da disponibilidade do Discord, Mercado Pago, Supabase e Vercel",
      ],
    },
    {
      id: "elegibilidade",
      navLabel: "Elegibilidade",
      title: "2. Elegibilidade, idade minima e representacao",
      paragraphs: [
        "A contratacao deve ser feita por pessoa capaz de acordo com a legislacao brasileira. Menores de 16 anos nao podem contratar diretamente a plataforma. Pessoas entre 16 e 18 anos somente podem contratar com assistencia ou autorizacao expressa de seu responsavel legal.",
        "Se a compra for concluida por pessoa menor de 18 anos, considera-se que houve autorizacao expressa do responsavel legal para uso do cartao, PIX e demais meios empregados, sem prejuizo da apuracao posterior em caso de fraude, chargeback, contestacao indevida ou informacao falsa.",
      ],
      bullets: [
        "ao finalizar pagamento, o comprador declara ter capacidade legal ou autorizacao valida para contratar",
        "o titular da conta e responsavel pela veracidade dos dados enviados ao sistema e aos provedores de pagamento",
        "o uso de meio de pagamento de terceiro sem autorizacao pode gerar bloqueio imediato, cancelamento da licenca e comunicacao aos processadores competentes",
      ],
      note:
        "Nada nesta clausula afasta protecoes obrigatorias previstas em lei. Ela apenas define condicoes contratuais de elegibilidade e responsabilidade declarada na contratacao.",
    },
    {
      id: "conta-discord",
      navLabel: "Conta e Discord",
      title: "3. Conta, login Discord e acessos necessarios",
      paragraphs: [
        "O acesso ao painel depende de autenticacao por conta Discord. Para a configuracao funcionar, a Flowdesk pode consultar informacoes estritamente relacionadas a identificacao do usuario e aos servidores nos quais ele tenha poderes de administracao, bem como canais, categorias e cargos necessarios para a configuracao do bot.",
        "A manutencao da seguranca da conta Discord, do dispositivo utilizado e das credenciais pessoais e de responsabilidade do usuario. Se os escopos de acesso forem revogados, se o usuario perder permissao administrativa ou se o bot for removido do servidor, a funcionalidade pode ser limitada ou interrompida.",
      ],
      bullets: [
        "o login usa OAuth do Discord e pode solicitar identificacao, email e lista de servidores",
        "a plataforma consulta apenas os dados necessarios para verificar elegibilidade de configuracao, licenca e operacao",
        "o usuario deve manter sob controle os acessos do proprio Discord e do meio de pagamento utilizado",
      ],
    },
    {
      id: "licenca",
      navLabel: "Licenca",
      title: "4. Licenca, propriedade intelectual e limites de uso",
      paragraphs: [
        "A Flowdesk concede licenca limitada, revogavel, nao exclusiva e intransferivel para uso do sistema no servidor contratado. O painel, o bot, o codigo, a marca, os fluxos visuais, os documentos tecnicos e os mecanismos antifraude permanecem de titularidade exclusiva da Flowdesk ou de seus licenciantes.",
        "Nao e permitido copiar, revender, sublicenciar, alugar, desmontar, fazer engenharia reversa, tentar contornar limitacoes de licenca, reusar componentes da interface ou explorar o sistema de forma concorrente sem autorizacao formal e escrita.",
      ],
      bullets: [
        "cada licenca vale para um servidor especifico",
        "o acesso pode ser revogado se houver violacao contratual, tecnica ou legal",
        "ajustes, remocoes de recurso e melhorias podem ocorrer a qualquer momento, especialmente por seguranca, compatibilidade ou evolucao comercial do produto",
      ],
    },
    {
      id: "pagamentos",
      navLabel: "Pagamentos",
      title: "5. Pagamentos, meios aceitos e protecao dos links de checkout",
      paragraphs: [
        "Os pagamentos podem ser oferecidos por PIX transparente, checkout hospedado de cartao e outros meios que venham a ser habilitados. O processamento financeiro e realizado com apoio do Mercado Pago. O cartao e validado por fluxo seguro, com cofre de cartao, tokenizacao, antifraude, reconciliacao e, quando aplicavel, verificacoes adicionais do emissor.",
        "Os links de pagamento e callbacks internos sao vinculados a sessao autenticada, ao usuario criador do pedido e ao servidor selecionado. Links podem expirar, ser invalidados por nova tentativa ou deixar de funcionar se usados fora da conta correta.",
        "Se um valor for identificado pelo provedor, mas o sistema detectar inconsistencia critica de licenca, pedido duplicado ou divergencia de conciliacao, a Flowdesk pode bloquear a liberacao, corrigir o pedido automaticamente e acionar estorno ou cancelamento quando tecnicamente cabivel.",
      ],
      bullets: [
        "precos, planos e meios aceitos podem mudar prospectivamente",
        "pedidos antigos podem ser invalidados quando uma nova tentativa segura e gerada",
        "tentativas suspeitas, repetitivas, fraudulentas ou em desacordo com regras do provedor podem ser recusadas, bloqueadas ou submetidas a nova analise",
      ],
    },
    {
      id: "reembolso",
      navLabel: "Reembolso",
      title: "6. Reembolso, arrependimento e cancelamentos",
      paragraphs: [
        "Nas contratacoes online aplicam-se as regras obrigatorias da legislacao brasileira, inclusive o direito de arrependimento previsto no art. 49 do Codigo de Defesa do Consumidor quando juridicamente aplicavel ao caso concreto. A Flowdesk nao afasta direitos obrigatorios do consumidor por meio deste documento.",
        "Pedidos de reembolso serao analisados considerando a data da contratacao, a forma de pagamento, o historico do pedido, a ativacao ou nao da licenca, o nivel de uso da plataforma, eventual fraude, chargeback, abuso de estorno, uso indevido do sistema e as obrigacoes legais de guarda de dados e provas.",
        "Em regra, pedidos formulados em ate 7 dias da contratacao remota serao tratados a luz da legislacao brasileira aplicavel. Quando houver fraude, uso ilicito, duplicidade artificial, contestacao abusiva, tentativa de burlar pagamento ou qualquer comportamento de risco, a Flowdesk podera negar beneficios contratuais nao obrigatorios, sem prejuizo dos direitos legais eventualmente existentes.",
      ],
      bullets: [
        "o prazo de 7 dias conta da contratacao remota e nao elimina analise de fraude ou uso abusivo",
        "estornos podem depender do fluxo do processador de pagamento e do emissor",
        "cancelamento de recorrencia nao apaga historico financeiro, logs e trilhas de auditoria que precisem ser retidos por obrigacao legal ou defesa de direitos",
      ],
    },
    {
      id: "planos-recorrencia",
      navLabel: "Planos e recorrencia",
      title: "7. Renovacao, recorrencia e ciclo da licenca",
      paragraphs: [
        "O plano padrao da plataforma pode operar em ciclos mensais de 30 dias por servidor. A renovacao automatica, quando disponibilizada, depende de opcao expressa do usuario, metodo valido armazenado e ausencia de bloqueios tecnicos, antifraude, chargeback ou inadimplencia.",
        "Servidor em status expirado ou desligado pode permanecer com historico visivel no painel, mas recursos de alteracao operacional podem ficar restritos ate nova regularizacao financeira ou tecnica.",
      ],
      bullets: [
        "renovacao automatica pode ser ativada, alterada ou desativada pelo titular da conta dentro das regras do painel",
        "metodos reprovados, removidos, bloqueados ou vencidos podem impedir renovacao",
        "uma nova cobranca pode gerar invalidacao segura de links antigos e substituicao do pedido em aberto",
      ],
    },
    {
      id: "uso-indevido",
      navLabel: "Fraude e bloqueios",
      title: "8. Uso proibido, fraude, chargeback e bloqueio de acesso",
      paragraphs: [
        "E proibido utilizar a Flowdesk para fraude, lavagem de tentativas de pagamento, engenharia reversa, sobrecarga deliberada, raspagem indevida, evasao de limites, envio massivo abusivo, violacao de servidores Discord, tentativa de contornar licenca, falsidade ideologica, uso de dados de terceiros sem autorizacao ou qualquer conduta que exponha a plataforma, seus clientes ou provedores a risco juridico, tecnico ou reputacional.",
        "A Flowdesk podera suspender, limitar, desativar, banir ou remover o acesso do usuario, do servidor e da licenca quando identificar, de boa-fe, fraude de pagamento, contestacao abusiva, chargeback indevido, tentativa de burlar antifraude, violacao sistematica dos Termos, risco de seguranca, exigencia legal ou risco relevante a outros clientes.",
      ],
      bullets: [
        "bloqueio pode ocorrer antes, durante ou depois da cobranca",
        "historicos, evidencias tecnicas e trilhas de auditoria podem ser preservados para defesa de direitos",
        "em caso de fraude material, a Flowdesk pode cooperar com provedores de pagamento, plataformas, autoridades e equipes antifraude, nos limites legais",
      ],
    },
    {
      id: "disponibilidade",
      navLabel: "Disponibilidade",
      title: "9. Disponibilidade, manutencao e descontinuacao do sistema",
      paragraphs: [
        "Embora a Flowdesk busque alta disponibilidade, o servico pode sofrer indisponibilidades, manutencoes, limitacoes temporarias, falhas de provedores terceiros, alteracoes do Discord, bloqueios do processador de pagamentos ou outras ocorrencias fora do controle razoavel da operacao.",
        "A Flowdesk podera alterar, suspender ou descontinuar o sistema, no todo ou em parte, por motivos tecnicos, comerciais, de seguranca, antifraude, compliance ou exigencia legal. Sempre que razoavelmente possivel, sera fornecido aviso previo pelos canais oficiais. Em descontinuacao definitiva que nao decorra de violacao do cliente, serao observadas as medidas cabiveis conforme a legislacao aplicavel, inclusive eventual ajuste proporcional do periodo nao utilizado, quando devido.",
      ],
      bullets: [
        "nao ha garantia de funcionamento ininterrupto ou de compatibilidade eterna com APIs externas",
        "correcoes de seguranca e mudancas urgentes podem ser aplicadas sem aviso previo",
        "a continuidade do servico depende tambem de integracoes externas autorizadas",
      ],
    },
    {
      id: "terceiros",
      navLabel: "URLs e terceiros",
      title: "10. URLs oficiais, terceiros e canais reconhecidos",
      intro:
        "Somente os dominios abaixo devem ser considerados autenticos para login, configuracao, pagamento, suporte operacional e integracoes externas da Flowdesk.",
      tables: [officialUrlsTable, thirdPartyProvidersTable],
      note:
        "Links, boletos, QR Codes, mensagens diretas ou cobrancas fora desses canais devem ser tratados com cautela e podem ser recusados pela Flowdesk para fins de suporte e validacao.",
    },
    {
      id: "empresa-foro",
      navLabel: "Empresa e foro",
      title: "11. Identificacao da operacao, contato e foro",
      paragraphs: [
        "A Flowdesk opera, nesta versao contratual, como uma operacao digital vinculada a Sao Paulo/SP, com atendimento exclusivamente por canais online oficiais. Nao ha atendimento presencial publico nem endereco fisico aberto ao publico informado nestes documentos.",
        "Enquanto a formalizacao empresarial com CNPJ publico nao for divulgada, as paginas legais, os canais autenticados do painel e a comunidade oficial no Discord constituem os meios reconhecidos para comunicacao operacional, suporte, cobranca, exercicio de direitos e atualizacao documental.",
        "Para fins de interpretacao contratual, as partes elegem como referencia territorial Sao Paulo/SP, sem afastar qualquer foro obrigatorio ou mais favoravel ao consumidor quando a legislacao brasileira assim determinar.",
      ],
      tables: [companyIdentityTable, companyContactTable],
      note:
        "Quando houver atualizacao societaria, CNPJ divulgado ou novo canal institucional oficial, este documento podera ser revisado para refletir a estrutura publica vigente da operacao.",
    },
    {
      id: "legislacao",
      navLabel: "Base legal",
      title: "12. Legislacao aplicavel e interpretacao",
      paragraphs: [
        "Este documento deve ser interpretado em conjunto com a Politica de Privacidade, com as regras operacionais do painel, com as politicas dos provedores terceiros efetivamente utilizados e com a legislacao brasileira aplicavel a consumo, contratos, dados pessoais, capacidade civil, meios de pagamento e defesa de direitos.",
        "Se alguma clausula vier a ser considerada invalida, as demais permanecerao eficazes na maior extensao permitida pela lei.",
      ],
    },
  ],
  sources: [
    {
      label: "Codigo de Defesa do Consumidor - Lei no 8.078/1990",
      href: "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm",
      note:
        "Base para direito de arrependimento, informacao clara e relacao de consumo.",
    },
    {
      label: "Lei Geral de Protecao de Dados - Lei no 13.709/2018",
      href: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm",
      note: "Base para tratamento, seguranca, retencao e direitos do titular.",
    },
    {
      label: "Codigo Civil - Lei no 10.406/2002",
      href: "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm",
      note: "Base para capacidade civil, representacao e responsabilidade contratual.",
    },
    {
      label: "Estatuto da Crianca e do Adolescente - Lei no 8.069/1990",
      href: "https://www.planalto.gov.br/ccivil_03/leis/l8069.htm",
      note:
        "Base geral de protecao a menores e interpretacao contratual protetiva.",
    },
    {
      label: "Decreto no 7.962/2013 - comercio eletronico",
      href: "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm",
      note:
        "Reforca informacoes claras, atendimento facilitado e contratacao eletronica.",
    },
  ],
};

export const privacyContent: LegalDocumentContent = {
  slug: "privacy",
  title: "Politica de Privacidade e Protecao de Dados",
  subtitle:
    "Como a Flowdesk coleta, utiliza, compartilha, protege, retem e elimina dados pessoais e dados operacionais do sistema.",
  badge: "Privacidade e LGPD",
  updatedAt: "21/03/2026",
  relatedLinks: [
    { label: "Ver Termos de Uso", href: TERMS_PATH },
    { label: "Voltar para login", href: "/login" },
  ],
  heroParagraphs: [
    "Esta Politica descreve o tratamento de dados pessoais e operacionais realizado pela Flowdesk para autenticar usuarios, configurar servidores Discord, processar pagamentos, liberar licencas, prevenir fraude, manter auditoria e prestar suporte.",
    "O tratamento ocorre com base na LGPD, em regras de consumo e em exigencias operacionais do sistema. A coleta e limitada ao que e necessario para funcionamento, seguranca, cobranca, cumprimento de obrigacoes legais e defesa de direitos.",
  ],
  sections: [
    {
      id: "escopo",
      navLabel: "Escopo",
      title: "1. Escopo desta politica",
      paragraphs: [
        "Esta Politica se aplica ao painel web Flowdesk, aos fluxos de login, configuracao, pagamento, historico financeiro, cadastro de metodo, recorrencia, auditoria tecnica e comunicacoes operacionais vinculadas ao uso da plataforma.",
        "Ao utilizar o sistema, o titular reconhece que certos tratamentos sao indispensaveis para a prestacao do servico, para a seguranca da conta, para a integracao com o Discord e para a conciliacao de pagamentos e licencas.",
      ],
    },
    {
      id: "dados-coletados",
      navLabel: "Dados coletados",
      title: "2. Dados pessoais e dados operacionais coletados",
      intro:
        "A Flowdesk busca tratar o minimo de dados necessario para viabilizar login, configuracao, pagamento, licenciamento e seguranca.",
      tables: [privacyDataTable],
    },
    {
      id: "discord-obrigatorio",
      navLabel: "Dados do Discord",
      title: "3. Dados obtidos do Discord e por que eles sao obrigatorios",
      paragraphs: [
        "Para o sistema funcionar, a Flowdesk pode consultar informacoes diretamente do Discord por meio dos escopos e endpoints autorizados, incluindo identificacao do usuario, lista de servidores administrados, canais, categorias e cargos necessarios a configuracao do bot.",
        "Sem essas informacoes, o painel nao consegue validar se o usuario realmente tem permissao para configurar um servidor, salvar canais de logs, registrar cargos autorizados ou instalar o bot com seguranca.",
      ],
      bullets: [
        "ID Discord, username, display name, avatar e email quando disponibilizado pelo Discord",
        "lista de servidores em que o usuario possui permissao administrativa ou condicao equivalente",
        "canais, categorias e cargos do servidor selecionado, quando a configuracao exigir",
        "membro do bot no servidor e permissao administrativa do bot para as validacoes necessarias",
      ],
    },
    {
      id: "pagamentos",
      navLabel: "Pagamentos",
      title: "4. Pagamentos, metodos salvos e dados financeiros",
      paragraphs: [
        "Os pagamentos por PIX e cartao utilizam o Mercado Pago como provedor. A Flowdesk trata apenas os dados necessarios para iniciar o pagamento, acompanhar status, liberar a licenca, conciliar divergencias, prevenir fraude e manter historico operacional.",
        "Quando o usuario salva um cartao para recorrencia, a Flowdesk nao armazena o numero completo do cartao nem o CVV. O sistema guarda somente dados mascarados, identificadores tecnicos do cofre no provedor, informacoes de bandeira, validade e status de verificacao do metodo.",
      ],
      bullets: [
        "PIX pode gerar QR Code, codigo copia e cola, ID do pedido e metadados de conciliacao",
        "cartao usa tokenizacao, antifraude e checkout seguro do Mercado Pago",
        "pedidos podem ser reconciliados, corrigidos ou estornados automaticamente quando houver divergencia relevante",
      ],
    },
    {
      id: "bases-legais",
      navLabel: "Bases legais",
      title: "5. Bases legais e finalidades do tratamento",
      paragraphs: [
        "A Flowdesk utiliza bases legais da LGPD compativeis com o contexto da plataforma, especialmente execucao de contrato, procedimentos preliminares relacionados a contratacao, cumprimento de obrigacao legal ou regulatoria, exercicio regular de direitos, legitimo interesse em seguranca e prevencao a fraude e, quando cabivel, protecao do credito e defesa do sistema.",
        "O tratamento nao depende exclusivamente de consentimento. Diversas operacoes sao necessarias para que o sistema funcione, para que a licenca seja liberada corretamente e para que pagamentos, logs e configuracoes possam ser auditados e protegidos.",
      ],
      bullets: [
        "autenticar o usuario e manter a sessao segura",
        "identificar servidores elegiveis e salvar configuracoes",
        "processar pagamentos, liberar licenca e manter historico financeiro",
        "prevenir fraude, chargeback abusivo, uso indevido e incidentes de seguranca",
        "cumprir deveres legais, regulatorios e de defesa de direitos",
      ],
    },
    {
      id: "terceiros",
      navLabel: "Terceiros",
      title: "6. Compartilhamento com terceiros e operadores",
      paragraphs: [
        "A Flowdesk compartilha dados apenas com provedores necessarios a execucao do servico ou quando houver base legal para isso, como obrigacao legal, defesa de direitos, prevencao a fraude ou resposta a requisicao legitima de autoridade competente.",
      ],
      tables: [privacyThirdPartyTable],
    },
    {
      id: "urls-oficiais",
      navLabel: "URLs oficiais",
      title: "7. URLs, dominios e endpoints reconhecidos",
      paragraphs: [
        "Para reduzir risco de phishing e redirecionamentos indevidos, a Flowdesk reconhece apenas os dominios oficiais abaixo como canais validos para login, configuracao, checkout, suporte operacional e infraestrutura principal.",
      ],
      tables: [officialUrlsTable],
      note:
        "Qualquer pagina, link, QR Code, cobranca ou callback fora desses dominios pode ser bloqueado, ignorado ou tratado como suspeito.",
    },
    {
      id: "retencao",
      navLabel: "Retencao",
      title: "8. Retencao, seguranca e integridade",
      paragraphs: [
        "A Flowdesk adota medidas tecnicas e organizacionais compativeis com o contexto do sistema, incluindo autenticacao por sessao, trilhas de auditoria, identificadores de requisicao, logs de seguranca, reconciliacao de pedidos, controle de cooldown para abuso, segregacao de dados operacionais e dependencia de provedores especializados para pagamentos.",
        "Dados podem ser mantidos pelo tempo necessario para prestacao do servico, exercicio regular de direitos, prevencao a fraude, cumprimento de obrigacao legal ou regulatoria, resolucao de disputas, auditoria financeira e seguranca do ecossistema.",
      ],
      bullets: [
        "o numero completo do cartao e o CVV nao sao persistidos pela Flowdesk",
        "logs tecnicos podem ser mantidos para suporte, investigacao de falha e defesa de direitos",
        "dados podem ser anonimizados, agregados, bloqueados ou eliminados quando a retencao deixar de ser necessaria e nao houver base legal para mante-los",
      ],
    },
    {
      id: "direitos",
      navLabel: "Direitos do titular",
      title: "9. Direitos do titular e limites legais",
      paragraphs: [
        "Nos termos da LGPD, o titular pode solicitar confirmacao de tratamento, acesso, correcao, anonimizacao, bloqueio, eliminacao quando cabivel, portabilidade nos limites legais e informacoes sobre compartilhamento. Certos pedidos podem ser limitados quando houver obrigacao legal de retencao, necessidade de preservar provas, exercicio regular de direitos ou exigencias de seguranca e antifraude.",
        "Pedidos de privacidade, revisao de dado e questionamentos sobre tratamento devem ser enviados pelos canais oficiais da plataforma. Para medidas que dependam do Discord ou do Mercado Pago, a Flowdesk pode orientar o titular a complementar a solicitacao diretamente ao provedor competente.",
      ],
      note:
        "Em caso de negativa justificada de eliminacao, a Flowdesk preservara apenas os dados estritamente necessarios para a base legal aplicavel.",
    },
    {
      id: "menores",
      navLabel: "Menores",
      title: "10. Menores de idade e representacao",
      paragraphs: [
        "A plataforma nao e destinada a contratacao autonoma por menores de 16 anos. Entre 16 e 18 anos, a utilizacao para fins de compra e contratacao deve ocorrer com assistencia ou autorizacao expressa do responsavel legal.",
        "Se a compra for realizada em nome de menor ou por menor, a Flowdesk podera exigir validacoes adicionais, bloquear ativacoes suspeitas e manter registros indispensaveis para verificar autorizacao, uso do meio de pagamento e seguranca da operacao.",
      ],
    },
    {
      id: "controladora",
      navLabel: "Empresa e contato",
      title: "11. Identificacao da operacao e canais de contato",
      paragraphs: [
        "Para os fins desta Politica, a Flowdesk atua como operacao digital responsavel pelo painel, pelas configuracoes de licenca, pelo historico de pedidos e pelos fluxos internos descritos nestas paginas. Nesta versao, a operacao publica como base territorial Sao Paulo/SP e utiliza exclusivamente canais digitais oficiais para comunicacao com usuarios.",
        "Nao ha endereco fisico publico de atendimento informado nesta versao e ainda nao ha CNPJ divulgado nestes documentos. Quando houver formalizacao societaria publicada ou ampliacao institucional dos canais de contato, a Flowdesk atualizara esta Politica para refletir os novos dados oficiais.",
      ],
      tables: [companyIdentityTable, companyContactTable],
      note:
        "Solicitacoes relacionadas a privacidade, suporte operacional e revisao de dados devem ser direcionadas apenas aos canais oficiais descritos nesta Politica.",
    },
    {
      id: "alteracoes",
      navLabel: "Alteracoes",
      title: "12. Alteracoes desta politica",
      paragraphs: [
        "Esta Politica pode ser atualizada para refletir evolucao do produto, novas integracoes, exigencias legais, ajustes de seguranca e mudancas operacionais. A versao vigente sera sempre a publicada nos canais oficiais da Flowdesk.",
      ],
    },
  ],
  sources: [
    {
      label: "Lei Geral de Protecao de Dados - Lei no 13.709/2018",
      href: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm",
      note:
        "Base principal de privacidade, bases legais, direitos do titular e retencao.",
    },
    {
      label: "ANPD - Direitos dos titulares e eliminacao de dados",
      href: "https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes/6-direitos-dos-titulares-de-dados/6-6-2013-em-quais-situacoes",
      note:
        "Orientacao oficial sobre exercicio de direitos e limites de conservacao.",
    },
    {
      label: "Codigo Civil - Lei no 10.406/2002",
      href: "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm",
      note: "Base para capacidade civil, representacao e responsabilidade contratual.",
    },
    {
      label: "Codigo de Defesa do Consumidor - Lei no 8.078/1990",
      href: "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm",
      note: "Base para informacao clara, contratacao a distancia e direitos do consumidor.",
    },
  ],
};

