-- The existing dashboard can promote game members to GM. Keep that path,
-- but protect the owner and the final GM for Pirate game-night continuity.
create function private.protect_pirate_gm_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.role <> 'gm' or new.role = 'gm' then return new; end if;
  elsif old.role <> 'gm' then
    return old;
  end if;
  if not exists (select 1 from private.pirate_games where game_id = old.game_id)
     or not exists (select 1 from public.games where id = old.game_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if old.profile_id = (select gm_id from public.games where id = old.game_id) then
    raise exception using errcode = '55000', message = 'cannot remove the game owner GM';
  end if;
  if (select count(*) from public.game_players
      where game_id = old.game_id and role = 'gm') <= 1 then
    raise exception using errcode = '55000', message = 'cannot remove the last GM';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.protect_pirate_gm_role() from public, anon, authenticated;
create trigger protect_pirate_gm_role
  before update of role or delete on public.game_players
  for each row execute function private.protect_pirate_gm_role();
