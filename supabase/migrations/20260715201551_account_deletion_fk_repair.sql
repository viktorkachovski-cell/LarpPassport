-- Deleting an auth user cascades into profiles, but several columns
-- referenced profiles with NO ACTION, so account deletion failed for anyone
-- who ever owned a character or appeared in hunt history. Attribution
-- columns now SET NULL; hunt claims (meaningless without their
-- participants) cascade instead.
--
-- Deliberately unchanged:
--   * games.gm_id still blocks deletion — a GM must delete or hand off their
--     games first rather than silently orphaning a live game.
--   * hunt_players self-references (target/pending target) still block
--     deleting an account that is actively targeted mid-round; finished
--     rounds have no live targets, so post-game deletion works.

-- Attribution columns must be allowed to become null.
alter table public.characters alter column user_id drop not null;
alter table private.hunt_rounds alter column started_by drop not null;

-- Replace profile foreign keys, discovering current constraint names rather
-- than assuming them.
do $$
declare
  target record;
  existing_name text;
  new_name text;
begin
  for target in
    select * from (values
      ('public.characters',    'user_id',       'set null'),
      ('private.hunt_rounds',  'started_by',    'set null'),
      ('private.hunt_rounds',  'winner_id',     'set null'),
      ('private.hunt_players', 'eliminated_by', 'set null'),
      ('private.hunt_claims',  'hunter_id',     'cascade'),
      ('private.hunt_claims',  'victim_id',     'cascade'),
      ('private.hunt_claims',  'response_by',   'set null')
    ) as t(tbl, col, on_delete)
  loop
    select con.conname into existing_name
    from pg_constraint con
    where con.contype = 'f'
      and con.conrelid = target.tbl::regclass
      and con.confrelid = 'public.profiles'::regclass
      and array_length(con.conkey, 1) = 1
      and (
        select att.attname
        from pg_attribute att
        where att.attrelid = con.conrelid and att.attnum = con.conkey[1]
      ) = target.col;

    if existing_name is null then
      raise exception 'expected profiles foreign key on %.% was not found',
        target.tbl, target.col;
    end if;

    new_name := regexp_replace(target.tbl, '^[^.]+\.', '')
      || '_' || target.col || '_fkey';
    execute format(
      'alter table %s drop constraint %I', target.tbl, existing_name
    );
    execute format(
      'alter table %s add constraint %I foreign key (%I)
         references public.profiles(id) on delete %s',
      target.tbl, new_name, target.col, target.on_delete
    );
  end loop;
end;
$$;

-- Relax lifecycle checks that required the attribution columns to stay
-- non-null forever. Timestamps still enforce the lifecycle.
do $$
declare
  target record;
  existing_name text;
begin
  for target in
    select * from (values
      ('private.hunt_rounds',  '%winner_id is not null%'),
      ('private.hunt_players', '%eliminated_by is not null%'),
      ('private.hunt_claims',  '%response_by is not null%')
    ) as t(tbl, def_pattern)
  loop
    select con.conname into existing_name
    from pg_constraint con
    where con.contype = 'c'
      and con.conrelid = target.tbl::regclass
      and pg_get_constraintdef(con.oid) ilike target.def_pattern;

    if existing_name is null then
      raise exception 'expected check constraint on % was not found', target.tbl;
    end if;

    execute format(
      'alter table %s drop constraint %I', target.tbl, existing_name
    );
  end loop;
end;
$$;

alter table private.hunt_rounds add constraint hunt_rounds_lifecycle_check check (
  (status = 'active' and winner_id is null and finished_at is null)
  or (status = 'finished' and finished_at is not null)
);
alter table private.hunt_players add constraint hunt_players_lifecycle_check check (
  (state = 'alive' and eliminated_at is null and eliminated_by is null)
  or (state = 'eliminated' and eliminated_at is not null)
);
alter table private.hunt_claims add constraint hunt_claims_response_check check (
  (status = 'pending' and responded_at is null and response_by is null)
  or (status <> 'pending' and responded_at is not null)
);

-- The SET NULL on characters.user_id is an UPDATE, which runs the character
-- validation trigger. That trigger re-validates fields against the game
-- template, so a template edited since the character was written could make
-- account deletion fail on unrelated validation. System-context attribution
-- updates that change neither fields nor name now skip validation.
create or replace function private.validate_character_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_stats jsonb;
  stat jsonb;
  stat_definition jsonb;
  field_key text;
  caller uuid := auth.uid();
  caller_is_gm boolean;
  previous_fields jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE'
     and caller is null
     and new.fields is not distinct from old.fields
     and new.name is not distinct from old.name then
    return new;
  end if;

  select coalesce(g.template->'stats', '[]'::jsonb)
    into template_stats
  from public.games g
  where g.id = new.game_id;

  template_stats := coalesce(template_stats, '[]'::jsonb);
  caller_is_gm := caller is null or private.is_game_gm(new.game_id, caller);
  new.fields := coalesce(new.fields, '{}'::jsonb);

  if new.faction_id is not null and not exists (
    select 1 from public.factions f
    where f.id = new.faction_id and f.game_id = new.game_id
  ) then
    raise exception using errcode = '23514', message = 'faction must belong to the character game';
  end if;

  for stat in select value from jsonb_array_elements(template_stats) loop
    field_key := stat->>'key';
    if field_key is not null and not (new.fields ? field_key) and stat ? 'default' then
      new.fields := jsonb_set(new.fields, array[field_key], stat->'default');
    end if;
  end loop;

  if tg_op = 'UPDATE' then
    previous_fields := coalesce(old.fields, '{}'::jsonb);
    if not caller_is_gm and (
      new.user_id is distinct from old.user_id
      or new.game_id is distinct from old.game_id
      or new.is_npc is distinct from old.is_npc
      or new.faction_id is distinct from old.faction_id
    ) then
      raise exception using errcode = '42501',
        message = 'only a GM can change ownership, game, faction or NPC status';
    end if;
  end if;

  for field_key in select jsonb_object_keys(new.fields) loop
    select value into stat_definition
    from jsonb_array_elements(template_stats)
    where value->>'key' = field_key;

    if stat_definition is null then
      raise exception 'field "%" is not in the game template', field_key;
    end if;

    case stat_definition->>'type'
      when 'number' then
        if jsonb_typeof(new.fields->field_key) <> 'number' then
          raise exception 'field "%" must be a number', field_key;
        end if;
        if stat_definition ? 'min'
           and (new.fields->>field_key)::numeric < (stat_definition->>'min')::numeric then
          raise exception 'field "%" is below its minimum', field_key;
        end if;
        if stat_definition ? 'max'
           and (new.fields->>field_key)::numeric > (stat_definition->>'max')::numeric then
          raise exception 'field "%" is above its maximum', field_key;
        end if;
      when 'text' then
        if jsonb_typeof(new.fields->field_key) <> 'string'
           or char_length(new.fields->>field_key) > 4000 then
          raise exception 'field "%" must be text no longer than 4000 characters', field_key;
        end if;
      when 'boolean' then
        if jsonb_typeof(new.fields->field_key) <> 'boolean' then
          raise exception 'field "%" must be a boolean', field_key;
        end if;
      else
        raise exception 'field "%" has an unsupported type', field_key;
    end case;
  end loop;

  if not caller_is_gm then
    for field_key in
      select jsonb_object_keys(new.fields)
      union
      select jsonb_object_keys(previous_fields)
    loop
      if tg_op = 'INSERT'
         or coalesce(previous_fields->field_key, 'null'::jsonb)
            is distinct from coalesce(new.fields->field_key, 'null'::jsonb) then
        select value into stat_definition
        from jsonb_array_elements(template_stats)
        where value->>'key' = field_key;

        if not coalesce((stat_definition->>'player_editable')::boolean, false)
           and coalesce(new.fields->field_key, 'null'::jsonb)
               is distinct from coalesce(stat_definition->'default', 'null'::jsonb) then
          raise exception 'field "%" is not player-editable', field_key;
        end if;
      end if;
    end loop;
  end if;

  return new;
end;
$$;
