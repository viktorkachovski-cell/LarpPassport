function requireConfig(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const SUPABASE_URL = requireConfig(
  'EXPO_PUBLIC_SUPABASE_URL',
  process.env.EXPO_PUBLIC_SUPABASE_URL,
)
export const SUPABASE_PUBLISHABLE_KEY = requireConfig(
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
)
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? ''
