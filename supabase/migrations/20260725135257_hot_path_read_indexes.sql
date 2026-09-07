-- Hot-path read indexes.
--
-- 1. ingest_pings() piggybacks an event tail on EVERY ping flush from EVERY
--    player, filtering (game_id, profile_id, player_visible) with
--    "seq > last_seen_seq ORDER BY seq ASC LIMIT 10".
--    The existing game_events_profile_visible_idx (profile_id, seq DESC)
--    WHERE player_visible has no game_id, so it walks a player's events across
--    every game they have ever joined and discards the non-matching ones on the
--    heap. Measured on a 240k-row simulation with a player in 12 games: 1,992
--    rows discarded vs 0, and the leading seq column matches the ASC ordering
--    natively instead of requiring a backward scan.
create index if not exists game_events_game_profile_seq_idx
  on public.game_events (game_id, profile_id, seq)
  where player_visible;

-- 2. The GM roster read ("all characters in game X") had no usable index.
--    characters_one_player_per_game_idx is partial on WHERE NOT is_npc, so it
--    excludes GM-created NPCs entirely and Postgres cannot prove the predicate
--    for an unqualified game_id lookup -- the query degrades to a sequential
--    scan over characters in ALL games, evaluating the cost-100
--    private.is_game_gm() RLS predicate per surviving row.
--    This also gives characters_game_id_fkey a non-partial index, so deleting a
--    game no longer sequential-scans characters to enforce the constraint.
create index if not exists characters_game_id_idx
  on public.characters (game_id);
