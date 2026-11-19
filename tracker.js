// ==UserScript==
// @name         Torn Inventory & Marketplace, Highlighter & Tracker
// @namespace    http://torn.com/
// @version      5.3
// @description  Highlight marketplace item names by owned amount and pulse prices based on custom values
// @author       c0pyc4t
// @match        https://www.torn.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-end
// ==/UserScript==

/* =====================================================================
* PC Version
* 
* The Torn PDA app replaces the literal ###PDA-APIKEY### at install time
* with the user's stored Torn API key (configured in PDA Settings ->
* Advanced -> API Key). This version has:
* - No floating CAT button.
* - No on-page control panel.
* - No GM_registerMenuCommand entries.
* The API key comes ONLY from PDA's placeholder. On first run the
* resolved key is sent to /api/register; the returned token is stored
* and reused on every subsequent load.
* PDA supports GM_xmlhttpRequest / GM_setValue / GM_getValue /
* GM_deleteValue (routed through PDA's native HTTP handlers, which also
* bypass CORS for the @connect domains). Every GM_* call is still
* feature-detected so the script also runs in a normal Tampermonkey host.
* ===================================================================== */

(function () {
    'use strict';

    const INV_STORAGE_KEY = 'torn_inventory_only_snapshot';
    const DC_STORAGE_KEY  = 'torn_displaycase_only_snapshot';
    const API_KEY_STORAGE = 'torn_api_key';
    const PANEL_POS_STORAGE = 'torn_inv_panel_pos';
    const PANEL_COLLAPSED_STORAGE = 'torn_inv_panel_collapsed';
    const PANEL_HIDDEN_STORAGE = 'torn_inv_panel_hidden';
    const THRESHOLDS_STORAGE = 'torn_inv_thresholds';
    const DEFAULT_THRESHOLD_STORAGE = 'torn_inv_default_threshold';
    const PRICE_TARGETS_STORAGE = 'torn_inv_price_targets';
    const WATCHLIST_STORAGE = 'torn_inv_watchlist';
    const API_BASE = 'https://api.torn.com/v2';
    const REFRESH_COOLDOWN_MS = 60000;
    const DEFAULT_THRESHOLD = { red: 1, yellow: 5, green: 10 };

    const CATEGORIES = [
        { name: 'Collectible',  variants: ['Collectible', 'collectible'] },
        { name: 'Clothing',     variants: ['Clothing', 'clothing'] },
        { name: 'Other',        variants: ['Other', 'other'] },
        { name: 'Tools',        variants: ['Tools', 'tools', 'TOOLS', 'Tool', 'tool', 'Weapons', 'weapons', 'weapon'] },
        { name: 'Melee',        variants: ['Melee', 'melee'] },
        { name: 'Defensive',    variants: ['Defensive', 'defensive'] },
        { name: 'Material',     variants: ['Material', 'material'] },
        { name: 'Car',          variants: ['Car', 'car'] },
        { name: 'Primary',      variants: ['Primary', 'primary'] },
        { name: 'Secondary',    variants: ['Secondary', 'secondary'] },
        { name: 'Book',         variants: ['Book', 'book'] },
        { name: 'Special',      variants: ['Special', 'special'] },
        { name: 'Supply Pack',  variants: ['Supply Pack', 'supply pack', 'SupplyPack', 'supplypack'] },
        { name: 'Temporary',    variants: ['Temporary', 'temporary'] },
        { name: 'Enhancer',     variants: ['Enhancer', 'enhancer'] },
        { name: 'Artifact',     variants: ['Artifact', 'artifact'] },
        { name: 'Flower',       variants: ['Flower', 'flower'] },
        { name: 'Booster',      variants: ['Booster', 'booster'] },
        { name: 'Medical',      variants: ['Medical', 'medical'] },
        { name: 'Candy',        variants: ['Candy', 'candy'] },
        { name: 'Jewelry',      variants: ['Jewelry', 'jewelry'] },
        { name: 'Alcohol',      variants: ['Alcohol', 'alcohol', 'Alchohol', 'alchohol'] },
        { name: 'Plushie',      variants: ['Plushie', 'plushie'] },
        { name: 'Drug',         variants: ['Drug', 'drug'] },
        { name: 'Energy Drink', variants: ['Energy Drink', 'energy drink', 'EnergyDrink', 'energydrink'] }
    ];

    const HIGHLIGHT_COLORS = {
        red:    'rgba(220, 0, 0, 0.9)',
        yellow: 'rgba(220, 180, 0, 0.9)',
        green:  'rgba(0, 160, 0, 0.9)'
    };
    const TEXT_COLORS = { red: '#fff', yellow: '#000', green: '#fff' };
    const BORDER_COLORS = { red: '#ff2222', yellow: '#ffcc00', green: '#22cc22' };

    const CATEGORY_NAMES = CATEGORIES.map(c => c.name);

    // ===== Crime DB (Systoned v1.5, verbatim) =====
const CRIMES = {
  sfc:'Search for Cash', bl:'Bootlegging', grf:'Graffiti', sl:'Shoplifting',
  pp:'Pickpocketing', cs:'Card Skimming', bur:'Burglary', hus:'Hustling',
  dis:'Disposal', crk:'Cracking', for:'Forgery', scm:'Scamming', ars:'Arson',
  oc:'Organized Crime'
};
const ROLES = { req:'Required', enh:'Enhancer', use:'Consumed', tool:'Tool', unlock:'Unlocks',
  part:'Rig part', mat:'Material', out:'Forged item', ign:'Igniter',
  acc:'Accelerant', damp:'Dampener', oc:'OC item' };
const ROLE_ORDER = ['req','enh','tool','use','unlock','part','ign','acc','damp','mat','oc','out'];

const ITEM_USES = {
  'Glasses':'sfc.enh',
  'Metal Detector':'sfc.unlock@Beach',
  'Cemetery Key':'sfc.unlock@Cemetery',
  'Lost and Found Office Key':'sfc.unlock@Subway',
  'Bucket':'sfc.tool@Shore Thing:sand; for.mat@Collection Bucket:single use',
  'Blank DVD':'bl.use','High-Speed Drive':'bl.enh',
  'Spray Can':'grf.req:any colour',
  'Spray Can : White':'for.mat@License Plate:20 uses',
  'Spray Can : Black':'for.mat@License Plate:50 uses; oc@No Reserve',
  'Paint Mask':'grf.enh',
  'Ladder':'grf.tool:extra outcomes; oc@Window of Opportunity',
  'Wire Cutters':'grf.tool:extra outcomes; oc@Counter Offer, Dish It Out, Window of Opportunity',
  'Mountain Bike':'sl.enh','Torn City Times':'sl.tool:extra outcomes',
  'Cut-Throat Razor':'pp.enh; oc@Gone Fission',
  'Card Skimmer':'cs.req','Spy Camera':'cs.req','Duct Tape':'cs.enh',
  'Flashlight':'bur.enh:needed for Beach Hut and Lake House',
  'Jemmy':'bur.tool@Beach Hut, Lake House, Secluded Cabin; oc@Mob Mentality, Bidding War, Stacking the Deck',
  'Lockpicks':'bur.tool@Manor House; oc@First Aid and Abet, Pet Project, Thou Shalt Not Steal, Best of the Lot, Counter Offer',
  'Rope':'bur.tool@Mobile Home; dis.tool@Dead Bodies:sink',
  'Window Breaker':'bur.tool@Bungalow, Cottage, Farmhouse, Luxury Villa',
  'Skeleton Key':'bur.tool:recommended; for.out; for.tool@Skeleton Key:mould',
  'Credit Card':'bur.tool@Apartment; for.mat@ID Badge:single use',
  'Megaphone':'hus.enh','Latex Gloves':'dis.enh',
  'Shovel':'dis.tool:bury',
  'Gasoline':'dis.use:burn; ars.acc; oc@Market Forces',
  'Hydrochloric Acid':'dis.use:dissolve',
  'Disposable Mask':'dis.tool@Biological Waste',
  'Wheelbarrow':'dis.tool@Building Debris, Industrial Waste',
  'Handkerchief':'dis.tool@Firearms:abandon',
  'Double Cut File':'dis.tool@Firearms; for.tool@Skeleton Key, Police Badge, ATM Key',
  'Hammer':'for.tool@ATM Key',
  'Bleach':'dis.tool@Vehicles, Murder Weapons:abandon',
  'Paper Towels':'dis.tool@Vehicles, Murder Weapons:abandon',
  'Lye':'dis.use@Body Parts, Dead Bodies:bury',
  'Bone Saw':'dis.tool@Dead Bodies:dissolve; oc@Cleared for Takeoff',
  'Anchor':'dis.tool@Dead Bodies:sink','Brick':'dis.tool@Vehicles:sink',
  'Office Chair':'crk.enh',
  'CPU':'crk.part:MIPS','eCPU':'crk.part:MIPS','HPCPU':'crk.part:MIPS',
  'Computer Fan':'crk.part:cooling','Water Block':'crk.part:cooling','Heat Sink':'crk.part:cooling',
  'PSU':'crk.part:power; oc@Hostile Takeover',
  'Magnifying Glass':'for.enh',
  'Printer':"for.tool@Driver's License, Parking Permit, Concert Ticket, Collection Bucket, Diploma, Birth Certificate, Ordination Certificate, Prescription, Travel Visa, ID Badge, Medical License, Bank Check, Passport:everything except metalwork",
  'Scissors':'for.tool:about half of all projects',
  'Perforator':'for.tool@Concert Ticket, Bank Check',
  'Fountain Pen':'for.tool@Birth Certificate, Diploma, Prescription, Bank Check',
  'Typewriter':'for.tool@Birth Certificate, Prescription',
  'Wax Seal Stamp':'for.tool@Birth Certificate',
  'Embosser':'for.tool@License Plate, Travel Visa, Bank Check, Passport',
  'Lump of Coal':'for.tool@License Plate',
  'Permanent Marker':'for.tool@License Plate',
  'Hand Drill':'for.tool@Skeleton Key, Police Badge, ATM Key, License Plate:all metalworking; oc@Guardian Angels, Break the Bank, Cleared for Takeoff',
  'Hot Foil Stamper':'for.tool@Passport','Sewing Kit':'for.tool@Passport',
  'Scalpel':'for.tool@ID Badge','Card Programmer':'for.tool@ID Badge',
  'Graver':'for.tool@ID Badge, Police Badge, ATM Key',
  'Grinding Stone':'for.tool@Police Badge','Thimble':'for.tool@ATM Key',
  'Crucible':'for.tool@Skeleton Key, Police Badge, ATM Key',
  'Polishing Pad':'for.tool@Skeleton Key, Police Badge, ATM Key',
  'Sand':'for.tool@Skeleton Key, Police Badge, ATM Key:casting; ars.damp:skill 60',
  'Toner':"for.mat@Driver's License, Parking Permit, Concert Ticket, Collection Bucket, Diploma, Birth Certificate, Ordination Certificate, Prescription, Travel Visa, ID Badge, Medical License, Bank Check, Passport:100 prints",
  'Bond Paper':'for.mat@Diploma, Birth Certificate, License Plate, Ordination Certificate, Prescription, Travel Visa, Bank Check, Passport:100 sheets',
  'Adhesive Plastic':"for.mat@Driver's License, Parking Permit, Travel Visa, Passport:100 sheets",
  'PVC Cards':"for.mat@Driver's License, ID Badge:100 cards",
  'Cardstock':'for.mat@Parking Permit, Concert Ticket, Passport:100 sheets',
  'Inkwell':'for.mat@Birth Certificate, Diploma, Prescription, Bank Check:100 uses',
  'Glue':'for.mat@Diploma, ID Badge, Passport:5 uses',
  'Blowtorch':'for.mat@Police Badge, ATM Key:4 uses',
  'Crushed Enamel':'for.mat@Police Badge:25 uses',
  'Brass Ingot':'for.mat@Skeleton Key, Police Badge, ATM Key:single use',
  'Aluminum Plate':'for.mat@License Plate:single use',
  'Bank Statement':'for.mat@Bank Check:single use','Bonded Latex':'for.mat@Passport:single use',
  'Candle':'for.mat@Birth Certificate:single use','Certificate Seal':'for.mat@Diploma:single use',
  'Glow Stick':'for.mat@Travel Visa:single use','Lanyard':'for.mat@ID Badge:single use',
  'Medical Bill':'for.mat@Prescription:single use',
  'Picture Frame':'for.mat@Ordination Certificate',
  'Birthday Wrapping Paper':'for.mat@Medical License',
  "Driver's License":'for.out','Parking Permit':'for.out','Concert Ticket':'for.out',
  'Collection Bucket':'for.out','Diploma':'for.out','Birth Certificate':'for.out',
  'License Plate':'for.out','Ordination Certificate':'for.out','Prescription':'for.out',
  'Medical License':'for.out','Travel Visa':'for.out','Bank Check':'for.out','Passport':'for.out',
  'ID Badge':'for.out; oc@Cash Me If You Can, Gaslight the Way, Stacking the Deck, Ace in the Hole',
  'ATM Key':'for.out; oc@Cash Me If You Can',
  'Police Badge':'for.out; for.tool@Police Badge:mould; oc@Best of the Lot, Leave No Trace',
  'Ergonomic Keyboard':'scm.enh',
  'Windproof Lighter':'ars.enh','Lighter':'ars.ign',
  'Molotov Cocktail':'ars.ign:consumed, skill 30','Flamethrower':'ars.ign:skill 80',
  'Diesel':'ars.acc:skill 15','Kerosene':'ars.acc:skill 40',
  'Potassium Nitrate':'ars.acc:skill 10','Magnesium Shavings':'ars.acc:skill 20',
  'Thermite':'ars.acc:skill 50; oc@Dish It Out, Gone Fission',
  'Oxygen Tank':'ars.acc:skill 5','Methane Tank':'ars.acc:skill 25','Hydrogen Tank':'ars.acc:skill 70',
  'Blanket':'ars.damp','Fire Extinguisher':'ars.damp:skill 90',
  'Shaving Foam':'oc@First Aid and Abet','Net':'oc@Pet Project','Dog Treats':'oc@Pet Project',
  'Cassock':'oc@Thou Shalt Not Steal','Cell Phone':'oc@Thou Shalt Not Steal',
  'DSLR Camera':'oc@Smoke and Wing Mirrors, Gone Fission','RF Detector':'oc@Smoke and Wing Mirrors',
  'Construction Helmet':'oc@Gaslight the Way','PCP':'oc@Snow Blind',
  'Blank Casino Chips':'oc@Plucking the Lotus Petal','Binoculars':'oc@Stage Fright, Crane Reaction',
  'Billfold':'oc@Honey Trap',
  'Zip Ties':'oc@Counter Offer, Blast from the Past, Break the Bank, Manifest Cruelty, Gone Fission',
  'Polymorphic Virus':'oc@Counter Offer','Bolt Cutters':'oc@No Reserve, Dish It Out',
  'Chloroform':'oc@No Reserve, Clinical Precision',
  'C4 Explosive':'oc@Bidding War, Gone Fission','Flash Grenade':'oc@Bidding War',
  'Dental Mirror':'oc@Bidding War','Ipecac Syrup':'oc@Dish It Out',
  'Wireless Dongle':'oc@Sneaky Git Grab','Tunneling Virus':'oc@Sneaky Git Grab, Hostile Takeover',
  'Core Drill':'oc@Blast from the Past','Shaped Charge':'oc@Blast from the Past, Crane Reaction',
  'Firewalk Virus':'oc@Blast from the Past','Angle Grinder':'oc@Window of Opportunity',
  'Razor Wire':'oc@Window of Opportunity','Floor Cleaner':'oc@Window of Opportunity',
  'Large Suitcase':'oc@Cleared for Takeoff','Tracking Device':'oc@Cleared for Takeoff',
  'Blood Bag : Irradiated':'oc@Clinical Precision','Syringe':'oc@Clinical Precision',
  'Smoke Grenade':'oc@Stacking the Deck','Stealth Virus':'oc@Stacking the Deck, Manifest Cruelty',
  'Ecstasy':'oc@Lock Stock','Lubricant':'oc@Lock Stock','Armored Virus':'oc@Lock Stock',
  'Cigar Cutter':'oc@Manifest Cruelty','Car Battery':'oc@Manifest Cruelty',
  'Hard Drive':'oc@Hostile Takeover','Igniter Cord':'oc@Hostile Takeover',
  'Nail Bomb':'oc@Hostile Takeover','China Lake':'oc@Hostile Takeover',
  'Remote Detonator':'oc@Crane Reaction','Tear Gas':'oc@Crane Reaction'
};
const ALIASES = {
  'Pair of Glasses':'Glasses','Blank DVDs':'Blank DVD','High-Speed DVD Drive':'High-Speed Drive',
  'Spray Paint':'Spray Can','Wirecutters':'Wire Cutters','Gas Can':'Gasoline',
  'Bonesaw':'Bone Saw','Bricks':'Brick','Drill':'Hand Drill',
  'Drivers License':"Driver's License",'ECPU':'eCPU'
};

const nkey = s => String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const splitList = s => s.split(',').map(x=>x.trim()).filter(Boolean);
function parseSpec(spec){
  return spec.split(';').map(s=>s.trim()).filter(Boolean).map(s=>{
    let note='',subs=[];
    const ci=s.indexOf(':'); if(ci>=0){note=s.slice(ci+1).trim();s=s.slice(0,ci);}
    const ai=s.indexOf('@'); if(ai>=0){subs=splitList(s.slice(ai+1));s=s.slice(0,ai);}
    const [crime,roleRaw]=s.trim().split('.');
    const role=crime==='oc'?'oc':(roleRaw||'tool');
    return {crime,role,note,subs};
  });
}
const DB={}, DB_KEYS={}, ALIAS_KEYS={};
for(const [name,spec] of Object.entries(ITEM_USES)){DB[name]=parseSpec(spec);DB_KEYS[nkey(name)]=name;}
for(const [alias,name] of Object.entries(ALIASES)) ALIAS_KEYS[nkey(alias)]=name;
const BY_CRIME={};
for(const code of Object.keys(CRIMES)) BY_CRIME[code]={general:[],subs:{},outputs:[]};
for(const [item,uses] of Object.entries(DB)){
  for(const u of uses){
    const row={item,role:u.role,note:u.note};
    const b=BY_CRIME[u.crime]; if(!b) continue;
    if(u.role==='out'){b.outputs.push(row);continue;}
    if(!u.subs.length){b.general.push(row);continue;}
    for(const s of u.subs)(b.subs[s]=b.subs[s]||[]).push(row);
  }
}
const stripQty=s=>String(s).replace(/^\s*x\s*[\d,]+\s+/i,'').replace(/\s*x\s*[\d,]+\s*$/i,'').trim();
const baseName=s=>String(s).split(' : ')[0].trim();
const canonical=name=>{const k=nkey(name);return DB_KEYS[k]||ALIAS_KEYS[k]||null;};
function usesFor(rawName){
  const name=stripQty(rawName),out=[],seen=new Set();
  const add=c=>{if(c&&!seen.has(c)){seen.add(c);out.push(...DB[c]);}};
  add(canonical(name));
  const base=baseName(name);
  if(base!==name)add(canonical(base));
  return out;
}
function badgeFor(uses){
  const crimes=[...new Set(uses.filter(u=>u.crime!=='oc').map(u=>u.crime))];
  const hasOc=uses.some(u=>u.crime==='oc');
  const names=crimes.map(c=>CRIMES[c]); if(hasOc)names.push('OC');
  const kind=hasOc&&crimes.length?'both':hasOc?'oc':'crime';
  return {text:names.join(', '),kind};
}
function describeUses(uses){
  return uses.map(u=>{
    if(u.crime==='oc')return 'OC: '+u.subs.join(', ');
    let s=`${CRIMES[u.crime]}: ${ROLES[u.role]||u.role}`;
    if(u.subs.length)s+=' for '+u.subs.join(', ');
    if(u.note)s+=` (${u.note})`;
    return s;
  });
}


    // ===== HTML escape helper (module scope) =====
    function escHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    // ===== Crimes panel state (module scope so it persists across opens) =====
    let _crimeSel = null;
    let _crimeFilter = 'all';
    let _crimeMissingOnly = false;
    let _crimeSearch = '';

    // ===== Crimes panel functions (Systoned v1.5 logic, your theme) =====
    function crimeQtyByName() {
        const combined = getCombinedMap();
        const byName = new Map();
        combined.forEach(info => {
            const k = nkey(stripQty(info.name));
            byName.set(k, (byName.get(k) || 0) + info.amount);
            const base = nkey(baseName(info.name));
            if (base !== k) byName.set(base, (byName.get(base) || 0) + info.amount);
        });
        return byName;
    }
    function crimeQty(name, idx) {
        return idx.get(nkey(stripQty(name))) || 0;
    }
    function crimeState(name, idx) {
        return crimeQty(name, idx) > 0 ? 'owned' : 'missing';
    }
    function crimeItemId(name) {
        const combined = getCombinedMap();
        const k = nkey(stripQty(name));
        for (const info of combined.values()) {
            if (nkey(info.name) === k) return info.id;
            if (nkey(baseName(info.name)) === k) return info.id;
        }
        return null;
    }

    function openCrimesPanel() {
        if (document.getElementById('torn-inv-crimes-modal')) return;
        const overlay = buildOverlay('torn-inv-crimes-modal');
        const modal = document.createElement('div');
        modal.style.cssText = `
            background:#1e1e1e; border:1px solid #444; border-radius:8px;
            width:820px; max-width:94vw; height:84vh; display:flex; flex-direction:column;
            box-shadow:0 8px 30px rgba(0,0,0,0.7);
        `;
        modal.innerHTML = `
            <div style="padding:12px 16px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:#ff9900; font-size:14px;">🧩 Crime & OC Items</strong>
                <span id="torn-crime-close" style="cursor:pointer;color:#888;font-size:16px;">✕</span>
            </div>
            <div style="padding:8px 16px; background:#252525; border-bottom:1px solid #333; display:flex; gap:8px; align-items:center; font-size:12px;">
                <input id="torn-crime-search" type="text" placeholder="Search all crime items…"
                    style="flex:1;padding:5px 8px;background:#2a2a2a;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;">
                <label style="display:flex;align-items:center;gap:4px;color:#bbb;cursor:pointer;">
                    <input id="torn-crime-missing" type="checkbox" ${_crimeMissingOnly ? 'checked' : ''}> Missing only
                </label>
            </div>
            <div id="torn-crime-body" style="overflow-y:auto;padding:12px 16px;font-size:12px;flex:1;"></div>
        `;
        overlay.appendChild(modal);

        const searchEl = document.getElementById('torn-crime-search');
        const missingEl = document.getElementById('torn-crime-missing');
        if (searchEl) {
            searchEl.value = _crimeSearch;
            searchEl.addEventListener('input', (e) => {
                _crimeSearch = e.target.value;
                renderCrimes(modal);
            });
        }
        if (missingEl) {
            missingEl.addEventListener('change', (e) => {
                _crimeMissingOnly = e.target.checked;
                renderCrimes(modal);
            });
        }
        const closeEl = modal.querySelector('#torn-crime-close');
        if (closeEl) closeEl.onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        renderCrimes(modal);
    }

    function sortCrimeRows(rows, idx) {
        const SO = { missing: 0, unknown: 1, owned: 2 };
        return rows.slice().sort((a, b) =>
            (SO[crimeState(a.item, idx)] || 1) - (SO[crimeState(b.item, idx)] || 1) ||
            ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
            a.item.localeCompare(b.item));
    }

    function crimeCards(code) {
        const b = BY_CRIME[code], cards = [];
        if (!b) return cards;
        if (b.general.length) cards.push({ title: 'General', rows: b.general, general: true });
        for (const s of Object.keys(b.subs).sort((x, y) => x.localeCompare(y))) {
            const tools = b.subs[s].filter(r => r.role === 'tool');
            const mats  = b.subs[s].filter(r => r.role === 'mat');
            const rest  = b.subs[s].filter(r => r.role !== 'tool' && r.role !== 'mat');
            if (tools.length) cards.push({ title: s, rows: tools, type: 'tool' });
            if (mats.length)  cards.push({ title: s, rows: mats,  type: 'mat' });
            if (rest.length)  cards.push({ title: s, rows: rest,  type: 'other' });
        }
        if (b.outputs.length) cards.push({ title: 'Forged items you hold', rows: b.outputs, outputs: true, type: 'out' });
        return cards;
    }

    function crimeStatLine(code, idx) {
        const seen = new Set(); let miss = 0, tot = 0;
        for (const c of crimeCards(code)) {
            if (c.outputs) continue;
            for (const r of c.rows) {
                if (seen.has(r.item)) continue;
                seen.add(r.item); tot++;
                if (crimeState(r.item, idx) === 'missing') miss++;
            }
        }
        return { miss, tot };
    }

    function renderCrimes(modal) {
        const body = modal.querySelector('#torn-crime-body');
        if (!body) return;
        const idx = crimeQtyByName();
        const q = _crimeSearch.trim().toLowerCase();
        let html = '';

        if (q) {
            const names = Object.keys(DB).filter(n => n.toLowerCase().includes(q)).sort((a, b) => a.localeCompare(b));
            const rows = sortCrimeRows(names.map(n => ({
                item: n,
                role: (DB[n] && DB[n][0]) ? DB[n][0].role : 'tool',
                note: ''
            })), idx);
            html = rows.length
                ? `<div style="display:flex;flex-direction:column;gap:2px;">${rows.map(r => crimeRowHtml(r, idx, true)).join('')}</div>`
                : `<div style="padding:20px;color:#888;text-align:center;">No crime items match "${escHtml(_crimeSearch)}"</div>`;
            body.innerHTML = html;
            return;
        }

        if (!_crimeSel) {
            const cards = Object.keys(CRIMES).map(code => {
                const s = crimeStatLine(code, idx);
                const badge = s.miss
                    ? `<span style="position:absolute;top:6px;right:6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#7a3a3a;color:#fff;font-size:10px;font-weight:bold;display:flex;align-items:center;justify-content:center;">${s.miss}</span>`
                    : `<span style="position:absolute;top:6px;right:6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#3c5a3c;color:#fff;font-size:10px;font-weight:bold;display:flex;align-items:center;justify-content:center;">✓</span>`;
                return `<div class="torn-crime-tile" data-code="${code}" style="position:relative;border:1px solid #333;border-radius:6px;background:#242424;padding:16px 6px 12px;text-align:center;cursor:pointer;color:#b5b5b5;display:flex;flex-direction:column;align-items:center;gap:8px;font-size:11px;transition:background .15s,border-color .15s;">
                    ${badge}<span style="font-size:20px;">🧩</span><span>${escHtml(CRIMES[code])}</span></div>`;
            }).join('');
            html = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">${cards}</div>`;
        } else {
            const s = crimeStatLine(_crimeSel, idx);
            let cards = crimeCards(_crimeSel);
            if (_crimeFilter === 'tool') cards = cards.filter(c => c.type === 'tool');
            if (_crimeFilter === 'mat')  cards = cards.filter(c => c.type === 'mat');
            const cardsHtml = cards.map(c => crimeCardHtml(c, idx)).filter(Boolean).join('');
            html = `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                    <button class="torn-crime-back" style="background:#2c2c2c;color:#d8d8d8;border:1px solid #3c3c3c;border-radius:4px;padding:4px 10px;cursor:pointer;">← All crimes</button>
                    <strong style="color:#ff9900;">${escHtml(CRIMES[_crimeSel] || '')}</strong>
                    <span style="margin-left:auto;color:#888;font-size:11px;">${s.miss ? s.miss + ' of ' + s.tot + ' missing' : s.tot + ' items, none missing'}</span>
                </div>
                <div style="display:flex;gap:8px;margin-bottom:14px;">
                    ${[['all', 'All'], ['tool', 'Tools'], ['mat', 'Materials']].map(([v, l]) =>
                        `<button class="torn-crime-filter" data-v="${v}" style="background:${_crimeFilter === v ? '#3a3a3a' : '#262626'};color:${_crimeFilter === v ? '#fff' : '#9a9a9a'};border:1px solid #3c3c3c;border-radius:4px;padding:5px 12px;cursor:pointer;font-size:11px;">${l}</button>`
                    ).join('')}
                </div>
                ${cardsHtml || `<div style="padding:20px;color:#888;text-align:center;">Nothing missing for ${escHtml(CRIMES[_crimeSel] || '')}</div>`}`;
        }
        body.innerHTML = html;

        body.querySelectorAll('.torn-crime-tile').forEach(t => {
            t.onclick = () => { _crimeSel = t.dataset.code; _crimeFilter = 'all'; renderCrimes(modal); };
            t.onmouseenter = () => { t.style.background = '#2c2c2c'; t.style.borderColor = '#ff9900'; };
            t.onmouseleave = () => { t.style.background = '#242424'; t.style.borderColor = '#333'; };
        });
        const back = body.querySelector('.torn-crime-back');
        if (back) back.onclick = () => { _crimeSel = null; _crimeFilter = 'all'; renderCrimes(modal); };
        body.querySelectorAll('.torn-crime-filter').forEach(b => {
            b.onclick = () => { _crimeFilter = b.dataset.v; renderCrimes(modal); };
        });
    }

    function crimeRowHtml(r, idx, showCrime) {
        const qty = crimeQty(r.item, idx);
        const dot = qty > 0 ? '#7fae7f' : '#c96b6b';
        const meta = showCrime
            ? describeUses(DB[r.item]).join(' · ')
            : [ROLES[r.role] || r.role, r.note].filter(Boolean).join(', ');
        const id = crimeItemId(r.item);
        const basket = id
            ? `<a href="https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${id}" target="_blank" rel="noopener" title="Open on Item Market" style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:24px;border-radius:4px;color:#d0d0d0;background:#2e2e2e;border:1px solid #444;text-decoration:none;">🛒</a>`
            : `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:24px;border-radius:4px;color:#555;background:#202020;border:1px solid #2e2e2e;">🛒</span>`;
        return `<div style="display:grid;grid-template-columns:8px 1fr auto 26px;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid #262626;">
            <span style="width:7px;height:7px;border-radius:50%;background:${dot};"></span>
            <span><span style="color:#e0e0e0;">${escHtml(r.item)}</span>${meta ? `<span style="display:block;color:#7f7f7f;font-size:10.5px;margin-top:2px;">${escHtml(meta)}</span>` : ''}</span>
            <span style="font-weight:bold;min-width:26px;text-align:right;color:${qty > 0 ? '#93b893' : '#d98b8b'};">${qty ? qty : ''}</span>
            ${basket}
        </div>`;
    }

    function crimeCardHtml(card, idx) {
        const rows = sortCrimeRows(card.rows, idx);
        const missing = card.outputs ? 0 : rows.filter(r => crimeState(r.item, idx) === 'missing').length;
        const shown = _crimeMissingOnly ? rows.filter(r => crimeState(r.item, idx) !== 'owned') : rows;
        if (!shown.length) return '';
        let stHtml;
        if (card.outputs) {
            stHtml = `<span style="color:#9a9a9a;font-size:11px;">${rows.filter(r => crimeState(r.item, idx) === 'owned').length}/${rows.length} held</span>`;
        } else if (missing) {
            stHtml = `<span style="color:#e09a9a;font-size:11px;">${missing} missing</span>`;
        } else {
            stHtml = `<span style="color:#93b893;font-size:11px;">complete</span>`;
        }
        const isOpen = (missing > 0 || _crimeMissingOnly) ? 'open' : '';
        return `<details ${isOpen} style="background:#161616;border:1px solid #383838;border-radius:6px;margin-bottom:10px;overflow:hidden;">
            <summary style="list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:9px 12px;color:#f0f0f0;font-weight:bold;font-size:12.5px;background:#2b2b2b;border-bottom:1px solid #383838;">
                <span style="flex:1;">${escHtml(card.title)}${card.general ? '<span style="display:block;font-weight:normal;font-size:10.5px;color:#8a8a8a;margin-top:1px;">applies to every sub-crime</span>' : ''}</span>
                ${stHtml}<span style="color:#777;font-size:10px;">▼</span>
            </summary>
            ${shown.map(r => crimeRowHtml(r, idx)).join('')}
        </details>`;
    }


    const getApiKey = () => GM_getValue(API_KEY_STORAGE, '');
    const setApiKey = (k) => GM_setValue(API_KEY_STORAGE, k.trim());

    function appendToBody(el) {
        const target = document.body || document.documentElement;
        target.appendChild(el);
    }

    function promptForApiKey() {
        const cur = getApiKey();
        const masked = cur ? cur.substring(0, 4) + '…' + cur.slice(-4) : '(none set)';
        const input = prompt(`Enter your Torn API key.\n\nCurrent: ${masked}\n\nUse a READ-ONLY key with only "User Inventory" access.`, '');
        if (input === null) return;
        if (!input.trim()) return alert('Empty input — key unchanged.');
        setApiKey(input);
        alert('✅ API key saved.');
        updateStatus('🔑 API key updated', '#44ff44');
    }

    function normalizeTh(obj, fallback) {
        const f = fallback || DEFAULT_THRESHOLD;
        return {
            red:    Number.isFinite(obj && obj.red)    ? obj.red    : f.red,
            yellow: Number.isFinite(obj && obj.yellow) ? obj.yellow : f.yellow,
            green:  Number.isFinite(obj && obj.green)  ? obj.green  : f.green
        };
    }
    function loadItemThresholds() {
        try { const r = GM_getValue(THRESHOLDS_STORAGE, null); return r ? JSON.parse(r) : {}; }
        catch (e) { return {}; }
    }
    const saveItemThresholds = (o) => GM_setValue(THRESHOLDS_STORAGE, JSON.stringify(o));

    function loadDefaultThreshold() {
        try {
            const r = GM_getValue(DEFAULT_THRESHOLD_STORAGE, null);
            return r ? normalizeTh(JSON.parse(r)) : { ...DEFAULT_THRESHOLD };
        } catch (e) { return { ...DEFAULT_THRESHOLD }; }
    }
    const saveDefaultThreshold = (o) => GM_setValue(DEFAULT_THRESHOLD_STORAGE, JSON.stringify(normalizeTh(o)));

    function loadPriceTargets() {
        try { const r = GM_getValue(PRICE_TARGETS_STORAGE, null); return r ? JSON.parse(r) : {}; }
        catch (e) { return {}; }
    }
    const savePriceTargets = (o) => GM_setValue(PRICE_TARGETS_STORAGE, JSON.stringify(o));

    function loadWatchlist() {
        try { const r = GM_getValue(WATCHLIST_STORAGE, null); return r ? JSON.parse(r) : []; }
        catch (e) { return []; }
    }
    const saveWatchlist = (o) => GM_setValue(WATCHLIST_STORAGE, JSON.stringify(o));

    function classifyAmount(owned, th) {
        if (owned >= th.green)  return 'green';
        if (owned >= th.yellow) return 'yellow';
        return 'red';
    }
    function thresholdsForItem(id) {
        const per = loadItemThresholds();
        const def = loadDefaultThreshold();
        return per[id] ? normalizeTh(per[id], def) : def;
    }

    function buildOverlay(id) {
        document.querySelectorAll('#' + id).forEach(el => el.remove());
        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.background = 'rgba(0,0,0,0.75)';
        overlay.style.zIndex = '2147483647';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.fontFamily = 'Arial, sans-serif';
        overlay.style.color = '#eee';
        appendToBody(overlay);
        return overlay;
    }

    function getSavedPanelPos() {
        try { const r = GM_getValue(PANEL_POS_STORAGE, null); return r ? JSON.parse(r) : { right: 20, bottom: 20 }; }
        catch (e) { return { right: 20, bottom: 20 }; }
    }
    function savePanelPos(p) { GM_setValue(PANEL_POS_STORAGE, JSON.stringify(p)); }

    function isPanelHidden() {
        return GM_getValue(PANEL_HIDDEN_STORAGE, false) === true;
    }

    function showPanel() {
        GM_setValue(PANEL_HIDDEN_STORAGE, false);
        GM_setValue(PANEL_COLLAPSED_STORAGE, false);
        const old = document.getElementById('torn-inv-panel');
        if (old) old.remove();
        try {
            createControlPanel();
        } catch (e) {
            console.error('[Torn Inv] showPanel error:', e);
            alert('Failed to show panel: ' + e.message);
        }
    }

    function hidePanel() {
        GM_setValue(PANEL_HIDDEN_STORAGE, true);
        const p = document.getElementById('torn-inv-panel');
        if (p) p.remove();
    }

    function createControlPanel() {
        const old = document.getElementById('torn-inv-panel');
        if (old) old.remove();

        if (isPanelHidden()) { console.log('[Torn Inv] Panel is hidden — skipping render'); return; }

        const pos = getSavedPanelPos();
        const collapsed = GM_getValue(PANEL_COLLAPSED_STORAGE, false);

        const panel = document.createElement('div');
        panel.id = 'torn-inv-panel';

        if (collapsed) {
            panel.style.cssText = `
                position: fixed;
                left: 8px; top: 50%;
                transform: translateY(-50%);
                z-index: 2147483000; background: #ff9900; border: 1px solid #444;
                border-radius: 8px; width: 42px; height: 42px;
                display: flex; align-items: center; justify-content: center;
                font-family: Arial, sans-serif; font-size: 22px;
                color: #000; cursor: pointer; user-select: none;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            `;
            panel.textContent = '📦';
            panel.title = 'Click to expand Inventory Tracker';
            panel.addEventListener('click', () => {
                GM_setValue(PANEL_COLLAPSED_STORAGE, false);
                createControlPanel();
            });
            appendToBody(panel);
        } else {
            panel.style.cssText = `
                position: fixed;
                right: ${pos.right}px; bottom: ${pos.bottom}px;
                z-index: 2147483000; background: #2a2a2a; border: 1px solid #444;
                border-radius: 8px; padding: 10px;
                font-family: Arial, sans-serif; font-size: 12px; color: #eee;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5); width: 280px; user-select: none;
            `;
            panel.innerHTML = `
                <div id="torn-inv-header" style="font-weight:bold;margin-bottom:8px;color:#ff9900;display:flex;justify-content:space-between;align-items:center;cursor:move;padding-bottom:4px;border-bottom:1px solid #444;">
                    <span>📦 Inventory Tracker</span>
                    <span style="display:flex;gap:6px;">
                        <span id="torn-inv-collapse" style="cursor:pointer;color:#aaa;" title="Minimize (pins to left)">▼</span>
                        <span id="torn-inv-close" style="cursor:pointer;color:#888;" title="Hide (reopen via Tampermonkey menu)">✕</span>
                    </span>
                </div>
                <div id="torn-inv-body">
                    <div id="torn-inv-status" style="margin-bottom:8px;color:#aaa;">Ready</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button id="torn-inv-refresh"  style="flex:1;padding:6px 10px;background:#ff9900;border:none;border-radius:4px;color:#000;font-weight:bold;cursor:pointer;font-size:11px;">🔄 Inventory</button>
                        <button id="torn-inv-dc"       style="flex:1;padding:6px 10px;background:#8a5a00;border:none;border-radius:4px;color:#fff;font-weight:bold;cursor:pointer;font-size:11px;">🏛️ Display Case</button>
                        <button id="torn-inv-items"    style="flex:1;padding:6px 10px;background:#444;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:11px;">📋 Items</button>
                        <button id="torn-inv-watch"    style="flex:1;padding:6px 10px;background:#444;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:11px;">⭐ Watchlist</button>
                        <button id="torn-inv-key"      style="flex:1;padding:6px 10px;background:#444;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:11px;">🔑 Key</button>
                        <button id="torn-inv-settings" style="flex:1;padding:6px 10px;background:#444;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:11px;">⚙️ Settings</button>
                        <button id="torn-inv-crimes"   style="flex:1;padding:6px 10px;background:#5a3a00;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:11px;">🧩 Crimes</button>
                        <button id="torn-inv-clear"    style="flex:1;padding:6px 10px;background:#662222;border:none;border-radius:4px;color:#fff;cursor:pointer;font-size:11px;">🗑️ Clear</button>
                    </div>
                </div>
            `;

            appendToBody(panel);

            const closeEl = document.getElementById('torn-inv-close');
            const collapseEl = document.getElementById('torn-inv-collapse');
            const refreshEl = document.getElementById('torn-inv-refresh');
            const dcEl = document.getElementById('torn-inv-dc');
            const itemsEl = document.getElementById('torn-inv-items');
            const watchEl = document.getElementById('torn-inv-watch');
            const keyEl = document.getElementById('torn-inv-key');
            const settingsEl = document.getElementById('torn-inv-settings');
            const clearEl = document.getElementById('torn-inv-clear');
            const crimesEl = document.getElementById('torn-inv-crimes');
            const headerEl = document.getElementById('torn-inv-header');

            if (closeEl) closeEl.onclick = (e) => { e.stopPropagation(); hidePanel(); };
            if (collapseEl) collapseEl.onclick = (e) => {
                e.stopPropagation();
                GM_setValue(PANEL_COLLAPSED_STORAGE, true);
                createControlPanel();
            };
            if (refreshEl) refreshEl.onclick = refreshInventory;
            if (dcEl) dcEl.onclick = pullDisplayCase;
            if (itemsEl) itemsEl.onclick = openItemsPanel;
            if (watchEl) watchEl.onclick = openWatchlistPanel;
            if (keyEl) keyEl.onclick = promptForApiKey;
            if (settingsEl) settingsEl.onclick = openSettingsPanel;
            if (crimesEl) crimesEl.onclick = openCrimesPanel;
            if (clearEl) clearEl.onclick = clearInventoryList;

            if (headerEl) makeDraggable(panel, headerEl);
        }

        console.log('[Torn Inv] Panel rendered (collapsed:', collapsed, ')');
    }

    let _dragState = null; // { panel, sx, sy, sr, sb }
    let _dragDocListenersAdded = false;

    function ensureDragDocListeners() {
        if (_dragDocListenersAdded) return;
        _dragDocListenersAdded = true;
        document.addEventListener('mousemove', (e) => {
            if (!_dragState) return;
            const { panel, sx, sy, sr, sb } = _dragState;
            const dx = e.clientX - sx, dy = e.clientY - sy;
            const r = panel.getBoundingClientRect();
            const nr = Math.max(8, Math.min(sr - dx, window.innerWidth - r.width - 8));
            const nb = Math.max(8, Math.min(sb - dy, window.innerHeight - r.height - 8));
            panel.style.right = nr + 'px';
            panel.style.bottom = nb + 'px';
            panel.style.left = 'auto';
            panel.style.top = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (!_dragState) return;
            const { panel } = _dragState;
            _dragState = null;
            document.documentElement.style.userSelect = '';
            const r = panel.getBoundingClientRect();
            savePanelPos({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom });
        });
    }

    function makeDraggable(panel, handle) {
        handle.addEventListener('mousedown', (e) => {
            if (e.target.id === 'torn-inv-collapse' || e.target.id === 'torn-inv-close') return;
            const r = panel.getBoundingClientRect();
            _dragState = {
                panel,
                sx: e.clientX,
                sy: e.clientY,
                sr: window.innerWidth - r.right,
                sb: window.innerHeight - r.bottom
            };
            document.documentElement.style.userSelect = 'none';
            e.preventDefault();
        });
        ensureDragDocListeners();
    }

    function updateStatus(msg, color = '#aaa') {
        const el = document.getElementById('torn-inv-status');
        if (el) { el.textContent = msg; el.style.color = color; }
    }

    let isRefreshing = false, lastRefreshTime = 0;
    let isDcRefreshing = false, lastDcRefreshTime = 0;

    function fetchCategory(categoryString, offset = 0) {
        return new Promise((resolve, reject) => {
            const key = getApiKey();
            if (!key) return reject(new Error('No API key set.'));
            const catParam = categoryString ? `cat=${encodeURIComponent(categoryString)}&` : '';
            const url = `${API_BASE}/user/inventory?${catParam}offset=${offset}&limit=100&key=${key}`;
            GM_xmlhttpRequest({
                method: 'GET', url, headers: { accept: 'application/json' },
                onload: (res) => {
                    if (res.status === 200) {
                        try { resolve(JSON.parse(res.responseText)); }
                        catch (e) { reject(new Error('Bad JSON: ' + e.message)); }
                    } else if (res.status === 429) reject(new Error('Rate limited.'));
                    else if (res.status === 401 || res.status === 403) reject(new Error('Invalid key.'));
                    else reject(new Error('HTTP ' + res.status));
                },
                onerror: (e) => reject(new Error('Network: ' + e.message))
            });
        });
    }

    async function fetchCategoryWithVariants(categoryObj) {
        for (const variant of categoryObj.variants) {
            try {
                const data = await fetchCategory(variant, 0);
                const items = (data.inventory && data.inventory.items) || [];
                if (items.length > 0) {
                    console.log(`[Torn Inv] ${categoryObj.name} → matched variant "${variant}" with ${items.length} items`);
                    return { data, items, usedVariant: variant, attempts: categoryObj.variants.indexOf(variant) + 1 };
                }
            } catch (e) {
                console.log(`[Torn Inv] ${categoryObj.name} variant "${variant}" failed: ${e.message}`);
            }
        }
        return { data: null, items: [], usedVariant: categoryObj.variants[0], attempts: categoryObj.variants.length };
    }

    /**
     * Fetch the user's display case via the Torn v2 API (`/user/display`).
     * Returns a normalized array of { id, name, amount } so the rest of the
     * snapshot pipeline can consume it unchanged. Handles several known
     * response shapes the API has shipped over time.
     */
    function fetchDisplayCaseFromAPI() {
        return new Promise((resolve, reject) => {
            const key = getApiKey();
            if (!key) return reject(new Error('No API key set.'));
            const url = `${API_BASE}/user/display?key=${key}`;
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: { accept: 'application/json' },
                onload: (res) => {
                    if (res.status === 200) {
                        let data;
                        try { data = JSON.parse(res.responseText); }
                        catch (e) { return reject(new Error('Bad JSON: ' + e.message)); }

                        // API-level error block (e.g. { error: { code, error } })
                        if (data && data.error) {
                            const msg = (data.error.error || data.error.message || 'API error');
                            return reject(new Error(msg));
                        }

                        // The display endpoint returns items in any of these
                        // shapes — be tolerant so we keep working if Torn tweaks it.
                        let rawItems = null;
                        if (data && Array.isArray(data.display)) rawItems = data.display;
                        else if (data && data.display && Array.isArray(data.display.items)) rawItems = data.display.items;
                        else if (data && Array.isArray(data.items)) rawItems = data.items;
                        else if (data && data.displayCase && Array.isArray(data.displayCase.items)) rawItems = data.displayCase.items;

                        if (!Array.isArray(rawItems)) {
                            return reject(new Error('Unexpected /user/display response shape'));
                        }

                        const out = [];
                        const seen = new Map(); // id -> index in out (for quantity aggregation)
                        for (const it of rawItems) {
                            if (!it || it.id == null) continue;
                            const id = Number(it.id);
                            if (!Number.isFinite(id)) continue;
                            // Field name for quantity has varied: quantity / qty / amount / count
                            const amount = Number(it.quantity != null ? it.quantity :
                                                  it.qty     != null ? it.qty :
                                                  it.amount  != null ? it.amount :
                                                  it.count   != null ? it.count : 1) || 1;
                            const name = (it.name || it.itemName || `Item #${id}`).toString();
                            const existing = seen.get(id);
                            if (existing != null) {
                                out[existing].amount += amount;
                            } else {
                                seen.set(id, out.length);
                                out.push({ id, name, amount });
                            }
                        }
                        resolve(out);
                    } else if (res.status === 429) reject(new Error('Rate limited.'));
                    else if (res.status === 401 || res.status === 403) reject(new Error('Invalid key.'));
                    else reject(new Error('HTTP ' + res.status));
                },
                onerror: (e) => reject(new Error('Network: ' + (e && e.message ? e.message : 'unknown'))),
                ontimeout: () => reject(new Error('Request timed out.'))
            });
        });
    }

    function scrapeDisplayCaseFromPage() {
        const items = [];
        const seen = new Set();

        const containers = [];
        const selectors = [
            '.display-cabinet',
            '.display-case',
            '[class*="displayCase"]',
            '[class*="display-case"]',
            '[class*="displaycase"]',
            '[class*="cabinet"]'
        ];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                if (!containers.includes(el)) containers.push(el);
            });
        });

        if (containers.length === 0) {
            const bodyHasHover = document.querySelector('.item-hover[itemId]');
            if (bodyHasHover) containers.push(document.body);
        }

        console.log('[Torn Inv] Display case containers found:', containers.length);
        if (containers.length === 0) return items;

        containers.forEach(container => {
            const hovers = container.querySelectorAll('[itemId]');
            console.log('[Torn Inv] Found', hovers.length, 'elements with itemId in container');

            hovers.forEach(hover => {
                const id = hover.getAttribute('itemId');
                if (!id) return;

                const li = hover.closest('li') || hover.closest('[class*="item"]') || hover.parentElement;
                if (!li) return;

                let amount = 1;
                const amountSelectors = [
                    '.b-item-amount',
                    '[class*="amount"]',
                    '[class*="qty"]',
                    '[class*="quantity"]'
                ];
                for (const sel of amountSelectors) {
                    const amountField = li.querySelector(sel);
                    if (amountField) {
                        const txt = amountField.textContent.trim().replace(/^x/i, '').replace(/[^0-9]/g, '');
                        const parsed = parseInt(txt, 10);
                        if (Number.isFinite(parsed) && parsed > 0) {
                            amount = parsed;
                            break;
                        }
                    }
                }

                const nameEl = li.querySelector('.name, .item-name, [class*="name"]');
                const name = nameEl ? nameEl.textContent.trim() : (hover.getAttribute('aria-label') || `Item #${id}`);

                const numId = Number(id);
                if (seen.has(numId)) {
                    const existing = items.find(x => x.id === numId);
                    if (existing) existing.amount += amount;
                } else {
                    seen.add(numId);
                    items.push({ id: numId, name, amount });
                }
            });
        });

        return items;
    }

    async function fetchInventoryOnly() {
        const itemMap = new Map();
        let requestCount = 0;
        const perCategoryCounts = {};
        const perCategoryErrors = {};
        const perCategoryVariant = {};

        const addItem = (it, categoryName) => {
            const id = it.id;
            const existing = itemMap.get(id);
            if (existing) {
                existing.amount += it.amount;
                if (!existing.category && categoryName) existing.category = categoryName;
            } else {
                itemMap.set(id, {
                    id: it.id,
                    name: it.name,
                    amount: it.amount,
                    equipped: it.equipped || false,
                    category: categoryName || it.category || 'Other'
                });
            }
        };

        for (let i = 0; i < CATEGORIES.length; i++) {
            const category = CATEGORIES[i];
            let more = true;
            let offset = 0;
            let catCount = 0;

            while (more) {
                try {
                    let data, items, usedVariant, attempts;
                    if (offset === 0) {
                        const res = await fetchCategoryWithVariants(category);
                        data = res.data;
                        items = res.items;
                        usedVariant = res.usedVariant;
                        attempts = res.attempts;
                        requestCount += attempts;
                        perCategoryVariant[category.name] = usedVariant;
                    } else {
                        data = await fetchCategory(perCategoryVariant[category.name], offset);
                        items = (data.inventory && data.inventory.items) || [];
                        requestCount++;
                    }

                    if (!data) { more = false; break; }

                    updateStatus(`Fetching ${category.name}… (${itemMap.size} items)`, '#ff9900');
                    items.forEach(it => addItem(it, category.name));
                    catCount += items.length;

                    if (data._metadata && data._metadata.links && data._metadata.links.next) {
                        offset += 100; await new Promise(r => setTimeout(r, 300));
                    } else more = false;
                } catch (e) {
                    perCategoryErrors[category.name] = e.message;
                    updateStatus(`⚠️ ${category.name}: ${e.message}`, '#ffaa00');
                    more = false;
                    await new Promise(r => setTimeout(r, 500));
                }
            }

            perCategoryCounts[category.name] = catCount;
            if (i < CATEGORIES.length - 1) await new Promise(r => setTimeout(r, 300));
        }

        if ((perCategoryCounts['Tools'] || 0) === 0) {
            console.log('[Torn Inv] Tools empty — running no-cat fallback sweep');
            updateStatus('🔄 Fallback sweep…', '#ff9900');
            try {
                let offset = 0, more = true;
                while (more) {
                    const data = await fetchCategory('', offset);
                    requestCount++;
                    const items = (data.inventory && data.inventory.items) || [];
                    items.forEach(it => addItem(it, it.category || 'Other'));
                    if (data._metadata && data._metadata.links && data._metadata.links.next) {
                        offset += 100; await new Promise(r => setTimeout(r, 300));
                    } else more = false;
                }
            } catch (e) {
                console.log('[Torn Inv] Fallback sweep failed:', e.message);
            }
        }

        console.log('[Torn Inv] Per-category counts:', perCategoryCounts);
        return { items: Array.from(itemMap.values()), requestCount, perCategoryCounts, perCategoryErrors };
    }

    function saveInventorySnapshot(items) {
        GM_deleteValue(INV_STORAGE_KEY);
        const snap = { timestamp: Date.now(), itemMap: {} };
        items.forEach(it => {
            snap.itemMap[it.id] = { name: it.name, amount: it.amount, category: it.category };
        });
        GM_setValue(INV_STORAGE_KEY, JSON.stringify(snap));
        return snap;
    }

    function saveDisplayCaseSnapshot(items) {
        GM_deleteValue(DC_STORAGE_KEY);
        const snap = { timestamp: Date.now(), itemMap: {} };
        items.forEach(it => {
            snap.itemMap[it.id] = { name: it.name, amount: it.amount };
        });
        GM_setValue(DC_STORAGE_KEY, JSON.stringify(snap));
        return snap;
    }

    function loadInventorySnapshot() {
        try { const s = GM_getValue(INV_STORAGE_KEY, null); return s ? JSON.parse(s) : null; }
        catch (e) { return null; }
    }
    function loadDisplayCaseSnapshot() {
        try { const s = GM_getValue(DC_STORAGE_KEY, null); return s ? JSON.parse(s) : null; }
        catch (e) { return null; }
    }

    function getCombinedMap() {
        const inv = loadInventorySnapshot();
        const dc = loadDisplayCaseSnapshot();
        const combined = new Map();

        const processSnap = (snap, sourceLabel) => {
            if (!snap || !snap.itemMap) return;
            Object.entries(snap.itemMap).forEach(([id, info]) => {
                const numId = Number(id);
                const existing = combined.get(numId);
                if (existing) {
                    existing.amount += info.amount;
                    if (sourceLabel === 'dc') existing.dcAmount += info.amount;
                    else existing.invAmount += info.amount;
                } else {
                    combined.set(numId, {
                        id: numId,
                        name: info.name,
                        amount: info.amount,
                        category: info.category || (sourceLabel === 'dc' ? 'Display Case' : 'Other'),
                        invAmount: sourceLabel === 'inv' ? info.amount : 0,
                        dcAmount:  sourceLabel === 'dc'  ? info.amount : 0
                    });
                }
            });
        };

        processSnap(inv, 'inv');
        processSnap(dc, 'dc');
        return combined;
    }

    async function refreshInventory() {
        if (isRefreshing) return updateStatus('⏳ Refresh already running…', '#ffaa00');
        const elapsed = Date.now() - lastRefreshTime;
        if (elapsed < REFRESH_COOLDOWN_MS) {
            const s = Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000);
            return updateStatus(`⏳ Cooldown: ${s}s remaining`, '#ffaa00');
        }
        if (!getApiKey()) return updateStatus('❌ No API key.', '#ff4444');

        isRefreshing = true;
        updateStatus('🔄 Fetching inventory…', '#ff9900');

        try {
            const { items, requestCount } = await fetchInventoryOnly();
            if (!items) throw new Error('API returned no data — old data preserved');
            if (items.length === 0) {
                saveInventorySnapshot(items);
                lastRefreshTime = Date.now();
                updateStatus('⚠️ Inventory empty (0 items) — saved anyway', '#ffaa00');
                clearHighlights();
                highlightMarketplaceItems();
                return;
            }
            saveInventorySnapshot(items);
            lastRefreshTime = Date.now();

            const invSnap = loadInventorySnapshot();
            const dcSnap  = loadDisplayCaseSnapshot();
            const invCount = invSnap ? Object.keys(invSnap.itemMap).length : 0;
            const dcCount  = dcSnap  ? Object.keys(dcSnap.itemMap).length  : 0;

            updateStatus(`✅ Inv: ${invCount} · DC: ${dcCount} (${requestCount} calls)`, '#44ff44');
            clearHighlights();
            highlightMarketplaceItems();
        } catch (e) {
            console.error('[Torn Inv] Inventory refresh failed:', e);
            updateStatus(`❌ ${e.message}`, '#ff4444');
        } finally {
            isRefreshing = false;
        }
    }

    async function pullDisplayCase() {
        // Guard against double-clicks / spamming the API.
        if (isDcRefreshing) {
            return updateStatus('⏳ Display case fetch already running…', '#ffaa00');
        }
        const elapsed = Date.now() - lastDcRefreshTime;
        if (elapsed < REFRESH_COOLDOWN_MS) {
            const s = Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000);
            return updateStatus(`⏳ Cooldown: ${s}s remaining`, '#ffaa00');
        }
        if (!getApiKey()) {
            updateStatus('❌ No API key.', '#ff4444');
            alert('No Torn API key set.\n\nClick 🔑 Key in the panel to add one (a READ-ONLY key with at least "User Display" access).');
            return;
        }

        isDcRefreshing = true;
        updateStatus('🏛️ Fetching display case via API…', '#ff9900');

        let dcItems = [];
        let usedFallback = false;
        try {
            dcItems = await fetchDisplayCaseFromAPI();
            if (!dcItems.length) {
                updateStatus('⚠️ Display case is empty', '#ffaa00');
                // Still save the empty snapshot so the user knows it was pulled.
                saveDisplayCaseSnapshot([]);
                lastDcRefreshTime = Date.now();
                clearHighlights();
                highlightMarketplaceItems();
                return;
            }
        } catch (e) {
            console.warn('[Torn Inv] Display case API fetch failed:', e.message);
            // Fall back to page scraping ONLY if the user is on displaycase.php.
            if (/displaycase\.php/i.test(window.location.href)) {
                updateStatus('⚠️ API failed — falling back to page scrape…', '#ffaa00');
                try {
                    dcItems = scrapeDisplayCaseFromPage();
                    usedFallback = true;
                } catch (scrapeErr) {
                    console.error('[Torn Inv] Page scrape also failed:', scrapeErr);
                    updateStatus(`❌ ${e.message} (fallback failed: ${scrapeErr.message})`, '#ff4444');
                    alert(`Could not fetch the display case via API:\n  ${e.message}\n\n` +
                          `A page-scrape fallback also failed:\n  ${scrapeErr.message}\n\n` +
                          `Check that your API key has "User Display" access, or navigate to ` +
                          `https://www.torn.com/displaycase.php and try again.`);
                    return;
                }
                if (!dcItems.length) {
                    updateStatus('⚠️ API failed and page scrape found nothing', '#ffaa00');
                    alert(`Could not fetch the display case via API:\n  ${e.message}\n\n` +
                          `The page scrape also found no items. Make sure you are actually on ` +
                          `your display case page (displaycase.php) and that it is loaded.`);
                    return;
                }
            } else {
                updateStatus(`❌ API failed: ${e.message}`, '#ff4444');
                alert(`Could not fetch the display case via API:\n  ${e.message}\n\n` +
                      `Make sure your API key has "User Display" access.`);
                return;
            }
        } finally {
            isDcRefreshing = false;
        }

        saveDisplayCaseSnapshot(dcItems);
        lastDcRefreshTime = Date.now();
        const dcSnap = loadDisplayCaseSnapshot();
        const dcCount = dcSnap ? Object.keys(dcSnap.itemMap).length : 0;

        updateStatus(`✅ Display Case: ${dcCount} items${usedFallback ? ' (page scrape)' : ''}`, '#44ff44');
        clearHighlights();
        highlightMarketplaceItems();
        console.log(`[Torn Inv] Display case saved: ${dcItems.length} items${usedFallback ? ' (fallback: page scrape)' : ''}`);
    }

    function clearInventoryList() {
        const invSnap = loadInventorySnapshot();
        const dcSnap  = loadDisplayCaseSnapshot();
        const invCount = invSnap ? Object.keys(invSnap.itemMap).length : 0;
        const dcCount  = dcSnap  ? Object.keys(dcSnap.itemMap).length  : 0;

        if (!invCount && !dcCount) {
            updateStatus('Nothing to clear — inventory is already empty.', '#ffaa00');
            return;
        }
        const ok = confirm(
            `Delete the saved inventory snapshot (${invCount} items) and ` +
            `display case snapshot (${dcCount} items)?\n\n` +
            `Your API key, watchlist, and thresholds will NOT be touched.`
        );
        if (!ok) return;

        GM_deleteValue(INV_STORAGE_KEY);
        GM_deleteValue(DC_STORAGE_KEY);
        lastRefreshTime = 0;

        clearHighlights();
        updateStatus('🗑️ Inventory cleared', '#ffaa00');
        console.log('[Torn Inv] Inventory + display case cleared.');
    }

    function buildFilterBar(allCategories) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'padding:8px 16px;background:#252525;border-bottom:1px solid #333;display:flex;gap:8px;align-items:center;font-size:12px;';

        const catSel = document.createElement('select');
        catSel.style.cssText = 'padding:4px 8px;background:#2a2a2a;border:1px solid #444;border-radius:4px;color:#eee;min-width:140px;';
        const optAll = document.createElement('option');
        optAll.value = '';
        optAll.textContent = 'All categories';
        catSel.appendChild(optAll);
        allCategories.forEach(c => {
            const o = document.createElement('option');
            o.value = c;
            o.textContent = c;
            catSel.appendChild(o);
        });

        const textIn = document.createElement('input');
        textIn.type = 'text';
        textIn.placeholder = 'filter by name…';
        textIn.style.cssText = 'flex:1;padding:4px 8px;background:#2a2a2a;border:1px solid #444;border-radius:4px;color:#eee;';

        wrap.appendChild(catSel);
        wrap.appendChild(textIn);

        const listeners = [];
        const fire = () => listeners.forEach(fn => fn());
        catSel.addEventListener('change', fire);
        textIn.addEventListener('input', fire);

        return {
            el: wrap,
            getCategory: () => catSel.value,
            getText:     () => textIn.value.trim().toLowerCase(),
            onChange:    (fn) => listeners.push(fn)
        };
    }

    function openItemsPanel() {
        if (document.getElementById('torn-inv-items-modal')) return;
        const combined = getCombinedMap();

        const overlay = buildOverlay('torn-inv-items-modal');
        const modal = document.createElement('div');
        modal.style.cssText = `
            background:#1e1e1e; border:1px solid #444; border-radius:8px;
            width:760px; max-width:94vw; height:82vh; display:flex; flex-direction:column;
            box-shadow:0 8px 30px rgba(0,0,0,0.7);
        `;
        modal.innerHTML = `
            <div style="padding:12px 16px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:#ff9900; font-size:14px;">📋 Your Items</strong>
                <span id="torn-items-close" style="cursor:pointer;color:#888;font-size:16px;">✕</span>
            </div>
        `;
        const filterBar = buildFilterBar(CATEGORY_NAMES);
        modal.appendChild(filterBar.el);

        const sortBar = document.createElement('div');
        sortBar.style.cssText = 'padding:6px 16px;background:#1e1e1e;border-bottom:1px solid #333;display:flex;gap:8px;align-items:center;font-size:12px;';
        sortBar.innerHTML = `
            <span style="color:#999;">Sort:</span>
            <select id="torn-items-sort" style="padding:4px 8px;background:#2a2a2a;border:1px solid #444;border-radius:4px;color:#eee;">
                <option value="amountDesc">Total ↓</option>
                <option value="amountAsc">Total ↑</option>
                <option value="name">Name A-Z</option>
                <option value="category">Category</option>
            </select>
        `;
        modal.appendChild(sortBar);

        const listEl = document.createElement('div');
        listEl.style.cssText = 'overflow-y:auto;padding:8px 16px;font-size:12px;flex:1;';
        modal.appendChild(listEl);

        overlay.appendChild(modal);
        const sortSel = sortBar.querySelector('#torn-items-sort');

        function render() {
            if (combined.size === 0) {
                listEl.innerHTML = '<div style="padding:20px;color:#888;text-align:center;">No inventory yet. Refresh first.</div>';
                return;
            }
            const q = filterBar.getText();
            const cat = filterBar.getCategory();
            const sortBy = sortSel.value;

            let entries = Array.from(combined.values()).filter(info => {
                if (cat && (info.category || '').toLowerCase() !== cat.toLowerCase()) return false;
                if (q && !info.name.toLowerCase().includes(q)) return false;
                return true;
            });

            entries.sort((a, b) => {
                if (sortBy === 'amountAsc')  return a.amount - b.amount;
                if (sortBy === 'amountDesc') return b.amount - a.amount;
                if (sortBy === 'category')   return (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name);
                return a.name.localeCompare(b.name);
            });

            listEl.innerHTML = `
                <div style="display:grid;grid-template-columns:16px 1fr 110px 70px 70px 60px;gap:8px;font-weight:bold;color:#ff9900;padding:6px 0;border-bottom:1px solid #333;position:sticky;top:0;background:#1e1e1e;z-index:1;">
                    <div></div><div>Item (${entries.length})</div><div>Category</div><div style="text-align:right;">Inv</div><div style="text-align:right;">DC</div><div style="text-align:right;">Total</div>
                </div>
            `;
            entries.forEach(info => {
                const th = thresholdsForItem(info.id);
                const bucket = classifyAmount(info.amount, th);
                const dot = BORDER_COLORS[bucket];
                const row = document.createElement('div');
                row.style.cssText = 'display:grid;grid-template-columns:16px 1fr 110px 70px 70px 60px;gap:8px;padding:4px 0;border-bottom:1px solid #2a2a2a;align-items:center;';
                row.innerHTML = `
                    <div style="width:10px;height:10px;border-radius:50%;background:${dot};" title="${bucket}"></div>
                    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(info.name)} (id ${info.id})">${escHtml(info.name)}</div>
                    <div style="color:#888;font-size:11px;">${escHtml(info.category || '')}</div>
                    <div style="color:#9cf;text-align:right;">${info.invAmount}</div>
                    <div style="color:#fc9;text-align:right;">${info.dcAmount}</div>
                    <div style="color:#ddd;text-align:right;font-weight:bold;">${info.amount}</div>
                `;
                listEl.appendChild(row);
            });
        }

        filterBar.onChange(render);
        sortSel.addEventListener('change', render);
        render();

        const close = () => overlay.remove();
        modal.querySelector('#torn-items-close').onclick = close;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }

    function openWatchlistPanel() {
        if (document.getElementById('torn-inv-watchlist-modal')) return;

        const overlay = buildOverlay('torn-inv-watchlist-modal');
        const modal = document.createElement('div');
        modal.style.cssText = `
            background:#1e1e1e; border:1px solid #444; border-radius:8px;
            width:620px; max-width:92vw; height:76vh; display:flex; flex-direction:column;
            box-shadow:0 8px 30px rgba(0,0,0,0.7);
        `;
        modal.innerHTML = `
            <div style="padding:12px 16px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:#ff9900; font-size:14px;">⭐ Watchlist (items you don't own)</strong>
                <span id="torn-watch-close" style="cursor:pointer;color:#888;font-size:16px;">✕</span>
            </div>
            <div style="padding:10px 16px; background:#252525; border-bottom:1px solid #333; font-size:12px;">
                <div style="margin-bottom:6px; color:#bbb;">
                    Items on this list will pulse their marketplace price when it drops to or below your target — even if you own none.
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <input id="torn-watch-name" type="text" placeholder="Item name (e.g. Box of Sweet Hearts)" style="flex:2;padding:5px 8px;background:#2a2a2a;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;">
                    <input id="torn-watch-price" type="number" min="0" placeholder="Max price ($)" style="flex:1;padding:5px 8px;background:#2a2a2a;border:1px solid #444;border-radius:4px;color:#eee;font-size:12px;">
                    <button id="torn-watch-add" style="padding:5px 12px;background:#ff9900;border:none;border-radius:4px;color:#000;font-weight:bold;cursor:pointer;font-size:12px;">Add</button>
                </div>
                <div id="torn-watch-msg" style="margin-top:6px;color:#ff6666;font-size:11px;min-height:14px;"></div>
            </div>
        `;

        const listEl = document.createElement('div');
        listEl.style.cssText = 'overflow-y:auto;padding:8px 16px;font-size:12px;flex:1;';
        modal.appendChild(listEl);

        overlay.appendChild(modal);

        const nameIn = modal.querySelector('#torn-watch-name');
        const priceIn = modal.querySelector('#torn-watch-price');
        const addBtn = modal.querySelector('#torn-watch-add');
        const msgEl = modal.querySelector('#torn-watch-msg');

        function render() {
            const list = loadWatchlist();
            if (!list.length) {
                listEl.innerHTML = '<div style="padding:20px;color:#888;text-align:center;">No items on watchlist. Add one above.</div>';
                return;
            }
            listEl.innerHTML = `
                <div style="display:grid;grid-template-columns:1fr 100px 70px;gap:8px;font-weight:bold;color:#ff9900;padding:6px 0;border-bottom:1px solid #333;position:sticky;top:0;background:#1e1e1e;z-index:1;">
                    <div>Item Name</div><div>Max Price</div><div style="text-align:right;">Remove</div>
                </div>
            `;
            list.forEach((entry, idx) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:grid;grid-template-columns:1fr 100px 70px;gap:8px;padding:5px 0;border-bottom:1px solid #2a2a2a;align-items:center;';
                row.innerHTML = `
                    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(entry.name)}">${escHtml(entry.name)}</div>
                    <div style="color:#ddd;">$${entry.price.toLocaleString()}</div>
                    <div style="text-align:right;">
                        <button data-idx="${idx}" style="padding:3px 8px;background:#662222;border:none;border-radius:3px;color:#fff;cursor:pointer;font-size:11px;">✕</button>
                    </div>
                `;
                listEl.appendChild(row);
            });
            listEl.querySelectorAll('button[data-idx]').forEach(btn => {
                btn.onclick = () => {
                    const i = Number(btn.getAttribute('data-idx'));
                    const cur = loadWatchlist();
                    cur.splice(i, 1);
                    saveWatchlist(cur);
                    render();
                    clearHighlights();
                    highlightMarketplaceItems();
                };
            });
        }

        function tryAdd() {
            msgEl.textContent = '';
            const n = nameIn.value.trim();
            const p = parseInt(priceIn.value, 10);
            if (!n || n.length < 3) { msgEl.textContent = '⚠️ Name must be at least 3 characters.'; return; }
            if (!Number.isFinite(p) || p <= 0) { msgEl.textContent = '⚠️ Price must be a positive number.'; return; }
            const list = loadWatchlist();
            const existingIdx = list.findIndex(e => normName(e.name) === normName(n));
            if (existingIdx >= 0) {
                list[existingIdx].price = p;
                list[existingIdx].name = n;
            } else {
                list.push({ name: n, price: p });
            }
            saveWatchlist(list);
            nameIn.value = '';
            priceIn.value = '';
            render();
            clearHighlights();
            highlightMarketplaceItems();
        }

        addBtn.onclick = tryAdd;
        priceIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryAdd(); });
        nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') priceIn.focus(); });

        render();

        const close = () => overlay.remove();
        modal.querySelector('#torn-watch-close').onclick = close;
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }

    function openSettingsPanel() {
        try {
            const prior = document.getElementById('torn-inv-settings');
            if (prior) prior.remove();

            const combined = getCombinedMap();
            const perItem = loadItemThresholds();
            const def = loadDefaultThreshold();
            const priceTargets = loadPriceTargets();

            const overlay = buildOverlay('torn-inv-settings');
            const modal = document.createElement('div');
            modal.style.cssText = `
                background:#1e1e1e; border:1px solid #444; border-radius:8px;
                width:840px; max-width:94vw; height:84vh; display:flex; flex-direction:column;
                box-shadow:0 8px 30px rgba(0,0,0,0.7);
            `;
            modal.innerHTML = `
                <div style="padding:12px 16px; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
                    <strong style="color:#ff9900; font-size:14px;">⚙️ Highlight Thresholds & Price Targets</strong>
                    <span id="torn-set-close" style="cursor:pointer;color:#888;font-size:16px;">✕</span>
                </div>
                <div style="padding:10px 16px; background:#252525; border-bottom:1px solid #333; font-size:12px;">
                    <div style="margin-bottom:8px; color:#bbb;">
                        Owned &lt; <em style="color:#ff6666;">Red</em> → red ·
                        &lt; <em style="color:#ffcc00;">Yellow</em> → yellow ·
                        ≥ <em style="color:#22cc22;">Green</em> → green.
                    </div>
                    <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
                        <strong style="color:#ff9900;">Defaults:</strong>
                        <label style="color:#ff6666;">Red below: <input id="torn-def-red" type="number" min="0" value="${def.red}" style="width:70px;"></label>
                        <label style="color:#ffcc00;">Yellow below: <input id="torn-def-yellow" type="number" min="0" value="${def.yellow}" style="width:70px;"></label>
                        <label style="color:#22cc22;">Green at/above: <input id="torn-def-green" type="number" min="0" value="${def.green}" style="width:70px;"></label>
                    </div>
                </div>
            `;
            const filterBar = buildFilterBar(CATEGORY_NAMES);
            modal.appendChild(filterBar.el);

            const listEl = document.createElement('div');
            listEl.style.cssText = 'overflow-y:auto;padding:8px 16px;font-size:12px;flex:1;';
            modal.appendChild(listEl);

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'padding:10px 16px;border-top:1px solid #333;display:flex;gap:8px;justify-content:flex-end;';
            btnRow.innerHTML = `
                <button id="torn-set-reset"  style="padding:6px 12px; background:#444; border:none; border-radius:4px; color:#fff; cursor:pointer;">Reset per-item</button>
                <button id="torn-set-save"   style="padding:6px 12px; background:#ff9900; border:none; border-radius:4px; color:#000; font-weight:bold; cursor:pointer;">Save</button>
                <button id="torn-set-cancel" style="padding:6px 12px; background:#444; border:none; border-radius:4px; color:#fff; cursor:pointer;">Cancel</button>
            `;
            modal.appendChild(btnRow);

            overlay.appendChild(modal);

            function renderRows() {
                listEl.innerHTML = '';
                if (combined.size === 0) {
                    listEl.innerHTML = '<div style="padding:20px;color:#888;text-align:center;">No inventory yet. Refresh first.</div>';
                    return;
                }
                const q = filterBar.getText();
                const cat = filterBar.getCategory();

                const header = document.createElement('div');
                header.style.cssText = 'display:grid;grid-template-columns:1fr 80px 80px 80px 80px 60px;gap:8px;font-weight:bold;color:#ff9900;padding:6px 0;border-bottom:1px solid #333;position:sticky;top:0;background:#1e1e1e;z-index:1;';
                header.innerHTML = '<div>Item</div><div>Red &lt;</div><div>Yellow &lt;</div><div>Green ≥</div><div>Price Target</div><div style="text-align:right;">Owned</div>';
                listEl.appendChild(header);

                const rows = Array.from(combined.values())
                    .filter(info => {
                        if (cat && (info.category || '').toLowerCase() !== cat.toLowerCase()) return false;
                        if (q && !info.name.toLowerCase().includes(q)) return false;
                        return true;
                    })
                    .sort((a, b) => a.name.localeCompare(b.name));

                rows.forEach(info => {
                    const id = String(info.id);
                    const stored = perItem[id];
                    const cur = stored ? normalizeTh(stored, def) : def;
                    const priceVal = priceTargets[id] !== undefined ? priceTargets[id] : '';
                    const row = document.createElement('div');
                    row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 80px 80px 80px 60px;gap:8px;padding:4px 0;border-bottom:1px solid #2a2a2a;align-items:center;';
                    row.innerHTML = `
                        <div title="id ${id}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(info.name)}</div>
                        <input data-id="${id}" data-key="red"    type="number" min="0" value="${cur.red}"    style="width:100%;background:#2a2a2a;border:1px solid #444;color:#eee;border-radius:3px;padding:3px 6px;">
                        <input data-id="${id}" data-key="yellow" type="number" min="0" value="${cur.yellow}" style="width:100%;background:#2a2a2a;border:1px solid #444;color:#eee;border-radius:3px;padding:3px 6px;">
                        <input data-id="${id}" data-key="green"  type="number" min="0" value="${cur.green}"  style="width:100%;background:#2a2a2a;border:1px solid #444;color:#eee;border-radius:3px;padding:3px 6px;">
                        <input data-id="${id}" data-key="price"  type="number" min="0" value="${priceVal}"  style="width:100%;background:#2a2a2a;border:1px solid #444;color:#eee;border-radius:3px;padding:3px 6px;" placeholder="no pulse">
                        <div style="color:#aaa;text-align:right;">${info.amount}</div>
                    `;
                    listEl.appendChild(row);
                });
            }
            renderRows();
            filterBar.onChange(renderRows);

            const close = () => overlay.remove();
            modal.querySelector('#torn-set-close').onclick = close;
            modal.querySelector('#torn-set-cancel').onclick = close;
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

            modal.querySelector('#torn-set-save').onclick = () => {
                saveDefaultThreshold({
                    red:    parseInt(modal.querySelector('#torn-def-red').value, 10)    || 0,
                    yellow: parseInt(modal.querySelector('#torn-def-yellow').value, 10) || 0,
                    green:  parseInt(modal.querySelector('#torn-def-green').value, 10)  || 0
                });
                const next = {};
                const nextPrices = {};
                listEl.querySelectorAll('input[data-id]').forEach(inp => {
                    const id = inp.getAttribute('data-id');
                    const k  = inp.getAttribute('data-key');
                    const v  = parseInt(inp.value, 10);
                    if (k === 'price') {
                        if (Number.isFinite(v) && v > 0) nextPrices[id] = v;
                        return;
                    }
                    if (!Number.isFinite(v)) return;
                    if (!next[id]) next[id] = {};
                    next[id][k] = v;
                });
                saveItemThresholds(next);
                savePriceTargets(nextPrices);
                close();
                clearHighlights();
                highlightMarketplaceItems();
                updateStatus('✅ Settings saved', '#44ff44');
            };

            modal.querySelector('#torn-set-reset').onclick = () => {
                if (!confirm('Remove all per-item overrides and price targets?')) return;
                saveItemThresholds({});
                savePriceTargets({});
                close();
                openSettingsPanel();
            };
        } catch (err) {
            alert('Settings failed: ' + (err && err.message ? err.message : err));
        }
    }

    const HIGHLIGHT_ATTR = 'data-torn-inv-highlight';
    const PULSE_ATTR = 'data-torn-inv-pulse';

    function normName(s) {
        return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function buildNameIndexFromCombined(combined) {
        const map = new Map();
        combined.forEach((info, id) => {
            const key = normName(info.name);
            if (key.length >= 3) {
                map.set(key, {
                    id: Number(id),
                    name: info.name,
                    amount: info.amount,
                    invAmount: info.invAmount,
                    dcAmount: info.dcAmount
                });
            }
        });
        return map;
    }

    function buildWatchlistIndex() {
        const map = new Map();
        loadWatchlist().forEach(entry => {
            const key = normName(entry.name);
            if (key.length >= 3) {
                map.set(key, { name: entry.name, price: entry.price });
            }
        });
        return map;
    }

    function clearHighlights() {
        document.querySelectorAll('[' + HIGHLIGHT_ATTR + ']').forEach(el => {
            el.style.removeProperty('background-color');
            el.style.removeProperty('color');
            el.style.removeProperty('font-weight');
            el.style.removeProperty('border');
            el.style.removeProperty('border-radius');
            el.style.removeProperty('padding');
            el.style.removeProperty('box-shadow');
            el.removeAttribute(HIGHLIGHT_ATTR);
        });
        document.querySelectorAll('[' + PULSE_ATTR + ']').forEach(el => {
            el.classList.remove('torn-inv-pulse');
            el.removeAttribute(PULSE_ATTR);
        });
    }

    function isMarketPage() {
        const url = window.location.href;
        return (
            /\/imarket\.php/i.test(url) ||
            /\/bazaar\.php/i.test(url) ||
            /\/market\.php/i.test(url) ||
            /page\.php\?sid=ItemMarket/i.test(url) ||
            /sid=ItemMarket/i.test(url) ||
            /sid=Bazaar/i.test(url)
        );
    }

    function getScanRoots() {
        const roots = [];
        document.querySelectorAll('[class*="itemList__"]').forEach(el => roots.push(el));
        if (roots.length === 0) {
            document.querySelectorAll('[class*="itemListWrapper"], [class*="itemList"]').forEach(el => roots.push(el));
        }
        if (roots.length === 0) roots.push(document.body);
        return roots;
    }

    function injectPulseStyle() {
        if (document.getElementById('torn-inv-pulse-style')) return;
        const style = document.createElement('style');
        style.id = 'torn-inv-pulse-style';
        style.textContent = `
            @keyframes tornInvPulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(1.1); }
            }
            .torn-inv-pulse {
                animation: tornInvPulse 0.8s ease-in-out infinite !important;
                display: inline-block !important;
                font-weight: bold !important;
                color: #00ff88 !important;
                background-color: rgba(0, 255, 136, 0.2) !important;
                border-radius: 3px !important;
                padding: 0 3px !important;
            }
        `;
        appendToBody(style);
    }

    function pulsePriceNodes(container, maxPrice) {
        if (!container) return;
        container.querySelectorAll('*').forEach(node => {
            if (node.children.length > 0) return;
            const ptxt = (node.textContent || '').trim();
            if (/^\$[\d,]+/.test(ptxt)) {
                const pVal = parseInt(ptxt.replace(/[^0-9]/g, ''), 10);
                if (Number.isFinite(pVal) && pVal <= maxPrice) {
                    node.classList.add('torn-inv-pulse');
                    node.setAttribute(PULSE_ATTR, '1');
                }
            }
        });
    }

    function highlightMarketplaceItems() {
        if (!isMarketPage()) return;

        const combined = getCombinedMap();
        injectPulseStyle();
        clearHighlights();

        const nameIndex = buildNameIndexFromCombined(combined);
        const priceTargets = loadPriceTargets();
        const watchIndex = buildWatchlistIndex();
        const roots = getScanRoots();

        const candidates = new Set();
        roots.forEach(root => {
            root.querySelectorAll('*').forEach(el => {
                if (el.children.length > 0) return;
                if (el.closest && el.closest('#torn-inv-panel, #torn-inv-settings, #torn-inv-items-modal, #torn-inv-watchlist-modal')) return;
                const t = (el.textContent || '').trim();
                if (!t || t.length < 3 || t.length > 60) return;
                if (!/[a-zA-Z]/.test(t)) return;
                if (/^\$/.test(t)) return;
                if (t === 'Buy Item') return;
                const key = normName(t);
                if (nameIndex.has(key) || watchIndex.has(key)) candidates.add(el);
            });
        });

        let highlighted = 0;
        let watched = 0;

        candidates.forEach(el => {
            const txt = (el.textContent || '').trim();
            const key = normName(txt);
            const owned = nameIndex.get(key);
            const watch = watchIndex.get(key);

            if (owned) {
                const th = thresholdsForItem(owned.id);
                const bucket = classifyAmount(owned.amount, th);
                const bg = HIGHLIGHT_COLORS[bucket];
                const fg = TEXT_COLORS[bucket];
                const border = BORDER_COLORS[bucket];

                el.style.setProperty('background-color', bg, 'important');
                el.style.setProperty('color', fg, 'important');
                el.style.setProperty('font-weight', 'bold', 'important');
                el.style.setProperty('border', `2px solid ${border}`, 'important');
                el.style.setProperty('border-radius', '4px', 'important');
                el.style.setProperty('padding', '2px 6px', 'important');
                el.style.setProperty('box-shadow', `0 0 8px ${border}`, 'important');

                const breakdown = [];
                if (owned.invAmount > 0) breakdown.push(`Inventory: ${owned.invAmount}`);
                if (owned.dcAmount > 0)  breakdown.push(`Display Case: ${owned.dcAmount}`);
                el.title = `${txt} — Total: ${owned.amount}${breakdown.length ? '\n' + breakdown.join('\n') : ''}`;

                el.setAttribute(HIGHLIGHT_ATTR, bucket);
                highlighted++;

                const itemPrice = priceTargets[owned.id];
                if (itemPrice) {
                    const container = el.closest('[class*="item"]') || el.parentElement || el;
                    pulsePriceNodes(container, itemPrice);
                }
            }

            if (watch) {
                const container = el.closest('[class*="item"]') || el.parentElement || el;
                if (container) {
                    let pulsing = false;
                    container.querySelectorAll('*').forEach(node => {
                        if (node.children.length > 0) return;
                        const ptxt = (node.textContent || '').trim();
                        if (/^\$[\d,]+/.test(ptxt)) {
                            const pVal = parseInt(ptxt.replace(/[^0-9]/g, ''), 10);
                            if (Number.isFinite(pVal) && pVal <= watch.price) {
                                node.classList.add('torn-inv-pulse');
                                node.setAttribute(PULSE_ATTR, '1');
                                pulsing = true;
                            }
                        }
                    });
                    if (pulsing) {
                        el.title = `${txt} — WATCHLIST (target ≤ $${watch.price.toLocaleString()})`;
                        watched++;
                    }
                }
            }
        });

        console.log(`[Torn Inv] Highlighted: ${highlighted}, Watchlist pulses: ${watched}`);
    }

    function resetPanelPosition() {
        GM_deleteValue(PANEL_POS_STORAGE);
        const p = document.getElementById('torn-inv-panel');
        if (p) {
            p.style.right = '20px';
            p.style.bottom = '20px';
            p.style.left = 'auto';
            p.style.top = 'auto';
        }
        alert('Panel position reset.');
    }

    function forceResetAll() {
        if (!confirm('This clears hidden/collapsed state and panel position. Continue?')) return;
        GM_deleteValue(PANEL_HIDDEN_STORAGE);
        GM_deleteValue(PANEL_COLLAPSED_STORAGE);
        GM_deleteValue(PANEL_POS_STORAGE);
        const old = document.getElementById('torn-inv-panel');
        if (old) old.remove();
        createControlPanel();
        alert('Panel state reset.');
    }

    function registerMenuCommands() {
        try {
            GM_registerMenuCommand('📦 Show Panel', showPanel);
            GM_registerMenuCommand('👁️ Hide Panel', hidePanel);
            GM_registerMenuCommand('🔄 Refresh Inventory', refreshInventory);
            GM_registerMenuCommand('🏛️ Pull Display Case', pullDisplayCase);
            GM_registerMenuCommand('🗑️ Clear Inventory List', clearInventoryList);
            GM_registerMenuCommand('⭐ Open Watchlist', openWatchlistPanel);
            GM_registerMenuCommand('🧩 Open Crimes Panel', openCrimesPanel);
            GM_registerMenuCommand('🔑 Set API Key', promptForApiKey);
            GM_registerMenuCommand('🛠️ Force Reset Panel', forceResetAll);
            GM_registerMenuCommand('📍 Reset Panel Position', resetPanelPosition);
        } catch (e) {
            console.error('[Torn Inv] Menu registration failed:', e);
        }
    }

    let observer = null;

    function startObserver() {
        if (!isMarketPage()) return;
        if (observer) observer.disconnect();
        observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            mutations.forEach(m => {
                if (m.type === 'childList' && m.addedNodes.length > 0) {
                    m.addedNodes.forEach(n => {
                        if (n.nodeType === 1 && (n.classList.contains('price') || n.textContent.includes('$'))) {
                            shouldUpdate = true;
                        }
                    });
                }
            });
            if (shouldUpdate) {
                clearHighlights();
                highlightMarketplaceItems();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        try { createControlPanel(); }
        catch (e) { console.error('[Torn Inv] Panel creation error:', e); }

        try {
            const invSnap = loadInventorySnapshot();
            const dcSnap  = loadDisplayCaseSnapshot();
            const invCount = invSnap ? Object.keys(invSnap.itemMap).length : 0;
            const dcCount  = dcSnap  ? Object.keys(dcSnap.itemMap).length  : 0;
            if (invSnap || dcSnap) {
                const date = new Date((invSnap && invSnap.timestamp) || (dcSnap && dcSnap.timestamp) || Date.now()).toLocaleString();
                updateStatus(`📦 Inv: ${invCount} · DC: ${dcCount} (${date})`, '#44ff44');
            } else if (!getApiKey()) {
                updateStatus('🔑 No API key.', '#ff9900');
            } else {
                updateStatus('No data. Click 🔄 Inventory.', '#ff9900');
            }
        } catch (e) {
            console.error('[Torn Inv] Status update error:', e);
        }

        startObserver();
        try { highlightMarketplaceItems(); }
        catch (e) { console.error('[Torn Inv] Initial highlight error:', e); }
    }

    registerMenuCommands();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();