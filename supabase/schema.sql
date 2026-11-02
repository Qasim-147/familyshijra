-- Family Tree — Supabase database setup
-- Run this whole file once in Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run: it uses IF NOT EXISTS / OR REPLACE where possible.

-- ---------- Tables ----------
create table if not exists public.people (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique,
  first_name    text not null check (char_length(first_name) between 1 and 80),
  middle_name   text,
  last_name     text,
  maiden_name   text,
  nickname      text,
  gender        text check (gender in ('male', 'female', 'other')),
  birth_date    text check (birth_date is null or birth_date ~ '^\d{4}(-\d{1,2}(-\d{1,2})?)?$'),
  birth_place   text,
  death_date    text check (death_date is null or death_date ~ '^\d{4}(-\d{1,2}(-\d{1,2})?)?$'),
  death_place   text,
  is_living     boolean default true,
  current_place text,
  occupation    text,
  bio           text check (bio is null or char_length(bio) <= 5000),
  photo_url     text,
  father_id     uuid references public.people(id) on delete set null,
  mother_id     uuid references public.people(id) on delete set null,
  spouse_ids    uuid[] not null default '{}',
  visible       boolean not null default true,
  sample        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists people_father_idx on public.people(father_id);
create index if not exists people_mother_idx on public.people(mother_id);
create index if not exists people_name_idx on public.people(lower(first_name), lower(last_name));

create table if not exists public.submissions (
  id          uuid primary key default gen_random_uuid(),
  type        text not null default 'new' check (type in ('new', 'edit', 'remove')),
  target_id   uuid,
  relation    text not null default 'none' check (relation in ('child', 'spouse', 'parent', 'sibling', 'none')),
  relative_id uuid,
  person      jsonb not null,
  submitter   jsonb not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  person_id   uuid,
  admin_note  text,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint submissions_size check (pg_column_size(person) < 20000 and pg_column_size(submitter) < 5000)
);
create index if not exists submissions_status_idx on public.submissions(status, created_at desc);

create table if not exists public.settings (
  id   int primary key default 1 check (id = 1),
  data jsonb not null default '{}'
);
insert into public.settings (id, data) values (1, '{}') on conflict (id) do nothing;

-- Admin accounts: add a row here for each Supabase Auth user who may review and edit.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

-- ---------- Helpers ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists people_touch on public.people;
create trigger people_touch before update on public.people for each row execute function public.touch_updated_at();

-- ---------- Row Level Security ----------
alter table public.people      enable row level security;
alter table public.submissions enable row level security;
alter table public.settings    enable row level security;
alter table public.admins      enable row level security;

-- People: visitors see public people; admins see and change everyone.
drop policy if exists "people public read" on public.people;
create policy "people public read" on public.people for select using (visible or public.is_admin());
drop policy if exists "people admin write" on public.people;
create policy "people admin write" on public.people for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Submissions: anyone can send one (always as 'pending'); only admins can read or change them.
drop policy if exists "submissions anyone insert" on public.submissions;
create policy "submissions anyone insert" on public.submissions for insert to anon, authenticated
  with check (status = 'pending' and person_id is null and reviewed_at is null);
drop policy if exists "submissions admin all" on public.submissions;
create policy "submissions admin all" on public.submissions for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Settings: public read, admin write.
drop policy if exists "settings public read" on public.settings;
create policy "settings public read" on public.settings for select using (true);
drop policy if exists "settings admin write" on public.settings;
create policy "settings admin write" on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admins table: admins can see the list; nobody can change it from the website.
drop policy if exists "admins read" on public.admins;
create policy "admins read" on public.admins for select to authenticated using (public.is_admin());

-- Respect the "accept submissions" switch on the server too.
create or replace function public.check_submissions_open() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and coalesce((select (data->>'submissions_open')::boolean from public.settings where id = 1), true) = false then
    raise exception 'Submissions are closed';
  end if;
  return new;
end; $$;
drop trigger if exists submissions_open on public.submissions;
create trigger submissions_open before insert on public.submissions for each row execute function public.check_submissions_open();

-- ---------- Live updates ----------
do $$ begin
  begin alter publication supabase_realtime add table public.people;      exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.settings;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.submissions; exception when duplicate_object then null; end;
end $$;

-- ---------- Photo storage ----------
-- Public bucket, 5 MB per file, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "photos public read" on storage.objects;
create policy "photos public read" on storage.objects for select using (bucket_id = 'photos');
drop policy if exists "photos visitor upload" on storage.objects;
create policy "photos visitor upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = 'submissions');
drop policy if exists "photos admin all" on storage.objects;
create policy "photos admin all" on storage.objects for all to authenticated
  using (bucket_id = 'photos' and public.is_admin()) with check (bucket_id = 'photos' and public.is_admin());

-- ---------- Make yourself admin ----------
-- 1. Supabase Dashboard → Authentication → Users → Add user (email + password, tick "Auto confirm").
-- 2. Then run (with that email):
--    insert into public.admins (user_id) select id from auth.users where email = 'admin@example.com';
