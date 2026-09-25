-- Hashlite schema on Supabase: folders, documents, revisions, all private to their owner.
-- The browser talks to these tables directly; Row Level Security is what keeps
-- every user inside their own rows. auth.users is managed by Supabase Auth.

-- ---- Folders ---------------------------------------------------------------
create table public.folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id  uuid,
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  -- A parent must belong to the same user; deleting a folder deletes its subfolders.
  foreign key (parent_id, user_id) references public.folders (id, user_id) on delete cascade
);
create index folders_user_idx on public.folders (user_id);
create index folders_parent_idx on public.folders (parent_id);

-- ---- Documents -------------------------------------------------------------
create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id   uuid,
  title       text not null default 'Untitled' check (char_length(title) between 1 and 200),
  content     text not null default '' check (octet_length(content) <= 5242880),
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  share_token text unique check (share_token ~ '^[A-Za-z0-9_-]{22}$'),
  search      tsvector generated always as (
    setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', content), 'B')
  ) stored,
  -- The folder must belong to the same user; deleting it moves documents to the top level.
  foreign key (folder_id, user_id) references public.folders (id, user_id) on delete set null (folder_id)
);
create index documents_user_idx on public.documents (user_id, deleted_at, updated_at desc);
create index documents_folder_idx on public.documents (folder_id);
create index documents_search_idx on public.documents using gin (search);

-- ---- Revisions (version history) --------------------------------------------
create table public.revisions (
  id          bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  content     text not null,
  created_at  timestamptz not null default now()
);
create index revisions_doc_idx on public.revisions (document_id, id desc);
create index revisions_user_idx on public.revisions (user_id);

-- The history list without the (possibly large) text; runs with the caller's rights.
create view public.revision_list with (security_invoker = on) as
  select id, document_id, title, char_length(content) as size, created_at from public.revisions;

-- ---- Row Level Security -------------------------------------------------------
alter table public.folders enable row level security;
alter table public.documents enable row level security;
alter table public.revisions enable row level security;

create policy "own folders" on public.folders for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own documents" on public.documents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own revisions" on public.revisions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.documents d where d.id = document_id and d.user_id = (select auth.uid()))
  );

-- Signed-out visitors get nothing from these tables (shared documents go through a function).
revoke all on public.folders, public.documents, public.revisions, public.revision_list from anon;

-- ---- Folder moves may not create a loop ---------------------------------------
create function public.folders_no_cycle() returns trigger
language plpgsql set search_path = '' as $$
declare cur uuid := new.parent_id;
begin
  while cur is not null loop
    if cur = new.id then
      raise exception using errcode = 'HL400', message = 'A folder cannot be moved into itself.';
    end if;
    select parent_id into cur from public.folders where id = cur;
  end loop;
  return new;
end $$;
create trigger folders_no_cycle before update of parent_id on public.folders
  for each row when (new.parent_id is not null) execute function public.folders_no_cycle();
