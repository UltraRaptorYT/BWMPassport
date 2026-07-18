-- The upload endpoint uses the server-only service role. No public storage
-- policies are created, so student photos cannot be listed or downloaded by
-- anonymous browser clients.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'zest-student-photos',
  'zest-student-photos',
  false,
  8388608,
  array['image/jpeg']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
