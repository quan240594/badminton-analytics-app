-- Access rules for players / national_rankings. Run against a database that has the migrations applied:
--   supabase db query --linked -f supabase/tests/players_access.sql
-- Raises (and so fails) on the first rule that does not hold; leaves no data behind.

do $$
declare
  seen integer;
begin
  insert into public.players (member_id, name) values ('t-1', 'Test Player');
  insert into public.national_rankings (member_id, list_id, week, category, rank, points, matches)
    values ('t-1', '75', '40-2026', 'Mannen Enkel', 1, 100, 10);

  -- logged-in users can read both tables
  set local role authenticated;
  select count(*) into seen from public.players where member_id = 't-1';
  assert seen = 1, 'authenticated cannot read players';
  select count(*) into seen from public.national_rankings where member_id = 't-1';
  assert seen = 1, 'authenticated cannot read national_rankings';

  -- ...but cannot change them
  begin
    insert into public.players (member_id, name) values ('t-2', 'Nope');
    raise exception 'authenticated could insert into players';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.players set name = 'Changed' where member_id = 't-1';
    raise exception 'authenticated could update players';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.national_rankings where member_id = 't-1';
    raise exception 'authenticated could delete from national_rankings';
  exception when insufficient_privilege then null;
  end;

  -- the public key (not logged in) cannot even read
  reset role;
  set local role anon;
  begin
    perform 1 from public.players limit 1;
    raise exception 'anon could read players';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.national_rankings limit 1;
    raise exception 'anon could read national_rankings';
  exception when insufficient_privilege then null;
  end;

  reset role;
  delete from public.players where member_id = 't-1';
  raise notice 'all access rules hold';
end
$$;
