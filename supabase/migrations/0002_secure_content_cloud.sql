-- OUR UNIVERSE public reads with protected server-side writes.
-- Review and apply manually in the Supabase SQL Editor; this file is never auto-run.
begin;

create table if not exists public.story_milestones (
  id text primary key,
  title text not null,
  event_date date not null default current_date,
  description text not null default '',
  location text not null default '',
  photo_path text,
  photo_url text,
  photo_bucket text not null default 'photos',
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memories (
  id text primary key,
  photo_path text,
  photo_url text,
  photo_bucket text not null default 'memory-attachments',
  caption text not null default '',
  memory_date date not null default current_date,
  location text not null default '',
  fav boolean not null default false,
  rot double precision not null default 0,
  video_path text,
  video_url text,
  video_bucket text not null default 'videos',
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.love_letters (
  id text primary key,
  title text not null,
  body text not null,
  letter_date date not null default current_date,
  fav boolean not null default false,
  draft boolean not null default false,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scratch_reveals (
  id text primary key,
  photo_path text,
  photo_url text,
  photo_bucket text not null default 'photos',
  caption text not null default '',
  display_order bigint not null default 0,
  video_path text,
  video_url text,
  video_bucket text not null default 'videos',
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists story_milestones_public_date_idx on public.story_milestones (event_date) where published;
create index if not exists memories_public_date_idx on public.memories (memory_date desc) where published;
create index if not exists love_letters_public_date_idx on public.love_letters (letter_date desc) where published and not draft;
create index if not exists scratch_reveals_public_order_idx on public.scratch_reveals (display_order) where published;

alter table public.story_milestones enable row level security;
alter table public.memories enable row level security;
alter table public.love_letters enable row level security;
alter table public.scratch_reveals enable row level security;

revoke all on table public.story_milestones, public.memories, public.love_letters, public.scratch_reveals from public, anon, authenticated;
grant select on table public.story_milestones, public.memories, public.love_letters, public.scratch_reveals to anon, authenticated;
grant all on table public.story_milestones, public.memories, public.love_letters, public.scratch_reveals to service_role;

drop policy if exists story_milestones_public_read on public.story_milestones;
create policy story_milestones_public_read on public.story_milestones
  for select to anon, authenticated using (published = true);
drop policy if exists memories_public_read on public.memories;
create policy memories_public_read on public.memories
  for select to anon, authenticated using (published = true);
drop policy if exists love_letters_public_read on public.love_letters;
create policy love_letters_public_read on public.love_letters
  for select to anon, authenticated using (published = true and draft = false);
drop policy if exists scratch_reveals_public_read on public.scratch_reveals;
create policy scratch_reveals_public_read on public.scratch_reveals
  for select to anon, authenticated using (published = true);

-- Copy legacy JSON rows if the old table exists; keep its rows for rollback.
do $migration$
begin
  if to_regclass('public.entries') is not null then
    insert into public.story_milestones (id, title, event_date, description, location, photo_path, photo_url, photo_bucket, published)
    select e.id,
      coalesce(nullif(e.data->>'title', ''), 'Untitled milestone'),
      case when e.data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (e.data->>'date')::date else current_date end,
      coalesce(e.data->>'description', ''), coalesce(e.data->>'location', ''),
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then substring(e.data->>'photo' from '/object/public/media/(.*)$') end,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then null else e.data->>'photo' end,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then 'media' else 'photos' end,
      case when e.data->>'published' in ('true', 'false') then (e.data->>'published')::boolean else true end
    from public.entries e where e.store = 'events'
    on conflict (id) do nothing;

    insert into public.memories (id, photo_path, photo_url, photo_bucket, caption, memory_date, location, fav, rot, video_path, video_url, video_bucket, published)
    select e.id,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then substring(e.data->>'photo' from '/object/public/media/(.*)$') end,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then null else e.data->>'photo' end,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then 'media' else 'memory-attachments' end,
      coalesce(e.data->>'caption', ''),
      case when e.data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (e.data->>'date')::date else current_date end,
      coalesce(e.data->>'location', ''),
      case when e.data->>'fav' in ('true', 'false') then (e.data->>'fav')::boolean else false end,
      case when e.data->>'rot' ~ '^-?[0-9]+([.][0-9]+)?$' then (e.data->>'rot')::double precision else 0 end,
      case when coalesce(e.data->>'video', '') like '%/object/public/media/%' then substring(e.data->>'video' from '/object/public/media/(.*)$') end,
      case when coalesce(e.data->>'video', '') like '%/object/public/media/%' then null else e.data->>'video' end,
      case when coalesce(e.data->>'video', '') like '%/object/public/media/%' then 'media' else 'videos' end,
      case when e.data->>'published' in ('true', 'false') then (e.data->>'published')::boolean else true end
    from public.entries e where e.store = 'memories'
    on conflict (id) do nothing;

    insert into public.love_letters (id, title, body, letter_date, fav, draft, published)
    select e.id, coalesce(nullif(e.data->>'title', ''), 'Untitled letter'), coalesce(e.data->>'body', ''),
      case when e.data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (e.data->>'date')::date else current_date end,
      case when e.data->>'fav' in ('true', 'false') then (e.data->>'fav')::boolean else false end,
      case when e.data->>'draft' in ('true', 'false') then (e.data->>'draft')::boolean else false end,
      case when e.data->>'published' in ('true', 'false') then (e.data->>'published')::boolean
        else not (case when e.data->>'draft' in ('true', 'false') then (e.data->>'draft')::boolean else false end) end
    from public.entries e where e.store = 'letters'
    on conflict (id) do nothing;

    insert into public.scratch_reveals (id, photo_path, photo_url, photo_bucket, caption, display_order, video_path, video_url, video_bucket, published)
    select e.id,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then substring(e.data->>'photo' from '/object/public/media/(.*)$') end,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then null else e.data->>'photo' end,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then 'media' else 'photos' end,
      coalesce(e.data->>'caption', ''),
      case when e.data->>'at' ~ '^-?[0-9]+$' then (e.data->>'at')::bigint else 0 end,
      case when coalesce(e.data->>'video', '') like '%/object/public/media/%' then substring(e.data->>'video' from '/object/public/media/(.*)$') end,
      case when coalesce(e.data->>'video', '') like '%/object/public/media/%' then null else e.data->>'video' end,
      case when coalesce(e.data->>'video', '') like '%/object/public/media/%' then 'media' else 'videos' end,
      case when e.data->>'published' in ('true', 'false') then (e.data->>'published')::boolean else true end
    from public.entries e where e.store = 'scratch'
    on conflict (id) do nothing;

    insert into public.scratch_reveals (id, photo_path, photo_url, photo_bucket, caption, display_order, published)
    select 'legacy-photo-' || e.id,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then substring(e.data->>'photo' from '/object/public/media/(.*)$') end,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then null else e.data->>'photo' end,
      case when coalesce(e.data->>'photo', '') like '%/object/public/media/%' then 'media' else 'photos' end,
      coalesce(e.data->>'caption', ''),
      case when e.data->>'at' ~ '^-?[0-9]+$' then (e.data->>'at')::bigint else 0 end,
      true
    from public.entries e where e.store = 'photos'
    on conflict (id) do nothing;

    alter table public.entries enable row level security;
    revoke all on table public.entries from public, anon, authenticated;
    execute 'drop policy if exists "open read" on public.entries';
    execute 'drop policy if exists "open insert" on public.entries';
    execute 'drop policy if exists "open update" on public.entries';
    execute 'drop policy if exists "open delete" on public.entries';
  end if;
end
$migration$;

-- Private buckets permit only signed reads whose object path belongs to a published row.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('photos', 'photos', false, 52428800, array['image/jpeg','image/png','image/webp','image/gif']),
  ('videos', 'videos', false, 52428800, array['video/mp4','video/webm','video/quicktime']),
  ('memory-attachments', 'memory-attachments', false, 52428800, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']),
  ('media', 'media', false, 52428800, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table storage.objects enable row level security;
drop policy if exists "open read media" on storage.objects;
drop policy if exists "open upload media" on storage.objects;
drop policy if exists "open update media" on storage.objects;
drop policy if exists "open delete media" on storage.objects;
drop policy if exists our_universe_published_media_read on storage.objects;
drop policy if exists our_universe_published_media_only on storage.objects;
drop policy if exists our_universe_deny_public_media_insert on storage.objects;
drop policy if exists our_universe_deny_public_media_update on storage.objects;
drop policy if exists our_universe_deny_public_media_delete on storage.objects;

create policy our_universe_published_media_read on storage.objects
  as permissive for select to anon, authenticated
  using (
    bucket_id in ('photos', 'videos', 'memory-attachments', 'media')
    and (
      exists (select 1 from public.story_milestones s where s.published and s.photo_bucket = storage.objects.bucket_id and s.photo_path = storage.objects.name)
      or exists (select 1 from public.memories m where m.published and ((m.photo_bucket = storage.objects.bucket_id and m.photo_path = storage.objects.name) or (m.video_bucket = storage.objects.bucket_id and m.video_path = storage.objects.name)))
      or exists (select 1 from public.scratch_reveals r where r.published and ((r.photo_bucket = storage.objects.bucket_id and r.photo_path = storage.objects.name) or (r.video_bucket = storage.objects.bucket_id and r.video_path = storage.objects.name)))
    )
  );

-- Restrictive policies prevent other permissive policies from opening these media buckets.
create policy our_universe_published_media_only on storage.objects
  as restrictive for select to anon, authenticated
  using (
    bucket_id not in ('photos', 'videos', 'memory-attachments', 'media')
    or (
      exists (select 1 from public.story_milestones s where s.published and s.photo_bucket = storage.objects.bucket_id and s.photo_path = storage.objects.name)
      or exists (select 1 from public.memories m where m.published and ((m.photo_bucket = storage.objects.bucket_id and m.photo_path = storage.objects.name) or (m.video_bucket = storage.objects.bucket_id and m.video_path = storage.objects.name)))
      or exists (select 1 from public.scratch_reveals r where r.published and ((r.photo_bucket = storage.objects.bucket_id and r.photo_path = storage.objects.name) or (r.video_bucket = storage.objects.bucket_id and r.video_path = storage.objects.name)))
    )
  );
create policy our_universe_deny_public_media_insert on storage.objects
  as restrictive for insert to anon, authenticated
  with check (bucket_id not in ('photos', 'videos', 'memory-attachments', 'media'));
create policy our_universe_deny_public_media_update on storage.objects
  as restrictive for update to anon, authenticated
  using (bucket_id not in ('photos', 'videos', 'memory-attachments', 'media'))
  with check (bucket_id not in ('photos', 'videos', 'memory-attachments', 'media'));
create policy our_universe_deny_public_media_delete on storage.objects
  as restrictive for delete to anon, authenticated
  using (bucket_id not in ('photos', 'videos', 'memory-attachments', 'media'));

grant select on table storage.objects to anon, authenticated;
grant all on table storage.objects to service_role;

do $realtime$
declare table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['story_milestones', 'memories', 'love_letters', 'scratch_reveals'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end
$realtime$;

commit;
