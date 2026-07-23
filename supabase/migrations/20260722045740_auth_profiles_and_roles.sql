/*
  Phase 0 — auth: profiles, roles, and the signup pipeline.

  Role authority lives in the JWT's app_metadata.role claim (what
  private.is_staff() reads). profiles.role is the human-editable mirror;
  triggers keep the two in sync. Roles are set server-side only — a customer
  can never elevate themselves (protect_profile_role below).

  Note: SECURITY DEFINER functions pin search_path = '', so every type and
  table inside their bodies is schema-qualified.
*/

create type user_role as enum ('customer', 'staff', 'admin', 'affiliate');

create table profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text,
  phone             text,          -- E.164 for WhatsApp (Phase 5)
  role              user_role not null default 'customer',
  marketing_consent boolean not null default false,  -- PDPA (Phase 5)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table profiles enable row level security;

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create table role_grants (
  email      text primary key,
  role       user_role not null,
  created_at timestamptz not null default now()
);

alter table role_grants enable row level security;

create function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  granted public.user_role;
begin
  select rg.role into granted from public.role_grants rg where rg.email = new.email;
  new.raw_app_meta_data =
    coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('role', coalesce(granted, 'customer')::text);
  return new;
end;
$$;

create trigger on_auth_user_created_role
  before insert on auth.users
  for each row execute function public.handle_new_user_role();

create function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, role, marketing_consent)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'customer'),
    coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false)
  );
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

create function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and not (select private.is_staff()) then
    new.role = old.role;
  end if;
  return new;
end;
$$;

create trigger protect_profile_role
  before update on profiles
  for each row execute function public.protect_profile_role();

create function public.sync_role_to_jwt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    update auth.users
    set raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', new.role::text)
    where id = new.id;
  end if;
  return new;
end;
$$;

create trigger sync_role_to_jwt
  after update on profiles
  for each row execute function public.sync_role_to_jwt();

create function public.set_user_role(target uuid, new_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_staff()) then
    raise exception 'not authorized';
  end if;
  update public.profiles set role = new_role where id = target;
end;
$$;

grant select, update on profiles to authenticated;
grant select, insert, update, delete on role_grants to authenticated;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated;

revoke all on profiles from anon;
revoke all on role_grants from anon;

create policy "users read own profile, staff read all"
  on profiles for select
  using ((select auth.uid()) = id or (select private.is_staff()));

create policy "users update own profile"
  on profiles for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "staff manage all profiles"
  on profiles for all
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

create policy "staff manage role_grants"
  on role_grants for all
  using ((select private.is_staff()))
  with check ((select private.is_staff()));
