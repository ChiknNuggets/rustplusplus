/*
    Renders the Plugins panel in the plugins channel.
*/

const Discord = require('discord.js');
const Path = require('path');
const DiscordEmbeds = require('./discordEmbeds.js');
const DiscordButtons = require('./discordButtons.js');
const DiscordTools = require('./discordTools.js');
const Constants = require('../util/constants.js');

module.exports = async (client, guild, { force = false } = {}) => {
    const instance = client.getInstance(guild.id);
    const channel = DiscordTools.getTextChannelById(guild.id, instance.channelId.plugins);

    if (!channel) {
        client.log(client.intlGet(null, 'errorCap'), 'SetupPluginsPanel: ' +
            client.intlGet(null, 'invalidGuildOrChannel'), 'error');
        return;
    }

    if (instance.firstTime || force) {
        await DiscordTools.clearTextChannel(guild.id, instance.channelId.plugins, 100);

        // Header + Reload button
        await client.messageSend(channel, {
            embeds: [DiscordEmbeds.getEmbed({
                color: Constants.COLOR_SETTINGS,
                title: 'Plugins',
                thumbnail: `attachment://settings_logo.png`,
                fields: [{ name: client.intlGet(guild.id, 'noteCap'), value: 'Toggle and configure plugins per guild.', inline: true }]
            })],
            components: [DiscordButtons.getPluginsReloadButton(guild.id)],
            files: [new Discord.AttachmentBuilder(
                Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
        });

        const plugins = client.pluginManager?.plugins || [];
        for (const p of plugins) {
            const enabled = (instance.pluginSettings && p.name in instance.pluginSettings) ?
                !!instance.pluginSettings[p.name].enabled : (p.defaultEnabled ?? true);
            const displayName = p.displayName || p.name;
            const description = p.description || '';

            await client.messageSend(channel, {
                embeds: [DiscordEmbeds.getEmbed({
                    color: Constants.COLOR_SETTINGS,
                    title: `${displayName}`,
                    thumbnail: `attachment://settings_logo.png`,
                    fields: description ? [{ name: 'Description', value: description, inline: false }] : []
                })],
                components: [DiscordButtons.getPluginToggleAndConfigRow(guild.id, p.name, enabled)],
                files: [new Discord.AttachmentBuilder(
                    Path.join(__dirname, '..', 'resources/images/settings_logo.png'))]
            });
        }
    }
};
