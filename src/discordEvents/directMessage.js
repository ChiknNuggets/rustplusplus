const DiscordVoice = require('../discordTools/discordVoice.js');
const DiscordMessages = require('../discordTools/discordMessages.js');
const { getVoiceConnection } = require('@discordjs/voice');
const Translate = require('translate');

module.exports = {
    name: 'messageCreate',
    async execute(client, message) {
        if (message.guild) return;
        if (message.author.bot) return;

        let speakText = message.cleanContent;
        let AltVoice = false;
        if (/[\u3400-\u9FBF]/.test(message.cleanContent)) {
            try {
                speakText = await Translate(message.cleanContent, { from: 'zh', to: 'en' });
                AltVoice= true
            }
            catch (e) {
                client.log(client.intlGet(null, 'infoCap'), `Translation failed: ${e.message}`);
            }
        }

        for (const [guildId, rustplus] of Object.entries(client.rustplusInstances)) {
            if (!rustplus || !rustplus.isOperational) continue;

            const instance = client.getInstance(guildId);
            if (instance && instance.blacklist['discordIds'].includes(message.author.id)) continue;

            const connection = getVoiceConnection(guildId);
            if (connection) {
                await DiscordVoice.sendDiscordVoiceMessage(guildId, speakText, AltVoice);
            }
            else {
                await DiscordMessages.sendTTSMessage(guildId, message.author.username, speakText);
            }
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'logDiscordMessage', {
            guild: 'DM',
            channel: 'DM',
            user: `${message.author.username} (${message.author.id})`,
            message: message.cleanContent
        }));
    },
};

