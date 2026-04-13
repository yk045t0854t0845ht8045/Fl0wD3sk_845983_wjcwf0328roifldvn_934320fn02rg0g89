-- schema.sql: Estrutura para o Sistema de Afiliados Flowdesk no Supabase

-- 1. Tabela Principal de Afiliados
CREATE TABLE public.affiliates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id BIGINT NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    affiliate_id TEXT UNIQUE NOT NULL, -- Ex: "AFF-12345"
    level TEXT NOT NULL DEFAULT 'bronze', -- bronze, silver, gold, diamond
    balance_available DECIMAL(12, 2) DEFAULT 0.00,
    balance_pending DECIMAL(12, 2) DEFAULT 0.00,
    total_earned DECIMAL(12, 2) DEFAULT 0.00,
    coupon_code TEXT UNIQUE,
    whatsapp_group_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Tabela de Links de Afiliados
CREATE TABLE public.affiliate_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
    plan_slug TEXT NOT NULL, -- basic, pro, enterprise
    period TEXT NOT NULL, -- monthly, annual
    short_url TEXT UNIQUE NOT NULL,
    target_url TEXT NOT NULL,
    clicks_count INTEGER DEFAULT 0,
    conversions_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabela de Conversões (Vendas)
CREATE TABLE public.affiliate_conversions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
    link_id UUID REFERENCES public.affiliate_links(id) ON DELETE SET NULL,
    customer_email TEXT,
    order_id TEXT UNIQUE,
    plan_slug TEXT NOT NULL,
    amount_total DECIMAL(12, 2) NOT NULL,
    commission_amount DECIMAL(12, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, cancelled
    conversion_date TIMESTAMPTZ DEFAULT now(),
    payout_date TIMESTAMPTZ -- Quando a comissão fica disponível para saque
);

-- 4. Tabela de Saques
CREATE TABLE public.affiliate_withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    affiliate_id UUID NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL,
    pix_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processed, rejected
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Configurações de Webhook e Notificações
CREATE TABLE public.affiliate_settings (
    affiliate_id UUID PRIMARY KEY REFERENCES public.affiliates(id) ON DELETE CASCADE,
    webhook_url TEXT,
    notify_email BOOLEAN DEFAULT true,
    notify_sms BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Índices para performance
CREATE INDEX idx_affiliates_user_id ON public.affiliates(user_id);
CREATE INDEX idx_affiliate_links_affiliate_id ON public.affiliate_links(affiliate_id);
CREATE INDEX idx_affiliate_conversions_affiliate_id ON public.affiliate_conversions(affiliate_id);
CREATE INDEX idx_affiliate_withdrawals_affiliate_id ON public.affiliate_withdrawals(affiliate_id);

-- 7. RLS - Row Level Security
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_settings ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso (Somente o dono pode ver seus dados)
CREATE POLICY "Afiliados podem ver seu próprio perfil" ON public.affiliates
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Afiliados podem ver seus próprios links" ON public.affiliate_links
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.affiliates WHERE id = affiliate_links.affiliate_id AND user_id = auth.uid()
    ));

CREATE POLICY "Afiliados podem ver suas conversões" ON public.affiliate_conversions
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.affiliates WHERE id = affiliate_conversions.affiliate_id AND user_id = auth.uid()
    ));

CREATE POLICY "Afiliados podem ver seus saques" ON public.affiliate_withdrawals
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM public.affiliates WHERE id = affiliate_withdrawals.affiliate_id AND user_id = auth.uid()
    ));

CREATE POLICY "Afiliados podem gerenciar seu webhook" ON public.affiliate_settings
    FOR ALL USING (EXISTS (
        SELECT 1 FROM public.affiliates WHERE id = affiliate_settings.affiliate_id AND user_id = auth.uid()
    ));
