// AI Chat (OpenAI-compatible) plugin
// Lets users ask questions with an in-game command and/or a Discord slash command
// without touching any core files. Designed to work with any OpenAI-compatible API
// (e.g., Zuki/Journey free endpoints) by configuring the base URL, model and key.

const Constants = require('../src/util/constants.js');

module.exports = {
  defaultEnabled: false,
  displayName: 'AI Chat (OpenAI-compatible)',
  description: 'Ask AI with !ai <question> or /ai, using a configurable OpenAI-compatible API (e.g., Zuki free model).',

  // All fields render as a short text input in the plugin modal. Parse as needed.
  // Keep at <= 5 fields to satisfy Discord modal limits
  configSchema: {
    command: { type: 'text', label: 'In-game command (without prefix)', default: 'ai' },
    apiUrl: { type: 'text', label: 'API base (OpenAI-compatible)', default: 'https://api.zukijourney.com/v1' },
    apiKey: { type: 'text', label: 'API key (optional if not required)', default: '' },
    model: { type: 'text', label: 'Model name', default: 'gpt-3.5-turbo' },
    systemPrompt: { type: 'text', label: 'System prompt (optional)', default: 'You are a helpful assistant. If the user\'s request is ambiguous yet plausibly about the video game Rust, interpret and answer in the Rust (video game) context. If it\'s clearly not about Rust, answer normally.' }
  },

  // Simple in-memory cooldown per guild
  _cooldowns: {},

  // In-game command handler: !ai <question>
  onInGameCommand: async ({ rustplus, client, command }) => {
    const guildId = rustplus.guildId;
    const instance = client.getInstance(guildId);
    const settings = (instance.pluginSettings && instance.pluginSettings['ai-chat-zuki.js']) || {};

    const prefix = rustplus.generalSettings.prefix || '!';
    const cmd = (settings.command || 'ai').trim().toLowerCase();
    const expectedStart = `${prefix}${cmd}`;
    if (!command.toLowerCase().startsWith(expectedStart)) return false;

    const question = command.slice(expectedStart.length).trim();
    if (!question) {
      await rustplus.sendInGameMessage(`Usage: ${expectedStart} <question>`);
      return true;
    }

    if (!module.exports._passCooldown(guildId, settings)) {
      await rustplus.sendInGameMessage('Please wait before sending another request.');
      return true;
    }

    try {
      const resp = await module.exports._chatComplete(client, guildId, settings, question);
      const text = (resp || 'No response').replace(/\s+/g, ' ').trim();
      // In-game message length is limited; trim to be safe
      const max = Math.max(32, Constants.MAX_LENGTH_TEAM_MESSAGE || 128);
      await rustplus.sendInGameMessage(text.length > max ? `${text.slice(0, max - 3)}...` : text);
    } catch (e) {
      await rustplus.sendInGameMessage(`AI error: ${e?.message || e}`);
    }
    return true;
  },

  // Provide a /ai question:<string> slash command
  slashCommands: [
    {
      name: 'ai',
      getData(client, guildId) {
        const Builder = require('@discordjs/builders');
        return new Builder.SlashCommandBuilder()
          .setName('ai')
          .setDescription('Ask the configured AI model a question')
          .addStringOption(option => option
            .setName('question')
            .setDescription('Your question')
            .setRequired(true));
      },
      async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');
        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: false });

        const guildId = interaction.guildId;
        const instance = client.getInstance(guildId);
        const settings = (instance.pluginSettings && instance.pluginSettings['ai-chat-zuki.js']) || {};

        const question = interaction.options.getString('question');
        if (!module.exports._passCooldown(guildId, settings)) {
          await client.interactionEditReply(interaction, { content: 'Please wait before sending another request.' });
          return;
        }
        try {
          const answer = await module.exports._chatComplete(client, guildId, settings, question);
          await client.interactionEditReply(interaction, { content: answer || 'No response' });
        } catch (e) {
          await client.interactionEditReply(interaction, { content: `AI error: ${e?.message || e}` });
        }
      }
    }
  ],

  // Helpers
  _passCooldown(guildId, settings) {
    const cd = Math.max(0, parseInt((settings.cooldownSeconds ?? '10'), 10) || 0);
    const now = Date.now();
    const last = module.exports._cooldowns[guildId] || 0;
    if (now - last < cd * 1000) return false;
    module.exports._cooldowns[guildId] = now;
    return true;
  },

  async _chatComplete(client, guildId, settings, userContent) {
    const base = (settings.apiUrl || 'https://api.zukijourney.com/v1').trim().replace(/\/$/, '');
    const url = `${base}/chat/completions`;
    const apiKey = (settings.apiKey || '').trim();
    const model = (settings.model || 'gpt-3.5-turbo').trim();
    const system = (settings.systemPrompt || 'You are a helpful assistant. If the user\'s request is ambiguous yet plausibly about the video game Rust, interpret and answer in the Rust (video game) context. If it\'s clearly not about Rust, answer normally.').trim();
    const temperature = Math.max(0, Math.min(2, parseFloat(settings.temperature ?? '0.7') || 0.7));
    const maxTokens = Math.max(1, parseInt(settings.maxTokens ?? '512', 10) || 512);

    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent }
      ],
      temperature,
      max_tokens: maxTokens
    };

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    let json;
    try {
      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!resp.ok) {
        let txt = '';
        try { txt = await resp.text(); } catch (_) {}
        throw new Error(`${resp.status} ${txt}`);
      }
      json = await resp.json();
    } catch (e) {
      client.log(client.intlGet(null, 'errorCap'), `[ai-chat] request failed: ${e?.message || e}`, 'error');
      throw e;
    }

    try {
      return (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || null;
    } catch (_) { return null; }
  }
};
