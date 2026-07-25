-- Pure metadata. Makes index rationale discoverable via \di+ and the Supabase
-- dashboard, so it travels with the schema rather than living only in docs.

comment on index public.zones_geog_idx is
  'INTENTIONALLY RETAINED despite the "unused index" advisor notice. No current '
  'query issues a spatial search against zones: evaluate_zones reaches zones by '
  'game_id and tests each individually, and the near_zone check in ingest_pings '
  'uses a row-dependent distance (250 + radius_m) that PostGIS cannot rewrite '
  'into an index-backed bbox search. Kept as a cheap hedge -- zones is small and '
  'rarely written -- and becomes load-bearing for any genuinely spatial query '
  '(nearest-zone, map viewport, cross-game search). Do not drop without first '
  'confirming no such query exists.';

comment on index public.game_events_game_profile_seq_idx is
  'Serves the event tail piggybacked on EVERY ingest_pings call from every '
  'player. Leading game_id is required by the game-isolation invariant; trailing '
  'seq matches ORDER BY seq ASC natively instead of a backward scan.';

comment on index public.game_events_game_pending_idx is
  'Serves the GM dashboard pending-event poll. Partial on status=''pending'' so '
  'rows leave the index when resolved -- size tracks open queue depth, not total '
  'event history (64 kB vs 9.5 MB on a 240k-event simulation).';

comment on index public.characters_game_id_idx is
  'GM roster read. Must stay UNCONDITIONAL: characters_one_player_per_game_idx '
  'is partial on WHERE NOT is_npc, which excludes NPCs and cannot satisfy the '
  'characters_game_id_fkey constraint check.';
