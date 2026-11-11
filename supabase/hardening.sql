-- =====================================================================
--  World Clicker — захист таблиці kv_store (Row Level Security)
--  Виконай ОДИН раз у Supabase → SQL Editor (після деплою нової версії).
--  Безпечно запускати повторно.
--
--  Що це дає:
--   • анонімний ключ (який лежить у клієнті) більше НЕ може видаляти записи;
--   • сервісні ключі (support:*, payment:*, warnotify:*), cfg:* (вимикач сповіщень), seasonrew:* (нагороди сезону)
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
    and key !~ '^(support:|payment:|warnotify:|cfg:|seasonrew:)'
    and key <> 'premium_pass_price_stars'
  );

-- Оновлення записів: ті самі обмеження
create policy kv_update on public.kv_store
  for update to anon, authenticated
  using (key !~ '^(support:|payment:|warnotify:|cfg:|seasonrew:)' and key <> 'premium_pass_price_stars')
  with check (
    length(key) <= 300
    and length(value) <= 500000
    and key !~ '^(support:|payment:|warnotify:|cfg:|seasonrew:)'
    and key <> 'premium_pass_price_stars'
  );

-- Видалення: політики немає → анонімний ключ видаляти не може.

-- Перевірка (має повернути 0 рядків для анонімного ключа):
--   select * from public.kv_store where key like 'support:%';
