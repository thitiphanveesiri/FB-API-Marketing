-- PostgreSQL / Supabase schema proposal. Mirrors src/lib/types.ts.
create type user_role as enum ('administrator','marketing_manager','sales_manager','sales_representative','agency','viewer');
create type lead_status as enum ('Not Responded','Very Poor','Average','Qualified','Appointment Booked','Connection Created','New','In-Process','Intake','Converted');
create type lead_quality as enum ('Not Responded','Very Poor','Average','Qualified','Appointment Booked','Connection Created');

create table agencies (id text primary key, name text not null unique, contact text, email text, active boolean not null default true);
create table users (id uuid primary key default gen_random_uuid(), name text not null, email text not null unique, role user_role not null, agency_id text references agencies(id), active boolean not null default true);
create table facebook_pages (id text primary key, meta_page_id text unique, name text not null unique, agency_id text references agencies(id), active boolean not null default true);
create table page_sales_team (page_id text references facebook_pages(id) on delete cascade, user_id uuid references users(id) on delete cascade, primary key (page_id, user_id));
create table campaigns (id text primary key, meta_campaign_id text unique, name text not null, page_id text not null references facebook_pages(id), agency_id text references agencies(id), objective text);
create table ads (id text primary key, meta_ad_id text unique, name text not null, campaign_id text not null references campaigns(id), status text not null, updated_at date);
create table ad_creatives (id bigserial primary key, ad_id text not null references ads(id) on delete cascade, type text, thumbnail_url text);

-- Meta-reported numbers. One row per ad per day. Reach is not additive across days: keep raw per-day values and label sums as approximate.
create table ad_performance (
  ad_id text not null references ads(id), date date not null,
  spend numeric(14,2) not null default 0, reach bigint, impressions bigint not null default 0, clicks bigint, messages bigint, purchases bigint,
  source text not null check (source in ('import','meta_api')), import_id text, imported_at timestamptz not null default now(),
  primary key (ad_id, date)               -- duplicate prevention
);
create index on ad_performance (date);

create table leads (
  id text primary key, page_id text not null references facebook_pages(id),
  ad_id text references ads(id),           -- source ad, nullable when unattributed
  messenger_psid text, name text not null, phone text, email text,
  status lead_status not null default 'Not Responded', quality lead_quality not null default 'Not Responded',
  is_valid boolean not null default true,  -- spam/invalid excluded from all rates
  assigned_to uuid references users(id), created_at timestamptz not null default now(), last_contact_at timestamptz, follow_up_date date,
  first_response_min numeric, follow_up_count int not null default 0, avg_follow_up_hrs numeric,
  unique (page_id, messenger_psid)         -- one conversation = one lead (no double counting)
);
create index on leads (ad_id); create index on leads (assigned_to); create index on leads (status);
create table dropped_leads (lead_id text primary key references leads(id), reason text not null, dropped_at date not null, previous_status lead_status not null, recovery_status text not null default 'Not Started', last_activity text);
create table conversations (id bigserial primary key, lead_id text not null references leads(id), channel text not null default 'messenger');
create table messages (id bigserial primary key, conversation_id bigint not null references conversations(id), lead_id text not null references leads(id), direction text not null check (direction in ('in','out','note')), body text, attachment_url text, sent_at timestamptz not null, meta_message_id text unique);
create table sales_assignments (id bigserial primary key, lead_id text not null references leads(id), user_id uuid references users(id), assigned_at timestamptz not null default now(), assigned_by uuid references users(id));
create table lead_status_history (id bigserial primary key, lead_id text not null references leads(id), from_status lead_status, to_status lead_status not null, changed_by text, note text, changed_at timestamptz not null default now());
create table sales_activities (id bigserial primary key, lead_id text not null references leads(id), user_id uuid references users(id), type text not null, note text, at timestamptz not null default now());
create table quality_evaluations (id bigserial primary key, lead_id text not null references leads(id), reviewer_id uuid not null references users(id), previous_quality lead_quality not null, quality lead_quality not null, scores jsonb, notes text, reason text, evaluated_at timestamptz not null default now());
create table import_history (id text primary key, page_id text references facebook_pages(id), data_type text not null, file_name text, mode text not null check (mode in ('incremental','replace')), total int, imported int, failed int, duplicates int, errors jsonb, imported_by uuid references users(id), at timestamptz not null default now());

-- Row level security (Supabase) — enforce the same scope as the UI:
-- agency users: only ads/campaigns whose campaign.agency_id = their agency_id; sales reps: only leads.assigned_to = auth.uid().
