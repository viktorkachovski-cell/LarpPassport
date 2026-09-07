-- Existing locked fields are controlled by the GM, including resets to defaults.
-- Defaults remain allowed on character creation and for newly added template fields.
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
           and (
             (tg_op = 'UPDATE' and previous_fields ? field_key)
             or coalesce(new.fields->field_key, 'null'::jsonb)
                is distinct from coalesce(stat_definition->'default', 'null'::jsonb)
           ) then
          raise exception 'field "%" is not player-editable', field_key;
        end if;
      end if;
    end loop;
  end if;

  return new;
end;
$$;
