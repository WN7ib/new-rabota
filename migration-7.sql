-- New.работа, шаг 7: кабинет работодателя со входом через Telegram, анкеты-отклики, смены с записью.
-- Можно запускать повторно. Доступ к данным работодателя — только через функции ниже по секретному токену входа.

-- ───── работодатели и вход через бота
create table if not exists public.employers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tg_chat bigint unique,
  name text check (char_length(name) <= 60),
  username text check (char_length(username) <= 40),
  company text check (char_length(company) <= 60)
);
create table if not exists public.emp_sessions (
  token_hash text primary key,
  employer_id uuid not null references public.employers(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.emp_login (
  nonce text primary key check (char_length(nonce) between 16 and 64),
  created_at timestamptz not null default now(),
  employer_id uuid references public.employers(id) on delete cascade,
  token text
);
alter table public.employers enable row level security;
alter table public.emp_sessions enable row level security;
alter table public.emp_login enable row level security;
drop policy if exists "employers admin" on public.employers;
create policy "employers admin" on public.employers for all using (public.is_admin()) with check (public.is_admin());

alter table public.vacancies add column if not exists employer_id uuid references public.employers(id) on delete set null;
alter table public.events add column if not exists employer_id uuid references public.employers(id) on delete set null;
alter table public.events add column if not exists listed boolean not null default true;   -- смены работодателя не показываются в общем списке

-- ───── анкеты-отклики
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  vacancy_id uuid not null references public.vacancies(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  age int check (age is null or age between 14 and 99),
  contact text not null check (char_length(contact) between 3 and 120),
  message text check (char_length(message) <= 600),
  status text not null default 'new' check (status in ('new','accepted','rejected')),
  notified boolean not null default false
);
create index if not exists applications_vac on public.applications (vacancy_id, created_at desc);
alter table public.applications enable row level security;
drop policy if exists "applications admin" on public.applications;
create policy "applications admin" on public.applications for all using (public.is_admin()) with check (public.is_admin());

-- ───── служебное
create or replace function public.nr_emp(t text) returns uuid language sql stable security definer set search_path = public as $$
  select s.employer_id from public.emp_sessions s where s.token_hash = public.nr_hash(t) and length(coalesce(t,'')) >= 32
$$;
revoke execute on function public.nr_emp(text) from public, anon, authenticated;

-- 1) сайт: начать вход (случайный код из браузера → ссылка в бот t.me/бот?start=login_КОД)
create or replace function public.emp_login_start(p_nonce text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_nonce !~ '^[A-Za-z0-9]{16,64}$' then raise exception 'bad nonce'; end if;
  delete from public.emp_login where created_at < now() - interval '30 minutes';
  if (select count(*) from public.emp_login where created_at > now() - interval '10 minutes') > 200 then raise exception 'too many'; end if;
  insert into public.emp_login (nonce) values (p_nonce) on conflict do nothing;
end $$;

-- 2) бот: человек нажал «Старт» по ссылке входа (вызывает только бот: модератор или сервер)
create or replace function public.emp_login_confirm(p_nonce text, p_chat bigint, p_name text, p_username text) returns text
language plpgsql security definer set search_path = public as $$
declare eid uuid; tok text;
begin
  if not (public.is_admin() or coalesce(auth.role(),'') = 'service_role') then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.emp_login where nonce = p_nonce and created_at > now() - interval '30 minutes' and token is null) then return null; end if;
  insert into public.employers (tg_chat, name, username) values (p_chat, left(p_name,60), left(p_username,40))
    on conflict (tg_chat) do update set name = excluded.name, username = excluded.username
    returning id into eid;
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.emp_sessions (token_hash, employer_id) values (public.nr_hash(tok), eid);
  update public.emp_login set employer_id = eid, token = tok where nonce = p_nonce;
  return coalesce((select company from public.employers where id = eid), '');
end $$;

-- 3) сайт: забрать токен (один раз)
create or replace function public.emp_login_check(p_nonce text) returns text
language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  select token into tok from public.emp_login where nonce = p_nonce and token is not null;
  if tok is not null then delete from public.emp_login where nonce = p_nonce; end if;
  return tok;
end $$;

create or replace function public.emp_logout(t text) returns void language sql security definer set search_path = public as $$
  delete from public.emp_sessions where token_hash = public.nr_hash(t)
$$;

create or replace function public.emp_me(t text) returns table (id uuid, name text, username text, company text)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.username, e.company from public.employers e where e.id = public.nr_emp(t)
$$;
create or replace function public.emp_set_company(t text, p_company text) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.nr_emp(t) is null then raise exception 'bad token'; end if;
  update public.employers set company = nullif(left(trim(p_company),60),'') where id = public.nr_emp(t);
end $$;

-- ───── вакансии работодателя
create or replace function public.emp_vacancies(t text) returns setof public.vacancies
language sql stable security definer set search_path = public as $$
  select v.* from public.vacancies v where v.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null order by v.created_at desc
$$;
-- привязать вакансию, размещённую по личной ссылке
create or replace function public.emp_claim(t text, vid uuid, k text) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.nr_emp(t) is null then raise exception 'bad token'; end if;
  if not public.nr_key_ok(vid, k) then raise exception 'bad key'; end if;
  update public.vacancies set employer_id = public.nr_emp(t) where id = vid;
end $$;
-- ключ управления для своей вакансии: дальше работают все функции кабинета по ключу (продлить, исправить, закрыть, продвинуть)
create or replace function public.emp_vacancy_key(t text, vid uuid) returns text language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if public.nr_emp(t) is null or not exists (select 1 from public.vacancies where id = vid and employer_id = public.nr_emp(t)) then raise exception 'not yours'; end if;
  k := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.vacancy_keys (vacancy_id, key_hash) values (vid, public.nr_hash(k))
    on conflict (vacancy_id) do update set key_hash = excluded.key_hash;
  return k;
end $$;

-- ───── анкеты
create or replace function public.apply(vid uuid, p_name text, p_age int, p_contact text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.vacancies where id = vid and status = 'approved') then raise exception 'closed'; end if;
  if (select count(*) from public.applications where created_at > now() - interval '10 minutes') > 100 then raise exception 'too many'; end if;
  if exists (select 1 from public.applications where vacancy_id = vid and lower(contact) = lower(trim(p_contact)) and created_at > now() - interval '1 day') then return; end if;
  insert into public.applications (vacancy_id, name, age, contact, message)
    values (vid, trim(p_name), case when p_age between 14 and 99 then p_age end, trim(p_contact), nullif(left(trim(coalesce(p_message,'')),600),''));
  update public.vacancies set clicks = clicks + 1 where id = vid;
end $$;
create or replace function public.emp_apps(t text) returns table (id uuid, created_at timestamptz, vacancy_id uuid, vacancy_title text, name text, age int, contact text, message text, status text)
language sql stable security definer set search_path = public as $$
  select a.id, a.created_at, a.vacancy_id, v.title, a.name, a.age, a.contact, a.message, a.status
  from public.applications a join public.vacancies v on v.id = a.vacancy_id
  where v.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null order by a.created_at desc limit 300
$$;
create or replace function public.emp_app_status(t text, aid uuid, p_status text) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('new','accepted','rejected') then raise exception 'bad status'; end if;
  update public.applications a set status = p_status from public.vacancies v
  where a.id = aid and v.id = a.vacancy_id and v.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null;
end $$;

-- ───── смены (это мероприятия вида «Смена», не видны в общем списке; люди записываются по ссылке в бот)
create or replace function public.emp_events(t text) returns table (id uuid, title text, starts_at timestamptz, place text, city text, kind text, description text, capacity int, published boolean, n int)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.starts_at, e.place, e.city, e.kind, e.description, e.capacity, e.published,
    (select count(*)::int from public.event_signups s where s.event_id = e.id)
  from public.events e where e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null order by e.starts_at desc limit 200
$$;
create or replace function public.emp_event_save(t text, eid uuid, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := public.nr_emp(t); id2 uuid;
begin
  if me is null then raise exception 'bad token'; end if;
  if eid is null then
    if (select count(*) from public.events where employer_id = me and created_at > now() - interval '1 day') > 50 then raise exception 'too many'; end if;
    insert into public.events (title, starts_at, place, city, kind, description, capacity, published, listed, employer_id)
    values (trim(p->>'title'), (p->>'starts_at')::timestamptz, nullif(trim(p->>'place'),''), nullif(trim(p->>'city'),''), 'Смена',
      nullif(trim(p->>'description'),''), nullif(p->>'capacity','')::int, true, false, me)
    returning events.id into id2;
    return id2;
  end if;
  update public.events set title = trim(p->>'title'), starts_at = (p->>'starts_at')::timestamptz, place = nullif(trim(p->>'place'),''),
    city = nullif(trim(p->>'city'),''), description = nullif(trim(p->>'description'),''), capacity = nullif(p->>'capacity','')::int,
    published = coalesce((p->>'published')::boolean, published)
  where events.id = eid and employer_id = me;
  return eid;
end $$;
create or replace function public.emp_signups(t text, eid uuid) returns table (id uuid, created_at timestamptz, name text, contact text, age int)
language sql stable security definer set search_path = public as $$
  select s.id, s.created_at, s.name, s.contact, s.age from public.event_signups s join public.events e on e.id = s.event_id
  where s.event_id = eid and e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null order by s.created_at
$$;
create or replace function public.emp_signup_remove(t text, sid uuid) returns void language sql security definer set search_path = public as $$
  delete from public.event_signups s using public.events e where s.id = sid and e.id = s.event_id and e.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null
$$;

-- заказ продвижения из кабинета со входом
create or replace function public.emp_order_create(t text, vid uuid, p_product text, p_contact text) returns table (id uuid, price int)
language plpgsql security definer set search_path = public as $$
declare oid uuid; pr int;
begin
  if public.nr_emp(t) is null or not exists (select 1 from public.vacancies v where v.id = vid and v.employer_id = public.nr_emp(t)) then raise exception 'not yours'; end if;
  if p_product not in ('top7','urgent','verify','business') then raise exception 'bad product'; end if;
  if (select count(*) from public.orders o where o.vacancy_id = vid and o.status = 'new') >= 3 then raise exception 'too many'; end if;
  pr := public.nr_price(p_product);
  insert into public.orders (vacancy_id, product, price, contact) values (vid, p_product, pr, left(trim(coalesce(p_contact,'')), 120)) returning orders.id into oid;
  return query select oid, pr;
end $$;

grant execute on function public.emp_login_start(text) to anon, authenticated;
grant execute on function public.emp_login_check(text) to anon, authenticated;
grant execute on function public.emp_login_confirm(text, bigint, text, text) to authenticated, service_role;
revoke execute on function public.emp_login_confirm(text, bigint, text, text) from public, anon;
grant execute on function public.emp_logout(text) to anon, authenticated;
grant execute on function public.emp_me(text) to anon, authenticated;
grant execute on function public.emp_set_company(text, text) to anon, authenticated;
grant execute on function public.emp_vacancies(text) to anon, authenticated;
grant execute on function public.emp_claim(text, uuid, text) to anon, authenticated;
grant execute on function public.emp_vacancy_key(text, uuid) to anon, authenticated;
grant execute on function public.apply(uuid, text, int, text, text) to anon, authenticated;
grant execute on function public.emp_apps(text) to anon, authenticated;
grant execute on function public.emp_app_status(text, uuid, text) to anon, authenticated;
grant execute on function public.emp_events(text) to anon, authenticated;
grant execute on function public.emp_event_save(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.emp_signups(text, uuid) to anon, authenticated;
grant execute on function public.emp_signup_remove(text, uuid) to anon, authenticated;
grant execute on function public.emp_order_create(text, uuid, text, text) to anon, authenticated;
