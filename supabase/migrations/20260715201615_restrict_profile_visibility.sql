-- profiles were readable by every authenticated user, allowing global
-- username enumeration. Visibility is now limited to the caller's own
-- profile and profiles of users who share at least one game. The helper is
-- security definer (matching is_game_member and friends) so the policy does
-- not recurse into game_players RLS.
create function private.shares_game_with(p_viewer uuid, p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_viewer is not null and exists (
    select 1
    from public.game_players mine
    join public.game_players theirs on theirs.game_id = mine.game_id
    where mine.profile_id = p_viewer
      and theirs.profile_id = p_other
  );
$$;

revoke all on function private.shares_game_with(uuid, uuid) from public, anon;
grant execute on function private.shares_game_with(uuid, uuid) to authenticated;

drop policy profiles_select_authenticated on public.profiles;
create policy profiles_select_shared_game
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or private.shares_game_with((select auth.uid()), id)
  );
