-- The hunt UI keys entirely on character names, but characters were the one
-- roster surface not locked during an active round: a living participant
-- could rename their character (confusing or impersonating for their hunter)
-- or delete and recreate it (breaking target display and restore paths).
-- Non-GM name changes and deletes of a living participant's character are now
-- blocked while the round is active. Field/faction edits stay allowed and
-- keep flowing through the existing validation trigger.
create function private.protect_active_hunt_characters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_game uuid;
  affected_user uuid;
  affected_is_npc boolean;
  caller uuid := auth.uid();
begin
  if tg_op = 'DELETE' then
    affected_game := old.game_id;
    affected_user := old.user_id;
    affected_is_npc := old.is_npc;
  else
    affected_game := new.game_id;
    affected_user := new.user_id;
    affected_is_npc := new.is_npc;
  end if;

  if affected_is_npc
     or caller is null
     or private.is_game_gm(affected_game, caller)
     or not exists (
       select 1
       from private.hunt_rounds round
       join private.hunt_players player
         on player.game_id = round.game_id
        and player.profile_id = affected_user
       where round.game_id = affected_game
         and round.status = 'active'
         and player.state = 'alive'
     ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using errcode = '55000',
      message = 'characters cannot be deleted while the hunt is active';
  elsif new.name is distinct from old.name then
    raise exception using errcode = '55000',
      message = 'character names are locked while the hunt is active';
  end if;
  return new;
end;
$$;

create trigger characters_protect_active_hunt
  before update or delete on public.characters
  for each row execute function private.protect_active_hunt_characters();

revoke all on function private.protect_active_hunt_characters()
  from public, anon, authenticated;
