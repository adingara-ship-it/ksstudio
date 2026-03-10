create extension if not exists pgcrypto;

create table if not exists public.availability_slots (
	id uuid primary key default gen_random_uuid(),
	slot_at timestamptz not null unique,
	is_available boolean not null default true,
	created_at timestamptz not null default now()
);

create table if not exists public.availability_blocked_slots (
	id uuid primary key default gen_random_uuid(),
	slot_at timestamptz not null unique,
	reason text not null default 'admin_removed',
	created_at timestamptz not null default now()
);

create table if not exists public.bookings (
	id uuid primary key default gen_random_uuid(),
	service_code text not null,
	service_name text not null,
	slot_id uuid not null references public.availability_slots(id) on delete restrict,
	slot_at timestamptz not null,
	first_name text not null,
	last_name text not null,
	phone text not null,
	email text not null,
	status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
	cancelled_at timestamptz null,
	created_at timestamptz not null default now()
);

create index if not exists idx_bookings_slot_at on public.bookings(slot_at);
create index if not exists idx_bookings_status on public.bookings(status);
create index if not exists idx_availability_slot_at on public.availability_slots(slot_at);
create index if not exists idx_availability_blocked_slot_at on public.availability_blocked_slots(slot_at);

create table if not exists public.analytics_live_sessions (
	session_id text primary key,
	first_seen_at timestamptz not null default now(),
	last_seen_at timestamptz not null default now(),
	current_path text not null,
	referrer text null,
	user_agent text null,
	updated_at timestamptz not null default now()
);

create table if not exists public.analytics_page_views (
	id uuid primary key default gen_random_uuid(),
	session_id text not null,
	page_path text not null,
	referrer text null,
	user_agent text null,
	created_at timestamptz not null default now()
);

create index if not exists idx_analytics_live_sessions_last_seen
	on public.analytics_live_sessions(last_seen_at desc);
create index if not exists idx_analytics_page_views_created_at
	on public.analytics_page_views(created_at desc);
create index if not exists idx_analytics_page_views_path_created
	on public.analytics_page_views(page_path, created_at desc);
