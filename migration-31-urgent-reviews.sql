-- Шаг 31 (Никита 26.11): «🔥 Срочно нужен человек» с надбавкой сверху — бот рассказывает ВСЕМ в Telegram;
-- проверенные отзывы о работодателе — только от тех, кого взяли на смену (из своей переписки).

-- ───── 1) срочная смена + надбавка
alter table public.vacancies add column if not exists bonus int check (bonus is null or bonus between 0 and 100000);
alter table public.vacancies add column if not exists urgent_until timestamptz;    -- до когда «срочно» (видно на сайте и в приложении)
alter table public.vacancies add column if not exists urgent_sent_at timestamptz;  -- бот уже разослал этот «срочный» призыв
alter table public.vacancies add column if not exists urgent_last timestamptz;     -- когда последний раз включали (не чаще раза в сутки)

-- общее для двух способов входа (личная ссылка вакансии и кабинет работодателя)
create or replace function public.nr_vacancy_urgent(vid uuid, p_bonus int, p_hours int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v public.vacancies; till timestamptz;
begin
  select * into v from public.vacancies where id = vid;
  if v.id is null then raise exception 'not found'; end if;
  if v.status <> 'approved' then raise exception 'not approved'; end if;          -- рассылаю всем только проверенную вакансию
  if v.urgent_last is not null and v.urgent_last > now() - interval '24 hours' then raise exception 'once a day'; end if;
  -- на старте бесплатно; выключить — settings.data.urgent_free = false (тогда «Срочно» — только платной услугой)
  if coalesce((select data->>'urgent_free' from public.settings where id = 1), 'true') = 'false' then raise exception 'need pay'; end if;
  till := now() + make_interval(hours => least(greatest(coalesce(p_hours, 24), 2), 48));
  update public.vacancies set bonus = nullif(least(greatest(coalesce(p_bonus, 0), 0), 100000), 0),
         urgent_until = till, urgent_sent_at = null, urgent_last = now()
   where id = vid;
  return till;
end $$;
revoke execute on function public.nr_vacancy_urgent(uuid, int, int) from public, anon, authenticated;

create or replace function public.my_vacancy_urgent(vid uuid, k text, p_bonus int, p_hours int) returns timestamptz
language plpgsql security definer set search_path = public as $$
begin
  if not public.nr_key_ok(vid, k) then raise exception 'bad key'; end if;
  return public.nr_vacancy_urgent(vid, p_bonus, p_hours);
end $$;

create or replace function public.emp_vacancy_urgent(t text, vid uuid, p_bonus int, p_hours int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare e uuid := public.nr_emp(t);
begin
  if e is null or not exists (select 1 from public.vacancies where id = vid and employer_id = e) then raise exception 'bad key'; end if;
  return public.nr_vacancy_urgent(vid, p_bonus, p_hours);
end $$;

grant execute on function public.my_vacancy_urgent(uuid, text, int, int) to anon, authenticated;
grant execute on function public.emp_vacancy_urgent(text, uuid, int, int) to anon, authenticated;

-- ───── 2) проверенные отзывы: «✓ работал(а) здесь»
alter table public.reviews add column if not exists application_id uuid references public.applications(id) on delete set null;
alter table public.reviews add column if not exists verified boolean not null default false;
create unique index if not exists reviews_application on public.reviews (application_id) where application_id is not null;

-- соискатель из своей переписки (ключ чата): только если его взяли (анкета «принят»); один отзыв на отклик, можно поправить
create or replace function public.app_review(tok text, p_rating int, p_body text) returns text
language plpgsql security definer set search_path = public as $$
declare aid uuid := public.app_chat_id(tok); a public.applications; v public.vacancies; b text := trim(coalesce(p_body, ''));
begin
  if aid is null then raise exception 'bad key'; end if;
  select * into a from public.applications where id = aid;
  if a.status <> 'accepted' then raise exception 'not accepted'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'bad rating'; end if;
  if char_length(b) < 10 then raise exception 'too short'; end if;
  select * into v from public.vacancies where id = a.vacancy_id;
  if v.company is null or char_length(v.company) < 2 then raise exception 'no company'; end if;
  insert into public.reviews (company, rating, body, author, status, application_id, verified)
  values (left(v.company, 120), p_rating, left(b, 1500), left(split_part(trim(a.name), ' ', 1), 40), 'pending', aid, true)
  on conflict (application_id) where application_id is not null
  do update set rating = excluded.rating, body = excluded.body, status = 'pending', created_at = now();
  return 'ok';
end $$;

create or replace function public.app_review_get(tok text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('can', a.status = 'accepted', 'rating', r.rating, 'body', r.body, 'status', r.status)
  from public.applications a left join public.reviews r on r.application_id = a.id
  where a.id = public.app_chat_id(tok)
$$;

grant execute on function public.app_review(text, int, text) to anon, authenticated;
grant execute on function public.app_review_get(text) to anon, authenticated;

-- рейтинг компаний для карточек вакансий (только одобренные отзывы)
create or replace function public.company_ratings() returns table (company text, avg numeric, n int, verified int)
language sql stable security definer set search_path = public as $$
  select lower(r.company), round(avg(r.rating)::numeric, 1), count(*)::int, count(*) filter (where r.verified)::int
  from public.reviews r where r.status = 'approved' group by lower(r.company)
$$;
grant execute on function public.company_ratings() to anon, authenticated;
