// Example plugin: If a specific SteamID talks in team chat, speak it in Discord VC
// Default off until configured

const { createAudioPlayer, createAudioResource, getVoiceConnection, StreamType } = require('@discordjs/voice');
const { Readable } = require('stream');

const LANGUAGE_MAP = {
  cs: 'cs-CZ',
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  ko: 'ko-KR',
  pl: 'pl-PL',
  pt: 'pt-PT',
  ru: 'ru-RU',
  sv: 'sv-SE',
  tr: 'tr-TR'
};

const resolveLanguageCode = (language) => {
  if (!language) return 'en-US';
  if (language.includes('-')) return language;
  return LANGUAGE_MAP[language] || 'en-US';
};

module.exports = {
  defaultEnabled: false,
  displayName: 'Voice from SteamID',
  description: 'Speaks in Discord VC whenever the configured SteamID sends a team chat message.',
  // Plugin-defined config schema rendered in the Edit modal
  // Supported types: text | number | bool (enter true/false)
  configSchema: {
    steamId: { type: 'text', label: 'Target SteamID64', required: false, default: '' },
    apiKey: { type: 'text', label: 'Google TTS API Key', required: false, default: '' },
    voiceName: {
      type: 'text',
      label: 'Google TTS Voice Name (e.g. en-US-Chirp-HD-O)',
      required: false,
      default: ''
    }
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
      const apiKey = (settings.apiKey || '').trim();
      const voiceName = (settings.voiceName || '').trim();
      if (!targetSteamId) return; // not configured

      if (!apiKey) {
        client.log(client.intlGet(null, 'warnCap'), '[voice-from-steamid] missing Google TTS API key', 'warn');
        return;
      }

      const msgSteamId = `${message.steamId}`; // normalize
      if (msgSteamId !== targetSteamId) return;

      const text = `${message.message}`;
      const connection = getVoiceConnection(guildId);
      if (!connection) return;

      const language = resolveLanguageCode(instance.generalSettings?.language);
      const gender = instance.generalSettings?.voiceGender === 'female' ? 'FEMALE' : 'MALE';
      const voice = voiceName
        ? { name: voiceName, languageCode: language }
        : { languageCode: language, ssmlGender: gender };
      const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice,
          audioConfig: { audioEncoding: 'OGG_OPUS' }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        client.log(client.intlGet(null, 'errorCap'), `[voice-from-steamid] Google TTS error: ${errorText}`, 'error');
        return;
      }

      const payload = await response.json();
      if (!payload?.audioContent) return;
      const buffer = Buffer.from(payload.audioContent, 'base64');
      const resource = createAudioResource(Readable.from(buffer), { inputType: StreamType.OggOpus });
      const player = createAudioPlayer();
      connection.subscribe(player);
      player.play(resource);
    } catch (e) {
      try { client.log(client.intlGet(null, 'errorCap'), `[voice-from-steamid] ${e?.stack || e}`, 'error'); } catch (_) {}
    }
  },
};
