-- New.работа, шаг 30 (Никита 26.11: «1 и 2 сделай»): подозрительное сообщение работодателя (деньги, карта, паспорт, «в личку», ночью…)
-- НЕ доходит до соискателя, пока владелец не посмотрит: бот присылает его Никите с кнопками «Пропустить / Удалить / Предупредить / Остановить».
alter table public.app_messages add column if not exists held boolean not null default false;

create or replace function public.nr_chat_risky(b text) returns boolean language sql immutable as $$
  select coalesce(b, '') ~* '(код\s+из\s+смс|смс[-\s]?код|данные\s+карт|номер\s+карт|cvv|cvc|паспорт|снилс|переведи|перевод\s+на\s+карт|предоплат|залог|взнос|оплат\S*\s+(за\s+)?(оформлен|форм|обучен|стаж)|купи\S*\s+форм|в\s+личк|в\s+лс|whatsapp|ватсап|вотсап|приходи\s+одн|приходи\s+один|никому\s+не\s+говори|родителям\s+не|ночью|ко\s+мне\s+домой|к\s+себе\s+домой|дроп|обнал|закладк|крипт|оформи\S*\s+(на\s+себя\s+)?(карт|сим|кредит))'
$$;

create or replace function public.emp_chat_say(t text, aid uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.nr_emp(t); b text := left(trim(coalesce(p_body,'')), 1000); h boolean;
begin
  if me is null or not exists (select 1 from public.applications a join public.vacancies v on v.id = a.vacancy_id where a.id = aid and v.employer_id = me) then raise exception 'not yours'; end if;
  if (select chat_locked from public.applications where id = aid) then raise exception 'locked'; end if;
  if b = '' then return; end if;
  if (select count(*) from public.app_messages m join public.applications a on a.id = m.application_id join public.vacancies v on v.id = a.vacancy_id
      where v.employer_id = me and m.from_emp and m.created_at > now() - interval '10 minutes') >= 60 then raise exception 'too many'; end if;
  h := public.nr_chat_risky(b);
  -- на проверке: бот пришлёт владельцу (notified=false); иначе — соискателю, если он подключил Telegram
  insert into public.app_messages (application_id, from_emp, body, held, notified)
    values (aid, true, b, h, case when h then false else not exists (select 1 from public.applications where id = aid and chat_tg is not null) end);
end $$;

-- соискатель не видит сообщения «на проверке»
create or replace function public.app_chat_get(tok text) returns json
language plpgsql security definer set search_path = public as $$
declare aid uuid := public.app_chat_id(tok); r json;
begin
  if aid is null then return null; end if;
  update public.app_messages set read_at = now() where application_id = aid and from_emp and not held and read_at is null;
  select json_build_object(
    'title', v.title, 'company', v.company, 'vacancy_id', v.id, 'status', a.status, 'name', a.name, 'locked', a.chat_locked,
    'messages', coalesce((select json_agg(json_build_object('id', m.id, 'at', m.created_at, 'emp', m.from_emp, 'mod', m.from_mod, 'body', m.body, 'read', m.read_at is not null) order by m.id)
                          from public.app_messages m where m.application_id = aid and not m.held), '[]'::json))
    into r from public.applications a join public.vacancies v on v.id = a.vacancy_id where a.id = aid;
  return r;
end $$;

create or replace function public.app_chat_unread(toks text[]) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.app_messages m
  where m.from_emp and not m.held and m.read_at is null and m.application_id in (select public.app_chat_id(x) from unnest(coalesce(toks, '{}')) x limit 50)
$$;

-- работодатель видит своё сообщение с пометкой «на проверке»
create or replace function public.emp_chat_get(t text, aid uuid) returns json
language plpgsql security definer set search_path = public as $$
declare me uuid := public.nr_emp(t);
begin
  if me is null or not exists (select 1 from public.applications a join public.vacancies v on v.id = a.vacancy_id where a.id = aid and v.employer_id = me) then return null; end if;
  update public.app_messages set read_at = now() where application_id = aid and not from_emp and read_at is null;
  return (select coalesce(json_agg(json_build_object('id', m.id, 'at', m.created_at, 'emp', m.from_emp, 'mod', m.from_mod, 'held', m.held, 'body', m.body, 'read', m.read_at is not null) order by m.id), '[]'::json)
          from public.app_messages m where m.application_id = aid);
end $$;
