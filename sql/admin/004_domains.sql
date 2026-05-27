-- =============================================================================
-- FlowDesk — Subsistema de Domínios
-- Migration: 004_domains.sql
-- =============================================================================
-- Execute no Supabase SQL Editor (painel > SQL Editor).
-- Ordem de execução: após 001_admin_panel.sql, 002_admin_seed.sql, 003_*.sql
-- =============================================================================

-- ─── 1. Contatos do titular ───────────────────────────────────────────────────
-- Armazena dados de registro ICANN/NIC.br por domínio.
-- CPF/CNPJ é armazenado apenas como hash SHA-256; o número mascarado fica em
-- document_last4. Nunca persistir documentos completos em texto puro.
create table if not exists public.domain_contacts (
  id                   uuid primary key default gen_random_uuid(),
  auth_user_id         bigint not null references public.auth_users(id) on delete cascade,

  -- Dados pessoais do titular
  full_name            text not null,
  email                text not null,
  phone                text not null,     -- formato E.164 recomendado: +5511999999999
  street               text not null,
  city                 text not null,
  state                text not null,     -- sigla, ex: SP
  postal_code          text not null,     -- apenas dígitos
  country              text not null default 'BR',

  -- Documento fiscal
  document_type        text not null check (document_type in ('cpf', 'cnpj', 'passport', 'none')),
  document_hash        text,             -- SHA-256 do número sem formatação
  document_last4       text,             -- últimos 4 dígitos (display mascarado)

  -- Sincronização com provedor
  provider             text not null default 'namesilo',
  provider_contact_id  text,            -- ID do contato no provedor

  -- Verificação
  verification_status  text not null default 'pending'
                         check (verification_status in ('pending', 'verified', 'failed')),

  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now())
);

-- ─── 2. Domínios ──────────────────────────────────────────────────────────────
create table if not exists public.domains (
  id                    uuid primary key default gen_random_uuid(),

  -- Vínculo com o usuário dono
  auth_user_id          bigint not null references public.auth_users(id) on delete cascade,

  -- Identificação canônica do domínio
  fqdn                  text not null,              -- "flowdesk.com.br"
  sld                   text not null,              -- "flowdesk"
  tld                   text not null,              -- "com.br"

  -- Provedor de registro
  provider              text not null default 'namesilo',
  provider_domain_id    text,                       -- ID interno no provedor

  -- Contato do titular
  registrant_contact_id uuid references public.domain_contacts(id) on delete set null,

  -- Ciclo de vida
  status                text not null default 'draft'
                          check (status in (
                            'draft',
                            'quote_created',
                            'payment_pending',
                            'registration_requested',
                            'registration_pending',
                            'active',
                            'action_required',
                            'suspended',
                            'client_hold',
                            'server_hold',
                            'expired',
                            'redemption',
                            'pending_delete',
                            'transfer_in_pending',
                            'transfer_out_pending',
                            'failed',
                            'cancelled'
                          )),

  -- Configurações de registro
  registration_period   smallint not null default 1,  -- anos
  auto_renew            boolean not null default true,
  transfer_lock         boolean not null default true,
  privacy_enabled       boolean not null default false,
  dnssec_enabled        boolean not null default false,

  -- Datas críticas
  registered_at         timestamptz,
  expiration_date       timestamptz,

  -- DNS
  nameservers           text[],
  flowdesk_managed_dns  boolean not null default false,
  current_dns_provider  text,

  -- Preço pago (snapshot da compra)
  purchase_price_brl    numeric(10,2),               -- preço final cobrado do usuário
  renewal_price_brl     numeric(10,2),               -- renovação estimada
  provider_cost_usd     numeric(10,4),               -- custo do provedor em USD
  markup_percent        numeric(5,2) not null default 22.5,  -- margem aplicada

  -- Tipo de entrada
  domain_type           text not null default 'registered'
                          check (domain_type in ('registered', 'transferred', 'external', 'pending')),

  -- Vínculo com pedido de pagamento
  payment_order_id      bigint,                      -- FK lógica para payment_orders.id (sem constraint para evitar dependência circular)

  -- Idempotência de compra
  idempotency_key       text unique,                 -- domain_register:{user_id}:{fqdn}:{quote_id}

  -- Sincronização
  last_synced_at        timestamptz,

  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now()),

  unique (auth_user_id, fqdn)
);

-- ─── 3. Cotações de domínio ───────────────────────────────────────────────────
-- Registra toda consulta de preço com snapshot de valores para auditoria.
create table if not exists public.domain_quotes (
  id                    uuid primary key default gen_random_uuid(),
  auth_user_id          bigint not null references public.auth_users(id) on delete cascade,

  fqdn                  text not null,
  tld                   text not null,
  operation             text not null check (operation in ('register', 'renew', 'transfer', 'restore')),
  period_years          smallint not null default 1,

  -- Preços no momento da cotação
  provider_cost_usd     numeric(10,4) not null,
  exchange_rate_usd_brl numeric(10,4) not null,  -- câmbio usado
  markup_percent        numeric(5,2)  not null,
  subtotal_brl          numeric(10,2) not null,
  total_brl             numeric(10,2) not null,

  is_premium            boolean not null default false,
  is_accepted           boolean not null default false,  -- true quando usuário confirmou

  accepted_at           timestamptz,
  expires_at            timestamptz not null default (timezone('utc', now()) + interval '15 minutes'),

  created_at            timestamptz not null default timezone('utc', now())
);

-- ─── 4. Eventos de domínio ────────────────────────────────────────────────────
-- Trilha de auditoria imutável. Nunca deletar linhas desta tabela.
create table if not exists public.domain_events (
  id            uuid primary key default gen_random_uuid(),
  domain_id     uuid references public.domains(id) on delete cascade,
  auth_user_id  bigint references public.auth_users(id) on delete set null,

  -- Tipo do evento
  event_type    text not null,
  -- Exemplos: 'registered', 'renewed', 'auto_renew_toggled', 'nameservers_updated',
  --           'transfer_lock_toggled', 'auth_code_requested', 'transfer_in_started',
  --           'transfer_in_completed', 'transfer_out_started', 'transfer_out_completed',
  --           'dns_record_created', 'dns_record_deleted', 'payment_linked',
  --           'status_changed', 'sync_completed', 'expiration_alert_sent'

  -- Dados do evento (não incluir dados sensíveis completos aqui)
  payload       jsonb not null default '{}'::jsonb,

  -- Referência no provedor quando aplicável
  provider_ref  text,

  created_at    timestamptz not null default timezone('utc', now())
);

-- ─── 5. Transferências ────────────────────────────────────────────────────────
create table if not exists public.domain_transfers (
  id                   uuid primary key default gen_random_uuid(),
  domain_id            uuid references public.domains(id) on delete set null,
  auth_user_id         bigint not null references public.auth_users(id) on delete cascade,

  fqdn                 text not null,
  direction            text not null check (direction in ('in', 'out')),

  status               text not null default 'initiated'
                         check (status in (
                           'initiated',
                           'waiting_auth_code',
                           'waiting_unlock',
                           'waiting_payment',
                           'submitted_to_provider',
                           'waiting_previous_registrar',
                           'action_required',
                           'completed',
                           'failed',
                           'cancelled'
                         )),

  -- Auth code: armazenar APENAS hash — nunca texto puro
  -- O código real deve ser exibido ao usuário uma única vez e descartado
  auth_code_hash       text,

  -- Referência no provedor
  provider_ref         text,

  -- Vínculo com cotação
  quote_id             uuid references public.domain_quotes(id) on delete set null,

  -- Pagamento
  payment_order_id     bigint,

  -- Idempotência
  idempotency_key      text unique,

  error_message        text,

  initiated_at         timestamptz not null default timezone('utc', now()),
  completed_at         timestamptz,
  updated_at           timestamptz not null default timezone('utc', now())
);

-- ─── 6. Registros DNS gerenciados ─────────────────────────────────────────────
create table if not exists public.domain_dns_records (
  id            uuid primary key default gen_random_uuid(),
  domain_id     uuid not null references public.domains(id) on delete cascade,
  auth_user_id  bigint not null references public.auth_users(id) on delete cascade,

  record_type   text not null check (record_type in ('A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR')),
  name          text not null,    -- "@", "www", "mail", etc.
  value         text not null,    -- IP, hostname, texto, etc.
  ttl           integer not null default 3600,
  priority      integer,          -- para MX e SRV

  -- Referência no provedor DNS (Cloudflare zone record ID, ou OP DNS record ID)
  provider_dns_id  text,
  dns_provider     text not null default 'namesilo',  -- 'namesilo' ou 'cloudflare'

  created_at    timestamptz not null default timezone('utc', now()),
  updated_at    timestamptz not null default timezone('utc', now())
);

-- ─── 7. Ledger de cobrança por domínio ────────────────────────────────────────
-- Cada operação financeira gera uma entrada. Nunca deletar.
create table if not exists public.domain_ledger (
  id                    uuid primary key default gen_random_uuid(),
  domain_id             uuid references public.domains(id) on delete set null,
  auth_user_id          bigint not null references public.auth_users(id) on delete cascade,

  event_type            text not null
                          check (event_type in (
                            'registration', 'renewal', 'transfer_in', 'transfer_out',
                            'restore', 'privacy', 'refund', 'chargeback',
                            'failed_payment', 'credit'
                          )),

  fqdn                  text not null,

  -- Valores
  provider_cost_usd     numeric(10,4),
  exchange_rate_usd_brl numeric(10,4),
  markup_percent        numeric(5,2),
  amount_brl            numeric(10,2) not null,  -- positivo = receita, negativo = estorno

  -- Vínculo com pagamento
  payment_order_id      bigint,
  quote_id              uuid references public.domain_quotes(id) on delete set null,

  status                text not null default 'pending'
                          check (status in ('pending', 'confirmed', 'refunded', 'cancelled')),

  notes                 text,
  created_at            timestamptz not null default timezone('utc', now())
);

-- ─── 8. Alertas de expiração ──────────────────────────────────────────────────
create table if not exists public.domain_expiration_alerts (
  id            uuid primary key default gen_random_uuid(),
  domain_id     uuid not null references public.domains(id) on delete cascade,
  auth_user_id  bigint not null references public.auth_users(id) on delete cascade,

  alert_type    text not null check (alert_type in ('30d', '14d', '7d', '3d', '1d', 'expired')),
  sent_at       timestamptz not null default timezone('utc', now()),
  channel       text not null default 'email' check (channel in ('email', 'in_app', 'webhook')),

  unique (domain_id, alert_type, channel)
);

-- ─── 9. Índices de performance ────────────────────────────────────────────────
create index if not exists idx_domains_auth_user_id
  on public.domains (auth_user_id, created_at desc);

create index if not exists idx_domains_fqdn
  on public.domains (fqdn);

create index if not exists idx_domains_status
  on public.domains (status, expiration_date);

create index if not exists idx_domains_expiration
  on public.domains (expiration_date asc)
  where status = 'active';

create index if not exists idx_domains_idempotency_key
  on public.domains (idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_domain_contacts_auth_user_id
  on public.domain_contacts (auth_user_id);

create index if not exists idx_domain_quotes_auth_user_id
  on public.domain_quotes (auth_user_id, created_at desc);

create index if not exists idx_domain_quotes_fqdn
  on public.domain_quotes (fqdn, created_at desc);

create index if not exists idx_domain_events_domain_id
  on public.domain_events (domain_id, created_at desc);

create index if not exists idx_domain_events_auth_user_id
  on public.domain_events (auth_user_id, created_at desc);

create index if not exists idx_domain_transfers_auth_user_id
  on public.domain_transfers (auth_user_id, initiated_at desc);

create index if not exists idx_domain_transfers_domain_id
  on public.domain_transfers (domain_id, direction, status);

create index if not exists idx_domain_dns_records_domain_id
  on public.domain_dns_records (domain_id);

create index if not exists idx_domain_ledger_auth_user_id
  on public.domain_ledger (auth_user_id, created_at desc);

create index if not exists idx_domain_ledger_domain_id
  on public.domain_ledger (domain_id, created_at desc);

-- ─── 10. Triggers updated_at ──────────────────────────────────────────────────
-- Reusa a função set_updated_at() já existente no banco.

drop trigger if exists tr_domain_contacts_updated_at on public.domain_contacts;
create trigger tr_domain_contacts_updated_at
before update on public.domain_contacts
for each row execute function public.set_updated_at();

drop trigger if exists tr_domains_updated_at on public.domains;
create trigger tr_domains_updated_at
before update on public.domains
for each row execute function public.set_updated_at();

drop trigger if exists tr_domain_transfers_updated_at on public.domain_transfers;
create trigger tr_domain_transfers_updated_at
before update on public.domain_transfers
for each row execute function public.set_updated_at();

drop trigger if exists tr_domain_dns_records_updated_at on public.domain_dns_records;
create trigger tr_domain_dns_records_updated_at
before update on public.domain_dns_records
for each row execute function public.set_updated_at();

-- ─── 11. Row Level Security ───────────────────────────────────────────────────
-- O backend usa a service_role (supabase admin) que bypassa RLS.
-- As policies abaixo são para leitura direta com anon/authenticated, se houver.
-- Por segurança, bloqueamos acesso direto ao cliente por padrão.

alter table public.domain_contacts           enable row level security;
alter table public.domains                   enable row level security;
alter table public.domain_quotes             enable row level security;
alter table public.domain_events             enable row level security;
alter table public.domain_transfers          enable row level security;
alter table public.domain_dns_records        enable row level security;
alter table public.domain_ledger             enable row level security;
alter table public.domain_expiration_alerts  enable row level security;

-- Nenhuma policy de acesso público — acesso apenas via service_role no backend.
-- Se quiser expor leitura autenticada no futuro, adicione policies abaixo:
-- create policy "users_read_own_domains" on public.domains
--   for select using (auth_user_id = auth.uid()::bigint);
