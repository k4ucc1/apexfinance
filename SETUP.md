# Setup Guide — Apex Finance

Tento návod slúži pre **novú inštaláciu** (ak chceš vytvoriť nový Supabase projekt od nuly). Existujúce inštalácie už tento setup majú hotový.

---

## KROK 1 — Vytvor Supabase projekt (~5 min)

1. Choď na **https://supabase.com** → Prihlás sa (GitHub alebo email)
2. Klikni **„New project"**
3. Vyplň:
   - **Name**: `apex-fakturacia` (alebo ľubovoľné)
   - **Database Password**: vygeneruj silné heslo, **zapíš si ho**
   - **Region**: `Frankfurt` (EU Central-1)
   - **Pricing Plan**: `Free`
4. Klikni **„Create new project"** a počkaj 2-3 minúty

---

## KROK 2 — Spusti SQL migráciu (~2 min)

1. V Dashboard ľavé menu → **SQL Editor** (ikona `</>`)
2. Klik **„+ New query"**
3. Otvor súbor `apex-migration-fix.sql` z tohto repa, skopíruj celý obsah
4. Vlož do SQL Editora
5. Klik **„Run"** (Ctrl+Enter)
6. Mal by si vidieť:
   ```
   NOTICE: ==================== VERIFIKÁCIA ====================
   NOTICE: tax_rates:        4 riadkov
   NOTICE: article_groups:   4 riadkov
   NOTICE: companies:        1 riadkov
   NOTICE: number_sequences: 3 riadkov
   NOTICE: app_settings:     9 riadkov
   NOTICE: =====================================================
   ```

---

## KROK 3 — Získaj API kľúče (~1 min)

1. V Dashboard: **Settings (ozubené koliesko)** → **API** (alebo klikni „Connect" v hornej lište)
2. Skopíruj:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **Publishable key** (anon): začína `sb_publishable_...` (alebo starý `eyJ...`)

---

## KROK 4 — Vytvor používateľa (~1 min)

1. V Dashboard: **Authentication** → **Users** → **„Add user"** → **„Create new user"**
2. Vyplň email + silné heslo (zapíš si ho)
3. ✅ **Zaškrtni „Auto Confirm User"** (inak sa nedá prihlásiť bez emailovej verifikácie)
4. Klik **„Create user"**

---

## KROK 5 — Pripoj aplikáciu

### Buď A: Zmeň v kóde (ak klonuješ repo)

Otvor `apex-app.js`, nájdi riadok ~7:
```js
const DEFAULT_SUPABASE_URL = 'https://qszcrlptiwircitfuela.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_mPDoup1hboMph_iUUlN5Jw_LzB3sWoe';
```

Zmeň na svoje hodnoty.

### Alebo B: Použi Setup screen (ak aplikáciu iba spúšťaš)

1. Otvor `index.html`
2. Ak je prvýkrát alebo localStorage je prázdne, zobrazí sa Setup screen
3. Zadaj URL + Publishable key → „Otestovať a pripojiť"
4. Prihlás sa používateľom z KROK 4

---

## KROK 6 — Prvá faktúra

1. Klikni **„Nová faktúra"** v hornej lište
2. Vyber zákazníka („Zmeniť" → „Založiť nového")
3. Skús **IČO lookup** — zadaj IČO nejakej slovenskej firmy (napr. `31337114`)
4. Pridaj položku (cez „Z katalógu" alebo „Riadok")
5. Nastav DPH, množstvo, cenu
6. **Uložiť faktúru** → **PDF** export

---

## 🆘 Troubleshooting

### Aplikácia zamrzne pri kliknutí
- Urob **Ctrl+Shift+R** (hard refresh) — prehliadač často cacheuje starý JS
- Otvor F12 → Console a pozri chyby
- Pozri sa na [FAQ v README](./README.md)

### Prihlásenie zlyháva
- Skontroluj že **„Auto Confirm User"** je zapnuté v Supabase Dashboard → Authentication → Users
- Skontroluj email (exaktný zápis)
- Po 5 neúspešných pokusoch je 15 min blok (vymaž `localStorage` ak chceš obísť)

### SQL migrácia zlyhá
- Skontroluj že si v editore SQL a nie v Studies alebo inde
- Skopíruj celý obsah `apex-migration-fix.sql` naraz
- Pozri chybovú hlášku — väčšinou je tam presný dôvod

---

## 📞 Podpora

Pre interné otázky: OpenCode AI session.
