-- Images pasted or uploaded into documents: Supabase Storage bucket "images".
-- Public read (share pages show them; the random file name is what grants access),
-- 5 MB each, PNG/JPEG/GIF/WebP only (no SVG: it can carry scripts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 5242880, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Users upload into their own folder "<user id>/…", within their storage limit.
create policy "upload own images" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.used_bytes() < public.max_user_bytes()
  );
create policy "read own images" on storage.objects for select to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "delete own images" on storage.objects for delete to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = (select auth.uid())::text);

