-- Keep operational data bounded and publish only the tables consumed by clients.
create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid
    from cron.job
    where jobname in (
      'purge-location-pings',
      'purge-finished-game-positions',
      'purge-join-attempts'
    )
  loop
    perform cron.unschedule(existing_job_id);
  end loop;
end;
$$;

select cron.schedule(
  'purge-location-pings',
  '15 3 * * *',
  $cron$
    delete from private.location_pings as ping
    using public.games as game
    where game.id = ping.game_id
      and ping.recorded_at < now() - make_interval(days => game.purge_after_days)
  $cron$
);

select cron.schedule(
  'purge-finished-game-positions',
  '20 3 * * *',
  $cron$
    delete from public.player_positions as position
    using public.games as game
    where game.id = position.game_id
      and game.status = 'finished'
  $cron$
);

select cron.schedule(
  'purge-join-attempts',
  '25 3 * * *',
  $cron$
    delete from private.join_attempts
    where attempted_at < now() - interval '2 days'
  $cron$
);

do $$
declare
  published_table text;
begin
  foreach published_table in array array[
    'characters',
    'game_events',
    'game_players',
    'player_positions',
    'zones'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = published_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        published_table
      );
    end if;
  end loop;
end;
$$;
