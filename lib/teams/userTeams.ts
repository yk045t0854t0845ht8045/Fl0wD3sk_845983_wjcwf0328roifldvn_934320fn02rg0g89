import { getSupabaseAdminClientOrThrow } from "@/lib/supabaseAdmin";

export type TeamMembershipStatus = "pending" | "accepted" | "declined";

export type TeamRolePermission =
  | "manage_servers"
  | "manage_members"
  | "manage_roles"
  | "server_manage_tickets_overview"
  | "server_manage_tickets_message"
  | "server_manage_welcome_overview"
  | "server_manage_welcome_message"
  | "server_manage_antilink"
  | "server_manage_autorole"
  | "server_view_security_logs"
  | "view_audit_logs";

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

export class UserTeamActionError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "UserTeamActionError";
    this.statusCode = statusCode;
  }
}

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

type CacheEntry<TValue> = {
  expiresAt: number;
  value: TValue;
};

type CachedDashboardPermissions = {
  permissions: "full" | TeamRolePermission[];
  isTeamServer: boolean;
};
type CachedUserTeamsSnapshot = {
  teams: UserTeam[];
  pendingInvites: PendingTeamInvite[];
};

const EMPTY_USER_TEAMS_SNAPSHOT: CachedUserTeamsSnapshot = {
  teams: [],
  pendingInvites: [],
};

const ACCEPTED_TEAM_GUILD_IDS_CACHE_TTL_MS = 20_000;
const DASHBOARD_PERMISSIONS_CACHE_TTL_MS = 15_000;
const USER_TEAMS_SNAPSHOT_CACHE_TTL_MS = 20_000;
const acceptedTeamGuildIdsCache = new Map<string, CacheEntry<string[]>>();
const acceptedTeamGuildIdsInflight = new Map<string, Promise<string[]>>();
const userTeamsSnapshotCache = new Map<
  string,
  CacheEntry<CachedUserTeamsSnapshot>
>();
const userTeamsSnapshotInflight = new Map<
  string,
  Promise<CachedUserTeamsSnapshot>
>();
const dashboardPermissionsCache = new Map<
  string,
  CacheEntry<CachedDashboardPermissions>
>();
const dashboardPermissionsInflight = new Map<
  string,
  Promise<{ permissions: Set<TeamRolePermission> | "full"; isTeamServer: boolean }>
>();

function readCacheEntry<TValue>(
  cache: Map<string, CacheEntry<TValue>>,
  key: string,
) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function writeCacheEntry<TValue>(
  cache: Map<string, CacheEntry<TValue>>,
  key: string,
  value: TValue,
  ttlMs: number,
) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function cloneAcceptedTeamGuildIds(value: string[]) {
  return [...value];
}

function buildUserTeamsSnapshotCacheKey(input: {
  authUserId: number;
  discordUserId: string | null;
}) {
  return `${input.authUserId}:${input.discordUserId || "no-discord"}`;
}

function cloneUserTeamsSnapshot(
  value: CachedUserTeamsSnapshot,
): CachedUserTeamsSnapshot {
  return JSON.parse(JSON.stringify(value)) as CachedUserTeamsSnapshot;
}

function isRecoverableUserTeamsStorageError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("auth_user_team") ||
    message.includes("team_members") ||
    message.includes("team_roles") ||
    message.includes("team_servers")
  ) && (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("relationship") ||
    message.includes("column")
  );
}

function toDashboardPermissionsResult(
  value: CachedDashboardPermissions,
): { permissions: Set<TeamRolePermission> | "full"; isTeamServer: boolean } {
  return {
    permissions:
      value.permissions === "full"
        ? "full"
        : new Set<TeamRolePermission>(value.permissions),
    isTeamServer: value.isTeamServer,
  };
}

function cacheDashboardPermissions(
  key: string,
  value: CachedDashboardPermissions,
) {
  writeCacheEntry(
    dashboardPermissionsCache,
    key,
    value,
    DASHBOARD_PERMISSIONS_CACHE_TTL_MS,
  );
  return toDashboardPermissionsResult(value);
}

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
  discordUserId: string | null;
}) {
  const cacheKey = `${input.authUserId}:${input.discordUserId || "no-discord"}`;
  const cached = readCacheEntry(acceptedTeamGuildIdsCache, cacheKey);
  if (cached) {
    return cloneAcceptedTeamGuildIds(cached);
  }

  const inflight = acceptedTeamGuildIdsInflight.get(cacheKey);
  if (inflight) {
    return cloneAcceptedTeamGuildIds(await inflight);
  }

  const loadPromise = (async () => {
    const supabase = getSupabaseAdminClientOrThrow();
    
    // 1. Teams where user is the owner
    const ownedTeamsResult = await supabase
      .from("auth_user_teams")
      .select("id")
      .eq("owner_user_id", input.authUserId);

    // 2. Teams where user is a member
    const membershipsBaseQuery = supabase
      .from("auth_user_team_members")
      .select("team_id")
      .eq("status", "accepted");
    const membershipsResult = input.discordUserId
      ? await membershipsBaseQuery.or(
          `invited_discord_user_id.eq.${input.discordUserId},invited_auth_user_id.eq.${input.authUserId}`,
        )
      : await membershipsBaseQuery.eq("invited_auth_user_id", input.authUserId);

    if (ownedTeamsResult.error) throw new Error(ownedTeamsResult.error.message);
    if (membershipsResult.error) throw new Error(membershipsResult.error.message);

    const teamIds = uniqueStrings([
      ...(ownedTeamsResult.data || []).map((row) => String(row.id)),
      ...(membershipsResult.data || []).map((row) => String(row.team_id)),
    ]).map((value) => Number(value));

    if (!teamIds.length) {
      writeCacheEntry(
        acceptedTeamGuildIdsCache,
        cacheKey,
        [],
        ACCEPTED_TEAM_GUILD_IDS_CACHE_TTL_MS,
      );
      return [];
    }

    const teamServersResult = await supabase
      .from("auth_user_team_servers")
      .select("guild_id")
      .in("team_id", teamIds);

    if (teamServersResult.error) {
      throw new Error(teamServersResult.error.message);
    }

    const guildIds = uniqueStrings(
      (teamServersResult.data || []).map((row) => row.guild_id),
    );
    writeCacheEntry(
      acceptedTeamGuildIdsCache,
      cacheKey,
      guildIds,
      ACCEPTED_TEAM_GUILD_IDS_CACHE_TTL_MS,
    );
    return guildIds;
  })().finally(() => {
    acceptedTeamGuildIdsInflight.delete(cacheKey);
  });

  acceptedTeamGuildIdsInflight.set(cacheKey, loadPromise);
  return cloneAcceptedTeamGuildIds(await loadPromise);
}

export async function getUserTeamsSnapshotForUser(input: {
  authUserId: number;
  discordUserId: string | null;
}) {
  const cacheKey = buildUserTeamsSnapshotCacheKey(input);
  const cached = readCacheEntry(userTeamsSnapshotCache, cacheKey);
  if (cached) {
    return cloneUserTeamsSnapshot(cached);
  }

  const inflight = userTeamsSnapshotInflight.get(cacheKey);
  if (inflight) {
    return cloneUserTeamsSnapshot(await inflight);
  }

  const loadPromise = (async () => {
    try {
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

    const memberInvitesBaseQuery = supabase
      .from("auth_user_team_members")
      .select(
        "id, team_id, invited_discord_user_id, invited_auth_user_id, invited_by_user_id, status, role_id, custom_permissions, accepted_at, created_at",
      );
    const memberInvitesResult = input.discordUserId
      ? await memberInvitesBaseQuery
          .or(
            `invited_discord_user_id.eq.${input.discordUserId},invited_auth_user_id.eq.${input.authUserId}`,
          )
          .returns<TeamMemberRow[]>()
      : await memberInvitesBaseQuery
          .eq("invited_auth_user_id", input.authUserId)
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
        throw new Error(teamServersResult.error.message);
      }

      if (teamMembersResult.error) {
        throw new Error(teamMembersResult.error.message);
      }

      if (teamRolesResult.error) {
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

        const userMembership = teamMembers.find(
          (membership) =>
            membership.team_id === teamId &&
            (membership.invited_auth_user_id === input.authUserId ||
              (input.discordUserId !== null &&
                membership.invited_discord_user_id === input.discordUserId)),
        );
        const userRoleRow = userMembership?.role_id ? rolesById.get(userMembership.role_id) : null;
        const isAdminOrOwner = team.owner_user_id === input.authUserId;

        const effectivePerms = uniqueStrings([
          ...(Array.isArray(userRoleRow?.permissions) ? userRoleRow.permissions : []),
          ...(Array.isArray(userMembership?.custom_permissions) ? userMembership.custom_permissions : []),
        ]) as TeamRolePermission[];

        return {
          id: team.id,
          name: team.name,
          iconKey: normalizeTeamIconKey(team.icon_key || "aurora"),
          role: isAdminOrOwner ? "owner" : "member",
          currentUserPermissions: isAdminOrOwner
            ? [
                "manage_servers", "manage_members", "manage_roles", "view_audit_logs",
                "server_manage_tickets_overview", "server_manage_tickets_message",
                "server_manage_welcome_overview", "server_manage_welcome_message",
                "server_manage_antilink", "server_manage_autorole",
                "server_view_security_logs",
              ] as TeamRolePermission[]
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

      const snapshot = {
        teams,
        pendingInvites,
      } satisfies CachedUserTeamsSnapshot;
      writeCacheEntry(
        userTeamsSnapshotCache,
        cacheKey,
        snapshot,
        USER_TEAMS_SNAPSHOT_CACHE_TTL_MS,
      );
      return snapshot;
    } catch (error) {
      if (!isRecoverableUserTeamsStorageError(error)) {
        throw error;
      }

      writeCacheEntry(
        userTeamsSnapshotCache,
        cacheKey,
        EMPTY_USER_TEAMS_SNAPSHOT,
        USER_TEAMS_SNAPSHOT_CACHE_TTL_MS,
      );
      return EMPTY_USER_TEAMS_SNAPSHOT;
    }
  })().finally(() => {
    userTeamsSnapshotInflight.delete(cacheKey);
  });

  userTeamsSnapshotInflight.set(cacheKey, loadPromise);
  return cloneUserTeamsSnapshot(await loadPromise);
}

function invalidateUserTeamsSnapshotCache(input: {
  authUserId: number;
  discordUserId: string | null;
}) {
  const cacheKey = buildUserTeamsSnapshotCacheKey(input);
  userTeamsSnapshotCache.delete(cacheKey);
  userTeamsSnapshotInflight.delete(cacheKey);
  acceptedTeamGuildIdsCache.delete(cacheKey);
  acceptedTeamGuildIdsInflight.delete(cacheKey);
  for (const permissionsCacheKey of dashboardPermissionsCache.keys()) {
    if (permissionsCacheKey.startsWith(`${input.authUserId}:`)) {
      dashboardPermissionsCache.delete(permissionsCacheKey);
    }
  }
  for (const permissionsInflightKey of dashboardPermissionsInflight.keys()) {
    if (permissionsInflightKey.startsWith(`${input.authUserId}:`)) {
      dashboardPermissionsInflight.delete(permissionsInflightKey);
    }
  }
}

export async function createUserTeamForUser(input: {
  authUserId: number;
  discordUserId: string | null;
  name: string;
  iconKey: string;
  guildIds: string[];
  memberDiscordIds: string[];
}) {
  if (!input.discordUserId) {
    throw new UserTeamActionError(
      "Vincule uma conta Discord antes de criar equipes.",
      400,
    );
  }

  const supabase = getSupabaseAdminClientOrThrow();
  const teamName = parseTeamName(input.name);
  const iconKey = normalizeTeamIconKey(input.iconKey);

  if (!teamName || teamName.length < 3) {
    throw new UserTeamActionError(
      "Escolha um nome de equipe com pelo menos 3 caracteres.",
      400,
    );
  }

  const guildIds = normalizeGuildIds(input.guildIds);
  if (!guildIds.length) {
    throw new UserTeamActionError(
      "Selecione pelo menos um servidor para vincular a equipe.",
      400,
    );
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
    throw new UserTeamActionError(
      "Um ou mais servidores selecionados ja estao vinculados a outra equipe.",
      409,
    );
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
      throw new UserTeamActionError(
        teamServersResult.error.message.includes("duplicate")
          ? "Um ou mais servidores selecionados ja estao vinculados a outra equipe."
          : teamServersResult.error.message,
        teamServersResult.error.message.includes("duplicate") ? 409 : 500,
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

  invalidateUserTeamsSnapshotCache({
    authUserId: input.authUserId,
    discordUserId: input.discordUserId,
  });
  return teamId;
}

export async function acceptUserTeamInviteForUser(input: {
  authUserId: number;
  discordUserId: string | null;
  teamId: number;
}) {
  if (!input.discordUserId) {
    throw new Error("Vincule uma conta Discord antes de aceitar convites de equipe.");
  }

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

  invalidateUserTeamsSnapshotCache({
    authUserId: input.authUserId,
    discordUserId: input.discordUserId,
  });
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

export async function getEffectiveDashboardPermissions(input: {
  authUserId: number;
  guildId: string;
}): Promise<{ permissions: Set<TeamRolePermission> | "full"; isTeamServer: boolean }> {
  const cacheKey = `${input.authUserId}:${input.guildId}`;
  const cached = readCacheEntry(dashboardPermissionsCache, cacheKey);
  if (cached) {
    return toDashboardPermissionsResult(cached);
  }

  const inflight = dashboardPermissionsInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const loadPromise = (async () => {
    const supabase = getSupabaseAdminClientOrThrow();

    // 1. Direct License check (Is the user the person who paid for the bot on this guild?)
    const ownerCheck = await supabase
      .from("auth_user_plan_guilds")
      .select("user_id")
      .eq("guild_id", input.guildId)
      .maybeSingle();
    
    if (ownerCheck.data?.user_id === input.authUserId) {
      return cacheDashboardPermissions(cacheKey, {
        permissions: "full",
        isTeamServer: false,
      });
    }

    // Fallback to legacy orders if not in plan_guilds
    if (!ownerCheck.data) {
      const legacyOwnerCheck = await supabase
        .from("payment_orders")
        .select("user_id")
        .eq("guild_id", input.guildId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
        
      if (legacyOwnerCheck.data?.user_id === input.authUserId) {
        return cacheDashboardPermissions(cacheKey, {
          permissions: "full",
          isTeamServer: false,
        });
      }
    }

    // 2. Team check
    // Find teams that have this guild
    const teamServersResult = await supabase
      .from("auth_user_team_servers")
      .select("team_id")
      .eq("guild_id", input.guildId);

    if (teamServersResult.error) {
      throw new Error(teamServersResult.error.message);
    }

    const teamIds = (teamServersResult.data || []).map((ts) => ts.team_id);
    const isTeamServer = teamIds.length > 0;

    if (!isTeamServer) {
      return cacheDashboardPermissions(cacheKey, {
        permissions: [],
        isTeamServer: false,
      });
    }

    // Check if user is owner of any of these teams
    const teamOwnersResult = await supabase
      .from("auth_user_teams")
      .select("id")
      .in("id", teamIds)
      .eq("owner_user_id", input.authUserId);

    if (teamOwnersResult.error) {
      throw new Error(teamOwnersResult.error.message);
    }
    
    if (teamOwnersResult.data?.length) {
      return cacheDashboardPermissions(cacheKey, {
        permissions: "full",
        isTeamServer: true,
      });
    }

    // Check memberships in these teams
    const membershipsResult = await supabase
      .from("auth_user_team_members")
      .select(`
        role_id,
        custom_permissions,
        auth_user_team_roles (
          permissions
        )
      `)
      .in("team_id", teamIds)
      .eq("invited_auth_user_id", input.authUserId)
      .eq("status", "accepted");

    if (membershipsResult.error) {
      throw new Error(membershipsResult.error.message);
    }

    if (!membershipsResult.data?.length) {
      return cacheDashboardPermissions(cacheKey, {
        permissions: [],
        isTeamServer: true,
      });
    }

    const perms = new Set<TeamRolePermission>();
    for (const m of membershipsResult.data) {
      if (Array.isArray(m.custom_permissions)) {
        const customPermissions = m.custom_permissions.filter(
          (permission): permission is TeamRolePermission =>
            typeof permission === "string",
        );
        customPermissions.forEach((permission) => perms.add(permission));
      }
      const roleData =
        m.auth_user_team_roles as unknown as { permissions: TeamRolePermission[] } | null;
      if (roleData && Array.isArray(roleData.permissions)) {
        roleData.permissions.forEach((p: TeamRolePermission) => perms.add(p));
      }
    }

    return cacheDashboardPermissions(cacheKey, {
      permissions: [...perms],
      isTeamServer: true,
    });
  })().finally(() => {
    dashboardPermissionsInflight.delete(cacheKey);
  });

  dashboardPermissionsInflight.set(cacheKey, loadPromise);
  return loadPromise;
}

/**
 * Returns a set of guild IDs that are linked to ANY team.
 */
export async function getGlobalTeamLinkedGuildIds(guildIds: string[]): Promise<Set<string>> {
  if (guildIds.length === 0) return new Set();

  const supabase = getSupabaseAdminClientOrThrow();
  const { data } = await supabase
    .from("auth_user_team_servers")
    .select("guild_id")
    .in("guild_id", guildIds);

  return new Set((data || []).map(row => row.guild_id));
}

