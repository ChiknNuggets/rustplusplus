// Example plugin: If a specific SteamID talks in team chat, speak it in Discord VC
// Default off until configured

const Path = require('path');
const DiscordVoice = require(Path.join('..', 'src', 'discordTools', 'discordVoice.js'));

module.exports = {
  defaultEnabled: false,
  displayName: 'Voice from SteamID',
  description: 'Speaks in Discord VC whenever the configured SteamID sends a team chat message.',
  // Plugin-defined config schema rendered in the Edit modal
  // Supported types: text | number | bool (enter true/false)
  configSchema: {
    steamId: { type: 'text', label: 'Target SteamID64', required: false, default: '' }
  },

  onLoad: ({ client }) => {
    client.log(client.intlGet(null, 'infoCap'), '[voice-from-steamid] loaded');
  },

  // Called for every in-game team chat message
  // message: { steamId, name, message }
  onInGameChat: async ({ rustplus, client, message /*, isCommand */ }) => {
    try {
      const guildId = rustplus.guildId;
      const instance = client.getInstance(guildId);
      const settings = (instance.pluginSettings && instance.pluginSettings['example-voice-from-steamid.js']) || {};
      const targetSteamId = (settings.steamId || '').trim();
      if (!targetSteamId) return; // not configured
		
      const msgSteamId = `${message.steamId}`; // normalize
      if (msgSteamId !== targetSteamId) return;

      const text = `${message.message}`;
      await DiscordVoice.sendDiscordVoiceMessage(guildId, text);
    } catch (e) {
      try { client.log(client.intlGet(null, 'errorCap'), `[voice-from-steamid] ${e?.stack || e}`, 'error'); } catch (_) {}
    }
  },
};
