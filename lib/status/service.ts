import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type SystemStatus = 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage';
export type IncidentImpact = 'critical' | 'warning' | 'info';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export type ComponentStatus = {
    id: string;
    name: string;
    description: string | null;
    status: SystemStatus;
    updated_at: string;
    created_at: string;
    history: { date: string; status: SystemStatus }[];
};

export type IncidentUpdate = {
    id: string;
    message: string;
    status: IncidentStatus;
    created_at: string;
};

export type Incident = {
    id: string;
    title: string;
    impact: IncidentImpact;
    status: IncidentStatus;
    created_at: string;
    updated_at: string;
    updates: IncidentUpdate[];
};

export async function getSystemStatus() {
    const supabase = getSupabaseAdminClientOrThrow();

    try {
        // Parallel fetching for maximum speed
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const historyDateStr = ninetyDaysAgo.toISOString().split('T')[0];

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const incidentDateStr = thirtyDaysAgo.toISOString();

        const [componentsRes, historyRes, incidentsRes] = await Promise.all([
            supabase
                .from('system_components')
                .select('id, name, description, status, display_order, updated_at, created_at')
                .order('display_order', { ascending: true }),
            
            supabase
                .from('system_status_history')
                .select('component_id, status, recorded_at')
                .gte('recorded_at', historyDateStr)
                .order('recorded_at', { ascending: true }),

            supabase
                .from('system_incidents')
                .select('id, title, impact, status, created_at, updated_at, updates:system_incident_updates(id, message, status, created_at)')
                .gte('created_at', incidentDateStr)
                .order('created_at', { ascending: false })
        ]);

        if (componentsRes.error) {
            console.error("Supabase error fetching components:", componentsRes.error);
            throw componentsRes.error;
        }

        const components = componentsRes.data || [];
        const history = historyRes.data || [];
        const incidents = incidentsRes.data || [];

        // Efficient mapping
        const componentsWithHistory: ComponentStatus[] = components.map(comp => ({
            ...comp,
            history: history
                .filter(h => h.component_id === comp.id)
                .map(h => ({ date: h.recorded_at, status: h.status }))
        }));

        return {
            components: componentsWithHistory,
            incidents: (incidents as any[]) || []
        };
    } catch (e: any) {
        if (e.code === 'PGRST205') {
            throw new Error("As tabelas de status ainda não foram criadas no banco de dados. Por favor, execute o script SQL 064_system_status.sql no painel do Supabase.");
        }
        throw e;
    }
}

export async function subscribeToStatus(type: 'email' | 'discord_dm' | 'webhook' | 'discord_channel', target: string) {
    const supabase = getSupabaseAdminClientOrThrow();

    const { error } = await supabase
        .from('system_status_subscriptions')
        .insert({ type, target });

    if (error) throw error;
    return { ok: true };
}
