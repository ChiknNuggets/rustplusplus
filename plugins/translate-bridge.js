const Path = require('path');
const Translate = require('translate');
const DiscordVoice = require('../src/discordTools/discordVoice.js');

const PLUGIN_NAME = Path.basename(__filename);

function getSettings(client, guildId) {
  const instance = client.getInstance(guildId);
  if (!instance.pluginSettings) instance.pluginSettings = {};
  if (!instance.pluginSettings[PLUGIN_NAME]) instance.pluginSettings[PLUGIN_NAME] = {};
  return { instance, settings: instance.pluginSettings[PLUGIN_NAME] };
}

module.exports = {
  defaultEnabled: true,
  displayName: 'RU/EN Translate + Speak',
  description: 'Adds !ru and !en in-game commands, translates message text, and speaks it in Discord voice if connected.',
  configSchema: {
    ruCommand: { type: 'text', label: 'Command for RU->EN (without prefix)', default: 'ru' },
    enCommand: { type: 'text', label: 'Command for EN->RU (without prefix)', default: 'en' },
    speakInVoice: { type: 'bool', label: 'Speak translated text in connected Discord voice channel', default: true }
  },

  onLoad: ({ client }) => {
    client.log(client.intlGet(null, 'infoCap'), '[translate-bridge] loaded');
  },

  onInGameCommand: async ({ rustplus, client, command, caller }) => {
    const guildId = rustplus.guildId;
    const { settings } = getSettings(client, guildId);

    const prefix = rustplus.generalSettings.prefix || '!';
    const ruCommand = (settings.ruCommand || 'ru').trim().toLowerCase();
    const enCommand = (settings.enCommand || 'en').trim().toLowerCase();

    const trimmed = command.trim();
    const lower = trimmed.toLowerCase();

    let from = null;
    let to = null;
    let rawText = '';

    if (lower.startsWith(`${prefix}${ruCommand} `)) {
      from = 'ru';
      to = 'en';
      rawText = trimmed.slice(`${prefix}${ruCommand}`.length).trim();
    }
    else if (lower.startsWith(`${prefix}${enCommand} `)) {
      from = 'en';
      to = 'ru';
      rawText = trimmed.slice(`${prefix}${enCommand}`.length).trim();
    }
    else {
      return false;
    }

    if (!rawText) {
      await rustplus.sendInGameMessage(`Usage: ${prefix}${from} <text>`);
      return true;
    }

    try {
      const translated = await Translate(rawText, { from, to });
      const output = `${caller.name}: ${translated}`;

      await rustplus.sendInGameMessage(output);

      const speakInVoice = (typeof settings.speakInVoice === 'boolean') ? settings.speakInVoice : true;
      if (speakInVoice) {
        await DiscordVoice.sendDiscordVoiceMessage(guildId, translated);
      }

      return true;
    }
    catch (e) {
      await rustplus.sendInGameMessage('Translation failed. Try again in a moment.');
      client.log(client.intlGet(null, 'errorCap'), `[translate-bridge] ${e?.stack || e}`, 'error');
      return true;
    }
  }
};
