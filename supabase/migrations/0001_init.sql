-- Zaman Sepeti initial schema
-- Supabase / Postgres MVP blueprint

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  phone text,
  city text,
  skills text[] not null default '{}',
  rating numeric(3,2) not null default 0,
  bio text,
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'provider', 'admin')),
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.categories(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null,
  category_id uuid not null references public.categories(id) on delete restrict,
  city text,
  budget_min numeric,
  budget_max numeric,
  status text not null default 'active' check (status in ('draft', 'active', 'expired', 'accepted', 'closed', 'deleted')),
  urgency text not null default '7 gün',
  expires_at timestamptz not null,
  accepted_offer_id uuid,
  offer_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  price numeric,
  eta text,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references public.listings(id) on delete cascade,
  offer_id uuid not null unique references public.offers(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists listings_status_expires_idx on public.listings (status, expires_at desc);
create index if not exists listings_category_status_idx on public.listings (category_id, status);
create index if not exists listings_owner_created_idx on public.listings (owner_id, created_at desc);
create index if not exists offers_listing_status_idx on public.offers (listing_id, status);
create index if not exists offers_sender_created_idx on public.offers (sender_id, created_at desc);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at asc);

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger listings_updated_at
before update on public.listings
for each row execute function public.set_updated_at();

create trigger offers_updated_at
before update on public.offers
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.offers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.listing_images enable row level security;

-- Public read
create policy "categories are public" on public.categories
for select using (true);

create policy "profiles are readable" on public.profiles
for select using (true);

create policy "listings are readable" on public.listings
for select using (status in ('active', 'accepted', 'expired') or owner_id = auth.uid());

create policy "listing images are readable" on public.listing_images
for select using (true);

-- Profiles
create policy "profiles can insert own profile" on public.profiles
for insert with check (id = auth.uid());

create policy "profiles can update own profile" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

-- Listings
create policy "owners can create listings" on public.listings
for insert with check (owner_id = auth.uid());

create policy "owners can update listings" on public.listings
for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owners can delete listings" on public.listings
for delete using (owner_id = auth.uid());

-- Offers
create policy "offers are readable by sender or listing owner" on public.offers
for select using (
  sender_id = auth.uid()
  or exists (
    select 1 from public.listings l
    where l.id = offers.listing_id and l.owner_id = auth.uid()
  )
);

create policy "signed-in users can create offers" on public.offers
for insert with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.listings l
    where l.id = offers.listing_id and l.status = 'active'
  )
);

create policy "senders or owners can update offers" on public.offers
for update using (
  sender_id = auth.uid()
  or exists (
    select 1 from public.listings l
    where l.id = offers.listing_id and l.owner_id = auth.uid()
  )
) with check (
  sender_id = auth.uid()
  or exists (
    select 1 from public.listings l
    where l.id = offers.listing_id and l.owner_id = auth.uid()
  )
);

-- Conversations and messages
create policy "participants can read conversations" on public.conversations
for select using (buyer_id = auth.uid() or provider_id = auth.uid());

create policy "participants can read messages" on public.messages
for select using (
  exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and (c.buyer_id = auth.uid() or c.provider_id = auth.uid())
  )
);

create policy "participants can send messages" on public.messages
for insert with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and (c.buyer_id = auth.uid() or c.provider_id = auth.uid())
  )
);

-- Listing images
create policy "owners manage listing images" on public.listing_images
for all using (
  exists (
    select 1 from public.listings l
    where l.id = listing_images.listing_id and l.owner_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.listings l
    where l.id = listing_images.listing_id and l.owner_id = auth.uid()
  )
);

-- Expiry helper for scheduled function / cron
create or replace function public.expire_old_listings()
returns void
language plpgsql
security definer
as $$
begin
  update public.listings
  set status = 'expired'
  where status = 'active'
    and expires_at < now()
    and accepted_offer_id is null;
end;
$$;

comment on function public.expire_old_listings() is 'Call from Supabase scheduled Edge Function or cron';
