// WebUI Panel Test Plugin (recreated)
// Localhost web UI to view/edit settings, notifications, and an interactive map for RustPlusPlus.
// Entirely plugin-only: runs its own HTTP server and does not touch core code.

const http = require('http');
const { URL } = require('url');
const Path = require('path');
const Fs = require('fs');

const DiscordButtons = require('../src/discordTools/discordButtons.js');
const DiscordTools = require('../src/discordTools/discordTools.js');

const PLUGIN_NAME = 'webui-panel.js';

let server = null;
let serverPort = null;
let token = null;

module.exports = {
  defaultEnabled: false,
  displayName: 'WebUI Panel (Test)',
  description: 'Localhost web UI to inspect/edit settings, notifications, and map (this plugin only).',

  configSchema: {
    note: { type: 'text', label: 'Note (stored in plugin settings)', default: '' }
  },

  onEnabled: async ({ client, guild }) => {
    try {
      if (!token) token = generateToken();
      if (!server) startServer(client);
      if (serverPort) {
        client.log(client.intlGet(null, 'infoCap'),
          `[webui] enabled for guild ${guild.id}. URL: http://127.0.0.1:${serverPort}/?token=${token}`);
      }
    } catch (e) {
      client.log(client.intlGet(null, 'errorCap'), `[webui] enable failed: ${e?.message || e}`, 'error');
    }
  },

  onLoad: async ({ client }) => {
    try {
      if (!token) token = generateToken();
      if (!server) startServer(client);
    } catch (e) {
      client.log(client.intlGet(null, 'errorCap'), `[webui] failed to start: ${e?.message || e}`, 'error');
    }
  },

  onUnload: async () => {
    try { if (server) server.close(); } catch (_) {}
    server = null; serverPort = null; token = null;
  },
};

function startServer(client) {
  server = http.createServer(async (req, res) => {
    try { await handleRequest(client, req, res); }
    catch (e) { sendJson(res, 500, { ok: false, error: e?.message || 'server error' }); }
  });
  server.listen(0, '127.0.0.1', () => {
    serverPort = server.address().port;
    client.log(client.intlGet(null, 'infoCap'),
      `[webui] listening at http://127.0.0.1:${serverPort}/?token=${token}`);
  });
  server.on('error', (e) => {
    client.log(client.intlGet(null, 'errorCap'), `[webui] server error: ${e?.message || e}`, 'error');
  });
}

async function handleRequest(client, req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');

  // Static assets without auth
  if (req.method === 'GET' && url.pathname === '/app.css') return sendCss(res, 200, appCss());
  if (req.method === 'GET' && url.pathname === '/app.js') return sendJs(res, 200, appJs());
  if (req.method === 'GET' && url.pathname === '/favicon.svg') return sendSvg(res, 200, faviconSvg());

  // Auth for HTML + APIs
  if (req.method !== 'GET' || url.pathname === '/') {
    if (!checkToken(url, req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  }

  if (req.method === 'GET' && url.pathname === '/') return sendHtml(res, 200, htmlPage());

  if (req.method === 'GET' && url.pathname === '/api/ping') return sendJson(res, 200, { ok: true, pong: true });
  if (req.method === 'GET' && url.pathname === '/api/guilds') return sendJson(res, 200, listGuilds(client));
  if (req.method === 'GET' && url.pathname === '/api/schema') return getSchema(res);
  if (req.method === 'GET' && url.pathname === '/api/state') return getState(client, url, res);
  if (req.method === 'POST' && url.pathname === '/api/settings') return postSettings(client, url, req, res);
  if (req.method === 'GET' && url.pathname === '/api/notifications') return getNotifications(client, url, res);
  if (req.method === 'POST' && url.pathname === '/api/notifications') return postNotifications(client, url, req, res);

  return sendJson(res, 404, { ok: false, error: 'not found' });
}

function checkToken(url, req) {
  const q = url.searchParams.get('token');
  const h = req.headers['x-webui-token'];
  if (!token) return false;
  return q === token || h === token;
}

function listGuilds(client) {
  const out = [];
  try { for (const [id, g] of client.guilds.cache) out.push({ id, name: g.name }); } catch (_) {}
  return { ok: true, guilds: out };
}

function getSettingsObj(client, guildId) {
  try {
    const instance = client.getInstance(guildId);
    if (!instance) return { instance: null, settings: null };
    if (!instance.pluginSettings) instance.pluginSettings = {};
    if (!instance.pluginSettings[PLUGIN_NAME]) instance.pluginSettings[PLUGIN_NAME] = {};
    return { instance, settings: instance.pluginSettings[PLUGIN_NAME] };
  } catch (_) { return { instance: null, settings: null }; }
}

function getSchema(res) {
  try { return sendJson(res, 200, { ok: true, schema: module.exports.configSchema || {} }); }
  catch (_) { return sendJson(res, 200, { ok: true, schema: {} }); }
}

function getState(client, url, res) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return sendJson(res, 400, { ok: false, error: 'guildId required' });
  const { settings } = getSettingsObj(client, guildId);
  if (!settings) return sendJson(res, 404, { ok: false, error: 'guild not found' });

  const payload = { ok: true, plugin: PLUGIN_NAME, settings };

  // Add map+players
  try {
    const rp = client.rustplusInstances[guildId];
    const mapObj = { players: [], cargo: [], heli: [] };
    if (rp && rp.info) {
      mapObj.mapSize = rp.info.mapSize || null;
      try { mapObj.width = rp.map && (rp.map.width || rp.map._width) || null; } catch (_) {}
      try { mapObj.height = rp.map && (rp.map.height || rp.map._height) || null; } catch (_) {}
      try { mapObj.oceanMargin = rp.map && (rp.map.oceanMargin || rp.map._oceanMargin) || 0; } catch (_) {}
      try { if (rp.team && Array.isArray(rp.team.players)) {
        for (const p of rp.team.players) mapObj.players.push({ name: p.name, x: p.x, y: p.y, online: p.isOnline, alive: p.isAlive });
      } } catch (_) {}
      // Overlays: cargo ship & patrol heli (last known positions)
      try {
        if (rp.cargoShipTracers) {
          for (const [id, coords] of Object.entries(rp.cargoShipTracers)) {
            if (Array.isArray(coords) && coords.length) {
              const last = coords[coords.length - 1];
              if (last && typeof last.x === 'number' && typeof last.y === 'number') {
                mapObj.cargo.push({ x: last.x, y: last.y });
              }
            }
          }
        }
      } catch (_) {}
      // Vending machines
      try {
        if (rp.mapMarkers && Array.isArray(rp.mapMarkers.vendingMachines)) {
          for (const vm of rp.mapMarkers.vendingMachines) {
            const itemList = [];
            try {
              if (Array.isArray(vm.sellOrders)) {
                for (const order of vm.sellOrders) {
                  const itemId = order.itemId;
                  const currencyId = order.currencyId;
                  const itemName = (client.items && itemId!=null) ? client.items.getName(itemId) : null;
                  const currencyName = (client.items && currencyId!=null) ? client.items.getName(currencyId) : null;
                  itemList.push({
                    itemId, itemName,
                    currencyId, currencyName,
                    quantity: order.quantity, cost: order.costPerItem,
                    stock: order.amountInStock,
                    itemBP: !!order.itemIsBlueprint,
                    currencyBP: !!order.currencyIsBlueprint,
                  });
                }
              }
            } catch (_) {}
            mapObj.vending = mapObj.vending || [];
            mapObj.vending.push({ x: vm.x, y: vm.y, items: itemList, title: (vm.location && vm.location.string) ? vm.location.string : null });
          }
        }
      } catch (_) {}
      try {
        if (rp.patrolHelicopterTracers) {
          for (const [id, coords] of Object.entries(rp.prolHelicopterTracers || rp.patrolHelicopterTracers)) {
            if (Array.isArray(coords) && coords.length) {
              const last = coords[coords.length - 1];
              if (last && typeof last.x === 'number' && typeof last.y === 'number') {
                mapObj.heli.push({ x: last.x, y: last.y });
              }
            }
          }
        }
      } catch (_) {}
      // embed map image as data URI if present
      try {
        const full = Path.join(__dirname, '..', 'maps', `${guildId}_map_full.png`);
        const clean = Path.join(__dirname, '..', 'maps', `${guildId}_map_clean.png`);
        const file = Fs.existsSync(full) ? full : (Fs.existsSync(clean) ? clean : null);
        if (file) {
          const buf = Fs.readFileSync(file);
          mapObj.image = `data:image/png;base64,${buf.toString('base64')}`;
        } else mapObj.image = null;
      } catch (_) {}
    }
    payload.map = mapObj;
  } catch (_) {}

  return sendJson(res, 200, payload);
}

async function postSettings(client, url, req, res) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return sendJson(res, 400, { ok: false, error: 'guildId required' });
  const { instance, settings } = getSettingsObj(client, guildId);
  if (!instance || !settings) return sendJson(res, 404, { ok: false, error: 'guild not found' });

  const body = await readJson(req);
  if (typeof body !== 'object' || Array.isArray(body) || !body) return sendJson(res, 400, { ok: false, error: 'invalid json' });

  for (const [k, v] of Object.entries(body)) settings[k] = v;
  instance.pluginSettings[PLUGIN_NAME] = settings;
  try { client.setInstance(guildId, instance); } catch (_) {}
  return sendJson(res, 200, { ok: true, settings });
}

function getNotifications(client, url, res) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return sendJson(res, 400, { ok: false, error: 'guildId required' });
  try {
    const instance = client.getInstance(guildId);
    if (!instance) return sendJson(res, 404, { ok: false, error: 'guild not found' });
    return sendJson(res, 200, { ok: true, notifications: instance.notificationSettings || {} });
  } catch (e) { return sendJson(res, 500, { ok: false, error: e?.message || 'error' }); }
}

async function postNotifications(client, url, req, res) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return sendJson(res, 400, { ok: false, error: 'guildId required' });
  let body = await readJson(req);
  if (typeof body !== 'object' || !body || Array.isArray(body)) return sendJson(res, 400, { ok: false, error: 'invalid json' });
  try {
    const instance = client.getInstance(guildId);
    if (!instance) return sendJson(res, 404, { ok: false, error: 'guild not found' });
    const notif = instance.notificationSettings || {};
    for (const [key, val] of Object.entries(body)) {
      if (!notif[key] || typeof val !== 'object') continue;
      if (typeof val.discord === 'boolean') notif[key].discord = val.discord;
      if (typeof val.inGame === 'boolean') notif[key].inGame = val.inGame;
      if (typeof val.voice === 'boolean') notif[key].voice = val.voice;
    }
    instance.notificationSettings = notif;
    try { client.setInstance(guildId, instance); } catch (_) {}
    // Update live
    try {
      const rp = client.rustplusInstances[guildId];
      if (rp && rp.notificationSettings) {
        for (const [key, v] of Object.entries(body)) {
          if (rp.notificationSettings[key]) {
            if (typeof v.discord === 'boolean') rp.notificationSettings[key].discord = v.discord;
            if (typeof v.inGame === 'boolean') rp.notificationSettings[key].inGame = v.inGame;
            if (typeof v.voice === 'boolean') rp.notificationSettings[key].voice = v.voice;
          }
        }
      }
    } catch (_) {}
    // Partial UI refresh on Discord
    try { await refreshNotificationMessages(client, guildId, body, notif); } catch (_) {}
    return sendJson(res, 200, { ok: true, notifications: notif });
  } catch (e) { return sendJson(res, 500, { ok: false, error: e?.message || 'error' }); }
}

async function refreshNotificationMessages(client, guildId, changes, currentNotif) {
  const instance = client.getInstance(guildId);
  const chId = instance?.channelId?.settings;
  if (!chId) return;
  const channel = DiscordTools.getTextChannelById(guildId, chId);
  if (!channel) return;
  let messages; try { messages = await channel.messages.fetch({ limit: 100 }); } catch (_) { return; }
  for (const key of Object.keys(changes || {})) {
    const title = client.intlGet(guildId, key);
    const msg = messages.find(m => (m.embeds && m.embeds[0] && m.embeds[0].title === title));
    if (!msg) continue;
    const v = currentNotif[key] || {};
    const row = DiscordButtons.getNotificationButtons(guildId, key, !!v.discord, !!v.inGame, !!v.voice);
    try { await client.messageEdit(msg, { components: [row] }); } catch (_) {}
  }
}

function sendHtml(res, status, html) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
function sendCss(res, status, css) { res.writeHead(status, { 'Content-Type': 'text/css; charset=utf-8' }); res.end(css); }
function sendJs(res, status, js) { res.writeHead(status, { 'Content-Type': 'application/javascript; charset=utf-8' }); res.end(js); }
function sendSvg(res, status, svg) { res.writeHead(status, { 'Content-Type': 'image/svg+xml; charset=utf-8' }); res.end(svg); }
function sendJson(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function generateToken() { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }

function htmlPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Rust++ WebUI</title>
  <link rel="icon" href="/favicon.svg" />
  <link rel="stylesheet" href="/app.css" />
</head>
<body>
  <header class="app-header">
    <div class="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2 L2 7 L12 12 L22 7 Z"/><path d="M2 17 L12 22 L22 17"/><path d="M2 12 L12 17 L22 12"/></svg>
      <span>Rust++ WebUI</span>
    </div>
    <div class="header-actions">
      <select id="guild" class="input small"></select>
      <button id="copyUrl" class="btn ghost" title="Copy URL">Copy URL</button>
    </div>
  </header>

  <div class="layout">
    <aside class="sidebar">
      <nav class="nav">
        <a href="#" class="nav-link active" data-tab="overview"><span>Overview</span></a>
        <a href="#" class="nav-link" data-tab="map"><span>Map</span></a>
        <a href="#" class="nav-link" data-tab="settings"><span>Settings</span></a>
        <a href="#" class="nav-link" data-tab="notifications"><span>Notifications</span></a>
        <a href="#" class="nav-link" data-tab="state"><span>Raw State</span></a>
        <a href="#" class="nav-link" data-tab="about"><span>About</span></a>
      </nav>
    </aside>
    <main class="content">
      <section id="tab-overview" class="tab active">
        <div class="card">
          <h3>Overview</h3>
          <p class="muted">Edit settings, notifications, and view the map. Changes are per guild.</p>
          <div class="stats">
            <div class="stat"><div class="label">Status</div><div id="status" class="value">Ready</div></div>
            <div class="stat"><div class="label">Guilds</div><div id="guildCount" class="value">-</div></div>
          </div>
        </div>
      </section>

      <section id="tab-map" class="tab">
        <div class="card">
          <h3>Interactive Map</h3>
          <div class="map-wrap" id="mapWrap">
            <img id="mapImg" alt="map" />
            <div id="mapMarkers" class="map-markers"></div>
          </div>
          <div class="row actions">
            <button id="mapReset" class="btn ghost">Reset View</button>
          </div>
          <div id="mapNotice" class="muted"></div>
        </div>
      </section>

      <section id="tab-settings" class="tab">
        <div class="card">
          <h3>Settings</h3>
          <div id="form" class="form"></div>
          <div class="row add-field">
            <input id="newKey" class="input" placeholder="newKey" />
            <button id="addBtn" class="btn">Add Field</button>
          </div>
          <div class="row actions">
            <button id="saveBtn" class="btn primary">Save</button>
            <button id="reloadBtn" class="btn ghost">Reload</button>
          </div>
        </div>
      </section>

      <section id="tab-notifications" class="tab">
        <div class="card">
          <h3>Notification Settings</h3>
          <p class="muted">Toggle how each event notifies: Discord text, In‑Game chat, and Voice.</p>
          <div id="notifList" class="notif-list"></div>
          <div class="row actions">
            <button id="saveNotifBtn" class="btn primary">Save Notifications</button>
            <button id="reloadNotifBtn" class="btn ghost">Reload</button>
          </div>
        </div>
      </section>

      <section id="tab-state" class="tab">
        <div class="card">
          <h3>Raw State</h3>
          <pre id="state" class="code">loading...</pre>
        </div>
      </section>

      <section id="tab-about" class="tab">
        <div class="card">
          <h3>About</h3>
          <p>Local WebUI for RustPlusPlus. Token-protected, localhost-only, plugin-based.</p>
        </div>
      </section>
    </main>
  </div>

  <div id="toast" class="toast" hidden></div>

  <script src="/app.js"></script>
</body>
</html>`;
}

function appCss() {
  return `:root{--bg:#0e0f12;--panel:#131722;--panel2:#0f131c;--muted:#9aa3b2;--text:#e6e9ef;--primary:#CE412B;--border:#232735;--accent:#1f2532}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 10% 0%,#0b0c11 10%,#0c0e14 60%,#0b0c11 100%);color:var(--text);font:14px/1.55 system-ui,Segoe UI,Roboto,Arial,sans-serif}
.app-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);background:rgba(18,20,28,.75);backdrop-filter:blur(10px);position:sticky;top:0;z-index:10}
.brand{display:flex;gap:10px;align-items:center;font-weight:700;letter-spacing:.2px}
.header-actions{display:flex;gap:10px;align-items:center}
.layout{display:grid;grid-template-columns:220px 1fr;gap:0}
.sidebar{min-height:calc(100vh - 56px);border-right:1px solid var(--border);background:linear-gradient(180deg,var(--panel),var(--panel2));position:sticky;top:56px}
.nav{display:flex;flex-direction:column;padding:10px}
.nav-link{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;color:var(--muted);text-decoration:none;cursor:pointer}
.nav-link:hover{background:#1a2030;color:#e5e9f0}
.nav-link.active{background:#21283a;color:#fff;border:1px solid #2b3346}
.content{padding:18px;min-height:calc(100vh - 56px)}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:18px;box-shadow:0 8px 32px rgba(0,0,0,.25)}
.tab{display:none}
.tab.active{display:block;animation:fade .15s ease-in}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.row{margin:12px 0;display:flex;gap:10px;align-items:center}
.lbl{min-width:120px;color:var(--muted)}
.input,select,textarea{flex:1;min-width:0;background:#0f1218;border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px}
.input.small{width:220px}
.input::placeholder{color:#5d6780}
.muted{color:var(--muted)}
.btn{background:#222735;border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:8px;cursor:pointer}
.btn:hover{background:#262c3b}
.btn.primary{background:var(--primary);border-color:#ab3523}
.btn.primary:hover{filter:brightness(1.05)}
.btn.ghost{background:transparent}
.form .field{display:grid;grid-template-columns:200px 1fr 90px;gap:10px;align-items:center;margin:10px 0}
.field .key{color:var(--muted)}
.field .type{color:#6b768c;text-align:right}
.notif-list{display:grid;grid-template-columns:1fr;gap:10px}
.notif{display:grid;grid-template-columns:1fr repeat(3,120px);align-items:center;gap:10px;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px}
.notif .title{font-weight:600}
.notif .toggles{display:contents}
.notif .toggles .cell{display:flex;align-items:center;gap:8px;justify-content:center}
.switch{position:relative;width:44px;height:24px;background:#30364a;border-radius:999px;border:1px solid var(--border)}
.switch input{display:none}
.switch .knob{position:absolute;top:2px;left:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:.2s}
.switch input:checked + .knob{left:24px;background:#dff9e5}
.code{background:#0b0c11;border:1px solid var(--border);padding:12px;border-radius:8px;overflow:auto;min-height:260px}
.toast{position:fixed;bottom:16px;right:16px;background:#1b2030;border:1px solid var(--border);padding:10px 14px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.35)}
.add-field{justify-content:flex-start}
/* Map */
.map-wrap{position:relative;overflow:hidden;border-radius:8px;border:1px solid var(--border);background:#0b0c11;aspect-ratio:1/1}
#mapImg{position:absolute;top:0;left:0;transform-origin:0 0;user-select:none;pointer-events:none}
.map-markers{position:absolute;top:0;left:0;transform-origin:0 0}
.marker{position:absolute;transform:translate(-50%, -100%);color:#fff;font-size:12px;white-space:nowrap}
.marker .bubble{background:#CE412B;border:1px solid #ab3523;border-radius:6px;padding:3px 6px;display:inline-block}
.marker.off .bubble{background:#555;border-color:#444}
.marker .tip{width:8px;height:8px;background:inherit;border:inherit;transform:rotate(45deg);position:absolute;left:50%;bottom:-4px;transform-origin:center;translate:-50% 0}
.marker.cargo{background:#1976d2;border-color:#125a9c}
.marker.heli{background:#43a047;border-color:#2e7d32}
`;
}

function appJs() {
  return `(function(){
    if (window.__RPP_WEBUI__) return; window.__RPP_WEBUI__ = true;
    const qs=(k)=>new URLSearchParams(location.search).get(k);
    const token=qs('token')||'';
    const hdr={'x-webui-token':token,'Content-Type':'application/json'};
    async function j(u,o={}){const r=await fetch(u,o); if(!r.ok) throw new Error(await r.text()); return await r.json()}
    const guildSel=document.getElementById('guild');
    const formEl=document.getElementById('form');
    const stateEl=document.getElementById('state');
    const toastEl=document.getElementById('toast');
    const mapImg=document.getElementById('mapImg');
    const mapMarkers=document.getElementById('mapMarkers');
    const mapWrap=document.getElementById('mapWrap');
    let scale=1, offX=0, offY=0, dragging=false, lastX=0, lastY=0, imgW=0, imgH=0, ocean=0, mapSize=null;

    function toast(msg){ toastEl.textContent=msg; toastEl.hidden=false; clearTimeout(toastEl._t); toastEl._t=setTimeout(()=>toastEl.hidden=true,2000); }
    function setStatus(t){ const el=document.getElementById('status'); if(el) el.textContent=t; }
    function copyUrl(){ const url=location.origin+'/?token='+(token||''); navigator.clipboard.writeText(url).then(()=>toast('URL copied')); }
    function setTab(name){ document.querySelectorAll('.tab').forEach(el=>el.classList.remove('active')); document.querySelectorAll('.nav-link').forEach(el=>el.classList.remove('active')); const t=document.getElementById('tab-'+name); const l=document.querySelector('.nav-link[data-tab="'+name+'"]'); if(t) t.classList.add('active'); if(l) l.classList.add('active'); }

    async function init(){ try{ const g=await j('/api/guilds?token='+encodeURIComponent(token)); guildSel.innerHTML=''; (g.guilds||[]).forEach(x=>{ const o=document.createElement('option'); o.value=x.id; o.textContent=x.name+' ('+x.id+')'; guildSel.appendChild(o); }); const gc=document.getElementById('guildCount'); if(gc) gc.textContent=(g.guilds||[]).length; if((g.guilds||[]).length){ guildSel.value=g.guilds[0].id; } guildSel.onchange=()=>{ loadState(); loadNotifications(); }; document.getElementById('addBtn').onclick=()=>addField(document.getElementById('newKey').value||'key',''); document.getElementById('saveBtn').onclick=saveSettings; document.getElementById('reloadBtn').onclick=loadState; document.getElementById('copyUrl').onclick=copyUrl; const sn=document.getElementById('saveNotifBtn'); if(sn) sn.onclick=saveNotifications; const rn=document.getElementById('reloadNotifBtn'); if(rn) rn.onclick=loadNotifications; document.querySelectorAll('.nav-link').forEach(a=>a.addEventListener('click',e=>{ e.preventDefault(); setTab(a.dataset.tab);})); document.getElementById('mapReset').onclick=()=>{ scale=1; offX=0; offY=0; applyTransform(); }; setupPanZoom(); await loadState(); await loadNotifications(); setInterval(updateMap, 5000); } catch(e){ setStatus('Failed: '+e.message); } }

    function setupPanZoom(){
      mapWrap.addEventListener('mousedown', (e)=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; });
      window.addEventListener('mousemove', (e)=>{ if(!dragging) return; offX += (e.clientX-lastX); offY += (e.clientY-lastY); lastX=e.clientX; lastY=e.clientY; applyTransform(); });
      window.addEventListener('mouseup', ()=>{ dragging=false; });
      mapWrap.addEventListener('wheel', (e)=>{ e.preventDefault(); const rect=mapWrap.getBoundingClientRect(); const mx=e.clientX-rect.left; const my=e.clientY-rect.top; const delta = e.deltaY<0 ? 1.1 : 0.9; const sxOld=scale; scale = Math.max(0.2, Math.min(4, scale*delta)); offX = mx - (mx - offX)*(scale/sxOld); offY = my - (my - offY)*(scale/sxOld); applyTransform(); }, { passive:false });
    }
    function applyTransform(){ const t='translate(' + offX + 'px, ' + offY + 'px) scale(' + scale + ')'; mapImg.style.transform=t; mapMarkers.style.transform=t; }

    function inferType(v){ if(typeof v==='boolean') return 'bool'; if(typeof v==='number') return 'number'; if(typeof v==='string' && /^\\d+(\\.\\d+)?$/.test(v)) return 'number'; return 'text'; }
    function makeInput(kind,val,key){ if(kind==='bool'){ const w=document.createElement('label'); w.className='switch'; const c=document.createElement('input'); c.type='checkbox'; c.checked=(val===true||String(val).toLowerCase()==='true'); const k=document.createElement('span'); k.className='knob'; w.appendChild(c); w.appendChild(k); w.dataset.key=key; return w; } const i=document.createElement('input'); i.className='input'; i.value=(val==null?'':String(val)); if(kind==='number') i.type='number'; i.dataset.key=key; return i; }
    function renderSettings(schema, settings){ formEl.innerHTML=''; const keys=new Set([...(Object.keys(settings||{})), ...(Object.keys(schema||{}))]); keys.forEach(k=>{ const val=(settings||{})[k]; const kind=inferType(val); const row=document.createElement('div'); row.className='field'; const keyEl=document.createElement('div'); keyEl.className='key'; keyEl.textContent=((schema||{})[k]?.label||k); const input=makeInput(kind,val,k); const type=document.createElement('div'); type.className='type'; type.textContent=kind; row.appendChild(keyEl); row.appendChild(input); row.appendChild(type); formEl.appendChild(row); }); }
    function addField(k,v){ const row=document.createElement('div'); row.className='field'; const keyEl=document.createElement('div'); keyEl.className='key'; keyEl.textContent=k; const inp=document.createElement('input'); inp.className='input'; inp.value=v; inp.dataset.key=k; const type=document.createElement('div'); type.className='type'; type.textContent='text'; row.appendChild(keyEl); row.appendChild(inp); row.appendChild(type); formEl.appendChild(row); }
    async function saveSettings(){ const gid=guildSel.value; const inputs=[...formEl.querySelectorAll('[data-key]')]; const payload={}; inputs.forEach(el=>{ const k=el.dataset.key; if(el.tagName==='LABEL'){ const chk=el.querySelector('input[type=checkbox]'); payload[k]=!!chk.checked; } else { const val=el.value; payload[k]= (val===''?'':(/^\\d+(\\.\\d+)?$/.test(val)? Number(val): val)); } }); const r=await fetch('/api/settings?guildId='+encodeURIComponent(gid), { method:'POST', headers:hdr, body:JSON.stringify(payload) }); if(!r.ok){ toast('Save failed'); return; } toast('Saved'); await loadState(); }

    async function loadState(){ try{ setStatus('Loading...'); const gid=guildSel.value; const [schema,data] = await Promise.all([ j('/api/schema?token='+encodeURIComponent(token)), j('/api/state?guildId='+encodeURIComponent(gid)+'&token='+encodeURIComponent(token)) ]); stateEl.textContent=JSON.stringify(data,null,2); renderSettings(schema.schema||{}, (data||{}).settings||{}); renderMap((data||{}).map||{}); setStatus('Ready'); } catch(e){ setStatus('Error: '+e.message); } }
    function renderMap(map){ const notice=document.getElementById('mapNotice'); if(!map || !map.image){ mapImg.src=''; mapMarkers.innerHTML=''; if(notice) notice.textContent='Map not available yet.'; return; } if(notice) notice.textContent=''; mapImg.onload=()=>{ imgW=mapImg.naturalWidth; imgH=mapImg.naturalHeight; ocean=map.oceanMargin||0; mapSize=map.mapSize||null; const rect=mapWrap.getBoundingClientRect(); const fit=Math.min(rect.width/imgW, rect.height/imgH); scale=(isFinite(fit)&&fit>0)?fit:1; offX=(rect.width - imgW*scale)/2; offY=(rect.height - imgH*scale)/2; applyTransform(); drawPlayers(map); }; mapImg.src=map.image; }
    function worldToPixels(x,y){ if(!mapSize || !imgW || !imgH){ return { x: 0, y: 0 }; } const effW = imgW - 2*ocean; const effH = imgH - 2*ocean; const px = (x * (effW / mapSize)) + ocean; const py = imgH - ((y * (effH / mapSize)) + ocean); return { x: px, y: py }; }
    function drawPlayers(map){
      mapMarkers.innerHTML='';
      (map.players||[]).forEach(p=>{ const pos=worldToPixels(p.x,p.y); const el=document.createElement('div'); el.className='marker player'+(p.online&&p.alive?'':' off'); el.style.left=pos.x+'px'; el.style.top=pos.y+'px'; el.innerHTML='<span class="bubble">'+escapeHtml(p.name)+'</span><span class="tip"></span>'; mapMarkers.appendChild(el); });
      (map.cargo||[]).forEach(c=>{ const pos=worldToPixels(c.x,c.y); const el=document.createElement('div'); el.className='marker cargo'; el.style.left=pos.x+'px'; el.style.top=pos.y+'px'; el.innerHTML='<span class="bubble">🚢 Cargo</span><span class="tip"></span>'; mapMarkers.appendChild(el); });
      (map.heli||[]).forEach(h=>{ const pos=worldToPixels(h.x,h.y); const el=document.createElement('div'); el.className='marker heli'; el.style.left=pos.x+'px'; el.style.top=pos.y+'px'; el.innerHTML='<span class="bubble">🚁 Heli</span><span class="tip"></span>'; mapMarkers.appendChild(el); });
    }
    function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    async function updateMap(){ try{ const gid=guildSel.value; const data = await j('/api/state?guildId='+encodeURIComponent(gid)+'&token='+encodeURIComponent(token)); if(data && data.map && mapImg.src){ drawPlayers(data.map); } } catch(_){} }

    function renderNotifications(notif){ const list=document.getElementById('notifList'); if(!list) return; list.innerHTML=''; const header=document.createElement('div'); header.className='notif'; header.innerHTML='<div class="title">Event</div><div class="cell">Discord</div><div class="cell">In-Game</div><div class="cell">Voice</div>'; list.appendChild(header); Object.entries(notif||{}).forEach(([k,v])=>{ const row=document.createElement('div'); row.className='notif'; const title=document.createElement('div'); title.className='title'; title.textContent=k; function cell(field,checked){ const cell=document.createElement('div'); cell.className='cell'; const lbl=document.createElement('label'); lbl.className='switch'; const c=document.createElement('input'); c.type='checkbox'; c.checked=!!checked; const knob=document.createElement('span'); knob.className='knob'; lbl.appendChild(c); lbl.appendChild(knob); lbl.dataset.key=k; lbl.dataset.field=field; cell.appendChild(lbl); return cell; } row.appendChild(title); row.appendChild(cell('discord', v?.discord)); row.appendChild(cell('inGame', v?.inGame)); row.appendChild(cell('voice', v?.voice)); list.appendChild(row); }); }
    async function loadNotifications(){ try{ const gid=guildSel.value; const data=await j('/api/notifications?guildId='+encodeURIComponent(gid)+'&token='+encodeURIComponent(token)); renderNotifications(data.notifications||{}); } catch(e){ setStatus('Error: '+e.message); } }
    async function saveNotifications(){ const gid=guildSel.value; const rows=[...document.querySelectorAll('#notifList .notif')].slice(1); const payload={}; rows.forEach(r=>{ const key=r.querySelector('.title').textContent; const switches=r.querySelectorAll('label.switch'); const obj={}; switches.forEach(s=>{ const field=s.dataset.field; const chk=s.querySelector('input[type=checkbox]'); obj[field]=!!chk.checked; }); payload[key]=obj; }); const resp=await fetch('/api/notifications?guildId='+encodeURIComponent(gid), { method:'POST', headers:hdr, body:JSON.stringify(payload) }); if(!resp.ok){ toast('Save failed'); return; } toast('Notifications saved'); await loadNotifications(); }

    init();
  })();`;
}

function faviconSvg(){
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#CE412B'/><stop offset='1' stop-color='#7b1c10'/></linearGradient></defs><rect width='64' height='64' rx='12' fill='url(#g)'/><path d='M10 22 L32 12 L54 22 L32 32 Z' fill='rgba(255,255,255,.9)'/><path d='M10 42 L32 32 L54 42 L32 52 Z' fill='rgba(255,255,255,.75)'/></svg>`;
}

