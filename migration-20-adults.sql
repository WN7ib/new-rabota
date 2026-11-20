-- New.работа, шаг 20: вакансии для взрослых. Сайт остаётся про молодёжь, но работодатель может отметить
-- «Для взрослых» (с 18 лет, постоянная работа, нужен опыт), а соискатель — отфильтровать такие вакансии.
-- Можно запускать повторно. Старые вызовы submit_vacancy / my_vacancy_update продолжают работать.
-- Деньги с соискателя по-прежнему не берутся — платит только работодатель.

alter table public.vacancies add column if not exists adult boolean not null default false;

-- подать вакансию: добавлен необязательный ключ adult (для взрослых возраст всегда 18+)
create or replace function public.submit_vacancy(p jsonb) returns table (id uuid, manage_key text)
language plpgsql security definer set search_path = public as $$
declare vid uuid; k text; exp date; v_adult boolean := coalesce((p->>'adult')::boolean, false); v_age int;
begin
  if not coalesce((select (data->>'submissions_open')::boolean from public.settings where settings.id = 1), true) then
    raise exception 'submissions closed';
  end if;
  if (select count(*) from public.vacancies v where v.status = 'pending' and v.created_at > now() - interval '10 minutes') > 30 then
    raise exception 'too many';
  end if;
  exp := nullif(p->>'expires_at','')::date;
  if exp is not null and (exp < current_date or exp > current_date + 90) then exp := current_date + 30; end if;
  v_age := case when v_adult then 18 else coalesce((p->>'age_min')::int, 16) end;
  insert into public.vacancies (title, company, city, type, age_min, pay, remote, description, contact, expires_at, status, weekend, split, adult)
  values (trim(p->>'title'), nullif(trim(p->>'company'),''), nullif(trim(p->>'city'),''), coalesce(nullif(p->>'type',''),'Подработка'),
          v_age, nullif(trim(p->>'pay'),''), coalesce((p->>'remote')::boolean, false),
          nullif(trim(p->>'description'),''), trim(p->>'contact'), exp, 'pending',
          coalesce((p->>'weekend')::boolean, false), coalesce((p->>'split')::boolean, false), v_adult)
  returning vacancies.id into vid;
  k := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.vacancy_keys (vacancy_id, key_hash) values (vid, public.nr_hash(k));
  return query select vid, k;
end $$;
grant execute on function public.submit_vacancy(jsonb) to anon, authenticated;

-- правка из кабинета: выходные, сплит и «для взрослых» сохраняются; если ключа нет — значение не трогаем
create or replace function public.my_vacancy_update(vid uuid, k text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_adult boolean;
begin
  if not public.nr_key_ok(vid, k) then raise exception 'bad key'; end if;
  select coalesce((p->>'adult')::boolean, adult) into v_adult from public.vacancies where id = vid;
  update public.vacancies set
    title = trim(p->>'title'), company = nullif(trim(p->>'company'),''), city = nullif(trim(p->>'city'),''),
    type = coalesce(nullif(p->>'type',''),'Подработка'),
    age_min = case when v_adult then 18 else coalesce((p->>'age_min')::int, 16) end,
    pay = nullif(trim(p->>'pay'),''), remote = coalesce((p->>'remote')::boolean, false),
    description = nullif(trim(p->>'description'),''), contact = trim(p->>'contact'),
    weekend = coalesce((p->>'weekend')::boolean, weekend), split = coalesce((p->>'split')::boolean, split), adult = v_adult,
    status = 'pending', pinned = false, verified = false
  where id = vid and status <> 'closed';
end $$;
grant execute on function public.my_vacancy_update(uuid, text, jsonb) to anon, authenticated;
