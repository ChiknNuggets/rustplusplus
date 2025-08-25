/*
    Copyright (C) 2024 Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/
const DiscordVoice = require('../discordTools/discordVoice.js');
const Translate = require('translate');

module.exports = {
    name: 'messageCreate',
    async execute(client, message) {
        if (message.guild) return;
        if (message.author.bot) return;

        let speakText = message.cleanContent;
        if (/[\u3400-\u9FBF]/.test(message.cleanContent)) {
            try {
                speakText = await Translate(message.cleanContent, 'en');
            }
            catch (e) {
                client.log(client.intlGet(null, 'infoCap'), `Translation failed: ${e.message}`);
            }
        }

        for (const [guildId, rustplus] of Object.entries(client.rustplusInstances)) {
            if (!rustplus || !rustplus.isOperational) continue;

            const instance = client.getInstance(guildId);
            if (instance && instance.blacklist['discordIds'].includes(message.author.id)) continue;

            await DiscordVoice.sendDiscordVoiceMessage(guildId, speakText);
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'logDiscordMessage', {
            guild: 'DM',
            channel: 'DM',
            user: `${message.author.username} (${message.author.id})`,
            message: message.cleanContent
        }));
    },
};

