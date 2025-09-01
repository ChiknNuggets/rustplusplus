// Example Plugin Template
//
// What this shows:
// - Per‑guild settings via configSchema (rendered in the Plugins panel modal)
// - Reading/writing settings safely (getInstance/setInstance)
// - Enable/disable hooks (onEnabled/onDisabled)
// - Handling an in‑game command ("!demo ...")
// - Providing a Discord slash command ("/demo")
// - Listening to a game event hook (onSmartAlarmState)
//
// How to use:
// 1) Drop this file in the `plugins/` folder (already done).
// 2) Open the Plugins channel in Discord, toggle this plugin ON.
// 3) Click the config button to set fields, then try `!demo` in game or `/demo` in Discord.

const Path = require('path');
const DiscordEmbeds = require('../src/discordTools/discordEmbeds.js');
const DiscordTools = require('../src/discordTools/discordTools.js');
const Constants = require('../src/util/constants.js');

const PLUGIN_NAME = Path.basename(__filename); // e.g., example-plugin-template.js

function asBool(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  }
  return fallback;
}

function asInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function getSettings(client, guildId) {
  const instance = client.getInstance(guildId);
  if (!instance.pluginSettings) instance.pluginSettings = {};
  if (!instance.pluginSettings[PLUGIN_NAME]) instance.pluginSettings[PLUGIN_NAME] = {};
  return { instance, settings: instance.pluginSettings[PLUGIN_NAME] };
}

function saveSettings(client, guildId, instance, settings) {
  instance.pluginSettings[PLUGIN_NAME] = settings;
  client.setInstance(guildId, instance);
}

module.exports = {
  // Default toggle state for new guilds
  defaultEnabled: false,
  displayName: 'Example Plugin Template',
  description: 'Starter template demonstrating settings, hooks, in‑game and slash commands.',

  // Settings form shown in Plugins panel (all inputs render as short text fields)
  // Note: Values are saved as strings; parse them as needed (see asBool/asInt above).
  configSchema: {
    command: { type: 'text', label: 'In‑game command (without prefix)', default: 'demo' },
    channel: { type: 'text', label: 'Optional channel name or ID for notifications', default: '' },
    featureEnabled: { type: 'bool', label: 'Enable sample feature', default: false },
    numberLimit: { type: 'text', label: 'Sample number limit', default: '10' }
  },

  // Called when the bot loads plugins (after i18n). Keep it lightweight.
  onLoad: ({ client }) => {
    client.log(client.intlGet(null, 'infoCap'), '[example-template] Loaded');
  },

  // Called right after the user toggles this plugin ON in the Plugins panel.
  onEnabled: async ({ client, guild }) => {
    try {
      const guildId = guild.id;
      const { instance, settings } = getSettings(client, guildId);
      client.log(client.intlGet(null, 'infoCap'), `[example-template] Enabled with settings: ${JSON.stringify(settings)}`);
      // Example: ensure configured channel exists (if provided)
      const chan = (settings.channel || '').trim();
      if (chan) {
        const resolved = DiscordTools.getTextChannelById(guildId, chan.replace(/[^0-9]/g, '')) ||
          (DiscordTools.getGuild(guildId)?.channels.cache.find(c => c.name === chan) ?? null);
        if (!resolved) {
          const created = await DiscordTools.addTextChannel(guildId, chan.replace(/^#/, ''));
          if (created) {
            settings.channel = created.id;
            saveSettings(client, guildId, instance, settings);
          }
        }
      }
    } catch (_) { /* ignore */ }
  },

  // Called when toggled OFF in the Plugins panel.
  onDisabled: async ({ client, guild }) => {
    client.log(client.intlGet(null, 'infoCap'), `[example-template] Disabled for guild ${guild.id}`);
  },

  // Example: handle an in‑game command like "!demo hello".
  onInGameCommand: async ({ rustplus, client, command, caller }) => {
    const guildId = rustplus.guildId;
    const { settings } = getSettings(client, guildId);
    const prefix = rustplus.generalSettings.prefix || '!';
    const cmd = (settings.command || 'demo').trim().toLowerCase();

    if (!command.toLowerCase().startsWith(`${prefix}${cmd}`)) return false;

    const arg = command.slice((`${prefix}${cmd}`).length).trim() || '(no arg)';
    const feature = asBool(settings.featureEnabled, false);
    const limit = asInt(settings.numberLimit, 10);
    await rustplus.sendInGameMessage(`Template demo: feature=${feature}, limit=${limit}, arg=${arg}`);
    return true;
  },

  // Provide a Discord slash command: /demo text:<string>
  slashCommands: [
    {
      name: 'demo',
      getData(client, guildId) {
        const Builder = require('@discordjs/builders');
        return new Builder.SlashCommandBuilder()
          .setName('demo')
          .setDescription('Example plugin template command')
          .addStringOption(option => option
            .setName('text')
            .setDescription('Optional text to echo')
            .setRequired(false));
      },
      async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');
        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: false });

        const text = interaction.options.getString('text') || '(no text)';
        const { settings } = getSettings(client, interaction.guildId);
        const feature = asBool(settings.featureEnabled, false);
        const limit = asInt(settings.numberLimit, 10);

        const embed = DiscordEmbeds.getEmbed({
          color: Constants.COLOR_DEFAULT,
          title: 'Example Plugin Template',
          description: `featureEnabled: ${feature}\nnumberLimit: ${limit}\ntext: ${text}`,
          timestamp: true
        });
        await client.interactionEditReply(interaction, { embeds: [embed] });
      }
    }
  ],

  // Example event hook: react to Smart Alarm state changes
  onSmartAlarmState: async ({ rustplus, client, entityId, active }) => {
    const guildId = rustplus.guildId;
    const { settings } = getSettings(client, guildId);
    if (!asBool(settings.featureEnabled, false)) return; // optional gating
    client.log(client.intlGet(null, 'infoCap'), `[example-template] SmartAlarm ${entityId} is now ${active ? 'ACTIVE' : 'inactive'}`);
  },
};

