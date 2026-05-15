// Interactive Vendor Map plugin for RustPlusPlus.
// Runs a local, token-protected web UI for browsing vending machines and traveling vendors.

const http = require('http');
const { URL } = require('url');
const Path = require('path');
const Fs = require('fs');

const PLUGIN_NAME = 'vendor-map-web.js';

let server = null;
let serverPort = null;
let authToken = null;
const recentEvents = new Map();

module.exports = {
  defaultEnabled: false,
  displayName: 'Interactive Vendor Map',
  description: 'Token-protected local web UI with pan/zoom map, vendor search, filters, and live vendor details.',

  configSchema: {
    bindHost: { type: 'text', label: 'Bind host', default: '127.0.0.1' },
    port: { type: 'text', label: 'Port (0 = random)', default: '0' },
    autoRefreshSeconds: { type: 'text', label: 'Auto-refresh seconds', default: '5' },
    showOutOfStock: { type: 'bool', label: 'Show out-of-stock sell orders by default', default: false }
  },

  onLoad: ({ client }) => {
    ensureServer(client);
  },

  onEnabled: ({ client, guild }) => {
    ensureServer(client);
    logUrl(client, guild?.id);
  },

  onUnload: () => {
    if (server) server.close();
    server = null;
    serverPort = null;
    authToken = null;
    recentEvents.clear();
  },

  onMapUpdated: ({ rustplus }) => rememberEvent(rustplus?.guildId, 'Map markers refreshed'),
  onVendingMachineDetected: ({ rustplus, location }) => rememberEvent(rustplus?.guildId, `New vending machine at ${location?.string || 'unknown'}`),
  onTravelingVendorSpawned: ({ rustplus, location }) => rememberEvent(rustplus?.guildId, `Traveling vendor spawned at ${location?.string || 'unknown'}`),
  onTravelingVendorLeft: ({ rustplus, location }) => rememberEvent(rustplus?.guildId, `Traveling vendor left ${location?.string || 'the map'}`),
  onTravelingVendorHalted: ({ rustplus, location }) => rememberEvent(rustplus?.guildId, `Traveling vendor halted at ${location?.string || 'unknown'}`),
  onTravelingVendorResumed: ({ rustplus, location }) => rememberEvent(rustplus?.guildId, `Traveling vendor resumed at ${location?.string || 'unknown'}`),

  slashCommands: [
    {
      name: 'vendormap',
      getData() {
        const Builder = require('@discordjs/builders');
        return new Builder.SlashCommandBuilder()
          .setName('vendormap')
          .setDescription('Get the local interactive vendor map URL');
      },
      async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');
        if (!await client.validatePermissions(interaction)) return;
        ensureServer(client);
        const url = getPublicUrl(interaction.guildId);
        await interaction.reply({
          ephemeral: true,
          content: url ? `Interactive vendor map: ${url}` : 'Vendor map server is starting. Try again in a few seconds.'
        });
      }
    }
  ]
};

function ensureServer(client) {
  if (!authToken) authToken = generateToken();
  if (server) return;

  const defaults = getDefaultServerConfig(client);
  server = http.createServer(async (req, res) => {
    try {
      await handleRequest(client, req, res);
    }
    catch (err) {
      sendJson(res, 500, { ok: false, error: err?.message || 'server error' });
    }
  });

  server.on('error', (err) => {
    server = null;
    serverPort = null;
    client.log(client.intlGet(null, 'errorCap'), `[vendor-map] server error: ${err?.message || err}`, 'error');
  });

  server.listen(defaults.port, defaults.host, () => {
    serverPort = server.address().port;
    client.log(client.intlGet(null, 'infoCap'), `[vendor-map] listening at ${getPublicUrl()}`);
  });
}

function getDefaultServerConfig(client) {
  const settings = getFirstPluginSettings(client);
  const host = String(settings.bindHost || '127.0.0.1').trim() || '127.0.0.1';
  const parsedPort = parseInt(settings.port, 10);
  return { host, port: Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : 0 };
}

function getFirstPluginSettings(client) {
  try {
    for (const guild of client.guilds.cache.values()) {
      const settings = getPluginSettings(client, guild.id);
      if (settings) return settings;
    }
  }
  catch (_) { /* ignore */ }
  return {};
}

function getPluginSettings(client, guildId) {
  try {
    const instance = client.getInstance(guildId);
    return instance?.pluginSettings?.[PLUGIN_NAME] || {};
  }
  catch (_) {
    return {};
  }
}

function logUrl(client, guildId) {
  const url = getPublicUrl(guildId);
  if (!url) return;
  client.log(client.intlGet(null, 'infoCap'), `[vendor-map] URL${guildId ? ` for guild ${guildId}` : ''}: ${url}`);
}

function getPublicUrl(guildId = '') {
  if (!serverPort || !authToken) return null;
  const guildPart = guildId ? `&guildId=${encodeURIComponent(guildId)}` : '';
  return `http://127.0.0.1:${serverPort}/?token=${encodeURIComponent(authToken)}${guildPart}`;
}

async function handleRequest(client, req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/app.css') return sendCss(res, 200, appCss());
  if (req.method === 'GET' && url.pathname === '/app.js') return sendJs(res, 200, appJs());
  if (req.method === 'GET' && url.pathname === '/favicon.svg') return sendSvg(res, 200, faviconSvg());

  if (!isAuthorized(url, req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

  if (req.method === 'GET' && url.pathname === '/') return sendHtml(res, 200, htmlPage());
  if (req.method === 'GET' && url.pathname === '/api/guilds') return sendJson(res, 200, listGuilds(client));
  if (req.method === 'GET' && url.pathname === '/api/vendor-map') return sendJson(res, 200, getVendorMap(client, url));
  if (req.method === 'GET' && url.pathname === '/api/export') return sendJson(res, 200, getVendorMap(client, url, true));

  return sendJson(res, 404, { ok: false, error: 'not found' });
}

function isAuthorized(url, req) {
  if (!authToken) return false;
  return url.searchParams.get('token') === authToken || req.headers['x-vendor-map-token'] === authToken;
}

function listGuilds(client) {
  const guilds = [];
  try {
    for (const [id, guild] of client.guilds.cache) {
      const rp = client.rustplusInstances?.[id];
      const settings = getPluginSettings(client, id);
      guilds.push({
        id,
        name: guild.name,
        connected: !!(rp && rp.isConnected),
        autoRefreshSeconds: parsePositiveInt(settings.autoRefreshSeconds, 5),
        showOutOfStock: settings.showOutOfStock === true
      });
    }
  }
  catch (_) { /* ignore */ }
  return { ok: true, guilds };
}

function getVendorMap(client, url, exportOnly = false) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return { ok: false, error: 'guildId required' };

  const rustplus = client.rustplusInstances?.[guildId];
  const guild = client.guilds?.cache?.get(guildId);
  const settings = getPluginSettings(client, guildId);
  const map = buildMapPayload(client, guildId, rustplus, exportOnly);
  const vendors = buildVendorPayload(client, rustplus);

  return {
    ok: true,
    guild: { id: guildId, name: guild?.name || guildId, connected: !!(rustplus && rustplus.isConnected) },
    config: {
      autoRefreshSeconds: parsePositiveInt(settings.autoRefreshSeconds, 5),
      showOutOfStock: settings.showOutOfStock === true
    },
    generatedAt: new Date().toISOString(),
    map,
    vendors,
    summary: summarizeVendors(vendors),
    events: recentEvents.get(guildId) || []
  };
}

function buildMapPayload(client, guildId, rustplus, exportOnly) {
  const payload = {
    image: null,
    mapSize: rustplus?.info?.correctedMapSize || rustplus?.info?.mapSize || null,
    oceanMargin: 0,
    monuments: [],
    players: []
  };

  try { payload.oceanMargin = rustplus?.map?.oceanMargin || rustplus?.map?._oceanMargin || 0; } catch (_) { /* ignore */ }
  try {
    if (Array.isArray(rustplus?.map?.monuments)) {
      payload.monuments = rustplus.map.monuments.map((m) => ({
        token: m.token,
        name: rustplus.map.monumentInfo?.[m.token]?.clean || m.name || m.token,
        x: m.x,
        y: m.y
      })).filter((m) => typeof m.x === 'number' && typeof m.y === 'number');
    }
  }
  catch (_) { /* ignore */ }

  try {
    if (Array.isArray(rustplus?.team?.players)) {
      payload.players = rustplus.team.players.map((p) => ({
        name: p.name,
        x: p.x,
        y: p.y,
        online: !!p.isOnline,
        alive: !!p.isAlive
      })).filter((p) => typeof p.x === 'number' && typeof p.y === 'number');
    }
  }
  catch (_) { /* ignore */ }

  if (!exportOnly) payload.image = readMapImage(guildId);
  return payload;
}

function buildVendorPayload(client, rustplus) {
  const vendingMachines = [];
  const travelingVendors = [];

  try {
    if (Array.isArray(rustplus?.mapMarkers?.vendingMachines)) {
      for (const vendor of rustplus.mapMarkers.vendingMachines) {
        vendingMachines.push(normalizeVendingMachine(client, vendor));
      }
    }
  }
  catch (_) { /* ignore */ }

  try {
    if (Array.isArray(rustplus?.mapMarkers?.travelingVendors)) {
      for (const vendor of rustplus.mapMarkers.travelingVendors) {
        travelingVendors.push({
          id: stableVendorId('traveling', vendor),
          type: 'traveling',
          label: vendor.isHalted ? 'Traveling vendor (halted)' : 'Traveling vendor',
          x: vendor.x,
          y: vendor.y,
          grid: vendor.location?.location || null,
          location: vendor.location?.string || vendor.location?.location || null,
          halted: !!vendor.isHalted,
          orders: []
        });
      }
    }
  }
  catch (_) { /* ignore */ }

  return { vendingMachines, travelingVendors };
}

function normalizeVendingMachine(client, vendor) {
  const orders = [];
  if (Array.isArray(vendor.sellOrders)) {
    for (const order of vendor.sellOrders) {
      const item = getItem(client, order.itemId);
      const currency = getItem(client, order.currencyId);
      orders.push({
        itemId: order.itemId,
        itemName: item.name,
        itemIcon: item.icon,
        itemBlueprint: !!order.itemIsBlueprint,
        currencyId: order.currencyId,
        currencyName: currency.name,
        currencyIcon: currency.icon,
        currencyBlueprint: !!order.currencyIsBlueprint,
        quantity: order.quantity || 0,
        cost: order.costPerItem || 0,
        stock: order.amountInStock || 0,
        inStock: (order.amountInStock || 0) > 0,
        searchText: [item.name, currency.name, order.itemId, order.currencyId].join(' ').toLowerCase()
      });
    }
  }

  return {
    id: stableVendorId('vending', vendor),
    type: 'vending',
    label: vendor.name || 'Vending machine',
    x: vendor.x,
    y: vendor.y,
    grid: vendor.location?.location || null,
    location: vendor.location?.string || vendor.location?.location || null,
    orders,
    orderCount: orders.length,
    inStockCount: orders.filter((order) => order.inStock).length
  };
}

function getItem(client, itemId) {
  let name = itemId == null ? 'Unknown item' : `Item ${itemId}`;
  let icon = null;
  try {
    if (client.items && itemId != null) {
      name = client.items.getName(itemId) || name;
      icon = client.items.getImage?.(itemId) || client.items.getIcon?.(itemId) || null;
    }
  }
  catch (_) { /* ignore */ }
  return { name, icon };
}

function summarizeVendors(vendors) {
  const machines = vendors.vendingMachines || [];
  const traveling = vendors.travelingVendors || [];
  const orders = machines.flatMap((vendor) => vendor.orders || []);
  const inStock = orders.filter((order) => order.inStock);
  return {
    vendingMachineCount: machines.length,
    travelingVendorCount: traveling.length,
    orderCount: orders.length,
    inStockOrderCount: inStock.length,
    uniqueItems: new Set(inStock.map((order) => order.itemName)).size,
    uniqueCurrencies: new Set(inStock.map((order) => order.currencyName)).size
  };
}

function readMapImage(guildId) {
  const candidates = [
    Path.join(__dirname, '..', 'maps', `${guildId}_map_full.png`),
    Path.join(__dirname, '..', 'maps', `${guildId}_map_clean.png`),
    Path.join(__dirname, '..', 'maps', `${guildId}_map.png`)
  ];
  for (const file of candidates) {
    try {
      if (Fs.existsSync(file)) return `data:image/png;base64,${Fs.readFileSync(file).toString('base64')}`;
    }
    catch (_) { /* ignore */ }
  }
  return null;
}

function stableVendorId(prefix, vendor) {
  const x = Number.isFinite(vendor?.x) ? Math.round(vendor.x) : 'x';
  const y = Number.isFinite(vendor?.y) ? Math.round(vendor.y) : 'y';
  return `${prefix}-${vendor?.id || `${x}-${y}`}`;
}

function rememberEvent(guildId, text) {
  if (!guildId || !text) return;
  const events = recentEvents.get(guildId) || [];
  events.unshift({ time: new Date().toISOString(), text });
  recentEvents.set(guildId, events.slice(0, 30));
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function generateToken() {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function sendHtml(res, status, html) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
function sendCss(res, status, css) { res.writeHead(status, { 'Content-Type': 'text/css; charset=utf-8' }); res.end(css); }
function sendJs(res, status, js) { res.writeHead(status, { 'Content-Type': 'application/javascript; charset=utf-8' }); res.end(js); }
function sendSvg(res, status, svg) { res.writeHead(status, { 'Content-Type': 'image/svg+xml; charset=utf-8' }); res.end(svg); }
function sendJson(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

function htmlPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Rust++ Vendor Map</title>
  <link rel="icon" href="/favicon.svg" />
  <link rel="stylesheet" href="/app.css" />
</head>
<body>
  <header class="topbar">
    <div class="brand"><span class="brand-icon">🛒</span><span>Rust++ Vendor Map</span></div>
    <div class="toolbar">
      <select id="guildSelect" class="input"></select>
      <button id="copyLink" class="btn">Copy link</button>
      <button id="exportJson" class="btn">Export JSON</button>
      <span id="status" class="status">Loading…</span>
    </div>
  </header>
  <main class="layout">
    <aside class="sidebar">
      <section class="card stats" id="stats"></section>
      <section class="card controls">
        <label>Search items, currencies, grids, vendors
          <input id="search" class="input full" placeholder="e.g. sulfur, scrap, D12" autocomplete="off" />
        </label>
        <div class="checks">
          <label><input id="showVending" type="checkbox" checked /> Vending machines</label>
          <label><input id="showTraveling" type="checkbox" checked /> Traveling vendor</label>
          <label><input id="showOutOfStock" type="checkbox" /> Out of stock orders</label>
          <label><input id="showPlayers" type="checkbox" checked /> Team players</label>
          <label><input id="showMonuments" type="checkbox" /> Monuments</label>
        </div>
        <div class="map-buttons">
          <button id="fitMap" class="btn full">Fit map</button>
          <button id="refreshNow" class="btn full primary">Refresh now</button>
        </div>
      </section>
      <section class="card">
        <h2>Vendors</h2>
        <div id="vendorList" class="vendor-list"></div>
      </section>
      <section class="card">
        <h2>Recent events</h2>
        <div id="eventList" class="events muted">No events yet.</div>
      </section>
    </aside>
    <section class="map-panel">
      <div class="map-help">Mouse wheel / pinch to zoom · Drag to pan · Click a marker for details</div>
      <div id="map" class="map">
        <img id="mapImage" alt="Rust map" />
        <div id="markerLayer" class="marker-layer"></div>
        <div id="emptyMap" class="empty">Map image is not available yet. Vendor lists still work once Rust+ marker data is present.</div>
      </div>
    </section>
    <aside id="details" class="details closed">
      <button id="closeDetails" class="close" title="Close">×</button>
      <div id="detailsBody"></div>
    </aside>
  </main>
  <div id="toast" class="toast" hidden></div>
  <script src="/app.js"></script>
</body>
</html>`;
}

function appCss() {
  return `:root{color-scheme:dark;--bg:#101217;--panel:#181c24;--panel2:#202633;--text:#f5f1eb;--muted:#9da6b5;--line:#303849;--accent:#ce412b;--good:#4ade80;--warn:#fbbf24;--blue:#60a5fa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Arial,sans-serif}.topbar{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--line);background:rgba(16,18,23,.94);position:sticky;top:0;z-index:10}.brand{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:800}.brand-icon{font-size:24px}.toolbar{display:flex;align-items:center;gap:8px}.layout{display:grid;grid-template-columns:360px minmax(0,1fr) 380px;height:calc(100vh - 58px);min-height:540px}.sidebar,.details{overflow:auto;background:var(--panel);border-right:1px solid var(--line);padding:14px}.details{border-left:1px solid var(--line);border-right:0;position:relative}.details.closed{display:none}.map-panel{position:relative;min-width:0;background:#0c0f14}.map{position:absolute;inset:0;overflow:hidden;cursor:grab}.map.dragging{cursor:grabbing}.map-help{position:absolute;top:12px;left:12px;z-index:3;background:rgba(0,0,0,.55);padding:8px 10px;border-radius:10px;color:var(--muted);backdrop-filter:blur(8px)}#mapImage{position:absolute;left:0;top:0;transform-origin:0 0;user-select:none;pointer-events:none}.marker-layer{position:absolute;left:0;top:0;transform-origin:0 0}.empty{position:absolute;inset:auto 24px 24px 24px;padding:12px 14px;border:1px dashed var(--line);border-radius:12px;color:var(--muted);background:rgba(24,28,36,.85)}.card{background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}.card h2{margin:0 0 10px;font-size:15px}.input{background:#0d1118;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:9px 10px;outline:0}.input:focus{border-color:var(--accent)}.full{width:100%}.btn{border:1px solid var(--line);background:#252c3a;color:var(--text);border-radius:9px;padding:9px 11px;cursor:pointer}.btn:hover{border-color:#566174}.btn.primary{background:var(--accent);border-color:#e15b45}.status,.muted{color:var(--muted)}.checks{display:grid;gap:8px;margin:12px 0}.checks label{display:flex;gap:8px;align-items:center}.map-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}.stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}.stat{padding:9px;border:1px solid var(--line);border-radius:10px;background:#131822}.stat b{display:block;font-size:20px}.stat span{color:var(--muted);font-size:12px}.vendor-list{display:grid;gap:8px}.vendor-row{border:1px solid var(--line);border-radius:12px;padding:10px;background:#151a23;cursor:pointer}.vendor-row:hover,.vendor-row.active{border-color:var(--accent)}.vendor-title{display:flex;justify-content:space-between;gap:8px;font-weight:700}.vendor-meta{color:var(--muted);font-size:12px;margin-top:3px}.pill{display:inline-flex;align-items:center;border-radius:999px;padding:2px 7px;font-size:12px;background:#2b3342;color:var(--muted);margin:2px 4px 0 0}.pill.good{color:#062411;background:var(--good)}.pill.warn{color:#271b00;background:var(--warn)}.marker{position:absolute;min-width:26px;height:26px;transform:translate(-50%,-50%);border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 14px rgba(0,0,0,.6);cursor:pointer;font-size:15px;z-index:2}.marker.vending{background:var(--accent)}.marker.traveling{background:var(--warn);color:#211400}.marker.player{background:var(--blue)}.marker.monument{background:#6b7280;font-size:11px}.marker.dim{opacity:.22}.marker.selected{outline:3px solid white;z-index:5}.marker-label{position:absolute;left:50%;top:29px;transform:translateX(-50%);white-space:nowrap;background:rgba(0,0,0,.72);border-radius:999px;padding:2px 7px;font-size:12px;color:white;pointer-events:none}.close{position:absolute;right:14px;top:12px;background:transparent;color:var(--muted);border:0;font-size:28px;cursor:pointer}.details h2{margin:14px 36px 2px 0}.order{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;padding:9px;border:1px solid var(--line);border-radius:10px;margin:8px 0;background:#141923}.order.out{opacity:.5}.arrow{color:var(--muted)}.item{min-width:0}.item b,.item span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item span{font-size:12px;color:var(--muted)}.events{display:grid;gap:7px}.event{border-left:3px solid var(--accent);padding-left:8px}.toast{position:fixed;right:18px;bottom:18px;padding:10px 13px;background:#111827;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:20}@media(max-width:1100px){.layout{grid-template-columns:320px 1fr}.details{position:fixed;right:0;top:58px;bottom:0;width:min(390px,94vw);z-index:9;box-shadow:-20px 0 45px rgba(0,0,0,.45)}}@media(max-width:760px){.topbar{height:auto;min-height:58px;align-items:flex-start;flex-direction:column;padding:10px}.toolbar{width:100%;flex-wrap:wrap}.layout{display:block;height:auto}.sidebar{height:auto}.map-panel{height:70vh}.details{top:0}.map-buttons{grid-template-columns:1fr}}`;
}

function appJs() {
  return `(() => {
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token') || '';
  const state = { data:null, selectedId:null, scale:1, x:0, y:0, imgW:0, imgH:0, mapSize:null, ocean:0, timer:null };
  const els = {
    guild: document.getElementById('guildSelect'), status: document.getElementById('status'), stats: document.getElementById('stats'),
    search: document.getElementById('search'), showVending: document.getElementById('showVending'), showTraveling: document.getElementById('showTraveling'),
    showOutOfStock: document.getElementById('showOutOfStock'), showPlayers: document.getElementById('showPlayers'), showMonuments: document.getElementById('showMonuments'),
    vendorList: document.getElementById('vendorList'), events: document.getElementById('eventList'), map: document.getElementById('map'), img: document.getElementById('mapImage'),
    layer: document.getElementById('markerLayer'), empty: document.getElementById('emptyMap'), details: document.getElementById('details'), detailsBody: document.getElementById('detailsBody'), toast: document.getElementById('toast')
  };
  const headers = { 'x-vendor-map-token': token };

  function api(path){ return fetch(path + (path.includes('?')?'&':'?') + 'token=' + encodeURIComponent(token), { headers }).then(async r => { if(!r.ok) throw new Error(await r.text()); return r.json(); }); }
  function setStatus(text){ els.status.textContent = text; }
  function toast(text){ els.toast.textContent = text; els.toast.hidden = false; clearTimeout(els.toast._t); els.toast._t = setTimeout(() => els.toast.hidden = true, 2200); }
  function escapeHtml(value){ return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }

  async function init(){
    try {
      setupMapInteraction();
      bindControls();
      const guilds = await api('/api/guilds');
      els.guild.innerHTML = '';
      (guilds.guilds || []).forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.name + (g.connected ? ' • connected' : ' • offline'); els.guild.appendChild(o); });
      const requested = qs.get('guildId');
      if (requested && [...els.guild.options].some(o => o.value === requested)) els.guild.value = requested;
      if (els.guild.value) await load(); else setStatus('No guilds available');
    }
    catch (err) { setStatus('Failed: ' + err.message); }
  }

  function bindControls(){
    ['input','change'].forEach(evt => {
      [els.search, els.showVending, els.showTraveling, els.showOutOfStock, els.showPlayers, els.showMonuments].forEach(el => el.addEventListener(evt, render));
    });
    els.guild.addEventListener('change', load);
    document.getElementById('refreshNow').addEventListener('click', load);
    document.getElementById('fitMap').addEventListener('click', fitMap);
    document.getElementById('closeDetails').addEventListener('click', () => { state.selectedId = null; els.details.classList.add('closed'); render(); });
    document.getElementById('copyLink').addEventListener('click', async () => { await navigator.clipboard.writeText(location.origin + '/?token=' + encodeURIComponent(token) + '&guildId=' + encodeURIComponent(els.guild.value)); toast('Link copied'); });
    document.getElementById('exportJson').addEventListener('click', () => { window.open('/api/export?token=' + encodeURIComponent(token) + '&guildId=' + encodeURIComponent(els.guild.value), '_blank'); });
  }

  async function load(){
    if (!els.guild.value) return;
    setStatus('Loading…');
    const data = await api('/api/vendor-map?guildId=' + encodeURIComponent(els.guild.value));
    state.data = data;
    els.showOutOfStock.checked = !!data.config?.showOutOfStock;
    renderMapImage(data.map || {});
    render();
    setStatus('Updated ' + new Date(data.generatedAt).toLocaleTimeString());
    clearInterval(state.timer);
    const seconds = Math.max(2, data.config?.autoRefreshSeconds || 5);
    state.timer = setInterval(refreshQuietly, seconds * 1000);
  }

  async function refreshQuietly(){
    try {
      const data = await api('/api/vendor-map?guildId=' + encodeURIComponent(els.guild.value));
      const oldImage = state.data?.map?.image;
      state.data = data;
      if (data.map?.image && data.map.image !== oldImage) renderMapImage(data.map);
      render();
      setStatus('Updated ' + new Date(data.generatedAt).toLocaleTimeString());
    }
    catch (_) { /* keep stale data visible */ }
  }

  function renderMapImage(map){
    state.mapSize = map.mapSize || null; state.ocean = map.oceanMargin || 0;
    if (!map.image) { els.img.removeAttribute('src'); els.empty.style.display = 'block'; return; }
    els.empty.style.display = 'none';
    els.img.onload = () => { state.imgW = els.img.naturalWidth; state.imgH = els.img.naturalHeight; fitMap(); render(); };
    els.img.src = map.image;
  }

  function render(){
    const data = state.data || {}; const summary = data.summary || {};
    els.stats.innerHTML = stat(summary.vendingMachineCount, 'vending machines') + stat(summary.travelingVendorCount, 'traveling vendors') + stat(summary.inStockOrderCount, 'in-stock orders') + stat(summary.uniqueItems, 'unique items');
    const filtered = getFilteredVendors();
    renderVendorList(filtered);
    renderMarkers(filtered);
    renderEvents(data.events || []);
    if (state.selectedId) {
      const selected = [...(data.vendors?.vendingMachines || []), ...(data.vendors?.travelingVendors || [])].find(v => v.id === state.selectedId);
      if (selected) renderDetails(selected); else els.details.classList.add('closed');
    }
  }

  function stat(value, label){ return '<div class="stat"><b>' + escapeHtml(value ?? 0) + '</b><span>' + escapeHtml(label) + '</span></div>'; }

  function getFilteredVendors(){
    const data = state.data || {}; const q = els.search.value.trim().toLowerCase(); const out = [];
    if (els.showVending.checked) out.push(...(data.vendors?.vendingMachines || []));
    if (els.showTraveling.checked) out.push(...(data.vendors?.travelingVendors || []));
    return out.filter(v => {
      if (!q) return true;
      const vendorText = [v.label, v.location, v.grid, v.type].join(' ').toLowerCase();
      return vendorText.includes(q) || (v.orders || []).some(o => o.searchText.includes(q));
    });
  }

  function renderVendorList(vendors){
    if (!vendors.length) { els.vendorList.innerHTML = '<div class="muted">No vendors match the current filters.</div>'; return; }
    els.vendorList.innerHTML = vendors.map(v => {
      const stock = v.type === 'traveling' ? (v.halted ? 'halted' : 'moving') : (v.inStockCount + '/' + v.orderCount + ' in stock');
      return '<div class="vendor-row ' + (v.id === state.selectedId ? 'active' : '') + '" data-id="' + escapeHtml(v.id) + '"><div class="vendor-title"><span>' + icon(v) + ' ' + escapeHtml(v.label) + '</span><span>' + escapeHtml(v.grid || '') + '</span></div><div class="vendor-meta">' + escapeHtml(v.location || 'Unknown location') + '</div><span class="pill ' + (v.type === 'traveling' ? 'warn' : 'good') + '">' + escapeHtml(stock) + '</span></div>';
    }).join('');
    els.vendorList.querySelectorAll('.vendor-row').forEach(row => row.addEventListener('click', () => selectVendor(row.dataset.id)));
  }

  function renderMarkers(vendors){
    els.layer.innerHTML = '';
    const map = state.data?.map || {};
    if (els.showMonuments.checked) (map.monuments || []).forEach(m => addMarker({ id:'monument-' + m.token + '-' + m.x + '-' + m.y, type:'monument', label:m.name, x:m.x, y:m.y }, null));
    if (els.showPlayers.checked) (map.players || []).forEach(p => addMarker({ id:'player-' + p.name, type:'player', label:p.name, x:p.x, y:p.y }, null));
    vendors.forEach(v => addMarker(v, () => selectVendor(v.id)));
    applyTransform();
  }

  function addMarker(vendor, onclick){
    const pos = worldToPixels(vendor.x, vendor.y); const el = document.createElement('button');
    el.className = 'marker ' + vendor.type + (vendor.id === state.selectedId ? ' selected' : '');
    el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px'; el.title = (vendor.label || '') + ' ' + (vendor.location || '');
    el.innerHTML = icon(vendor) + '<span class="marker-label">' + escapeHtml(shortLabel(vendor)) + '</span>';
    if (onclick) el.addEventListener('click', e => { e.stopPropagation(); onclick(); });
    els.layer.appendChild(el);
  }

  function selectVendor(id){ state.selectedId = id; const all = [...(state.data?.vendors?.vendingMachines || []), ...(state.data?.vendors?.travelingVendors || [])]; const vendor = all.find(v => v.id === id); if (vendor) { centerOn(vendor.x, vendor.y); renderDetails(vendor); } render(); }
  function renderDetails(v){
    els.details.classList.remove('closed');
    const orders = (v.orders || []).filter(o => els.showOutOfStock.checked || o.inStock);
    els.detailsBody.innerHTML = '<h2>' + icon(v) + ' ' + escapeHtml(v.label) + '</h2><div class="muted">' + escapeHtml(v.location || 'Unknown location') + '</div><p><span class="pill">Grid ' + escapeHtml(v.grid || '?') + '</span><span class="pill">X ' + Math.round(v.x) + '</span><span class="pill">Y ' + Math.round(v.y) + '</span></p>' + (v.type === 'traveling' ? '<p class="pill warn">' + (v.halted ? 'Halted' : 'Moving') + '</p>' : '<h2>Sell orders</h2>' + (orders.length ? orders.map(orderHtml).join('') : '<div class="muted">No visible orders. Enable out-of-stock orders to see more.</div>'));
  }
  function orderHtml(o){ const left = escapeHtml((o.quantity || 0) + '× ' + o.itemName + (o.itemBlueprint ? ' BP' : '')); const right = escapeHtml((o.cost || 0) + '× ' + o.currencyName + (o.currencyBlueprint ? ' BP' : '')); return '<div class="order ' + (o.inStock ? '' : 'out') + '"><div class="item"><b>' + left + '</b><span>Stock: ' + escapeHtml(o.stock) + '</span></div><div class="arrow">for</div><div class="item"><b>' + right + '</b><span>Currency</span></div></div>'; }
  function renderEvents(events){ els.events.innerHTML = events.length ? events.slice(0,8).map(e => '<div class="event"><b>' + escapeHtml(new Date(e.time).toLocaleTimeString()) + '</b><br>' + escapeHtml(e.text) + '</div>').join('') : 'No events yet.'; }

  function icon(v){ return v.type === 'traveling' ? '🚚' : v.type === 'player' ? '👤' : v.type === 'monument' ? '◆' : '🛒'; }
  function shortLabel(v){ if (v.type === 'vending') return v.grid || 'Vendor'; if (v.type === 'traveling') return v.halted ? 'Halted' : 'Vendor'; return v.label || ''; }
  function worldToPixels(x,y){ if(!state.mapSize || !state.imgW || !state.imgH) return {x:0,y:0}; const effW = state.imgW - 2 * state.ocean; const effH = state.imgH - 2 * state.ocean; return { x: (x * (effW / state.mapSize)) + state.ocean, y: state.imgH - ((y * (effH / state.mapSize)) + state.ocean) }; }
  function applyTransform(){ const t = 'translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.scale + ')'; els.img.style.transform = t; els.layer.style.transform = t; }
  function fitMap(){ const rect = els.map.getBoundingClientRect(); if(!state.imgW || !state.imgH || !rect.width || !rect.height) return; state.scale = Math.min(rect.width / state.imgW, rect.height / state.imgH) || 1; state.x = (rect.width - state.imgW * state.scale) / 2; state.y = (rect.height - state.imgH * state.scale) / 2; applyTransform(); }
  function centerOn(x,y){ const pos = worldToPixels(x,y); const rect = els.map.getBoundingClientRect(); if(!pos) return; state.x = rect.width / 2 - pos.x * state.scale; state.y = rect.height / 2 - pos.y * state.scale; applyTransform(); }

  function setupMapInteraction(){
    let dragging = false, lx = 0, ly = 0;
    els.map.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; els.map.classList.add('dragging'); });
    window.addEventListener('mouseup', () => { dragging = false; els.map.classList.remove('dragging'); });
    window.addEventListener('mousemove', e => { if(!dragging) return; state.x += e.clientX - lx; state.y += e.clientY - ly; lx = e.clientX; ly = e.clientY; applyTransform(); });
    els.map.addEventListener('wheel', e => { e.preventDefault(); const rect = els.map.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top; const before = { x:(mx - state.x) / state.scale, y:(my - state.y) / state.scale }; const factor = e.deltaY < 0 ? 1.15 : 0.87; state.scale = Math.max(0.12, Math.min(8, state.scale * factor)); state.x = mx - before.x * state.scale; state.y = my - before.y * state.scale; applyTransform(); }, { passive:false });
    els.map.addEventListener('click', () => { state.selectedId = null; els.details.classList.add('closed'); render(); });
  }

  init();
})();`;
}

function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#ce412b"/><path d="M16 20h5l5 25h21l5-16H27" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="50" r="4" fill="#fff"/><circle cx="47" cy="50" r="4" fill="#fff"/></svg>`;
}
