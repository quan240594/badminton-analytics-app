-- Everyone on the national ranking lists (adult list 75, junior list 164), keyed by the site-wide
-- MemberID. Written weekly by data/sync_supabase.py with the service role; readable only by logged-in users.

create table public.players (
  member_id text primary key,
  name text not null,
  site_player_id text,
  updated_at timestamptz not null default now()
);

-- One row per player, list, ranking week and category; older weeks are kept so rankings build a history.
create table public.national_rankings (
  member_id text not null references public.players (member_id) on delete cascade,
  list_id text not null,
  week text not null,
  category text not null,
  rank integer,
  points integer not null,
  matches integer not null,
  primary key (member_id, list_id, week, category)
);

alter table public.players enable row level security;
alter table public.national_rankings enable row level security;

-- Supabase grants new tables to anon and authenticated by default; take that back, then give
-- logged-in users read access only. Writes only happen with the service role, which bypasses RLS.
revoke all on public.players, public.national_rankings from anon, authenticated;
grant select on public.players, public.national_rankings to authenticated;

create policy "logged-in users can read players" on public.players
  for select to authenticated using (true);
create policy "logged-in users can read national rankings" on public.national_rankings
  for select to authenticated using (true);
