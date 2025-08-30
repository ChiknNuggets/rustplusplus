/*
    Slash command: /hours name:<string>
    Uses the battlemetrics-hours plugin to fetch hours and aliases.
*/

const Builder = require('@discordjs/builders');

const DiscordEmbeds = require('../discordTools/discordEmbeds.js');

module.exports = {
  name: 'bmhours',

  getData(client, guildId) {
    return new Builder.SlashCommandBuilder()
      .setName('hours')
      .setDescription('BattleMetrics hours lookup by player name')
      .addStringOption(option => option
        .setName('name')
        .setDescription('The player name to search for')
        .setRequired(true));
  },

  async execute(client, interaction) {
    const verifyId = Math.floor(100000 + Math.random() * 900000);
    client.logInteraction(interaction, verifyId, 'slashCommand');

    if (!await client.validatePermissions(interaction)) return;
    await interaction.deferReply({ ephemeral: false });

    const name = interaction.options.getString('name');

    try {
      const plugin = require('../../plugins/battlemetrics-hours.js');
      if (!plugin || typeof plugin.queryBMHours !== 'function') {
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, 'Plugin not available.'));
        return;
      }

      const result = await plugin.queryBMHours(client, interaction.guildId, name);
      if (!result.ok) {
        await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, result.message));
        return;
      }

      await client.interactionEditReply(interaction, { content: result.message });
    }
    catch (e) {
      await client.interactionEditReply(interaction, DiscordEmbeds.getActionInfoEmbed(1, `Error: ${e?.message || e}`));
    }
  },
};
