-- Hashlite rules that used to live in the Node server, now in the database so
-- they hold for every client: storage limit, versions, history, search, sharing.

-- ---- Storage limit ---------------------------------------------------------------
create function public.max_user_bytes() returns bigint
language sql immutable set search_path = '' as $$ select 104857600::bigint $$; -- 100 MB

-- Bytes used by the current user: document text (trash included) plus uploaded images.
create function public.used_bytes() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(octet_length(content)) from public.documents where user_id = auth.uid()), 0)
       + coalesce((select sum(coalesce((metadata->>'size')::bigint, 0)) from storage.objects
                   where bucket_id = 'images' and owner_id::uuid = auth.uid()), 0)
$$;

-- Refuses growth past the limit; shrinking is always allowed.
create function public.documents_quota() returns trigger
language plpgsql set search_path = '' as $$
declare growth bigint := octet_length(new.content) - coalesce(octet_length(old.content), 0);
begin
  if growth > 0 and public.used_bytes() + growth > public.max_user_bytes() then
    raise exception using errcode = 'HL413',
      message = 'Storage limit reached: your documents and images can use up to 100 MB. Delete some documents or empty the trash to make room.';
  end if;
  return new;
end $$;
create trigger documents_quota before insert or update of content on public.documents
  for each row execute function public.documents_quota();

-- ---- Version history ---------------------------------------------------------------
-- Keeps everything from the last day, then the newest per hour for a week, then the
-- newest per day, and at most 200 in total.
create function public.prune_revisions(p_doc uuid) returns void
language sql set search_path = '' as $$
  delete from public.revisions r
  using (
    select id,
      row_number() over (partition by bucket order by id desc) as nth_in_bucket,
      dense_rank() over (order by bucket_newest desc) as bucket_rank
    from (
      select id, bucket, max(id) over (partition by bucket) as bucket_newest
      from (
        select id,
          case
            when now() - created_at < interval '1 day' then 'r' || id
            when now() - created_at < interval '7 days' then 'h' || date_trunc('hour', created_at)
            else 'd' || date_trunc('day', created_at)
          end as bucket
        from public.revisions where document_id = p_doc
      ) b
    ) ranked
  ) x
  where r.id = x.id and (x.nth_in_bucket > 1 or x.bucket_rank > 200)
$$;

create function public.add_revision(p_doc public.documents) returns void
language plpgsql set search_path = '' as $$
begin
  if p_doc.content = '' then return; end if;
  if exists (select 1 from public.revisions where document_id = p_doc.id and id =
             (select max(id) from public.revisions where document_id = p_doc.id) and content = p_doc.content) then
    return;
  end if;
  insert into public.revisions (document_id, user_id, title, content) values (p_doc.id, p_doc.user_id, p_doc.title, p_doc.content);
  perform public.prune_revisions(p_doc.id);
end $$;

-- ---- Create ---------------------------------------------------------------------
create function public.create_document(p_title text default 'Untitled', p_content text default '', p_folder_id uuid default null)
returns public.documents
language plpgsql set search_path = '' as $$
declare d public.documents;
begin
  insert into public.documents (title, content, folder_id)
  values (coalesce(nullif(left(btrim(coalesce(p_title, '')), 200), ''), 'Untitled'), coalesce(p_content, ''), p_folder_id)
  returning * into d;
  perform public.add_revision(d);
  return d;
end $$;

-- ---- Save ---------------------------------------------------------------------------
-- The version check only applies when the content differs from what is stored (a
-- retried save that already landed is not a conflict), and the version only goes up
-- when the content changes, so renames and moves never conflict with edits elsewhere.
-- History keeps the text being replaced when a new editing session starts (no
-- revision for 5 minutes), when most of the text is removed, or with p_keep_current.
-- p_snapshot also stores the new state.
create function public.save_document(
  p_id uuid,
  p_title text default null,
  p_content text default null,
  p_folder_id uuid default null,
  p_move boolean default false,
  p_version integer default null,
  p_snapshot boolean default false,
  p_keep_current boolean default false
) returns public.documents
language plpgsql set search_path = '' as $$
declare
  d public.documents;
  next_title text;
  next_content text;
  next_folder uuid;
  changed boolean;
  last_at timestamptz;
begin
  select * into d from public.documents where id = p_id and user_id = auth.uid() for update;
  if not found then
    raise exception using errcode = 'HL404', message = 'Document not found.';
  end if;
  if d.deleted_at is not null then
    raise exception using errcode = 'HL410', message = 'This document is in the trash.', detail = (to_jsonb(d) - 'search')::text;
  end if;
  next_title := case when p_title is null then d.title
                     else coalesce(nullif(left(btrim(p_title), 200), ''), 'Untitled') end;
  next_content := coalesce(p_content, d.content);
  next_folder := case when p_move then p_folder_id else d.folder_id end;
  changed := next_content is distinct from d.content;
  if changed and p_version is not null and p_version <> d.version then
    raise exception using errcode = 'HL409', message = 'This document was changed elsewhere.', detail = (to_jsonb(d) - 'search')::text;
  end if;
  if changed and d.content <> '' then
    select max(created_at) into last_at from public.revisions where document_id = d.id;
    if p_keep_current or last_at is null or now() - last_at >= interval '5 minutes'
       or char_length(next_content) < char_length(d.content) / 2 then
      perform public.add_revision(d);
    end if;
  end if;
  if changed or next_title is distinct from d.title or next_folder is distinct from d.folder_id then
    update public.documents
       set title = next_title, content = next_content, folder_id = next_folder,
           version = d.version + case when changed then 1 else 0 end, updated_at = now()
     where id = d.id
     returning * into d;
  end if;
  if p_snapshot then perform public.add_revision(d); end if;
  return d;
end $$;

-- Restores a version. The current text goes into history first, so the restore can be
-- undone; the restored text is already in history (it is that revision).
create function public.restore_revision(p_doc uuid, p_rev bigint) returns public.documents
language plpgsql set search_path = '' as $$
declare r public.revisions;
begin
  select * into r from public.revisions where id = p_rev and document_id = p_doc and user_id = auth.uid();
  if not found then
    raise exception using errcode = 'HL404', message = 'Revision not found.';
  end if;
  return public.save_document(p_doc, r.title, r.content, p_keep_current => true);
end $$;

-- ---- Search -------------------------------------------------------------------------
-- Every word becomes a prefix term; matches in the excerpt are wrapped in \u0002 … \u0003.
create function public.search_documents(q text)
returns table (id uuid, folder_id uuid, title text, version integer, created_at timestamptz,
               updated_at timestamptz, deleted_at timestamptz, share_token text, excerpt text)
language sql stable set search_path = '' as $$
  with query as (
    select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' & ')) as tsq
    from (select w from regexp_split_to_table(lower(coalesce(q, '')), '[^[:alnum:]_]+') as w
          where w <> '' limit 12) words
  )
  select d.id, d.folder_id, d.title, d.version, d.created_at, d.updated_at, d.deleted_at, d.share_token,
         ts_headline('simple', d.content, query.tsq,
           'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', MaxWords=24, MinWords=10, MaxFragments=1')
  from public.documents d, query
  where query.tsq is not null and d.user_id = auth.uid() and d.deleted_at is null and d.search @@ query.tsq
  order by ts_rank(d.search, query.tsq) desc
  limit 100
$$;

-- ---- Read-only share links ----------------------------------------------------------
-- The only way signed-out visitors can read anything: one shared, non-trashed document.
create function public.get_shared_document(p_token text)
returns table (title text, content text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select title, content, updated_at from public.documents
  where share_token = p_token and deleted_at is null and p_token ~ '^[A-Za-z0-9_-]{22}$'
$$;

-- ---- Delete my account ---------------------------------------------------------------
-- Deletes the caller from auth.users; folders, documents and revisions go with it
-- (foreign keys cascade). The app removes the user's image files first.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception using errcode = 'HL401', message = 'Please sign in.';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---- Who may call what -----------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.create_document(text, text, uuid), public.save_document(uuid, text, text, uuid, boolean, integer, boolean, boolean),
  public.restore_revision(uuid, bigint), public.search_documents(text), public.delete_my_account(), public.used_bytes(),
  -- Helpers called by the functions above, which run with the caller's rights (and RLS).
  public.add_revision(public.documents), public.prune_revisions(uuid), public.max_user_bytes()
  to authenticated;
grant execute on function public.get_shared_document(text) to anon, authenticated;
