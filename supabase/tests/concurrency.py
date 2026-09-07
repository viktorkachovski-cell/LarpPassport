"""Multi-connection regression checks. Runs ONLY in the disposable local CI DB."""
from pathlib import Path
import subprocess
import time

CMD = ['docker', 'exec', '-i', 'supabase_db_LarpPassport', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1']
GAME = '91000000-0000-0000-0000-000000000001'
PLAYER = '82000000-0000-0000-0000-000000000002'
GM = '81000000-0000-0000-0000-000000000001'

def query(sql):
    result = subprocess.run(CMD, input=sql, text=True, capture_output=True, timeout=20)
    if result.returncode: raise AssertionError(result.stderr)
    return result.stdout.strip()

def auth(uid):
    return f"set local role authenticated; select set_config('request.jwt.claim.sub','{uid}',true);"

def contender(sql):
    return subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True), sql

def race(mutation, request, expected):
    holder = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    holder.stdin.write(f"begin; select pg_advisory_xact_lock(hashtextextended('hunt:{GAME}',0));\n\\echo LOCKED\n")
    holder.stdin.flush()
    while holder.stdout.readline().strip() != 'LOCKED':
        if holder.poll() is not None:
            raise AssertionError(holder.stderr.read())
    worker, sql = contender(request)
    worker.stdin.write("set application_name='larp-race'; begin;" + sql + "commit;\n")
    worker.stdin.close()
    try:
        deadline = time.monotonic() + 10
        while query("select count(*) from pg_stat_activity where application_name='larp-race' and wait_event='advisory'") != '1':
            if worker.poll() is not None or time.monotonic() > deadline:
                raise AssertionError('Contender did not wait on the game lock: ' + worker.stderr.read())
            time.sleep(0.05)
        holder.stdin.write(mutation + "commit;\n")
        holder.stdin.close()
        holder.wait(timeout=10)
        worker.wait(timeout=10)
        output, error = worker.stdout.read(), worker.stderr.read()
        assert holder.returncode == 0, holder.stderr.read()
        assert worker.returncode == 0, error
        assert expected in output, output
    finally:
        if holder.poll() is None: holder.kill()
        if worker.poll() is None: worker.kill()

source = Path('supabase/tests/database/005_tracking_and_delivery.sql').read_text()
setup = source[source.index('insert into auth.users'):source.index('-- Oldest ten')]
query('begin;' + setup + 'commit;')
ping = f"select public.ingest_pings('{GAME}',jsonb_build_array(jsonb_build_object('lat',42.6977,'lng',23.3219,'recorded_at',now()))) ->> 'reason';"
try:
    race(auth(PLAYER) + f"select public.set_location_consent('{GAME}',false);", auth(PLAYER) + ping, 'no_consent')
    assert query(f"select count(*) from public.player_positions where game_id='{GAME}'") == '0'
    print('PASS: concurrent revocation prevents position resurrection')
    query('begin;' + auth(PLAYER) + f"select public.set_location_consent('{GAME}',true);commit;")
    race(f"update private.hunt_players set state='eliminated', eliminated_at=now(), eliminated_by='{GM}', target_profile_id=null where game_id='{GAME}' and profile_id='{PLAYER}';", auth(PLAYER) + ping, 'eliminated')
    print('PASS: concurrent elimination prevents old-consent uploads')

    query('begin;' + auth(GM) + f"select public.reset_hunt('{GAME}'); select public.start_hunt('{GAME}'); commit;")
    query(f"update private.hunt_rounds set started_at=now()-interval '1 minute' where game_id='{GAME}';")
    query('begin;' + auth(PLAYER) + f"select public.ingest_pings('{GAME}',jsonb_build_array(jsonb_build_object('lat',42.6977,'lng',23.3219,'recorded_at',now()-interval '30 seconds'))); commit;")
    exit_ping = f"select public.ingest_pings('{GAME}',jsonb_build_array(jsonb_build_object('lat',42.6977,'lng',23.3235,'recorded_at',now()-interval '10 seconds'))) ->> 'accepted';"
    race(auth(PLAYER) + f"select public.request_elimination('{GAME}');", auth(PLAYER) + exit_ping, '1')
    assert query(f"select status from private.hunt_claims where game_id='{GAME}' and hunter_id='{PLAYER}'") == 'pending'
    print('PASS: concurrent delayed boundary evidence preserves a newer claim')

    # A row writer must fail promptly instead of deadlocking behind start_hunt.
    holder = subprocess.Popen(CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    holder.stdin.write(f"begin; select pg_advisory_xact_lock(hashtextextended('hunt:{GAME}',0));\n\\echo LOCKED\n")
    holder.stdin.flush()
    while holder.stdout.readline().strip() != 'LOCKED':
        if holder.poll() is not None: raise AssertionError(holder.stderr.read())
    try:
        result = subprocess.run(CMD, input='begin;' + auth(GM) + f"update public.game_players set role='gm' where game_id='{GAME}' and profile_id='{PLAYER}';commit;", text=True, capture_output=True, timeout=10)
        assert result.returncode != 0 and 'Game is changing; retry this action.' in result.stderr, result.stderr
        print('PASS: roster change racing a hunt mutation fails without deadlock')
    finally:
        holder.stdin.write('rollback;\n'); holder.stdin.close(); holder.wait(timeout=10)
finally:
    query('begin;' + auth(GM) + f"select public.reset_hunt('{GAME}');commit;")
    query(f"delete from public.games where id='{GAME}'; delete from auth.users where id in ('{GM}','{PLAYER}','83000000-0000-0000-0000-000000000003');")
