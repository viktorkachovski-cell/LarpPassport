function requireConfig(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const SUPABASE_URL = requireConfig(
  'VITE_SUPABASE_URL',
  import.meta.env.VITE_SUPABASE_URL,
)
export const SUPABASE_PUBLISHABLE_KEY = requireConfig(
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
export const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN ?? ''
