import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type TeamMembershipStatus = "pending" | "accepted" | "declined";

export type TeamRolePermission = "manage_servers" | "manage_members" | "manage_roles" | "view_audit_logs";

export type TeamRole = {
  id: number;
  teamId: number;
  name: string;
  permissions: TeamRolePermission[];
  createdAt: string;
};

export type UserTeamMember = {
  id: number;
  discordUserId: string;
  displayName: string | null;
  status: TeamMembershipStatus;
  roleId: number | null;
  roleName: string | null;
  customPermissions: TeamRolePermission[];
  acceptedAt: string | null;
  createdAt: string;
};

export type UserTeam = {
  id: number;
  name: string;
  iconKey: string;
  role: "owner" | "member";
  currentUserPermissions: TeamRolePermission[];
  ownerUserId: number;
  ownerDisplayName: string;
  linkedGuildIds: string[];
  members: UserTeamMember[];
  availableRoles: TeamRole[];
  memberCount: number;
  pendingCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PendingTeamInvite = {
  membershipId: number;
  teamId: number;
  teamName: string;
  invitedByDisplayName: string;
  linkedGuildIds: string[];
  createdAt: string;
};

type TeamRow = {
  id: number;
  owner_user_id: number;
  name: string;
  icon_key: string;
  created_at: string;
  updated_at: string;
};

type TeamServerRow = {
  team_id: number;
  guild_id: string;
};

type TeamMemberRow = {
  id: number;
  team_id: number;
  invited_discord_user_id: string;
  invited_auth_user_id: number | null;
  invited_by_user_id: number;
  status: TeamMembershipStatus;
  role_id: number | null;
  custom_permissions: TeamRolePermission[];
  accepted_at: string | null;
  created_at: string;
};

type TeamRoleRow = {
  id: number;
  team_id: number;
  name: string;
  permissions: TeamRolePermission[];
  created_at: string;
};

type AuthUserLookupRow = {
  id: number;
  discord_user_id: string;
  display_name: string;
};

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function parseTeamName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 64);
}

function normalizeTeamIconKey(value: string) {
  const normalized = value.trim().toLowerCase();
  const allowed = new Set([
    "aurora",
    "ember",
    "ocean",
    "amethyst",
    "forest",
    "sunset",
  ]);
  return allowed.has(normalized) ? normalized : "aurora";
}

function normalizeDiscordIds(values: string[]) {
  const valid = values
    .map((value) => value.trim())
    .filter((value) => /^\d{10,25}$/.test(value));

  return uniqueStrings(valid).slice(0, 50);
}

function normalizeGuildIds(values: string[]) {
  const valid = values
    .map((value) => value.trim())
    .filter((value) => /^\d{10,25}$/.test(value));

  return uniqueStrings(valid).slice(0, 100);
}

export async function getAcceptedTeamGuildIdsForUser(input: {
  authUserId: number;
  discordUserId: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const membershipsResult = await supabase
    .from("auth_user_team_members")
    .select("team_id")
    .eq("status", "accepted")
    .or(
      `invited_discord_user_id.eq.${input.discordUserId},invited_auth_user_id.eq.${input.authUserId}`,
    );

  if (membershipsResult.error) {
    throw new Error(membershipsResult.error.message);
  }

  const teamIds = uniqueStrings(
    (membershipsResult.data || []).map((row) => String(row.team_id)),
  ).map((value) => Number(value));

  if (!teamIds.length) {
    return [];
  }

  const teamServersResult = await supabase
    .from("auth_user_team_servers")
    .select("guild_id")
    .in("team_id", teamIds);

  if (teamServersResult.error) {
    throw new Error(teamServersResult.error.message);
  }

  return uniqueStrings((teamServersResult.data || []).map((row) => row.guild_id));
}

export async function getUserTeamsSnapshotForUser(input: {
  authUserId: number;
  discordUserId: string;
}) {
  const supabase = getSupabaseAdminClientOrThrow();

  const ownedTeamsResult = await supabase
    .from("auth_user_teams")
    .select("id, owner_user_id, name, icon_key, created_at, updated_at")
    .eq("owner_user_id", input.authUserId)
    .order("created_at", { ascending: true })
    .returns<TeamRow[]>();

  if (ownedTeamsResult.error) {
    throw new Error(ownedTeamsResult.error.message);
  }

  const memberInvitesResult = await supabase
    .from("auth_user_team_members")
    .select(
      "id, team_id, invited_discord_user_id, invited_auth_user_id, invited_by_user_id, status, role_id, custom_permissions, accepted_at, created_at",
    )
    .or(
      `invited_discord_user_id.eq.${input.discordUserId},invited_auth_user_id.eq.${input.authUserId}`,
    )
    .returns<TeamMemberRow[]>();

  if (memberInvitesResult.error) {
    throw new Error(memberInvitesResult.error.message);
  }

  const ownedTeams = ownedTeamsResult.data || [];
  const ownTeamIds = ownedTeams.map((team) => team.id);
  const acceptedMemberships = (memberInvitesResult.data || []).filter(
    (membership) => membership.status === "accepted",
  );
  const pendingMemberships = (memberInvitesResult.data || []).filter(
    (membership) => membership.status === "pending",
  );

  const memberTeamIds = acceptedMemberships
    .map((membership) => membership.team_id)
    .filter((teamId) => !ownTeamIds.includes(teamId));
  const pendingTeamIds = pendingMemberships
    .map((membership) => membership.team_id)
    .filter((teamId) => !ownTeamIds.includes(teamId));

  const externalTeamIds = uniqueStrings(
    [...memberTeamIds, ...pendingTeamIds].map(String),
  ).map((value) => Number(value));

  let externalTeams: TeamRow[] = [];

  if (externalTeamIds.length) {
    const externalTeamsResult = await supabase
      .from("auth_user_teams")
      .select("id, owner_user_id, name, icon_key, created_at, updated_at")
      .in("id", externalTeamIds)
      .returns<TeamRow[]>();

    if (externalTeamsResult.error) {
      throw new Error(externalTeamsResult.error.message);
    }

    externalTeams = externalTeamsResult.data || [];
  }

  const accessibleTeamIds = uniqueStrings(
    [...ownedTeams.map((team) => team.id), ...acceptedMemberships.map((membership) => membership.team_id)].map(String),
  ).map((value) => Number(value));

  const allKnownTeamIds = uniqueStrings(
    [...ownedTeams.map((team) => team.id), ...externalTeams.map((team) => team.id)].map(String),
  ).map((value) => Number(value));

  let teamServers: TeamServerRow[] = [];
  let teamMembers: TeamMemberRow[] = [];
  const teamRolesByTeam = new Map<number, TeamRole[]>();
  const rolesById = new Map<number, TeamRoleRow>();

  if (allKnownTeamIds.length) {
    const [teamServersResult, teamMembersResult, teamRolesResult] = await Promise.all([
      supabase
        .from("auth_user_team_servers")
        .select("team_id, guild_id")
        .in("team_id", allKnownTeamIds)
        .returns<TeamServerRow[]>(),
      supabase
        .from("auth_user_team_members")
        .select(
          "id, team_id, invited_discord_user_id, invited_auth_user_id, invited_by_user_id, status, role_id, custom_permissions, accepted_at, created_at",
        )
        .in("team_id", allKnownTeamIds)
        .returns<TeamMemberRow[]>(),
      supabase
        .from("auth_user_team_roles")
        .select("id, team_id, name, permissions, created_at")
        .in("team_id", allKnownTeamIds)
        .returns<TeamRoleRow[]>(),
    ]);

    if (teamServersResult.error) {
      console.error("teamServersResult error:", teamServersResult.error);
      throw new Error(teamServersResult.error.message);
    }

    if (teamMembersResult.error) {
      console.error("teamMembersResult error:", teamMembersResult.error);
      throw new Error(teamMembersResult.error.message);
    }

    if (teamRolesResult.error) {
      console.error("teamRolesResult error:", teamRolesResult.error);
      throw new Error(teamRolesResult.error.message);
    }

    teamServers = teamServersResult.data || [];
    teamMembers = teamMembersResult.data || [];

    for (const roleRow of teamRolesResult.data || []) {
      const role: TeamRole = {
        id: roleRow.id,
        teamId: roleRow.team_id,
        name: roleRow.name,
        permissions: Array.isArray(roleRow.permissions) ? roleRow.permissions : [],
        createdAt: roleRow.created_at,
      };
      const current = teamRolesByTeam.get(roleRow.team_id) || [];
      current.push(role);
      teamRolesByTeam.set(roleRow.team_id, current);
      rolesById.set(roleRow.id, roleRow);
    }
  }

  const userIdsToResolve = uniqueStrings(
    [
      ...ownedTeams.map((team) => team.owner_user_id),
      ...externalTeams.map((team) => team.owner_user_id),
      ...teamMembers
        .map((member) => member.invited_auth_user_id)
        .filter((value): value is number => typeof value === "number"),
      ...teamMembers.map((member) => member.invited_by_user_id),
    ].map(String),
  ).map((value) => Number(value));

  let authUsers: AuthUserLookupRow[] = [];

  if (userIdsToResolve.length) {
    const authUsersResult = await supabase
      .from("auth_users")
      .select("id, discord_user_id, display_name")
      .in("id", userIdsToResolve)
      .returns<AuthUserLookupRow[]>();

    if (authUsersResult.error) {
      throw new Error(authUsersResult.error.message);
    }

    authUsers = authUsersResult.data || [];
  }

  const authUserMap = new Map(authUsers.map((user) => [user.id, user]));
  const teamsById = new Map<number, TeamRow>(
    [...ownedTeams, ...externalTeams].map((team) => [team.id, team]),
  );
  const linkedGuildIdsByTeam = new Map<number, string[]>();

  for (const server of teamServers) {
    const current = linkedGuildIdsByTeam.get(server.team_id) || [];
    current.push(server.guild_id);
    linkedGuildIdsByTeam.set(server.team_id, uniqueStrings(current));
  }

  const teamMembersByTeam = new Map<number, TeamMemberRow[]>();
  for (const member of teamMembers) {
    const current = teamMembersByTeam.get(member.team_id) || [];
    current.push(member);
    teamMembersByTeam.set(member.team_id, current);
  }

  const teams: UserTeam[] = accessibleTeamIds
    .map((teamId) => {
      const team = teamsById.get(teamId);
      if (!team) return null;

      const owner = authUserMap.get(team.owner_user_id);
      const members: UserTeamMember[] = (teamMembersByTeam.get(teamId) || [])
        .filter((member) => member.status !== "declined")
        .map((member) => {
          const role = member.role_id ? rolesById.get(member.role_id) : null;
          return {
            id: member.id,
            discordUserId: member.invited_discord_user_id,
            displayName: member.invited_auth_user_id
              ? authUserMap.get(member.invited_auth_user_id)?.display_name || null
              : null,
            status: member.status,
            roleId: member.role_id,
            roleName: role?.name || null,
            customPermissions: Array.isArray(member.custom_permissions) ? member.custom_permissions : [],
            acceptedAt: member.accepted_at,
            createdAt: member.created_at,
          };
        });

      const acceptedCount = members.filter((member) => member.status === "accepted").length;
      const pendingCount = members.filter((member) => member.status === "pending").length;

      const userMembership = teamMembers.find(m => m.team_id === teamId && (m.invited_auth_user_id === input.authUserId || m.invited_discord_user_id === input.discordUserId));
      const userRoleRow = userMembership?.role_id ? rolesById.get(userMembership.role_id) : null;
      const isAdminOrOwner = team.owner_user_id === input.authUserId;

      const effectivePerms = uniqueStrings([
        ...(Array.isArray(userRoleRow?.permissions) ? userRoleRow.permissions : []),
        ...(Array.isArray(userMembership?.custom_permissions) ? userMembership.custom_permissions : [])
      ]) as TeamRolePermission[];

      return {
        id: team.id,
        name: team.name,
        iconKey: normalizeTeamIconKey(team.icon_key || "aurora"),
        role: isAdminOrOwner ? "owner" : "member",
        currentUserPermissions: isAdminOrOwner 
          ? ["manage_servers", "manage_members", "manage_roles", "view_audit_logs"] as TeamRolePermission[]
          : effectivePerms,
        ownerUserId: team.owner_user_id,
        ownerDisplayName: owner?.display_name || "Equipe Flowdesk",
        linkedGuildIds: linkedGuildIdsByTeam.get(teamId) || [],
        members,
        availableRoles: teamRolesByTeam.get(teamId) || [],
        memberCount: 1 + acceptedCount,
        pendingCount,
        createdAt: team.created_at,
        updatedAt: team.updated_at,
      } satisfies UserTeam;
    })
    .filter((team): team is UserTeam => Boolean(team))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  const pendingInvites: PendingTeamInvite[] = pendingMemberships
    .map((membership) => {
      const team = teamsById.get(membership.team_id);
      if (!team) return null;

      const invitedByUser = authUserMap.get(membership.invited_by_user_id);

      return {
        membershipId: membership.id,
        teamId: team.id,
        teamName: team.name,
        invitedByDisplayName: invitedByUser?.display_name || "Equipe Flowdesk",
        linkedGuildIds: linkedGuildIdsByTeam.get(team.id) || [],
        createdAt: membership.created_at,
      } satisfies PendingTeamInvite;
    })
    .filter((invite): invite is PendingTeamInvite => Boolean(invite));

  return {
    teams,
    pendingInvites,
  };
}

export async function createUserTeamForUser(input: {
  authUserId: number;
  discordUserId: string;
  name: string;
  iconKey: string;
  guildIds: string[];
  memberDiscordIds: string[];
}) {
  const supabase = getSupabaseAdminClientOrThrow();
  const teamName = parseTeamName(input.name);
  const iconKey = normalizeTeamIconKey(input.iconKey);

  if (!teamName || teamName.length < 3) {
    throw new Error("Escolha um nome de equipe com pelo menos 3 caracteres.");
  }

  const guildIds = normalizeGuildIds(input.guildIds);
  if (!guildIds.length) {
    throw new Error("Selecione pelo menos um servidor para vincular a equipe.");
  }

  const existingGuildLinksResult = await supabase
    .from("auth_user_team_servers")
    .select("guild_id")
    .in("guild_id", guildIds)
    .returns<Array<{ guild_id: string }>>();

  if (existingGuildLinksResult.error) {
    throw new Error(existingGuildLinksResult.error.message);
  }

  const alreadyLinkedGuildIds = uniqueStrings(
    (existingGuildLinksResult.data || []).map((row) => row.guild_id),
  );

  if (alreadyLinkedGuildIds.length) {
    throw new Error("Um ou mais servidores selecionados ja estao vinculados a outra equipe.");
  }

  const memberDiscordIds = normalizeDiscordIds(input.memberDiscordIds).filter(
    (discordUserId) => discordUserId !== input.discordUserId,
  );

  const insertTeamResult = await supabase
    .from("auth_user_teams")
    .insert({
      owner_user_id: input.authUserId,
      name: teamName,
      icon_key: iconKey,
    })
    .select("id")
    .single<{ id: number }>();

  if (insertTeamResult.error || !insertTeamResult.data) {
    throw new Error(insertTeamResult.error?.message || "Nao foi possivel criar a equipe.");
  }

  const teamId = insertTeamResult.data.id;

  try {
    const teamServersResult = await supabase
      .from("auth_user_team_servers")
      .insert(
        guildIds.map((guildId) => ({
          team_id: teamId,
          guild_id: guildId,
        })),
      );

    if (teamServersResult.error) {
      throw new Error(
        teamServersResult.error.message.includes("duplicate")
          ? "Um ou mais servidores selecionados ja estao vinculados a outra equipe."
          : teamServersResult.error.message,
      );
    }

    if (memberDiscordIds.length) {
      const existingUsersResult = await supabase
        .from("auth_users")
        .select("id, discord_user_id")
        .in("discord_user_id", memberDiscordIds)
        .returns<AuthUserLookupRow[]>();

      if (existingUsersResult.error) {
        throw new Error(existingUsersResult.error.message);
      }

      const authUserByDiscordId = new Map(
        (existingUsersResult.data || []).map((user) => [user.discord_user_id, user.id]),
      );

      const membersInsertResult = await supabase
        .from("auth_user_team_members")
        .insert(
          memberDiscordIds.map((discordUserId) => ({
            team_id: teamId,
            invited_discord_user_id: discordUserId,
            invited_auth_user_id: authUserByDiscordId.get(discordUserId) || null,
            invited_by_user_id: input.authUserId,
            status: "pending" as const,
          })),
        );

      if (membersInsertResult.error) {
        throw new Error(membersInsertResult.error.message);
      }
    }
  } catch (error) {
    await supabase
      .from("auth_user_teams")
      .delete()
      .eq("id", teamId);

    throw error instanceof Error
      ? error
      : new Error("Nao foi possivel concluir a criacao da equipe.");
  }

  return teamId;
}

export async function acceptUserTeamInviteForUser(input: {
  authUserId: number;
  discordUserId: string;
  teamId: number;
}) {
  const supabase = getSupabaseAdminClientOrThrow();

  const membershipResult = await supabase
    .from("auth_user_team_members")
    .select("id, status")
    .eq("team_id", input.teamId)
    .eq("invited_discord_user_id", input.discordUserId)
    .eq("status", "pending")
    .maybeSingle<{ id: number; status: TeamMembershipStatus }>();

  if (membershipResult.error) {
    throw new Error(membershipResult.error.message);
  }

  if (!membershipResult.data) {
    throw new Error("Convite nao encontrado ou ja respondido.");
  }

  const updateResult = await supabase
    .from("auth_user_team_members")
    .update({
      invited_auth_user_id: input.authUserId,
      status: "accepted",
      accepted_at: new Date().toISOString(),
    })
    .eq("id", membershipResult.data.id);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }

  return membershipResult.data.id;
}

export async function assertTeamPermission(teamId: number, authUserId: number, requiredPermission: TeamRolePermission) {
  const supabase = getSupabaseAdminClientOrThrow();
  
  const teamCheck = await supabase
    .from("auth_user_teams")
    .select("owner_user_id")
    .eq("id", teamId)
    .single();
    
  if (teamCheck.error) throw new Error("Equipe nao encontrada.");
  if (teamCheck.data.owner_user_id === authUserId) return true; // Owner has all permissions
  
  const memberCheck = await supabase
    .from("auth_user_team_members")
    .select("role_id, custom_permissions, status")
    .eq("team_id", teamId)
    .eq("invited_auth_user_id", authUserId)
    .maybeSingle();

  if (!memberCheck.data || memberCheck.data.status !== "accepted") {
    throw new Error("Voce nao e membro desta equipe.");
  }
  
  const perms = new Set<string>(
    Array.isArray(memberCheck.data.custom_permissions) ? memberCheck.data.custom_permissions : []
  );

  if (memberCheck.data.role_id) {
    const roleCheck = await supabase
      .from("auth_user_team_roles")
      .select("permissions")
      .eq("id", memberCheck.data.role_id)
      .single();
      
    if (roleCheck.data && Array.isArray(roleCheck.data.permissions)) {
      roleCheck.data.permissions.forEach(p => perms.add(p));
    }
  }

  if (!perms.has(requiredPermission)) {
    throw new Error("Sem permissao necessaria para esta acao.");
  }
  
  return true;
}

