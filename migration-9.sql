-- New.работа, шаг 9: онлайн-оплата заказов продвижения через Platega.
-- Можно запускать повторно. Применяет Newi («выполни поручения Клода») или вручную в SQL Editor.
-- Платёж создаёт и подтверждает только серверная функция supabase/functions/pay (ключи Platega — в секретах Supabase).

alter table public.orders add column if not exists pay_tx text;          -- id транзакции Platega
alter table public.orders add column if not exists pay_method int;       -- 2 — СБП, 11 — карта
alter table public.orders add column if not exists pay_note text;        -- последний статус от Platega (для модератора)
create unique index if not exists orders_pay_tx on public.orders (pay_tx) where pay_tx is not null;

-- возврат платежа (CHARGEBACKED) снимает услугу: заказ отменяется, закрепление выключается
create or replace function public.nr_order_chargeback() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status = 'paid' then
    if new.product in ('top7','urgent','business') then
      update public.vacancies set pinned = false, pinned_until = null where id = new.vacancy_id;
    end if;
    if new.product in ('verify','business') then
      update public.vacancies set verified = false where id = new.vacancy_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_chargeback on public.orders;
create trigger orders_chargeback after update on public.orders for each row execute function public.nr_order_chargeback();

grant execute on function public.nr_key_ok(uuid, text) to service_role;
