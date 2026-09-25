-- Advisor follow-ups.
-- 1) The storage-usage helpers don't need to be reachable through the API: move them
--    to a private schema (not exposed by PostgREST). Policies and triggers keep working.
create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.used_bytes() set schema private;
alter function public.max_user_bytes() set schema private;
revoke execute on function private.used_bytes(), private.max_user_bytes() from public, anon;
grant execute on function private.used_bytes(), private.max_user_bytes() to authenticated;

create or replace function public.documents_quota() returns trigger
language plpgsql set search_path = '' as $$
declare growth bigint := octet_length(new.content) - coalesce(octet_length(old.content), 0);
begin
  if growth > 0 and private.used_bytes() + growth > private.max_user_bytes() then
    raise exception using errcode = 'HL413',
      message = 'Storage limit reached: your documents and images can use up to 100 MB. Delete some documents or empty the trash to make room.';
  end if;
  return new;
end $$;

drop policy "upload own images" on storage.objects;
create policy "upload own images" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and private.used_bytes() < private.max_user_bytes()
  );

-- 2) Indexes covering the composite foreign keys.
drop index public.documents_folder_idx;
create index documents_folder_user_idx on public.documents (folder_id, user_id);
drop index public.folders_parent_idx;
create index folders_parent_user_idx on public.folders (parent_id, user_id);

-- get_shared_document (anon) and delete_my_account (signed in) stay SECURITY DEFINER on
-- purpose: the first returns exactly one shared document by its secret token, the second
-- only ever deletes the caller.
