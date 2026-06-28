# 💎 Apex Finance

Moderný fakturačný a pokladničný systém pre **Apexholding, s.r.o.** — single-page HTML aplikácia s cloud backendom.

> **Verzia:** 1.1.0  
> **Posledná aktualizácia:** 2026-06  
> **Stav:** Produkčná (MVP)  
> **🌐 Online:** https://k4ucc1.github.io/apexfinance/

---

## ✨ Funkcie

### Aktuálne (MVP)
- 📊 **Dashboard** — KPI karty, graf obratu za 6 mesiacov, prehľad po splatnosti
- 📄 **Faktúry** — tvorba, editácia, statusy (návrh / odoslaná / zaplatená / po splatnosti / stornovaná), PDF export
- 🧾 **Prijímové pokladničné doklady (PPD)** — hotovostné a kartové platby
- 👥 **Kontakty** — Zákazníci a Dodávatelia s **automatickým dopĺňaním z obchodných registrov SR/CZ**
- 📦 **Artikle a Skupiny** — katalóg produktov a služieb, stromová štruktúra skupín
- 📈 **Reporty** — top zákazníci, obrat za obdobie, prehľad faktúr
- ⚙️ **Nastavenia** — firma, číslovanie dokladov, DPH sadzby, pripojenie, používatelia

### Bezpečnosť
- 🔐 Prihlásenie emailom + heslom (cloud Auth)
- 🛡️ **Row Level Security** — každý dotaz musí byť autentifikovaný
- ⏱️ Automatické odhlásenie po 10 minútach nečinnosti
- 🚫 **Rate limit prihlásenia**: 5 neúspešných pokusov → 15 min blok (aplikáčne) + cloud Auth limit (5/5min z IP)

### Plánované do budúcna
- 💰 **Účtovníctvo** — prijaté faktúry, banka, účtovný denník, účtovný rozvrh
- 🏦 Bankový import výpisov
- 📧 Automatické odosielanie faktúr emailom
- 🎨 Logo firmy na faktúrach
- 🔢 2FA / MFA pre admina

---

## 🚀 Spustenie

### 🌐 Online (odporúčané)

**Priamo z GitHub Pages (nič sa nemusí inštalovať):**

👉 **https://k4ucc1.github.io/apexfinance/**

Stačí kliknúť a prihlásiť sa.

### Možnosť A — Lokálne

```bash
git clone https://github.com/k4ucc1/apexfinance.git
cd apexfinance
# Otvor index.html v prehliadači (dvojklik)
```

Aplikácia nabehne s prednastaveným pripojením.

### Možnosť B — Iný hosting

- **Netlify** / **Vercel** / **Cloudflare Pages** — spoj s repom, automatický deploy pri push
- Vlastný server — nahrať `index.html` + `apex-app.js` kdekoľvek s podporou statických súborov
- Žiadny build step, žiadne npm install

---

## 🗄️ Backend

Aplikácia funguje na **Supabase** (open-source backend-as-a-service):
- 🐘 **PostgreSQL** databáza (Postgres + RLS)
- 🔐 **Auth** (email + heslo, bcrypt hash)
- 📦 **Storage** pre logá a prílohy
- 🔄 **Realtime** API (pre budúcnosť)

### Ako funguje bezpečnosť

Aplikácia v klientskom kóde obsahuje **publishable key** — ten je **dizajnovaný** na zverejnenie (podobne ako Google Maps API key či Stripe publishable key). Bezpečnosť nedáva key, ale:

1. **Row Level Security** v Postgres — každý SELECT/INSERT/UPDATE/DELETE musí prejsť cez RLS politiku
2. **Auth JWT** — dotazy musia obsahovať platný token z úspešného prihlásenia
3. **Heslá** sú v Auth službe (bcrypt hash), nikdy v kóde

Bez platného prihlásenia vidí ktokoľvek iba `[]` (deny by default).

### Zmena databázy

Ak chceš použiť inú databázu:
1. Otvor aplikáciu
2. **Nastavenia → Pripojenie**
3. Zadaj novú URL a publishable key
4. Ulož

---

## 🛠️ Tech stack

| Vrstva | Technológia |
|---|---|
| UI framework | Vue 3 (CDN, global build) |
| Štýly | Tailwind CSS (CDN) |
| Ikony | Inline SVG (vlastná sada, farebná) |
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
apexfinance/
├── index.html                # Hlavný HTML - vstupný bod
├── apex-app.js               # Vue aplikácia
├── apex-migration-fix.sql    # SQL migrácia databázy (v1.0.1)
├── README.md                 # Tento súbor
├── SETUP.md                  # Krok-za-krokom setup pre nový projekt
├── LICENSE                   # All Rights Reserved
├── .gitignore                # Ignorované súbory
├── .nojekyll                 # Zabraňuje Jekyll spracovaniu na Pages
└── .env.example              # Template pre environment (voliteľné)
```

---

## 📝 Úpravy a vývoj

### Možnosť 1 — GitHub Web Editor (najjednoduchšie)
1. Choď na https://github.com/k4ucc1/apexfinance
2. Klikni na súbor → ✏️ Edit
3. Zmeň, napíš commit message, commit

### Možnosť 2 — VS Code + git
```bash
git clone https://github.com/k4ucc1/apexfinance.git
cd apexfinance
# edit v VS Code
git add .
git commit -m "popis zmeny"
git push
```

Po push sa GitHub Pages automaticky **rebuildne do 1-2 minút**.

---

## 📜 Licencia

**All Rights Reserved** — repozitár pre Apexholding, s.r.o.  
Bez explicitného písomného súhlasu nesmie byť kód distribuovaný ani použitý v iných projektoch.

---

## 📞 Kontakt

**Apexholding, s.r.o.**  
Aplikáciu vyvinul a spravuje: OpenCode AI
