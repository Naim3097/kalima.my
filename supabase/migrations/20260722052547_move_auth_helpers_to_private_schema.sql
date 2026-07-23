/*
  The signup/role helpers were in `public`, which PostgREST exposes — so each
  SECURITY DEFINER function was reachable at /rest/v1/rpc/<name>. The trigger
  functions must never be callable directly, and set_user_role's exposure is a
  Phase 3 concern (its admin UI does not exist yet). Relocate all five to the
  `private` schema, which PostgREST does not expose. Triggers reference them by
  qualified name; nothing else does.
*/

create function private.handle_new_user_role()
returns trigger language plpgsql security definer set search_path = '' as $$
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

create function private.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
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

create function private.protect_profile_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role and not (select private.is_staff()) then
    new.role = old.role;
  end if;
  return new;
end;
$$;

create function private.sync_role_to_jwt()
returns trigger language plpgsql security definer set search_path = '' as $$
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

create function private.set_user_role(target uuid, new_role public.user_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.is_staff()) then
    raise exception 'not authorized';
  end if;
  update public.profiles set role = new_role where id = target;
end;
$$;

-- Repoint the triggers at the relocated functions.
drop trigger on_auth_user_created_role on auth.users;
create trigger on_auth_user_created_role
  before insert on auth.users
  for each row execute function private.handle_new_user_role();

drop trigger on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function private.handle_new_user_profile();

drop trigger protect_profile_role on profiles;
create trigger protect_profile_role
  before update on profiles
  for each row execute function private.protect_profile_role();

drop trigger sync_role_to_jwt on profiles;
create trigger sync_role_to_jwt
  after update on profiles
  for each row execute function private.sync_role_to_jwt();

-- Drop the exposed public copies.
drop function public.handle_new_user_role();
drop function public.handle_new_user_profile();
drop function public.protect_profile_role();
drop function public.sync_role_to_jwt();
drop function public.set_user_role(uuid, public.user_role);
