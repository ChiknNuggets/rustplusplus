const DiscordVoice = require('../src/discordTools/discordVoice.js');

module.exports = {
    name: 'dm-voice-plugin',
    discord: {
        messageCreate: async (client, message) => {
            if (message.guildId === null && !message.author.bot) {
                for (const guild of client.guilds.cache.values()) {
                    await DiscordVoice.sendDiscordVoiceMessage(guild.id, message.content);
                }
            }
        }
    }
};

