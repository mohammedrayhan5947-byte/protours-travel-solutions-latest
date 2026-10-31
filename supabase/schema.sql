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
-- Customer accounts: the Supabase Auth user who booked while signed in (guests leave it null).
alter table flight_bookings add column if not exists user_id uuid;
create index if not exists flight_bookings_user on flight_bookings (user_id, created_at desc) where user_id is not null;
create index if not exists flight_bookings_email on flight_bookings (lower(contact_email));
-- Payments. checkout_token is the sealed (AES-GCM) booking data the webhook needs to issue the ticket if the customer's browser
-- closed after paying; it is cleared the moment ticketing finishes and never shown in the CRM or to customers.
alter table flight_bookings add column if not exists checkout_token text;
alter table flight_bookings add column if not exists paid_inr numeric(12,2);
alter table flight_bookings add column if not exists refunded_inr numeric(12,2) not null default 0;
-- one Razorpay payment can only ever pay for one booking
create unique index if not exists flight_bookings_payment_unique on flight_bookings (payment_id) where payment_id is not null;
create index if not exists flight_bookings_rzp_order on flight_bookings (razorpay_order_id) where razorpay_order_id is not null;
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

-- Every Razorpay webhook delivery, once (their X-Razorpay-Event-Id): retries and replays are recognised and ignored.
create table if not exists payment_events (
  event_id    text primary key,
  received_at timestamptz not null default now(),
  event       text,
  payment_id  text,
  order_id    text,
  outcome     text
);
create index if not exists payment_events_received on payment_events (received_at);

alter table payment_events   enable row level security;
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
  insert into flight_bookings (order_ref, env, trace_id, status, amount_inr, razorpay_order_id, customer_name, contact_phone, contact_email, journey, route, travel_date, return_date, pax_count, pax, user_id, checkout_token)
  values (p->>'order_ref', p->>'env', p->>'trace_id', 'payment_pending', (p->>'amount_inr')::numeric, p->>'razorpay_order_id', p->>'customer_name', p->>'contact_phone', p->>'contact_email',
          p->>'journey', p->>'route', nullif(p->>'travel_date', '')::date, nullif(p->>'return_date', '')::date, nullif(p->>'pax_count', '')::int, coalesce(p->'pax', '[]'::jsonb), nullif(p->>'user_id', '')::uuid, nullif(p->>'checkout_token', ''))
  on conflict (order_ref) do update set trace_id = excluded.trace_id, amount_inr = excluded.amount_inr, razorpay_order_id = excluded.razorpay_order_id,
    customer_name = excluded.customer_name, contact_phone = excluded.contact_phone, contact_email = excluded.contact_email, journey = excluded.journey,
    route = excluded.route, travel_date = excluded.travel_date, return_date = excluded.return_date, pax_count = excluded.pax_count, pax = excluded.pax,
    user_id = coalesce(excluded.user_id, flight_bookings.user_id), checkout_token = coalesce(excluded.checkout_token, flight_bookings.checkout_token)
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
    checkout_token = null,
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
    'booking', to_jsonb(b) - 'checkout_token',
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at, e.id) from crm_events e where e.entity = 'booking' and e.entity_id = b.id), '[]'::jsonb),
    'calls', case when b.trace_id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'created_at', l.created_at, 'method', l.method, 'kind', l.kind) order by l.created_at, l.id)
              from (select id, created_at, method, kind from tbo_logs where trace_id = b.trace_id order by created_at, id limit 300) l), '[]'::jsonb) end)
  from flight_bookings b where b.id = p_id
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Payments. Exactly one caller (the customer's browser OR the Razorpay webhook) may start ticketing a paid booking:
-- the status flips payment_pending -> paid in ONE statement, and only the caller whose update changed a row gets 'claimed'.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function crm_claim_ticketing(p_ref text, p_payment text, p_paid numeric) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_id bigint; v_status text; v_pay text;
begin
  update flight_bookings set status = 'paid', payment_id = p_payment, paid_inr = p_paid
   where order_ref = p_ref and status = 'payment_pending' and (payment_id is null or payment_id = p_payment)
   returning id into v_id;
  if v_id is not null then
    insert into crm_events (entity, entity_id, kind, actor, data) values ('booking', v_id, 'paid', 'system', jsonb_build_object('paymentId', p_payment, 'amount', p_paid));
    return jsonb_build_object('claimed', true, 'status', 'paid');
  end if;
  select status, payment_id into v_status, v_pay from flight_bookings where order_ref = p_ref;
  if not found then return jsonb_build_object('claimed', false, 'status', null); end if;
  return jsonb_build_object('claimed', false, 'status', v_status, 'paymentId', v_pay);
end $$;

-- The booking a Razorpay order belongs to, with the sealed checkout data (server only).
create or replace function crm_for_order(p_order text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('order_ref', order_ref, 'status', status, 'amount_inr', amount_inr, 'payment_id', payment_id, 'checkout_token', checkout_token, 'env', env)
  from flight_bookings where razorpay_order_id = p_order
$$;

-- What the customer's browser (or a retry) should be shown for a booking that is already being / has been ticketed.
create or replace function crm_outcome(p_ref text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('status', status, 'amount_inr', amount_inr, 'legs', legs) from flight_bookings where order_ref = p_ref
$$;

-- A webhook delivery seen for the first time returns true; a retry / replay returns false.
create or replace function crm_webhook_seen(p_event_id text, p_event text, p_payment text, p_order text) returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  insert into payment_events (event_id, event, payment_id, order_id) values (p_event_id, p_event, p_payment, p_order) on conflict (event_id) do nothing;
  return found;
end $$;

create or replace function crm_webhook_done(p_event_id text, p_outcome text) returns void language sql set search_path = public, pg_temp as $$
  update payment_events set outcome = left(p_outcome, 200) where event_id = p_event_id
$$;

-- A payment event worth showing on the booking's timeline (failed attempt, paid but could not be ticketed, refund).
create or replace function crm_payment_note(p_order text, p_kind text, p_data jsonb) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  select id into v_id from flight_bookings where razorpay_order_id = p_order;
  if v_id is not null then insert into crm_events (entity, entity_id, kind, actor, data) values ('booking', v_id, p_kind, 'razorpay', coalesce(p_data, '{}'::jsonb)); end if;
end $$;

-- Paid, but the sealed checkout data had expired (the customer paid after the 15-minute hold): needs a person, probably a refund.
create or replace function crm_mark_unfulfilled(p_order text, p_payment text, p_paid numeric, p_reason text) returns void language plpgsql set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  update flight_bookings set status = 'needs_attention', payment_id = coalesce(payment_id, p_payment), paid_inr = coalesce(paid_inr, p_paid), checkout_token = null
   where razorpay_order_id = p_order and status = 'payment_pending' returning id into v_id;
  if v_id is not null then
    insert into crm_events (entity, entity_id, kind, actor, data) values ('booking', v_id, 'failed', 'razorpay', jsonb_build_object('status', 'needs_attention', 'errors', jsonb_build_array(p_reason), 'paymentId', p_payment));
  end if;
end $$;

-- Bookings still "awaiting payment" 20 minutes to 3 days after they started: the daily check asks Razorpay whether any were actually paid.
create or replace function crm_stale_pending(p_limit int) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_ref', order_ref, 'razorpay_order_id', razorpay_order_id, 'amount_inr', amount_inr)), '[]'::jsonb)
  from (select order_ref, razorpay_order_id, amount_inr from flight_bookings
         where status = 'payment_pending' and razorpay_order_id is not null and razorpay_order_id not like 'test\_%'
           and created_at < now() - interval '20 minutes' and created_at > now() - interval '3 days'
         order by created_at limit least(greatest(p_limit, 1), 50)) x
$$;

-- What a refund needs to know (staff only, called from the CRM).
create or replace function crm_booking_for_refund(p_id bigint) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id', id, 'order_ref', order_ref, 'status', status, 'payment_id', payment_id, 'paid_inr', paid_inr, 'refunded_inr', refunded_inr, 'env', env)
  from flight_bookings where id = p_id
$$;

-- A refund Razorpay accepted (or later confirmed): once per refund id, adds to refunded_inr, marks 'refunded' when all of it is back.
create or replace function crm_record_refund(p jsonb) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_id bigint; v_paid numeric; v_refunded numeric; v_amount numeric := (p->>'amount_inr')::numeric;
begin
  select id, paid_inr into v_id, v_paid from flight_bookings
   where (p->>'order_ref' is not null and order_ref = p->>'order_ref') or (p->>'order_ref' is null and payment_id = p->>'payment_id') for update;
  if not found then return jsonb_build_object('found', false); end if;
  if exists (select 1 from crm_events where entity = 'booking' and entity_id = v_id and kind = 'refund' and data->>'refundId' = p->>'refund_id') then
    return jsonb_build_object('found', true, 'duplicate', true);
  end if;
  update flight_bookings set refunded_inr = refunded_inr + v_amount where id = v_id returning refunded_inr into v_refunded;
  if v_paid is not null and v_refunded >= v_paid then update flight_bookings set status = 'refunded' where id = v_id; end if;
  insert into crm_events (entity, entity_id, kind, actor, data)
  values ('booking', v_id, 'refund', coalesce(p->>'actor', 'razorpay'), jsonb_build_object('refundId', p->>'refund_id', 'amount', v_amount, 'reason', p->>'reason', 'status', p->>'status'));
  return jsonb_build_object('found', true, 'duplicate', false, 'refunded', v_refunded, 'full', v_paid is not null and v_refunded >= v_paid);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Customer accounts ("My trips"). The API passes the user id from the VERIFIED login token, and the e-mail only
-- when that e-mail is verified, so a customer sees their own bookings and nobody else's. Only customer-safe
-- columns come back: no staff notes, assignee, internal status history or TBO error text.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function acct_bookings(p_user uuid, p_email text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) from (
    select b.order_ref, b.created_at, b.status, b.amount_inr, b.route, b.journey, b.travel_date, b.return_date, b.pax_count, b.pnr, b.customer_name, b.env
    from flight_bookings b
    where p_user is not null and (b.user_id = p_user or (nullif(p_email, '') is not null and lower(b.contact_email) = lower(p_email)))
    order by b.created_at desc limit 60
  ) x
$$;

create or replace function acct_booking(p_user uuid, p_email text, p_ref text) returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'booking', jsonb_build_object(
      'order_ref', b.order_ref, 'created_at', b.created_at, 'status', b.status, 'amount_inr', b.amount_inr, 'route', b.route, 'journey', b.journey,
      'travel_date', b.travel_date, 'return_date', b.return_date, 'pax_count', b.pax_count, 'pnr', b.pnr, 'customer_name', b.customer_name, 'env', b.env,
      'contact_email', b.contact_email, 'contact_phone', b.contact_phone,
      'pax', (select coalesce(jsonb_agg(jsonb_build_object('type', x->>'type', 'name', x->>'name', 'ticket', x->>'ticket')), '[]'::jsonb) from jsonb_array_elements(b.pax) x),
      'legs', (select coalesce(jsonb_agg(jsonb_build_object('pnr', l->>'pnr', 'bookingId', l->'bookingId', 'details', l->'details')), '[]'::jsonb) from jsonb_array_elements(b.legs) l)),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'created_at', e.created_at) order by e.created_at, e.id)
                        from crm_events e where e.entity = 'booking' and e.entity_id = b.id and e.kind in ('created', 'paid', 'payment_failed', 'ticketed', 'failed')), '[]'::jsonb))
  from flight_bookings b
  where p_user is not null and b.order_ref = p_ref and (b.user_id = p_user or (nullif(p_email, '') is not null and lower(b.contact_email) = lower(p_email)))
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
  update flight_bookings set checkout_token = null where checkout_token is not null and created_at < now() - interval '1 day';
  delete from payment_events where received_at < now() - interval '90 days';
  return jsonb_build_object('tboLogsDeleted', n_logs, 'enquiriesDeleted', n_enq);
end $$;

-- ---- lock everything to the server's secret key (service_role) only ----
revoke all on table tbo_logs, flight_bookings, enquiries, crm_events, site_content, payment_events from anon, authenticated;
revoke all on sequence tbo_logs_id_seq, flight_bookings_id_seq, enquiries_id_seq, crm_events_id_seq from anon, authenticated;
revoke all on function crm_record_checkout(jsonb), crm_record_paid(text, text), crm_record_payment_failed(text, text), crm_record_outcome(jsonb), crm_add_enquiry(jsonb),
  crm_overview(), crm_booking_detail(bigint), crm_apply_update(text, bigint, text, text, boolean, text, text), crm_traces(int, int), crm_cleanup(int, int), set_updated_at(),
  acct_bookings(uuid, text), acct_booking(uuid, text, text),
  crm_claim_ticketing(text, text, numeric), crm_for_order(text), crm_outcome(text), crm_webhook_seen(text, text, text, text), crm_webhook_done(text, text),
  crm_payment_note(text, text, jsonb), crm_mark_unfulfilled(text, text, numeric, text), crm_booking_for_refund(bigint), crm_record_refund(jsonb), crm_stale_pending(int)
  from public, anon, authenticated;
grant execute on function crm_record_checkout(jsonb), crm_record_paid(text, text), crm_record_payment_failed(text, text), crm_record_outcome(jsonb), crm_add_enquiry(jsonb),
  crm_overview(), crm_booking_detail(bigint), crm_apply_update(text, bigint, text, text, boolean, text, text), crm_traces(int, int), crm_cleanup(int, int),
  acct_bookings(uuid, text), acct_booking(uuid, text, text),
  crm_claim_ticketing(text, text, numeric), crm_for_order(text), crm_outcome(text), crm_webhook_seen(text, text, text, text), crm_webhook_done(text, text),
  crm_payment_note(text, text, jsonb), crm_mark_unfulfilled(text, text, numeric, text), crm_booking_for_refund(bigint), crm_record_refund(jsonb), crm_stale_pending(int) to service_role;