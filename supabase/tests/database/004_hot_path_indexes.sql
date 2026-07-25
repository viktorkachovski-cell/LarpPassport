begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

-- ---------------------------------------------------------------------------
-- Hot-path indexes exist
-- ---------------------------------------------------------------------------

select extensions.has_index(
  'public',
  'game_events',
  'game_events_game_profile_seq_idx',
  array['game_id', 'profile_id', 'seq'],
  'the ingest_pings event tail is indexed by game, player and sequence'
);

-- Asserted by name only: pgTAP renders DESC columns inconsistently across
-- versions, so the shape is pinned by the predicate assertion further down.
select extensions.has_index(
  'public',
  'game_events',
  'game_events_game_pending_idx',
  'the GM pending-event queue has a dedicated index'
);

select extensions.has_index(
  'public',
  'characters',
  'characters_game_id_idx',
  array['game_id'],
  'the GM roster read is indexed by game'
);

-- ---------------------------------------------------------------------------
-- Partial predicates are load-bearing, not incidental
-- ---------------------------------------------------------------------------

select extensions.is(
  (select pg_get_expr(i.indpred, i.indrelid)
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'game_events_game_profile_seq_idx'),
  'player_visible',
  'the event-tail index only carries rows a player is allowed to see'
);

-- Keeps the index sized to open queue depth rather than total event history.
select extensions.is(
  (select pg_get_expr(i.indpred, i.indrelid)
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'game_events_game_pending_idx'),
  '(status = ''pending''::text)',
  'the pending-queue index drops rows as soon as the GM resolves them'
);

-- A partial index cannot satisfy characters_game_id_fkey unless its predicate
-- is implied by "col = $1", which is false for a predicate like NOT is_npc.
select extensions.is(
  (select i.indpred is null
     from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'characters_game_id_idx'),
  true,
  'the characters game index is unconditional so it also serves the foreign key'
);

-- ---------------------------------------------------------------------------
-- Superseded index stays dropped
-- ---------------------------------------------------------------------------

-- Guards the game-isolation invariant. If a cross-game feature is ever added,
-- this assertion fails and forces a deliberate revisit of the indexing
-- strategy rather than a silent sequential scan on the hottest read path.
select extensions.hasnt_index(
  'public',
  'game_events',
  'game_events_profile_visible_idx',
  'the superseded cross-game event index is not reintroduced'
);

-- ---------------------------------------------------------------------------
-- Regression guards on pre-existing indexes
-- ---------------------------------------------------------------------------

select extensions.has_index(
  'public',
  'game_events',
  'game_events_game_seq_idx',
  'the GM event feed keeps its game and sequence index'
);

select extensions.has_index(
  'public',
  'characters',
  'characters_one_player_per_game_idx',
  'one player character per game is still enforced'
);

select * from extensions.finish();
rollback;
