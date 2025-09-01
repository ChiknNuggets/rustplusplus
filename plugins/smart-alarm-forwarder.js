// Smart Alarm Forwarder plugin
// Listens for smart alarm events and posts them to a configured Discord channel.
// Default: disabled. When enabled, it ensures the channel exists (creates if missing).

const Discord = require('discord.js');
const Path = require('path');
const DiscordTools = require('../src/discordTools/discordTools.js');
const DiscordEmbeds = require('../src/discordTools/discordEmbeds.js');
const Constants = require('../src/util/constants.js');

const PLUGIN_NAME = 'smart-alarm-forwarder.js';
const createLocks = Object.create(null); // per-guild channel creation locks

module.exports = {
  // Disabled by default per request
  defaultEnabled: false,
  displayName: 'Smart Alarm Forwarder',
  description: 'Posts Smart Alarm triggers/changes to a configured Discord channel (creates it if missing).',

  // Simple text-only config schema (modal supports text inputs). Users can enter a name or a channel ID/mention.
  configSchema: {
    channel: { type: 'text', label: 'Channel name or ID (e.g., smart-alarms or #smart-alarms)', default: 'smart-alarms' }
  },

  // Allows core to signal when plugin is enabled via UI toggle
  onEnabled: async ({ client, guild }) => {
    try {
      await ensureChannel(client, guild.id);
    } catch (_) { /* ignore */ }
  },

  // Ensure channels at load for already-enabled guilds
  onLoad: async ({ client }) => {
    try {
      for (const [guildId] of client.guilds.cache) {
        const instance = safeGetInstance(client, guildId);
        const enabled = getEnabled(instance, client, guildId);
        if (enabled) await ensureChannel(client, guildId);
      }
    } catch (_) { /* ignore */ }
  },

  // Also ensure channel when Rust+ connects (covers enabling between runs)
  onConnected: async ({ rustplus, client }) => {
    const guildId = rustplus.guildId;
    const instance = safeGetInstance(client, guildId);
    const enabled = getEnabled(instance, client, guildId);
    if (!enabled) return;
    await ensureChannel(client, guildId);
  },

  // Main handler: post smart alarm triggers (match Activity thread modal)
  onSmartAlarmState: async ({ rustplus, client, entityId, active }) => {
    const guildId = rustplus.guildId;
    const instance = safeGetInstance(client, guildId);
    const enabled = getEnabled(instance, client, guildId);
    if (!enabled) return;

    const channel = await ensureChannel(client, guildId);
    if (!channel) return;
    // Only forward the trigger modal when alarm goes active (to mirror #activity)
    if (!active) return;

    try {
      const serverId = rustplus.serverId;
      const server = instance.serverList?.[serverId];
      const alarm = server?.alarms?.[entityId];
      const embed = DiscordEmbeds.getAlarmEmbed(guildId, serverId, entityId);
      const filePath = Path.join(__dirname, '..', 'src', 'resources', 'images', 'electrics', alarm.image || 'smart_alarm.png');
      const files = [new Discord.AttachmentBuilder(filePath)];
      const content = alarm?.everyone ? '@everyone' : '';
      await client.messageSend(channel, { embeds: [embed], files, content });
    }
    catch (e) {
      try { await client.messageSend(channel, `Smart Alarm TRIGGERED — entity ${entityId}`); } catch (_) {}
    }
  },
};

function safeGetInstance(client, guildId) {
  try { return client.getInstance(guildId); } catch (_) { return null; }
}

function getEnabled(instance, client, guildId) {
  if (!instance || !instance.pluginSettings) return false;
  const settings = instance.pluginSettings[PLUGIN_NAME];
  if (typeof settings?.enabled === 'boolean') return settings.enabled;
  return false; // default disabled
}

async function ensureChannel(client, guildId) {
  const instance = safeGetInstance(client, guildId);
  if (!instance) return null;
  if (!instance.pluginSettings) instance.pluginSettings = {};
  if (!instance.pluginSettings[PLUGIN_NAME]) instance.pluginSettings[PLUGIN_NAME] = {};
  const settings = instance.pluginSettings[PLUGIN_NAME];

  // Prefer the explicitly configured channel string if present
  const desiredRaw = settings.channel ? String(settings.channel).trim() : '';
  let channel = null;

  if (desiredRaw) {
    // Resolve id/mention
    const idMatch = desiredRaw.match(/^<#!?(\d{16,25})>$/) || desiredRaw.match(/^(\d{16,25})$/);
    if (idMatch) {
      channel = DiscordTools.getTextChannelById(guildId, idMatch[1]);
    }

    // Resolve by name
    if (!channel) {
      try {
        const guild = DiscordTools.getGuild(guildId);
        if (guild) {
          const lower = desiredRaw.replace(/^#/, '').toLowerCase();
          channel = guild.channels.cache.find(c => c.type === require('discord.js').ChannelType.GuildText && c.name.toLowerCase() === lower) || null;
        }
      } catch (_) { /* ignore */ }
    }

    // Create by name if not found and not an explicit ID
    if (!channel && !desiredRaw.match(/^(<#!?\d{16,25}>)|(\d{16,25})$/)) {
      // Guard concurrent creation attempts per guild
      if (!createLocks[guildId]) {
        createLocks[guildId] = (async () => {
          try {
            const name = desiredRaw.replace(/^#/, '');
            const ch = await DiscordTools.addTextChannel(guildId, name);
            client.log(client.intlGet(null, 'infoCap'), `[smart-alarm-forwarder] Created channel '${name}' in guild ${guildId}`);
            return ch;
          } catch (e) {
            client.log(client.intlGet(null, 'errorCap'), `[smart-alarm-forwarder] Failed creating channel '${desiredRaw}': ${e?.message || e}`, 'error');
            return null;
          } finally {
            delete createLocks[guildId];
          }
        })();
      }
      channel = await createLocks[guildId];
    }

    if (channel) {
      settings.channelId = channel.id;
      settings.channel = desiredRaw;
      instance.pluginSettings[PLUGIN_NAME] = settings;
      try { client.setInstance(guildId, instance); } catch (_) { /* ignore */ }
      return channel;
    }
  }

  // Fallback to cached channelId if channel string is empty or resolution failed
  if (settings.channelId) {
    const ch = DiscordTools.getTextChannelById(guildId, settings.channelId);
    if (ch) return ch;
  }

  // Final fallback: create default channel
  try {
    if (!createLocks[guildId]) {
      createLocks[guildId] = (async () => {
        try {
          const ch = await DiscordTools.addTextChannel(guildId, 'smart-alarms');
          return ch;
        } finally {
          delete createLocks[guildId];
        }
      })();
    }
    channel = await createLocks[guildId];
    if (channel) {
      settings.channelId = channel.id;
      settings.channel = 'smart-alarms';
      instance.pluginSettings[PLUGIN_NAME] = settings;
      try { client.setInstance(guildId, instance); } catch (_) { /* ignore */ }
    }
  } catch (e) {
    client.log(client.intlGet(null, 'errorCap'), `[smart-alarm-forwarder] Failed creating default channel: ${e?.message || e}`, 'error');
  }

  return channel;
}
