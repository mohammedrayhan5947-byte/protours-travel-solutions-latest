-- Pro Tours & Travel Solutions: Supabase schema for the website and the CRM.
-- Safe to run more than once (everything is "if not exists"). Run it in the Supabase SQL editor
-- or with `node scripts/db-apply.mjs`.
-- The server writes with the secret (service) key; the browser never gets direct table access:
-- RLS is on and there are no public policies.

create or replace function set_updated_at() returns trigger language plpgsql as $$
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
