-- New.работа, шаг 19: кружок-визитка к анкете. После анкеты на сайте или в Mini App человек
-- может (по желанию) записать кружок в боте: ссылка t.me/бот?start=vv_КОД. Бот пересылает
-- кружок работодателю этой вакансии в Telegram и ставит отметку video_at. Само видео нигде у нас
-- не хранится — только в Telegram у работодателя. Можно запускать повторно. Нужен шаг 7.
alter table public.applications add column if not exists vcode text;
alter table public.applications add column if not exists video_at timestamptz;
create unique index if not exists applications_vcode_idx on public.applications (vcode) where vcode is not null;

-- то же, что apply(), но возвращает код для ссылки в бот (повторная анкета за сутки — тот же код)
create or replace function public.apply_v(vid uuid, p_name text, p_age int, p_contact text, p_message text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not exists (select 1 from public.vacancies where id = vid and status = 'approved') then raise exception 'closed'; end if;
  if (select count(*) from public.applications where created_at > now() - interval '10 minutes') > 100 then raise exception 'too many'; end if;
  select a.id::text into c from public.applications a
    where a.vacancy_id = vid and lower(a.contact) = lower(trim(p_contact)) and a.created_at > now() - interval '1 day' limit 1;
  if c is not null then
    update public.applications set vcode = coalesce(vcode, substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
      where id = c::uuid returning vcode into c;
    return c;
  end if;
  c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  insert into public.applications (vacancy_id, name, age, contact, message, vcode)
    values (vid, trim(p_name), case when p_age between 14 and 99 then p_age end, trim(p_contact), nullif(left(trim(coalesce(p_message,'')),600),''), c);
  update public.vacancies set clicks = clicks + 1 where id = vid;
  return c;
end $$;
revoke execute on function public.apply_v(uuid, text, int, text, text) from public;
grant execute on function public.apply_v(uuid, text, int, text, text) to anon, authenticated;

-- кабинет: видно, что к анкете пришёл кружок (в Telegram работодателя)
drop function if exists public.emp_apps(text);
create or replace function public.emp_apps(t text) returns table (id uuid, created_at timestamptz, vacancy_id uuid, vacancy_title text, name text, age int, contact text, message text, status text, video_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.created_at, a.vacancy_id, v.title, a.name, a.age, a.contact, a.message, a.status, a.video_at
  from public.applications a join public.vacancies v on v.id = a.vacancy_id
  where v.employer_id = public.nr_emp(t) and public.nr_emp(t) is not null order by a.created_at desc limit 300
$$;
revoke execute on function public.emp_apps(text) from public;
grant execute on function public.emp_apps(text) to anon, authenticated;
