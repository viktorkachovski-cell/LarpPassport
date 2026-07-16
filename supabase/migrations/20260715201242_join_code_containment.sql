-- The join code is a credential, but the blanket SELECT grant on games let
-- every member (including players) read it through the Data API. Replace the
-- table-level SELECT with column-level grants that exclude join_code, and
-- give GMs a dedicated accessor.
--
-- Client impact: selects on games must name columns explicitly; select('*')
-- now fails with "permission denied". Both clients were updated accordingly.
revoke select on public.games from authenticated;
grant select (
  id, gm_id, name, template, location_visibility,
  status, purge_after_days, created_at
) on public.games to authenticated;

create function public.gm_get_join_code(g uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  return (select game.join_code from public.games game where game.id = g);
end;
$$;

revoke all on function public.gm_get_join_code(uuid)
  from public, anon, authenticated;
grant execute on function public.gm_get_join_code(uuid) to authenticated;

comment on function public.gm_get_join_code(uuid) is
  'Returns the join code of a game to its GMs only.';
