-- ============================================================================
-- Apex Finance — MIGRATION v2 (DPH 23%, číslovanie od 1043)
-- ----------------------------------------------------------------------------
-- 1. Aktualizuje základnú DPH sadzbu z 20% → 23%
-- 2. Renumberuje existujúce faktúry (začiatok od 1043)
-- 3. Prepočíta DPH na existujúcich položkách faktúr
-- ============================================================================

BEGIN;

-- ==================== 1. DPH sadzby ====================
UPDATE tax_rates
SET rate = 23, name = 'Základná 23%'
WHERE code = 'STD' AND (rate IS DISTINCT FROM 23);

-- Ak záznam 'STD' neexistuje, vložíme ho
INSERT INTO tax_rates (code, rate, name, is_default, sort_order)
SELECT 'STD', 23, 'Základná 23%', true, 10
WHERE NOT EXISTS (SELECT 1 FROM tax_rates WHERE code = 'STD');

-- ==================== 2. Číslovanie ====================
-- Nastav posledné číslo v sekvencii na 1043
UPDATE number_sequences
SET last_number = 1043
WHERE doc_type = 'invoice' AND year = 2026 AND last_number < 1043;

-- ==================== 3. Renumbering existujúcich faktúr ====================
-- Očíslujeme faktúry podľa dátumu vystavenia a priradíme nové čísla od 1043
WITH numbered AS (
  SELECT id, number, ROW_NUMBER() OVER (ORDER BY issue_date, id) + 1042 AS new_seq
  FROM invoices
  WHERE doc_type = 'invoice'
  ORDER BY issue_date, id
)
UPDATE invoices i
SET number = regexp_replace(
  i.number,
  '\d+$',
  LPAD(n.new_seq::text, 4, '0')
)
FROM numbered n
WHERE i.id = n.id;

-- ==================== 4. Prepočet DPH na položkách ====================
-- 4a. Aktualizujeme vat_rate z 20 na 23 na existujúcich položkách
UPDATE invoice_items
SET vat_rate = 23
WHERE vat_rate = 20;

-- 4b. Prepočítame total_vat a total_gross na všetkých položkách
-- (vat_rate už je 23, ale total_vat a total_gross sú staré)
UPDATE invoice_items
SET
  total_vat   = ROUND((total_net * 23 / 100)::numeric, 2),
  total_gross = ROUND((total_net + total_net * 23 / 100)::numeric, 2)
WHERE vat_rate = 23 AND total_net IS DISTINCT FROM 0;

-- 4c. Prepočítame sumáre na faktúrach
WITH item_sums AS (
  SELECT
    invoice_id,
    SUM(total_net)   AS new_subtotal,
    SUM(total_vat)   AS new_vat_total,
    SUM(total_gross) AS new_gross
  FROM invoice_items
  GROUP BY invoice_id
)
UPDATE invoices i
SET
  subtotal  = ROUND(COALESCE(s.new_subtotal, 0)::numeric, 2),
  vat_total = ROUND(COALESCE(s.new_vat_total, 0)::numeric, 2),
  total     = ROUND((COALESCE(s.new_subtotal, 0) + COALESCE(s.new_vat_total, 0))::numeric, 2)
FROM item_sums s
WHERE i.id = s.invoice_id;

COMMIT;
