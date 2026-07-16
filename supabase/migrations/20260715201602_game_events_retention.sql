-- game_events was the only unbounded table on the free tier: the hunt emits
-- one row per participant per broadcast and every ping-driven zone
-- transition adds another. Events of finished games are purged 14 days
-- after they were created; active and draft games keep their full stream.
select cron.schedule(
  'purge-game-events',
  '30 3 * * *',
  $cron$
    delete from public.game_events as event
    using public.games as game
    where game.id = event.game_id
      and game.status = 'finished'
      and event.created_at < now() - interval '14 days'
  $cron$
);
