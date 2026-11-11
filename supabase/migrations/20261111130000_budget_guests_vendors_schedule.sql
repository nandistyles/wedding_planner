-- =====================================================================
-- Main budget, guest list, vendors and the day schedule
-- (the matching sheets from the Excel planner), plus venue details for
-- the dashboard. Same access rules as tasks and food: everyone on the
-- wedding reads, planners and members write, share links write.
-- =====================================================================

alter table public.weddings add column if not exists venue_capacity int check (venue_capacity is null or venue_capacity >= 0);
alter table public.weddings add column if not exists venue_notes text;

create table public.budget_items (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  category text not null,
  item text not null,
  provider text,
  contact text,
  qty numeric(10, 2) not null default 1 check (qty >= 0),
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  deposit numeric(12, 2) not null default 0 check (deposit >= 0),
  paid numeric(12, 2) not null default 0 check (paid >= 0),          -- paid after the deposit
  pledged_by text,
  pledged_amount numeric(12, 2) not null default 0 check (pledged_amount >= 0),
  status text not null default 'Not started' check (status in ('Not started', 'In progress', 'Done', 'N/A')),
  feedback text,
  ref_cost numeric(12, 2),                                            -- same item at a previous wedding, for reference
  linked text check (linked in ('food', 'contingency')),             -- cost worked out by the app
  sort int not null default 0
);

create table public.guests (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  name text not null,
  side text check (side in ('Bride', 'Groom', 'Both', 'Church')),
  relationship text,
  phone text,
  confirmed text check (confirmed in ('Yes', 'No', 'Maybe')),
  people int not null default 1 check (people >= 0),
  needs_parking boolean not null default false,
  seating text,
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.vendors (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  service text not null,
  name text,
  phone text,
  date_booked date,
  arrival_time text,
  confirmed boolean not null default false,
  notes text,
  sort int not null default 0
);

create table public.schedule_items (
  id bigint generated always as identity primary key,
  wedding_id uuid not null references public.weddings(id) on delete cascade,
  day text not null default 'Wedding day',
  time text,
  activity text not null,
  place text,
  who text,
  notes text,
  sort int not null default 0
);

create index on public.budget_items (wedding_id);
create index on public.guests (wedding_id);
create index on public.vendors (wedding_id);
create index on public.schedule_items (wedding_id);

alter table public.budget_items   enable row level security;
alter table public.guests         enable row level security;
alter table public.vendors        enable row level security;
alter table public.schedule_items enable row level security;

create policy "read budget"  on public.budget_items for select to authenticated using (private.can_read(wedding_id));
create policy "write budget" on public.budget_items for all    to authenticated using (private.can_write(wedding_id)) with check (private.can_write(wedding_id));
create policy "share: budget" on public.budget_items for all   to anon using (private.shared(wedding_id)) with check (private.shared(wedding_id));

create policy "read guests"  on public.guests for select to authenticated using (private.can_read(wedding_id));
create policy "write guests" on public.guests for all    to authenticated using (private.can_write(wedding_id)) with check (private.can_write(wedding_id));
create policy "share: guests" on public.guests for all   to anon using (private.shared(wedding_id)) with check (private.shared(wedding_id));

create policy "read vendors"  on public.vendors for select to authenticated using (private.can_read(wedding_id));
create policy "write vendors" on public.vendors for all    to authenticated using (private.can_write(wedding_id)) with check (private.can_write(wedding_id));
create policy "share: vendors" on public.vendors for all   to anon using (private.shared(wedding_id)) with check (private.shared(wedding_id));

create policy "read schedule"  on public.schedule_items for select to authenticated using (private.can_read(wedding_id));
create policy "write schedule" on public.schedule_items for all    to authenticated using (private.can_write(wedding_id)) with check (private.can_write(wedding_id));
create policy "share: schedule" on public.schedule_items for all   to anon using (private.shared(wedding_id)) with check (private.shared(wedding_id));
