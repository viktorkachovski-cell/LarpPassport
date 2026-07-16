import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { AppState } from 'react-native'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'

// The join_code column is GM-only (column-level grant); select('*') on games
// fails with "permission denied", so every read names its columns.
export const GAME_COLUMNS =
  'id, gm_id, name, template, location_visibility, status, purge_after_days, created_at'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})
