begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

-- PostgreSQL grants EXECUTE on new functions to PUBLIC unless the owning role
-- has a global default ACL that revokes it.
select extensions.ok(
  exists (
    select 1
    from pg_default_acl d
    join pg_roles owner_role on owner_role.oid = d.defaclrole
    where owner_role.rolname = 'postgres'
      and d.defaclnamespace = 0
      and d.defaclobjtype = 'f'
  )
  and not exists (
    select 1
    from pg_default_acl d
    join pg_roles owner_role on owner_role.oid = d.defaclrole
    cross join lateral aclexplode(d.defaclacl) acl
    where owner_role.rolname = 'postgres'
      and d.defaclnamespace = 0
      and d.defaclobjtype = 'f'
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'new postgres-owned functions are not executable by PUBLIC by default'
);

select extensions.ok(
  not exists (
    select 1
    from pg_default_acl d
    join pg_roles owner_role on owner_role.oid = d.defaclrole
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) acl
    join pg_roles grantee_role on grantee_role.oid = acl.grantee
    where owner_role.rolname = 'postgres'
      and n.nspname = 'public'
      and d.defaclobjtype = 'f'
      and grantee_role.rolname in ('anon', 'authenticated')
      and acl.privilege_type = 'EXECUTE'
  ),
  'new public functions require an explicit API-role grant'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anonymous users cannot execute app functions'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and has_function_privilege('public', p.oid, 'EXECUTE')
  ),
  'PUBLIC cannot execute app functions'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  16,
  'the authenticated public RPC surface remains the reviewed 16 functions'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
          not in (
            'get_hunt_admin(g uuid)',
            'get_hunt_status(g uuid)',
            'gm_assign_next_target(g uuid, hunter_id uuid)',
            'gm_eliminate_player(g uuid, victim_id uuid)',
            'gm_get_join_code(g uuid)',
            'gm_resolve_elimination(claim_id uuid, confirm_elimination boolean)',
            'gm_restore_player(g uuid, profile_id uuid)',
            'gm_set_hunt_chain(g uuid, player_ids uuid[])',
            'ingest_pings(g uuid, pings jsonb, last_seen_seq bigint)',
            'join_game(code text)',
            'request_elimination(g uuid)',
            'reset_hunt(g uuid)',
            'respond_elimination(claim_id uuid, confirm_elimination boolean)',
            'send_gm_message(g uuid, message text)',
            'set_location_consent(g uuid, grant_consent boolean)',
            'start_hunt(g uuid)'
          )
  ),
  'authenticated users have no unreviewed public function grants'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and position('auth.uid()' in p.prosrc) = 0
  ),
  'authenticated security-definer RPCs perform an identity check'
);

select extensions.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  ),
  'security-definer functions use an empty search path'
);

select extensions.ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not coalesce(c.reloptions, '{}'::text[])
        @> array['security_invoker=true']
  ),
  'public views invoke caller RLS'
);

select extensions.is(
  (
    select count(*)::integer
    from information_schema.table_privileges
    where table_schema in ('public', 'private')
      and grantee = 'anon'
  ),
  0,
  'anonymous users have no app table grants'
);

select * from extensions.finish();
rollback;
