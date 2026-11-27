-- One-time update: lets the admin save "Text below the photo" for each member.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
alter table public.people add column if not exists photo_caption text
  check (photo_caption is null or char_length(photo_caption) <= 160);
