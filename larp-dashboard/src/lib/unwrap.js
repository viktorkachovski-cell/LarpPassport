// Supabase reports failures in the result object; unwrap turns them into
// throws so callers have a single error path.
export function unwrap({ data, error }) {
  if (error) throw error
  return data
}
