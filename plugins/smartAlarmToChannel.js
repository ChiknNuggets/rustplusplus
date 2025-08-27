const Path = require('path');
const Discord = require('discord.js');
const DiscordEmbeds = require('../src/discordTools/discordEmbeds.js');
const DiscordMessages = require('../src/discordTools/discordMessages.js');

module.exports = {
    name: 'smart-alarm-channel',
    rustplus: {
        message: async (rustplus, client, message) => {
            if (!message.broadcast || !message.broadcast.entityChanged) return;

            const entityId = message.broadcast.entityChanged.entityId;
            const instance = client.getInstance(rustplus.guildId);
            const server = instance.serverList[rustplus.serverId];
            if (!server || !server.alarms[entityId]) return;

            const active = message.broadcast.entityChanged.payload.value;
            if (!active) return;

            const entity = server.alarms[entityId];
            const content = {
                embeds: [await DiscordEmbeds.getAlarmEmbed(rustplus.guildId, rustplus.serverId, entityId)],
                files: [new Discord.AttachmentBuilder(
                    Path.join(__dirname, '..', 'src', 'resources', 'images', 'electrics', entity.image))],
                content: entity.everyone ? '@everyone' : ''
            };

            await DiscordMessages.sendMessage(rustplus.guildId, content, null, instance.channelId.alarms);
        }
    }
};

