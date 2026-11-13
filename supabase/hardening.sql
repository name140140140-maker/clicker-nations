-- =====================================================================
--  World Clicker — захист таблиці kv_store (Row Level Security)
--  Виконай ОДИН раз у Supabase → SQL Editor (після деплою нової версії).
--  Безпечно запускати повторно.
--
--  Що це дає:
--   • анонімний ключ (який лежить у клієнті) більше НЕ може видаляти записи;
--   • сервісні ключі (support:*, payment:*, warnotify:*), cfg:* (вимикач сповіщень), seasonrew:* (нагороди сезону)
--     pwr:* / bank:* / cure:* / virussnap:* / leader:* (лідери) / tgmap:* (прив'язка Telegram) / war:* warc:* warend:* warcd:* terr:* cityown:* citydef:* capcd:* dip:* mapevt:* (війни, карта, дипломатія — лише сервер, api/_game/world.js) (банк країни й знищення вірусів: читати можна, писати лише сервер)
--     і ціна Premium Pass
--     закриті для анонімного читання/запису — ними керує лише сервер;
--   • обмежено довжину ключа й розмір значення (захист від засмічення бази).
--  Сервер (api/*) працює через service_role і RLS обходить — йому нічого не заважає.
--
--  Якщо після запуску щось у грі перестане зберігатись — відкат одним рядком:
--     alter table public.kv_store disable row level security;
-- =====================================================================

alter table public.kv_store enable row level security;

drop policy if exists kv_select on public.kv_store;
drop policy if exists kv_insert on public.kv_store;
drop policy if exists kv_update on public.kv_store;
drop policy if exists kv_delete on public.kv_store;

-- Читання: усе, окрім службових ключів
create policy kv_select on public.kv_store
  for select to anon, authenticated
  using (key !~ '^(support:|payment:|warnotify:)');

-- Створення записів: обмеження довжини, службові ключі й ціна заборонені
create policy kv_insert on public.kv_store
  for insert to anon, authenticated
  with check (
    length(key) <= 300
    and length(value) <= 500000
    and key !~ '^(support:|payment:|warnotify:|cfg:|seasonrew:|pwr:|bank:|cure:|virussnap:|leader:|tgmap:|war:|warc:|warend:|warcd:|terr:|cityown:|citydef:|capcd:|dip:|mapevt:)'
    and key <> 'premium_pass_price_stars'
  );

-- Оновлення записів: ті самі обмеження
create policy kv_update on public.kv_store
  for update to anon, authenticated
  using (key !~ '^(support:|payment:|warnotify:|cfg:|seasonrew:|pwr:|bank:|cure:|virussnap:|leader:|tgmap:|war:|warc:|warend:|warcd:|terr:|cityown:|citydef:|capcd:|dip:|mapevt:)' and key <> 'premium_pass_price_stars')
  with check (
    length(key) <= 300
    and length(value) <= 500000
    and key !~ '^(support:|payment:|warnotify:|cfg:|seasonrew:|pwr:|bank:|cure:|virussnap:|leader:|tgmap:|war:|warc:|warend:|warcd:|terr:|cityown:|citydef:|capcd:|dip:|mapevt:)'
    and key <> 'premium_pass_price_stars'
  );

-- Видалення: політики немає → анонімний ключ видаляти не може.

-- Перевірка (має повернути 0 рядків для анонімного ключа):
--   select * from public.kv_store where key like 'support:%';

-- =====================================================================
--  Захист чутливих полів запису гравця (hasPremiumPass, blocked, blockedReason, timeImmunity).
--  Анонімний ключ їх змінити не може; їх міняє лише сервер (api/_game/admin-player.js, api/webhook.js).
--  Уже застосовано в проєкті через міграцію guard_player_sensitive_fields_and_bankldr.
-- =====================================================================
create or replace function public.kv_guard_players() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  o jsonb := '{}'::jsonb;
  n jsonb;
begin
  if r not in ('anon', 'authenticated') then return new; end if;
  if new.key not like 'players:%' then return new; end if;
  begin n := new.value::jsonb; exception when others then return new; end;
  if tg_op = 'UPDATE' then
    begin o := old.value::jsonb; exception when others then o := '{}'::jsonb; end;
  end if;
  if coalesce(n -> 'hasPremiumPass', 'false'::jsonb) is distinct from coalesce(o -> 'hasPremiumPass', 'false'::jsonb)
     or coalesce(n -> 'blocked', 'false'::jsonb) is distinct from coalesce(o -> 'blocked', 'false'::jsonb)
     or coalesce(n -> 'blockedReason', '""'::jsonb) is distinct from coalesce(o -> 'blockedReason', '""'::jsonb)
     or coalesce(n -> 'timeImmunity', 'false'::jsonb) is distinct from coalesce(o -> 'timeImmunity', 'false'::jsonb)
     -- telegramId, раз заданий, незмінний: на ньому тримається прив'язка tgmap
     or (o ? 'telegramId' and o -> 'telegramId' <> 'null'::jsonb and n -> 'telegramId' is distinct from o -> 'telegramId')
  then
    raise exception 'protected player field' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists kv_guard_players_trg on public.kv_store;
create trigger kv_guard_players_trg before insert or update on public.kv_store
  for each row execute function public.kv_guard_players();
