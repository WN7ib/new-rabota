alter table public.vacancies add column if not exists pinned boolean not null default false;

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.settings (id, data) values (1, '{"tagline":"Работа, подработка и стажировки для молодёжи от 14 лет. Вакансии по всей России и удалённо.","banner":"","banner_on":false,"submissions_open":true,"support":"","hide_after_days":60}'::jsonb)
on conflict (id) do nothing;
alter table public.settings enable row level security;

drop policy if exists "settings read" on public.settings;
create policy "settings read" on public.settings for select using (true);
drop policy if exists "settings admin write" on public.settings;
create policy "settings admin write" on public.settings for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin insert" on public.vacancies;
create policy "admin insert" on public.vacancies for insert to authenticated with check (public.is_admin());

drop policy if exists "submit pending" on public.vacancies;
create policy "submit pending" on public.vacancies for insert to anon, authenticated
  with check (status = 'pending' and pinned = false and coalesce((select (data->>'submissions_open')::boolean from public.settings where id = 1), true));
