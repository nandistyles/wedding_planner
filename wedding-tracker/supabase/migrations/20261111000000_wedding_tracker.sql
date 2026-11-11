-- =====================================================================
-- Wedding tracker – database schema (one database, many weddings)
-- Run once on a new Supabase project:
--   Dashboard → SQL Editor → paste this file → Run
--   or with the Supabase CLI:  supabase db push
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- The signed-in person's email (from their Supabase login), lower-case
-- ---------------------------------------------------------------------
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.my_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- ---------------------------------------------------------------------
-- App admins: can see every wedding, create new ones and edit templates.
-- Add yourself after running this file (see README, step 3).
-- ---------------------------------------------------------------------
create table public.app_admins (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Weddings and everything that belongs to one
-- ---------------------------------------------------------------------
create table public.weddings (
  id uuid primary key default gen_random_uuid(),
  couple_names text not null,
  wedding_date date not null,
  ceremony_time text,
  venue text,
  venue_address text,
  guest_count int check (guest_count is null or guest_count >= 0),
  caterer_name text,
  caterer_phone text,
  food_notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text default private.my_email()
);

create table public.committees (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  name text not null,
  lead text,
  sort int not null default 0,
  unique (wedding_id, name)
);

create table public.wedding_members (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  email text not null check (email = lower(email)),
  name text,
  phone text,
  committee_id bigint references public.committees(id) on delete set null,
  role text not null default 'member' check (role in ('planner', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique (wedding_id, email)
);

create table public.meetings (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  meeting_date date not null,
  start_time text,
  place text,
  chair text,
  secretary text,
  attendees text,
  minutes text,
  minutes_final boolean not null default false,
  minutes_final_by text,
  minutes_final_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text default private.my_email()
);

create table public.tasks (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  section text,
  title text not null,
  due_date date,
  committee_id bigint references public.committees(id) on delete set null,
  responsible text,
  status text not null default 'Not started' check (status in ('Not started', 'In progress', 'Done')),
  notes text,
  sort int not null default 0,
  -- set when the task is an action point agreed at a meeting
  origin_meeting_id bigint references public.meetings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text default private.my_email()
);

create table public.updates (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  meeting_id bigint references public.meetings(id) on delete cascade,
  committee_id bigint references public.committees(id) on delete set null,
  task_id bigint references public.tasks(id) on delete set null,
  done text not null,
  next_steps text,
  blockers text,
  new_status text check (new_status in ('Not started', 'In progress', 'Done')),
  author_email text not null default private.my_email(),
  created_at timestamptz not null default now()
);

create table public.food_items (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  category text not null,
  item text not null,
  detail text,
  amount numeric(10, 2) not null default 0 check (amount >= 0),
  bought boolean not null default false,
  notes text,
  sort int not null default 0
);

-- Templates used to start each new wedding's committees and checklist
create table public.committee_templates (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort int not null default 0
);

create table public.task_templates (
  id bigint generated always as identity primary key,
  section text not null,
  title text not null,
  days_before int not null,          -- 0 = wedding day, negative = after the wedding
  committee_name text,
  sort int not null default 0
);

create index on public.committees (wedding_id);
create index on public.wedding_members (wedding_id);
create index on public.wedding_members (email);
create index on public.meetings (wedding_id, meeting_date);
create index on public.tasks (wedding_id);
create index on public.tasks (origin_meeting_id);
create index on public.updates (wedding_id);
create index on public.updates (meeting_id);
create index on public.food_items (wedding_id);

-- ---------------------------------------------------------------------
-- Access helpers
--   planner   – full control of one wedding (details, people, committees)
--   member    – adds and edits tasks, meetings, updates and food
--   viewer    – reads only
--   app admin – sees every wedding and creates new ones
-- ---------------------------------------------------------------------
create or replace function private.is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where email = private.my_email());
$$;

create or replace function private.wedding_role(wid uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.wedding_members where wedding_id = wid and email = private.my_email();
$$;

create or replace function private.can_read(wid uuid) returns boolean
language sql stable as $$
  select private.is_app_admin() or private.wedding_role(wid) is not null;
$$;

create or replace function private.can_write(wid uuid) returns boolean
language sql stable as $$
  select private.is_app_admin() or coalesce(private.wedding_role(wid) in ('planner', 'member'), false);
$$;

create or replace function private.is_planner(wid uuid) returns boolean
language sql stable as $$
  select private.is_app_admin() or coalesce(private.wedding_role(wid) = 'planner', false);
$$;

grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------
-- Stamps set by the database, so they can't be faked from a browser
-- ---------------------------------------------------------------------
create or replace function private.stamp_task() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := private.my_email();
  return new;
end $$;

create trigger tasks_stamp before insert or update on public.tasks
for each row execute function private.stamp_task();

create or replace function private.stamp_minutes() returns trigger
language plpgsql as $$
begin
  if new.minutes_final and (tg_op = 'INSERT' or not old.minutes_final) then
    new.minutes_final_by := private.my_email();
    new.minutes_final_at := now();
  elsif not new.minutes_final then
    new.minutes_final_by := null;
    new.minutes_final_at := null;
  end if;
  return new;
end $$;

create trigger meetings_stamp before insert or update on public.meetings
for each row execute function private.stamp_minutes();

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table public.app_admins          enable row level security;
alter table public.weddings            enable row level security;
alter table public.committees          enable row level security;
alter table public.wedding_members     enable row level security;
alter table public.meetings            enable row level security;
alter table public.tasks               enable row level security;
alter table public.updates             enable row level security;
alter table public.food_items          enable row level security;
alter table public.committee_templates enable row level security;
alter table public.task_templates      enable row level security;

-- app admins: you can see your own row (the app uses it to show admin buttons)
create policy "see own admin row" on public.app_admins for select to authenticated
  using (email = private.my_email());

-- weddings
create policy "read weddings"  on public.weddings for select to authenticated using (private.can_read(id));
create policy "admins add"     on public.weddings for insert to authenticated with check (private.is_app_admin());
create policy "planners edit"  on public.weddings for update to authenticated using (private.is_planner(id)) with check (private.is_planner(id));
create policy "admins delete"  on public.weddings for delete to authenticated using (private.is_app_admin());

-- committees and people: planners manage, everyone on the wedding reads
create policy "read committees"   on public.committees for select to authenticated using (private.can_read(wedding_id));
create policy "manage committees" on public.committees for all    to authenticated using (private.is_planner(wedding_id)) with check (private.is_planner(wedding_id));

create policy "read members"   on public.wedding_members for select to authenticated using (private.can_read(wedding_id));
create policy "manage members" on public.wedding_members for all    to authenticated using (private.is_planner(wedding_id)) with check (private.is_planner(wedding_id));

-- day-to-day records: members and planners write, viewers read
create policy "read meetings"   on public.meetings for select to authenticated using (private.can_read(wedding_id));
create policy "add meetings"    on public.meetings for insert to authenticated with check (private.can_write(wedding_id));
create policy "edit meetings"   on public.meetings for update to authenticated using (private.can_write(wedding_id)) with check (private.can_write(wedding_id));
create policy "delete meetings" on public.meetings for delete to authenticated using (private.is_planner(wedding_id));

create policy "read tasks"   on public.tasks for select to authenticated using (private.can_read(wedding_id));
create policy "add tasks"    on public.tasks for insert to authenticated with check (private.can_write(wedding_id));
create policy "edit tasks"   on public.tasks for update to authenticated using (private.can_write(wedding_id)) with check (private.can_write(wedding_id));
create policy "delete tasks" on public.tasks for delete to authenticated using (private.can_write(wedding_id));

create policy "read updates"   on public.updates for select to authenticated using (private.can_read(wedding_id));
create policy "add updates"    on public.updates for insert to authenticated
  with check (private.can_write(wedding_id) and author_email = private.my_email());
create policy "delete updates" on public.updates for delete to authenticated
  using (private.is_planner(wedding_id) or (author_email = private.my_email() and private.can_write(wedding_id)));

create policy "read food"  on public.food_items for select to authenticated using (private.can_read(wedding_id));
create policy "write food" on public.food_items for all    to authenticated using (private.can_write(wedding_id)) with check (private.can_write(wedding_id));

-- templates: anyone signed in reads, app admins change
create policy "read committee templates"   on public.committee_templates for select to authenticated using (true);
create policy "manage committee templates" on public.committee_templates for all to authenticated using (private.is_app_admin()) with check (private.is_app_admin());
create policy "read task templates"   on public.task_templates for select to authenticated using (true);
create policy "manage task templates" on public.task_templates for all to authenticated using (private.is_app_admin()) with check (private.is_app_admin());

-- ---------------------------------------------------------------------
-- Start a new wedding from the templates (app admins only)
-- ---------------------------------------------------------------------
create or replace function public.create_wedding(
  p_couple_names text,
  p_wedding_date date,
  p_venue text default null,
  p_guest_count int default null,
  p_planner_name text default null,
  p_copy_food_from uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  wid uuid;
begin
  if not private.is_app_admin() then
    raise exception 'Only app admins can create weddings';
  end if;

  insert into weddings (couple_names, wedding_date, venue, guest_count)
  values (p_couple_names, p_wedding_date, p_venue, p_guest_count)
  returning id into wid;

  insert into wedding_members (wedding_id, email, name, role)
  values (wid, private.my_email(), coalesce(nullif(trim(p_planner_name), ''), private.my_email()), 'planner');

  insert into committees (wedding_id, name, sort)
  select wid, name, sort from committee_templates;

  insert into tasks (wedding_id, section, title, due_date, committee_id, sort)
  select wid, t.section, t.title, p_wedding_date - t.days_before, c.id, t.sort
  from task_templates t
  left join committees c on c.wedding_id = wid and c.name = t.committee_name;

  if p_copy_food_from is not null and private.can_read(p_copy_food_from) then
    insert into food_items (wedding_id, category, item, detail, amount, notes, sort)
    select wid, category, item, detail, amount, notes, sort
    from food_items where wedding_id = p_copy_food_from;
  end if;

  return wid;
end $$;

-- ---------------------------------------------------------------------
-- Make a wedding's committees and checklist the template for future
-- weddings (app admins only). Meeting action points are left out.
-- ---------------------------------------------------------------------
create or replace function public.save_as_template(p_wedding_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  wdate date;
  n int;
begin
  if not private.is_app_admin() then
    raise exception 'Only app admins can change templates';
  end if;
  select wedding_date into wdate from weddings where id = p_wedding_id;
  if wdate is null then
    raise exception 'Wedding not found';
  end if;

  delete from task_templates where true;
  delete from committee_templates where true;

  insert into committee_templates (name, sort)
  select name, sort from committees where wedding_id = p_wedding_id;

  insert into task_templates (section, title, days_before, committee_name, sort)
  select coalesce(t.section, 'Other'), t.title, coalesce(wdate - t.due_date, 0), c.name, t.sort
  from tasks t left join committees c on c.id = t.committee_id
  where t.wedding_id = p_wedding_id and t.origin_meeting_id is null;

  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.create_wedding(text, date, text, int, text, uuid) from public, anon;
revoke execute on function public.save_as_template(uuid) from public, anon;
grant execute on function public.create_wedding(text, date, text, int, text, uuid) to authenticated;
grant execute on function public.save_as_template(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Starter templates. Edit them here, or replace them later from the app
-- with "Use as template for new weddings" on a finished wedding.
-- ---------------------------------------------------------------------
insert into public.committee_templates (name, sort) values
  ('Coordination', 0), ('Finance', 1), ('Catering & cake', 2), ('Decor & seating', 3),
  ('Bridal party & attire', 4), ('Transport', 5), ('Security, parking & ushers', 6),
  ('Programme, MC & music', 7), ('Photo & video', 8), ('Venue, power & water', 9);

insert into public.task_templates (section, days_before, committee_name, title, sort) values
  ('8 weeks before', 56, 'Venue, power & water', 'Confirm venue booking, date and times', 1),
  ('8 weeks before', 56, 'Venue, power & water', 'Sign the venue contract and agree the venue cost', 2),
  ('8 weeks before', 56, 'Finance', 'Set the budget and agree who pays for what', 3),
  ('8 weeks before', 56, 'Coordination', 'Book the marriage officer and check which documents are needed', 4),
  ('8 weeks before', 56, 'Bridal party & attire', 'Choose the bridal party and colour theme', 5),
  ('8 weeks before', 56, 'Catering & cake', 'Book the caterer and get an itemised food quote', 6),
  ('8 weeks before', 56, 'Photo & video', 'Book photographer and videographer', 7),
  ('8 weeks before', 56, 'Programme, MC & music', 'Book MC, DJ and sound (ask whether the venue has a PA)', 8),
  ('8 weeks before', 56, 'Decor & seating', 'Book the decor provider (chairs, tables, linen)', 9),
  ('6 weeks before', 42, 'Coordination', 'Send digital invites with an RSVP deadline', 10),
  ('6 weeks before', 42, 'Bridal party & attire', 'Wedding dress: buy, hire or confirm the tailor''s timeline', 11),
  ('6 weeks before', 42, 'Bridal party & attire', 'Groom and groomsmen outfits', 12),
  ('6 weeks before', 42, 'Bridal party & attire', 'Bridesmaids and flower girls outfits', 13),
  ('6 weeks before', 42, 'Catering & cake', 'Order the cake', 14),
  ('6 weeks before', 42, 'Bridal party & attire', 'Book hair, makeup and nails', 15),
  ('6 weeks before', 42, 'Transport', 'Book the bridal car and guest transport', 16),
  ('6 weeks before', 42, 'Finance', 'Organise pledges from family and friends', 17),
  ('6 weeks before', 42, 'Finance', 'Agree which vendor deposits to pay first', 18),
  ('6 weeks before', 42, 'Venue, power & water', 'Check venue power; book a generator and standby if needed', 19),
  ('6 weeks before', 42, 'Venue, power & water', 'Check venue water; book a water bowser if needed', 20),
  ('4 weeks before', 28, 'Bridal party & attire', 'Buy the rings', 21),
  ('4 weeks before', 28, 'Decor & seating', 'Decor team site visit at the venue', 22),
  ('4 weeks before', 28, 'Security, parking & ushers', 'Arrange overflow parking with a neighbour', 23),
  ('4 weeks before', 28, 'Bridal party & attire', 'Plan a second dressing area if the venue has one changing room', 24),
  ('4 weeks before', 28, 'Catering & cake', 'Finalise the food budget with the caterer', 25),
  ('4 weeks before', 28, 'Finance', 'Gifts table: receipt book and swipe machine', 26),
  ('4 weeks before', 28, 'Programme, MC & music', 'Plan the order of service and programme', 27),
  ('3 weeks before', 21, 'Coordination', 'RSVP deadline: chase anyone who hasn''t replied', 28),
  ('3 weeks before', 21, 'Catering & cake', 'Confirm cooking gas, burners and pots', 29),
  ('3 weeks before', 21, 'Programme, MC & music', 'Test the PA and screens on the venue''s power', 30),
  ('3 weeks before', 21, 'Decor & seating', 'Seating plan (elders and VIPs)', 31),
  ('3 weeks before', 21, 'Security, parking & ushers', 'Recruit 4–6 parking marshals', 32),
  ('3 weeks before', 21, 'Security, parking & ushers', 'Identify ushers and sort their outfits', 33),
  ('3 weeks before', 21, 'Venue, power & water', 'Rain plan: gazebos, umbrellas, mats at the entrance', 34),
  ('3 weeks before', 21, 'Catering & cake', 'Buy non-perishables early (rice, oil, mealie meal, drinks)', 35),
  ('2 weeks before', 14, 'Bridal party & attire', 'Final dress fitting', 36),
  ('2 weeks before', 14, 'Catering & cake', 'Give the final guest count to the caterer', 37),
  ('2 weeks before', 14, 'Bridal party & attire', 'Changing-room schedule (who dresses when)', 38),
  ('2 weeks before', 14, 'Programme, MC & music', 'Prepare the slideshow and song lyrics for the screens', 39),
  ('2 weeks before', 14, 'Finance', 'Pay balances due to vendors', 40),
  ('2 weeks before', 14, 'Coordination', 'Marriage licence and documents ready', 41),
  ('2 weeks before', 14, 'Coordination', 'Buy wedding favours', 42),
  ('1 week before', 7, 'Coordination', 'Final meeting with all vendors: share the day schedule', 43),
  ('1 week before', 7, 'Venue, power & water', 'Confirm water delivery for the day before', 44),
  ('1 week before', 7, 'Venue, power & water', 'Buy and store generator fuel', 45),
  ('1 week before', 7, 'Catering & cake', 'Buy ice and cooler boxes', 46),
  ('1 week before', 7, 'Catering & cake', 'Buy fresh produce and meat', 47),
  ('1 week before', 7, 'Coordination', 'Prepare the emergency kit', 48),
  ('1 week before', 7, 'Programme, MC & music', 'Rehearsal at the venue', 49),
  ('1 week before', 7, 'Bridal party & attire', 'Pack the bride''s and groom''s bags', 50),
  ('Day before', 1, 'Venue, power & water', 'Water tank filled: check the level', 51),
  ('Day before', 1, 'Venue, power & water', 'Generator delivered: test-run all equipment', 52),
  ('Day before', 1, 'Decor & seating', 'Decor setup', 53),
  ('Day before', 1, 'Catering & cake', 'Kitchen setup and food prep', 54),
  ('Day before', 1, 'Security, parking & ushers', 'Put up parking and direction signs', 55),
  ('Day before', 1, 'Venue, power & water', 'Check the weather forecast; set up rain covers', 56),
  ('Day before', 1, 'Bridal party & attire', 'Hand rings and documents to the best man / maid of honour', 57),
  ('Wedding day', 0, 'Venue, power & water', 'Generator on 1 hour before guests arrive', 58),
  ('Wedding day', 0, 'Security, parking & ushers', 'Marshals at the car park 1.5 hours before the start', 59),
  ('Wedding day', 0, 'Bridal party & attire', 'Bride and bridesmaids in the changing room per schedule', 60),
  ('Wedding day', 0, 'Coordination', 'Enjoy the day!', 61),
  ('After', -7, 'Venue, power & water', 'Return hired items (generator, chairs, pots, tents)', 62),
  ('After', -7, 'Venue, power & water', 'Clean the venue and kitchen, hand back keys', 63),
  ('After', -7, 'Finance', 'Pay any outstanding balances', 64),
  ('After', -7, 'Coordination', 'Send thank-you messages', 65),
  ('After', -7, 'Photo & video', 'Collect photos and video', 66);
