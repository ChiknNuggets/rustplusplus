// BattleMetrics BM Info plugin
// Usage: !bm <player name>

module.exports = {
  defaultEnabled: true,
  displayName: 'BattleMetrics BM',
  description: "Fetch BM info for a player: total Rust hours (all-time), first seen (years), and previous names.",
  configSchema: {
    command: { type: 'text', label: 'Command (without prefix)', default: 'bm' },
    include24h: { type: 'bool', label: 'Include last 24 hours', default: true },
    include7d: { type: 'bool', label: 'Include last 7 days', default: true },
    include30d: { type: 'bool', label: 'Include last 30 days', default: true },
    includeAllTime: { type: 'bool', label: 'Include All-Time', default: true },
    rustOnly: { type: 'bool', label: 'Restrict to Rust sessions only', default: true }
  },

  onInGameCommand: async ({ rustplus, client, command }) => {
    const guildId = rustplus.guildId;
    const instance = client.getInstance(guildId);
    const settings = (instance.pluginSettings && instance.pluginSettings['battlemetrics-hours.js']) || {};

    const prefix = rustplus.generalSettings.prefix || '!';
    const cmd = (settings.command || 'bm').trim().toLowerCase();
    const expectedStart = `${prefix}${cmd}`;
    if (!command.toLowerCase().startsWith(expectedStart)) return false;

    const nameArg = command.slice(expectedStart.length).trim();
    if (!nameArg) {
      await rustplus.sendInGameMessage(`Usage: ${expectedStart} <player name>`);
      return true;
    }

    // Determine current server's BattleMetrics ID
    const active = instance.activeServer;
    const bmId = active && instance.serverList[active] ? (instance.serverList[active].battlemetricsId || '') : '';
    if (!bmId) {
      await rustplus.sendInGameMessage('No BattleMetrics ID configured for the current server.');
      return true;
    }

    // Find playerId by name, preferring candidates that have played on current server
    client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Resolving player '${nameArg}' for server ${bmId}`);
    const playerId = await resolvePlayerIdForServer(nameArg, bmId, client);
    if (!playerId) {
      await rustplus.sendInGameMessage(`Could not find player on BattleMetrics: ${nameArg}`);
      client.log(client.intlGet(null, 'warningCap'), `[bm-hours] No player resolved for '${nameArg}' on server ${bmId}`);
      return true;
    }

    const rustOnly = (settings.rustOnly ?? true) === true;

    // Fetch sessions to compute 24h/7d/30d totals
    let totals = [];
    try {
      const numberOfWeeks = 52; // ensure ~30 days coverage
      client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Fetching sessions for player ${playerId}, weeks=${numberOfWeeks}`);
      const sessionData = await fetchSessionData(playerId, numberOfWeeks, client);
      if ((settings.include24h ?? true) === true) {
        const h24 = await sumSessionHoursInRange(sessionData, 24 * 60 * 60 * 1000, rustOnly);
        totals.push(`24h: ${h24.toFixed(2)}h`);
      }
      if ((settings.include7d ?? true) === true) {
        const h7d = await sumSessionHoursInRange(sessionData, 7 * 24 * 60 * 60 * 1000, rustOnly);
        totals.push(`7d: ${h7d.toFixed(2)}h`);
      }
      if ((settings.include30d ?? true) === true) {
        const h30d = await sumSessionHoursInRange(sessionData, 30 * 24 * 60 * 60 * 1000, rustOnly);
        totals.push(`30d: ${h30d.toFixed(2)}h`);
      }
    }
    catch (e) {
      totals.push('sessions: error');
      client.log(client.intlGet(null, 'errorCap'), `[bm-hours] Sessions fetch failed: ${e?.message || e}`, 'error');
    }

    // Fetch all-time totals via players/{id}?include=server
    try {
      if ((settings.includeAllTime ?? true) === true) {
        client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Fetching profile/server data for player ${playerId}`);
        const serverData = await fetchServerData(playerId, client);
        const timeData = calculateHours(serverData);
        const allRust = timeData['rust']?.playTime ? Number(timeData['rust'].playTime) : 0;
        totals.push(`All: ${allRust.toFixed(2)}h`);
      }
    }
    catch (e) {
      totals.push('All: error');
      client.log(client.intlGet(null, 'errorCap'), `[bm-hours] All-time fetch failed: ${e?.message || e}`, 'error');
    }

    // Fetch and include aliases (previous usernames)
    let aliasLine = '';
    try {
      const aliases = await fetchAliases(playerId, client);
      if (aliases.length) {
        aliases.sort((a,b)=> new Date(b.lastSeen||0) - new Date(a.lastSeen||0));
        const names = aliases.map(a => a.name).slice(0, 10);
        aliasLine = ` | Aliases: ${names.join(', ')}`;
      }
    } catch (_) { }

    // New BM info message (4 lines)
    let displayName = nameArg;
    let totalHours = 'error';
    let firstSeenYears = 'unknown';
    let prevNames = 'None';

    try {
      const profile = await fetchPlayerProfile(playerId, client);
      if (profile?.name) displayName = profile.name;
      if (profile?.createdAt) firstSeenYears = yearsSince(profile.createdAt);
    } catch (_) { /* ignore */ }

    try {
      const serverData = await fetchServerData(playerId, client);
      const timeData = calculateHours(serverData);
      const allRust = timeData['rust']?.playTime ? Number(timeData['rust'].playTime) : 0;
      totalHours = allRust.toFixed(2);
    } catch (_) { /* ignore */ }

    try {
      const aliases = await fetchAliases(playerId, client);
      if (aliases.length) {
        aliases.sort((a,b)=> new Date(b.lastSeen||0) - new Date(a.lastSeen||0));
        const seen = new Set();
        const list = [];
        for (const a of aliases) {
          const n = (a.name || '').trim();
          if (!n || n.toLowerCase() === displayName.toLowerCase()) continue;
          if (seen.has(n.toLowerCase())) continue;
          seen.add(n.toLowerCase());
          list.push(n);
          if (list.length >= 4) break;
        }
        if (list.length) prevNames = list.join(', ');
      }
    } catch (_) { /* ignore */ }

    const lines = [
      `${displayName} BM Info`,
      `Total Hours = ${totalHours}`,
      `First Seen = ${firstSeenYears}`,
      `Previous Names = ${prevNames}`
    ];
    const msg = lines.join('\n');
    await rustplus.sendInGameMessage(msg);
    client.log(client.intlGet(null, 'infoCap'), `[bm-hours] ${msg}`);
    return true;
  },

  // Provide Discord slash commands directly from the plugin
  // Exposes: /bm name:<string>
  slashCommands: [
    {
      name: 'bm',
      getData(client, guildId) {
        const Builder = require('@discordjs/builders');
        return new Builder.SlashCommandBuilder()
          .setName('bm')
          .setDescription('BattleMetrics info (hours, first seen, names) by player name')
          .addStringOption(option => option
            .setName('name')
            .setDescription('The player name to search for')
            .setRequired(true));
      },
      async execute(client, interaction) {
        const DiscordEmbeds = require('../src/discordTools/discordEmbeds.js');
        const Constants = require('../src/util/constants.js');

        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: false });

        const name = interaction.options.getString('name');
        try {
          if (typeof module.exports.queryBMInfo !== 'function') {
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, 'Plugin not available.'));
            return;
          }

          const result = await module.exports.queryBMInfo(client, interaction.guildId, name);
          if (!result.ok) {
            await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, result.message));
            return;
          }

          // Build embed with bullet list and profile link
          const bullets = (Array.isArray(result.rows) ? result.rows.slice(0, 20) : [])
            .map(r => `- ${r.name} (${Number.isFinite(r.days) ? r.days : '?'} days ago)`) 
            .join('\n');

          const profileUrl = `${Constants.BATTLEMETRICS_PROFILE_URL}${result.playerId}`;

          const embed = DiscordEmbeds.getEmbed({
            color: Constants.COLOR_DEFAULT,
            title: `${result.displayName} BattleMetrics`,
            url: profileUrl,
            description: `**Total Hours:** ${result.totalHours}\n` +
                         `**First Seen:** ${result.firstSeenYears}\n\n` +
                         `Previous Names:\n${bullets || 'None'}\n\n` +
                         `Profile: [${result.playerId}](${profileUrl})`
          });
          await client.interactionEditReply(interaction, { embeds: [embed] });
        }
        catch (e) {
          await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, `Error: ${e?.message || e}`));
        }
      }
    }
  ],
};

// Utilities based on jxtt-dev/battlemetrics_hour_summary
const BM_API = 'https://api.battlemetrics.com/players/';

async function resolvePlayerIdForServer(playerName, bmServerId, client) {
  const lc = playerName.trim().toLowerCase();

  // 0) Prefer the bot's local BattleMetrics instance: search ONLINE players on current server first
  try {
    const bmLocal = client && client.battlemetricsInstances ? client.battlemetricsInstances[bmServerId] : null;
    if (bmLocal && bmLocal.ready && bmLocal.players) {
      // Exact match among online
      for (const pid of (bmLocal.onlinePlayers || [])) {
        const n = (bmLocal.players[pid]?.name || '').trim().toLowerCase();
        if (n === lc) {
          client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Resolved from local ONLINE exact: ${pid}`);
          return pid;
        }
      }
      // Exact match among all cached players
      for (const [pid, data] of Object.entries(bmLocal.players)) {
        const n = (data?.name || '').trim().toLowerCase();
        if (n === lc) {
          client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Resolved from local exact: ${pid}`);
          return pid;
        }
      }
      // Partial (contains) among online
      for (const pid of (bmLocal.onlinePlayers || [])) {
        const n = (bmLocal.players[pid]?.name || '').trim().toLowerCase();
        if (n && n.includes(lc)) {
          client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Resolved from local ONLINE contains: ${pid}`);
          return pid;
        }
      }
      // Partial (contains) among all
      for (const [pid, data] of Object.entries(bmLocal.players)) {
        const n = (data?.name || '').trim().toLowerCase();
        if (n && n.includes(lc)) {
          client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Resolved from local contains: ${pid}`);
          return pid;
        }
      }
    }
  } catch (_) { /* ignore */ }

  // First attempt: search limited to the current server
  try {
    // Note: BattleMetrics /players does not support filter[game]; rely on server filter
    const qp = new URLSearchParams({ 'filter[search]': playerName, 'filter[servers]': bmServerId, 'page[size]': '50' }).toString();
    const url = `https://api.battlemetrics.com/players?${qp}`;
    const json = await httpGetJson(url, client);
    if (json) {
      client && client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Server-filtered search results: ${json.data?.length || 0}`);
      if (json && Array.isArray(json.data) && json.data.length > 0) {
        const exact = json.data.find(e => (e.attributes?.name || '').trim().toLowerCase() === lc);
        return (exact || json.data[0]).id;
      }
    }
  } catch (_) { /* ignore */ }

  // Second attempt: global search, prefer candidates that have played on this server
  try {
    // Global search by name only
    const qp2 = new URLSearchParams({ 'filter[search]': playerName, 'page[size]': '25' }).toString();
    const url2 = `https://api.battlemetrics.com/players?${qp2}`;
    const json2 = await httpGetJson(url2, client);
    if (!json2) return null;
    client && client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Global search results: ${json2.data?.length || 0}`);
    if (!json2 || !Array.isArray(json2.data) || json2.data.length === 0) return null;

    // Prefer exact + on server
    for (const cand of json2.data) {
      const name = (cand.attributes?.name || '').trim().toLowerCase();
      if (name !== lc) continue;
      try {
        const included = await fetchServerData(cand.id, client);
        if (included && included.find(s => s.id === bmServerId)) return cand.id;
      } catch (_) { }
    }
    // Any on server
    for (const cand of json2.data) {
      try {
        const included = await fetchServerData(cand.id, client);
        if (included && included.find(s => s.id === bmServerId)) return cand.id;
      } catch (_) { }
    }
    // Exact match
    const exact2 = json2.data.find(e => (e.attributes?.name || '').trim().toLowerCase() === lc);
    if (exact2) return exact2.id;
    // First result
    return json2.data[0].id;
  } catch (_) {
    return null;
  }
}

// Fetch player server data from BattleMetrics API (players/{id}?include=server)
async function fetchServerData(playerId, client) {
  const url = `${BM_API}${playerId}?` + new URLSearchParams({ include: 'server' }).toString();
  const json = await httpGetJson(url, client);
  if (!json) throw new Error('BattleMetrics API profile fetch failed');
  const includedCount = Array.isArray(json.included) ? json.included.length : 0;
  client && client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Profile include servers: ${includedCount}`);
  if (!('included' in json)) throw new Error('BattleMetrics API returned incorrect data');
  return json.included;
}

// Calculate all-time hours aggregated by game from included servers
function calculateHours(serverData) {
  const timeData = {};
  serverData.forEach(server => {
    const serverName = server.attributes?.name;
    const serverGame = server.relationships?.game?.data?.id;
    const timePlayed = server.meta?.timePlayed || 0; // seconds
    if (!serverGame) return;

    if (!timeData[serverGame]) timeData[serverGame] = { playTime: 0, serverList: [] };
    timeData[serverGame].playTime += timePlayed / 3600; // convert to hours here
    timeData[serverGame].serverList.push({ serverName, serverPlayTime: timePlayed / 3600 });
  });

  // Sort servers by playtime
  Object.keys(timeData).forEach(gameId => {
    timeData[gameId].serverList.sort((a, b) => b.serverPlayTime - a.serverPlayTime);
    // round to 2 decimals
    timeData[gameId].playTime = Number(timeData[gameId].playTime.toFixed(2));
    timeData[gameId].serverList = timeData[gameId].serverList.map(s => ({
      serverName: s.serverName,
      serverPlayTime: Number(s.serverPlayTime.toFixed(2))
    }));
  });

  return timeData;
}

// Fetch session data from BattleMetrics API
async function fetchSessionData(playerId, numberOfWeeks, client) {
  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() - 7 * numberOfWeeks);

  const url = `${BM_API}${playerId}/relationships/sessions?` + new URLSearchParams({ include: 'server', 'page[size]': '100' }).toString();

  let nextUrl = '';
  let currentPage = 0;
  let sessionData = { data: [], included: [] };

  do {
    const reqUrl = currentPage === 0 ? url : nextUrl;
    const json = await httpGetJson(reqUrl, client);
    if (!json) throw new Error('BattleMetrics API sessions fetch failed');
    if (!('data' in json)) throw new Error('BattleMetrics API returned incorrect data');

    sessionData = {
      data: [...sessionData.data, ...json.data],
      included: [...sessionData.included, ...(json.included || [])]
    };
    client && client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Page ${currentPage+1} sessions: +${json.data?.length || 0}, total=${sessionData.data.length}`);

    if (!json.links || !json.links.next) break;
    nextUrl = json.links.next;
    if (currentPage !== 0) await sleep(1000); // avoid rate limiting
    currentPage++;
  } while (!sessionEndReached(sessionData, periodEnd));

  sessionData.included = sessionData.included.filter((v, i, self) => i === self.findIndex(x => x.id === v.id));
  client && client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Sessions fetch complete. sessions=${sessionData.data.length}, servers=${sessionData.included.length}`);
  return sessionData;
}

function sessionEndReached(cumulativeData, periodEnd) {
  if (!cumulativeData.data.length) return true;
  const last = cumulativeData.data[cumulativeData.data.length - 1];
  const lastStart = Date.parse(last.attributes.start);
  const lastEnd = Date.parse(last.attributes.end);
  return lastStart < periodEnd || lastEnd < periodEnd;
}

async function sumSessionHoursInRange(sessionData, windowMs, rustOnly) {
  const now = Date.now();
  const start = now - windowMs;
  const serverToGame = {};
  (sessionData.included || []).forEach(server => {
    const gid = server.relationships?.game?.data?.id;
    if (gid) serverToGame[server.id] = gid;
  });

  let totalMs = 0;
  (sessionData.data || []).forEach(session => {
    const serverId = session.relationships?.server?.data?.id;
    const gameName = serverToGame[serverId] || 'unknown';
    if (rustOnly && gameName !== 'rust') return;
    const s = new Date(session.attributes.start).getTime();
    const e = new Date(session.attributes.end || session.attributes.stop).getTime();
    const overlapStart = Math.max(s, start);
    const overlapEnd = Math.min(e, now);
    if (overlapEnd > overlapStart) totalMs += (overlapEnd - overlapStart);
  });
  return totalMs / 3_600_000;
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function httpGetJson(url, client) {
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'rustplusplus-plugin/1.0', 'Accept': 'application/vnd.api+json' } });
    if (!resp.ok) {
      let body = '';
      try { body = await resp.text(); } catch (_) { }
      client && client.log(client.intlGet(null, 'errorCap'), `[bm-hours] GET ${url} -> ${resp.status} ${body}`, 'error');
      return null;
    }
    const json = await resp.json();
    return json;
  } catch (e) {
    client && client.log(client.intlGet(null, 'errorCap'), `[bm-hours] GET ${url} failed: ${e?.message || e}`, 'error');
    return null;
  }
}

// Exported helper for Discord slash command reuse
module.exports.queryBMInfo = async function (client, guildId, playerName) {
  const instance = client.getInstance(guildId);
  const active = instance.activeServer;
  const bmId = active && instance.serverList[active] ? (instance.serverList[active].battlemetricsId || '') : '';
  if (!bmId) {
    return { ok: false, message: 'No BattleMetrics ID configured for the current server.' };
  }
  client.log(client.intlGet(null, 'infoCap'), `[bm-hours] Resolving player '${playerName}' for server ${bmId}`);
  const playerId = await resolvePlayerIdForServer(playerName, bmId, client);
  if (!playerId) {
    return { ok: false, message: `Could not find player on BattleMetrics: ${playerName}` };
  }

  const totals = [];
  try {
    const sessionData = await fetchSessionData(playerId, 5, client);
    const h24 = await sumSessionHoursInRange(sessionData, 24 * 60 * 60 * 1000, true);
    const h7d = await sumSessionHoursInRange(sessionData, 7 * 24 * 60 * 60 * 1000, true);
    const h30d = await sumSessionHoursInRange(sessionData, 30 * 24 * 60 * 60 * 1000, true);
    totals.push(`24h: ${h24.toFixed(2)}h`, `7d: ${h7d.toFixed(2)}h`, `30d: ${h30d.toFixed(2)}h`);
  } catch (e) {
    totals.push('sessions: error');
  }

  let allTime = 'All: error';
  try {
    const serverData = await fetchServerData(playerId, client);
    const timeData = calculateHours(serverData);
    const allRust = timeData['rust']?.playTime ? Number(timeData['rust'].playTime) : 0;
    allTime = `All: ${allRust.toFixed(2)}h`;
  } catch (_) {}

  // Build 4-line output
  let displayName = playerName;
  let totalHours = 'error';
  let firstSeenYears = 'unknown';
  try {
    const profile = await fetchPlayerProfile(playerId, client);
    if (profile?.name) displayName = profile.name;
    if (profile?.createdAt) firstSeenYears = yearsSince(profile.createdAt);
  } catch (_) { /* ignore */ }

  try {
    const serverData = await fetchServerData(playerId, client);
    const timeData = calculateHours(serverData);
    const allRust = timeData['rust']?.playTime ? Number(timeData['rust'].playTime) : 0;
    totalHours = allRust.toFixed(2);
  } catch (_) { /* ignore */ }

  const aliases = await fetchAliases(playerId, client);
  aliases.sort((a,b)=> new Date(b.lastSeen||0) - new Date(a.lastSeen||0));
  const rows = [];
  const seen = new Set();
  for (const a of aliases) {
    const n = (a.name || '').trim();
    if (!n || n.toLowerCase() === displayName.toLowerCase()) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const days = daysSince(a.lastSeen);
    rows.push({ name: n, days });
    if (rows.length >= 20) break;
  }
  let table = 'None';
  if (rows.length) {
    const header = `${'Name'.padEnd(32)} | Days Since`;
    const body = rows.map(r => `${r.name.slice(0, 48).padEnd(32)} | ${Number.isFinite(r.days) ? r.days : '-'}`).join('\n');
    table = '```\n' + header + '\n' + body + '\n```';
  }

  const text = `${displayName} BM Info\n` +
               `Total Hours = ${totalHours}\n` +
               `First Seen = ${firstSeenYears}\n` +
               `Previous Names:\n${table}`;
  return { ok: true, message: text, playerId, aliases, displayName, totalHours, firstSeenYears, rows };
}

async function fetchAliases(playerId, client) {
  const url = `${BM_API}${playerId}?` + new URLSearchParams({ include: 'identifier' }).toString();
  const json = await httpGetJson(url, client);
  if (!json || !Array.isArray(json.included)) return [];
  const out = [];
  for (const item of json.included) {
    if (item.type !== 'identifier') continue;
    const attrs = item.attributes || {};
    if (attrs.type !== 'name') continue;
    if (!attrs.identifier) continue;
    out.push({ name: attrs.identifier, lastSeen: attrs.lastSeen });
  }
  return out;
}

async function fetchPlayerProfile(playerId, client) {
  const url = `${BM_API}${playerId}`;
  const json = await httpGetJson(url, client);
  if (!json || !json.data || !json.data.attributes) throw new Error('BattleMetrics player fetch failed');
  const attrs = json.data.attributes || {};
  return { name: attrs.name, createdAt: attrs.createdAt };
}

function yearsSince(dateStr) {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  if (!isFinite(then)) return 'unknown';
  const years = (now - then) / (365.25 * 24 * 3600 * 1000);
  if (years < 0) return 'unknown';
  return `${years.toFixed(1)} years`;
}

function daysSince(dateStr) {
  const t = new Date(dateStr).getTime();
  if (!isFinite(t)) return NaN;
  const diff = Date.now() - t;
  if (diff < 0) return NaN;
  return Math.floor(diff / (24 * 3600 * 1000));
}
