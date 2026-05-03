-- Flowdesk Admin seed strategy
-- --------------------------------------------
-- 1. The runtime catalog sync implemented in `lib/admin/catalog.ts`
--    inserts every missing system permission, role, and role-permission
--    relation the first time an admin/staff flow is loaded.
-- 2. This SQL file provides the secure bootstrap helper for the first CEO.
-- 3. `FLOWDESK_BOOTSTRAP_ADMIN_EMAIL` remains the preferred bootstrap path
--    because it avoids hardcoding a user email in versioned SQL.

create or replace function public.flowdesk_bootstrap_admin(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  target_user_id bigint;
  target_display_name text;
  target_avatar text;
  ceo_role_id uuid;
  staff_profile_id uuid;
  existing_singleton uuid;
  existing_assignment uuid;
begin
  normalized_email := lower(trim(coalesce(p_email, '')));
  if normalized_email = '' then
    raise exception 'bootstrap_email_required';
  end if;

  select id, display_name, avatar
  into target_user_id, target_display_name, target_avatar
  from public.auth_users
  where lower(coalesce(email, '')) = normalized_email
     or lower(coalesce(email_normalized, '')) = normalized_email
  limit 1;

  if target_user_id is null then
    raise exception 'bootstrap_user_not_found';
  end if;

  select id
  into ceo_role_id
  from public.admin_roles
  where code = 'ceo'
  limit 1;

  if ceo_role_id is null then
    raise exception 'bootstrap_role_missing';
  end if;

  select id
  into existing_singleton
  from public.admin_staff_role_assignments
  where role_id = ceo_role_id
    and revoked_at is null
  limit 1;

  if existing_singleton is not null then
    raise exception 'bootstrap_singleton_already_occupied';
  end if;

  select id
  into staff_profile_id
  from public.admin_staff_profiles
  where auth_user_id = target_user_id
  limit 1;

  if staff_profile_id is null then
    insert into public.admin_staff_profiles (
      auth_user_id,
      display_name,
      email,
      avatar_url,
      department,
      status
    )
    values (
      target_user_id,
      coalesce(target_display_name, 'Flowdesk Staff'),
      normalized_email,
      target_avatar,
      'executive',
      'active'
    )
    returning id into staff_profile_id;
  else
    update public.admin_staff_profiles
       set display_name = coalesce(target_display_name, display_name),
           email = normalized_email,
           avatar_url = coalesce(target_avatar, avatar_url),
           department = 'executive',
           status = 'active',
           disabled_at = null
     where id = staff_profile_id;
  end if;

  select id
  into existing_assignment
  from public.admin_staff_role_assignments assignment
  where assignment.staff_profile_id = staff_profile_id
    and role_id = ceo_role_id
    and revoked_at is null
  limit 1;

  if existing_assignment is null then
    insert into public.admin_staff_role_assignments (
      staff_profile_id,
      role_id,
      assigned_by,
      reason
    )
    values (
      staff_profile_id,
      ceo_role_id,
      target_user_id,
      'sql_bootstrap'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'auth_user_id', target_user_id,
    'staff_profile_id', staff_profile_id,
    'role_code', 'ceo'
  );
end;
$$;

revoke all on function public.flowdesk_bootstrap_admin(text) from public;
