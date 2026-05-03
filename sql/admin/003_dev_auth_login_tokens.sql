alter table public.dev_login_attempts
add column if not exists completed_token_encrypted text;
