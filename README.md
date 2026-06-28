# 🔷 ApexHolding Fakturácia

Moderný fakturačný systém pre **Apexholding, s.r.o.** — single-page HTML aplikácia s backendom na Supabase.

> **Verzia:** 1.0.1  
> **Posledná aktualizácia:** 2026-06  
> **Stav:** Produkčná (MVP)

---

## ✨ Funkcie

### Aktuálne (MVP)
- 📊 **Dashboard** — KPI karty, graf obratu za 6 mesiacov (Chart.js), prehľad po splatnosti
- 📄 **Faktúry** — tvorba, editácia, statusy (návrh/odoslaná/zaplatená/po splatnosti/stornovaná), PDF export (pdfMake)
- 🧾 **Prijímové pokladničné doklady (PPD)** — hotovostné a kartové platby
- 👥 **Kontakty** — Zákazníci a Dodávatelia s **automatickým dopĺňaním IČO/DIČ z registra** (registeruz.sk)
- 📦 **Artikle a Skupiny** — katalóg produktov a služieb so stromovou štruktúrou
- 📈 **Reporty** — top zákazníci, obrat za obdobie, prehľad faktúr
- ⚙️ **Nastavenia** — firma, číslovanie dokladov, DPH sadzby, pripojenie, používatelia

### Bezpečnosť
- 🔐 Prihlásenie emailom + heslom (Supabase Auth)
- 🛡️ **Row Level Security (RLS)** v Postgres — každý dotaz musí byť autentifikovaný
- ⏱️ Automatické odhlásenie po 10 minútach nečinnosti
- 🚫 **Rate limit prihlásenia**: 5 neúspešných pokusov → 15 min blok (aplikáčne) + Supabase Auth (5 pokusov / 5 min z IP)

### Plánované do budúcna
- 💰 **Účtovníctvo** — prijaté faktúry, banka, účtovný denník, účtový rozvrh
- 🏦 Bankový import výpisov
- 📧 Automatické odosielanie faktúr emailom
- 🎨 Logo firmy na faktúrach (upload do Supabase Storage)

---

## 🚀 Spustenie

### Možnosť A — Lokálne (odporúčané)

```bash
# 1. Klonovať repozitár
git clone https://github.com/k4ucc1/cauntpex.git
cd cauntpex

# 2. Otvoriť v prehliadači
#    - Windows: dvojklik na apex-fakturacia.html
#    - Alebo: start apex-fakturacia.html
#    - Alebo: v prehliadači Ctrl+O → vybrať súbor
```

To je všetko! Aplikácia nabehne s prednastaveným pripojením k Supabase.

### Možnosť B — Online (Netlify, Vercel, GitHub Pages)

Pre **súkromný repozitár** (ako je tento):
- **Netlify** (odporúčané, zadarmo pre private repos): spoj s GitHub → automatický deploy pri push → URL `cauntpex.netlify.app`
- **Vercel**: podobne ako Netlify
- **GitHub Pages**: iba pre **public** repá (v bezplatnej verzii)

---

## 🗄️ Backend — Supabase

Aplikácia už má prednastavené pripojenie k Supabase projektu:
- **URL:** `https://qszcrlptiwircitfuela.supabase.co`
- **Publishable key:** v `apex-app.js` (konštanty `DEFAULT_SUPABASE_URL`, `DEFAULT_SUPABASE_KEY`)

### Zmena databázy
Ak chceš použiť inú Supabase databázu:
1. Otvor aplikáciu
2. Pri prvom spustení vynechaj Setup screen (alebo neskôr: Nastavenia → Pripojenie)
3. Zadaj novú URL a Publishable key
4. Ulož — hodnoty sa uložia do `localStorage` prehliadača

Alebo zmeň priamo v `apex-app.js`:
```js
const DEFAULT_SUPABASE_URL = 'https://TVOJ-PROJEKT.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_TVOJ_KEY';
```

---

## 🔐 Bezpečnostný model

### Je Publishable key v kóde bezpečný?
**ÁNO.** Supabase publishable/anon key je **výslovne dizajnovaný** na zverejnenie v klientskom kóde (web, mobilné aplikácie).

- ❌ Key sám o sebe nedáva prístup k dátam
- ✅ Prístup chráni **Row Level Security (RLS)** v Postgres — každý dotaz musí obsahovať platný JWT z úspešného prihlásenia
- ✅ Bez prihásenia vidíť len prázdne polia `[]` (deny by default)
- ✅ Heslá sú v Supabase Auth (bcrypt hash), nikdy v HTML

Pre **private repo** (tento prípad): kód a key vidíš len ty a pozvaní spolupracovníci.

---

## 🛠️ Tech stack

| Vrstva | Technológia |
|---|---|
| UI framework | Vue 3 (CDN, global build) |
| Štýly | Tailwind CSS (CDN) |
| Ikony | Inline SVG (vlastná sada) |
| Font | Inter (Google Fonts) |
| Backend | Supabase (PostgreSQL + PostgREST + Auth) |
| PDF | pdfMake (CDN) |
| Grafy | Chart.js (CDN) |
| Auth | Supabase Auth (email + heslo) |
| Storage | localStorage (preference, nastavenia) |

Žiadny build step, žiadne npm install — iba otvoríš HTML a funguje.

---

## 📁 Štruktúra repa

```
cauntpex/
├── apex-fakturacia.html       # Hlavný HTML (6 KB)
├── apex-app.js                # Vue aplikácia (~148 KB)
├── apex-migration-fix.sql     # SQL migrácia databázy (v1.0.1)
├── README.md                  # Tento súbor
├── SETUP.md                   # Krok-za-krokom setup pre nový projekt
├── LICENSE                    # All Rights Reserved (private repo)
├── .gitignore                 # Ignorované súbory
└── .env.example               # Template pre environment (voliteľné)
```

---

## 📝 Úpravy a vývoj

### Ako urobiť zmenu

**Možnosť 1 — GitHub Web Editor** (najjednoduchšie)
1. Choď na github.com/k4ucc1/cauntpex
2. Klikni na súbor → ✏️ Edit
3. Zmeň, napíš commit message, commit

**Možnosť 2 — VS Code + git** (odporúčané pre väčšie zmeny)
```bash
git clone https://github.com/k4ucc1/cauntpex.git
cd cauntpex
# edit v VS Code
git add .
git commit -m "popis zmeny"
git push
```

**Možnosť 3 — cez OpenCode AI** (ak máš)
- Povedz „zmeň X v ApexFakturácii" a opencode to spraví + commitne

### Testovanie zmien lokálne
Po klone alebo change:
1. Otvor `apex-fakturacia.html` v prehliadači
2. Ak vidíš zmenu — OK
3. Ak ti prehliadač cacheuje starú verziu: **Ctrl+Shift+R** (hard refresh)

---

## 📜 Licencia

**All Rights Reserved** — súkromný repozitár pre Apexholding, s.r.o.  
Bez explicitného písomného súhlasu nesmie byť kód distribuuovaný ani použitý v iných projektoch.

---

## 📞 Kontakt

**Apexholding, s.r.o.**  
Developed & maintained via OpenCode AI
