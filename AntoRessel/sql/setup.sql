-- ════════════════════════════════════════════════
--  AntoRessel — Setup Supabase (à exécuter dans le SQL Editor)
-- ════════════════════════════════════════════════

-- ── 1. PROFILES (compte membre) ──
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text,
  email       text,
  plan        text default 'formation',   -- 'formation' | 'accompagnement'
  created_at  timestamptz default now()
);

-- Crée automatiquement un profil à l'inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', 'Membre'))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2. ORDERS (commandes Stripe — alimentées par le webhook) ──
create table if not exists public.orders (
  id                bigint generated always as identity primary key,
  user_id           uuid references public.profiles(id) on delete set null,
  stripe_session_id text unique,
  product_name      text,
  product_type      text,                  -- 'formation' | 'accompagnement'
  amount            integer,               -- en centimes
  status            text default 'paid',
  created_at        timestamptz default now()
);

-- ── 3. SALES (suivi des ventes Vinted du membre) ──
create table if not exists public.sales (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade,
  name        text not null,
  buy         numeric default 0,
  sell        numeric default 0,
  sold_at     date default current_date,
  notes       text,
  created_at  timestamptz default now()
);

-- ── 4. SITE_CONFIG (contenu éditable depuis l'admin) ──
create table if not exists public.site_config (
  key    text primary key,
  value  text
);

-- ════════════════════════════════════════════════
--  ROW-LEVEL SECURITY
-- ════════════════════════════════════════════════
alter table public.profiles    enable row level security;
alter table public.orders      enable row level security;
alter table public.sales       enable row level security;
alter table public.site_config enable row level security;

-- PROFILES : chacun lit/modifie son profil ; l'admin lit tout
drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select" on public.profiles for select
  using (auth.uid() = id or auth.jwt()->>'email' = 'antoleg78@yahoo.com');
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles for update
  using (auth.uid() = id or auth.jwt()->>'email' = 'antoleg78@yahoo.com');

-- ORDERS : chacun voit ses commandes
drop policy if exists "orders_self_select" on public.orders;
create policy "orders_self_select" on public.orders for select
  using (auth.uid() = user_id or auth.jwt()->>'email' = 'antoleg78@yahoo.com');

-- SALES : chacun gère uniquement ses propres ventes
drop policy if exists "sales_self_all" on public.sales;
create policy "sales_self_all" on public.sales for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- SITE_CONFIG : lecture publique, écriture réservée à l'admin
drop policy if exists "config_public_read" on public.site_config;
create policy "config_public_read" on public.site_config for select
  using (true);
drop policy if exists "config_admin_write" on public.site_config;
create policy "config_admin_write" on public.site_config for all
  using (auth.jwt()->>'email' = 'antoleg78@yahoo.com')
  with check (auth.jwt()->>'email' = 'antoleg78@yahoo.com');
