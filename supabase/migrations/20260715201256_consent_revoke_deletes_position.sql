-- Revoking location consent previously left the player's last stored
-- position visible until the game finished and the nightly purge ran.
-- Elimination already deletes the latest position; manual revocation now
-- does the same.
create or replace function public.set_location_consent(
  g uuid,
  grant_consent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;

  if grant_consent then
    update public.game_players
    set location_consent_at = now(),
        sharing_enabled = true,
        consent_revoked_at = null
    where game_id = g and profile_id = caller;
  else
    update public.game_players
    set consent_revoked_at = now(),
        sharing_enabled = false
    where game_id = g and profile_id = caller;
  end if;

  if not found then
    raise exception using errcode = '42501', message = 'not a member of this game';
  end if;

  if not grant_consent then
    delete from public.player_positions
    where game_id = g and profile_id = caller;
  end if;

  insert into public.game_events (
    game_id, profile_id, type, status, player_visible
  )
  values (
    g,
    caller,
    case when grant_consent then 'consent_granted' else 'consent_revoked' end,
    'confirmed',
    false
  );
end;
$$;

comment on function public.set_location_consent(uuid, boolean) is
  'Records explicit location consent or revocation; revocation also deletes the latest stored position.';
