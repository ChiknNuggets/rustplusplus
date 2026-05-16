// Interactive Vendor Map plugin for RustPlusPlus.
// Runs a local, token-protected web UI for browsing vending machines and traveling vendors.

const http = require('http');
const { URL } = require('url');
const Path = require('path');
const Fs = require('fs');
const Scrape = require('../src/util/scrape.js');

const PLUGIN_NAME = 'vendor-map-web.js';

let server = null;
let serverPort = null;
let serverHost = null;
let serverRequestedPort = null;
let authToken = null;
let configWatcher = null;
let serverClosing = null;
const steamAvatarCache = new Map();
const recentEvents = new Map();

module.exports = {
  defaultEnabled: false,
  displayName: 'Interactive Vendor Map',
  description: 'Token-protected local web UI with pan/zoom map, vendor search, filters, and live vendor details.',

  configSchema: {
    bindHost: { type: 'text', label: 'IP', default: '127.0.0.1' },
    port: { type: 'text', label: 'Port (0 = random)', default: '0' },
    publicIpAddress: { type: 'text', label: 'Public IP address or hostname', default: '' },
    autoRefreshSeconds: { type: 'text', label: 'Auto-refresh seconds', default: '5' }
  },

  onLoad: ({ client }) => {
    startConfigWatcher(client);
  },

  onEnabled: async ({ client, guild }) => {
    await ensureServer(client, guild?.id);
    logUrl(client, guild?.id);
  },

  onDisabled: async ({ client }) => {
    const preferredGuildId = getPreferredConfigGuildId(client);
    if (preferredGuildId) await ensureServer(client, preferredGuildId);
    else await closeServer();
  },

  onUnload: async () => {
    await closeServer();
    if (configWatcher) clearInterval(configWatcher);
    configWatcher = null;
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
        await ensureServer(client, interaction.guildId);
        const url = getPublicUrl(client, interaction.guildId);
        await interaction.reply({
          ephemeral: true,
          content: url ? `Interactive vendor map: ${url}` : 'Vendor map server is starting. Try again in a few seconds.'
        });
      }
    }
  ]
};

async function ensureServer(client, guildId = null) {
  if (!authToken) authToken = generateToken();
  startConfigWatcher(client);

  const desired = getDefaultServerConfig(client, guildId);
  if (server) {
    if (serverHost === desired.host && serverRequestedPort === desired.port) return;
    await closeServer();
  }
  if (serverClosing) await serverClosing;

  serverHost = desired.host;
  serverRequestedPort = desired.port;
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
    serverHost = null;
    serverRequestedPort = null;
    client.log(client.intlGet(null, 'errorCap'), `[vendor-map] server error: ${err?.message || err}`, 'error');
  });

  await new Promise((resolve) => {
    const activeServer = server;
    activeServer.once('listening', () => {
      serverPort = activeServer.address().port;
      client.log(client.intlGet(null, 'infoCap'), `[vendor-map] listening at ${getPublicUrl(client, guildId)} (configured ${desired.host}:${desired.port || 'random'})`);
      resolve();
    });
    activeServer.once('error', () => resolve());
    activeServer.listen(desired.port, desired.host);
  });
}

async function closeServer() {
  const activeServer = server;
  server = null;
  serverPort = null;
  serverHost = null;
  serverRequestedPort = null;
  if (!activeServer) {
    if (serverClosing) await serverClosing;
    return;
  }

  serverClosing = new Promise((resolve) => {
    try {
      if (activeServer.listening) activeServer.close(() => resolve());
      else resolve();
    }
    catch (_) { resolve(); }
  });
  await serverClosing;
  serverClosing = null;
}

function startConfigWatcher(client) {
  if (configWatcher) return;
  configWatcher = setInterval(async () => {
    const preferredGuildId = getPreferredConfigGuildId(client);
    if (!preferredGuildId) {
      if (server) await closeServer();
      return;
    }
    if (!server) {
      await ensureServer(client, preferredGuildId);
      return;
    }
    const desired = getDefaultServerConfig(client, preferredGuildId);
    if (serverHost !== desired.host || serverRequestedPort !== desired.port) {
      client.log(client.intlGet(null, 'infoCap'), `[vendor-map] restarting to apply configured bind ${desired.host}:${desired.port || 'random'}`);
      await ensureServer(client, preferredGuildId);
    }
  }, 5000);
}

function getDefaultServerConfig(client, guildId = null) {
  const settings = guildId ? getPluginSettings(client, guildId) : getFirstPluginSettings(client);
  const host = String(settings.bindHost || '127.0.0.1').trim() || '127.0.0.1';
  const parsedPort = parseInt(settings.port, 10);
  return { host, port: Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : 0 };
}

function getFirstPluginSettings(client) {
  const preferredGuildId = getPreferredConfigGuildId(client);
  return preferredGuildId ? getPluginSettings(client, preferredGuildId) : {};
}

function getPreferredConfigGuildId(client) {
  try {
    for (const guild of client.guilds.cache.values()) {
      const instance = client.getInstance(guild.id);
      const settings = instance?.pluginSettings?.[PLUGIN_NAME];
      if (settings && settings.enabled !== false && (settings.port !== undefined || settings.bindHost !== undefined)) return guild.id;
    }
    for (const guild of client.guilds.cache.values()) {
      const instance = client.getInstance(guild.id);
      const settings = instance?.pluginSettings?.[PLUGIN_NAME];
      if (settings && settings.enabled !== false) return guild.id;
    }
  }
  catch (_) { /* ignore */ }
  return null;
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
  const url = getPublicUrl(client, guildId);
  if (!url) return;
  client.log(client.intlGet(null, 'infoCap'), `[vendor-map] URL${guildId ? ` for guild ${guildId}` : ''}: ${url}`);
}

function getPublicUrl(client, guildId = '') {
  if (!serverPort || !authToken) return null;
  const origin = getPublicOrigin(client, guildId);
  const guildPart = guildId ? `&guildId=${encodeURIComponent(guildId)}` : '';
  return `${origin}/?token=${encodeURIComponent(authToken)}${guildPart}`;
}

function getPublicOrigin(client, guildId = '') {
  const settings = guildId ? getPluginSettings(client, guildId) : getFirstPluginSettings(client);
  const configured = String(settings.publicIpAddress || '').trim();
  if (!configured) return `http://127.0.0.1:${serverPort}`;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(configured);
  try {
    const parsed = new URL(hasScheme ? configured : `http://${configured}`);
    if (!parsed.port) parsed.port = `${serverPort}`;
    return `${parsed.protocol}//${parsed.host}`;
  }
  catch (_) {
    const host = configured.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
    return `http://${host}:${serverPort}`;
  }
}

async function handleRequest(client, req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/app.css') return sendCss(res, 200, appCss());
  if (req.method === 'GET' && url.pathname === '/app.js') return sendJs(res, 200, appJs());
  if (req.method === 'GET' && url.pathname === '/favicon.svg') return sendSvg(res, 200, faviconSvg());

  if (!isAuthorized(url, req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

  if (req.method === 'GET' && url.pathname === '/') return sendHtml(res, 200, htmlPage());
  if (req.method === 'GET' && url.pathname === '/api/guilds') return sendJson(res, 200, listGuilds(client));
  if (req.method === 'GET' && url.pathname === '/api/vendor-map') return sendJson(res, 200, await getVendorMap(client, url));
  if (req.method === 'GET' && url.pathname === '/api/export') return sendJson(res, 200, await getVendorMap(client, url, true));
  if (req.method === 'POST' && url.pathname === '/api/home') return postHome(client, url, req, res);
  if (req.method === 'POST' && url.pathname === '/api/refresh-interval') return postRefreshInterval(client, url, req, res);

  return sendJson(res, 404, { ok: false, error: 'not found' });
}

async function postHome(client, url, req, res) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return sendJson(res, 400, { ok: false, error: 'guildId required' });
  const body = await readJson(req);
  try {
    const instance = client.getInstance(guildId);
    if (!instance) return sendJson(res, 404, { ok: false, error: 'guild not found' });
    if (!instance.pluginSettings) instance.pluginSettings = {};
    if (!instance.pluginSettings[PLUGIN_NAME]) instance.pluginSettings[PLUGIN_NAME] = {};

    if (body && body.clear === true) {
      instance.pluginSettings[PLUGIN_NAME].homeLocation = '';
    }
    else {
      const x = Number(body?.x);
      const y = Number(body?.y);
      const radius = Number(body?.radius || 100);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0) {
        return sendJson(res, 400, { ok: false, error: 'valid x, y, and radius required' });
      }
      instance.pluginSettings[PLUGIN_NAME].homeLocation = `${Math.round(x)},${Math.round(y)},${Math.round(radius)}`;
    }

    client.setInstance(guildId, instance);
    return sendJson(res, 200, { ok: true, home: parseHomeLocation(instance.pluginSettings[PLUGIN_NAME].homeLocation) });
  }
  catch (err) {
    return sendJson(res, 500, { ok: false, error: err?.message || 'failed to save home' });
  }
}

async function postRefreshInterval(client, url, req, res) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return sendJson(res, 400, { ok: false, error: 'guildId required' });
  const body = await readJson(req);
  const seconds = parseInt(body?.seconds, 10);
  if (!Number.isInteger(seconds) || seconds < 2 || seconds > 3600) {
    return sendJson(res, 400, { ok: false, error: 'refresh interval must be between 2 and 3600 seconds' });
  }

  try {
    const instance = client.getInstance(guildId);
    if (!instance) return sendJson(res, 404, { ok: false, error: 'guild not found' });
    if (!instance.pluginSettings) instance.pluginSettings = {};
    if (!instance.pluginSettings[PLUGIN_NAME]) instance.pluginSettings[PLUGIN_NAME] = {};
    instance.pluginSettings[PLUGIN_NAME].autoRefreshSeconds = `${seconds}`;
    client.setInstance(guildId, instance);
    return sendJson(res, 200, { ok: true, autoRefreshSeconds: seconds });
  }
  catch (err) {
    return sendJson(res, 500, { ok: false, error: err?.message || 'failed to save refresh interval' });
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
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
        showOutOfStock: settings.showOutOfStock === true,
        home: parseHomeLocation(settings.homeLocation)
      });
    }
  }
  catch (_) { /* ignore */ }
  return { ok: true, guilds };
}

async function getVendorMap(client, url, exportOnly = false) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return { ok: false, error: 'guildId required' };

  const rustplus = client.rustplusInstances?.[guildId];
  const guild = client.guilds?.cache?.get(guildId);
  const settings = getPluginSettings(client, guildId);
  const home = parseHomeLocation(settings.homeLocation);
  const map = await buildMapPayload(client, guildId, rustplus, exportOnly);
  const vendors = buildVendorPayload(client, rustplus);

  return {
    ok: true,
    guild: { id: guildId, name: guild?.name || guildId, connected: !!(rustplus && rustplus.isConnected) },
    config: {
      autoRefreshSeconds: parsePositiveInt(settings.autoRefreshSeconds, 5),
      showOutOfStock: settings.showOutOfStock === true,
      home
    },
    generatedAt: new Date().toISOString(),
    map,
    vendors,
    cheapestByCategory: buildCheapestByCategory(vendors),
    profitTrades: buildProfitTrades(vendors),
    priceChecks: buildPriceChecks(vendors, home),
    summary: summarizeVendors(vendors),
    events: recentEvents.get(guildId) || []
  };
}

async function buildMapPayload(client, guildId, rustplus, exportOnly) {
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
      payload.players = (await Promise.all(rustplus.team.players.map(async (p) => {
        const steamId = p.steamId ? p.steamId.toString() : null;
        return {
          name: p.name,
          steamId,
          avatarUrl: await getSteamAvatarUrl(client, steamId),
          x: p.x,
          y: p.y,
          online: !!p.isOnline,
          alive: !!p.isAlive
        };
      }))).filter((p) => typeof p.x === 'number' && typeof p.y === 'number');
    }
  }
  catch (_) { /* ignore */ }

  if (!exportOnly) payload.image = readMapImage(guildId);
  return payload;
}

async function getSteamAvatarUrl(client, steamId) {
  if (!steamId) return null;
  const cached = steamAvatarCache.get(steamId);
  if (cached !== undefined) return cached;

  try {
    const avatarUrl = await Scrape.scrapeSteamProfilePicture(client, steamId);
    steamAvatarCache.set(steamId, avatarUrl || null);
    return avatarUrl || null;
  }
  catch (_) {
    steamAvatarCache.set(steamId, null);
    return null;
  }
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
        itemShortName: item.shortName,
        itemCategory: categorizeItem(item.shortName, item.name),
        itemIcon: item.icon,
        itemBlueprint: !!order.itemIsBlueprint,
        currencyId: order.currencyId,
        currencyName: currency.name,
        currencyShortName: currency.shortName,
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
  let shortName = null;
  let icon = null;
  try {
    if (client.items && itemId != null) {
      name = client.items.getName(itemId) || name;
      shortName = client.items.getShortName?.(itemId) || null;
      icon = client.items.getImage?.(itemId) || client.items.getIcon?.(itemId) || null;
    }
  }
  catch (_) { /* ignore */ }
  return { name, shortName, icon };
}

function buildCheapestByCategory(vendors) {
  const grouped = new Map();
  for (const vendor of vendors.vendingMachines || []) {
    for (const order of vendor.orders || []) {
      if (!order.inStock) continue;
      const quantity = Math.max(1, order.quantity || 1);
      const unitCost = (order.cost || 0) / quantity;
      const itemKey = `${order.itemId}:${order.itemBlueprint ? 'bp' : 'item'}`;
      const currencyKey = `${order.currencyId}:${order.currencyBlueprint ? 'bp' : 'item'}`;
      const candidate = {
        key: itemKey,
        itemKey,
        currencyKey,
        itemId: order.itemId,
        itemName: order.itemName,
        itemShortName: order.itemShortName,
        itemCategory: order.itemCategory,
        itemBlueprint: order.itemBlueprint,
        itemIcon: order.itemIcon,
        currencyId: order.currencyId,
        currencyName: order.currencyName,
        currencyShortName: order.currencyShortName,
        currencyBlueprint: order.currencyBlueprint,
        quantity: order.quantity || 0,
        cost: order.cost || 0,
        unitCost,
        stock: order.stock || 0,
        vendorId: vendor.id,
        vendorLabel: vendor.label,
        grid: vendor.grid,
        location: vendor.location,
        x: vendor.x,
        y: vendor.y,
        searchText: [order.itemName, order.currencyName, vendor.grid, vendor.location, order.itemShortName, order.currencyShortName].join(' ').toLowerCase()
      };

      if (!grouped.has(itemKey)) {
        grouped.set(itemKey, {
          key: itemKey,
          itemKey,
          itemId: candidate.itemId,
          itemName: candidate.itemName,
          itemShortName: candidate.itemShortName,
          itemCategory: candidate.itemCategory,
          itemBlueprint: candidate.itemBlueprint,
          itemIcon: candidate.itemIcon,
          priceOptionsByCurrency: new Map(),
          searchParts: [candidate.itemName, candidate.itemShortName]
        });
      }

      const group = grouped.get(itemKey);
      group.searchParts.push(candidate.currencyName, candidate.currencyShortName, candidate.grid, candidate.location);
      const current = group.priceOptionsByCurrency.get(currencyKey);
      if (!current || candidate.unitCost < current.unitCost ||
        (candidate.unitCost === current.unitCost && candidate.stock > current.stock)) {
        group.priceOptionsByCurrency.set(currencyKey, candidate);
      }
    }
  }

  const categories = {};
  for (const group of grouped.values()) {
    const priceOptions = Array.from(group.priceOptionsByCurrency.values()).sort((a, b) =>
      a.currencyName.localeCompare(b.currencyName) || a.unitCost - b.unitCost);
    if (!priceOptions.length) continue;
    const best = priceOptions.slice().sort((a, b) => a.unitCost - b.unitCost || b.stock - a.stock)[0];
    const offer = {
      key: group.key,
      itemKey: group.itemKey,
      itemId: group.itemId,
      itemName: group.itemName,
      itemShortName: group.itemShortName,
      itemCategory: group.itemCategory,
      itemBlueprint: group.itemBlueprint,
      itemIcon: group.itemIcon,
      priceOptions,
      priceOptionCount: priceOptions.length,
      quantity: best.quantity,
      cost: best.cost,
      unitCost: best.unitCost,
      currencyId: best.currencyId,
      currencyName: best.currencyName,
      currencyShortName: best.currencyShortName,
      currencyBlueprint: best.currencyBlueprint,
      vendorId: best.vendorId,
      grid: best.grid,
      location: best.location,
      searchText: group.searchParts.join(' ').toLowerCase()
    };
    const category = offer.itemCategory || 'Other';
    if (!categories[category]) categories[category] = [];
    categories[category].push(offer);
  }

  const sorted = {};
  for (const category of Object.keys(categories).sort((a, b) => a.localeCompare(b))) {
    sorted[category] = categories[category].sort((a, b) =>
      a.itemName.localeCompare(b.itemName) || a.unitCost - b.unitCost || a.currencyName.localeCompare(b.currencyName));
  }
  return sorted;
}

function buildProfitTrades(vendors) {
  const orders = [];
  for (const vendor of vendors.vendingMachines || []) {
    for (const order of vendor.orders || []) {
      if (!order.inStock) continue;
      orders.push({
        vendorId: vendor.id,
        vendorLabel: vendor.label,
        grid: vendor.grid,
        location: vendor.location,
        x: vendor.x,
        y: vendor.y,
        itemId: order.itemId,
        itemName: order.itemName,
        itemBlueprint: order.itemBlueprint,
        currencyId: order.currencyId,
        currencyName: order.currencyName,
        currencyBlueprint: order.currencyBlueprint,
        quantity: Math.max(1, order.quantity || 1),
        cost: Math.max(1, order.cost || 1),
        stock: order.stock || 0,
        searchText: [order.itemName, order.currencyName, vendor.grid, vendor.location].join(' ').toLowerCase()
      });
    }
  }

  const routes = [];
  for (const buy of orders) {
    for (const sell of orders) {
      if (buy.vendorId === sell.vendorId) continue;
      if (buy.itemId !== sell.currencyId || buy.currencyId !== sell.itemId) continue;
      if (!!buy.itemBlueprint !== !!sell.currencyBlueprint || !!buy.currencyBlueprint !== !!sell.itemBlueprint) continue;

      const buyCostPerItem = buy.cost / buy.quantity;
      const sellReturnPerItem = sell.quantity / sell.cost;
      const profitPerItem = sellReturnPerItem - buyCostPerItem;
      if (profitPerItem <= 0) continue;

      const tradableItemCount = Math.min(buy.stock * buy.quantity, sell.stock * sell.cost);
      const totalProfit = Math.floor(profitPerItem * tradableItemCount);
      if (totalProfit <= 0) continue;

      routes.push({
        buyVendorId: buy.vendorId,
        sellVendorId: sell.vendorId,
        buyGrid: buy.grid,
        sellGrid: sell.grid,
        buyLocation: buy.location,
        sellLocation: sell.location,
        itemId: buy.itemId,
        itemName: buy.itemName,
        currencyId: buy.currencyId,
        currencyName: buy.currencyName,
        buyQuantity: buy.quantity,
        buyCost: buy.cost,
        sellQuantity: sell.quantity,
        sellCost: sell.cost,
        profitPerItem,
        totalProfit,
        tradableItemCount,
        routeText: `Buy ${buy.quantity} ${buy.itemName} for ${buy.cost} ${buy.currencyName}, then trade ${sell.cost} ${buy.itemName} for ${sell.quantity} ${buy.currencyName}`,
        searchText: [buy.searchText, sell.searchText, buy.itemName, buy.currencyName].join(' ').toLowerCase()
      });
    }
  }

  return routes.sort((a, b) => b.totalProfit - a.totalProfit || b.profitPerItem - a.profitPerItem).slice(0, 50);
}

function categorizeItem(shortName, name) {
  const value = `${shortName || ''} ${name || ''}`.toLowerCase();
  if (hasAny(value, ['rifle', 'pistol', 'smg', 'shotgun', 'lmg', 'launcher', 'm249', 'revolver', 'python', 'eoka', 'crossbow', 'bow.', 'weapon.', 'flamethrower', 'nailgun'])) return 'Guns & Weapons';
  if (hasAny(value, ['ammo', 'arrow', 'rocket', 'grenade', 'shell', 'incendiary', 'hv.'])) return 'Ammo & Explosives';
  if (hasAny(value, ['attire.', 'clothing', 'hoodie', 'pants', 'boots', 'gloves', 'helmet', 'facemask', 'jacket', 'shirt', 'kilt', 'roadsign', 'hazmat', 'armor', 'vest', 'mask', 'sunglasses'])) return 'Clothing & Armor';
  if (hasAny(value, ['component', 'gears', 'spring', 'riflebody', 'semibody', 'smgbody', 'tarp', 'rope', 'sewing', 'sheetmetal', 'techparts', 'propanetank', 'metalblade', 'metalspring', 'roadsigns', 'fuse', 'ducttape'])) return 'Components';
  if (hasAny(value, ['building', 'wall.', 'floor.', 'door.', 'barricade', 'ladder', 'gate', 'shutter', 'lock.', 'cupboard', 'foundation', 'embrasure', 'furnace', 'box.', 'storage', 'sign.', 'planter', 'trap', 'turret'])) return 'Building & Deployables';
  if (hasAny(value, ['wood', 'stones', 'metal.refined', 'metal.fragments', 'sulfur', 'charcoal', 'lowgradefuel', 'cloth', 'leather', 'scrap', 'hq.metal', 'crude.oil', 'gunpowder'])) return 'Resources';
  if (hasAny(value, ['tool.', 'pickaxe', 'hatchet', 'salvaged', 'jackhammer', 'chainsaw', 'hammer', 'toolgun', 'wiretool', 'spraycan', 'binoculars'])) return 'Tools';
  if (hasAny(value, ['medical', 'syringe', 'bandage', 'largemedkit', 'antirad', 'radiation', 'blood'])) return 'Medical';
  if (hasAny(value, ['food', 'apple', 'berry', 'meat', 'water', 'fish', 'corn', 'pumpkin', 'mushroom', 'chocolate', 'granolabar', 'can.', 'pie.'])) return 'Food & Farming';
  if (hasAny(value, ['electric', 'battery', 'switch', 'generator', 'solar', 'wire', 'smart.', 'computerstation', 'camera', 'rf.', 'counter', 'timer', 'sensor', 'light.'])) return 'Electrical';
  if (hasAny(value, ['vehicle', 'modularcar', 'car.', 'engine.', 'horse', 'snowmobile', 'submarine', 'boat', 'kayak', 'mlrs', 'drone'])) return 'Vehicles';
  return 'Other';
}

function hasAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function parseHomeLocation(value) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split(/[ ,]+/).map((part) => Number(part.trim())).filter((part) => Number.isFinite(part));
  if (parts.length < 2) return null;
  return { x: parts[0], y: parts[1], radius: parts[2] && parts[2] > 0 ? parts[2] : 100 };
}

function buildPriceChecks(vendors, home) {
  if (!home) return [];
  const machines = vendors.vendingMachines || [];
  const homeVendors = machines.filter((vendor) => getDistance(home.x, home.y, vendor.x, vendor.y) <= home.radius);
  if (!homeVendors.length) return [];

  const checks = [];
  for (const homeVendor of homeVendors) {
    for (const homeOrder of homeVendor.orders || []) {
      if (!homeOrder.inStock) continue;
      const homeUnitCost = (homeOrder.cost || 0) / Math.max(1, homeOrder.quantity || 1);
      for (const competitor of machines) {
        if (homeVendors.some((vendor) => vendor.id === competitor.id)) continue;
        for (const competitorOrder of competitor.orders || []) {
          if (!competitorOrder.inStock) continue;
          if (homeOrder.itemId !== competitorOrder.itemId || homeOrder.currencyId !== competitorOrder.currencyId) continue;
          if (!!homeOrder.itemBlueprint !== !!competitorOrder.itemBlueprint || !!homeOrder.currencyBlueprint !== !!competitorOrder.currencyBlueprint) continue;
          const competitorUnitCost = (competitorOrder.cost || 0) / Math.max(1, competitorOrder.quantity || 1);
          if (competitorUnitCost >= homeUnitCost) continue;
          const cheaperBy = homeUnitCost - competitorUnitCost;
          checks.push({
            key: `${homeVendor.id}:${competitor.id}:${homeOrder.itemId}:${homeOrder.currencyId}`,
            homeVendorId: homeVendor.id,
            competitorVendorId: competitor.id,
            itemId: homeOrder.itemId,
            itemName: homeOrder.itemName,
            currencyId: homeOrder.currencyId,
            currencyName: homeOrder.currencyName,
            homeGrid: homeVendor.grid,
            competitorGrid: competitor.grid,
            homeLocation: homeVendor.location,
            competitorLocation: competitor.location,
            homeX: homeVendor.x,
            homeY: homeVendor.y,
            competitorX: competitor.x,
            competitorY: competitor.y,
            homeQuantity: homeOrder.quantity || 0,
            homeCost: homeOrder.cost || 0,
            competitorQuantity: competitorOrder.quantity || 0,
            competitorCost: competitorOrder.cost || 0,
            homeUnitCost,
            competitorUnitCost,
            cheaperBy,
            cheaperPercent: homeUnitCost > 0 ? (cheaperBy / homeUnitCost) * 100 : 0,
            distanceFromHome: Math.round(getDistance(home.x, home.y, competitor.x, competitor.y)),
            searchText: [homeOrder.itemName, homeOrder.currencyName, homeVendor.grid, competitor.grid, homeVendor.location, competitor.location].join(' ').toLowerCase()
          });
        }
      }
    }
  }

  return checks.sort((a, b) => b.cheaperPercent - a.cheaperPercent || b.cheaperBy - a.cheaperBy).slice(0, 50);
}

function getDistance(x1, y1, x2, y2) {
  const dx = (x1 || 0) - (x2 || 0);
  const dy = (y1 || 0) - (y2 || 0);
  return Math.sqrt(dx * dx + dy * dy);
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
        <label class="refresh-setting">Refresh interval (seconds)
          <input id="refreshSeconds" class="input full" type="number" min="2" max="3600" step="1" />
        </label>
        <button id="saveRefresh" class="btn full">Save refresh interval</button>
      </section>
      <section class="card">
        <h2>Home location</h2>
        <div class="home-grid">
          <input id="homeX" class="input" placeholder="X" />
          <input id="homeY" class="input" placeholder="Y" />
          <input id="homeRadius" class="input" placeholder="Radius" />
        </div>
        <div class="map-buttons">
          <button id="homeFromSelected" class="btn full">Use selected vendor</button>
          <button id="saveHome" class="btn full primary">Save home</button>
        </div>
        <button id="clearHome" class="btn full">Clear home</button>
        <div id="homeStatus" class="muted">No home set.</div>
      </section>
      <section class="card">
        <h2>Price undercuts</h2>
        <div id="priceCheckList" class="price-check-list"></div>
      </section>
      <section class="card">
        <h2>Cheapest by category</h2>
        <div id="cheapestList" class="cheapest-list"></div>
      </section>
      <section class="card">
        <h2>Profit trades</h2>
        <div id="profitList" class="profit-list"></div>
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
  return `:root{color-scheme:dark;--bg:#101217;--panel:#181c24;--panel2:#202633;--text:#f5f1eb;--muted:#9da6b5;--line:#303849;--accent:#ce412b;--good:#4ade80;--warn:#fbbf24;--blue:#60a5fa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Arial,sans-serif}.topbar{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--line);background:rgba(16,18,23,.94);position:sticky;top:0;z-index:10}.brand{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:800}.brand-icon{font-size:24px}.toolbar{display:flex;align-items:center;gap:8px}.layout{display:grid;grid-template-columns:360px minmax(0,1fr) 380px;height:calc(100vh - 58px);min-height:540px}.sidebar,.details{overflow:auto;background:var(--panel);border-right:1px solid var(--line);padding:14px}.details{border-left:1px solid var(--line);border-right:0;position:relative}.details.closed{display:none}.map-panel{position:relative;min-width:0;background:#0c0f14}.map{position:absolute;inset:0;overflow:hidden;cursor:grab}.map.dragging{cursor:grabbing}.map-help{position:absolute;top:12px;left:12px;z-index:3;background:rgba(0,0,0,.55);padding:8px 10px;border-radius:10px;color:var(--muted);backdrop-filter:blur(8px)}#mapImage{position:absolute;left:0;top:0;transform-origin:0 0;user-select:none;pointer-events:none}.marker-layer{position:absolute;left:0;top:0;transform-origin:0 0}.empty{position:absolute;inset:auto 24px 24px 24px;padding:12px 14px;border:1px dashed var(--line);border-radius:12px;color:var(--muted);background:rgba(24,28,36,.85)}.card{background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}.card h2{margin:0 0 10px;font-size:15px}.input{background:#0d1118;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:9px 10px;outline:0}.input:focus{border-color:var(--accent)}.full{width:100%}.btn{border:1px solid var(--line);background:#252c3a;color:var(--text);border-radius:9px;padding:9px 11px;cursor:pointer}.btn:hover{border-color:#566174}.btn.primary{background:var(--accent);border-color:#e15b45}.status,.muted{color:var(--muted)}.checks{display:grid;gap:8px;margin:12px 0}.checks label{display:flex;gap:8px;align-items:center}.map-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}.stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}.stat{padding:9px;border:1px solid var(--line);border-radius:10px;background:#131822}.stat b{display:block;font-size:20px}.stat span{color:var(--muted);font-size:12px}.vendor-list,.cheapest-list,.profit-list,.price-check-list{display:grid;gap:8px}.category-block{border:1px solid var(--line);border-radius:12px;background:#151a23;overflow:hidden}.category-head{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;background:#111722;font-weight:800}.cheap-row,.profit-row,.price-check-row{display:grid;grid-template-columns:34px minmax(0,1fr);gap:9px;padding:9px 10px;border-top:1px solid var(--line);cursor:pointer}.cheap-row:hover,.profit-row:hover,.price-check-row:hover,.cheap-option:hover{background:#1b2230}.shop-icon{width:32px;height:32px;aspect-ratio:1/1;border-radius:7px;display:flex;align-items:center;justify-content:center;background:#0d1118;border:1px solid var(--line);font-size:18px;line-height:1;overflow:hidden;flex:0 0 32px}.shop-icon img{width:100%;height:100%;object-fit:cover;display:block}.cheap-main,.profit-main,.price-check-main{min-width:0}.cheap-title,.cheap-cost,.profit-title,.profit-route,.price-check-title,.price-check-route,.cheap-option-title,.cheap-option-meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cheap-title,.profit-title,.price-check-title{font-weight:700}.cheap-cost,.profit-route,.price-check-route{color:var(--muted);font-size:12px}.profit-gain,.price-check-location{color:var(--good);font-size:12px;font-weight:800}.cheap-options{grid-column:1/-1;margin:2px 0 0 42px;border-left:2px solid var(--line);display:grid;gap:2px}.cheap-option{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:7px 9px;border-radius:8px;cursor:pointer}.cheap-option-title{font-weight:700;font-size:12px}.cheap-option-meta{color:var(--muted);font-size:12px}.price-check-location{color:var(--warn)}.home-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:8px}.home-grid .input{width:100%;min-width:0}#homeRadius{grid-column:1/-1}#homeStatus{margin-top:8px}.refresh-setting{display:block;margin-top:10px}.refresh-setting .input{margin-top:5px}.vendor-row{border:1px solid var(--line);border-radius:12px;padding:10px;background:#151a23;cursor:pointer}.vendor-row:hover,.vendor-row.active{border-color:var(--accent)}.vendor-title{display:flex;justify-content:space-between;gap:8px;font-weight:700}.vendor-meta{color:var(--muted);font-size:12px;margin-top:3px}.pill{display:inline-flex;align-items:center;border-radius:999px;padding:2px 7px;font-size:12px;background:#2b3342;color:var(--muted);margin:2px 4px 0 0}.pill.good{color:#062411;background:var(--good)}.pill.warn{color:#271b00;background:var(--warn)}.marker{position:absolute;width:28px;height:28px;aspect-ratio:1/1;transform:translate(-50%,-50%);border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 14px rgba(0,0,0,.6);cursor:pointer;font-size:15px;z-index:2;line-height:1;overflow:visible}.marker:hover,.marker:focus,.marker:focus-within{z-index:1000}.marker.vending{background:var(--accent);border-radius:8px}.marker.home{width:30px;height:30px;background:var(--good);color:#062411;border-radius:50%;font-weight:900;font-size:14px}.marker.cluster{width:34px;height:34px;background:linear-gradient(135deg,var(--accent),#f59e0b);border-radius:10px;font-weight:900}.cluster-popover,.vendor-popover{display:none;position:absolute;left:50%;top:calc(100% - 2px);transform:translateX(-50%);width:340px;max-height:360px;overflow-y:auto;overscroll-behavior:contain;background:#111722;border:1px solid var(--line);border-radius:12px;padding:10px;text-align:left;box-shadow:0 12px 42px rgba(0,0,0,.65);z-index:1001}.marker.cluster:hover .cluster-popover,.marker.cluster:focus .cluster-popover,.marker.cluster:focus-within .cluster-popover,.marker.vending:hover .vendor-popover,.marker.vending:focus .vendor-popover,.marker.vending:focus-within .vendor-popover{display:block}.cluster-title{font-weight:900;margin-bottom:6px}.cluster-vendor{border-top:1px solid var(--line);padding:7px 0}.cluster-vendor:first-of-type{border-top:0}.cluster-items{display:grid;gap:4px;max-height:132px;overflow:auto}.cluster-item{display:grid;grid-template-columns:1fr auto;gap:8px;color:var(--muted);font-size:12px}.marker.traveling{background:var(--warn);color:#211400}.marker.player{background:var(--blue)}.marker.player.avatar{background-size:cover;background-position:center;color:transparent}.marker.monument{background:#6b7280;font-size:11px}.marker.dim{opacity:.22}.marker.selected{outline:3px solid white;z-index:5}.marker-label{position:absolute;left:50%;top:29px;transform:translateX(-50%);white-space:nowrap;background:rgba(0,0,0,.72);border-radius:999px;padding:2px 7px;font-size:12px;color:white;pointer-events:none}.close{position:absolute;right:14px;top:12px;background:transparent;color:var(--muted);border:0;font-size:28px;cursor:pointer}.details h2{margin:14px 36px 2px 0}.order{display:grid;grid-template-columns:34px minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;padding:9px;border:1px solid var(--line);border-radius:10px;margin:8px 0;background:#141923}.order.out{opacity:.5}.arrow{color:var(--muted)}.item{min-width:0}.item b,.item span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item span{font-size:12px;color:var(--muted)}.events{display:grid;gap:7px}.event{border-left:3px solid var(--accent);padding-left:8px}.toast{position:fixed;right:18px;bottom:18px;padding:10px 13px;background:#111827;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:20}@media(max-width:1100px){.layout{grid-template-columns:320px 1fr}.details{position:fixed;right:0;top:58px;bottom:0;width:min(390px,94vw);z-index:9;box-shadow:-20px 0 45px rgba(0,0,0,.45)}}@media(max-width:760px){.topbar{height:auto;min-height:58px;align-items:flex-start;flex-direction:column;padding:10px}.toolbar{width:100%;flex-wrap:wrap}.layout{display:block;height:auto}.sidebar{height:auto}.map-panel{height:70vh}.details{top:0}.map-buttons{grid-template-columns:1fr}}`;
}

function appJs() {
  return `(() => {
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token') || '';
  const state = { data:null, selectedId:null, scale:1, x:0, y:0, imgW:0, imgH:0, mapSize:null, ocean:0, timer:null, expandedCheapest:{} };
  const els = {
    guild: document.getElementById('guildSelect'), status: document.getElementById('status'), stats: document.getElementById('stats'),
    search: document.getElementById('search'), showVending: document.getElementById('showVending'), showTraveling: document.getElementById('showTraveling'),
    showOutOfStock: document.getElementById('showOutOfStock'), showPlayers: document.getElementById('showPlayers'), showMonuments: document.getElementById('showMonuments'),
    vendorList: document.getElementById('vendorList'), cheapestList: document.getElementById('cheapestList'), profitList: document.getElementById('profitList'), priceCheckList: document.getElementById('priceCheckList'), events: document.getElementById('eventList'), map: document.getElementById('map'), img: document.getElementById('mapImage'),
    layer: document.getElementById('markerLayer'), empty: document.getElementById('emptyMap'), details: document.getElementById('details'), detailsBody: document.getElementById('detailsBody'), toast: document.getElementById('toast'), homeX: document.getElementById('homeX'), homeY: document.getElementById('homeY'), homeRadius: document.getElementById('homeRadius'), homeStatus: document.getElementById('homeStatus'), refreshSeconds: document.getElementById('refreshSeconds')
  };
  const headers = { 'x-vendor-map-token': token };

  function api(path){ return fetch(path + (path.includes('?')?'&':'?') + 'token=' + encodeURIComponent(token), { headers }).then(async r => { if(!r.ok) throw new Error(await r.text()); return r.json(); }); }
  function postJson(path, body){ return fetch(path + (path.includes('?')?'&':'?') + 'token=' + encodeURIComponent(token), { method:'POST', headers:{ ...headers, 'Content-Type':'application/json' }, body:JSON.stringify(body) }).then(async r => { if(!r.ok) throw new Error(await r.text()); return r.json(); }); }
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
    document.getElementById('saveHome').addEventListener('click', saveHome);
    document.getElementById('clearHome').addEventListener('click', clearHome);
    document.getElementById('homeFromSelected').addEventListener('click', setHomeFromSelected);
    document.getElementById('saveRefresh').addEventListener('click', saveRefreshInterval);
  }

  async function load(){
    if (!els.guild.value) return;
    setStatus('Loading…');
    const data = await api('/api/vendor-map?guildId=' + encodeURIComponent(els.guild.value));
    state.data = data;
    els.showOutOfStock.checked = !!data.config?.showOutOfStock;
    els.refreshSeconds.value = Math.max(2, data.config?.autoRefreshSeconds || 5);
    syncHomeInputs(data.config?.home || null);
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
      if (document.activeElement !== els.refreshSeconds) els.refreshSeconds.value = Math.max(2, data.config?.autoRefreshSeconds || 5);
      syncHomeInputs(data.config?.home || null, false);
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
    renderCheapest();
    renderPriceChecks();
    renderProfitTrades();
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


  function syncHomeInputs(home, overwrite=true){
    if (home && overwrite) { els.homeX.value = Math.round(home.x); els.homeY.value = Math.round(home.y); els.homeRadius.value = Math.round(home.radius || 100); }
    els.homeStatus.textContent = home ? ('Home: X ' + Math.round(home.x) + ', Y ' + Math.round(home.y) + ', radius ' + Math.round(home.radius || 100)) : 'No home set. Save coordinates or select a vendor and use it as home.';
  }


  async function saveRefreshInterval(){
    try {
      const seconds = Number(els.refreshSeconds.value || 5);
      const response = await postJson('/api/refresh-interval?guildId=' + encodeURIComponent(els.guild.value), { seconds });
      const saved = Math.max(2, response.autoRefreshSeconds || seconds);
      els.refreshSeconds.value = saved;
      clearInterval(state.timer);
      state.timer = setInterval(refreshQuietly, saved * 1000);
      toast('Refresh interval saved');
      setStatus('Refresh interval: ' + saved + 's');
    } catch(e) { toast('Refresh save failed'); setStatus('Error: ' + e.message); }
  }

  async function saveHome(){
    try {
      const gid = els.guild.value;
      const body = { x:Number(els.homeX.value), y:Number(els.homeY.value), radius:Number(els.homeRadius.value || 100) };
      await postJson('/api/home?guildId=' + encodeURIComponent(gid), body);
      toast('Home saved');
      await load();
    } catch(e) { toast('Home save failed'); setStatus('Error: ' + e.message); }
  }

  async function clearHome(){
    try { await postJson('/api/home?guildId=' + encodeURIComponent(els.guild.value), { clear:true }); toast('Home cleared'); await load(); }
    catch(e) { toast('Home clear failed'); setStatus('Error: ' + e.message); }
  }

  function setHomeFromSelected(){
    const vendor = [...(state.data?.vendors?.vendingMachines || []), ...(state.data?.vendors?.travelingVendors || [])].find(v => v.id === state.selectedId);
    if (!vendor) { toast('Select a vendor marker/list row first'); return; }
    els.homeX.value = Math.round(vendor.x); els.homeY.value = Math.round(vendor.y); if (!els.homeRadius.value) els.homeRadius.value = 100;
    toast('Home coordinates copied from selected vendor');
  }

  function renderPriceChecks(){
    const q = els.search.value.trim().toLowerCase();
    const checks = (state.data?.priceChecks || []).filter(check => !q || (check.searchText || '').includes(q));
    if (!state.data?.config?.home) { els.priceCheckList.innerHTML = '<div class="muted">Set your home location to compare your nearby vendors against the rest of the map.</div>'; return; }
    if (!checks.length) { els.priceCheckList.innerHTML = '<div class="muted">No cheaper competing vendors found for home-area prices.</div>'; return; }
    els.priceCheckList.innerHTML = checks.slice(0, 16).map(check => '<div class="price-check-row" data-home-id="' + escapeHtml(check.homeVendorId) + '" data-comp-id="' + escapeHtml(check.competitorVendorId) + '"><span class="shop-icon">⚠️</span><div class="price-check-main"><div class="price-check-title">' + escapeHtml(check.itemName) + ' is cheaper elsewhere by ' + escapeHtml(check.cheaperPercent.toFixed(1)) + '%</div><div class="price-check-route">Our price: ' + escapeHtml(check.homeQuantity + '× for ' + check.homeCost + ' ' + check.currencyName) + ' · Their price: ' + escapeHtml(check.competitorQuantity + '× for ' + check.competitorCost + ' ' + check.currencyName) + '</div><div class="price-check-location">Their location: ' + escapeHtml(check.competitorGrid || check.competitorLocation || '?') + '</div></div></div>').join('');
    els.priceCheckList.querySelectorAll('.price-check-row').forEach(row => row.addEventListener('click', () => selectVendor(row.dataset.compId)));
  }


  function renderCheapest(){
    const byCategory = state.data?.cheapestByCategory || {}; const q = els.search.value.trim().toLowerCase();
    const blocks = [];
    Object.entries(byCategory).forEach(([category, offers]) => {
      const visible = (offers || []).filter(o => !q || (o.searchText || '').includes(q));
      if (!visible.length) return;
      blocks.push('<div class="category-block"><div class="category-head"><span>' + escapeHtml(category) + '</span><span class="muted">' + visible.length + '</span></div>' + visible.slice(0, 12).map(cheapOfferHtml).join('') + (visible.length > 12 ? '<div class="cheap-row muted"><div></div><div>+' + (visible.length - 12) + ' more, narrow search to reveal</div></div>' : '') + '</div>');
    });
    els.cheapestList.innerHTML = blocks.length ? blocks.join('') : '<div class="muted">No in-stock vendor prices found.</div>';
    els.cheapestList.querySelectorAll('.cheap-row[data-offer-key]').forEach(row => row.addEventListener('click', (e) => {
      if (e.target.closest('.cheap-option')) return;
      state.expandedCheapest[row.dataset.offerKey] = !state.expandedCheapest[row.dataset.offerKey];
      renderCheapest();
    }));
    els.cheapestList.querySelectorAll('.cheap-option[data-vendor-id]').forEach(row => row.addEventListener('click', (e) => { e.stopPropagation(); selectVendor(row.dataset.vendorId); }));
  }

  function cheapOfferHtml(o){
    const title = (o.quantity || 0) + '× ' + o.itemName + (o.itemBlueprint ? ' BP' : '');
    const first = (o.cost || 0) + '× ' + o.currencyName + (o.currencyBlueprint ? ' BP' : '') + ' at ' + (o.grid || o.location || 'unknown');
    const count = o.priceOptionCount || (o.priceOptions || []).length || 1;
    const expanded = !!state.expandedCheapest[o.key];
    const options = expanded ? '<div class="cheap-options">' + (o.priceOptions || []).map(priceOptionHtml).join('') + '</div>' : '';
    return '<div class="cheap-row" data-offer-key="' + escapeHtml(o.key) + '">' + squareIcon(o) + '<div class="cheap-main"><div class="cheap-title">' + escapeHtml(title) + '</div><div class="cheap-cost">' + escapeHtml(count + ' payment option' + (count === 1 ? '' : 's') + ' · cheapest shown: ' + first) + '</div></div>' + options + '</div>';
  }

  function priceOptionHtml(o){
    const title = escapeHtml((o.cost || 0) + '× ' + o.currencyName + (o.currencyBlueprint ? ' BP' : ''));
    const meta = escapeHtml((o.quantity || 0) + '× item · ' + (o.grid || o.location || 'unknown'));
    return '<div class="cheap-option" data-vendor-id="' + escapeHtml(o.vendorId) + '"><div class="cheap-option-title">' + title + '</div><div class="cheap-option-meta">' + meta + '</div></div>';
  }

  function squareIcon(o){
    if (o.itemIcon) return '<span class="shop-icon"><img src="' + escapeHtml(o.itemIcon) + '" alt="" /></span>';
    return '<span class="shop-icon">' + categoryIcon(o.itemCategory) + '</span>';
  }

  function categoryIcon(category){
    return ({ 'Guns & Weapons':'🔫', 'Ammo & Explosives':'💥', 'Clothing & Armor':'🧥', 'Components':'⚙️', 'Building & Deployables':'🧱', 'Resources':'⛏️', 'Tools':'🛠️', 'Medical':'➕', 'Food & Farming':'🌽', 'Electrical':'🔌', 'Vehicles':'🚗', 'Other':'📦' })[category] || '📦';
  }


  function renderProfitTrades(){
    const q = els.search.value.trim().toLowerCase();
    const routes = (state.data?.profitTrades || []).filter(route => !q || (route.searchText || '').includes(q));
    if (!routes.length) { els.profitList.innerHTML = '<div class="muted">No profitable buy/sell routes found.</div>'; return; }
    els.profitList.innerHTML = routes.slice(0, 12).map(route => '<div class="profit-row" data-buy-id="' + escapeHtml(route.buyVendorId) + '" data-sell-id="' + escapeHtml(route.sellVendorId) + '"><span class="shop-icon">↔️</span><div class="profit-main"><div class="profit-title">' + escapeHtml(route.itemName) + ' → +' + escapeHtml(route.totalProfit) + ' ' + escapeHtml(route.currencyName) + '</div><div class="profit-route">' + escapeHtml(route.routeText) + '</div><div class="profit-gain">Route: ' + escapeHtml(route.buyGrid || '?') + ' → ' + escapeHtml(route.sellGrid || '?') + ' · max ' + escapeHtml(route.tradableItemCount) + ' items</div></div></div>').join('');
    els.profitList.querySelectorAll('.profit-row').forEach(row => row.addEventListener('click', () => selectVendor(row.dataset.buyId)));
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
    if (state.data?.config?.home) addMarker({ id:'home', type:'home', label:'Home', x:state.data.config.home.x, y:state.data.config.home.y }, null);
    const clusters = buildVendorClusters(vendors.filter(v => v.type === 'vending'));
    clusters.forEach(cluster => cluster.vendors.length > 1 ? addClusterMarker(cluster) : addMarker(cluster.vendors[0], () => selectVendor(cluster.vendors[0].id)));
    vendors.filter(v => v.type !== 'vending').forEach(v => addMarker(v, () => selectVendor(v.id)));
    applyTransform();
  }

  function buildVendorClusters(vendors){
    const remaining = vendors.slice(); const clusters = [];
    while (remaining.length) {
      const seed = remaining.shift(); const group = [seed];
      for (let i = remaining.length - 1; i >= 0; i--) {
        const other = remaining[i];
        if (distance(seed, other) <= 55 || (seed.grid && seed.grid === other.grid && distance(seed, other) <= 95)) group.push(remaining.splice(i, 1)[0]);
      }
      const x = group.reduce((sum, v) => sum + (v.x || 0), 0) / group.length;
      const y = group.reduce((sum, v) => sum + (v.y || 0), 0) / group.length;
      clusters.push({ id:'cluster-' + group.map(v => v.id).join('-'), type:'cluster', x, y, vendors: group });
    }
    return clusters;
  }

  function distance(a,b){ const dx = (a.x || 0) - (b.x || 0); const dy = (a.y || 0) - (b.y || 0); return Math.sqrt(dx * dx + dy * dy); }

  function addClusterMarker(cluster){
    const pos = worldToPixels(cluster.x, cluster.y); const el = document.createElement('button');
    el.className = 'marker cluster'; el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px'; el.title = cluster.vendors.length + ' vending machines';
    el.innerHTML = '<span>' + cluster.vendors.length + '</span>' + clusterPopoverHtml(cluster);
    el.addEventListener('click', e => { e.stopPropagation(); selectVendor(cluster.vendors[0].id); });
    els.layer.appendChild(el);
    wirePopoverInteractions(el);
  }

  function clusterPopoverHtml(cluster){
    return '<div class="cluster-popover"><div class="cluster-title">' + cluster.vendors.length + ' vending machines in this base</div>' + cluster.vendors.map(v => '<div class="cluster-vendor"><b>' + escapeHtml(v.grid || v.location || 'Vendor') + '</b><div class="cluster-items">' + (v.orders || []).filter(o => els.showOutOfStock.checked || o.inStock).map(o => '<div class="cluster-item"><span>' + escapeHtml((o.quantity || 0) + '× ' + o.itemName) + '</span><span>' + escapeHtml((o.cost || 0) + '× ' + o.currencyName) + '</span></div>').join('') + '</div></div>').join('') + '</div>';
  }


  function vendorPopoverHtml(vendor){
    const visibleOrders = (vendor.orders || []).filter(o => els.showOutOfStock.checked || o.inStock);
    return '<div class="vendor-popover"><div class="cluster-title">' + escapeHtml(vendor.grid || vendor.location || 'Vending machine') + '</div><div class="cluster-items">' + (visibleOrders.length ? visibleOrders.map(o => '<div class="cluster-item"><span>' + escapeHtml((o.quantity || 0) + '× ' + o.itemName) + '</span><span>' + escapeHtml((o.cost || 0) + '× ' + o.currencyName) + '</span></div>').join('') : '<div class="muted">No visible sell orders.</div>') + '</div></div>';
  }

  function addMarker(vendor, onclick){
    const pos = worldToPixels(vendor.x, vendor.y); const el = document.createElement('button');
    el.className = 'marker ' + vendor.type + (vendor.avatarUrl ? ' avatar' : '') + (vendor.id === state.selectedId ? ' selected' : '');
    el.style.left=pos.x+'px'; el.style.top=pos.y+'px'; el.title=(vendor.label||'')+' '+(vendor.location||'');
    if (vendor.avatarUrl) el.style.backgroundImage = 'url("' + String(vendor.avatarUrl).replace(/"/g, '%22') + '")';
    el.innerHTML = (vendor.avatarUrl ? '' : icon(vendor)) + '<span class="marker-label">' + escapeHtml(shortLabel(vendor)) + '</span>' + (vendor.type === 'vending' ? vendorPopoverHtml(vendor) : '');
    if (onclick) el.addEventListener('click', e => { e.stopPropagation(); onclick(); });
    els.layer.appendChild(el);
    wirePopoverInteractions(el);
  }

  function wirePopoverInteractions(markerEl){
    markerEl.querySelectorAll('.cluster-popover,.vendor-popover').forEach(popover => {
      popover.addEventListener('wheel', e => e.stopPropagation(), { passive:true });
      ['mousedown','click','dblclick'].forEach(evt => popover.addEventListener(evt, e => e.stopPropagation()));
    });
  }

  function selectVendor(id){ state.selectedId = id; const all = [...(state.data?.vendors?.vendingMachines || []), ...(state.data?.vendors?.travelingVendors || [])]; const vendor = all.find(v => v.id === id); if (vendor) { centerOn(vendor.x, vendor.y); renderDetails(vendor); } render(); }
  function renderDetails(v){
    els.details.classList.remove('closed');
    const orders = (v.orders || []).filter(o => els.showOutOfStock.checked || o.inStock);
    els.detailsBody.innerHTML = '<h2>' + icon(v) + ' ' + escapeHtml(v.label) + '</h2><div class="muted">' + escapeHtml(v.location || 'Unknown location') + '</div><p><span class="pill">Grid ' + escapeHtml(v.grid || '?') + '</span><span class="pill">X ' + Math.round(v.x) + '</span><span class="pill">Y ' + Math.round(v.y) + '</span></p>' + (v.type === 'traveling' ? '<p class="pill warn">' + (v.halted ? 'Halted' : 'Moving') + '</p>' : '<h2>Sell orders</h2>' + (orders.length ? orders.map(orderHtml).join('') : '<div class="muted">No visible orders. Enable out-of-stock orders to see more.</div>'));
  }
  function orderHtml(o){ const left = escapeHtml((o.quantity || 0) + '× ' + o.itemName + (o.itemBlueprint ? ' BP' : '')); const right = escapeHtml((o.cost || 0) + '× ' + o.currencyName + (o.currencyBlueprint ? ' BP' : '')); return '<div class="order ' + (o.inStock ? '' : 'out') + '">' + squareIcon(o) + '<div class="item"><b>' + left + '</b><span>Stock: ' + escapeHtml(o.stock) + '</span></div><div class="arrow">for</div><div class="item"><b>' + right + '</b><span>Currency</span></div></div>'; }
  function renderEvents(events){ els.events.innerHTML = events.length ? events.slice(0,8).map(e => '<div class="event"><b>' + escapeHtml(new Date(e.time).toLocaleTimeString()) + '</b><br>' + escapeHtml(e.text) + '</div>').join('') : 'No events yet.'; }

  function icon(v){ return v.type === 'home' ? '⌂' : v.type === 'traveling' ? '🚚' : v.type === 'player' ? '👤' : v.type === 'monument' ? '◆' : '🛒'; }
  function shortLabel(v){ if (v.type === 'home') return 'Home'; if (v.type === 'vending') return v.grid || 'Vendor'; if (v.type === 'traveling') return v.halted ? 'Halted' : 'Vendor'; return v.label || ''; }
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
