-- Pro Tours & Travel Solutions: Supabase schema for the website and the CRM.
-- Safe to run more than once (everything is "if not exists"). Run it in the Supabase SQL editor
-- or with `node scripts/db-apply.mjs`.
-- The server writes with the secret (service) key; the browser never gets direct table access:
-- RLS is on and there are no public policies.

create or replace function set_updated_at() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at = now(); return new; end $$;

-- Every TBO API request/response (TBO wants these kept as JSON). Big Search replies are trimmed by the server.
create table if not exists tbo_logs (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  env         text not null,               -- staging | live
  trace_id    text,
  method      text not null,               -- Authenticate, Search, FareQuote, Ticket...
  kind        text not null check (kind in ('request', 'response')),
  body        jsonb not null
);
create index if not exists tbo_logs_trace on tbo_logs (trace_id, created_at);
create index if not exists tbo_logs_created on tbo_logs (created_at desc);

-- One row per flight booking attempt, from the moment payment starts. Shown in the CRM.
create table if not exists flight_bookings (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  order_ref        text unique not null,
  env              text not null,
  trace_id         text,
  status           text not null default 'payment_pending'
                   check (status in ('payment_pending', 'paid', 'ticketed', 'needs_attention', 'failed', 'cancelled', 'refunded')),
  amount_inr       numeric(12,2),
  payment_id       text,
  razorpay_order_id text,
  customer_name    text,
  contact_phone    text,
  contact_email    text,
  journey          text,                    -- oneway | return | multicity ...
  route            text,                    -- BLR-DEL | DEL-BLR
  travel_date      date,
  return_date      date,
  pax_count        int,
  pax              jsonb not null default '[]',   -- [{type, name, ticket?}] (no passport / date of birth)
  pnr              text,                    -- all PNRs, comma separated (searchable)
  booking_ids      text,                    -- TBO booking ids, comma separated
  legs             jsonb not null default '[]',   -- [{pnr, bookingId, ticketStatus, error, details}]
  assigned_to      text,
  notes            text
);
create index if not exists flight_bookings_status on flight_bookings (status, created_at desc);
create index if not exists flight_bookings_created on flight_bookings (created_at desc);
create index if not exists flight_bookings_phone on flight_bookings (contact_phone);
create index if not exists flight_bookings_pnr on flight_bookings (pnr);
create index if not exists flight_bookings_trace on flight_bookings (trace_id);
drop trigger if exists flight_bookings_updated on flight_bookings;
create trigger flight_bookings_updated before update on flight_bookings for each row execute function set_updated_at();

-- Website enquiries, for the CRM (the sender agrees on the form; see the Privacy Policy).
create table if not exists enquiries (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  name        text,
  phone       text,
  email       text,
  topic       text,
  message     text,
  page        text,                          -- page the enquiry was sent from
  consent     boolean not null default false,
  status      text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'won', 'lost')),
  assigned_to text,
  notes       text
);
create index if not exists enquiries_status on enquiries (status, created_at desc);
create index if not exists enquiries_created on enquiries (created_at desc);
create index if not exists enquiries_phone on enquiries (phone);
drop trigger if exists enquiries_updated on enquiries;
create trigger enquiries_updated before update on enquiries for each row execute function set_updated_at();

-- Timeline for bookings and enquiries: created, paid, ticketed, status changes, staff notes.
create table if not exists crm_events (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  entity     text not null check (entity in ('booking', 'enquiry')),
  entity_id  bigint not null,
  kind       text not null,                 -- created | paid | ticketed | failed | status | assigned | note | payment_failed
  actor      text,                          -- staff email, or 'system' / 'customer'
  data       jsonb not null default '{}'
);
create index if not exists crm_events_entity on crm_events (entity, entity_id, created_at);

-- Editable site content for the CRM (packages, notices, settings).
create table if not exists site_content (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table tbo_logs        enable row level security;
alter table flight_bookings enable row level security;
alter table enquiries       enable row level security;
alter table crm_events      enable row level security;
alter table site_content    enable row level security;
-- No public policies: only the server (secret key) reads/writes.

-- =====================================================================================
-- Optimised server-side functions: one database round trip per CRM / booking action.
-- (Vercel -> Supabase crosses a region; every extra query costs time on the booking path.)
-- Only the server's secret key (service_role) may run them: PUBLIC, anon and authenticated
-- are revoked below, because functions are callable through the public API by default.
-- =====================================================================================

create index if not exists flight_bookings_attention on flight_bookings (created_at desc) where status in ('needs_attention', 'failed');

-- Checkout: create (or refresh) the booking row and log "created" once.
create or replace function crm_record_checkout(p jsonb) returns bigint language plpgsql set search_path = public, pg_temp as $$
declare v_id bigint; v_new boolean;
begin
  insert into flight_bookings (order_ref, env, trace_id, status, amount_inr, razorpay_order_id, customer_name, contact_phone, contact_email, journey, route, travel_date, return_date, pax_count, pax)
  values (p->>'order_ref', p->>'env', p->>'trace_id', 'payment_pending', (p->>'amount_inr')::numeric, p->>'razorpay_order_id', p->>'customer_name', p->>'contact_phone', p->>'contact_email',
          p->>'journey', p->>'route', nullif(p->>'travel_date', '')::date, nullif(p->>'return_date', '')::date, nullif(p->>'pax_count', '')::int, coalesce(p->'pax', '[]'::jsonb))
  on conflict (order_ref) do update set trace_id = excluded.trace_id, amount_inr = excluded.amount_inr, razorpay_order_id = excluded.razorpay_order_id,
    customer_name = excluded.customer_name, contact_phone = excluded.contact_phone, contact_email = excluded.contact_email, journey = excluded.journey,
    route = excluded.route, travel_date = excluded.travel_date, return_date = excluded.return_date, pax_count = excluded.pax_count, pax = excluded.pax
  returning id, (xmax = 0) into v_id, v_new;
  if v_new then
    insert into crm_events (entity, entity_id, kind, actor, data) values ('booking', v_id, 'created', 'customer', jsonb_build_object('amount', p->'amount_inr', 'route', p->>'route'));
  end if;
  return v_id;
end $$;

-- Payment confirmed (never overwrites a later status).
create or replace function crm_record_paid(p_ref text, p_payment text) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  update flight_bookings set status = 'paid', payment_id = p_payment where order_ref = p_ref and status in ('payment_pending', 'paid') returning id into v_id;
  if v_id is not null then
    insert into crm_events (entity, entity_id, kind, actor, data) values ('booking', v_id, 'paid', 'system', jsonb_build_object('paymentId', p_payment));
  end if;
end $$;

create or replace function crm_record_payment_failed(p_ref text, p_message text) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  select id into v_id from flight_bookings where order_ref = p_ref;
  if v_id is not null then
    insert into crm_events (entity, entity_id, kind, actor, data) values ('booking', v_id, 'payment_failed', 'system', jsonb_build_object('message', left(coalesce(p_message, ''), 300)));
  end if;
end $$;

-- Ticketing finished: final status, PNRs, ticket numbers merged into the passenger list, timeline entry.
create or replace function crm_record_outcome(p jsonb) returns text language plpgsql set search_path = public, pg_temp as $$
declare v_id bigint; v_pnr text;
begin
  update flight_bookings f set
    status = p->>'status',
    payment_id = coalesce(p->>'payment_id', f.payment_id),
    legs = coalesce(p->'legs', '[]'::jsonb),
    pnr = nullif(p->>'pnr', ''),
    booking_ids = nullif(p->>'booking_ids', ''),
    pax = coalesce((select jsonb_agg(x || jsonb_build_object('ticket', coalesce(p->'tickets'->>upper(x->>'name'), x->>'ticket', ''))) from jsonb_array_elements(f.pax) x), f.pax)
  where f.order_ref = p->>'order_ref'
  returning f.id, f.pnr into v_id, v_pnr;
  if v_id is not null then
    insert into crm_events (entity, entity_id, kind, actor, data)
    values ('booking', v_id, case when p->>'status' = 'ticketed' then 'ticketed' else 'failed' end, 'system',
            jsonb_build_object('status', p->>'status', 'pnr', v_pnr, 'errors', coalesce(p->'errors', '[]'::jsonb)));
  end if;
  return p->>'status';
end $$;

-- Website enquiry: drops a double-click (same phone within 10 minutes), refuses a flood (150 in 10 minutes).
-- Returns the new id, 0 for a duplicate, -1 when busy.
create or replace function crm_add_enquiry(p jsonb) returns bigint language plpgsql set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  if (select count(*) from enquiries where created_at > now() - interval '10 minutes') >= 150 then return -1; end if;
  if exists (select 1 from enquiries where phone = p->>'phone' and created_at > now() - interval '10 minutes') then return 0; end if;
  insert into enquiries (name, phone, email, topic, message, page, consent)
  values (p->>'name', p->>'phone', nullif(p->>'email', ''), nullif(p->>'topic', ''), nullif(p->>'message', ''), nullif(p->>'page', ''), true)
  returning id into v_id;
  insert into crm_events (entity, entity_id, kind, actor, data) values ('enquiry', v_id, 'created', 'customer', jsonb_build_object('page', p->>'page', 'topic', p->>'topic'));
  return v_id;
end $$;

-- Dashboard: every number in one query, aggregated in the database (no rows shipped to the server).
create or replace function crm_overview() returns jsonb language sql stable set search_path = public, pg_temp as $$
  with tz as (select (now() at time zone 'Asia/Kolkata')::date as today),
  b as (select status, amount_inr, created_at, (created_at at time zone 'Asia/Kolkata')::date as day from flight_bookings where created_at >= now() - interval '120 days'),
  e as (select status, (created_at at time zone 'Asia/Kolkata')::date as day from enquiries where created_at >= now() - interval '120 days'),
  days as (select generate_series((select today from tz) - 13, (select today from tz), interval '1 day')::date as day)
  select jsonb_build_object(
    'today', (select today from tz),
    'bookings', (select jsonb_build_object(
        'ticketed', count(*) filter (where status = 'ticketed'),
        'attention', count(*) filter (where status in ('needs_attention', 'failed')),
        'pending', count(*) filter (where status = 'payment_pending'),
        'abandoned', count(*) filter (where status = 'payment_pending' and created_at < now() - interval '30 minutes'),
        'total', count(*),
        'revenueToday', coalesce(sum(amount_inr) filter (where status = 'ticketed' and day = (select today from tz)), 0),
        'revenue7', coalesce(sum(amount_inr) filter (where status = 'ticketed' and created_at >= now() - interval '7 days'), 0),
        'revenue30', coalesce(sum(amount_inr) filter (where status = 'ticketed' and created_at >= now() - interval '30 days'), 0)) from b),
    'enquiries', (select jsonb_build_object(
        'new', count(*) filter (where status = 'new'), 'contacted', count(*) filter (where status = 'contacted'), 'quoted', count(*) filter (where status = 'quoted'),
        'won', count(*) filter (where status = 'won'), 'lost', count(*) filter (where status = 'lost'), 'total', count(*)) from e),
    'daily', (select jsonb_agg(jsonb_build_object('date', d.day,
        'bookings', (select count(*) from b where b.day = d.day and b.status = 'ticketed'),
        'revenue', (select coalesce(sum(amount_inr), 0) from b where b.day = d.day and b.status = 'ticketed'),
        'enquiries', (select count(*) from e where e.day = d.day)) order by d.day) from days d),
    'recentBookings', (select coalesce(jsonb_agg(r), '[]'::jsonb) from (select id, order_ref, status, amount_inr, customer_name, route, created_at from flight_bookings order by created_at desc limit 8) r),
    'recentEnquiries', (select coalesce(jsonb_agg(r), '[]'::jsonb) from (select id, name, phone, topic, status, created_at from enquiries order by created_at desc limit 8) r),
    'needsAttention', (select coalesce(jsonb_agg(r), '[]'::jsonb) from (select id, order_ref, status, customer_name, route, contact_phone, created_at from flight_bookings where status in ('needs_attention', 'failed') order by created_at desc limit 10) r)
  )
$$;

-- Booking panel: the row, its timeline and its TBO calls in one trip (null when not found).
create or replace function crm_booking_detail(p_id bigint) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'booking', to_jsonb(b),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at, e.id) from crm_events e where e.entity = 'booking' and e.entity_id = b.id), '[]'::jsonb),
    'calls', case when b.trace_id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'created_at', l.created_at, 'method', l.method, 'kind', l.kind) order by l.created_at, l.id)
              from (select id, created_at, method, kind from tbo_logs where trace_id = b.trace_id order by created_at, id limit 300) l), '[]'::jsonb) end)
  from flight_bookings b where b.id = p_id
$$;

-- Staff edit (status / assignee / note) for a booking or an enquiry: change + timeline in one transaction.
create or replace function crm_apply_update(p_entity text, p_id bigint, p_status text, p_assigned text, p_set_assigned boolean, p_note text, p_actor text) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare cur_status text; cur_assigned text;
begin
  if p_entity = 'booking' then select status, assigned_to into cur_status, cur_assigned from flight_bookings where id = p_id for update;
  elsif p_entity = 'enquiry' then select status, assigned_to into cur_status, cur_assigned from enquiries where id = p_id for update;
  else raise exception 'bad entity'; end if;
  if not found then return jsonb_build_object('found', false); end if;
  if p_status is not null and p_status <> cur_status then
    if p_entity = 'booking' then update flight_bookings set status = p_status where id = p_id; else update enquiries set status = p_status where id = p_id; end if;
    insert into crm_events (entity, entity_id, kind, actor, data) values (p_entity, p_id, 'status', p_actor, jsonb_build_object('from', cur_status, 'to', p_status));
  end if;
  if p_set_assigned and coalesce(p_assigned, '') <> coalesce(cur_assigned, '') then
    if p_entity = 'booking' then update flight_bookings set assigned_to = nullif(p_assigned, '') where id = p_id; else update enquiries set assigned_to = nullif(p_assigned, '') where id = p_id; end if;
    insert into crm_events (entity, entity_id, kind, actor, data) values (p_entity, p_id, 'assigned', p_actor, jsonb_build_object('from', cur_assigned, 'to', nullif(p_assigned, '')));
  end if;
  if coalesce(p_note, '') <> '' then
    insert into crm_events (entity, entity_id, kind, actor, data) values (p_entity, p_id, 'note', p_actor, jsonb_build_object('text', p_note));
  end if;
  return jsonb_build_object('found', true);
end $$;

-- TBO traces: grouped in the database (60 rows back instead of 1,500).
create or replace function crm_traces(p_limit int, p_days int) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(t order by t."at" desc), '[]'::jsonb) from (
    select l.trace_id as "traceId",
           count(*) filter (where l.kind = 'request') as calls,
           array_agg(distinct l.method) as methods,
           min(l.created_at) as "at", max(l.created_at) as last,
           (select jsonb_build_object('id', b.id, 'order_ref', b.order_ref, 'status', b.status) from flight_bookings b where b.trace_id = l.trace_id limit 1) as booking
    from tbo_logs l
    where l.trace_id is not null and l.created_at >= now() - make_interval(days => p_days)
    group by l.trace_id order by min(l.created_at) desc limit p_limit
  ) t
$$;

-- Housekeeping, run daily by the cron job (and by the Settings clean-up button): keeps the free 500 MB database small
-- and honours the Privacy Policy (enquiries that did not become a booking go after 12 months; "won" ones stay).
create or replace function crm_cleanup(p_log_days int, p_enq_months int) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare n_logs bigint := 0; n_enq bigint := 0; ids bigint[];
begin
  if p_log_days is not null then
    delete from tbo_logs where created_at < now() - make_interval(days => p_log_days);
    get diagnostics n_logs = row_count;
  end if;
  if p_enq_months is not null then
    select array_agg(id) into ids from enquiries where created_at < now() - make_interval(months => p_enq_months) and status <> 'won';
    if ids is not null then
      delete from crm_events where entity = 'enquiry' and entity_id = any(ids);
      delete from enquiries where id = any(ids);
      n_enq := array_length(ids, 1);
    end if;
  end if;
  return jsonb_build_object('tboLogsDeleted', n_logs, 'enquiriesDeleted', n_enq);
end $$;

-- ---- lock everything to the server's secret key (service_role) only ----
revoke all on table tbo_logs, flight_bookings, enquiries, crm_events, site_content from anon, authenticated;
revoke all on sequence tbo_logs_id_seq, flight_bookings_id_seq, enquiries_id_seq, crm_events_id_seq from anon, authenticated;
revoke all on function crm_record_checkout(jsonb), crm_record_paid(text, text), crm_record_payment_failed(text, text), crm_record_outcome(jsonb), crm_add_enquiry(jsonb),
  crm_overview(), crm_booking_detail(bigint), crm_apply_update(text, bigint, text, text, boolean, text, text), crm_traces(int, int), crm_cleanup(int, int), set_updated_at()
  from public, anon, authenticated;
grant execute on function crm_record_checkout(jsonb), crm_record_paid(text, text), crm_record_payment_failed(text, text), crm_record_outcome(jsonb), crm_add_enquiry(jsonb),
  crm_overview(), crm_booking_detail(bigint), crm_apply_update(text, bigint, text, text, boolean, text, text), crm_traces(int, int), crm_cleanup(int, int) to service_role;