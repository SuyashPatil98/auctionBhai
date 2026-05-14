-- Auto-create a `public.profiles` row whenever a new `auth.users` row
-- appears (i.e. on successful sign-up).
--
-- This trigger lives outside of drizzle-kit's managed schema (it touches
-- the auth schema), so it must be applied manually via the Supabase SQL
-- editor. Run this file once, then it stays.
--
-- Idempotent: re-running drops + recreates the function and trigger.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  desired_handle text := lower(coalesce(meta->>'handle', split_part(new.email, '@', 1)));
  final_handle text := desired_handle;
  collision_count int := 0;
begin
  -- Ensure handle uniqueness; append _2, _3, ... on collision.
  while exists (select 1 from public.profiles where handle = final_handle) loop
    collision_count := collision_count + 1;
    final_handle := desired_handle || '_' || collision_count;
  end loop;

  insert into public.profiles (id, handle, display_name, team_name, team_emoji)
  values (
    new.id,
    final_handle,
    coalesce(nullif(meta->>'display_name', ''), split_part(new.email, '@', 1)),
    nullif(meta->>'team_name', ''),
    nullif(meta->>'team_emoji', '')
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
