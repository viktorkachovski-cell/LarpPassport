-- Keep newly-created functions closed to API callers until a migration grants
-- EXECUTE deliberately. This changes defaults only; existing RPC privileges
-- and gameplay behavior are untouched.
--
-- The global PUBLIC revoke is required for non-public schemas too. PostgreSQL's
-- built-in function default grants EXECUTE to PUBLIC, and a schema-scoped
-- revoke cannot override that global default.
alter default privileges for role postgres
  revoke execute on functions from public;

-- Supabase's legacy public-schema defaults grant these API roles explicitly,
-- so remove those grants in addition to the global PUBLIC grant above.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
