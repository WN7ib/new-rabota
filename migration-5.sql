-- New.работа, шаг 5: кабинет работодателя (по секретной ссылке, без регистрации), отзывы о работодателях,
-- мероприятия и запись на них, отметки бота о публикации в канал.
-- Можно запускать повторно. Применяется автоматически из GitHub Actions (если добавлен SUPABASE_ACCESS_TOKEN),
-- или вручную: Supabase → SQL Editor → вставить целиком → Run.

-- ───── вакансии: статус «закрыта работодателем»
alter table public.vacancies drop constraint if exists vacancies_status_check;
alter table public.vacancies add constraint vacancies_status_check check (status in ('pending','approved','rejected','closed'));

-- ───── секретный ключ управления вакансией (хранится только хэш)
create table if not exists public.vacancy_keys (
  vacancy_id uuid primary key references public.vacancies(id) on delete cascade,
  key_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.vacancy_keys enable row level security;
drop policy if exists "keys admin" on public.vacancy_keys;
create policy "keys admin" on public.vacancy_keys for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.nr_hash(k text) returns text language sql immutable as $$ select encode(sha256(convert_to(coalesce(k,''), 'UTF8')), 'hex') $$;

create or replace function public.nr_key_ok(vid uuid, k text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vacancy_keys where vacancy_id = vid and key_hash = public.nr_hash(k)) and char_length(coalesce(k,'')) >= 32
$$;

-- подать вакансию: возвращает id и ключ управления (ключ показываем один раз)
create or replace function public.submit_vacancy(p jsonb) returns table (id uuid, manage_key text)
language plpgsql security definer set search_path = public as $$
declare vid uuid; k text; exp date;
begin
  if not coalesce((select (data->>'submissions_open')::boolean from public.settings where settings.id = 1), true) then
    raise exception 'submissions closed';
  end if;
  if (select count(*) from public.vacancies v where v.status = 'pending' and v.created_at > now() - interval '10 minutes') > 30 then
    raise exception 'too many';
  end if;
  exp := nullif(p->>'expires_at','')::date;
  if exp is not null and (exp < current_date or exp > current_date + 90) then exp := current_date + 30; end if;
  insert into public.vacancies (title, company, city, type, age_min, pay, remote, description, contact, expires_at, status)
  values (trim(p->>'title'), nullif(trim(p->>'company'),''), nullif(trim(p->>'city'),''), coalesce(nullif(p->>'type',''),'Подработка'),
          coalesce((p->>'age_min')::int, 16), nullif(trim(p->>'pay'),''), coalesce((p->>'remote')::boolean, false),
          nullif(trim(p->>'description'),''), trim(p->>'contact'), exp, 'pending')
  returning vacancies.id into vid;
  k := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.vacancy_keys (vacancy_id, key_hash) values (vid, public.nr_hash(k));
  return query select vid, k;
end $$;

create or replace function public.my_vacancy(vid uuid, k text) returns setof public.vacancies
language sql stable security definer set search_path = public as $$
  select v.* from public.vacancies v where v.id = vid and public.nr_key_ok(vid, k)
$$;

-- правка: текст меняется, вакансия снова уходит на проверку
create or replace function public.my_vacancy_update(vid uuid, k text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.nr_key_ok(vid, k) then raise exception 'bad key'; end if;
  update public.vacancies set
    title = trim(p->>'title'), company = nullif(trim(p->>'company'),''), city = nullif(trim(p->>'city'),''),
    type = coalesce(nullif(p->>'type',''),'Подработка'), age_min = coalesce((p->>'age_min')::int, 16),
    pay = nullif(trim(p->>'pay'),''), remote = coalesce((p->>'remote')::boolean, false),
    description = nullif(trim(p->>'description'),''), contact = trim(p->>'contact'),
    status = 'pending', pinned = false, verified = false
  where id = vid and status <> 'closed';
end $$;

create or replace function public.my_vacancy_close(vid uuid, k text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.nr_key_ok(vid, k) then raise exception 'bad key'; end if;
  update public.vacancies set status = 'closed' where id = vid;
end $$;

create or replace function public.my_vacancy_extend(vid uuid, k text, days int) returns date
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if not public.nr_key_ok(vid, k) then raise exception 'bad key'; end if;
  if days not between 7 and 60 then raise exception 'bad days'; end if;
  update public.vacancies set expires_at = greatest(current_date, coalesce(expires_at, current_date)) + days
  where id = vid and status in ('approved','pending') returning expires_at into d;
  return d;
end $$;

grant execute on function public.submit_vacancy(jsonb) to anon, authenticated;
grant execute on function public.my_vacancy(uuid, text) to anon, authenticated;
grant execute on function public.my_vacancy_update(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.my_vacancy_close(uuid, text) to anon, authenticated;
grant execute on function public.my_vacancy_extend(uuid, text, int) to anon, authenticated;
revoke execute on function public.nr_key_ok(uuid, text) from public, anon, authenticated;

-- ───── отзывы о работодателях (видны после проверки)
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company text not null check (char_length(company) between 2 and 120),
  rating int not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 10 and 1500),
  author text check (char_length(author) <= 40),
  status text not null default 'pending' check (status in ('pending','approved','rejected'))
);
create index if not exists reviews_company on public.reviews (lower(company), status);
alter table public.reviews enable row level security;
drop policy if exists "reviews read" on public.reviews;
create policy "reviews read" on public.reviews for select using (status = 'approved' or public.is_admin());
drop policy if exists "reviews submit" on public.reviews;
create policy "reviews submit" on public.reviews for insert to anon, authenticated with check (status = 'pending');
drop policy if exists "reviews admin" on public.reviews;
create policy "reviews admin" on public.reviews for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "reviews admin del" on public.reviews;
create policy "reviews admin del" on public.reviews for delete using (public.is_admin());

-- ───── мероприятия и запись
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text not null check (char_length(title) between 2 and 120),
  starts_at timestamptz not null,
  place text check (char_length(place) <= 160),
  city text check (char_length(city) <= 40),
  kind text not null default 'Мероприятие' check (kind in ('Мероприятие','Волонтёрство','Смена','Обучение')),
  description text check (char_length(description) <= 2000),
  link text check (char_length(link) <= 300),
  capacity int check (capacity is null or capacity > 0),
  published boolean not null default true
);
alter table public.events enable row level security;
drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select using (published or public.is_admin());
drop policy if exists "events admin" on public.events;
create policy "events admin" on public.events for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.event_signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  contact text not null check (char_length(contact) between 3 and 120),
  age int check (age is null or age between 10 and 99),
  chat_id bigint
);
alter table public.event_signups enable row level security;
drop policy if exists "signups admin" on public.event_signups;
create policy "signups admin" on public.event_signups for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.event_signup(eid uuid, p_name text, p_contact text, p_age int) returns int
language plpgsql security definer set search_path = public as $$
declare e record; n int;
begin
  select * into e from public.events where id = eid and published and starts_at > now();
  if not found then raise exception 'closed'; end if;
  select count(*) into n from public.event_signups where event_id = eid;
  if exists (select 1 from public.event_signups where event_id = eid and lower(contact) = lower(trim(p_contact))) then return n; end if;
  if e.capacity is not null and n >= e.capacity then raise exception 'full'; end if;
  insert into public.event_signups (event_id, name, contact, age) values (eid, trim(p_name), trim(p_contact), p_age);
  return n + 1;
end $$;
create or replace function public.event_counts() returns table (event_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select s.event_id, count(*)::int from public.event_signups s join public.events e on e.id = s.event_id where e.published group by s.event_id
$$;
grant execute on function public.event_signup(uuid, text, text, int) to anon, authenticated;
grant execute on function public.event_counts() to anon, authenticated;

-- ───── что бот уже опубликовал или прислал Никите (чтобы не повторять)
create table if not exists public.bot_seen (
  key text primary key,
  at timestamptz not null default now()
);
alter table public.bot_seen enable row level security;
drop policy if exists "bot seen admin" on public.bot_seen;
create policy "bot seen admin" on public.bot_seen for all using (public.is_admin()) with check (public.is_admin());
