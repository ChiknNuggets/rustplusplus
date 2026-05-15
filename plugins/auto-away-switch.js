// Auto Away Switch plugin
//
// Turns on configured smart switches and/or switch groups when the whole team is
// offline. Optionally, it can also turn them on when every online teammate has
// been AFK for the configured number of minutes.

const Path = require('path');
const SmartSwitchHandler = require('../src/handlers/smartSwitchHandler.js');
const SmartSwitchGroupHandler = require('../src/handlers/smartSwitchGroupHandler.js');

const PLUGIN_NAME = Path.basename(__filename);
const state = new Map();

const CONFIG_DEFAULTS = {
  targetIds: '',
  enableAfkTrigger: false,
  afkMinutes: 10,
  notifyInGame: true,
  message: 'Base defense enabled because everyone is offline or AFK.'
};

function getKey(rustplus) {
  return `${rustplus.guildId}:${rustplus.serverId}`;
}

function getState(rustplus) {
  const key = getKey(rustplus);
  if (!state.has(key)) {
    state.set(key, { timer: null, lastReason: null });
  }
  return state.get(key);
}

function clearAfkTimer(rustplus) {
  const entry = state.get(getKey(rustplus));
  if (entry?.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function getSettings(client, guildId) {
  const instance = client.getInstance(guildId);
  const saved = (instance.pluginSettings && instance.pluginSettings[PLUGIN_NAME]) || {};
  return {
    ...CONFIG_DEFAULTS,
    ...saved,
    targetIds: saved.targetIds ?? CONFIG_DEFAULTS.targetIds,
    enableAfkTrigger: asBool(saved.enableAfkTrigger, CONFIG_DEFAULTS.enableAfkTrigger),
    afkMinutes: Math.max(1, asNumber(saved.afkMinutes, CONFIG_DEFAULTS.afkMinutes)),
    notifyInGame: asBool(saved.notifyInGame, CONFIG_DEFAULTS.notifyInGame),
    message: `${saved.message ?? CONFIG_DEFAULTS.message}`.trim() || CONFIG_DEFAULTS.message
  };
}

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getTargetIds(settings) {
  return `${settings.targetIds || ''}`
    .split(/[\s,]+/)
    .map(id => id.trim())
    .filter(Boolean);
}

function getAfkSeconds(player) {
  if (typeof player.getAfkSeconds === 'function') return player.getAfkSeconds();
  return Number(player.afkSeconds) || 0;
}

function getCondition(rustplus, settings) {
  const players = rustplus.team?.players || [];
  const onlinePlayers = players.filter(player => player.isOnline);
  if (players.length === 0) {
    return { met: false, reason: null, delayMs: null };
  }
  if (onlinePlayers.length === 0) {
    return { met: true, reason: 'offline', delayMs: null };
  }

  if (!settings.enableAfkTrigger) {
    return { met: false, reason: null, delayMs: null };
  }

  const thresholdSeconds = settings.afkMinutes * 60;
  const afkSeconds = onlinePlayers.map(getAfkSeconds);
  const shortestAfkSeconds = Math.min(...afkSeconds);

  if (shortestAfkSeconds >= thresholdSeconds) {
    return { met: true, reason: 'afk', delayMs: null };
  }

  return {
    met: false,
    reason: null,
    delayMs: Math.max(1000, Math.ceil((thresholdSeconds - shortestAfkSeconds) * 1000))
  };
}

async function turnTargetOn(rustplus, client, targetId) {
  const guildId = rustplus.guildId;
  const serverId = rustplus.serverId;
  const instance = client.getInstance(guildId);
  const server = instance.serverList?.[serverId];

  if (!server) return false;

  if (server.switches?.[targetId]) {
    if (!server.switches[targetId].active) {
      await SmartSwitchHandler.smartSwitchCommandTurnOnOff(rustplus, client, targetId, true);
      return true;
    }
    return false;
  }

  if (server.switchGroups?.[targetId]) {
    const group = server.switchGroups[targetId];
    const hasInactiveSwitch = group.switches.some(switchId => server.switches?.[switchId] && !server.switches[switchId].active);
    if (hasInactiveSwitch) {
      await SmartSwitchGroupHandler.TurnOnOffGroup(client, rustplus, guildId, serverId, targetId, true);
      return true;
    }
    return false;
  }

  client.log(client.intlGet(null, 'warningCap'), `[auto-away-switch] Unknown smart switch or switch group id: ${targetId}`);
  return false;
}

async function turnTargetsOn(rustplus, client, reason, settings) {
  const targets = getTargetIds(settings);
  if (targets.length === 0) return;

  let changed = 0;
  for (const targetId of targets) {
    if (await turnTargetOn(rustplus, client, targetId)) changed += 1;
  }

  const entry = getState(rustplus);
  entry.lastReason = reason;

  if (changed === 0) return;

  if (settings.notifyInGame) {
    await rustplus.sendInGameMessage(settings.message);
  }

  client.log(client.intlGet(null, 'infoCap'), `[auto-away-switch] Turned on ${changed} target(s) for ${reason}.`);
}

async function evaluate(rustplus, client) {
  const settings = getSettings(client, rustplus.guildId);
  const targets = getTargetIds(settings);
  if (targets.length === 0) return;

  clearAfkTimer(rustplus);

  const condition = getCondition(rustplus, settings);
  if (condition.met) {
    await turnTargetsOn(rustplus, client, condition.reason, settings);
    return;
  }

  const entry = getState(rustplus);
  entry.lastReason = null;

  if (condition.delayMs !== null) {
    entry.timer = setTimeout(() => {
      evaluate(rustplus, client).catch(err => {
        client.log(client.intlGet(null, 'errorCap'), `[auto-away-switch] Evaluation error: ${err?.stack || err}`, 'error');
      });
    }, condition.delayMs);
  }
}

module.exports = {
  defaultEnabled: false,
  displayName: 'Auto Away Switch',
  description: 'Turns on smart switches or switch groups when all teammates are offline, or optionally all online teammates are AFK.',

  configSchema: {
    targetIds: { type: 'text', label: 'Switch/group IDs (comma-separated)', default: '' },
    enableAfkTrigger: { type: 'bool', label: 'Also trigger when all are AFK', default: false },
    afkMinutes: { type: 'number', label: 'AFK minutes before trigger', default: 10 },
    notifyInGame: { type: 'bool', label: 'Send in-game message on trigger', default: true },
    message: { type: 'text', label: 'Trigger in-game message', default: CONFIG_DEFAULTS.message }
  },

  onLoad: ({ client }) => {
    client.log(client.intlGet(null, 'infoCap'), '[auto-away-switch] Loaded');
  },

  onUnload: () => {
    for (const entry of state.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    state.clear();
  },

  onEnabled: async ({ client, guild }) => {
    const rustplus = client.rustplusInstances?.[guild.id];
    if (rustplus) await evaluate(rustplus, client);
  },

  onDisabled: async ({ client, guild }) => {
    const rustplus = client.rustplusInstances?.[guild.id];
    if (rustplus) clearAfkTimer(rustplus);
  },

  onConnected: evaluate,
  onTeamChanged: evaluate,
  onPlayerConnected: evaluate,
  onPlayerDisconnected: evaluate,
  onPlayerAfkStart: evaluate,
  onPlayerAfkReturn: evaluate,
  onPlayerJoinedTeam: evaluate,
  onPlayerLeftTeam: evaluate
};
