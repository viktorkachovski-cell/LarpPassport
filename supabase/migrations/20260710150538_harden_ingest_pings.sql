create or replace function public.ingest_pings(
  g uuid,
  pings jsonb,
  last_seen_seq bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ok boolean;
  p jsonb;
  ping_index integer := 0;
  batch_size integer;
  n integer := 0;
  cur_lat double precision;
  cur_lng double precision;
  cur_geog geography;
  cur_acc real;
  cur_rec timestamptz;
  cur_batt real;
  near_zone boolean := false;
  ev_json jsonb := '[]'::jsonb;
  max_seq bigint;
begin
  if uid is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;

  if jsonb_typeof(pings) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'pings must be a JSON array';
  end if;

  batch_size := jsonb_array_length(pings);
  if batch_size < 1 or batch_size > 500 then
    raise exception using errcode = '22023', message = 'pings must contain between 1 and 500 points';
  end if;
  if octet_length(pings::text) > 262144 then
    raise exception using errcode = '22023', message = 'pings payload exceeds 256 KiB';
  end if;
  if last_seen_seq is not null and last_seen_seq < 0 then
    raise exception using errcode = '22023', message = 'last_seen_seq cannot be negative';
  end if;

  select gp.sharing_enabled
         and gp.location_consent_at is not null
         and (gp.consent_revoked_at is null or gp.consent_revoked_at < gp.location_consent_at)
         and gm.status = 'active'
    into ok
  from public.game_players gp
  join public.games gm on gm.id = gp.game_id
  where gp.game_id = g and gp.profile_id = uid;

  if not coalesce(ok, false) then
    return jsonb_build_object('accepted', 0, 'reason', 'no_active_consent_or_game');
  end if;

  -- Validate the full trail before writing anything so malformed batches are atomic.
  for p in select value from jsonb_array_elements(pings) as item(value) loop
    ping_index := ping_index + 1;
    if jsonb_typeof(p) is distinct from 'object' then
      raise exception using errcode = '22023', message = format('ping %s must be an object', ping_index);
    end if;

    begin
      cur_lat := (p->>'lat')::double precision;
      cur_lng := (p->>'lng')::double precision;
      cur_acc := nullif(p->>'accuracy', '')::real;
      cur_rec := (p->>'recorded_at')::timestamptz;
      cur_batt := nullif(p->>'battery', '')::real;
    exception
      when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
        raise exception using errcode = '22023', message = format('ping %s contains an invalid value', ping_index);
    end;

    if cur_lat is null or cur_lat::text in ('NaN', 'Infinity', '-Infinity')
       or cur_lat < -90 or cur_lat > 90 then
      raise exception using errcode = '22023', message = format('ping %s latitude is out of range', ping_index);
    end if;
    if cur_lng is null or cur_lng::text in ('NaN', 'Infinity', '-Infinity')
       or cur_lng < -180 or cur_lng > 180 then
      raise exception using errcode = '22023', message = format('ping %s longitude is out of range', ping_index);
    end if;
    if cur_acc is not null and (
      cur_acc::text in ('NaN', 'Infinity', '-Infinity') or cur_acc < 0 or cur_acc > 10000
    ) then
      raise exception using errcode = '22023', message = format('ping %s accuracy is out of range', ping_index);
    end if;
    if cur_batt is not null and (
      cur_batt::text in ('NaN', 'Infinity', '-Infinity') or cur_batt < 0 or cur_batt > 100
    ) then
      raise exception using errcode = '22023', message = format('ping %s battery is out of range', ping_index);
    end if;
    if cur_rec is null or not isfinite(cur_rec)
       or cur_rec < now() - interval '24 hours'
       or cur_rec > now() + interval '5 minutes' then
      raise exception using errcode = '22023', message = format('ping %s timestamp is outside the accepted window', ping_index);
    end if;
  end loop;

  cur_batt := null;
  for p in
    select value
    from jsonb_array_elements(pings) as item(value)
    order by (value->>'recorded_at')::timestamptz asc
  loop
    cur_lat := (p->>'lat')::double precision;
    cur_lng := (p->>'lng')::double precision;
    cur_geog := st_setsrid(st_makepoint(cur_lng, cur_lat), 4326)::geography;
    cur_acc := nullif(p->>'accuracy', '')::real;
    cur_rec := (p->>'recorded_at')::timestamptz;
    cur_batt := coalesce(nullif(p->>'battery', '')::real, cur_batt);

    insert into public.location_pings (game_id, profile_id, geog, accuracy_m, recorded_at)
    values (g, uid, cur_geog, cur_acc, cur_rec);
    perform public.evaluate_zones(g, uid, cur_geog, cur_rec);
    n := n + 1;
  end loop;

  insert into public.player_positions (
    game_id, profile_id, geog, accuracy_m, recorded_at, battery_pct, updated_at
  )
  values (g, uid, cur_geog, cur_acc, cur_rec, cur_batt, now())
  on conflict (game_id, profile_id) do update
    set geog = excluded.geog,
        accuracy_m = excluded.accuracy_m,
        recorded_at = excluded.recorded_at,
        battery_pct = excluded.battery_pct,
        updated_at = now();

  select exists (
    select 1
    from public.zones z
    where z.game_id = g
      and z.active
      and st_dwithin(cur_geog, z.geog, 250 + coalesce(z.radius_m, 0))
  ) into near_zone;

  if last_seen_seq is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', e.id,
             'seq', e.seq,
             'type', e.type,
             'payload', e.payload,
             'created_at', e.created_at
           ) order by e.seq), '[]'::jsonb),
           max(e.seq)
      into ev_json, max_seq
    from (
      select *
      from public.game_events
      where game_id = g
        and profile_id = uid
        and player_visible
        and seq > last_seen_seq
      order by seq asc
      limit 10
    ) e;
  end if;

  return jsonb_build_object(
    'accepted', n,
    'profile', jsonb_build_object(
      'mode', case when near_zone then 'near' else 'far' end,
      'interval_s', case when near_zone then 15 else 60 end,
      'accuracy', case when near_zone then 'high' else 'balanced' end
    ),
    'events', ev_json,
    'latest_seq', max_seq
  );
end;
$$;

comment on function public.ingest_pings(uuid, jsonb, bigint) is
  'Accepts at most 500 validated location points from the authenticated, consenting player.';

revoke execute on function public.ingest_pings(uuid, jsonb, bigint) from public, anon;
grant execute on function public.ingest_pings(uuid, jsonb, bigint) to authenticated;
