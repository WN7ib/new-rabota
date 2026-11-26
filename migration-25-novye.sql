-- Сайт движения «Новые» (novye/): содержимое и заявки «Вступить». Правит админ (is_admin) — из админки в мессенджере.
create table if not exists public.novye_cms (
  type text primary key,           -- settings | team | events | news | site
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.novye_cms enable row level security;
drop policy if exists "novye cms read" on public.novye_cms;
create policy "novye cms read" on public.novye_cms for select using (true);
drop policy if exists "novye cms admin" on public.novye_cms;
create policy "novye cms admin" on public.novye_cms for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.novye_cms to anon, authenticated;
grant insert, update, delete on public.novye_cms to authenticated;

create table if not exists public.novye_join (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  data jsonb not null
);
alter table public.novye_join enable row level security;
drop policy if exists "novye join send" on public.novye_join;
create policy "novye join send" on public.novye_join for insert to anon, authenticated with check (length(data::text) < 4000);
drop policy if exists "novye join admin" on public.novye_join;
create policy "novye join admin" on public.novye_join for select to authenticated using (public.is_admin());
drop policy if exists "novye join del" on public.novye_join;
create policy "novye join del" on public.novye_join for delete to authenticated using (public.is_admin());
grant insert on public.novye_join to anon, authenticated;
grant select, delete on public.novye_join to authenticated;
grant usage on sequence public.novye_join_id_seq to anon, authenticated;
