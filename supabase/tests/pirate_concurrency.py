"""Pirate multi-connection checks. Runs ONLY in the disposable local CI DB.

Each race parks its contenders behind the game's Pirate advisory lock, then
releases them together, so the requests really arrive at the same moment.
Fixtures extend 019_pirate_captains_and_claim_void.sql: crew 1 is players
1-3, crews 2-6 are players 4-8, zones 1-9 are riddles answered by "gold".
"""
from pathlib import Path
import subprocess
import time

CMD = ['docker', 'exec', '-i', 'supabase_db_LarpPassport', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1']
GAME = '19100000-0000-0000-0000-000000000001'
GM = '19000000-0000-0000-0000-000000000000'


def uid(n): return f'19000000-0000-0000-0000-{n:012d}'
def crew(n): return f'19200000-0000-0000-0000-{n:012d}'
def zone(n): return f'19300000-0000-0000-0000-{n:012d}'


def query(sql):
    result = subprocess.run(CMD, input=sql, text=True, capture_output=True, timeout=20)
    if result.returncode: raise AssertionError(result.stderr)
    return result.stdout.strip()


def as_user(user, sql):
    return f"set local role authenticated; select set_config('request.jwt.claim.sub','{user}',true) is null; {sql}"


def race(requests):
    """Release every (user, sql) at once; return each request's result line."""
    holder = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    holder.stdin.write(f"begin; select pg_advisory_xact_lock(hashtextextended('pirate:{GAME}',0));\n\\echo LOCKED\n")
    holder.stdin.flush()
    while holder.stdout.readline().strip() != 'LOCKED':
        if holder.poll() is not None: raise AssertionError(holder.stderr.read())
    workers = []
    try:
        for user, sql in requests:
            worker = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            worker.stdin.write("set application_name='pirate-race'; begin;" + as_user(user, sql) + "commit;\n")
            worker.stdin.close()
            workers.append(worker)
        deadline = time.monotonic() + 10
        while query("select count(*) from pg_stat_activity where application_name='pirate-race' and wait_event='advisory'") != str(len(workers)):
            if time.monotonic() > deadline: raise AssertionError('Contenders did not all wait on the game lock')
            time.sleep(0.05)
        holder.stdin.write('rollback;\n'); holder.stdin.close(); holder.wait(timeout=10)
        results = []
        for worker in workers:
            worker.wait(timeout=10)
            assert worker.returncode == 0, worker.stderr.read()
            results.append(worker.stdout.read().strip().splitlines()[-1])
        return results
    finally:
        for process in [holder, *workers]:
            if process.poll() is None: process.kill()


def as_gm(sql):
    return query('begin;' + as_user(GM, sql) + 'commit;').splitlines()[-1]


def stand_at(players, site):
    """Fresh positions for the players, inside only riddle `site`."""
    ids = 'array[' + ','.join(f"'{uid(n)}'" for n in players) + ']::uuid[]'
    query(f"""begin;
      delete from private.zone_state where profile_id = any({ids});
      insert into private.zone_state (zone_id, profile_id, inside, inside_since)
      select '{zone(site)}', profile_id, true, now() - interval '1 minute' from unnest({ids}) profile_id;
      insert into public.player_positions (game_id, profile_id, geog, recorded_at)
      select '{GAME}', profile_id, extensions.st_setsrid(extensions.st_makepoint(30, 50.01), 4326)::extensions.geography, now()
      from unnest({ids}) profile_id
      on conflict (game_id, profile_id) do update set recorded_at = excluded.recorded_at;
      commit;""")


def claim(player, idem):
    return uid(player), f"select public.claim_site('{GAME}','gold','19400000-0000-0000-0000-{idem:012d}')->>'status';"


def void(claim_id):
    return GM, f"select public.gm_void_claim('{GAME}','{claim_id}','Concurrent correction')->>'status';"


source = Path('supabase/tests/database/019_pirate_captains_and_claim_void.sql').read_text()
setup = source[source.index('insert into auth.users'):source.index('-- Setup: the GM picks')]
# Extend the known fixture to six crews without changing the pgTAP source.
setup = setup.replace('generate_series(0, 7)', 'generate_series(0, 8)').replace('generate_series(1, 7)', 'generate_series(1, 8)').replace('generate_series(1, 5)', 'generate_series(1, 6)')
query('begin;' + setup + 'commit;')
try:
    assert as_gm(f"select public.pirate_set_captain('{GAME}','{crew(1)}','{uid(2)}')->>'status';") == 'ok'
    phase, captain = race([
        (GM, f"select public.pirate_set_phase('{GAME}','charting',null)->>'status';"),
        (GM, f"select public.pirate_set_captain('{GAME}','{crew(1)}','{uid(3)}')->>'status';"),
    ])
    stored = query(f"select profile_id from private.pirate_captains where game_id='{GAME}' and faction_id='{crew(1)}'")
    assert phase == 'ok' and captain in ('ok', 'locked'), (phase, captain)
    assert stored == (uid(3) if captain == 'ok' else uid(2)), (captain, stored)
    assert query(f"select count(*) from private.pirate_captains where game_id='{GAME}'") == '6'
    print('PASS: a captain change racing charting either lands before the lock or is refused')

    # One player from each crew answers riddle 1 at the same moment.
    stand_at([1, 4, 5, 6, 7, 8], 1)
    assert race([claim(player, player) for player in (1, 4, 5, 6, 7, 8)]) == ['ok'] * 6
    ranks = query(f"select string_agg(rank::text, ',' order by rank) from private.pirate_claims where zone_id='{zone(1)}'")
    payouts = query(f"select string_agg(delta::text, ',' order by delta desc) from private.pirate_ledger ledger join private.pirate_claims claim on claim.id = ledger.ref_id where claim.zone_id='{zone(1)}' and ledger.currency='doubloon'")
    assert ranks == '1,2,3,4,5,6' and payouts == '20,15,10,5,5,5', (ranks, payouts)
    print('PASS: six crews solving at once get distinct ranks and 20/15/10/5/5/5')

    # Three crewmates answer riddle 2 at the same moment: one claim for the crew.
    stand_at([1, 2, 3], 2)
    results = race([claim(player, 10 + player) for player in (1, 2, 3)])
    assert sorted(results) == ['already_claimed', 'already_claimed', 'ok'], results
    assert query(f"select count(*) from private.pirate_claims where zone_id='{zone(2)}'") == '1'
    assert query(f"select sum(ledger.delta) from private.pirate_ledger ledger join private.pirate_claims claim on claim.id = ledger.ref_id where claim.zone_id='{zone(2)}' and ledger.currency='doubloon'") == '20'
    print('PASS: crewmates solving at once credit the crew pool once')

    # Two GM corrections void the same claim at once: one reversal only.
    claim_id = query(f"select id from private.pirate_claims where zone_id='{zone(2)}'")
    assert sorted(race([void(claim_id), void(claim_id)])) == ['already_voided', 'ok']
    assert query(f"select count(*) from private.pirate_ledger where ref_id='{claim_id}' and delta < 0") == '2'
    print('PASS: concurrent voids reverse a claim once')

    # A crewmate re-solves while the GM voids the new claim: never two live claims,
    # and the crew's riddle-2 ledger always matches the claims still standing.
    assert race([claim(2, 20)]) == ['ok']
    claim_id = query(f"select id from private.pirate_claims where zone_id='{zone(2)}' and voided_at is null")
    results = race([void(claim_id), claim(3, 21)])
    assert results[0] == 'ok' and results[1] in ('ok', 'already_claimed'), results
    live = query(f"select count(*) from private.pirate_claims where zone_id='{zone(2)}' and voided_at is null")
    net = query(f"select coalesce(sum(ledger.delta), 0) from private.pirate_ledger ledger join private.pirate_claims claim on claim.id = ledger.ref_id where claim.zone_id='{zone(2)}' and ledger.currency='bearing'")
    assert live == ('1' if results[1] == 'ok' else '0') and net == live, (results, live, net)
    print('PASS: a void racing a re-claim leaves the ledger matching live claims')

    # Parley: two crews join one open code at once, then both players confirm
    # the yield at once. Crew 2 (player 4) holds at least 5 doubloons from riddle 1.
    assert as_gm(f"select public.pirate_set_phase('{GAME}','cursed',null)->>'status';") == 'ok'
    stand_at([4, 5, 6], 3)
    query('begin;' + as_user(uid(4), f"select public.open_parley('{GAME}');") + 'commit;')
    parley_id, code = query(f"select id || '|' || code from private.pirate_parleys where game_id='{GAME}' and state='open'").split('|')
    join = lambda player, idem: (uid(player), f"select public.join_parley('{GAME}','{code}','19400000-0000-0000-0000-{idem:012d}')->>'status';")
    results = race([join(5, 30), join(6, 31)])
    assert results.count('ok') == 1, results
    attacker = 5 if results[0] == 'ok' else 6
    assert query(f"select attacker_profile from private.pirate_parleys where id='{parley_id}'") == uid(attacker)
    print('PASS: two crews joining one Parley code at once produce one attacker')

    query('begin;' + as_user(uid(4), f"select public.parley_choice('{GAME}','{parley_id}','yield');") + 'commit;')
    winner = query(f"select attacker_faction from private.pirate_parleys where id='{parley_id}'")
    report = f"select public.parley_report('{GAME}','{parley_id}','{winner}')->>'state';"
    assert sorted(race([(uid(4), report), (uid(attacker), report)])) == ['awaiting_report', 'resolved']
    assert query(f"select count(*) || ',' || sum(delta) from private.pirate_ledger where ref_id='{parley_id}'") == '2,0'
    print('PASS: simultaneous yield confirmations transfer doubloons once')

    # A separate agreed Fight: identical simultaneous plunder retries must
    # return the same amount and create only one balanced ledger transfer.
    fight_id = '19500000-0000-0000-0000-000000000001'
    query(f"""insert into private.pirate_parleys
      (id, game_id, target_faction, target_profile, attacker_faction, attacker_profile,
       state, choice, winner_faction, code, code_expires_at)
      select '{fight_id}', game_id, target_faction, target_profile, attacker_faction, attacker_profile,
             'awaiting_choice', 'fight', attacker_faction, '9876', now()
      from private.pirate_parleys where id='{parley_id}';""")
    plunder = f"select public.parley_plunder('{GAME}','{fight_id}','doubloon')->>'amount';"
    amounts = race([(uid(attacker), plunder), (uid(attacker), plunder)])
    assert amounts[0] == amounts[1] and int(amounts[0]) > 0, amounts
    assert query(f"select count(*) || ',' || sum(delta) from private.pirate_ledger where ref_id='{fight_id}'") == '2,0'
    print('PASS: simultaneous plunder retries return one original amount and transfer once')

    # Expiry happens during player/GM reads under the same game lock. Two
    # readers observing a timed-out exchange must emit exactly one dispute.
    timeout_id = '19500000-0000-0000-0000-000000000002'
    query(f"""insert into private.pirate_parleys
      (id, game_id, target_faction, target_profile, attacker_faction, attacker_profile,
       state, choice, code, code_expires_at, updated_at)
      select '{timeout_id}', game_id, target_faction, target_profile, attacker_faction, attacker_profile,
             'fighting', 'fight', '9877', now(), now()-interval '301 seconds'
      from private.pirate_parleys where id='{fight_id}';""")
    race([(GM, f"select public.gm_pirate_overview('{GAME}') is not null;"),
          (uid(4), f"select public.get_pirate_state('{GAME}') is not null;")])
    assert query(f"select state from private.pirate_parleys where id='{timeout_id}'") == 'disputed'
    assert query(f"select count(*) from public.game_events where game_id='{GAME}' and type='pirate_dispute' and payload->>'parley_id'='{timeout_id}'") == '1'
    print('PASS: simultaneous player/GM status sweeps create one timeout dispute')
finally:
    query(f"delete from public.games where id='{GAME}';")
    query("delete from auth.users where id::text like '19000000-0000-0000-0000-%';")
