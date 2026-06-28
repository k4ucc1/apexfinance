-- ============================================================================
-- Apex Finance — FIX MIGRATION (v1.0.1)
-- ----------------------------------------------------------------------------
-- Tento skript opraví všetky chýbajúce veci v databáze:
--   1. DROP NOT NULL na tax_rates.rate
--   2. Doplní default data (DPH sadzby, firma, skupiny, sekvencie, settings)
--   3. Re-aplikuje RLS politiky
--   4. Re-aplikuje audit triggre
--   5. Re-aplikuje storage bucket
--   6. Re-aplikuje granty
--
-- Bezpečné spustiť viackrát (všetko je idempotentné).
-- Spusti v: Supabase Dashboard -> SQL Editor -> New query -> Run (Ctrl+Enter)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. DROP NOT NULL na tax_rates.rate (ak existuje)
-- ---------------------------------------------------------------------------
alter table public.tax_rates alter column rate drop not null;

-- ---------------------------------------------------------------------------
-- 2. DEFAULT DATA
-- ---------------------------------------------------------------------------

-- 2.1 DPH sadzby
insert into public.tax_rates (code, rate, name, description, is_default, sort_order) values
    ('STD',  20.00, 'Základná 20%',  'Štandardná sadzba DPH', true,  1),
    ('RED',  10.00, 'Znížená 10%',   'Znížená sadzba DPH',    false, 2),
    ('ZERO',  0.00, 'Nulová 0%',     'Nulová sadzba DPH',     false, 3),
    ('NULL',  NULL, 'Nie je predmetom DPH', 'Bez DPH',         false, 4)
on conflict (code) do nothing;

-- 2.2 Default skupiny artiklov
insert into public.article_groups (id, name, type, default_vat_rate, color, sort_order) values
    ('00000000-0000-0000-0000-000000000001', 'Služby',   'service',  20.00, '#6366f1', 1),
    ('00000000-0000-0000-0000-000000000002', 'Tovar',    'goods',    20.00, '#10b981', 2),
    ('00000000-0000-0000-0000-000000000003', 'Materiál', 'material', 20.00, '#f59e0b', 3),
    ('00000000-0000-0000-0000-000000000004', 'Poplatky', 'fee',      20.00, '#ef4444', 4)
on conflict (id) do nothing;

-- 2.3 Default firma
insert into public.companies (id, name, legal_form, vat_payer, country, default_currency)
values ('00000000-0000-0000-0000-000000000010', 'Apexholding, s.r.o.', 's.r.o.', true, 'Slovensko', 'EUR')
on conflict (id) do nothing;

-- 2.4 Číselné rady pre aktuálny rok (ak neexistujú)
insert into public.number_sequences (doc_type, year, prefix, separator, last_number, padding, format_template)
select 'invoice', extract(year from now())::int, 'FA', '-', 0, 4, '{PREFIX}{YEAR}{SEP}{PAD}'
where not exists (select 1 from public.number_sequences where doc_type='invoice' and year=extract(year from now())::int);

insert into public.number_sequences (doc_type, year, prefix, separator, last_number, padding, format_template)
select 'receipt', extract(year from now())::int, 'PPD', '-', 0, 4, '{PREFIX}{YEAR}{SEP}{PAD}'
where not exists (select 1 from public.number_sequences where doc_type='receipt' and year=extract(year from now())::int);

insert into public.number_sequences (doc_type, year, prefix, separator, last_number, padding, format_template)
select 'credit', extract(year from now())::int, 'DOB', '-', 0, 4, '{PREFIX}{YEAR}{SEP}{PAD}'
where not exists (select 1 from public.number_sequences where doc_type='credit' and year=extract(year from now())::int);

-- 2.5 Default app_settings
insert into public.app_settings (key, value, description) values
    ('invoice.default_due_days',         '"14"',          'Štandardná lehota splatnosti (dni)'),
    ('invoice.default_payment_method',   '"prevod"',      'Štandardný spôsob úhrady'),
    ('invoice.default_ks',               '"0308"',        'Štandardný konštantný symbol'),
    ('invoice.qr_payment',               'true',          'Generovať QR kód platby'),
    ('receipt.default_cashier',          'null',          'Predvolený pokladník'),
    ('ui.accent_color',                  '"#4f46e5"',     'Akcentná farba UI'),
    ('session.idle_timeout_minutes',     '10',            'Odhlásenie po nečinnosti (minúty)'),
    ('registry.auto_lookup',             'true',          'Auto-dopĺňanie IČO/DIČ z registra'),
    ('app.version',                      '"1.0.1"',       'Verzia schémy')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RLS POLITIKY (re-aplikácia)
-- ---------------------------------------------------------------------------

-- Zapni RLS na všetkých tabuľkách (ak ešte nie je zapnuté)
alter table public.companies         enable row level security;
alter table public.partners          enable row level security;
alter table public.article_groups    enable row level security;
alter table public.articles          enable row level security;
alter table public.tax_rates         enable row level security;
alter table public.number_sequences  enable row level security;
alter table public.invoices          enable row level security;
alter table public.invoice_items     enable row level security;
alter table public.receipts          enable row level security;
alter table public.receipt_items     enable row level security;
alter table public.app_settings      enable row level security;
alter table public.audit_log         enable row level security;

-- Helper funkcia
create or replace function public.is_authenticated()
returns boolean language sql security definer set search_path = public as $$
    select coalesce(auth.role() = 'authenticated', false);
$$;

-- CRUD politiky (DROP + CREATE)
do $$
declare t text;
    tbls text[] := array[
        'companies','partners','article_groups','articles','tax_rates',
        'number_sequences','invoices','invoice_items','receipts','receipt_items',
        'app_settings'
    ];
begin
    foreach t in array tbls loop
        execute format($f$
            drop policy if exists %1$s_read   on public.%1$I;
            drop policy if exists %1$s_insert on public.%1$I;
            drop policy if exists %1$s_update on public.%1$I;
            drop policy if exists %1$s_delete on public.%1$I;
            create policy %1$s_read   on public.%1$I for select to authenticated using (public.is_authenticated());
            create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.is_authenticated());
            create policy %1$s_update on public.%1$I for update to authenticated using (public.is_authenticated()) with check (public.is_authenticated());
            create policy %1$s_delete on public.%1$I for delete to authenticated using (public.is_authenticated());
        $f$, t);
    end loop;
end $$;

-- audit_log: len čítanie
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log
    for select to authenticated using (public.is_authenticated());

-- ---------------------------------------------------------------------------
-- 4. AUDIT TRIGGER (re-aplikácia)
-- ---------------------------------------------------------------------------

create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_user  uuid := auth.uid();
    v_email text;
    v_id    text;
begin
    select email into v_email from auth.users where id = v_user;
    if tg_op = 'DELETE' then
        v_id := to_jsonb(OLD) ->> 'id';
        insert into public.audit_log (user_id, user_email, entity, entity_id, action, old_data)
        values (v_user, v_email, tg_table_name, v_id, 'delete', to_jsonb(OLD));
        return OLD;
    elsif tg_op = 'UPDATE' then
        v_id := to_jsonb(NEW) ->> 'id';
        insert into public.audit_log (user_id, user_email, entity, entity_id, action, old_data, new_data)
        values (v_user, v_email, tg_table_name, v_id, 'update', to_jsonb(OLD), to_jsonb(NEW));
        return NEW;
    elsif tg_op = 'INSERT' then
        v_id := to_jsonb(NEW) ->> 'id';
        insert into public.audit_log (user_id, user_email, entity, entity_id, action, new_data)
        values (v_user, v_email, tg_table_name, v_id, 'insert', to_jsonb(NEW));
        return NEW;
    end if;
    return null;
end;
$$;

drop trigger if exists trg_audit_invoices      on public.invoices;
create trigger trg_audit_invoices      after insert or update or delete on public.invoices
    for each row execute function public.log_audit();

drop trigger if exists trg_audit_invoice_items on public.invoice_items;
create trigger trg_audit_invoice_items after insert or update or delete on public.invoice_items
    for each row execute function public.log_audit();

drop trigger if exists trg_audit_receipts      on public.receipts;
create trigger trg_audit_receipts      after insert or update or delete on public.receipts
    for each row execute function public.log_audit();

-- ---------------------------------------------------------------------------
-- 5. STORAGE BUCKET
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('company-assets', 'company-assets', true)
on conflict (id) do nothing;

drop policy if exists "company_assets_read"   on storage.objects;
drop policy if exists "company_assets_upload" on storage.objects;
drop policy if exists "company_assets_update" on storage.objects;
create policy "company_assets_read"   on storage.objects for select to authenticated
    using (bucket_id = 'company-assets');
create policy "company_assets_upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'company-assets');
create policy "company_assets_update" on storage.objects for update to authenticated
    using (bucket_id = 'company-assets') with check (bucket_id = 'company-assets');

-- ---------------------------------------------------------------------------
-- 6. GRANTY
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.v_invoice_totals  to authenticated;
grant select on public.v_partner_balance to authenticated;
grant select on public.v_vat_summary     to authenticated;
grant select on public.v_monthly_revenue to authenticated;

-- ---------------------------------------------------------------------------
-- 7. VERIFIKÁCIA - vypíše počty
-- ---------------------------------------------------------------------------
do $$
declare
    c_tax int; c_grp int; c_comp int; c_seq int; c_set int;
begin
    select count(*) into c_tax from public.tax_rates;
    select count(*) into c_grp from public.article_groups;
    select count(*) into c_comp from public.companies;
    select count(*) into c_seq from public.number_sequences;
    select count(*) into c_set from public.app_settings;
    raise notice '==================== VERIFIKÁCIA ====================';
    raise notice 'tax_rates:        % riadkov', c_tax;
    raise notice 'article_groups:   % riadkov', c_grp;
    raise notice 'companies:        % riadkov', c_comp;
    raise notice 'number_sequences: % riadkov', c_seq;
    raise notice 'app_settings:     % riadkov', c_set;
    raise notice '=====================================================';
    raise notice 'Ak sú všetky počty > 0, migrácia prebehla úspešne.';
end $$;
