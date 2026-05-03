create extension if not exists pgcrypto;

create table if not exists public.admin_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id bigint not null references public.auth_users(id) on delete cascade,
  display_name text not null,
  email text,
  avatar_url text,
  department text,
  status text not null default 'pending' check (status in ('active', 'pending', 'disabled', 'suspended')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  disabled_at timestamptz,
  unique (auth_user_id)
);

create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  department text not null,
  description text,
  is_singleton boolean not null default false,
  hierarchy_level integer not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.admin_permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  module_key text not null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  is_system boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.admin_role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission_id uuid not null references public.admin_permissions(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (role_id, permission_id)
);

create table if not exists public.admin_staff_role_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references public.admin_staff_profiles(id) on delete cascade,
  role_id uuid not null references public.admin_roles(id) on delete restrict,
  assigned_by bigint references public.auth_users(id) on delete set null,
  assigned_at timestamptz not null default timezone('utc', now()),
  revoked_by bigint references public.auth_users(id) on delete set null,
  revoked_at timestamptz,
  reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id bigint references public.auth_users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent_hash text,
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high', 'critical')),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  auth_session_id uuid not null references public.auth_sessions(id) on delete cascade,
  auth_user_id bigint not null references public.auth_users(id) on delete cascade,
  staff_profile_id uuid not null references public.admin_staff_profiles(id) on delete cascade,
  ip_hash text,
  user_agent_hash text,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  unique (auth_session_id)
);

create table if not exists public.admin_action_approvals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  target_type text not null,
  target_id text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'review')),
  requested_by bigint references public.auth_users(id) on delete set null,
  reviewed_by bigint references public.auth_users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dev_auth_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id bigint not null references public.auth_users(id) on delete cascade,
  token_hash text not null unique,
  label text,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dev_login_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_token_hash text not null unique,
  poll_token_hash text not null unique,
  auth_token_id uuid references public.dev_auth_tokens(id) on delete set null,
  requested_auth_user_id bigint references public.auth_users(id) on delete set null,
  completed_by_user_id bigint references public.auth_users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'expired', 'revoked')),
  redirect_url text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.test_variable_projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  allowed_environments text[] not null default array['test', 'staging', 'sandbox']::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.test_variable_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.test_variable_projects(id) on delete cascade,
  environment text not null check (environment in ('test', 'staging', 'sandbox')),
  name text not null,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (project_id, environment, name)
);

create table if not exists public.test_variables (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.test_variable_groups(id) on delete cascade,
  key text not null,
  encrypted_value text not null,
  sensitivity_level text not null check (sensitivity_level in ('public', 'internal', 'sensitive', 'critical')),
  description text,
  is_active boolean not null default true,
  created_by bigint references public.auth_users(id) on delete set null,
  updated_by bigint references public.auth_users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  rotated_at timestamptz,
  unique (group_id, key)
);

create table if not exists public.test_variable_access_grants (
  id uuid primary key default gen_random_uuid(),
  auth_user_id bigint not null references public.auth_users(id) on delete cascade,
  project_id uuid not null references public.test_variable_projects(id) on delete cascade,
  environment text not null check (environment in ('test', 'staging', 'sandbox')),
  scope jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired', 'pending')),
  allow_sensitive boolean not null default false,
  allow_critical boolean not null default false,
  created_by bigint references public.auth_users(id) on delete set null,
  revoked_by bigint references public.auth_users(id) on delete set null,
  notes text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dev_ip_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id bigint not null references public.auth_users(id) on delete cascade,
  project_id uuid references public.test_variable_projects(id) on delete set null,
  environment text not null check (environment in ('test', 'staging', 'sandbox')),
  requested_ip_hash text not null,
  encrypted_ip text not null,
  device_name text not null,
  reason text not null,
  notes text,
  requested_scope jsonb not null default '{}'::jsonb,
  requested_expires_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'review')),
  reviewed_by bigint references public.auth_users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dev_ip_allowlist (
  id uuid primary key default gen_random_uuid(),
  auth_user_id bigint not null references public.auth_users(id) on delete cascade,
  project_id uuid references public.test_variable_projects(id) on delete set null,
  environment text not null check (environment in ('test', 'staging', 'sandbox')),
  ip_hash text not null,
  encrypted_ip text not null,
  source_request_id uuid references public.dev_ip_requests(id) on delete set null,
  approved_by bigint references public.auth_users(id) on delete set null,
  approved_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  revoked_by bigint references public.auth_users(id) on delete set null,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.dev_certificates (
  id uuid primary key default gen_random_uuid(),
  auth_user_id bigint not null references public.auth_users(id) on delete cascade,
  certificate_token_hash text not null unique,
  fingerprint text not null unique,
  project_id uuid not null references public.test_variable_projects(id) on delete cascade,
  environment text not null check (environment in ('test', 'staging', 'sandbox')),
  ip_hash text not null,
  scope jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'pending')),
  issued_by bigint references public.auth_users(id) on delete set null,
  issued_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  revoked_by bigint references public.auth_users(id) on delete set null,
  revoked_at timestamptz,
  revocation_reason text,
  last_used_at timestamptz,
  last_used_ip_hash text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.test_variable_read_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id bigint references public.auth_users(id) on delete set null,
  auth_token_id uuid references public.dev_auth_tokens(id) on delete set null,
  certificate_id uuid references public.dev_certificates(id) on delete set null,
  project_id uuid references public.test_variable_projects(id) on delete set null,
  environment text check (environment in ('test', 'staging', 'sandbox')),
  ip_hash text,
  requested_keys jsonb not null default '[]'::jsonb,
  delivered_keys jsonb not null default '[]'::jsonb,
  result text not null check (result in ('allowed', 'blocked', 'partial')),
  block_reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_admin_staff_profiles_status on public.admin_staff_profiles (status);
create index if not exists idx_admin_roles_department on public.admin_roles (department);
create index if not exists idx_admin_permissions_module_key on public.admin_permissions (module_key);
create index if not exists idx_admin_staff_role_assignments_staff_profile_id on public.admin_staff_role_assignments (staff_profile_id);
create index if not exists idx_admin_staff_role_assignments_role_id on public.admin_staff_role_assignments (role_id);
create unique index if not exists idx_admin_staff_role_assignments_active_unique
on public.admin_staff_role_assignments (staff_profile_id, role_id)
where revoked_at is null;
create index if not exists idx_admin_audit_logs_actor_user_id on public.admin_audit_logs (actor_user_id, created_at desc);
create index if not exists idx_admin_audit_logs_action on public.admin_audit_logs (action, created_at desc);
create index if not exists idx_admin_sessions_auth_user_id on public.admin_sessions (auth_user_id, last_seen_at desc);
create index if not exists idx_admin_action_approvals_status on public.admin_action_approvals (status, created_at desc);
create index if not exists idx_dev_auth_tokens_auth_user_id on public.dev_auth_tokens (auth_user_id, created_at desc);
create index if not exists idx_dev_login_attempts_status on public.dev_login_attempts (status, created_at desc);
create index if not exists idx_test_variable_projects_code on public.test_variable_projects (code);
create index if not exists idx_test_variable_groups_project_environment on public.test_variable_groups (project_id, environment);
create index if not exists idx_test_variables_group_id on public.test_variables (group_id);
create index if not exists idx_test_variable_access_grants_scope on public.test_variable_access_grants (auth_user_id, project_id, environment);
create index if not exists idx_dev_ip_requests_status on public.dev_ip_requests (status, created_at desc);
create index if not exists idx_dev_ip_allowlist_active on public.dev_ip_allowlist (auth_user_id, project_id, environment, ip_hash);
create unique index if not exists idx_dev_ip_allowlist_active_unique
on public.dev_ip_allowlist (auth_user_id, project_id, environment, ip_hash)
where revoked_at is null and status = 'active';
create index if not exists idx_dev_certificates_lookup on public.dev_certificates (auth_user_id, project_id, environment, status);
create unique index if not exists idx_test_variable_access_grants_active_unique
on public.test_variable_access_grants (auth_user_id, project_id, environment)
where revoked_at is null and status = 'active';
create index if not exists idx_test_variable_read_logs_project_environment on public.test_variable_read_logs (project_id, environment, created_at desc);

create or replace function public.flowdesk_guard_singleton_admin_role()
returns trigger
language plpgsql
as $$
declare
  singleton_role boolean;
  conflicting_assignment_id uuid;
begin
  if new.revoked_at is not null then
    return new;
  end if;

  select is_singleton
  into singleton_role
  from public.admin_roles
  where id = new.role_id;

  if coalesce(singleton_role, false) = false then
    return new;
  end if;

  select assignment.id
  into conflicting_assignment_id
  from public.admin_staff_role_assignments assignment
  where assignment.role_id = new.role_id
    and assignment.revoked_at is null
    and assignment.id <> coalesce(new.id, gen_random_uuid())
  limit 1;

  if conflicting_assignment_id is not null then
    raise exception 'singleton_admin_role_conflict';
  end if;

  return new;
end;
$$;

drop trigger if exists tr_admin_staff_role_assignments_singleton on public.admin_staff_role_assignments;
create trigger tr_admin_staff_role_assignments_singleton
before insert or update on public.admin_staff_role_assignments
for each row
execute function public.flowdesk_guard_singleton_admin_role();

drop trigger if exists tr_admin_staff_profiles_updated_at on public.admin_staff_profiles;
create trigger tr_admin_staff_profiles_updated_at
before update on public.admin_staff_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists tr_admin_roles_updated_at on public.admin_roles;
create trigger tr_admin_roles_updated_at
before update on public.admin_roles
for each row
execute function public.set_updated_at();

drop trigger if exists tr_admin_permissions_updated_at on public.admin_permissions;
create trigger tr_admin_permissions_updated_at
before update on public.admin_permissions
for each row
execute function public.set_updated_at();

drop trigger if exists tr_admin_action_approvals_updated_at on public.admin_action_approvals;
create trigger tr_admin_action_approvals_updated_at
before update on public.admin_action_approvals
for each row
execute function public.set_updated_at();

drop trigger if exists tr_dev_auth_tokens_updated_at on public.dev_auth_tokens;
create trigger tr_dev_auth_tokens_updated_at
before update on public.dev_auth_tokens
for each row
execute function public.set_updated_at();

drop trigger if exists tr_dev_login_attempts_updated_at on public.dev_login_attempts;
create trigger tr_dev_login_attempts_updated_at
before update on public.dev_login_attempts
for each row
execute function public.set_updated_at();

drop trigger if exists tr_test_variable_projects_updated_at on public.test_variable_projects;
create trigger tr_test_variable_projects_updated_at
before update on public.test_variable_projects
for each row
execute function public.set_updated_at();

drop trigger if exists tr_test_variable_groups_updated_at on public.test_variable_groups;
create trigger tr_test_variable_groups_updated_at
before update on public.test_variable_groups
for each row
execute function public.set_updated_at();

drop trigger if exists tr_test_variables_updated_at on public.test_variables;
create trigger tr_test_variables_updated_at
before update on public.test_variables
for each row
execute function public.set_updated_at();

drop trigger if exists tr_test_variable_access_grants_updated_at on public.test_variable_access_grants;
create trigger tr_test_variable_access_grants_updated_at
before update on public.test_variable_access_grants
for each row
execute function public.set_updated_at();

drop trigger if exists tr_dev_ip_requests_updated_at on public.dev_ip_requests;
create trigger tr_dev_ip_requests_updated_at
before update on public.dev_ip_requests
for each row
execute function public.set_updated_at();

drop trigger if exists tr_dev_ip_allowlist_updated_at on public.dev_ip_allowlist;
create trigger tr_dev_ip_allowlist_updated_at
before update on public.dev_ip_allowlist
for each row
execute function public.set_updated_at();

drop trigger if exists tr_dev_certificates_updated_at on public.dev_certificates;
create trigger tr_dev_certificates_updated_at
before update on public.dev_certificates
for each row
execute function public.set_updated_at();

alter table public.admin_staff_profiles enable row level security;
alter table public.admin_roles enable row level security;
alter table public.admin_permissions enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_staff_role_assignments enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_action_approvals enable row level security;
alter table public.dev_auth_tokens enable row level security;
alter table public.dev_login_attempts enable row level security;
alter table public.test_variable_projects enable row level security;
alter table public.test_variable_groups enable row level security;
alter table public.test_variables enable row level security;
alter table public.test_variable_access_grants enable row level security;
alter table public.dev_ip_requests enable row level security;
alter table public.dev_ip_allowlist enable row level security;
alter table public.dev_certificates enable row level security;
alter table public.test_variable_read_logs enable row level security;
