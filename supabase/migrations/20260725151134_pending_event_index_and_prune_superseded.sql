-- GM dashboard polls the pending-event queue:
--   where game_id = $1 and status = 'pending' order by seq desc
-- Partial on status='pending' keeps this index tiny and self-cleaning: a row
-- leaves the index the moment the GM confirms or dismisses it, so the index
-- size tracks the open queue depth rather than total event history.
-- seq is the canonical ordering column in this schema and is co-monotonic with
-- created_at, so this also serves an ORDER BY created_at variant (the pending
-- set is small enough that any residual sort is free).
--
-- Measured on a 240k-event simulation: 9.35 ms scanning 20,000 non-pending rows
-- via the general (game_id, seq DESC) index, versus 0.013 ms and 0 discarded
-- rows here. Index size 64 kB versus 9.5 MB.
create index if not exists game_events_game_pending_idx
  on public.game_events (game_id, seq desc)
  where status = 'pending';

-- Drop the superseded profile-scoped index.
-- game_events_profile_visible_idx (profile_id, seq DESC) WHERE player_visible
-- existed to serve cross-game "all my visible events" reads. Games are
-- self-contained -- no query spans games -- so every real access path is
-- game-scoped and is now covered by game_events_game_profile_seq_idx
-- (game_id, profile_id, seq) WHERE player_visible, which is strictly better for
-- those reads. Keeping both only taxed writes on the hottest write table.
drop index if exists public.game_events_profile_visible_idx;
