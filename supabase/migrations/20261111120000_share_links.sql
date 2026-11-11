-- =====================================================================
-- Share links: anyone with a wedding's secret link can view it and edit
-- tasks, meetings, committee updates and the food list without signing in.
-- Wedding details, committees and people stay planner-only.
--
-- The app sends the key from ?share=<key> in an "x-share-key" header.
-- Turn a link on:   update public.weddings set share_key = replace(gen_random_uuid()::text, '-', '') where id = '<wedding id>' returning share_key;
-- Turn it off:      update public.weddings set share_key = null where id = '<wedding id>';
-- =====================================================================

alter table public.weddings add column if not exists share_key text unique
  check (share_key is null or length(share_key) >= 24);

-- The share key sent with this request (empty when there isn't one)
create or replace function private.request_share_key() returns text
language sql stable as $$
  select nullif(coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-share-key', '');
$$;

-- True when this request carries the wedding's current share key
create or replace function private.shared(wid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.weddings
    where id = wid and share_key is not null and share_key = private.request_share_key()
  );
$$;

-- Visitors without a login use the anon role. They need the helpers that
-- column defaults and triggers call (private.my_email() returns '' for them).
grant usage on schema private to anon;
grant execute on all functions in schema private to anon;

create policy "share: read wedding"    on public.weddings        for select to anon using (private.shared(id));
create policy "share: read committees" on public.committees      for select to anon using (private.shared(wedding_id));
create policy "share: read people"     on public.wedding_members for select to anon using (private.shared(wedding_id));
create policy "share: meetings" on public.meetings   for all to anon using (private.shared(wedding_id)) with check (private.shared(wedding_id));
create policy "share: tasks"    on public.tasks      for all to anon using (private.shared(wedding_id)) with check (private.shared(wedding_id));
create policy "share: updates"  on public.updates    for all to anon using (private.shared(wedding_id)) with check (private.shared(wedding_id));
create policy "share: food"     on public.food_items for all to anon using (private.shared(wedding_id)) with check (private.shared(wedding_id));
