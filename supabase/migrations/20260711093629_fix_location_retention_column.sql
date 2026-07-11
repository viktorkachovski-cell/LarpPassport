-- Replace the hosted job created with the legacy column name.
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
