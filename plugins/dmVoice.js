const DiscordVoice = require('../src/discordTools/discordVoice.js');

module.exports = {
    name: 'dmVoice',
    discord: {
        messageCreate: async (client, message) => {
            if (message.guild) return; // Only handle direct messages
            if (message.author.bot) return;

            for (const guild of client.guilds.cache.values()) {
                const member = guild.members.cache.get(message.author.id);
                if (member && member.voice && member.voice.channelId) {
                    await DiscordVoice.sendDiscordVoiceMessage(guild.id, message.content);
                }
            }
        }
    }
};
