"use strict";
/* ============================================================================
   ApexHolding Fakturácia — Single Page App
   Vue 3 + Tailwind + Supabase + pdfMake + Chart.js
   ============================================================================ */
const { createApp, ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick, defineAsyncComponent } = Vue;
const { defineEmits, defineProps } = { defineEmits: () => {}, defineProps: () => {} };

/* =============================== CONFIG ================================== */
const APP_VERSION = '1.0.0';
const LS_CONFIG = 'apex_invoice_config';
const LS_LAST_USER = 'apex_invoice_last_user';
const LS_LOGIN_ATTEMPTS = 'apex_login_attempts';
const IDLE_TIMEOUT_MIN = 10;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_DURATION = 15 * 60 * 1000; // 15 minút v ms
const DEFAULT_SUPABASE_URL = 'https://qszcrlptiwircitfuela.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_mPDoup1hboMph_iUUlN5Jw_LzB3sWoe';

const VAT_RATES = [
  { code:'STD',  rate:20,   name:'Základná 20%' },
  { code:'RED',  rate:10,   name:'Znížená 10%' },
  { code:'ZERO', rate:0,    name:'Nulová 0%' },
  { code:'NULL', rate:null, name:'Nie je predmetom DPH' }
];
const INVOICE_STATUSES = {
  draft:    { label:'Návrh',         bg:'bg-slate-100',   text:'text-slate-700' },
  sent:     { label:'Odoslaná',      bg:'bg-blue-100',    text:'text-blue-700' },
  paid:     { label:'Zaplatená',     bg:'bg-emerald-100', text:'text-emerald-700' },
  partial:  { label:'Čiastočne',     bg:'bg-amber-100',   text:'text-amber-700' },
  overdue:  { label:'Po splatnosti', bg:'bg-red-100',     text:'text-red-700' },
  cancelled:{ label:'Stornovaná',    bg:'bg-zinc-100',    text:'text-zinc-700' }
};
const PAYMENT_METHODS = { prevod:'Prevodom', hotovost:'Hotovosť', karta:'Karta' };
const PAYMENT_FORMS   = { hotovost:'Hotovosť', karta:'Karta', prevod:'Prevod' };
const ARTICLE_UNITS = ['ks','hod','deň','m','m²','m³','kg','km','bal','sada','liter','mes','rok'];
const PARTNER_TYPES = { customer:'Zákazník', supplier:'Dodávateľ', both:'Zákazník + Dodávateľ' };
const ARTICLE_GROUP_TYPES = { service:'Služba', goods:'Tovar', material:'Materiál', fee:'Poplatok', other:'Iné' };

const NAV = [
  { group:'Hlavné', items:[
    { key:'dashboard', label:'Dashboard',          icon:'layout-dashboard' },
    { key:'invoices',  label:'Faktúry',            icon:'file-text' },
    { key:'receipts',  label:'Prijímové doklady',  icon:'receipt' },
  ]},
  { group:'Adresár', items:[
    { key:'customers', label:'Zákazníci',   icon:'users',  view:'partners', params:{type:'customer'} },
    { key:'suppliers', label:'Dodávatelia', icon:'truck',  view:'partners', params:{type:'supplier'} },
  ]},
  { group:'Sklad', items:[
    { key:'articles',       label:'Artikle',           icon:'package' },
    { key:'article-groups', label:'Skupiny artiklov',  icon:'folder-tree' },
  ]},
  { group:'Analýza', items:[
    { key:'reports',     label:'Reporty',       icon:'bar-chart-3' },
    { key:'accounting',  label:'Účtovníctvo',   icon:'calculator', disabled:true, badge:'Soon' },
  ]},
  { group:'Systém', items:[
    { key:'settings',    label:'Nastavenia',    icon:'settings' },
  ]}
];

/* =============================== UTILS =================================== */
const fmtEUR = (n) => new Intl.NumberFormat('sk-SK',{style:'currency',currency:'EUR'}).format(Number(n||0));
const fmtNum = (n,d=2) => new Intl.NumberFormat('sk-SK',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(n||0));
const fmtDate = (d) => { if(!d) return ''; const dt=(typeof d==='string')?new Date(d):d; if(isNaN(dt)) return ''; return new Intl.DateTimeFormat('sk-SK',{day:'2-digit',month:'2-digit',year:'numeric'}).format(dt); };
const todayISO = () => new Date().toISOString().slice(0,10);
const addDaysISO = (iso,days) => { const d=new Date(iso); d.setDate(d.getDate()+Number(days)); return d.toISOString().slice(0,10); };
const round2 = (n) => Math.round((Number(n)+Number.EPSILON)*100)/100;
const roundWhole = (n) => Math.round(Number(n));
const uid = () => 'tmp_'+Math.random().toString(36).slice(2,11);
const debounce = (fn,wait=300) => { let t; return function(...a){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,a),wait); }; };

function calcItem(item) {
  const qty=Number(item.quantity||0), price=Number(item.unit_price||0);
  const gross=qty*price;
  const discPct=Number(item.discount_pct||0), discAmt=Number(item.discount_amount||0);
  let net=gross*(1-discPct/100)-discAmt;
  if(net<0) net=0;
  const rate=item.vat_rate==null?0:Number(item.vat_rate);
  const vat=net*(rate/100);
  return { total_net:round2(net), total_vat:round2(vat), total_gross:round2(net+vat) };
}
function calcInvoice(items, useRounding=true) {
  const byVat={}; let subtotal=0, vatTotal=0, gross=0;
  items.forEach(it=>{
    const c=calcItem(it);
    const key=String(it.vat_rate ?? 'null');
    if(!byVat[key]) byVat[key]={rate:it.vat_rate,net:0,vat:0,gross:0};
    byVat[key].net+=c.total_net; byVat[key].vat+=c.total_vat; byVat[key].gross+=c.total_gross;
    subtotal+=c.total_net; vatTotal+=c.total_vat; gross+=c.total_gross;
  });
  let rounding=0;
  if(useRounding) rounding=round2(roundWhole(gross)-gross);
  return {
    subtotal:round2(subtotal), vatTotal:round2(vatTotal), gross:round2(gross),
    rounding, total:round2(gross+rounding),
    byVat:Object.values(byVat).map(b=>({...b,net:round2(b.net),vat:round2(b.vat),gross:round2(b.gross)})).sort((a,b)=>Number(b.rate||0)-Number(a.rate||0))
  };
}

/* IČO lookup — registeruz.sk s fallback proxy */
async function lookupSlovakICO(ico) {
  const clean=(ico||'').replace(/\D/g,'');
  if(clean.length!==8) throw new Error('IČO musí mať 8 číslic');
  const endpoints=[
    `https://www.registeruz.sk/cruz-public/api/zmena-udajov-subjektu?ico=${clean}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent('https://www.registeruz.sk/cruz-public/api/zmena-udajov-subjektu?ico='+clean)}`,
    `https://corsproxy.io/?url=${encodeURIComponent('https://www.registeruz.sk/cruz-public/api/zmena-udajov-subjektu?ico='+clean)}`
  ];
  let lastErr;
  for(const url of endpoints){
    try {
      const r=await fetch(url,{headers:{'Accept':'application/json'}});
      if(!r.ok){ lastErr=new Error('HTTP '+r.status); continue; }
      const data=await r.json();
      const rec=Array.isArray(data)?data[0]:data;
      if(rec && (rec.nazov||rec.dic)) return normalizeRegisteruz(rec, clean);
    } catch(e){ lastErr=e; }
  }
  throw lastErr || new Error('Subjekt sa nenašiel');
}
function normalizeRegisteruz(rec, ico) {
  return {
    ico, dic:rec.dic||'', ic_dph:rec.dic?('SK'+rec.dic):'',
    name:rec.nazov||rec.meno||'',
    address:[rec.ulica,rec.cisloScri].filter(Boolean).join(' '),
    city:rec.obec||'', zip:(rec.psc||'').toString().replace(/(\d{3})(\d{2})/,'$1 $2'),
    country:'Slovensko', source:'registeruz.sk', raw:rec
  };
}

/* =============================== SUPABASE ================================ */
let _sb = null;
function loadConfig() { try { return JSON.parse(localStorage.getItem(LS_CONFIG)||'null')||{}; } catch { return {}; } }
function saveConfig(cfg) { localStorage.setItem(LS_CONFIG, JSON.stringify(cfg)); _sb=null; }
function getSB() {
  if(_sb) return _sb;
  const cfg=loadConfig();
  if(!cfg.url||!cfg.key) return null;
  _sb=supabase.createClient(cfg.url, cfg.key, { auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false} });
  return _sb;
}
const db = {
  async select(table, opts={}) {
    const s=getSB(); if(!s) return {data:null,error:new Error('No client')};
    let q=s.from(table).select(opts.select||'*');
    if(opts.eq) Object.entries(opts.eq).forEach(([k,v])=>{ q=q.eq(k,v); });
    if(opts.order) q=q.order(opts.order[0],{ascending:opts.order[1]!==false});
    if(opts.limit) q=q.limit(opts.limit);
    if(opts.single) return await q.single();
    return await q;
  },
  async insert(table, row) { const s=getSB(); return await s.from(table).insert(row).select().single(); },
  async update(table, id, patch) { const s=getSB(); return await s.from(table).update(patch).eq('id',id).select().single(); },
  async delete(table, id) { const s=getSB(); return await s.from(table).delete().eq('id',id); }
};
async function nextDocNumber(docType, prefix) {
  const s=getSB(); const year=new Date().getFullYear();
  const { data } = await s.from('number_sequences').select('*').eq('doc_type',docType).eq('year',year).maybeSingle();
  if(!data) {
    const ins={doc_type:docType,year,prefix:prefix||docType.toUpperCase().slice(0,3),separator:'-',last_number:1,padding:4,format_template:'{PREFIX}{YEAR}{SEP}{PAD}'};
    const { data:created, error } = await s.from('number_sequences').insert(ins).select().single();
    if(error) throw error;
    return formatDocNumber(created);
  }
  const newNum=(data.last_number||0)+1;
  await s.from('number_sequences').update({last_number:newNum}).eq('id',data.id);
  return formatDocNumber({...data, last_number:newNum});
}
function formatDocNumber(seq) {
  const numStr=String(seq.last_number).padStart(seq.padding||4,'0');
  return (seq.format_template||'{PREFIX}{YEAR}{SEP}{PAD}')
    .replace('{PREFIX}',seq.prefix).replace('{YEAR}',String(seq.year))
    .replace('{SEP}',seq.separator||'').replace('{PAD}',numStr);
}

/* =============================== UI STORE ================================ */
const UI = reactive({
  toasts:[], confirm:null,
  toast(msg, type='info', timeout=3500) {
    const id='t'+Date.now()+Math.random().toString(36).slice(2);
    UI.toasts.push({id,msg,type});
    if(timeout) setTimeout(()=>{ UI.toasts=UI.toasts.filter(t=>t.id!==id); }, timeout);
  },
  ask(opts) { return new Promise(resolve=>{ UI.confirm={...opts,resolve}; }); },
});

/* =============================== ICON ==================================== */
const ICONS = {
  'layout-dashboard':'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  'file-text':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  'receipt':'<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  'users':'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  'truck':'<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/>',
  'package':'<path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  'folder-tree':'<path d="M20 10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3.93a2 2 0 0 0-1.66.9l-.82 1.2a2 2 0 0 1-1.66.9H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14Z"/><path d="M2 20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>',
  'bar-chart-3':'<path d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"/>',
  'calculator':'<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/>',
  'settings':'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'plus':'<path d="M5 12h14M12 5v14"/>','search':'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'log-out':'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  'edit':'<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  'trash':'<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'x':'<path d="M18 6 6 18M6 6l12 12"/>','download':'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  'print':'<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
  'check':'<path d="M20 6 9 17l-5-5"/>','check-circle':'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  'arrow-left':'<path d="m12 19-7-7 7-7M19 12H5"/>','loader':'<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>',
  'eye':'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  'building':'<path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/>',
  'phone':'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  'mail':'<path d="m22 7-10 5L2 7M2 7v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>',
  'map-pin':'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  'globe':'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'credit-card':'<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',
  'landmark':'<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  'tag':'<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  'percent':'<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  'alert-circle':'<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'chevron-down':'<path d="m6 9 6 6 6-6"/>','chevron-right':'<path d="m9 18 6-6-6-6"/>','chevron-left':'<path d="m15 18-6-6 6-6"/>',
  'filter':'<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  'copy':'<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'send':'<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  'user':'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'save':'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  'lock':'<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'refresh':'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5"/>',
  'database':'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5M3 12A9 3 0 0 0 21 12"/>',
  'trending-up':'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'trending-down':'<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  'clock':'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'wallet':'<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  'folder-plus':'<path d="M12 10v6M9 13h6M20 6v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2Z"/>',
  'external-link':'<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'qr-code':'<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="16" y="3" width="5" height="5" rx="1"/><rect x="3" y="16" width="5" height="5" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3a2 2 0 0 1-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h.01M12 21v.01"/>',
  'archive':'<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  'menu':'<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
  'info':'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  'zap':'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'shield':'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  'calendar':'<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
  'file-plus':'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5M12 12v6M9 15h6"/>',
  'more-horizontal':'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'briefcase':'<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  'toggle-left':'<rect width="20" height="12" x="2" y="6" rx="6"/><circle cx="8" cy="12" r="2"/>',
  'toggle-right':'<rect width="20" height="12" x="2" y="6" rx="6"/><circle cx="16" cy="12" r="2"/>',
  'hash':'<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  'sync':'<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>'
};
const Icon = {
  name:'Icon',
  props:{ name:String, size:{type:Number,default:20} },
  template:`<svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="ICONS[name] || ICONS['info']"></svg>`,
  setup(){ return { ICONS }; }
};

/* =============================== TOASTS ================================== */
const Toasts = {
  setup(){
    const colors={
      success:{bg:'bg-emerald-50',border:'border-emerald-200',icon:'check-circle',color:'text-emerald-600'},
      error:{bg:'bg-red-50',border:'border-red-200',icon:'alert-circle',color:'text-red-600'},
      info:{bg:'bg-blue-50',border:'border-blue-200',icon:'info',color:'text-blue-600'},
      warn:{bg:'bg-amber-50',border:'border-amber-200',icon:'alert-circle',color:'text-amber-600'}
    };
    return {UI,colors};
  },
  template:`
    <div class="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      <transition-group name="toast">
        <div v-for="t in UI.toasts" :key="t.id" :class="[colors[t.type].bg,colors[t.type].border]" class="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg min-w-[280px] max-w-md">
          <icon :name="colors[t.type].icon" :size="20" :class="colors[t.type].color"></icon>
          <span class="text-sm font-medium text-slate-700 flex-1">{{ t.msg }}</span>
        </div>
      </transition-group>
    </div>`
};
const ConfirmDialog = {
  setup(){
    const confirm=()=>{ UI.confirm.resolve(true); UI.confirm=null; };
    const cancel=()=>{ UI.confirm.resolve(false); UI.confirm=null; };
    return {UI,confirm,cancel};
  },
  template:`
    <transition name="modal">
      <div v-if="UI.confirm" class="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" @click.self="cancel">
        <transition name="modal-content" appear>
          <div v-if="UI.confirm" class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div class="flex items-start gap-4">
              <div class="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <icon name="alert-circle" :size="22" class="text-amber-600"></icon>
              </div>
              <div class="flex-1">
                <h3 class="text-lg font-bold text-slate-900">{{ UI.confirm.title || 'Potvrdenie' }}</h3>
                <p class="text-sm text-slate-600 mt-1">{{ UI.confirm.message }}</p>
              </div>
            </div>
            <div class="flex justify-end gap-2 mt-6">
              <button class="btn btn-secondary" @click="cancel">{{ UI.confirm.cancelText || 'Zrušiť' }}</button>
              <button :class="UI.confirm.danger ? 'btn btn-danger' : 'btn btn-primary'" @click="confirm">{{ UI.confirm.confirmText || 'Potvrdiť' }}</button>
            </div>
          </div>
        </transition>
      </div>
    </transition>`
};

/* =============================== AUTH RATE LIMIT ========================= */
/* Aplikačný rate limit pre neúspešné prihlásenia (5 pokusov / 15 min blok).
   Doplnok k Supabase Auth server-side limitu (5/5min z IP). */
function getLoginAttempts() {
  try { return JSON.parse(localStorage.getItem(LS_LOGIN_ATTEMPTS) || '{}'); }
  catch { return {}; }
}
function checkLoginLock() {
  const data = getLoginAttempts();
  if (data.blockedUntil && Date.now() < data.blockedUntil) {
    const mins = Math.ceil((data.blockedUntil - Date.now()) / 60000);
    const secs = Math.ceil((data.blockedUntil - Date.now()) / 1000) % 60;
    return mins > 0 ? `Príliš veľa pokusov. Skúste znova o ${mins} min.` : `Skúste znova o ${secs} s.`;
  }
  if (data.blockedUntil && Date.now() >= data.blockedUntil) {
    // Block vypršal - reset
    localStorage.removeItem(LS_LOGIN_ATTEMPTS);
  }
  return null;
}
function recordFailedLogin() {
  const data = getLoginAttempts();
  data.count = (data.count || 0) + 1;
  data.lastAttempt = Date.now();
  if (data.count >= LOGIN_MAX_ATTEMPTS) {
    data.blockedUntil = Date.now() + LOGIN_BLOCK_DURATION;
    data.count = 0;
  }
  localStorage.setItem(LS_LOGIN_ATTEMPTS, JSON.stringify(data));
  return LOGIN_MAX_ATTEMPTS - (data.count || 0);
}
function resetLoginAttempts() {
  localStorage.removeItem(LS_LOGIN_ATTEMPTS);
}

/* =============================== SETUP SCREEN ============================ */
const SetupScreen = {
  emits:['done'],
  setup(_, {emit}){
    const cfg=reactive({ url: loadConfig().url||DEFAULT_SUPABASE_URL, key: loadConfig().key||DEFAULT_SUPABASE_KEY });
    const testing=ref(false), testResult=ref(null);
    async function test(){
      testing.value=true; testResult.value=null;
      try {
        const tmp=supabase.createClient(cfg.url, cfg.key);
        const {data, error}=await tmp.from('companies').select('id').limit(1);
        if(error) throw error;
        saveConfig({url:cfg.url, key:cfg.key});
        testResult.value={ok:true, msg:'Pripojenie úspešné! Databáza reaguje.'};
        UI.toast('Pripojenie úspešné','success');
        setTimeout(()=>emit('done'), 700);
      } catch(e){
        testResult.value={ok:false, msg:e.message||'Pripojenie zlyhalo'};
        UI.toast('Pripojenie zlyhalo','error');
      } finally { testing.value=false; }
    }
    function skip(){ saveConfig({url:cfg.url, key:cfg.key}); emit('done'); }
    return {cfg, testing, testResult, test, skip};
  },
  template:`
    <div class="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/40 to-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      <div class="absolute -top-32 -right-32 w-96 h-96 bg-brand-200/30 rounded-full blur-3xl"></div>
      <div class="absolute -bottom-32 -left-32 w-96 h-96 bg-indigo-200/30 rounded-full blur-3xl"></div>
      <div class="relative w-full max-w-lg">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl shadow-lg shadow-brand-600/30 mb-4">
            <icon name="landmark" :size="32" class="text-white"></icon>
          </div>
          <h1 class="text-3xl font-extrabold text-slate-900 tracking-tight">ApexHolding Fakturácia</h1>
          <p class="text-slate-500 mt-2">Pripojenie k databáze Supabase</p>
        </div>
        <div class="card p-7 shadow-xl">
          <div class="space-y-4">
            <div><label class="label">Supabase Project URL</label><input class="input" v-model="cfg.url" placeholder="https://xxxxx.supabase.co"/></div>
            <div><label class="label">Publishable / anon key</label><textarea class="input font-mono text-xs" rows="3" v-model="cfg.key" placeholder="sb_publishable_..."></textarea></div>
            <div v-if="testResult" :class="testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'" class="border rounded-lg p-3 text-sm flex items-center gap-2">
              <icon :name="testResult.ok ? 'check-circle' : 'alert-circle'" :size="18"></icon>{{ testResult.msg }}
            </div>
            <div class="flex gap-2 pt-2">
              <button class="btn btn-primary flex-1 justify-center" @click="test" :disabled="testing || !cfg.url || !cfg.key">
                <icon v-if="testing" name="loader" :size="18" class="spin"></icon>
                <icon v-else name="database" :size="18"></icon>
                {{ testing ? 'Testujem...' : 'Otestovať a pripojiť' }}
              </button>
              <button class="btn btn-secondary" @click="skip" :disabled="testing">Preskočiť</button>
            </div>
          </div>
          <div class="mt-6 pt-6 border-t border-slate-100">
            <div class="flex items-start gap-2 text-xs text-slate-500">
              <icon name="shield" :size="16" class="text-emerald-500 shrink-0 mt-0.5"></icon>
              <span>Kľúč je <strong>publishable</strong> — bezpečný na zobrazenie v klientskom kóde. Prístup k dátam chráni Row Level Security (RLS) v Postgre.</span>
            </div>
          </div>
        </div>
      </div>
    </div>`
};

/* =============================== LOGIN SCREEN =========================== */
const LoginScreen = {
  emits:['success'],
  setup(_, {emit}){
    const email=ref(localStorage.getItem(LS_LAST_USER)||''), password=ref(''), loading=ref(false), errMsg=ref('');
    const lockMsg=ref(checkLoginLock());
    const remainingAttempts=ref(0);

    // Obnov lockMsg každú sekundu (pre countdown)
    let lockTimer=null;
    if(lockMsg.value){
      lockTimer=setInterval(()=>{ lockMsg.value=checkLoginLock(); if(!lockMsg.value) { clearInterval(lockTimer); lockTimer=null; } }, 1000);
    }

    async function submit(){
      // Skontroluj lock
      const lock=checkLoginLock();
      if(lock){ lockMsg.value=lock; errMsg.value=lock; return; }
      lockMsg.value=null;

      loading.value=true; errMsg.value='';
      try {
        const s=getSB();
        const {data, error}=await s.auth.signInWithPassword({email:email.value, password:password.value});
        if(error) throw error;
        // Úspech - reset pokusov
        resetLoginAttempts();
        localStorage.setItem(LS_LAST_USER, email.value);
        UI.toast('Vitajte späť!','success');
        emit('success', data.user);
      } catch(e){
        const left=recordFailedLogin();
        if(left<=0){
          // Bol dosiahnutý limit - blokujeme
          lockMsg.value=checkLoginLock();
          errMsg.value=lockMsg.value || 'Účet bol dočasne zablokovaný';
          if(lockTimer) clearInterval(lockTimer);
          lockTimer=setInterval(()=>{ lockMsg.value=checkLoginLock(); if(!lockMsg.value){ clearInterval(lockTimer); lockTimer=null; } }, 1000);
        } else {
          errMsg.value=(e.message||'Prihlásenie zlyhalo').replace('Invalid login credentials','Nesprávny email alebo heslo') + ` (${left} pokus${left===1?'':'ov'} zostáva)`;
          remainingAttempts.value=left;
        }
      } finally { loading.value=false; }
    }

    onBeforeUnmount(()=>{ if(lockTimer) clearInterval(lockTimer); });
    return {email, password, loading, errMsg, lockMsg, remainingAttempts, submit};
  },
  template:`
    <div class="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/40 to-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      <div class="absolute -top-32 -right-32 w-96 h-96 bg-brand-200/30 rounded-full blur-3xl"></div>
      <div class="absolute -bottom-32 -left-32 w-96 h-96 bg-indigo-200/30 rounded-full blur-3xl"></div>
      <div class="relative w-full max-w-md">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl shadow-lg shadow-brand-600/30 mb-4">
            <icon name="landmark" :size="32" class="text-white"></icon>
          </div>
          <h1 class="text-2xl font-extrabold text-slate-900 tracking-tight">Prihlásenie</h1>
          <p class="text-slate-500 mt-1.5 text-sm">ApexHolding Fakturácia</p>
        </div>
        <div class="card p-7 shadow-xl">
          <form @submit.prevent="submit" class="space-y-4">
            <div>
              <label class="label">Email</label>
              <div class="relative">
                <icon name="mail" :size="18" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></icon>
                <input class="input pl-10" type="email" v-model="email" placeholder="vas@email.sk" required autocomplete="username"/>
              </div>
            </div>
            <div>
              <label class="label">Heslo</label>
              <div class="relative">
                <icon name="lock" :size="18" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></icon>
                <input class="input pl-10" type="password" v-model="password" placeholder="••••••••" required autocomplete="current-password"/>
              </div>
            </div>
            <div v-if="errMsg" class="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-center gap-2">
              <icon name="alert-circle" :size="18"></icon>{{ errMsg }}
            </div>
            <div v-if="lockMsg" class="bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-3 text-sm flex items-center gap-2 font-medium">
              <icon name="lock" :size="18"></icon>{{ lockMsg }}
            </div>
            <button class="btn btn-primary w-full justify-center" :disabled="loading || !email || !password">
              <icon v-if="loading" name="loader" :size="18" class="spin"></icon>
              <icon v-else name="log-out" :size="18" class="rotate-180"></icon>
              {{ loading ? 'Prihlasujem...' : 'Prihlásiť sa' }}
            </button>
          </form>
        </div>
        <p class="text-center text-xs text-slate-400 mt-6">Z dôvodu nečinnosti budete automaticky odhlásený po 10 minútach.</p>
      </div>
    </div>`
};

/* =============================== SIDEBAR + TOPBAR ======================= */
const Sidebar = {
  props:['current','collapsed'],
  emits:['navigate'],
  template:`
    <aside :class="collapsed ? 'w-20' : 'w-64'" class="bg-white border-r border-slate-200 flex flex-col shrink-0 transition-all duration-200 h-screen sticky top-0">
      <div class="h-16 flex items-center gap-3 px-5 border-b border-slate-100 shrink-0">
        <div class="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center shrink-0 shadow-md shadow-brand-600/30">
          <icon name="landmark" :size="20" class="text-white"></icon>
        </div>
        <div v-if="!collapsed" class="overflow-hidden">
          <div class="text-sm font-bold text-slate-900 leading-tight">ApexHolding</div>
          <div class="text-[11px] text-slate-400 leading-tight">Fakturácia v1.0</div>
        </div>
      </div>
      <nav class="flex-1 overflow-y-auto py-4 px-3">
        <template v-for="grp in NAV" :key="grp.group">
          <div v-if="!collapsed" class="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{{ grp.group }}</div>
          <div v-else class="my-2 mx-3 border-t border-slate-100"></div>
          <div class="space-y-0.5 mb-3">
            <div v-for="item in grp.items" :key="item.key" :class="[item.key===current ? 'active' : '', item.disabled ? 'disabled' : '']" class="nav-item" :title="collapsed ? item.label : ''" @click="!item.disabled && $emit('navigate', item)">
              <icon :name="item.icon" :size="20" class="shrink-0"></icon>
              <span v-if="!collapsed" class="flex-1 truncate">{{ item.label }}</span>
              <span v-if="!collapsed && item.badge" class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">{{ item.badge }}</span>
            </div>
          </div>
        </template>
      </nav>
      <div v-if="!collapsed" class="p-3 border-t border-slate-100 shrink-0"><div class="text-[10px] text-slate-400 px-3">© 2026 Apexholding, s.r.o.</div></div>
    </aside>`,
  setup(){ return { NAV }; }
};
const TopBar = {
  props:['user','title'],
  emits:['logout','toggle-sidebar','quick-action'],
  setup(props, {emit}){
    const menuOpen=ref(false);
    return {props, menuOpen, emit};
  },
  template:`
    <header class="h-16 bg-white border-b border-slate-200 px-5 flex items-center gap-4 shrink-0 sticky top-0 z-30">
      <button class="icon-btn" @click="$emit('toggle-sidebar')"><icon name="menu" :size="22"></icon></button>
      <h1 class="text-lg font-bold text-slate-900 flex-1 truncate">{{ props.title }}</h1>
      <button class="btn btn-primary btn-sm" @click="$emit('quick-action','new-invoice')"><icon name="plus" :size="16"></icon> <span class="hidden sm:inline">Nová faktúra</span></button>
      <div class="w-px h-8 bg-slate-200"></div>
      <div class="relative">
        <button class="flex items-center gap-2 hover:bg-slate-100 rounded-lg pl-1 pr-2 py-1 transition-colors" @click="menuOpen=!menuOpen">
          <div class="w-8 h-8 bg-brand-100 text-brand-700 rounded-lg flex items-center justify-center text-xs font-bold">{{ props.user?.email?.[0]?.toUpperCase() || 'U' }}</div>
          <icon name="chevron-down" :size="16" class="text-slate-400"></icon>
        </button>
        <transition name="fade">
          <div v-if="menuOpen" class="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-50" v-click-outside="()=>menuOpen=false">
            <div class="px-3 py-2 border-b border-slate-100">
              <div class="text-sm font-semibold text-slate-900 truncate">{{ props.user?.email }}</div>
              <div class="text-xs text-slate-400">Prihlásený</div>
            </div>
            <button class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 text-slate-600" @click="$emit('logout'); menuOpen=false">
              <icon name="log-out" :size="16"></icon> Odhlásiť sa
            </button>
          </div>
        </transition>
      </div>
    </header>`
};

/* =============================== STUB VIEWS ============================== */
/* Tieto budú nahradené skutočnými implementáciami v ďalších krokoch */
const StubView = {
  props:['name'],
  template:`<div class="p-6"><div class="empty-state"><icon :name="name || 'loader'" :size="48" class="mx-auto text-slate-300 mb-2"></icon><p class="font-medium">Modul sa pripravuje...</p></div></div>`
};

const Dashboard = {
  emits:['navigate','quick-action'],
  setup(_, {emit}){
    const loading=ref(true);
    const stats=reactive({ monthRevenue:0, monthCount:0, outstanding:0, overdue:0, lastMonthRevenue:0, growth:0, partners:0, articles:0 });
    const recent=ref([]), overdueList=ref([]), monthlyData=ref([]);
    let chart=null;
    const canvas=ref(null);

    async function load(){
      loading.value=true;
      const s=getSB();
      if(!s){ loading.value=false; return; }
      const now=new Date();
      const ymStart=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10);
      const prevMonthStart=new Date(now.getFullYear(),now.getMonth()-1,1).toISOString().slice(0,10);
      try {
        const [inv, partners, articles] = await Promise.all([
          s.from('invoices').select('id,number,issue_date,due_date,total,status,partner_id,partners(name)').order('issue_date',{ascending:false}).limit(100),
          s.from('partners').select('id',{count:'exact',head:true}),
          s.from('articles').select('id',{count:'exact',head:true})
        ]);
        const all = inv.data || [];
        const thisMonth = all.filter(i => i.issue_date>=ymStart && !['cancelled','draft'].includes(i.status));
        const prevMonth = all.filter(i => i.issue_date>=prevMonthStart && i.issue_date<ymStart && !['cancelled'].includes(i.status));
        stats.monthRevenue = thisMonth.reduce((a,i)=>a+Number(i.total||0),0);
        stats.monthCount = thisMonth.length;
        stats.lastMonthRevenue = prevMonth.reduce((a,i)=>a+Number(i.total||0),0);
        stats.growth = stats.lastMonthRevenue>0 ? ((stats.monthRevenue-stats.lastMonthRevenue)/stats.lastMonthRevenue*100) : (stats.monthRevenue>0?100:0);
        const today=todayISO();
        stats.outstanding = all.filter(i => ['sent','partial','overdue'].includes(i.status)).reduce((a,i)=>a+(Number(i.total||0)-Number(i.paid_amount||0)),0);
        stats.overdue = all.filter(i => ['sent','partial','overdue'].includes(i.status) && i.due_date && i.due_date<today).reduce((a,i)=>a+(Number(i.total||0)-Number(i.paid_amount||0)),0);
        stats.partners = partners.count || 0;
        stats.articles = articles.count || 0;
        recent.value = all.slice(0,6);
        overdueList.value = all.filter(i => ['sent','partial','overdue'].includes(i.status) && i.due_date && i.due_date<today).slice(0,5);
        const months=[];
        for(let i=5;i>=0;i--){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push({key:d.toISOString().slice(0,7),label:d.toLocaleDateString('sk-SK',{month:'short'}),value:0}); }
        all.forEach(inv=>{ if(['cancelled','draft'].includes(inv.status)) return; const ym=(inv.issue_date||'').slice(0,7); const m=months.find(x=>x.key===ym); if(m) m.value+=Number(inv.total||0); });
        monthlyData.value=months;
        await nextTick(); renderChart();
      } catch(e){ console.error('[Dashboard] load error:', e); UI.toast('Chyba dashboardu: '+e.message,'error'); }
      finally { loading.value=false; }
    }
    function renderChart(){
      if(!canvas.value || !window.Chart) return;
      if(chart) chart.destroy();
      const ctx=canvas.value.getContext('2d');
      const grad=ctx.createLinearGradient(0,0,0,260);
      grad.addColorStop(0,'rgba(79,70,229,0.25)');
      grad.addColorStop(1,'rgba(79,70,229,0)');
      chart=new Chart(ctx,{
        type:'line',
        data:{ labels:monthlyData.value.map(m=>m.label), datasets:[{ label:'Obrat (EUR)', data:monthlyData.value.map(m=>m.value), borderColor:'#4f46e5', backgroundColor:grad, fill:true, tension:0.35, borderWidth:2.5, pointBackgroundColor:'#4f46e5', pointRadius:4, pointHoverRadius:6 }] },
        options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{grid:{color:'#f1f5f9'},ticks:{callback:v=>v+' €'}}, x:{grid:{display:false}} } }
      });
    }
    onMounted(load);
    return { loading, stats, recent, overdueList, canvas, fmtEUR, fmtDate, INVOICE_STATUSES, emit, refresh:load };
  },
  template:`
    <div class="p-6 space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 class="text-2xl font-extrabold text-slate-900">Vitajte späť 👋</h2>
          <p class="text-sm text-slate-500 mt-1">Tu je prehľad vašej fakturácie.</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" @click="refresh"><icon name="refresh" :size="16"></icon> Obnoviť</button>
          <button class="btn btn-primary btn-sm" @click="emit('quick-action','new-invoice')"><icon name="plus" :size="16"></icon> Nová faktúra</button>
          <button class="btn btn-secondary btn-sm" @click="emit('quick-action','new-receipt')"><icon name="receipt" :size="16"></icon> Nový PPD</button>
        </div>
      </div>
      <div v-if="loading" class="text-center py-12"><icon name="loader" :size="32" class="spin mx-auto text-slate-400"></icon></div>
      <div v-else>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="stat-card">
            <div class="flex items-start justify-between">
              <div>
                <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tento mesiac</div>
                <div class="text-2xl font-extrabold text-slate-900 mt-1.5">{{ fmtEUR(stats.monthRevenue) }}</div>
                <div class="text-xs text-slate-500 mt-1">{{ stats.monthCount }} faktúr</div>
              </div>
              <div class="w-10 h-10 bg-brand-100 text-brand-600 rounded-xl flex items-center justify-center"><icon name="file-text" :size="20"></icon></div>
            </div>
            <div v-if="stats.growth!==0" class="mt-3 flex items-center gap-1 text-xs" :class="stats.growth>=0 ? 'text-emerald-600':'text-red-600'">
              <icon :name="stats.growth>=0?'trending-up':'trending-down'" :size="14"></icon>
              <span class="font-semibold">{{ stats.growth>=0?'+':'' }}{{ stats.growth.toFixed(1) }}%</span>
              <span class="text-slate-400">vs. minulý mesiac</span>
            </div>
          </div>
          <div class="stat-card">
            <div class="flex items-start justify-between">
              <div>
                <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Neuhradené</div>
                <div class="text-2xl font-extrabold text-slate-900 mt-1.5">{{ fmtEUR(stats.outstanding) }}</div>
                <div class="text-xs text-slate-500 mt-1">čaká na úhradu</div>
              </div>
              <div class="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center"><icon name="clock" :size="20"></icon></div>
            </div>
          </div>
          <div class="stat-card">
            <div class="flex items-start justify-between">
              <div>
                <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Po splatnosti</div>
                <div class="text-2xl font-extrabold text-red-600 mt-1.5">{{ fmtEUR(stats.overdue) }}</div>
                <div class="text-xs text-slate-500 mt-1">po termíne</div>
              </div>
              <div class="w-10 h-10 bg-red-100 text-red-600 rounded-xl flex items-center justify-center"><icon name="alert-circle" :size="20"></icon></div>
            </div>
          </div>
          <div class="stat-card">
            <div class="flex items-start justify-between">
              <div>
                <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Adresár</div>
                <div class="text-2xl font-extrabold text-slate-900 mt-1.5">{{ stats.partners }}</div>
                <div class="text-xs text-slate-500 mt-1">{{ stats.articles }} artiklov</div>
              </div>
              <div class="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center"><icon name="users" :size="20"></icon></div>
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          <div class="card p-5 lg:col-span-2">
            <div class="flex items-center justify-between mb-4">
              <div><h3 class="font-bold text-slate-900">Obrat za posledných 6 mesiacov</h3><p class="text-xs text-slate-500">Sumy faktúr podľa dátumu vystavenia</p></div>
              <div class="w-10 h-10 bg-brand-50 text-brand-600 rounded-lg flex items-center justify-center"><icon name="bar-chart-3" :size="20"></icon></div>
            </div>
            <div class="h-64"><canvas ref="canvas"></canvas></div>
          </div>
          <div class="card p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-bold text-slate-900">Po splatnosti</h3>
              <div class="w-10 h-10 bg-red-50 text-red-600 rounded-lg flex items-center justify-center"><icon name="alert-circle" :size="20"></icon></div>
            </div>
            <div v-if="overdueList.length===0" class="empty-state text-sm"><icon name="check-circle" :size="40" class="mx-auto text-emerald-300 mb-2"></icon><p>Žiadne faktúry po splatnosti. 🎉</p></div>
            <div v-else class="space-y-2">
              <div v-for="inv in overdueList" :key="inv.id" class="p-3 rounded-lg bg-red-50/50 border border-red-100 cursor-pointer hover:bg-red-50" @click="emit('quick-action',{view:'invoice-edit',id:inv.id})">
                <div class="flex items-center justify-between gap-2">
                  <div class="font-semibold text-sm text-slate-900 truncate">{{ inv.number }}</div>
                  <div class="text-sm font-bold text-red-600 shrink-0">{{ fmtEUR(inv.total) }}</div>
                </div>
                <div class="text-xs text-slate-500 mt-0.5 truncate">{{ inv.partners?.name || '—' }} · splatnosť {{ fmtDate(inv.due_date) }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="card mt-6">
          <div class="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 class="font-bold text-slate-900">Posledné faktúry</h3>
            <button class="text-sm text-brand-600 font-semibold hover:underline" @click="emit('navigate',{key:'invoices'})">Zobraziť všetky →</button>
          </div>
          <div v-if="recent.length===0" class="empty-state">
            <icon name="file-text" :size="48" class="mx-auto text-slate-300 mb-2"></icon>
            <p class="font-medium">Žiadne faktúry zatiaľ</p>
            <button class="btn btn-primary btn-sm mt-3" @click="emit('quick-action','new-invoice')"><icon name="plus" :size="16"></icon> Vystaviť prvú faktúru</button>
          </div>
          <table v-else class="data">
            <thead><tr><th>Číslo</th><th>Zákazník</th><th>Dátum</th><th>Splatnosť</th><th>Suma</th><th>Stav</th></tr></thead>
            <tbody>
              <tr v-for="inv in recent" :key="inv.id" class="cursor-pointer" @click="emit('quick-action',{view:'invoice-edit',id:inv.id})">
                <td class="font-semibold text-brand-700">{{ inv.number }}</td>
                <td>{{ inv.partners?.name || '—' }}</td>
                <td>{{ fmtDate(inv.issue_date) }}</td>
                <td>{{ fmtDate(inv.due_date) }}</td>
                <td class="font-semibold">{{ fmtEUR(inv.total) }}</td>
                <td><span :class="[INVOICE_STATUSES[inv.status].bg, INVOICE_STATUSES[inv.status].text]" class="badge">{{ INVOICE_STATUSES[inv.status].label }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>`
};
const InvoiceList = {
  emits:['edit','new'],
  setup(_, {emit}){
    const loading=ref(true), search=ref(''), statusFilter=ref('');
    const items=ref([]);
    async function load(){
      loading.value=true;
      try {
        const s=getSB();
        if(!s){ UI.toast('Chyba: Supabase nie je inicializovan�','error'); return; }
        const {data, error}=await s.from('invoices').select('id,number,issue_date,due_date,total,status,partner_id,partners(name)').order('issue_date',{ascending:false}).limit(300);
        if(error) throw error;
        items.value=data||[];
      } catch(e){
        console.error('[InvoiceList] load error:', e);
        UI.toast('Chyba pri na��tan� fakt�r: '+(e.message||e),'error', 6000);
      } finally { loading.value=false; }
    }
    const filtered=computed(()=>{
      let r=items.value;
      if(search.value){ const q=search.value.toLowerCase(); r=r.filter(i => (i.number||'').toLowerCase().includes(q) || (i.partners?.name||'').toLowerCase().includes(q)); }
      if(statusFilter.value) r=r.filter(i => i.status===statusFilter.value);
      return r;
    });
    async function setStatus(inv, status){
      const patch={status};
      if(status==='paid'){ patch.paid_date=todayISO(); patch.paid_amount=inv.total; }
      const {error}=await getSB().from('invoices').update(patch).eq('id', inv.id);
      if(error) UI.toast('Chyba: '+error.message,'error');
      else { UI.toast('Stav zmenený','success'); load(); }
    }
    async function deleteInv(inv){
      const ok=await UI.ask({title:'Zmazať faktúru?', message:`Faktúra ${inv.number} bude trvalo odstránená.`, danger:true, confirmText:'Zmazať'});
      if(!ok) return;
      const {error}=await getSB().from('invoices').delete().eq('id', inv.id);
      if(error) UI.toast('Chyba: '+error.message,'error');
      else { UI.toast('Faktúra zmazaná','success'); load(); }
    }
    onMounted(load);
    return { loading, items, filtered, search, statusFilter, load, setStatus, deleteInv, fmtEUR, fmtDate, INVOICE_STATUSES, emit };
  },
  template:`
    <div class="p-6">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div class="flex items-center gap-3 flex-1">
          <div class="w-11 h-11 bg-brand-100 text-brand-600 rounded-xl flex items-center justify-center shrink-0"><icon name="file-text" :size="22"></icon></div>
          <div><h2 class="text-xl font-extrabold text-slate-900">Faktúry</h2><p class="text-sm text-slate-500">Vystavené faktúry a dobropisy</p></div>
        </div>
        <div class="flex items-center gap-2">
          <div class="relative">
            <icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></icon>
            <input class="input input-sm pl-9 w-full sm:w-64" placeholder="Hľadať číslo, zákazníka..." v-model="search"/>
          </div>
          <button class="btn btn-primary btn-sm" @click="emit('new')"><icon name="plus" :size="16"></icon> Nová faktúra</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 mb-4">
        <button :class="!statusFilter ? 'btn-primary' : 'btn-secondary'" class="btn btn-xs" @click="statusFilter=''">Všetky</button>
        <button v-for="(st,k) in INVOICE_STATUSES" :key="k" :class="statusFilter===k ? 'btn-primary' : 'btn-secondary'" class="btn btn-xs" @click="statusFilter = statusFilter===k ? '' : k">{{ st.label }}</button>
      </div>
      <div class="card">
        <div v-if="loading" class="p-12 text-center text-slate-400"><icon name="loader" :size="32" class="spin mx-auto"></icon></div>
        <div v-else-if="filtered.length===0" class="empty-state">
          <icon name="file-text" :size="48" class="mx-auto text-slate-300 mb-2"></icon>
          <p class="font-medium">Žiadne faktúry</p>
          <button class="btn btn-primary btn-sm mt-3" @click="emit('new')"><icon name="plus" :size="16"></icon> Vystaviť faktúru</button>
        </div>
        <table v-else class="data">
          <thead><tr><th>Číslo</th><th>Zákazník</th><th>Vystavená</th><th>Splatnosť</th><th>Suma</th><th>Stav</th><th class="text-right">Akcie</th></tr></thead>
          <tbody>
            <tr v-for="inv in filtered" :key="inv.id">
              <td class="font-semibold text-brand-700 cursor-pointer" @click="emit('edit', inv.id)">{{ inv.number }}</td>
              <td>{{ inv.partners?.name || '—' }}</td>
              <td>{{ fmtDate(inv.issue_date) }}</td>
              <td>{{ fmtDate(inv.due_date) }}</td>
              <td class="font-semibold">{{ fmtEUR(inv.total) }}</td>
              <td><span :class="[INVOICE_STATUSES[inv.status].bg, INVOICE_STATUSES[inv.status].text]" class="badge">{{ INVOICE_STATUSES[inv.status].label }}</span></td>
              <td class="text-right">
                <div class="inline-flex gap-1">
                  <button class="icon-btn btn-xs" title="Upraviť" @click="emit('edit', inv.id)"><icon name="edit" :size="15"></icon></button>
                  <button v-if="inv.status!=='paid' && inv.status!=='cancelled'" class="icon-btn btn-xs text-emerald-600" title="Označiť ako zaplatené" @click="setStatus(inv, 'paid')"><icon name="check" :size="15"></icon></button>
                  <button class="icon-btn btn-xs text-red-600" title="Zmazať" @click="deleteInv(inv)"><icon name="trash" :size="15"></icon></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`
};
/* PDF generator (pdfMake) */
function generateInvoicePDF(inv, items, partner, company){
  if(!window.pdfMake){ UI.toast('PDF knižnica sa nenačítala','error'); return; }
  company=company||{}; partner=partner||{};
  const computed = items.map(it => ({ it, c: calcItem(it) }));
  const vatGroups={}; let subtotal=0, vatTotal=0;
  computed.forEach(({it, c})=>{
    const k=String(it.vat_rate ?? 'null');
    if(!vatGroups[k]) vatGroups[k]={rate:it.vat_rate, base:0, vat:0};
    vatGroups[k].base+=c.total_net; vatGroups[k].vat+=c.total_vat;
    subtotal+=c.total_net; vatTotal+=c.total_vat;
  });
  const vatRows=Object.values(vatGroups).sort((a,b)=>Number(b.rate||0)-Number(a.rate||0));
  const body=[];
  body.push({ columns:[
    { width:'*', stack:[
      { text: company.name||'Apexholding, s.r.o.', bold:true, fontSize:18, color:'#1e293b' },
      { text:[company.address, company.zip, company.city].filter(Boolean).join(', '), fontSize:9, color:'#64748b', margin:[0,4,0,0] },
      { text:`IČO: ${company.ico||''}    DIČ: ${company.dic||''}${company.ic_dph?'    IČ DPH: '+company.ic_dph:''}`, fontSize:9, color:'#64748b', margin:[0,2,0,0] },
      company.register_text ? { text: company.register_text, fontSize:9, color:'#64748b', margin:[0,2,0,0] } : {},
      company.iban ? { text:`IBAN: ${company.iban}${company.swift?'    SWIFT: '+company.swift:''}`, fontSize:9, color:'#64748b', margin:[0,2,0,0] } : {},
      company.email ? { text: company.email, fontSize:9, color:'#64748b', margin:[0,2,0,0] } : {}
    ]},
    { width:'auto', stack:[
      { text: inv.doc_type==='credit' ? 'DOBROPIS' : 'FAKTÚRA', bold:true, fontSize:22, color:'#4f46e5', alignment:'right' },
      { text: inv.number, bold:true, fontSize:14, color:'#1e293b', alignment:'right', margin:[0,4,0,0] },
      { columns:[{width:'*', text:'Dátum vystavenia:', fontSize:9, color:'#64748b', margin:[0,10,0,0]},{width:'auto', text:fmtDate(inv.issue_date), fontSize:9, alignment:'right', margin:[0,10,0,0]}]},
      { columns:[{width:'*', text:'Dátum dodania:', fontSize:9, color:'#64748b', margin:[0,2,0,0]},{width:'auto', text:fmtDate(inv.delivery_date), fontSize:9, alignment:'right', margin:[0,2,0,0]}]},
      { columns:[{width:'*', text:'Dátum splatnosti:', fontSize:9, color:'#64748b', margin:[0,2,0,0]},{width:'auto', text:fmtDate(inv.due_date), fontSize:9, color:'#dc2626', bold:true, alignment:'right', margin:[0,2,0,0]}]},
      { columns:[{width:'*', text:'Variabilný symbol:', fontSize:9, color:'#64748b', margin:[0,2,0,0]},{width:'auto', text:inv.vs||'', fontSize:9, alignment:'right', margin:[0,2,0,0]}]},
      inv.ks ? { columns:[{width:'*', text:'Konšt. symbol:', fontSize:9, color:'#64748b', margin:[0,2,0,0]},{width:'auto', text:inv.ks, fontSize:9, alignment:'right', margin:[0,2,0,0]}]} : {}
    ]}
  ], margin:[0,0,0,20] });
  body.push({ stack:[
    { text:'Odberateľ:', fontSize:9, color:'#94a3b8', bold:true },
    { text: partner.name||'', bold:true, fontSize:13, color:'#1e293b', margin:[0,2,0,0] },
    { text:[partner.address, partner.zip, partner.city].filter(Boolean).join(', '), fontSize:9, color:'#64748b', margin:[0,2,0,0] },
    { text:`IČO: ${partner.ico||''}    DIČ: ${partner.dic||''}${partner.ic_dph?'    IČ DPH: '+partner.ic_dph:''}`, fontSize:9, color:'#64748b', margin:[0,2,0,0] }
  ], margin:[0,0,0,20] });
  const itemsTable={ table:{ widths:['*',45,50,60,50,60], headerRows:1, body:[[
    {text:'Popis', style:'th'}, {text:'MJ', style:'th', alignment:'center'}, {text:'Množ.', style:'th', alignment:'right'}, {text:'Cena/MJ', style:'th', alignment:'right'}, {text:'DPH', style:'th', alignment:'center'}, {text:'Spolu s DPH', style:'th', alignment:'right'}
  ]] }, layout:{ hLineColor:()=>'#e2e8f0', vLineColor:()=>'#fff', fillColor:(i)=>i===0?'#f1f5f9':null, paddingTop:()=>6, paddingBottom:()=>6 } };
  computed.forEach(({it, c})=>{
    itemsTable.table.body.push([
      {text: it.name+(it.description?'\n'+it.description:''), fontSize:9},
      {text: it.unit, fontSize:9, alignment:'center', color:'#64748b'},
      {text: fmtNum(it.quantity,3), fontSize:9, alignment:'right'},
      {text: fmtEUR(it.unit_price), fontSize:9, alignment:'right'},
      {text: it.vat_rate===null?'NaN':it.vat_rate+'%', fontSize:9, alignment:'center', color:'#64748b'},
      {text: fmtEUR(c.total_gross), fontSize:9, alignment:'right', bold:true}
    ]);
  });
  body.push(itemsTable);
  const totalsTable={ table:{ widths:[80,'*',60,70], headerRows:1, body:[[
    {text:'Sadzba DPH', style:'th'}, {text:'Základ', style:'th', alignment:'right'}, {text:'DPH', style:'th', alignment:'right'}, {text:'Spolu s DPH', style:'th', alignment:'right'}
  ]] }, layout:{ hLineColor:()=>'#e2e8f0', vLineColor:()=>'#fff', fillColor:(i)=>i===0?'#f1f5f9':null } };
  vatRows.forEach(r=>{
    totalsTable.table.body.push([
      {text: r.rate===null?'Nie je predmetom':r.rate+'%', fontSize:9},
      {text: fmtEUR(r.base), fontSize:9, alignment:'right'},
      {text: fmtEUR(r.vat), fontSize:9, alignment:'right'},
      {text: fmtEUR(r.base+r.vat), fontSize:9, alignment:'right'}
    ]);
  });
  body.push({ stack:[totalsTable], margin:[0,16,0,0] });
  body.push({ columns:[
    { width:'*', text:'' },
    { width:240, stack:[
      { columns:[{width:'*', text:'Medzisúčet:', fontSize:10, color:'#64748b'},{width:'auto', text:fmtEUR(subtotal), fontSize:10, alignment:'right'}] },
      { columns:[{width:'*', text:'DPH spolu:', fontSize:10, color:'#64748b', margin:[0,2,0,0]},{width:'auto', text:fmtEUR(vatTotal), fontSize:10, alignment:'right', margin:[0,2,0,0]}] },
      { canvas:[{type:'rect', x:0, y:0, w:240, h:1, lineColor:'#e2e8f0'}], margin:[0,6,0,6] },
      { columns:[{width:'*', text:'CELKOM K ÚHRADE:', fontSize:13, bold:true, color:'#1e293b'},{width:'auto', text:fmtEUR((inv.total!=null)?inv.total:(subtotal+vatTotal)), fontSize:15, bold:true, color:'#4f46e5', alignment:'right'}] }
    ] }
  ], margin:[0,12,0,0] });
  if(inv.note) body.push({ text: inv.note, fontSize:9, color:'#64748b', margin:[0,16,0,0] });
  body.push({ columns:[
    { width:'*', text:`Spôsob úhrady: ${(PAYMENT_METHODS[inv.payment_method]||'Prevod')}`, fontSize:8, color:'#94a3b8', margin:[0,30,0,0] },
    { width:'auto', text:'Vystavené v ApexHolding Fakturácia', fontSize:8, color:'#94a3b8', alignment:'right', margin:[0,30,0,0] }
  ] });
  const doc={ content:body, pageSize:'A4', pageMargins:[40,40,40,40], defaultStyle:{ font:'Roboto', fontSize:10, color:'#1e293b', lineHeight:1.2 }, styles:{ th:{ bold:true, fontSize:9, color:'#64748b', fillColor:'#f1f5f9' } } };
  pdfMake.createPdf(doc).download(`Faktura_${inv.number}.pdf`);
  UI.toast('PDF stiahnuté','success');
}

const InvoiceEditor = {
  props:['invoiceId'],
  emits:['back','saved'],
  setup(props, {emit}){
    console.log('[InvoiceEditor] setup start, invoiceId=', props.invoiceId);
    const loading=ref(!!props.invoiceId), saving=ref(false);
    const company=ref(null);
    const form=reactive(newInvoice());
    const items=ref([]);
    const partners=reactive({show:false});
    const articles=reactive({show:false});
    const partnerEditor=reactive({show:false, partner:null});

    function newInvoice(){
      return { id:null, number:'', doc_type:'invoice', issue_date:todayISO(), delivery_date:todayISO(), due_date:addDaysISO(todayISO(),14), tax_date:todayISO(), partner_id:null, partner:null, currency:'EUR', status:'draft', payment_method:'prevod', vs:'', ks:'0308', ss:'', paid_date:null, paid_amount:0, note:'', internal_note:'' };
    }
    async function load(){
      try {
        console.log('[InvoiceEditor] load start, invoiceId=', props.invoiceId);
        const s=getSB();
        if(!s){ UI.toast('Chyba: Supabase client nie je inicializovaný','error'); emit('back'); return; }
        const compRes=await s.from('companies').select('*').limit(1).maybeSingle();
        console.log('[InvoiceEditor] company:', compRes.data?.name, compRes.error?.message);
        if(compRes.error) throw compRes.error;
        company.value=compRes.data;
        if(compRes.data?.default_due_days) form.due_date=addDaysISO(form.issue_date, compRes.data.default_due_days);
        if(compRes.data?.default_ks) form.ks=compRes.data.default_ks;
        if(props.invoiceId){
          const {data:inv, error}=await s.from('invoices').select('*').eq('id', props.invoiceId).single();
          if(error) throw error;
          Object.assign(form, inv);
          const {data:p, error:pe}=await s.from('partners').select('*').eq('id', inv.partner_id).maybeSingle();
          if(!pe) form.partner=p;
          const {data:its, error:ie}=await s.from('invoice_items').select('*').eq('invoice_id', props.invoiceId).order('line_no');
          if(ie) throw ie;
          items.value=(its||[]).map(it=>({...it, _uid:uid()}));
        } else {
          // Nepočítaj číslo vopred - pridelí sa pri uložení (inak by sa číslo inkrementovalo pri každom otvorení)
          form.number='(pridelené pri uložení)';
          form.vs='';
        }
        console.log('[InvoiceEditor] load done');
      } catch(e) {
        console.error('[InvoiceEditor] load error:', e);
        UI.toast('Chyba pri načítaní faktúry: '+(e.message||e),'error', 8000);
      } finally {
        loading.value=false;
      }
    }
    const totals=computed(()=>calcInvoice(items.value));
    function addEmptyItem(){
      items.value.push({ _uid:uid(), article_id:null, name:'', description:'', quantity:1, unit:'ks', unit_price:0, vat_rate:20, discount_pct:0, discount_amount:0, total_net:0, total_vat:0, total_gross:0 });
    }
    function addItemFromArticle(a){
      items.value.push({ _uid:uid(), article_id:a.id, name:a.name, description:a.description||'', quantity:1, unit:a.unit||'ks', unit_price:Number(a.price||0), vat_rate:Number(a.vat_rate ?? 20), discount_pct:0, discount_amount:0, total_net:0, total_vat:0, total_gross:0 });
      articles.show=false;
    }
    function removeItem(idx){ items.value.splice(idx, 1); }
    function pickPartner(p){ form.partner=p; form.partner_id=p.id; partners.show=false; }
    function openNewPartner(){ partners.show=false; partnerEditor.partner=null; partnerEditor.show=true; }
    function onPartnerSaved(p){ partnerEditor.show=false; pickPartner(p); }
    function recalcDueFromIssue(){ const days=company.value?.default_due_days||14; form.due_date=addDaysISO(form.issue_date, days); }
    async function save(targetStatus){
      if(!form.partner_id){ UI.toast('Vyber zákazníka','warn'); return; }
      if(items.value.length===0){ UI.toast('Pridaj aspoň jednu položku','warn'); return; }
      const invalid=items.value.find(it=>!it.name || Number(it.quantity)<=0);
      if(invalid){ UI.toast('Niektorá položka nemá názov alebo množstvo','warn'); return; }
      saving.value=true;
      try {
        const t=totals.value;
        let finalNumber=form.number;
        if(!form.id){ try { finalNumber=await nextDocNumber('invoice','FA'); } catch(e){ UI.toast('Nepodarilo sa vygenerovať číslo','warn'); } }
        const payload={ number:finalNumber, doc_type:form.doc_type, issue_date:form.issue_date, delivery_date:form.delivery_date, due_date:form.due_date, tax_date:form.tax_date||form.issue_date, partner_id:form.partner_id, company_id:company.value?.id||null, partner_snapshot:form.partner?JSON.stringify(form.partner):null, currency:form.currency, subtotal:t.subtotal, vat_total:t.vatTotal, rounding:t.rounding, total:t.total, status:targetStatus||form.status||'draft', payment_method:form.payment_method, vs:form.vs||finalNumber.replace(/\D/g,'').slice(-10), ks:form.ks, ss:form.ss, paid_date:form.paid_date, paid_amount:form.paid_amount, note:form.note, internal_note:form.internal_note };
        let invId=form.id;
        if(form.id){
          const {error}=await getSB().from('invoices').update(payload).eq('id', form.id);
          if(error) throw error;
          await getSB().from('invoice_items').delete().eq('invoice_id', form.id);
        } else {
          const {data, error}=await getSB().from('invoices').insert(payload).select().single();
          if(error) throw error;
          invId=data.id; form.id=invId; form.number=finalNumber;
        }
        const itemRows=items.value.map((it,idx)=>{
          const c=calcItem(it);
          return { invoice_id:invId, line_no:idx+1, article_id:it.article_id||null, name:it.name, description:it.description, quantity:Number(it.quantity), unit:it.unit, unit_price:Number(it.unit_price), vat_rate:it.vat_rate, discount_pct:Number(it.discount_pct||0), discount_amount:Number(it.discount_amount||0), total_net:c.total_net, total_vat:c.total_vat, total_gross:c.total_gross };
        });
        if(itemRows.length){ const {error:ie}=await getSB().from('invoice_items').insert(itemRows); if(ie) throw ie; }
        if(targetStatus) form.status=targetStatus;
        UI.toast('Faktúra uložená','success');
        emit('saved', invId);
      } catch(e){ UI.toast('Chyba pri ukladaní: '+e.message,'error'); }
      finally { saving.value=false; }
    }
    async function saveAndPdf(){ await save(); if(form.id) generateInvoicePDF(form, items.value, form.partner, company.value); }
    function exportPDF(){ generateInvoicePDF(form, items.value, form.partner, company.value); }
    async function markPaid(){
      const patch={status:'paid', paid_date:todayISO(), paid_amount:totals.value.total};
      const {error}=await getSB().from('invoices').update(patch).eq('id', form.id);
      if(error) UI.toast('Chyba: '+error.message,'error');
      else { Object.assign(form, patch); UI.toast('Označené ako zaplatené','success'); }
    }
    async function markSent(){ await save('sent'); }
    function itemGross(it){ return calcItem(it).total_gross; }
    onMounted(load);
    return { loading, saving, form, items, totals, company, partners, articles, partnerEditor, addEmptyItem, addItemFromArticle, removeItem, pickPartner, openNewPartner, onPartnerSaved, recalcDueFromIssue, save, saveAndPdf, exportPDF, markPaid, markSent, itemGross, fmtEUR, fmtNum, VAT_RATES, ARTICLE_UNITS, INVOICE_STATUSES, PAYMENT_METHODS, emit };
  },
  template:`
    <div class="p-6 max-w-7xl mx-auto">
      <div v-if="loading" class="text-center py-12"><icon name="loader" :size="32" class="spin mx-auto text-slate-400"></icon></div>
      <div v-else>
        <div class="flex items-center gap-3 mb-5">
          <button class="icon-btn" @click="emit('back')"><icon name="arrow-left" :size="22"></icon></button>
          <div class="flex-1"><h2 class="text-xl font-extrabold text-slate-900">{{ form.id ? 'Faktúra '+form.number : 'Nová faktúra' }}</h2><p class="text-sm text-slate-500">{{ form.id ? 'Úprava faktúry' : 'Vystavenie novej faktúry' }}</p></div>
          <span v-if="form.id" :class="[INVOICE_STATUSES[form.status].bg, INVOICE_STATUSES[form.status].text]" class="badge">{{ INVOICE_STATUSES[form.status].label }}</span>
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div class="xl:col-span-2 space-y-5">
            <div class="card p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-bold text-slate-900 flex items-center gap-2"><icon name="users" :size="18" class="text-brand-600"></icon> Odberateľ</h3>
                <button class="btn btn-secondary btn-xs" @click="partners.show=true"><icon :name="form.partner?'edit':'search'" :size="14"></icon> {{ form.partner?'Zmeniť':'Vybrať' }}</button>
              </div>
              <div v-if="form.partner" class="bg-slate-50 rounded-lg p-3">
                <div class="font-bold text-slate-900">{{ form.partner.name }}</div>
                <div class="text-sm text-slate-600 mt-0.5">{{ form.partner.address }}, {{ form.partner.zip }} {{ form.partner.city }}</div>
                <div class="text-xs text-slate-500 mt-1">IČO: {{ form.partner.ico||'—' }} · DIČ: {{ form.partner.dic||'—' }} <span v-if="form.partner.ic_dph">· IČ DPH: {{ form.partner.ic_dph }}</span></div>
              </div>
              <div v-else class="empty-state py-6"><icon name="user" :size="32" class="mx-auto text-slate-300 mb-1"></icon><p class="text-sm">Nebol vybraný zákazník</p></div>
            </div>
            <div class="card p-5">
              <div class="flex items-center justify-between mb-3">
                <h3 class="font-bold text-slate-900 flex items-center gap-2"><icon name="package" :size="18" class="text-brand-600"></icon> Položky faktúry</h3>
                <div class="flex gap-1"><button class="btn btn-secondary btn-xs" @click="articles.show=true"><icon name="search" :size="14"></icon> Z katalógu</button><button class="btn btn-primary btn-xs" @click="addEmptyItem"><icon name="plus" :size="14"></icon> Riadok</button></div>
              </div>
              <div class="space-y-2">
                <div v-for="(it, idx) in items" :key="it._uid || it.id" class="grid grid-cols-12 gap-2 items-start bg-slate-50/60 rounded-lg p-2">
                  <div class="col-span-12 sm:col-span-5"><label class="text-[10px] font-semibold text-slate-500 uppercase">Názov</label><input class="input input-sm" v-model="it.name" placeholder="Napr. Konzultácia"/></div>
                  <div class="col-span-3 sm:col-span-1"><label class="text-[10px] font-semibold text-slate-500 uppercase">MJ</label><select class="input input-sm" v-model="it.unit"><option v-for="u in ARTICLE_UNITS" :key="u" :value="u">{{ u }}</option></select></div>
                  <div class="col-span-3 sm:col-span-1"><label class="text-[10px] font-semibold text-slate-500 uppercase">Množ.</label><input class="input input-sm" type="number" step="0.001" v-model.number="it.quantity"/></div>
                  <div class="col-span-6 sm:col-span-2"><label class="text-[10px] font-semibold text-slate-500 uppercase">Cena/MJ</label><input class="input input-sm" type="number" step="0.01" v-model.number="it.unit_price"/></div>
                  <div class="col-span-4 sm:col-span-1"><label class="text-[10px] font-semibold text-slate-500 uppercase">DPH</label><select class="input input-sm" v-model.number="it.vat_rate"><option v-for="v in VAT_RATES" :key="v.code" :value="v.rate">{{ v.rate===null?'NaN':v.rate+'%' }}</option></select></div>
                  <div class="col-span-4 sm:col-span-1"><label class="text-[10px] font-semibold text-slate-500 uppercase">Zľava %</label><input class="input input-sm" type="number" step="0.01" v-model.number="it.discount_pct"/></div>
                  <div class="col-span-3 sm:col-span-1"><label class="text-[10px] font-semibold text-slate-500 uppercase">Spolu</label><div class="text-sm font-bold text-slate-900 py-1.5">{{ fmtEUR(itemGross(it)) }}</div></div>
                  <div class="col-span-2 sm:col-span-1 flex justify-end pt-5"><button class="icon-btn text-red-600 btn-xs" @click="removeItem(idx)"><icon name="trash" :size="14"></icon></button></div>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm mt-3 w-full justify-center border border-dashed border-slate-300" @click="addEmptyItem"><icon name="plus" :size="14"></icon> Pridať prázdny riadok</button>
            </div>
            <div class="card p-5">
              <h3 class="font-bold text-slate-900 mb-3 flex items-center gap-2"><icon name="calendar" :size="18" class="text-brand-600"></icon> Dátumy a platba</h3>
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div><label class="label">Dátum vystavenia</label><input class="input" type="date" v-model="form.issue_date" @change="recalcDueFromIssue"/></div>
                <div><label class="label">Dátum dodania</label><input class="input" type="date" v-model="form.delivery_date"/></div>
                <div><label class="label">Dátum splatnosti</label><input class="input" type="date" v-model="form.due_date"/></div>
                <div><label class="label">Variabilný symbol</label><input class="input" v-model="form.vs"/></div>
                <div><label class="label">Konšt. symbol</label><input class="input" v-model="form.ks"/></div>
                <div><label class="label">Špec. symbol</label><input class="input" v-model="form.ss"/></div>
                <div><label class="label">Spôsob úhrady</label><select class="input" v-model="form.payment_method"><option v-for="(l,v) in PAYMENT_METHODS" :key="v" :value="v">{{ l }}</option></select></div>
                <div class="col-span-2"><label class="label">Poznámka na faktúre</label><input class="input" v-model="form.note"/></div>
              </div>
            </div>
          </div>
          <div class="space-y-5">
            <div class="card p-5 xl:sticky xl:top-20">
              <h3 class="font-bold text-slate-900 mb-3 flex items-center gap-2"><icon name="calculator" :size="18" class="text-brand-600"></icon> Súhrn</h3>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between"><span class="text-slate-500">Základ (bez DPH)</span><span class="font-semibold">{{ fmtEUR(totals.subtotal) }}</span></div>
                <div v-for="b in totals.byVat" :key="String(b.rate)" class="flex justify-between text-xs pl-2 border-l-2 border-slate-200"><span class="text-slate-500">DPH {{ b.rate===null?'NaN':b.rate+'%' }} (z {{ fmtEUR(b.net) }})</span><span class="font-medium">{{ fmtEUR(b.vat) }}</span></div>
                <div class="flex justify-between"><span class="text-slate-500">DPH spolu</span><span class="font-semibold">{{ fmtEUR(totals.vatTotal) }}</span></div>
                <div v-if="totals.rounding!==0" class="flex justify-between text-xs"><span class="text-slate-500">Zaokrúhlenie</span><span class="font-medium">{{ fmtEUR(totals.rounding) }}</span></div>
                <div class="border-t border-slate-200 pt-2 mt-2 flex justify-between items-baseline"><span class="text-slate-700 font-semibold">Celkom k úhrade</span><span class="text-2xl font-extrabold text-brand-700">{{ fmtEUR(totals.total) }}</span></div>
              </div>
              <div v-if="form.id" class="mt-3 bg-brand-50 rounded-lg p-3 text-center"><div class="w-24 h-24 mx-auto bg-white rounded-lg flex items-center justify-center border border-brand-200"><icon name="qr-code" :size="48" class="text-brand-700"></icon></div><div class="text-[10px] text-slate-500 mt-1">QR platba</div></div>
              <div class="space-y-2 mt-4">
                <button class="btn btn-primary w-full justify-center" @click="save()" :disabled="saving"><icon :name="saving?'loader':'save'" :size="16" :class="saving?'spin':''"></icon> Uložiť faktúru</button>
                <button class="btn btn-secondary w-full justify-center" @click="saveAndPdf()" :disabled="saving"><icon name="download" :size="16"></icon> Uložiť + PDF</button>
                <div class="grid grid-cols-2 gap-2">
                  <button v-if="form.id" class="btn btn-secondary btn-sm justify-center" @click="exportPDF"><icon name="print" :size="14"></icon> PDF</button>
                  <button v-if="form.id && form.status!=='paid'" class="btn btn-secondary btn-sm justify-center text-emerald-700" @click="markPaid"><icon name="check" :size="14"></icon> Zaplatené</button>
                </div>
                <button v-if="form.id && form.status==='draft'" class="btn btn-ghost btn-sm w-full justify-center text-blue-700" @click="markSent"><icon name="send" :size="14"></icon> Označiť ako odoslanú</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <partner-picker :show="partners.show" @pick="pickPartner" @close="partners.show=false" @new="openNewPartner"></partner-picker>
      <article-picker :show="articles.show" @pick="addItemFromArticle" @close="articles.show=false" @new="(q)=>{ articles.show=false; UI.toast('Pridaj nový artiklel v Skylady → Artikle','info'); }"></article-picker>
      <partner-editor :show="partnerEditor.show" :partner="partnerEditor.partner" @close="partnerEditor.show=false" @saved="onPartnerSaved"></partner-editor>
    </div>`
};
const Partners = {
  props:['type','search'],
  setup(props){
    const loading=ref(true);
    const items=ref([]);
    const search=ref(props.search||'');
    const editor=reactive({show:false, partner:null});
    const typeLabel=computed(()=> props.type==='supplier' ? 'Dodávatelia' : (props.type==='customer' ? 'Zákazníci' : 'Kontakty'));
    const typeIcon=computed(()=> props.type==='supplier' ? 'truck' : 'users');

    async function load(){
      loading.value=true;
      try {
        const s=getSB();
        if(!s){ return; }
        let q=s.from('partners').select('*').eq('is_archived', false).order('name');
        if(props.type) q=q.or(`type.eq.${props.type},type.eq.both`);
        const {data, error}=await q.limit(300);
        if(error) throw error;
        items.value=data||[];
      } catch(e){
        console.error('[Partners] load error:', e);
        UI.toast('Chyba pri na��tan� kontaktov: '+(e.message||e),'error', 6000);
      } finally { loading.value=false; }
    }
    const filtered=computed(()=>{
      if(!search.value) return items.value;
      const q=search.value.toLowerCase();
      return items.value.filter(p => (p.name||'').toLowerCase().includes(q) || (p.ico||'').includes(q) || (p.city||'').toLowerCase().includes(q) || (p.email||'').toLowerCase().includes(q));
    });
    function openNew(){ editor.partner=null; editor.show=true; }
    function openEdit(p){ editor.partner=p; editor.show=true; }
    function onSaved(){ editor.show=false; load(); }
    async function del(p){
      const ok=await UI.ask({title:'Zmazať kontakt?', message:`Kontakt „${p.name}" bude odstránený.`, danger:true, confirmText:'Zmazať'});
      if(!ok) return;
      const {error}=await getSB().from('partners').delete().eq('id', p.id);
      if(error) UI.toast('Chyba: '+error.message,'error');
      else { UI.toast('Kontakt zmazaný','success'); load(); }
    }
    async function archive(p){
      const {error}=await getSB().from('partners').update({is_archived:true}).eq('id', p.id);
      if(error) UI.toast('Chyba: '+error.message,'error');
      else { UI.toast('Archivovaný','success'); load(); }
    }
    onMounted(load);
    return { loading, items, filtered, search, editor, typeLabel, typeIcon, openNew, openEdit, onSaved, del, archive, fmtDate, PARTNER_TYPES, props };
  },
  template:`
    <div class="p-6">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div class="flex items-center gap-3 flex-1">
          <div class="w-11 h-11 bg-brand-100 text-brand-600 rounded-xl flex items-center justify-center shrink-0"><icon :name="typeIcon" :size="22"></icon></div>
          <div><h2 class="text-xl font-extrabold text-slate-900">{{ typeLabel }}</h2><p class="text-sm text-slate-500">{{ filtered.length }} záznamov</p></div>
        </div>
        <div class="flex items-center gap-2">
          <div class="relative">
            <icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></icon>
            <input class="input input-sm pl-9 w-full sm:w-64" placeholder="Hľadať..." v-model="search"/>
          </div>
          <button class="btn btn-primary btn-sm" @click="openNew"><icon name="plus" :size="16"></icon> Pridať</button>
        </div>
      </div>
      <div class="card">
        <div v-if="loading" class="p-12 text-center text-slate-400"><icon name="loader" :size="32" class="spin mx-auto"></icon></div>
        <div v-else-if="filtered.length===0" class="empty-state">
          <icon :name="typeIcon" :size="48" class="mx-auto text-slate-300 mb-2"></icon>
          <p class="font-medium">Žiadne kontakty</p>
          <button class="btn btn-primary btn-sm mt-3" @click="openNew"><icon name="plus" :size="16"></icon> Pridať prvý kontakt</button>
        </div>
        <table v-else class="data">
          <thead><tr><th>Názov</th><th>IČO / DIČ</th><th>Adresa</th><th>Kontakt</th><th>Typ</th><th class="text-right">Akcie</th></tr></thead>
          <tbody>
            <tr v-for="p in filtered" :key="p.id">
              <td><div class="font-semibold text-slate-900">{{ p.name }}</div><div v-if="p.contact_person" class="text-xs text-slate-500">{{ p.contact_person }}</div></td>
              <td class="text-sm"><div>IČO: {{ p.ico||'—' }}</div><div class="text-xs text-slate-500">DIČ: {{ p.dic||'—' }}</div></td>
              <td class="text-sm"><div>{{ p.address }}</div><div class="text-xs text-slate-500">{{ p.zip }} {{ p.city }}</div></td>
              <td class="text-sm"><div v-if="p.email">{{ p.email }}</div><div class="text-xs text-slate-500">{{ p.phone }}</div></td>
              <td><span class="badge bg-slate-100 text-slate-700">{{ PARTNER_TYPES[p.type] }}</span></td>
              <td class="text-right">
                <div class="inline-flex gap-1">
                  <button class="icon-btn btn-xs" title="Upraviť" @click="openEdit(p)"><icon name="edit" :size="15"></icon></button>
                  <button class="icon-btn btn-xs text-slate-500" title="Archivovať" @click="archive(p)"><icon name="archive" :size="15"></icon></button>
                  <button class="icon-btn btn-xs text-red-600" title="Zmazať" @click="del(p)"><icon name="trash" :size="15"></icon></button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <partner-editor :show="editor.show" :partner="editor.partner" :default-type="props.type||'customer'" @close="editor.show=false" @saved="onSaved"></partner-editor>
    </div>`
};
const Articles = {
  setup(){
    const loading=ref(true);
    const items=ref([]);
    const groups=ref([]);
    const search=ref('');
    const groupFilter=ref('');
    const editor=reactive({show:false, article:null});

    async function load(){
      loading.value=true;
      try {
        const s=getSB();
        if(!s){ return; }
        const [aRes, gRes]=await Promise.all([
          s.from('articles').select('*,article_groups(name,color)').eq('is_archived',false).order('name').limit(500),
          s.from('article_groups').select('*').order('name')
        ]);
        if(aRes.error) throw aRes.error;
        items.value=aRes.data||[];
        groups.value=gRes.data||[];
      } catch(e){
        console.error('[Articles] load error:', e);
        UI.toast('Chyba pri na��tan� artiklov: '+(e.message||e),'error', 6000);
      } finally { loading.value=false; }
    }
    const filtered=computed(()=>{
      let r=items.value;
      if(search.value){ const q=search.value.toLowerCase(); r=r.filter(a => (a.name||'').toLowerCase().includes(q) || (a.code||'').toLowerCase().includes(q)); }
      if(groupFilter.value) r=r.filter(a => a.group_id===groupFilter.value);
      return r;
    });
    function openNew(){ editor.article={ group_id: groups.value[0]?.id || null, unit:'ks', vat_rate:20, price:0, cost:0 }; editor.show=true; }
    function openEdit(a){ editor.article={...a}; editor.show=true; }
    async function save(){
      const a=editor.article;
      if(!a.name){ UI.toast('Názov je povinný','warn'); return; }
      try {
        if(a.id){
          const {data, error}=await db.update('articles', a.id, a);
          if(error) throw error;
          UI.toast('Artiklel uložený','success');
        } else {
          delete a.id;
          const {data, error}=await db.insert('articles', a);
          if(error) throw error;
          UI.toast('Artiklel vytvorený','success');
        }
        editor.show=false; load();
      } catch(e){ UI.toast('Chyba: '+e.message,'error'); }
    }
    async function del(a){
      const ok=await UI.ask({title:'Zmazať artiklel?', message:`Artiklel „${a.name}" bude odstránený.`, danger:true, confirmText:'Zmazať'});
      if(!ok) return;
      const {error}=await getSB().from('articles').delete().eq('id', a.id);
      if(error) UI.toast('Chyba: '+error.message,'error');
      else { UI.toast('Artiklel zmazaný','success'); load(); }
    }
    onMounted(load);
    return { loading, items, filtered, groups, search, groupFilter, editor, openNew, openEdit, save, del, fmtEUR, ARTICLE_UNITS, VAT_RATES, ARTICLE_GROUP_TYPES };
  },
  template:`
    <div class="p-6">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div class="flex items-center gap-3 flex-1">
          <div class="w-11 h-11 bg-brand-100 text-brand-600 rounded-xl flex items-center justify-center shrink-0"><icon name="package" :size="22"></icon></div>
          <div><h2 class="text-xl font-extrabold text-slate-900">Artikle</h2><p class="text-sm text-slate-500">{{ filtered.length }} položiek v katalógu</p></div>
        </div>
        <div class="flex items-center gap-2">
          <div class="relative">
            <icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></icon>
            <input class="input input-sm pl-9 w-full sm:w-56" placeholder="Hľadať..." v-model="search"/>
          </div>
          <select class="input input-sm w-44" v-model="groupFilter"><option value="">Všetky skupiny</option><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option></select>
          <button class="btn btn-primary btn-sm" @click="openNew"><icon name="plus" :size="16"></icon> Nový</button>
        </div>
      </div>
      <div class="card">
        <div v-if="loading" class="p-12 text-center text-slate-400"><icon name="loader" :size="32" class="spin mx-auto"></icon></div>
        <div v-else-if="filtered.length===0" class="empty-state"><icon name="package" :size="48" class="mx-auto text-slate-300 mb-2"></icon><p class="font-medium">Žiadne artikle</p><button class="btn btn-primary btn-sm mt-3" @click="openNew"><icon name="plus" :size="16"></icon> Pridať prvý</button></div>
        <table v-else class="data">
          <thead><tr><th>Názov</th><th>Kód</th><th>Skupina</th><th>MJ</th><th>Cena</th><th>DPH</th><th class="text-right">Akcie</th></tr></thead>
          <tbody>
            <tr v-for="a in filtered" :key="a.id">
              <td><div class="font-semibold text-slate-900">{{ a.name }}</div><div v-if="a.description" class="text-xs text-slate-500 truncate max-w-xs">{{ a.description }}</div></td>
              <td class="text-sm text-slate-500">{{ a.code||'—' }}</td>
              <td><span v-if="a.article_groups" class="badge" :style="{backgroundColor:(a.article_groups.color||'#6366f1')+'20', color:a.article_groups.color||'#6366f1'}">{{ a.article_groups.name }}</span><span v-else class="text-xs text-slate-400">—</span></td>
              <td class="text-sm">{{ a.unit }}</td>
              <td class="font-semibold">{{ fmtEUR(a.price) }}</td>
              <td class="text-sm text-slate-500">{{ a.vat_rate===null?'NaN':a.vat_rate+'%' }}</td>
              <td class="text-right"><div class="inline-flex gap-1"><button class="icon-btn btn-xs" @click="openEdit(a)"><icon name="edit" :size="15"></icon></button><button class="icon-btn btn-xs text-red-600" @click="del(a)"><icon name="trash" :size="15"></icon></button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <transition name="modal">
        <div v-if="editor.show" class="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" @click.self="editor.show=false">
          <transition name="modal-content" appear>
            <div v-if="editor.show" class="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto">
              <div class="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10"><h3 class="font-bold text-slate-900">{{ editor.article?.id?'Upraviť artiklel':'Nový artiklel' }}</h3><button class="icon-btn" @click="editor.show=false"><icon name="x" :size="18"></icon></button></div>
              <div class="p-5 space-y-4">
                <div><label class="label field-required">Názov</label><input class="input" v-model="editor.article.name" placeholder="Napr. Konzultácia"/></div>
                <div class="grid grid-cols-2 gap-3">
                  <div><label class="label">Kód / SKU</label><input class="input" v-model="editor.article.code"/></div>
                  <div><label class="label">EAN</label><input class="input" v-model="editor.article.ean"/></div>
                </div>
                <div><label class="label">Popis</label><textarea class="input" rows="2" v-model="editor.article.description"></textarea></div>
                <div class="grid grid-cols-2 gap-3">
                  <div><label class="label">Skupina</label><select class="input" v-model="editor.article.group_id"><option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option></select></div>
                  <div><label class="label">Merná jednotka</label><select class="input" v-model="editor.article.unit"><option v-for="u in ARTICLE_UNITS" :key="u" :value="u">{{ u }}</option></select></div>
                </div>
                <div class="grid grid-cols-3 gap-3">
                  <div><label class="label">Predajná cena</label><input class="input" type="number" step="0.01" v-model.number="editor.article.price"/></div>
                  <div><label class="label">Náklad</label><input class="input" type="number" step="0.01" v-model.number="editor.article.cost"/></div>
                  <div><label class="label">DPH</label><select class="input" v-model.number="editor.article.vat_rate"><option v-for="v in VAT_RATES" :key="v.code" :value="v.rate">{{ v.rate===null?'NaN':v.rate+'%' }}</option></select></div>
                </div>
              </div>
              <div class="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 sticky bottom-0"><button class="btn btn-secondary" @click="editor.show=false">Zrušiť</button><button class="btn btn-primary" @click="save"><icon name="save" :size="16"></icon> Uložiť</button></div>
            </div>
          </transition>
        </div>
      </transition>
    </div>`
};
const ArticleGroups = {
  setup(){
    const loading=ref(true);
    const items=ref([]);
    const editor=reactive({show:false, group:null});
    async function load(){
      loading.value=true;
      const {data}=await getSB().from('article_groups').select('*').order('sort_order').order('name').limit(200);
      items.value=data||[];
      loading.value=false;
    }
    function openNew(){ editor.group={ type:'service', default_vat_rate:20, color:'#6366f1', sort_order:0 }; editor.show=true; }
    function openEdit(g){ editor.group={...g}; editor.show=true; }
    async function save(){
      const g=editor.group;
      if(!g.name){ UI.toast('Názov je povinný','warn'); return; }
      try {
        if(g.id){ const {error}=await db.update('article_groups', g.id, g); if(error) throw error; UI.toast('Skupina uložená','success'); }
        else { delete g.id; const {error}=await db.insert('article_groups', g); if(error) throw error; UI.toast('Skupina vytvorená','success'); }
        editor.show=false; load();
      } catch(e){ UI.toast('Chyba: '+e.message,'error'); }
    }
    async function del(g){
      const ok=await UI.ask({title:'Zmazať skupinu?', message:`Skupina „${g.name}" bude odstránená (artikly ostanú, len stratia skupinu).`, danger:true, confirmText:'Zmazať'});
      if(!ok) return;
      const {error}=await getSB().from('article_groups').delete().eq('id', g.id);
      if(error) UI.toast('Chyba: '+error.message,'error');
      else { UI.toast('Skupina zmazaná','success'); load(); }
    }
    onMounted(load);
    return { loading, items, editor, openNew, openEdit, save, del, ARTICLE_GROUP_TYPES };
  },
  template:`
    <div class="p-6">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div class="flex items-center gap-3 flex-1">
          <div class="w-11 h-11 bg-brand-100 text-brand-600 rounded-xl flex items-center justify-center shrink-0"><icon name="folder-tree" :size="22"></icon></div>
          <div><h2 class="text-xl font-extrabold text-slate-900">Skupiny artiklov</h2><p class="text-sm text-slate-500">{{ items.length }} skupín</p></div>
        </div>
        <button class="btn btn-primary btn-sm" @click="openNew"><icon name="folder-plus" :size="16"></icon> Nová skupina</button>
      </div>
      <div class="card">
        <div v-if="loading" class="p-12 text-center text-slate-400"><icon name="loader" :size="32" class="spin mx-auto"></icon></div>
        <div v-else-if="items.length===0" class="empty-state"><icon name="folder-tree" :size="48" class="mx-auto text-slate-300 mb-2"></icon><p class="font-medium">Žiadne skupiny</p><button class="btn btn-primary btn-sm mt-3" @click="openNew"><icon name="plus" :size="16"></icon> Pridať prvú</button></div>
        <table v-else class="data">
          <thead><tr><th>Skupina</th><th>Typ</th><th>Predvolená DPH</th><th class="text-right">Akcie</th></tr></thead>
          <tbody>
            <tr v-for="g in items" :key="g.id">
              <td><div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full" :style="{backgroundColor:g.color||'#6366f1'}"></span><span class="font-semibold text-slate-900">{{ g.name }}</span></div></td>
              <td><span class="badge bg-slate-100 text-slate-700">{{ ARTICLE_GROUP_TYPES[g.type]||g.type }}</span></td>
              <td class="text-sm">{{ g.default_vat_rate===null?'NaN':(g.default_vat_rate||0)+'%' }}</td>
              <td class="text-right"><div class="inline-flex gap-1"><button class="icon-btn btn-xs" @click="openEdit(g)"><icon name="edit" :size="15"></icon></button><button class="icon-btn btn-xs text-red-600" @click="del(g)"><icon name="trash" :size="15"></icon></button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <transition name="modal">
        <div v-if="editor.show" class="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" @click.self="editor.show=false">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div class="p-5 border-b border-slate-100 flex items-center justify-between"><h3 class="font-bold text-slate-900">{{ editor.group?.id?'Upraviť skupinu':'Nová skupina' }}</h3><button class="icon-btn" @click="editor.show=false"><icon name="x" :size="18"></icon></button></div>
            <div class="p-5 space-y-4">
              <div><label class="label field-required">Názov</label><input class="input" v-model="editor.group.name" placeholder="Služby, Tovar, ..."/></div>
              <div><label class="label">Typ</label><select class="input" v-model="editor.group.type"><option v-for="(l,v) in ARTICLE_GROUP_TYPES" :key="v" :value="v">{{ l }}</option></select></div>
              <div><label class="label">Predvolená DPH sadzba</label><select class="input" v-model.number="editor.group.default_vat_rate"><option v-for="v in VAT_RATES" :key="v.code" :value="v.rate">{{ v.rate===null?'NaN':v.rate+'%' }}</option></select></div>
              <div><label class="label">Farba</label><input type="color" class="w-full h-10 rounded-lg border border-slate-200" v-model="editor.group.color"/></div>
              <div><label class="label">Poradie</label><input class="input" type="number" v-model.number="editor.group.sort_order"/></div>
            </div>
            <div class="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2"><button class="btn btn-secondary" @click="editor.show=false">Zrušiť</button><button class="btn btn-primary" @click="save"><icon name="save" :size="16"></icon> Uložiť</button></div>
          </div>
        </div>
      </transition>
    </div>`
};

const ReceiptList = {
  emits:['edit','new'],
  setup(_, {emit}){
    const loading=ref(true), search=ref('');
    const items=ref([]);
    async function load(){
      loading.value=true;
      try {
        const {data, error}=await getSB().from('receipts').select('id,number,issue_date,amount,purpose,payment_form,partner_name_snapshot,partners(name)').order('issue_date',{ascending:false}).limit(300);
        if(error) throw error;
        items.value=data||[];
      } catch(e){
        console.error('[ReceiptList] load error:', e);
        UI.toast('Chyba pri na��tan� dokladov: '+(e.message||e),'error', 6000);
      } finally { loading.value=false; }
    }
    const filtered=computed(()=>{
      if(!search.value) return items.value;
      const q=search.value.toLowerCase();
      return items.value.filter(r => (r.number||'').toLowerCase().includes(q) || (r.purpose||'').toLowerCase().includes(q) || (r.partner_name_snapshot||'').toLowerCase().includes(q));
    });
    async function del(r){
      const ok=await UI.ask({title:'Zmazať doklad?', message:`Doklad ${r.number} bude trvalo odstránený.`, danger:true, confirmText:'Zmazať'});
      if(!ok) return;
      const {error}=await getSB().from('receipts').delete().eq('id', r.id);
      if(error) UI.toast('Chyba: '+error.message,'error');
      else { UI.toast('Doklad zmazaný','success'); load(); }
    }
    onMounted(load);
    return { loading, items, filtered, search, del, fmtEUR, fmtDate, PAYMENT_FORMS, emit };
  },
  template:`
    <div class="p-6">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div class="flex items-center gap-3 flex-1">
          <div class="w-11 h-11 bg-brand-100 text-brand-600 rounded-xl flex items-center justify-center shrink-0"><icon name="receipt" :size="22"></icon></div>
          <div><h2 class="text-xl font-extrabold text-slate-900">Prijímové pokladničné doklady</h2><p class="text-sm text-slate-500">PPD — hotovostné a kartové platby</p></div>
        </div>
        <div class="flex items-center gap-2">
          <div class="relative"><icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></icon><input class="input input-sm pl-9 w-full sm:w-64" placeholder="Hľadať..." v-model="search"/></div>
          <button class="btn btn-primary btn-sm" @click="emit('new')"><icon name="plus" :size="16"></icon> Nový doklad</button>
        </div>
      </div>
      <div class="card">
        <div v-if="loading" class="p-12 text-center text-slate-400"><icon name="loader" :size="32" class="spin mx-auto"></icon></div>
        <div v-else-if="filtered.length===0" class="empty-state"><icon name="receipt" :size="48" class="mx-auto text-slate-300 mb-2"></icon><p class="font-medium">Žiadne doklady</p><button class="btn btn-primary btn-sm mt-3" @click="emit('new')"><icon name="plus" :size="16"></icon> Nový doklad</button></div>
        <table v-else class="data">
          <thead><tr><th>Číslo</th><th>Dátum</th><th>Odberateľ</th><th>Účel</th><th>Forma</th><th>Suma</th><th class="text-right">Akcie</th></tr></thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.id">
              <td class="font-semibold text-brand-700 cursor-pointer" @click="emit('edit', r.id)">{{ r.number }}</td>
              <td>{{ fmtDate(r.issue_date) }}</td>
              <td>{{ r.partner_name_snapshot || r.partners?.name || 'Hotovosť' }}</td>
              <td class="max-w-xs truncate">{{ r.purpose }}</td>
              <td><span class="badge bg-slate-100 text-slate-700">{{ PAYMENT_FORMS[r.payment_form] }}</span></td>
              <td class="font-bold text-emerald-700">{{ fmtEUR(r.amount) }}</td>
              <td class="text-right"><div class="inline-flex gap-1"><button class="icon-btn btn-xs" @click="emit('edit', r.id)"><icon name="edit" :size="15"></icon></button><button class="icon-btn btn-xs text-red-600" @click="del(r)"><icon name="trash" :size="15"></icon></button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`
};

const ReceiptEditor = {
  props:['receiptId'],
  emits:['back','saved'],
  setup(props, {emit}){
    const loading=ref(!!props.receiptId), saving=ref(false);
    const form=reactive(newReceipt());
    const partners=reactive({show:false});
    const partnerEditor=reactive({show:false, partner:null});
    function newReceipt(){ return { id:null, number:'', issue_date:todayISO(), partner_id:null, partner:null, partner_name_snapshot:'', amount:0, currency:'EUR', vat_rate:0, vat_amount:0, purpose:'', payment_form:'hotovost', vs:'', ks:'', cashier:'', note:'' }; }
    async function load(){
      if(props.receiptId){
        const {data, error}=await getSB().from('receipts').select('*').eq('id', props.receiptId).single();
        if(error){ UI.toast('Doklad sa nenašiel','error'); emit('back'); return; }
        Object.assign(form, data);
        if(data.partner_id){ const {data:p}=await getSB().from('partners').select('*').eq('id', data.partner_id).maybeSingle(); form.partner=p; }
      } else {
        try { const num=await nextDocNumber('receipt','PPD'); form.number=num; form.vs=num.replace(/\D/g,'').slice(-10); }
        catch(e){ console.warn(e); }
      }
      loading.value=false;
    }
    function pickPartner(p){ form.partner=p; form.partner_id=p.id; form.partner_name_snapshot=p.name; partners.show=false; }
    function onPartnerSaved(p){ partnerEditor.show=false; pickPartner(p); }
    async function save(){
      if(!form.purpose){ UI.toast('Účel je povinný','warn'); return; }
      if(Number(form.amount)<=0){ UI.toast('Suma musí byť kladná','warn'); return; }
      saving.value=true;
      try {
        let finalNumber=form.number;
        if(!form.id){ try { finalNumber=await nextDocNumber('receipt','PPD'); } catch(e){} }
        const payload={ number:finalNumber, issue_date:form.issue_date, partner_id:form.partner_id||null, partner_name_snapshot:form.partner_name_snapshot||form.partner?.name||'', amount:Number(form.amount), currency:form.currency, vat_rate:Number(form.vat_rate||0), vat_amount:Number(form.vat_amount||0), purpose:form.purpose, payment_form:form.payment_form, vs:form.vs, ks:form.ks, cashier:form.cashier, note:form.note };
        let rid=form.id;
        if(form.id){
          const {error}=await getSB().from('receipts').update(payload).eq('id', form.id);
          if(error) throw error;
        } else {
          const {data, error}=await getSB().from('receipts').insert(payload).select().single();
          if(error) throw error;
          rid=data.id; form.id=rid; form.number=finalNumber;
        }
        UI.toast('Doklad uložený','success');
        emit('saved', rid);
      } catch(e){ UI.toast('Chyba: '+e.message,'error'); }
      finally { saving.value=false; }
    }
    function exportPDF(){
      if(!window.pdfMake){ UI.toast('PDF nedostupné','error'); return; }
      const body=[
        { text:'PRIJÍMOVÝ POKLADNIČNÝ DOKLAD', bold:true, fontSize:20, color:'#4f46e5', alignment:'center', margin:[0,0,0,8] },
        { text:'č. '+form.number, bold:true, fontSize:14, alignment:'center', color:'#1e293b', margin:[0,0,0,16] },
        { columns:[{width:'*', text:'Dátum:', fontSize:10, color:'#64748b'},{width:'auto', text:fmtDate(form.issue_date), fontSize:10, bold:true}] },
        { columns:[{width:'*', text:'Čiastka:', fontSize:10, color:'#64748b', margin:[0,6,0,0]},{width:'auto', text:fmtEUR(form.amount), fontSize:14, bold:true, color:'#4f46e5', margin:[0,6,0,0]}] },
        { columns:[{width:'*', text:'Účel:', fontSize:10, color:'#64748b', margin:[0,6,0,0]},{width:'auto', text:form.purpose, fontSize:10, alignment:'right', margin:[0,6,0,0]}] },
        { columns:[{width:'*', text:'Spôsob:', fontSize:10, color:'#64748b', margin:[0,6,0,0]},{width:'auto', text:PAYMENT_FORMS[form.payment_form]||'', fontSize:10, alignment:'right', margin:[0,6,0,0]}] },
        { columns:[{width:'*', text:'Odberateľ:', fontSize:10, color:'#64748b', margin:[0,6,0,0]},{width:'auto', text:(form.partner_name_snapshot||form.partner?.name||''), fontSize:10, alignment:'right', margin:[0,6,0,0]}] },
        { columns:[{width:'*', text:'Variabilný symbol:', fontSize:10, color:'#64748b', margin:[0,6,0,0]},{width:'auto', text:form.vs||'', fontSize:10, alignment:'right', margin:[0,6,0,0]}] },
        { canvas:[{type:'line', x1:0,y1:0,x2:515,y2:0,lineColor:'#cbd5e1'}], margin:[0,30,0,6] },
        { text:'Podpis pokladníka: ____________________', fontSize:9, color:'#94a3b8', margin:[0,4,0,0] }
      ];
      pdfMake.createPdf({ content:body, pageSize:'A5', pageMargins:[40,40,40,40], defaultStyle:{font:'Roboto'} }).download(`PPD_${form.number}.pdf`);
      UI.toast('PDF stiahnuté','success');
    }
    onMounted(load);
    return { loading, saving, form, partners, partnerEditor, pickPartner, onPartnerSaved, save, exportPDF, fmtEUR, PAYMENT_FORMS, emit };
  },
  template:`
    <div class="p-6 max-w-3xl mx-auto">
      <div v-if="loading" class="text-center py-12"><icon name="loader" :size="32" class="spin mx-auto text-slate-400"></icon></div>
      <div v-else>
        <div class="flex items-center gap-3 mb-5">
          <button class="icon-btn" @click="emit('back')"><icon name="arrow-left" :size="22"></icon></button>
          <div class="flex-1"><h2 class="text-xl font-extrabold text-slate-900">{{ form.id?'Doklad '+form.number:'Nový prijímový doklad' }}</h2></div>
        </div>
        <div class="card p-6 space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">Dátum</label><input class="input" type="date" v-model="form.issue_date"/></div>
            <div><label class="label">Čiastka (EUR)</label><input class="input" type="number" step="0.01" v-model.number="form.amount"/></div>
          </div>
          <div><label class="label field-required">Účel platby</label><input class="input" v-model="form.purpose" placeholder="Napr. Úhrada faktúry FA2026-0001"/></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">Spôsob platby</label><select class="input" v-model="form.payment_form"><option v-for="(l,v) in PAYMENT_FORMS" :key="v" :value="v">{{ l }}</option></select></div>
            <div><label class="label">Variabilný symbol</label><input class="input" v-model="form.vs"/></div>
          </div>
          <div>
            <label class="label">Odberateľ (voliteľné)</label>
            <div v-if="form.partner || form.partner_name_snapshot" class="flex items-center justify-between bg-slate-50 rounded-lg p-2.5">
              <span class="text-sm font-medium">{{ form.partner_name_snapshot || form.partner?.name }}</span>
              <button class="btn btn-ghost btn-xs" @click="form.partner=null; form.partner_id=null; form.partner_name_snapshot=''"><icon name="x" :size="14"></icon></button>
            </div>
            <button v-else class="btn btn-secondary btn-sm w-full justify-center" @click="partners.show=true"><icon name="search" :size="14"></icon> Vybrať zákazníka</button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">Pokladník</label><input class="input" v-model="form.cashier"/></div>
            <div><label class="label">Poznámka</label><input class="input" v-model="form.note"/></div>
          </div>
        </div>
        <div class="flex gap-2 mt-4">
          <button class="btn btn-primary flex-1 justify-center" @click="save" :disabled="saving"><icon :name="saving?'loader':'save'" :size="16" :class="saving?'spin':''"></icon> Uložiť doklad</button>
          <button class="btn btn-secondary" @click="exportPDF" v-if="form.id"><icon name="download" :size="16"></icon> PDF</button>
        </div>
      </div>
      <partner-picker :show="partners.show" @pick="pickPartner" @close="partners.show=false" @new="()=>{ partners.show=false; partnerEditor.partner=null; partnerEditor.show=true; }"></partner-picker>
      <partner-editor :show="partnerEditor.show" :partner="partnerEditor.partner" @close="partnerEditor.show=false" @saved="onPartnerSaved"></partner-editor>
    </div>`
};
const Reports = {
  setup(){
    const loading=ref(true), tab=ref('revenue');
    const dateFrom=ref(new Date(new Date().getFullYear(),0,1).toISOString().slice(0,10));
    const dateTo=ref(todayISO());
    const data=reactive({ invoices:[], revenue:0, vat:0, count:0, byPartner:[], byVat:[], receiptsTotal:0, receiptsCount:0 });

    async function load(){
      loading.value=true;
      const s=getSB();
      try {
        const [inv, receipts] = await Promise.all([
          s.from('invoices').select('id,number,issue_date,due_date,total,subtotal,vat_total,status,partner_id,partners(name)').gte('issue_date', dateFrom.value).lte('issue_date', dateTo.value).order('issue_date'),
          s.from('receipts').select('id,amount,issue_date').gte('issue_date', dateFrom.value).lte('issue_date', dateTo.value)
        ]);
        const all = (inv.data||[]).filter(i => i.status !== 'cancelled');
        data.invoices = all;
        data.count = all.length;
        data.revenue = all.reduce((a,i)=>a+Number(i.subtotal||0),0);
        data.vat = all.reduce((a,i)=>a+Number(i.vat_total||0),0);
        const rAll = receipts.data || [];
        data.receiptsCount = rAll.length;
        data.receiptsTotal = rAll.reduce((a,r)=>a+Number(r.amount||0),0);
        // by partner
        const byP = {};
        all.forEach(i => {
          const name = i.partners?.name || '—';
          if(!byP[name]) byP[name] = { name, count:0, total:0 };
          byP[name].count++; byP[name].total += Number(i.total||0);
        });
        data.byPartner = Object.values(byP).sort((a,b)=>b.total-a.total).slice(0,10);
        // by VAT rate
        const byV = {};
        all.forEach(i => {
          if(!i.vat_total) return;
          const rate = i.vat_rate;
          // We'd need items for proper breakdown - approximate from invoice level
          // This is a simplified view; detailed VAT breakdown would require joining items
        });
        data.byVat = []; // For now; detailed VAT report could be added later
      } catch(e){ UI.toast('Chyba: '+e.message,'error'); }
      finally { loading.value=false; }
    }
    onMounted(load);
    return { loading, tab, dateFrom, dateTo, data, load, fmtEUR, fmtDate, INVOICE_STATUSES };
  },
  template:`
    <div class="p-6">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div class="flex items-center gap-3 flex-1">
          <div class="w-11 h-11 bg-brand-100 text-brand-600 rounded-xl flex items-center justify-center shrink-0"><icon name="bar-chart-3" :size="22"></icon></div>
          <div><h2 class="text-xl font-extrabold text-slate-900">Reporty</h2><p class="text-sm text-slate-500">Štatistiky a prehľady</p></div>
        </div>
        <div class="flex items-center gap-2">
          <input class="input input-sm" type="date" v-model="dateFrom"/>
          <span class="text-slate-400">—</span>
          <input class="input input-sm" type="date" v-model="dateTo"/>
          <button class="btn btn-primary btn-sm" @click="load"><icon name="refresh" :size="14"></icon> Zobraziť</button>
        </div>
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="stat-card"><div class="text-xs font-semibold text-slate-500 uppercase">Faktúr</div><div class="text-2xl font-extrabold text-slate-900 mt-1">{{ data.count }}</div></div>
        <div class="stat-card"><div class="text-xs font-semibold text-slate-500 uppercase">Obrat (bez DPH)</div><div class="text-2xl font-extrabold text-brand-700 mt-1">{{ fmtEUR(data.revenue) }}</div></div>
        <div class="stat-card"><div class="text-xs font-semibold text-slate-500 uppercase">DPH</div><div class="text-2xl font-extrabold text-amber-600 mt-1">{{ fmtEUR(data.vat) }}</div></div>
        <div class="stat-card"><div class="text-xs font-semibold text-slate-500 uppercase">PPD</div><div class="text-2xl font-extrabold text-emerald-600 mt-1">{{ fmtEUR(data.receiptsTotal) }}</div><div class="text-xs text-slate-500">{{ data.receiptsCount }} dokladov</div></div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="card p-5">
          <h3 class="font-bold text-slate-900 mb-3 flex items-center gap-2"><icon name="users" :size="18" class="text-brand-600"></icon> Top zákazníci</h3>
          <div v-if="loading" class="p-8 text-center text-slate-400"><icon name="loader" :size="24" class="spin mx-auto"></icon></div>
          <div v-else-if="data.byPartner.length===0" class="empty-state text-sm">Žiadne dáta</div>
          <table v-else class="data">
            <thead><tr><th>Zákazník</th><th class="text-center">Faktúr</th><th class="text-right">Obrat</th></tr></thead>
            <tbody>
              <tr v-for="(p,i) in data.byPartner" :key="p.name"><td><span class="text-slate-400 mr-1">{{ i+1 }}.</span> {{ p.name }}</td><td class="text-center">{{ p.count }}</td><td class="text-right font-semibold">{{ fmtEUR(p.total) }}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="card p-5">
          <h3 class="font-bold text-slate-900 mb-3 flex items-center gap-2"><icon name="file-text" :size="18" class="text-brand-600"></icon> Posledné faktúry v období</h3>
          <div v-if="loading" class="p-8 text-center text-slate-400"><icon name="loader" :size="24" class="spin mx-auto"></icon></div>
          <div v-else-if="data.invoices.length===0" class="empty-state text-sm">Žiadne faktúry</div>
          <div v-else class="space-y-1 max-h-96 overflow-y-auto">
            <div v-for="inv in data.invoices.slice(-15).reverse()" :key="inv.id" class="flex items-center justify-between gap-2 p-2 rounded hover:bg-slate-50">
              <div class="min-w-0"><div class="font-semibold text-sm text-brand-700 truncate">{{ inv.number }}</div><div class="text-xs text-slate-500 truncate">{{ inv.partners?.name || '—' }} · {{ fmtDate(inv.issue_date) }}</div></div>
              <div class="text-right shrink-0"><div class="font-bold text-sm">{{ fmtEUR(inv.total) }}</div><span :class="[INVOICE_STATUSES[inv.status].bg, INVOICE_STATUSES[inv.status].text]" class="badge">{{ INVOICE_STATUSES[inv.status].label }}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>`
};

const Settings = {
  props:['activeTab'],
  setup(props){
    const tab=ref(props.activeTab || 'company');
    const company=reactive({ id:null, name:'Apexholding, s.r.o.', legal_form:'s.r.o.', vat_payer:true, country:'Slovensko', default_currency:'EUR', default_due_days:14, default_ks:'0308', default_payment_method:'prevod' });
    const sequences=ref([]);
    const taxRates=ref([]);
    const config=reactive({ url:'', key:'' });
    const users=ref([]);
    const saving=ref(false);

    async function load(){
      const s=getSB();
      const [c, sq, tr, us] = await Promise.all([
        s.from('companies').select('*').limit(1).maybeSingle(),
        s.from('number_sequences').select('*').order('year',{ascending:false}),
        s.from('tax_rates').select('*').order('sort_order'),
        s.from('audit_log').select('user_email').limit(1)
      ]);
      if(c.data) Object.assign(company, c.data);
      sequences.value = sq.data || [];
      taxRates.value = tr.data || [];
      const cfg=loadConfig();
      config.url=cfg.url||''; config.key=cfg.key||'';
      // Users - we can't list auth.users directly without admin API, so show via audit log distinct emails
      try {
        const { data: userList } = await s.from('audit_log').select('user_email').order('ts',{ascending:false}).limit(50);
        const unique = {};
        (userList||[]).forEach(u => { if(u.user_email && !unique[u.user_email]) unique[u.user_email] = u.user_email; });
        users.value = Object.keys(unique).map(e=>({email:e}));
      } catch(e){}
    }
    async function saveCompany(){
      saving.value=true;
      try {
        if(company.id){
          const {error}=await db.update('companies', company.id, company);
          if(error) throw error;
        } else {
          delete company.id;
          const {data, error}=await db.insert('companies', company);
          if(error) throw error;
          Object.assign(company, data);
        }
        UI.toast('Firma uložená','success');
      } catch(e){ UI.toast('Chyba: '+e.message,'error'); }
      finally { saving.value=false; }
    }
    async function saveSequence(sq){
      const {error}=await db.update('number_sequences', sq.id, { prefix:sq.prefix, separator:sq.separator, padding:sq.padding, format_template:sq.format_template });
      if(error) UI.toast('Chyba: '+error.message,'error');
      else UI.toast('Číselný rad uložený','success');
    }
    async function saveTaxRate(tr){
      const {error}=await db.update('tax_rates', tr.code, { rate:tr.rate, name:tr.name, is_default:tr.is_default });
      if(error) UI.toast('Chyba: '+error.message,'error');
      else UI.toast('Sadzba uložená','success');
    }
    function saveConnection(){
      saveConfig({url:config.url, key:config.key});
      UI.toast('Pripojenie uložené. Načítaj aplikáciu znova pre aplikovanie zmien.','success', 5000);
    }
    function testConnection(){
      saveConfig({url:config.url, key:config.key});
      location.reload();
    }
    const tabs=[
      { key:'company', label:'Moja firma', icon:'building' },
      { key:'numbering', label:'Číslovanie', icon:'hash' },
      { key:'vat', label:'DPH sadzby', icon:'percent' },
      { key:'connection', label:'Pripojenie', icon:'database' },
      { key:'users', label:'Používatelia', icon:'users' }
    ];
    onMounted(load);
    return { tab, tabs, company, sequences, taxRates, config, users, saving, saveCompany, saveSequence, saveTaxRate, saveConnection, testConnection, fmtDate };
  },
  template:`
    <div class="p-6 max-w-5xl mx-auto">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-11 h-11 bg-brand-100 text-brand-600 rounded-xl flex items-center justify-center shrink-0"><icon name="settings" :size="22"></icon></div>
        <div><h2 class="text-xl font-extrabold text-slate-900">Nastavenia</h2><p class="text-sm text-slate-500">Konfigurácia aplikácie a firmy</p></div>
      </div>
      <div class="flex gap-1 mb-5 border-b border-slate-200 overflow-x-auto">
        <button v-for="t in tabs" :key="t.key" :class="tab===t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'" class="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors" @click="tab=t.key">
          <icon :name="t.icon" :size="16"></icon> {{ t.label }}
        </button>
      </div>

      <div v-if="tab==='company'" class="card p-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="label field-required">Názov firmy</label><input class="input" v-model="company.name"/></div>
          <div><label class="label">Právna forma</label><input class="input" v-model="company.legal_form"/></div>
          <div><label class="label">IČO</label><input class="input" v-model="company.ico"/></div>
          <div><label class="label">DIČ</label><input class="input" v-model="company.dic"/></div>
          <div><label class="label">IČ DPH</label><input class="input" v-model="company.ic_dph"/></div>
          <div class="flex items-end"><label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" v-model="company.vat_payer" class="w-4 h-4 accent-brand-600"/><span class="text-sm font-medium">Platca DPH</span></label></div>
          <div class="md:col-span-2"><label class="label">Adresa sídla</label><input class="input" v-model="company.address"/></div>
          <div><label class="label">PSČ</label><input class="input" v-model="company.zip"/></div>
          <div><label class="label">Mesto</label><input class="input" v-model="company.city"/></div>
          <div><label class="label">Krajina</label><input class="input" v-model="company.country"/></div>
          <div><label class="label">Register</label><input class="input" v-model="company.register_text" placeholder="Zapísaná v OR Okresného súdu ..."/></div>
          <div><label class="label">IBAN</label><input class="input" v-model="company.iban"/></div>
          <div><label class="label">SWIFT/BIC</label><input class="input" v-model="company.swift"/></div>
          <div><label class="label">Banka</label><input class="input" v-model="company.bank_name"/></div>
          <div><label class="label">Email</label><input class="input" v-model="company.email"/></div>
          <div><label class="label">Telefón</label><input class="input" v-model="company.phone"/></div>
          <div><label class="label">Web</label><input class="input" v-model="company.website"/></div>
          <div><label class="label">Logo URL</label><input class="input" v-model="company.logo_url" placeholder="(voliteľné)"/></div>
          <div><label class="label">Štandardná lehota splatnosti (dni)</label><input class="input" type="number" v-model.number="company.default_due_days"/></div>
          <div><label class="label">Štandardný konšt. symbol</label><input class="input" v-model="company.default_ks"/></div>
        </div>
        <div class="flex justify-end mt-5"><button class="btn btn-primary" @click="saveCompany" :disabled="saving"><icon :name="saving?'loader':'save'" :size="16" :class="saving?'spin':''"></icon> Uložiť firmu</button></div>
      </div>

      <div v-else-if="tab==='numbering'" class="card p-6">
        <p class="text-sm text-slate-500 mb-4">Šablóna čísla: <code class="bg-slate-100 px-1.5 py-0.5 rounded">{PREFIX}</code>, <code class="bg-slate-100 px-1.5 py-0.5 rounded">{YEAR}</code>, <code class="bg-slate-100 px-1.5 py-0.5 rounded">{SEP}</code>, <code class="bg-slate-100 px-1.5 py-0.5 rounded">{PAD}</code> (napr. FA2026-0001)</p>
        <table class="data">
          <thead><tr><th>Typ</th><th>Rok</th><th>Prefix</th><th>Separátor</th><th>Padding</th><th>Posledné č.</th><th>Šablóna</th><th></th></tr></thead>
          <tbody>
            <tr v-for="sq in sequences" :key="sq.id">
              <td class="font-semibold">{{ sq.doc_type }}</td>
              <td>{{ sq.year }}</td>
              <td><input class="input input-sm w-20" v-model="sq.prefix"/></td>
              <td><input class="input input-sm w-12" v-model="sq.separator"/></td>
              <td><input class="input input-sm w-14" type="number" v-model.number="sq.padding"/></td>
              <td class="text-slate-500">{{ sq.last_number }}</td>
              <td><input class="input input-sm w-44 font-mono text-xs" v-model="sq.format_template"/></td>
              <td><button class="btn btn-secondary btn-xs" @click="saveSequence(sq)"><icon name="save" :size="14"></icon></button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="tab==='vat'" class="card p-6">
        <table class="data">
          <thead><tr><th>Kód</th><th>Sadzba %</th><th>Názov</th><th>Predvolená</th><th></th></tr></thead>
          <tbody>
            <tr v-for="tr in taxRates" :key="tr.code">
              <td class="font-mono font-semibold">{{ tr.code }}</td>
              <td><input class="input input-sm w-24" type="number" step="0.01" v-model.number="tr.rate"/></td>
              <td><input class="input input-sm" v-model="tr.name"/></td>
              <td><input type="checkbox" v-model="tr.is_default" class="w-4 h-4 accent-brand-600"/></td>
              <td><button class="btn btn-secondary btn-xs" @click="saveTaxRate(tr)"><icon name="save" :size="14"></icon></button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="tab==='connection'" class="card p-6 max-w-xl">
        <div class="space-y-4">
          <div><label class="label">Supabase URL</label><input class="input font-mono text-xs" v-model="config.url"/></div>
          <div><label class="label">Publishable / anon key</label><textarea class="input font-mono text-xs" rows="3" v-model="config.key"></textarea></div>
          <div class="flex gap-2">
            <button class="btn btn-primary" @click="saveConnection"><icon name="save" :size="16"></icon> Uložiť</button>
            <button class="btn btn-secondary" @click="testConnection"><icon name="refresh" :size="16"></icon> Uložiť + reload</button>
          </div>
          <div class="bg-blue-50 border border-blue-200 text-blue-700 rounded-lg p-3 text-xs flex gap-2"><icon name="info" :size="16" class="shrink-0 mt-0.5"></icon><span>Po zmene pripojenia je potrebné obnoviť stránku. Tieto hodnoty sú uložené len v tomto prehliadači (localStorage).</span></div>
        </div>
      </div>

      <div v-else-if="tab==='users'" class="card p-6 max-w-2xl">
        <div class="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-3 text-xs flex gap-2 mb-4"><icon name="info" :size="16" class="shrink-0 mt-0.5"></icon><span>Používatelia sa spravujú v Supabase Dashboard → Authentication → Users. Tu je zoznam nedávno aktívnych (z audit logu).</span></div>
        <table class="data">
          <thead><tr><th>Email</th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.email"><td class="font-medium">{{ u.email }}</td></tr>
            <tr v-if="users.length===0"><td class="text-slate-400 text-center">Žiadni používatelia</td></tr>
          </tbody>
        </table>
      </div>
    </div>`
};

/* Modals (použité v rôznych moduloch) */
const PartnerPicker = {
  props:['show','filterType'],
  emits:['pick','close','new'],
  setup(props, {emit}){
    const q=ref(''); const items=ref([]); const loading=ref(false);
    async function load(){
      loading.value=true;
      const s=getSB();
      let query=s.from('partners').select('id,name,ico,city,type').eq('is_archived',false).order('name').limit(60);
      if(props.filterType) query=query.or(`type.eq.${props.filterType},type.eq.both`);
      const {data}=await query;
      items.value=data||[];
      loading.value=false;
    }
    const filtered=computed(()=>{
      if(!q.value) return items.value;
      const s=q.value.toLowerCase();
      return items.value.filter(p => (p.name||'').toLowerCase().includes(s) || (p.ico||'').includes(s));
    });
    watch(()=>props.show, v=>{ if(v){ q.value=''; load(); } });
    return {q, items, filtered, loading, emit, props};
  },
  template:`
    <transition name="modal">
      <div v-if="props.show" class="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" @click.self="emit('close')">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
          <div class="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 class="font-bold text-slate-900">Vybrať zákazníka</h3>
            <button class="icon-btn" @click="emit('close')"><icon name="x" :size="18"></icon></button>
          </div>
          <div class="p-4 border-b border-slate-100">
            <div class="relative">
              <icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></icon>
              <input class="input pl-9" placeholder="Hľadať meno alebo IČO..." v-model="q" autofocus/>
            </div>
          </div>
          <div class="max-h-80 overflow-y-auto">
            <div v-if="loading" class="p-8 text-center text-slate-400"><icon name="loader" :size="24" class="spin mx-auto"></icon></div>
            <div v-else-if="filtered.length===0" class="p-8 text-center text-slate-400 text-sm">Žiadny zákazník sa nenašiel</div>
            <button v-for="p in filtered" :key="p.id" class="w-full text-left px-4 py-3 hover:bg-brand-50 border-b border-slate-50 flex items-center gap-3" @click="emit('pick', p)">
              <div class="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center text-xs font-bold text-slate-600">{{ p.name?.[0]?.toUpperCase() }}</div>
              <div class="flex-1 min-w-0"><div class="font-semibold text-sm text-slate-900 truncate">{{ p.name }}</div><div class="text-xs text-slate-500">{{ p.ico ? 'IČO: '+p.ico : '—' }} · {{ p.city || '' }}</div></div>
              <icon name="chevron-right" :size="16" class="text-slate-400"></icon>
            </button>
          </div>
          <div class="p-3 border-t border-slate-100 bg-slate-50"><button class="btn btn-secondary w-full justify-center btn-sm" @click="emit('new')"><icon name="plus" :size="16"></icon> Založiť nového</button></div>
        </div>
      </div>
    </transition>`
};
const ArticlePicker = {
  props:['show'],
  emits:['pick','close','new'],
  setup(props, {emit}){
    const q=ref(''); const items=ref([]); const loading=ref(false);
    async function load(){
      loading.value=true;
      const {data}=await getSB().from('articles').select('id,name,code,unit,price,vat_rate,article_groups(name)').eq('is_archived',false).order('name').limit(80);
      items.value=data||[];
      loading.value=false;
    }
    const filtered=computed(()=>{
      if(!q.value) return items.value.slice(0,30);
      const s=q.value.toLowerCase();
      return items.value.filter(a => (a.name||'').toLowerCase().includes(s) || (a.code||'').toLowerCase().includes(s));
    });
    watch(()=>props.show, v=>{ if(v){ q.value=''; load(); } });
    return {q, items, filtered, loading, emit, props, fmtEUR};
  },
  template:`
    <transition name="modal">
      <div v-if="props.show" class="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" @click.self="emit('close')">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
          <div class="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 class="font-bold text-slate-900">Vybrať artiklel</h3>
            <button class="icon-btn" @click="emit('close')"><icon name="x" :size="18"></icon></button>
          </div>
          <div class="p-4 border-b border-slate-100">
            <div class="relative">
              <icon name="search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></icon>
              <input class="input pl-9" placeholder="Hľadať artiklel..." v-model="q" autofocus/>
            </div>
          </div>
          <div class="max-h-80 overflow-y-auto">
            <div v-if="loading" class="p-8 text-center text-slate-400"><icon name="loader" :size="24" class="spin mx-auto"></icon></div>
            <div v-else-if="filtered.length===0" class="p-8 text-center"><p class="text-sm text-slate-500 mb-3">Žiadny artiklel pre „{{ q }}".</p><button class="btn btn-primary btn-sm" @click="emit('new', q)"><icon name="plus" :size="16"></icon> Založiť nový artiklel</button></div>
            <button v-for="a in filtered" :key="a.id" class="w-full text-left px-4 py-3 hover:bg-brand-50 border-b border-slate-50 flex items-center gap-3" @click="emit('pick', a)">
              <div class="w-9 h-9 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center"><icon name="package" :size="16"></icon></div>
              <div class="flex-1 min-w-0"><div class="font-semibold text-sm text-slate-900 truncate">{{ a.name }}</div><div class="text-xs text-slate-500">{{ a.article_groups?.name || 'Bez skupiny' }} · {{ a.unit }}</div></div>
              <div class="text-sm font-bold text-slate-900">{{ fmtEUR(a.price) }}</div>
            </button>
          </div>
        </div>
      </div>
    </transition>`
};
const PartnerEditor = {
  props:['show','partner','defaultType'],
  emits:['close','saved'],
  setup(props, {emit}){
    const form=reactive(emptyForm());
    const saving=ref(false), lookupLoading=ref(false), lookupMsg=ref(null);

    function emptyForm(){ return { id:null, type:props.defaultType||'customer', name:'', ico:'', dic:'', ic_dph:'', vat_payer:false, is_person:false, address:'', city:'', zip:'', country:'Slovensko', email:'', phone:'', contact_person:'', iban:'', note:'' }; }
    function fill(p){ Object.assign(form, emptyForm(), p||{}); }
    watch(()=>props.show, v=>{ if(v){ lookupMsg.value=null; fill(props.partner); } });
    watch(()=>props.partner, p=>{ if(props.show) fill(p); });

    async function lookupICO(){
      if(!form.ico || form.ico.replace(/\D/g,'').length!==8){ UI.toast('Zadaj IČO (8 číslic)','warn'); return; }
      lookupLoading.value=true; lookupMsg.value=null;
      try {
        const data=await lookupSlovakICO(form.ico);
        if(form.name && data.name && form.name.toLowerCase()!==data.name.toLowerCase()){
          lookupMsg.value={type:'warn', text:`Register uvádza iný názov: „${data.name}". Použiť z registra?`, data};
        } else {
          lookupMsg.value={type:'ok', text:'Údaje overené z registra '+(data.source||'')+'.'};
          applyData(data);
        }
        UI.toast('Načítané z registra','success');
      } catch(e){
        lookupMsg.value={type:'err', text:'Nepodarilo sa načítať: '+e.message};
        UI.toast('Lookup zlyhal: '+e.message,'error');
      } finally { lookupLoading.value=false; }
    }
    function applyRegistry(){ if(lookupMsg.value?.data){ applyData(lookupMsg.value.data); lookupMsg.value={type:'ok', text:'Údaje z registra použité.'}; } }
    function applyData(data){
      if(!form.name) form.name=data.name;
      if(!form.dic) form.dic=data.dic;
      if(!form.ic_dph) form.ic_dph=data.ic_dph;
      if(!form.address) form.address=data.address;
      if(!form.city) form.city=data.city;
      if(!form.zip) form.zip=data.zip;
      if(data.dic) form.vat_payer=true;
    }
    async function save(){
      if(!form.name){ UI.toast('Názov je povinný','warn'); return; }
      saving.value=true;
      try {
        const payload={...form};
        if(form.id){
          const {data, error}=await db.update('partners', form.id, payload);
          if(error) throw error;
          UI.toast('Kontakt uložený','success'); emit('saved', data);
        } else {
          delete payload.id;
          const {data, error}=await db.insert('partners', payload);
          if(error) throw error;
          UI.toast('Kontakt vytvorený','success'); emit('saved', data);
        }
      } catch(e){ UI.toast('Chyba: '+e.message,'error'); }
      finally { saving.value=false; }
    }
    return { form, saving, lookupLoading, lookupMsg, lookupICO, applyRegistry, save, emit, props, PARTNER_TYPES };
  },
  template:`
    <transition name="modal">
      <div v-if="props.show" class="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" @click.self="emit('close')">
        <transition name="modal-content" appear>
          <div v-if="props.show" class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div class="p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 class="font-bold text-slate-900">{{ form.id ? 'Upraviť kontakt' : 'Nový kontakt' }}</h3>
              <button class="icon-btn" @click="emit('close')"><icon name="x" :size="18"></icon></button>
            </div>
            <div class="p-5 space-y-4">
              <div class="grid grid-cols-2 gap-3">
                <div><label class="label">Typ kontaktu</label><select class="input" v-model="form.type"><option v-for="(l,v) in PARTNER_TYPES" :key="v" :value="v">{{ l }}</option></select></div>
                <div class="flex items-end"><div class="flex items-center gap-2 h-[42px]"><input type="checkbox" id="vatp" v-model="form.vat_payer" class="w-4 h-4 rounded accent-brand-600"/><label for="vatp" class="text-sm font-medium text-slate-700 cursor-pointer">Platca DPH</label></div></div>
              </div>
              <div><label class="label field-required">Názov firmy / Meno</label><input class="input" v-model="form.name" placeholder="Apexholding, s.r.o." /></div>
              <div class="grid grid-cols-3 gap-3">
                <div><label class="label">IČO</label><div class="flex gap-1"><input class="input flex-1" v-model="form.ico" placeholder="12345678" maxlength="8"/><button class="btn btn-secondary px-2" @click="lookupICO" :disabled="lookupLoading" title="Načítať z registra"><icon :name="lookupLoading?'loader':'search'" :size="16" :class="lookupLoading?'spin':''"></icon></button></div></div>
                <div><label class="label">DIČ</label><input class="input" v-model="form.dic" placeholder="1234567890"/></div>
                <div><label class="label">IČ DPH</label><input class="input" v-model="form.ic_dph" placeholder="SK1234567890"/></div>
              </div>
              <div v-if="lookupMsg" :class="{'bg-emerald-50 border-emerald-200 text-emerald-700':lookupMsg.type==='ok','bg-amber-50 border-amber-200 text-amber-700':lookupMsg.type==='warn','bg-red-50 border-red-200 text-red-700':lookupMsg.type==='err'}" class="border rounded-lg p-2.5 text-xs flex items-center gap-2">
                <icon :name="lookupMsg.type==='ok'?'check-circle':'alert-circle'" :size="16"></icon>
                <span class="flex-1">{{ lookupMsg.text }}</span>
                <button v-if="lookupMsg.type==='warn'" class="underline font-semibold" @click="applyRegistry">Použiť register</button>
              </div>
              <div><label class="label">Adresa (ulica, číslo)</label><input class="input" v-model="form.address" placeholder="Hlavná 123"/></div>
              <div class="grid grid-cols-3 gap-3">
                <div><label class="label">PSČ</label><input class="input" v-model="form.zip" placeholder="811 01"/></div>
                <div><label class="label">Mesto</label><input class="input" v-model="form.city" placeholder="Bratislava"/></div>
                <div><label class="label">Krajina</label><input class="input" v-model="form.country"/></div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div><label class="label">Email</label><input class="input" type="email" v-model="form.email"/></div>
                <div><label class="label">Telefón</label><input class="input" v-model="form.phone"/></div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div><label class="label">Kontaktná osoba</label><input class="input" v-model="form.contact_person"/></div>
                <div><label class="label">IBAN</label><input class="input" v-model="form.iban"/></div>
              </div>
              <div><label class="label">Poznámka</label><textarea class="input" rows="2" v-model="form.note"></textarea></div>
            </div>
            <div class="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 sticky bottom-0">
              <button class="btn btn-secondary" @click="emit('close')">Zrušiť</button>
              <button class="btn btn-primary" @click="save" :disabled="saving || !form.name"><icon :name="saving?'loader':'save'" :size="16" :class="saving?'spin':''"></icon> Uložiť</button>
            </div>
          </div>
        </transition>
      </div>
    </transition>`
};

/* =============================== ROOT APP =============================== */
const App = {
  components:{ SetupScreen, LoginScreen, Sidebar, TopBar, Toasts, ConfirmDialog },
  setup(){
    const bootState=ref('init');
    const user=ref(null);
    const collapsed=ref(false);
    const currentNav=ref('dashboard');
    const viewKey=ref(0);
    const viewProps=reactive({});
    let lastActivity=Date.now();
    let idleChecker=null;

    const TITLE_MAP={
      dashboard:'Dashboard', invoices:'Faktúry', receipts:'Prijímové doklady',
      'invoice-edit':'Faktúra', 'invoice-new':'Nová faktúra',
      partners:'Kontakty', articles:'Artikle', 'article-groups':'Skupiny artiklov',
      reports:'Reporty', accounting:'Účtovníctvo', settings:'Nastavenia'
    };
    const pageTitle=computed(()=>TITLE_MAP[currentNav.value] || currentNav.value);

    const currentView=computed(()=>{
      const n=currentNav.value;
      if(n==='dashboard') return 'dashboard';
      if(n==='invoices') return 'invoice-list';
      if(n==='invoice-new') return 'invoice-editor';
      if(n==='invoice-edit') return 'invoice-editor';
      if(n==='receipts') return 'receipt-list';
      if(n==='receipt-new') return 'receipt-editor';
      if(n==='receipt-edit') return 'receipt-editor';
      if(n==='partners' || n==='customers' || n==='suppliers') return 'partners';
      if(n==='articles') return 'articles';
      if(n==='article-groups') return 'article-groups';
      if(n==='reports') return 'reports';
      if(n==='settings') return 'settings';
      return 'dashboard';
    });

    async function initBoot(){
      let cfg=loadConfig();
      // Ak nie je v localStorage, ale sú defaulty v kóde - použi ich automaticky (preskoč Setup screen)
      if((!cfg.url || !cfg.key) && DEFAULT_SUPABASE_URL && DEFAULT_SUPABASE_KEY){
        saveConfig({url:DEFAULT_SUPABASE_URL, key:DEFAULT_SUPABASE_KEY});
        cfg=loadConfig();
      }
      if(!cfg.url || !cfg.key){ bootState.value='setup'; return; }
      const s=getSB();
      if(!s){ bootState.value='setup'; return; }
      const { data:{session} } = await s.auth.getSession();
      if(session){
        user.value=session.user;
        bootState.value='ready';
        startActivityMonitor();
      } else {
        bootState.value='login';
      }
    }
    function onSetupDone(){ bootState.value='login'; }
    function onLoginSuccess(u){ user.value=u; bootState.value='ready'; navTo({key:'dashboard'}); startActivityMonitor(); }
    async function logout(){
      await getSB().auth.signOut();
      user.value=null;
      bootState.value='login';
      stopActivityMonitor();
      UI.toast('Boli ste odhlásený','info');
    }
    function navTo(item){
      if(typeof item==='string') item={key:item};
      if(item.disabled) return;
      // Použi item.key (nie view) ako navKey - aby Zákazníci a Dodávatelia
      // mali rozdielny active state v sidebare
      currentNav.value=item.key;
      viewProps.type=item.params?.type;
      viewProps.invoiceId=item.params?.id;
      viewProps.receiptId=item.params?.id;
      viewProps.activeTab=item.params?.tab;
      viewProps.defaultType=item.params?.type;
      viewProps.search=item.params?.q;
      viewKey.value++;
    }
    function goBack(){ navTo({key: historyBackTarget()}); }
    function historyBackTarget(){
      const n=currentNav.value;
      if(n==='invoice-editor' || n==='invoice-edit' || n==='invoice-new') return 'invoices';
      if(n==='receipt-editor' || n==='receipt-edit' || n==='receipt-new') return 'receipts';
      return 'dashboard';
    }
    function onQuickAction(action){
      if(action==='new-invoice') navTo({key:'invoice-new'});
      else if(action==='new-receipt') navTo({key:'receipt-new'});
      else if(typeof action==='object' && action.view==='invoice-edit') navTo({key:'invoice-edit', params:{id:action.id}});
    }
    function resetIdle(){ lastActivity=Date.now(); }
    function startActivityMonitor(){
      ['mousedown','keydown','scroll','touchstart'].forEach(ev=>document.addEventListener(ev, resetIdle, {passive:true}));
      idleChecker=setInterval(()=>{
        if(Date.now()-lastActivity > IDLE_TIMEOUT_MIN*60*1000){
          logout();
          UI.toast('Boli ste automaticky odhlásený pre nečinnosť','warn',6000);
        }
      }, 30000);
    }
    function stopActivityMonitor(){
      ['mousedown','keydown','scroll','touchstart'].forEach(ev=>document.removeEventListener(ev, resetIdle));
      if(idleChecker){ clearInterval(idleChecker); idleChecker=null; }
    }
    onMounted(initBoot);
    onBeforeUnmount(stopActivityMonitor);
    return { bootState, user, collapsed, currentNav, currentView, viewKey, viewProps, pageTitle, onSetupDone, onLoginSuccess, logout, navTo, goBack, onQuickAction };
  }
};

/* v-click-outside directive */
const clickOutside = {
  beforeMount(el, binding){
    el._clickOutside = (e)=>{ if(!(el===e.target || el.contains(e.target))) binding.value && binding.value(e); };
    document.addEventListener('click', el._clickOutside, true);
  },
  unmounted(el){ document.removeEventListener('click', el._clickOutside, true); }
};

/* =============================== MOUNT =================================== */
/* Globálny error handler - zobrazí chyby viditeľne na stránke */
function showFatalError(type, msg, stack){
  console.error('[FATAL]', type, msg, stack);
  const existing = document.getElementById('__fatal_err');
  if(existing) existing.remove();
  const div = document.createElement('div');
  div.id = '__fatal_err';
  div.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:white;padding:12px 16px;font:13px/1.4 monospace;white-space:pre-wrap;max-height:50vh;overflow:auto;border-bottom:3px solid #991b1b';
  div.textContent = `[${type}] ${msg}\n${stack||''}`;
  document.body.appendChild(div);
}
if(typeof window !== 'undefined'){
  window.addEventListener('error', (e)=> showFatalError('window.error', e.message, e.error?.stack || e.filename+':'+e.lineno));
  window.addEventListener('unhandledrejection', (e)=> showFatalError('unhandledrejection', e.reason?.message || String(e.reason), e.reason?.stack));
}

const app = createApp(App);
app.config.errorHandler = (err, vm, info) => {
  showFatalError('Vue.errorHandler', err.message, (err.stack||'') + '\n[info] '+info);
};
app.directive('click-outside', clickOutside);
app.component('Icon', Icon);
app.component('Toasts', Toasts);
app.component('ConfirmDialog', ConfirmDialog);
app.component('SetupScreen', SetupScreen);
app.component('LoginScreen', LoginScreen);
app.component('Sidebar', Sidebar);
app.component('TopBar', TopBar);
app.component('Dashboard', Dashboard);
app.component('InvoiceList', InvoiceList);
app.component('InvoiceEditor', InvoiceEditor);
app.component('ReceiptList', ReceiptList);
app.component('ReceiptEditor', ReceiptEditor);
app.component('Partners', Partners);
app.component('Articles', Articles);
app.component('ArticleGroups', ArticleGroups);
app.component('Reports', Reports);
app.component('Settings', Settings);
app.component('StubView', StubView);
app.component('PartnerPicker', PartnerPicker);
app.component('ArticlePicker', ArticlePicker);
app.component('PartnerEditor', PartnerEditor);
app.mount('#app');
