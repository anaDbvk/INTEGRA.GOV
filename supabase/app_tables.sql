-- SmartIN phone-profile sessions, saved journeys, conversations, and alerts.
-- Apply after schema.sql. Phone numbers are stored only as application-keyed
-- hashes; the app secret must remain stable for existing profile access.

create table if not exists guest_profiles (
  id         uuid primary key default gen_random_uuid(),
  phone_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists guest_devices (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references guest_profiles(id) on delete cascade,
  recovery_token_hash text not null unique,
  created_at          timestamptz not null default now(),
  last_used_at        timestamptz not null default now()
);

create table if not exists guest_sessions (
  session_token_hash text primary key,
  profile_id         uuid not null references guest_profiles(id) on delete cascade,
  device_id          uuid not null references guest_devices(id) on delete cascade,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);
create index if not exists guest_sessions_activity_idx on guest_sessions (last_seen_at);

create table if not exists guest_conversations (
  profile_id uuid primary key references guest_profiles(id) on delete cascade,
  history    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists user_journeys (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references guest_profiles(id) on delete cascade,
  title            text not null,
  goal             text not null,
  language         text not null check (language in ('en', 'pl', 'uk')),
  journey           jsonb not null,
  completed_steps integer[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists user_journeys_profile_created_idx
  on user_journeys (profile_id, created_at desc);

create table if not exists in_app_alerts (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references guest_profiles(id) on delete cascade,
  journey_id uuid references user_journeys(id) on delete set null,
  title      text not null,
  body       text not null default '',
  due_at     timestamptz,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists in_app_alerts_profile_due_idx
  on in_app_alerts (profile_id, due_at);

alter table guest_profiles enable row level security;
alter table guest_devices enable row level security;
alter table guest_sessions enable row level security;
alter table guest_conversations enable row level security;
alter table user_journeys enable row level security;
alter table in_app_alerts enable row level security;

-- Daily assistant message counter (ASSISTANT_DAILY_LIMIT, default 50 per profile per UTC day).
create table if not exists assistant_usage (
  profile_id uuid not null references guest_profiles(id) on delete cascade,
  day        date not null default current_date,
  messages   integer not null default 0,
  primary key (profile_id, day)
);
alter table assistant_usage enable row level security;