-- Pirate riddle and lighthouse sites may use an `auto` zone as well as a
-- `silent` one. An auto zone pushes its message to each player who stands in
-- it for the dwell time, which carries site lore on arrival (owner decision
-- 2026-10-10; set One-shot so it shows once per player). Site presence reads
-- zone_state, so the trigger mode does not affect claims or readings.
-- `gm_confirm` stays refused: it would queue a GM confirmation for every
-- player at every site.

create or replace function public.pirate_set_site(
  g uuid, zone_id uuid, kind text, reward text,
  oath_index smallint, oath_word text, prompt text, answer text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  zone_record record;
  previous_hash text;
  normalized text;
  new_hash text;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or zone_id is null or kind is null then
    raise exception using errcode = '22023', message = 'game, zone and kind are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  if not exists (select 1 from private.pirate_games where game_id = g) then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;
  if (select phase from public.games where id = g) <> 'setup' then
    raise exception using errcode = '55000', message = 'Pirate site setup is closed';
  end if;
  select z.shape, z.trigger_mode, z.zone_type, z.active into zone_record
  from public.zones z where z.id = zone_id and z.game_id = g;
  if not found then
    raise exception using errcode = '22023', message = 'zone is not in this game';
  end if;
  if zone_record.zone_type <> 'event' or not zone_record.active then
    raise exception using errcode = '22023', message = 'Pirate site needs an active event zone';
  end if;
  if kind not in ('riddle', 'lighthouse') then
    raise exception using errcode = '22023', message = 'invalid Pirate site kind';
  end if;
  if zone_record.trigger_mode not in ('silent', 'auto') then
    raise exception using errcode = '22023', message = 'this Pirate site needs a silent or auto zone';
  end if;
  if kind = 'lighthouse' then
    if zone_record.shape <> 'circle' then
      raise exception using errcode = '22023', message = 'lighthouse must be a circle';
    end if;
    if reward is not null or oath_index is not null or oath_word is not null or answer is not null then
      raise exception using errcode = '22023', message = 'a lighthouse has no reward or answer';
    end if;
  else
    if reward is null or reward not in ('bearing', 'oath') then
      raise exception using errcode = '22023', message = 'riddle reward must be bearing or oath';
    end if;
    if reward = 'oath' and (oath_index is null or oath_word is null or pg_catalog.btrim(oath_word) = '') then
      raise exception using errcode = '22023', message = 'oath index and word are required';
    end if;
    if reward = 'bearing' and (oath_index is not null or oath_word is not null) then
      raise exception using errcode = '22023', message = 'bearing riddles cannot contain oath words';
    end if;
    if prompt is null or pg_catalog.btrim(prompt) = '' then
      raise exception using errcode = '22023', message = 'riddle prompt is required';
    end if;
  end if;

  select s.answer_hash into previous_hash from private.pirate_sites s where s.zone_id = pirate_set_site.zone_id;
  if answer is not null then
    if pg_catalog.char_length(answer) > 100 then
      raise exception using errcode = '22023', message = 'answer is too long';
    end if;
    normalized := private.pirate_normalize_answer(answer);
    if normalized = '' then
      raise exception using errcode = '22023', message = 'answer must contain English letters or digits';
    end if;
    new_hash := pg_catalog.encode(extensions.digest(normalized || ':' || zone_id::text, 'sha256'), 'hex');
  elsif kind = 'riddle' then
    new_hash := previous_hash;
  end if;
  if kind = 'riddle' and new_hash is null then
    raise exception using errcode = '22023', message = 'answer is required for this site';
  end if;

  insert into private.pirate_sites (
    zone_id, game_id, kind, reward, oath_index, oath_word, prompt, answer_hash
  ) values (
    zone_id, g, kind, reward, oath_index, oath_word, prompt, new_hash
  ) on conflict on constraint pirate_sites_pkey do update set
    kind = excluded.kind,
    reward = excluded.reward,
    oath_index = excluded.oath_index,
    oath_word = excluded.oath_word,
    prompt = excluded.prompt,
    answer_hash = excluded.answer_hash;
  return pg_catalog.jsonb_build_object('status', 'ok', 'zone_id', zone_id, 'answer_set', new_hash is not null);
end;
$$;
