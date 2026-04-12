"use client";

import { useEffect, useRef, useState } from "react";
import {
  Users, Trash2, Clock, CheckCircle2, Crown, AlertCircle,
  ChevronDown, ChevronUp, X, Plus, Server, ShieldAlert,
  Shield, Settings, UserPlus, Edit2, Check, Loader2, Search
} from "lucide-react";
import { useRouter } from "next/navigation";
import { DangerActionModal } from "../DangerActionModal";

type TeamRolePermission = "manage_servers" | "manage_members" | "manage_roles" | "view_audit_logs";

type TeamRole = {
  id: number;
  name: string;
  permissions: TeamRolePermission[];
};

type TeamMember = {
  id: number;
  discordUserId: string;
  displayName: string | null;
  status: "pending" | "accepted" | "declined";
  roleId: number | null;
  roleName: string | null;
  customPermissions: TeamRolePermission[];
  acceptedAt: string | null;
  createdAt: string;
};

type Team = {
  id: number;
  name: string;
  iconKey: string;
  role: "owner" | "member";
  currentUserPermissions: TeamRolePermission[];
  ownerDisplayName: string;
  linkedGuildIds: string[];
  members: TeamMember[];
  availableRoles: TeamRole[];
  memberCount: number;
  pendingCount: number;
  createdAt: string;
};

const TEAM_GRADIENT: Record<string, string> = {
  aurora: "radial-gradient(circle at 30% 20%, #91B6FF 0%, #245BFF 48%, #081A4E 100%)",
  ember: "radial-gradient(circle at 30% 20%, #FFB347 0%, #FF4500 48%, #3A0A00 100%)",
  ocean: "radial-gradient(circle at 30% 20%, #67E8F9 0%, #0284C7 48%, #082030 100%)",
  amethyst: "radial-gradient(circle at 30% 20%, #C084FC 0%, #7C3AED 48%, #1A0836 100%)",
  forest: "radial-gradient(circle at 30% 20%, #86EFAC 0%, #16A34A 48%, #052012 100%)",
  sunset: "radial-gradient(circle at 30% 20%, #FCA5A5 0%, #DC2626 48%, #3B0000 100%)",
};

const PERMISSION_OPTIONS: { id: TeamRolePermission; label: string; description: string }[] = [
  { id: "manage_servers", label: "Gerenciar Servidores", description: "Pode adicionar e remover servidores da equipe" },
  { id: "manage_members", label: "Gerenciar Membros", description: "Pode convidar e remover membros" },
  { id: "manage_roles", label: "Gerenciar Cargos", description: "Pode criar, editar e deletar cargos" },
  { id: "view_audit_logs", label: "Ver Audit Logs", description: "Pode visualizar o histórico de ações" },
];

// ─── Spinner helper ─────────────────────────────────────────────────────────
function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 className="animate-spin" style={{ width: size, height: size }} />;
}

export function TeamsTab() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set());

  // Active tab per team: "members" | "roles" | "invite"
  const [activeTab, setActiveTab] = useState<Record<number, string>>({});

  // Invite
  const [inviteInput, setInviteInput] = useState<Record<number, string>>({});
  const [invitingTeamId, setInvitingTeamId] = useState<number | null>(null);
  const [inviteError, setInviteError] = useState<Record<number, string>>({});
  const [inviteSuccess, setInviteSuccess] = useState<Record<number, string>>({});

  // Member actions
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<{ teamId: number; member: TeamMember } | null>(null);
  const [isUpdatingMemberRole, setIsUpdatingMemberRole] = useState<number | null>(null);
  const [memberPermsToEdit, setMemberPermsToEdit] = useState<{ teamId: number; member: TeamMember } | null>(null);
  const [isUpdatingMemberPerms, setIsUpdatingMemberPerms] = useState(false);

  // Role management
  const [newRoleName, setNewRoleName] = useState<Record<number, string>>({});
  const [newRolePerms, setNewRolePerms] = useState<Record<number, TeamRolePermission[]>>({});
  const [isCreatingRole, setIsCreatingRole] = useState<Record<number, boolean>>({});
  const [roleCreateError, setRoleCreateError] = useState<Record<number, string>>({});
  const [roleToDelete, setRoleToDelete] = useState<{ teamId: number; role: TeamRole } | null>(null);
  const [isDeletingRole, setIsDeletingRole] = useState(false);
  const [editingRole, setEditingRole] = useState<{ teamId: number; role: TeamRole; name: string; permissions: TeamRolePermission[] } | null>(null);
  const [isSavingRoleEdit, setIsSavingRoleEdit] = useState(false);

  // Team delete
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [deletingTeamId, setDeletingTeamId] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "owner" | "member">("all");

  const router = useRouter();

  // ─── Data Loading ──────────────────────────────────────────────────────────
  async function loadTeams() {
    try {
      setLoading(true);
      const res = await fetch("/api/auth/me/teams");
      const json = await res.json();
      if (json.ok) setTeams(json.teams || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTeams(); }, []);

  useEffect(() => {
    if (teams.length > 0) {
      setExpandedTeams((prev) => {
        if (prev.size > 0) return prev;
        return new Set([teams[0].id]);
      });
      setActiveTab((prev) => {
        const next = { ...prev };
        for (const t of teams) {
          if (!next[t.id]) next[t.id] = "members";
        }
        return next;
      });
    }
  }, [teams]);

  // ─── Expand/Collapse ───────────────────────────────────────────────────────
  function toggleExpand(teamId: number) {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  // ─── Invite ───────────────────────────────────────────────────────────────
  async function handleInviteMember(teamId: number) {
    const discordUserId = (inviteInput[teamId] || "").trim();
    if (!discordUserId) return;
    setInvitingTeamId(teamId);
    setInviteError((p) => ({ ...p, [teamId]: "" }));
    setInviteSuccess((p) => ({ ...p, [teamId]: "" }));
    try {
      const res = await fetch(`/api/auth/me/teams/${teamId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordUserId }),
      });
      const json = await res.json();
      if (json.ok) {
        setInviteInput((p) => ({ ...p, [teamId]: "" }));
        setInviteSuccess((p) => ({ ...p, [teamId]: "Convite enviado com sucesso!" }));
        await loadTeams();
      } else {
        setInviteError((p) => ({ ...p, [teamId]: json.message || "Erro ao convidar." }));
      }
    } catch {
      setInviteError((p) => ({ ...p, [teamId]: "Erro de rede." }));
    } finally {
      setInvitingTeamId(null);
    }
  }

  // ─── Remove member ────────────────────────────────────────────────────────
  async function handleRemoveMemberConfirm() {
    if (!memberToRemove) return;
    const { teamId, member } = memberToRemove;
    setRemovingMemberId(member.id);
    try {
      await fetch(`/api/auth/me/teams/${teamId}/members/${member.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      await loadTeams();
    } catch (err) { console.error(err); }
    finally {
      setRemovingMemberId(null);
      setMemberToRemove(null);
    }
  }

  // ─── Delete team ──────────────────────────────────────────────────────────
  async function handleDeleteTeamConfirm() {
    if (!teamToDelete) return;
    setDeletingTeamId(teamToDelete.id);
    try {
      await fetch(`/api/auth/me/teams/${teamToDelete.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      await loadTeams();
    } catch (err) { console.error(err); }
    finally {
      setDeletingTeamId(null);
      setTeamToDelete(null);
    }
  }

  // ─── Assign member role ────────────────────────────────────────────────────
  async function handleAssignMemberRole(teamId: number, memberId: number, roleId: number | null) {
    setIsUpdatingMemberRole(memberId);
    try {
      const res = await fetch(`/api/auth/me/teams/${teamId}/members/${memberId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId }),
      });
      if (res.ok) await loadTeams();
    } catch (err) { console.error(err); }
    finally { setIsUpdatingMemberRole(null); }
  }

  // ─── Custom permissions ────────────────────────────────────────────────────
  async function handleToggleMemberPerm(teamId: number, member: TeamMember, perm: TeamRolePermission) {
    setIsUpdatingMemberPerms(true);
    const newPerms = member.customPermissions.includes(perm)
      ? member.customPermissions.filter((p) => p !== perm)
      : [...member.customPermissions, perm];
    try {
      const res = await fetch(`/api/auth/me/teams/${teamId}/members/${member.id}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: newPerms }),
      });
      if (res.ok) {
        setMemberPermsToEdit({ teamId, member: { ...member, customPermissions: newPerms } });
        await loadTeams();
      }
    } catch (err) { console.error(err); }
    finally { setIsUpdatingMemberPerms(false); }
  }

  // ─── Create role ───────────────────────────────────────────────────────────
  async function handleCreateRole(teamId: number) {
    const name = (newRoleName[teamId] || "").trim();
    if (name.length < 2) {
      setRoleCreateError((p) => ({ ...p, [teamId]: "O nome deve ter pelo menos 2 caracteres." }));
      return;
    }
    const permissions = newRolePerms[teamId] || [];
    setIsCreatingRole((p) => ({ ...p, [teamId]: true }));
    setRoleCreateError((p) => ({ ...p, [teamId]: "" }));
    try {
      const res = await fetch(`/api/auth/me/teams/${teamId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, permissions }),
      });
      const json = await res.json();
      if (json.ok) {
        setNewRoleName((p) => ({ ...p, [teamId]: "" }));
        setNewRolePerms((p) => ({ ...p, [teamId]: [] }));
        await loadTeams();
      } else {
        setRoleCreateError((p) => ({ ...p, [teamId]: json.message || "Erro ao criar cargo." }));
      }
    } catch {
      setRoleCreateError((p) => ({ ...p, [teamId]: "Erro de rede." }));
    } finally {
      setIsCreatingRole((p) => ({ ...p, [teamId]: false }));
    }
  }

  // ─── Edit role ─────────────────────────────────────────────────────────────
  async function handleSaveRoleEdit() {
    if (!editingRole) return;
    setIsSavingRoleEdit(true);
    try {
      const res = await fetch(`/api/auth/me/teams/${editingRole.teamId}/roles/${editingRole.role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingRole.name.trim(), permissions: editingRole.permissions }),
      });
      if (res.ok) {
        setEditingRole(null);
        await loadTeams();
      }
    } catch (err) { console.error(err); }
    finally { setIsSavingRoleEdit(false); }
  }

  // ─── Delete role ───────────────────────────────────────────────────────────
  async function handleDeleteRoleConfirm() {
    if (!roleToDelete) return;
    setIsDeletingRole(true);
    try {
      await fetch(`/api/auth/me/teams/${roleToDelete.teamId}/roles/${roleToDelete.role.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      await loadTeams();
    } catch (err) { console.error(err); }
    finally {
      setIsDeletingRole(false);
      setRoleToDelete(null);
    }
  }

  // ─── Loading / Empty states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mt-[32px] space-y-[12px]">
        {/* Filter skeleton */}
        <div className="flowdesk-shimmer h-[70px] w-full rounded-[18px] border border-[#141414] bg-[#0A0A0A]" />
        {[...Array(2)].map((_, i) => (
          <div key={i} className="flowdesk-shimmer h-[86px] w-full rounded-[18px] border border-[#141414] bg-[#0A0A0A]" />
        ))}
      </div>
    );
  }

  const filteredTeams = teams.filter((team) => {
    const q = searchQuery.toLowerCase();
    const matchSearch = team.name.toLowerCase().includes(q) ||
                        team.members.some(m => 
                          (m.displayName?.toLowerCase().includes(q)) || 
                          (m.discordUserId.toLowerCase().includes(q)) || 
                          (m.roleName?.toLowerCase().includes(q))
                        );
                        
    const isOwner = team.role === "owner";
    const matchRole = roleFilter === "all" || 
                     (roleFilter === "owner" && isOwner) || 
                     (roleFilter === "member" && !isOwner);
    return matchSearch && matchRole;
  });

  if (teams.length === 0) {
    return (
      <div className="mt-[32px] flex flex-col items-center justify-center rounded-[18px] border border-[#141414] bg-[#090909] py-[48px] px-[20px] text-center">
        <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#111111]">
          <Users className="text-[#888888] h-[26px] w-[26px]" />
        </div>
        <p className="mt-[16px] text-[16px] font-semibold text-[#E5E5E5]">Sem equipes</p>
        <p className="mt-[6px] text-[14px] text-[#777777] max-w-[360px]">
          Você não possui nem faz parte de nenhuma equipe. Crie uma a partir do painel de servidores.
        </p>
        <button
          onClick={() => router.push("/servers")}
          className="mt-[20px] flex h-[40px] items-center gap-[8px] rounded-[12px] bg-[#111111] px-[18px] text-[14px] font-medium text-[#D0D0D0] transition hover:bg-[#1A1A1A]"
        >
          Ir para Servidores
        </button>
      </div>
    );
  }

  return (
    <div className="mt-[32px] space-y-[24px]">
      {/* Filter Card */}
      <div className="rounded-[22px] border border-[#141414] bg-[#0A0A0A] p-[20px]">
        <div className="flex flex-col gap-[16px] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-[12px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] px-[16px] py-[12px] transition-all focus-within:border-[#222] focus-within:bg-[#0F0F0F]">
            <Search className="h-[18px] w-[18px] shrink-0 text-[#6F6F6F]" strokeWidth={1.8} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por equipe, membro ou cargo..."
              className="w-full bg-transparent text-[15px] text-[#D5D5D5] outline-none placeholder:text-[#4A4A4A]"
            />
          </div>
          
          <div className="flex items-center gap-[10px]">
            <div className="flex items-center gap-[6px] rounded-[14px] border border-[#141414] bg-[#0D0D0D] p-[4px]">
              {(["all", "owner", "member"] as const).map((opt) => {
                const isActive = roleFilter === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => setRoleFilter(opt)}
                    className={`rounded-[10px] px-[16px] py-[8px] text-[13px] font-semibold transition-all ${
                      isActive
                        ? "bg-[#1A1A1A] text-[#EEEEEE] shadow-sm"
                        : "text-[#666666] hover:bg-[#111111] hover:text-[#A6A6A6]"
                    }`}
                  >
                    {opt === "all" ? "Todas" : opt === "owner" ? "Sou Titular" : "Sou Membro"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-[12px]">
                {filteredTeams.length === 0 && teams.length > 0 ? (
          <div className="rounded-[16px] border border-[#141414] bg-[#0A0A0A] p-[24px] text-center">
            <p className="text-[14px] text-[#777777]">Nenhuma equipe encontrada com os filtros atuais.</p>
          </div>
        ) : filteredTeams.map((team) => {
        const isExpanded = expandedTeams.has(team.id);
        const isOwner = team.role === "owner";
        const gradient = TEAM_GRADIENT[team.iconKey] || TEAM_GRADIENT["aurora"];
        const tab = activeTab[team.id] || "members";
        const acceptedMembers = team.members.filter((m) => m.status === "accepted");
        const pendingMembers = team.members.filter((m) => m.status === "pending");

        const canManageRoles = isOwner || team.currentUserPermissions.includes("manage_roles");
        const canManageMembers = isOwner || team.currentUserPermissions.includes("manage_members");

        return (
          <div
            key={team.id}
            className="overflow-hidden rounded-[18px] border border-[#141414] bg-[#0A0A0A] transition hover:border-[#1C1C1C]"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-[16px] p-[18px]">
              <div className="flex items-center gap-[14px] min-w-0">
                <div
                  className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[14px] shadow-lg"
                  style={{ background: gradient }}
                >
                  <span className="text-[18px] font-bold text-white">
                    {team.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-[8px]">
                    <p className="truncate text-[16px] font-semibold text-[#EEEEEE] tracking-tight">{team.name}</p>
                    {isOwner && (
                      <span className="flex items-center gap-[4px] rounded-full bg-[rgba(255,163,47,0.1)] px-[8px] py-[2px] text-[10px] font-semibold text-[#FFB966] uppercase tracking-wider">
                        <Crown className="h-[9px] w-[9px]" /> Dono
                      </span>
                    )}
                  </div>
                  <p className="mt-[3px] text-[12px] text-[#666666]">
                    {team.memberCount} membro(s) · {team.linkedGuildIds.length} servidor(es)
                    {pendingMembers.length > 0 && (
                      <span className="ml-[6px] text-[#F2C823]">· {pendingMembers.length} pendente(s)</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-[8px] shrink-0">
                {isOwner && (
                  <button
                    onClick={() => setTeamToDelete(team)}
                    className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#111111] text-[#888888] transition hover:bg-[rgba(219,70,70,0.1)] hover:text-[#DB4646]"
                  >
                    <Trash2 className="h-[15px] w-[15px]" />
                  </button>
                )}
                <button
                  onClick={() => toggleExpand(team.id)}
                  className="flex h-[34px] items-center gap-[6px] rounded-[10px] bg-[#111111] px-[12px] text-[13px] font-medium text-[#A0A0A0] transition hover:bg-[#1A1A1A] hover:text-[#E0E0E0]"
                >
                  {isExpanded ? (
                    <><ChevronUp className="h-[14px] w-[14px]" /> Recolher</>
                  ) : (
                    <><ChevronDown className="h-[14px] w-[14px]" /> Gerenciar</>
                  )}
                </button>
              </div>
            </div>

            {/* Expanded body */}
            {isExpanded && (
              <div className="border-t border-[#121212]">
                {/* Tab bar */}
                <div className="flex gap-[2px] px-[18px] pt-[14px]">
                  {[
                    { id: "members", icon: <Users className="h-[13px] w-[13px]" />, label: "Membros" },
                    ...(canManageRoles ? [
                      { id: "roles", icon: <Shield className="h-[13px] w-[13px]" />, label: "Cargos" },
                    ] : []),
                    ...(canManageMembers ? [
                      { id: "invite", icon: <UserPlus className="h-[13px] w-[13px]" />, label: "Convidar" },
                    ] : []),
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setActiveTab((prev) => ({ ...prev, [team.id]: t.id }))}
                      className={`flex items-center gap-[6px] rounded-[10px] px-[12px] py-[7px] text-[12px] font-medium transition-colors ${
                        tab === t.id
                          ? "bg-[#161616] text-[#EEEEEE]"
                          : "text-[#666666] hover:text-[#AAAAAA]"
                      }`}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>

                <div className="px-[18px] pb-[20px] pt-[16px]">
                  {/* ── TAB: MEMBERS ─────────────────────────────────────── */}
                  {tab === "members" && (
                    <div className="space-y-[8px]">
                      {/* Servers bar */}
                      {team.linkedGuildIds.length > 0 && (
                        <div className="flex flex-wrap gap-[6px] mb-[12px]">
                          {team.linkedGuildIds.map((guildId) => (
                            <span
                              key={guildId}
                              className="flex items-center gap-[5px] rounded-[8px] border border-[#1A1A1A] bg-[#0D0D0D] px-[10px] py-[4px] font-mono text-[11px] text-[#666666]"
                            >
                              <Server className="h-[10px] w-[10px]" /> {guildId}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Owner row */}
                      <div className="flex items-center justify-between rounded-[12px] border border-[#141414] bg-[#080808] px-[14px] py-[10px]">
                        <div className="flex items-center gap-[10px]">
                          <div className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[rgba(255,163,47,0.08)]">
                            <Crown className="h-[14px] w-[14px] text-[#FFB966]" />
                          </div>
                          <div>
                            <p className="text-[14px] font-medium text-[#D8D8D8]">{team.ownerDisplayName}</p>
                            <p className="text-[11px] text-[#555555]">Proprietário</p>
                          </div>
                        </div>
                        <span className="text-[11px] font-medium text-[#34A853] bg-[rgba(52,168,83,0.08)] rounded-full px-[8px] py-[3px]">Ativo</span>
                      </div>

                      {/* Accepted members */}
                      {acceptedMembers.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between rounded-[12px] border border-[#141414] bg-[#080808] px-[14px] py-[10px]"
                        >
                          <div className="flex items-center gap-[10px]">
                            <div className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[rgba(0,98,255,0.08)]">
                              <CheckCircle2 className="h-[14px] w-[14px] text-[#8AB6FF]" />
                            </div>
                            <div>
                              <p className="text-[14px] font-medium text-[#D8D8D8]">
                                {member.displayName || member.discordUserId}
                              </p>
                              <p className="text-[11px] text-[#555555] font-mono">{member.discordUserId}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-[8px]">
                            {/* Role badge / selector */}
                            {canManageRoles ? (
                              <div className="relative">
                                <select
                                  value={member.roleId || ""}
                                  disabled={isUpdatingMemberRole === member.id}
                                  onChange={(e) =>
                                    handleAssignMemberRole(team.id, member.id, e.target.value ? Number(e.target.value) : null)
                                  }
                                  className="appearance-none h-[28px] rounded-[8px] bg-[#111111] border border-[#1A1A1A] pl-[10px] pr-[24px] text-[11px] font-medium text-[#8AB6FF] cursor-pointer outline-none focus:border-[rgba(0,98,255,0.3)] disabled:opacity-50 transition-colors"
                                >
                                  <option value="">Sem cargo</option>
                                  {team.availableRoles.map((r) => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                  ))}
                                </select>
                                {isUpdatingMemberRole === member.id ? (
                                  <Loader2 className="h-[10px] w-[10px] animate-spin text-[#555555]" />
                                ) : (
                                  <ChevronDown className="pointer-events-none absolute right-[8px] top-1/2 -translate-y-1/2 h-[10px] w-[10px] text-[#555555]" />
                                )}
                              </div>
                            ) : (
                              <span className={`text-[11px] font-medium rounded-full px-[8px] py-[3px] ${
                                member.roleName
                                  ? "text-[#8AB6FF] bg-[rgba(0,98,255,0.08)]"
                                  : "text-[#888888] bg-[rgba(255,255,255,0.03)]"
                              }`}>
                                {member.roleName || "Membro"}
                              </span>
                            )}

                            {canManageMembers && (
                              <>
                                {canManageRoles && (
                                  <button
                                    onClick={() => setMemberPermsToEdit({ teamId: team.id, member })}
                                    className={`flex h-[28px] w-[28px] items-center justify-center rounded-[8px] transition-colors ${
                                      member.customPermissions.length > 0
                                        ? "bg-[rgba(255,163,47,0.1)] text-[#FFB966]"
                                        : "text-[#555555] hover:bg-[#111111] hover:text-[#B5B5B5]"
                                    }`}
                                    title="Permissões individuais"
                                  >
                                    <ShieldAlert className="h-[13px] w-[13px]" />
                                  </button>
                                )}
                                <button
                                  onClick={() => setMemberToRemove({ teamId: team.id, member })}
                                  disabled={removingMemberId === member.id}
                                  className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[#555555] hover:bg-[rgba(219,70,70,0.08)] hover:text-[#DB4646] disabled:opacity-40 transition-colors"
                                >
                                  {removingMemberId === member.id ? <Loader2 className="h-[12px] w-[12px] animate-spin" /> : <X className="h-[13px] w-[13px]" />}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* Pending members */}
                      {pendingMembers.map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between rounded-[12px] border border-[rgba(242,200,35,0.1)] bg-[rgba(242,200,35,0.02)] px-[14px] py-[10px]"
                        >
                          <div className="flex items-center gap-[10px]">
                            <div className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[rgba(242,200,35,0.08)]">
                              <Clock className="h-[14px] w-[14px] text-[#F2C823]" />
                            </div>
                            <div>
                              <p className="text-[14px] font-medium text-[#D8D8D8]">
                                {member.displayName || member.discordUserId}
                              </p>
                              <p className="text-[11px] text-[#555555] font-mono">{member.discordUserId}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-[8px]">
                            <span className="text-[11px] font-medium text-[#F2C823] bg-[rgba(242,200,35,0.08)] rounded-full px-[8px] py-[3px]">Pendente</span>
                            {canManageMembers && (
                              <button
                                onClick={() => setMemberToRemove({ teamId: team.id, member })}
                                disabled={removingMemberId === member.id}
                                className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[#555555] hover:bg-[rgba(219,70,70,0.08)] hover:text-[#DB4646] disabled:opacity-40 transition-colors"
                              >
                                {removingMemberId === member.id ? <Spinner size={12} /> : <X className="h-[13px] w-[13px]" />}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}

                      {team.members.length === 0 && (
                        <p className="text-[13px] text-[#555555] py-[8px]">Nenhum membro além do proprietário.</p>
                      )}
                    </div>
                  )}

                  {/* ── TAB: ROLES ─────────────────────────────────────────── */}
                  {tab === "roles" && canManageRoles && (
                    <div className="space-y-[20px]">
                      {/* Existing roles */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#444444] mb-[10px]">
                          Cargos existentes ({team.availableRoles.length})
                        </p>
                        {team.availableRoles.length === 0 ? (
                          <div className="rounded-[12px] border border-dashed border-[#1C1C1C] bg-[#070707] px-[16px] py-[20px] text-center">
                            <Shield className="mx-auto h-[20px] w-[20px] text-[#333333] mb-[8px]" />
                            <p className="text-[13px] text-[#444444]">Nenhum cargo criado ainda.</p>
                            <p className="text-[12px] text-[#333333] mt-[4px]">Use o formulário abaixo para criar o primeiro cargo.</p>
                          </div>
                        ) : (
                          <div className="space-y-[8px]">
                            {team.availableRoles.map((role) => (
                              <div
                                key={role.id}
                                className="rounded-[12px] border border-[#141414] bg-[#080808] overflow-hidden"
                              >
                                {editingRole?.role.id === role.id && editingRole.teamId === team.id ? (
                                  /* Edit inline */
                                  <div className="p-[16px] space-y-[12px]">
                                    <input
                                      type="text"
                                      value={editingRole.name}
                                      onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                                      className="h-[36px] w-full rounded-[8px] border border-[#1F1F1F] bg-[#0A0A0A] px-[12px] text-[13px] text-[#E0E0E0] outline-none focus:border-[rgba(0,98,255,0.4)] transition-colors"
                                      placeholder="Nome do cargo"
                                    />
                                    <div className="grid grid-cols-2 gap-[8px]">
                                      {PERMISSION_OPTIONS.map((opt) => (
                                        <label key={opt.id} className="flex items-center gap-[8px] rounded-[8px] border border-[#151515] bg-[#0A0A0A] p-[8px] cursor-pointer hover:bg-[#0D0D0D] transition-colors">
                                          <input
                                            type="checkbox"
                                            checked={editingRole.permissions.includes(opt.id)}
                                            onChange={(e) => {
                                              const perms = e.target.checked
                                                ? [...editingRole.permissions, opt.id]
                                                : editingRole.permissions.filter((p) => p !== opt.id);
                                              setEditingRole({ ...editingRole, permissions: perms });
                                            }}
                                            className="h-[14px] w-[14px] rounded accent-[#8AB6FF]"
                                          />
                                          <span className="text-[11px] text-[#888888]">{opt.label}</span>
                                        </label>
                                      ))}
                                    </div>
                                    <div className="flex gap-[8px]">
                                      <button
                                        onClick={handleSaveRoleEdit}
                                        disabled={isSavingRoleEdit}
                                        className="flex h-[32px] flex-1 items-center justify-center gap-[6px] rounded-[8px] bg-[#F1F1F1] text-[12px] font-semibold text-[#111111] transition hover:opacity-90 disabled:opacity-40"
                                      >
                                        {isSavingRoleEdit ? <Spinner size={12} /> : <Check className="h-[12px] w-[12px]" />}
                                        Salvar
                                      </button>
                                      <button
                                        onClick={() => setEditingRole(null)}
                                        className="flex h-[32px] items-center justify-center rounded-[8px] bg-[#111111] px-[14px] text-[12px] font-medium text-[#888888] transition hover:text-[#CCCCCC]"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between px-[14px] py-[12px]">
                                    <div>
                                      <p className="text-[14px] font-medium text-[#D8D8D8]">{role.name}</p>
                                      <div className="mt-[4px] flex flex-wrap gap-[4px]">
                                        {role.permissions.length === 0 ? (
                                          <span className="text-[10px] text-[#444444]">Sem permissões</span>
                                        ) : role.permissions.map((p) => (
                                          <span key={p} className="rounded-[4px] bg-[rgba(0,98,255,0.08)] px-[6px] py-[2px] text-[10px] font-medium text-[#6699FF]">
                                            {PERMISSION_OPTIONS.find((o) => o.id === p)?.label || p}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-[6px]">
                                      <button
                                        onClick={() => setEditingRole({ teamId: team.id, role, name: role.name, permissions: [...role.permissions] })}
                                        className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[#555555] hover:bg-[#111111] hover:text-[#AAAAAA] transition-colors"
                                        title="Editar cargo"
                                      >
                                        <Edit2 className="h-[12px] w-[12px]" />
                                      </button>
                                      <button
                                        onClick={() => setRoleToDelete({ teamId: team.id, role })}
                                        className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[#555555] hover:bg-[rgba(219,70,70,0.08)] hover:text-[#B54646] transition-colors"
                                        title="Excluir cargo"
                                      >
                                        <Trash2 className="h-[12px] w-[12px]" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Create new role */}
                      <div className="rounded-[14px] border border-[#141414] bg-[#080808] p-[16px] space-y-[14px]">
                        <p className="text-[13px] font-semibold text-[#DDDDDD]">Criar novo cargo</p>

                        <div>
                          <label className="text-[11px] font-medium text-[#555555] mb-[6px] block uppercase tracking-wider">Nome do cargo</label>
                          <input
                            type="text"
                            value={newRoleName[team.id] || ""}
                            onChange={(e) => setNewRoleName((p) => ({ ...p, [team.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") handleCreateRole(team.id); }}
                            placeholder="Ex: Moderador, Admin, Suporte…"
                            maxLength={32}
                            className="h-[38px] w-full rounded-[10px] border border-[#1A1A1A] bg-[#0A0A0A] px-[14px] text-[13px] text-[#E0E0E0] placeholder:text-[#333333] outline-none focus:border-[rgba(0,98,255,0.35)] transition-colors"
                          />
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-[#555555] mb-[8px] block uppercase tracking-wider">Permissões do cargo</label>
                          <div className="grid grid-cols-1 gap-[6px] sm:grid-cols-2">
                            {PERMISSION_OPTIONS.map((opt) => {
                              const checked = (newRolePerms[team.id] || []).includes(opt.id);
                              return (
                                <label
                                  key={opt.id}
                                  className={`flex items-start gap-[10px] rounded-[10px] border p-[10px] cursor-pointer transition-colors ${
                                    checked
                                      ? "border-[rgba(0,98,255,0.25)] bg-[rgba(0,98,255,0.06)]"
                                      : "border-[#141414] bg-[#0A0A0A] hover:border-[#1C1C1C]"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const current = newRolePerms[team.id] || [];
                                      setNewRolePerms((p) => ({
                                        ...p,
                                        [team.id]: e.target.checked
                                          ? [...current, opt.id]
                                          : current.filter((id) => id !== opt.id),
                                      }));
                                    }}
                                    className="mt-[1px] h-[14px] w-[14px] shrink-0 rounded accent-[#8AB6FF]"
                                  />
                                  <div>
                                    <p className={`text-[12px] font-medium transition-colors ${checked ? "text-[#8AB6FF]" : "text-[#888888]"}`}>
                                      {opt.label}
                                    </p>
                                    <p className="text-[11px] text-[#444444] mt-[2px]">{opt.description}</p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {roleCreateError[team.id] && (
                          <p className="flex items-center gap-[6px] text-[12px] text-[#DB4646]">
                            <AlertCircle className="h-[12px] w-[12px]" />
                            {roleCreateError[team.id]}
                          </p>
                        )}

                        <button
                          onClick={() => handleCreateRole(team.id)}
                          disabled={isCreatingRole[team.id] || !(newRoleName[team.id] || "").trim()}
                          className="flex h-[38px] w-full items-center justify-center gap-[8px] rounded-[10px] bg-[#F1F1F1] text-[13px] font-semibold text-[#111111] transition hover:opacity-90 disabled:opacity-30"
                        >
                          {isCreatingRole[team.id] ? <Spinner size={14} /> : <Plus className="h-[14px] w-[14px]" />}
                          Criar cargo
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── TAB: INVITE ────────────────────────────────────────── */}
                  {tab === "invite" && canManageMembers && (
                    <div className="space-y-[16px]">
                      <div className="rounded-[14px] border border-[#141414] bg-[#080808] p-[16px] space-y-[12px]">
                        <p className="text-[13px] font-semibold text-[#DDDDDD]">Convidar novo membro</p>
                        <p className="text-[12px] text-[#555555] leading-[1.6]">
                          Insira o <strong className="text-[#888888]">ID numérico</strong> do usuário no Discord (ex: 123456789012345678).
                          O convite ficará pendente até o usuário aceitar ao acessar a plataforma.
                        </p>
                        <div className="flex gap-[8px]">
                          <input
                            type="text"
                            value={inviteInput[team.id] || ""}
                            onChange={(e) => setInviteInput((p) => ({ ...p, [team.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") handleInviteMember(team.id); }}
                            placeholder="Discord User ID (ex: 123456789012345678)"
                            className="h-[40px] flex-1 rounded-[10px] border border-[#1A1A1A] bg-[#0A0A0A] px-[14px] font-mono text-[13px] text-[#E0E0E0] placeholder:text-[#333333] outline-none focus:border-[rgba(0,98,255,0.35)] transition-colors"
                          />
                          <button
                            onClick={() => handleInviteMember(team.id)}
                            disabled={invitingTeamId === team.id || !(inviteInput[team.id] || "").trim()}
                            className="flex h-[40px] items-center gap-[6px] rounded-[10px] bg-[rgba(0,98,255,0.12)] border border-[rgba(0,98,255,0.18)] px-[16px] text-[13px] font-medium text-[#8AB6FF] transition hover:bg-[rgba(0,98,255,0.2)] disabled:opacity-40"
                          >
                            {invitingTeamId === team.id ? <Spinner size={14} /> : <Plus className="h-[14px] w-[14px]" />}
                            Convidar
                          </button>
                        </div>
                        {inviteError[team.id] && (
                          <p className="flex items-center gap-[6px] text-[12px] text-[#DB4646]">
                            <AlertCircle className="h-[12px] w-[12px]" /> {inviteError[team.id]}
                          </p>
                        )}
                        {inviteSuccess[team.id] && (
                          <p className="flex items-center gap-[6px] text-[12px] text-[#34A853]">
                            <Check className="h-[12px] w-[12px]" /> {inviteSuccess[team.id]}
                          </p>
                        )}
                      </div>

                      {/* Pending list in invite tab */}
                      {pendingMembers.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#444444] mb-[8px]">
                            Convites pendentes ({pendingMembers.length})
                          </p>
                          <div className="space-y-[6px]">
                            {pendingMembers.map((member) => (
                              <div
                                key={member.id}
                                className="flex items-center justify-between rounded-[10px] border border-[rgba(242,200,35,0.1)] bg-[rgba(242,200,35,0.02)] px-[12px] py-[8px]"
                              >
                                <div>
                                  <p className="text-[13px] font-medium text-[#D8D8D8]">{member.displayName || member.discordUserId}</p>
                                  <p className="text-[10px] text-[#555555] font-mono">{member.discordUserId}</p>
                                </div>
                                <button
                                  onClick={() => setMemberToRemove({ teamId: team.id, member })}
                                  disabled={removingMemberId === member.id}
                                  className="flex h-[26px] items-center gap-[5px] rounded-[7px] px-[10px] text-[11px] text-[#666666] hover:bg-[rgba(219,70,70,0.08)] hover:text-[#DB4646] disabled:opacity-40 transition-colors"
                                >
                                  <X className="h-[11px] w-[11px]" /> Cancelar
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>
          );
        })
      }
    </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}
      <DangerActionModal
        isOpen={!!memberToRemove}
        onClose={() => setMemberToRemove(null)}
        onConfirm={handleRemoveMemberConfirm}
        isProcessing={removingMemberId !== null}
        title="Remover membro"
        description={`Deseja remover "${memberToRemove?.member.displayName || memberToRemove?.member.discordUserId}" da equipe? O membro perderá acesso imediatamente.`}
        confirmText="Remover membro"
        eyebrow="Gerenciamento de equipe"
      />
      <DangerActionModal
        isOpen={!!teamToDelete}
        onClose={() => setTeamToDelete(null)}
        onConfirm={handleDeleteTeamConfirm}
        isProcessing={deletingTeamId !== null}
        title={`Excluir equipe "${teamToDelete?.name}"`}
        description="Todos os membros perderão acesso à equipe e aos servidores vinculados. Esta ação não pode ser desfeita."
        confirmText="Excluir equipe"
        eyebrow="Exclusão de equipe"
      />
      <DangerActionModal
        isOpen={!!roleToDelete}
        onClose={() => setRoleToDelete(null)}
        onConfirm={handleDeleteRoleConfirm}
        isProcessing={isDeletingRole}
        title={`Excluir cargo "${roleToDelete?.role.name}"`}
        description="Membros que possuem este cargo perderão as permissões associadas. Esta ação não pode ser desfeita."
        confirmText="Excluir cargo"
        eyebrow="Gerenciamento de cargos"
      />

      {/* ── Custom Permissions Modal ─────────────────────────────────────── */}
      {memberPermsToEdit && (
        <div className="fixed inset-0 z-[2700] flex items-center justify-center bg-[rgba(0,0,0,0.8)] backdrop-blur-[5px] px-[20px]">
          <div className="w-full max-w-[440px] rounded-[24px] border border-[#141414] bg-[#0A0A0A] p-[24px] shadow-2xl">
            <div className="flex items-start justify-between mb-[6px]">
              <div>
                <p className="text-[15px] font-semibold text-[#EEEEEE]">Permissões Individuais</p>
                <p className="text-[12px] text-[#555555] mt-[2px]">
                  {memberPermsToEdit.member.displayName || memberPermsToEdit.member.discordUserId}
                </p>
              </div>
              <button onClick={() => setMemberPermsToEdit(null)} className="text-[#555555] hover:text-[#EEEEEE] transition-colors mt-[2px]">
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>

            <div className="my-[16px] rounded-[10px] border border-[rgba(255,163,47,0.1)] bg-[rgba(255,163,47,0.03)] px-[12px] py-[10px]">
              <p className="text-[11px] text-[#888888] leading-[1.6]">
                <span className="text-[#FFB966] font-medium">Nota:</span> Estas permissões são <strong className="text-[#AAAAAA]">somadas</strong> às permissões do cargo atual do membro. Use para conceder acesso pontual sem criar um cargo novo.
              </p>
            </div>

            <div className="space-y-[6px]">
              {PERMISSION_OPTIONS.map((opt) => {
                const active = memberPermsToEdit.member.customPermissions.includes(opt.id);
                return (
                  <label
                    key={opt.id}
                    className={`flex items-center justify-between rounded-[12px] border p-[12px] cursor-pointer transition-colors ${
                      active ? "border-[rgba(0,98,255,0.2)] bg-[rgba(0,98,255,0.05)]" : "border-[#141414] bg-[#080808] hover:bg-[#0B0B0B]"
                    }`}
                  >
                    <div>
                      <p className={`text-[13px] font-medium ${active ? "text-[#8AB6FF]" : "text-[#AAAAAA]"}`}>{opt.label}</p>
                      <p className="text-[11px] text-[#444444] mt-[2px]">{opt.description}</p>
                    </div>
                    <div className="relative ml-[12px] shrink-0">
                      <input
                        type="checkbox"
                        disabled={isUpdatingMemberPerms}
                        checked={active}
                        onChange={() =>
                          handleToggleMemberPerm(memberPermsToEdit.teamId, memberPermsToEdit.member, opt.id)
                        }
                        className="peer sr-only"
                      />
                      <div className={`h-[20px] w-[36px] rounded-full transition-colors ${active ? "bg-[#8AB6FF]" : "bg-[#1A1A1A]"}`} />
                      <div className={`absolute top-[3px] h-[14px] w-[14px] rounded-full bg-white transition-transform ${active ? "left-[19px]" : "left-[3px]"}`} />
                    </div>
                  </label>
                );
              })}
            </div>

            <button
              onClick={() => setMemberPermsToEdit(null)}
              className="mt-[20px] w-full h-[40px] rounded-[12px] bg-[#141414] text-[13px] font-medium text-[#EEEEEE] hover:bg-[#1A1A1A] transition-colors"
            >
              Concluir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
