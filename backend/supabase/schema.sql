-- Yield Studio database. Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Supabase holds logins and records only; files live in Cloud Storage (staging) and then OSC.

-- Only OSU addresses can ever become users: the check runs inside the database, so it holds even if
-- someone calls the Supabase API directly instead of using the website.
create or replace function public.is_osu_email(email text) returns boolean
language sql immutable as $$
  select lower(substring(coalesce(email, '') from '@([^@]+)$')) in ('osu.edu', 'buckeyemail.osu.edu')
$$;

create or replace function public.guard_osu_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_osu_email(new.email) then
    raise exception 'Only @osu.edu and @buckeyemail.osu.edu addresses can sign in';
  end if;
  return new;
end $$;

drop trigger if exists guard_osu_email on auth.users;
create trigger guard_osu_email before insert or update of email on auth.users
  for each row execute function public.guard_osu_email();

-- One profile per user, created on first sign-in.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create or replace function public.create_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, lower(new.email)) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists create_profile on auth.users;
create trigger create_profile after insert on auth.users
  for each row execute function public.create_profile();

-- Every file the platform makes or receives. The file itself is never stored here:
-- uploading → in gs://<bucket>/staging/, transferring → Globus is copying it to OSC,
-- at_osc → copied and deleted from the bucket, failed → still in the bucket, needs a look.
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users on delete set null,      -- null for files the lab's own jobs export
  name text not null,
  kind text not null default 'upload' check (kind in ('upload', 'export', 'model')),
  bytes bigint,
  gcs_path text unique,
  osc_path text,
  status text not null default 'uploading' check (status in ('uploading', 'transferring', 'at_osc', 'failed')),
  globus_task text,
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists files_status on public.files (status);

-- Long work (exports, training, full-season maps), shown in the Jobs module.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users on delete set null,
  kind text not null,
  params jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  progress real not null default 0,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The website reads through the FastAPI backend, which connects as the database owner.
-- Row level security still limits any direct API access to a user's own rows.
alter table public.profiles enable row level security;
alter table public.files enable row level security;
alter table public.jobs enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (id = auth.uid());
drop policy if exists "own files" on public.files;
create policy "own files" on public.files for select using (owner = auth.uid());
drop policy if exists "own jobs" on public.jobs;
create policy "own jobs" on public.jobs for select using (owner = auth.uid());
