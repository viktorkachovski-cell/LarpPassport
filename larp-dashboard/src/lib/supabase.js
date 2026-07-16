import { createClient } from '@supabase/supabase-js'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

// The join_code column is GM-only (column-level grant); select('*') on games
// fails with "permission denied", so every read names its columns. GMs fetch
// the code through the gm_get_join_code RPC.
export const GAME_COLUMNS =
  'id, gm_id, name, template, location_visibility, status, purge_after_days, created_at'
