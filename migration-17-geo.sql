-- New.работа, шаг 17: точка на карте до адреса. У смены/мероприятия появляются координаты (lat, lng):
-- сайт сам ищет адрес в OpenStreetMap, когда работодатель (кабинет) или модератор (админка) сохраняет смену.
-- На карте такая смена стоит своей точкой, а не кружком города; на странице событий — «📍 Как добраться».
-- Адрес или город поменяли, а новых координат нет (адрес не нашёлся) — старые стираются, чтобы точка не врала.
-- Можно запускать повторно.
alter table public.events add column if not exists lat double precision;
alter table public.events add column if not exists lng double precision;
alter table public.events drop constraint if exists events_geo_chk;
alter table public.events add constraint events_geo_chk check (
  (lat is null and lng is null) or
  (lat between 41 and 82 and (lng between 19 and 180 or lng between -180 and -168)));

-- координата из текста: не число или вне России — null (без ошибки, смена всё равно сохранится)
create or replace function public.nr_geo(p jsonb) returns double precision[] language plpgsql immutable as $$
declare la double precision; lo double precision;
begin
  begin
    la := (p->>'lat')::double precision; lo := (p->>'lng')::double precision;
  exception when others then return null;
  end;
  if la is null or lo is null then return null; end if;
  if la between 41 and 82 and (lo between 19 and 180 or lo between -180 and -168) then
    return array[round(la::numeric, 6)::double precision, round(lo::numeric, 6)::double precision];
  end if;
  return null;
end $$;

-- кабинет: сохранить смену (+ координаты, если сайт нашёл адрес)
create or replace function public.emp_event_save(t text, eid uuid, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := public.nr_emp(t); id2 uuid; g double precision[] := public.nr_geo(p);
begin
  if me is null then raise exception 'bad token'; end if;
  if eid is null then
    if (select count(*) from public.events where employer_id = me and created_at > now() - interval '1 day') > 50 then raise exception 'too many'; end if;
    insert into public.events (title, starts_at, place, city, kind, description, capacity, published, listed, employer_id, lat, lng)
    values (trim(p->>'title'), (p->>'starts_at')::timestamptz, nullif(trim(p->>'place'),''), nullif(trim(p->>'city'),''), 'Смена',
      nullif(trim(p->>'description'),''), nullif(p->>'capacity','')::int, true, false, me, g[1], g[2])
    returning events.id into id2;
    return id2;
  end if;
  update public.events set title = trim(p->>'title'), starts_at = (p->>'starts_at')::timestamptz, place = nullif(trim(p->>'place'),''),
    city = nullif(trim(p->>'city'),''), description = nullif(trim(p->>'description'),''), capacity = nullif(p->>'capacity','')::int,
    published = coalesce((p->>'published')::boolean, published),
    lat = case when g is not null then g[1]
               when place is distinct from nullif(trim(p->>'place'),'') or city is distinct from nullif(trim(p->>'city'),'') then null else lat end,
    lng = case when g is not null then g[2]
               when place is distinct from nullif(trim(p->>'place'),'') or city is distinct from nullif(trim(p->>'city'),'') then null else lng end
  where events.id = eid and employer_id = me;
  return eid;
end $$;
grant execute on function public.emp_event_save(text, uuid, jsonb) to anon, authenticated;
