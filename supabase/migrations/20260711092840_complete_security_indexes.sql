-- Corrective migration for already-provisioned clean rebuild targets.
create index if not exists character_changes_changed_by_idx
  on public.character_changes (changed_by)
  where changed_by is not null;

-- Private tables are inaccessible through the Data API; explicit deny policies
-- also make that boundary visible to schema audits.
create policy private_zone_state_deny_clients
  on private.zone_state for all to anon, authenticated
  using (false)
  with check (false);

create policy private_location_pings_deny_clients
  on private.location_pings for all to anon, authenticated
  using (false)
  with check (false);

create policy private_join_attempts_deny_clients
  on private.join_attempts for all to anon, authenticated
  using (false)
  with check (false);
