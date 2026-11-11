-- Only needed if you ran the earlier single-wedding file (supabase_setup.sql).
-- It removes those tables so the new migration can run. Anything typed into
-- the old app is deleted; the Mercy & Garikai seed file reloads the checklist
-- and food list.
drop table if exists public.updates cascade;
drop table if exists public.meetings cascade;
drop table if exists public.tasks cascade;
drop table if exists public.food_items cascade;
drop table if exists public.members cascade;
drop table if exists public.committees cascade;
drop function if exists public.is_member();
drop function if exists public.is_admin();
