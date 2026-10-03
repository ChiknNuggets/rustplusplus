/*
    Copyright (C) 2023 Alexander Emanuelsson (alexemanuelol)
    Copyright (C) 2023 FaiThiX

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

const Builder = require('@discordjs/builders');
const { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const monitoredConnections = new WeakSet();

const DiscordMessages = require('../discordTools/discordMessages.js');

module.exports = {
    name: 'voice',

    getData(client, guildId) {
        return new Builder.SlashCommandBuilder()
            .setName('voice')
            .setDescription(client.intlGet(guildId, 'commandsVoiceDesc'))
            .addSubcommand(subcommand => subcommand
                .setName('join')
                .setDescription(client.intlGet(guildId, 'commandsVoiceJoinDesc')))
            .addSubcommand(subcommand => subcommand
                .setName('leave')
                .setDescription(client.intlGet(guildId, 'commandsVoiceLeaveDesc')))

    },

    async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');

        if (!await client.validatePermissions(interaction)) return;
        await interaction.deferReply({ ephemeral: true });

        switch (interaction.options.getSubcommand()) {
            case 'join': {
                const voiceState = interaction.member.voice;
                if (voiceState && voiceState.channel) {
                    const voiceChannelId = voiceState.channel.id;
                    const voiceChannel = interaction.guild.channels.cache.get(voiceChannelId);
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: interaction.guild.id,
                        adapterCreator: interaction.guild.voiceAdapterCreator,
                    });
                    if (!monitoredConnections.has(connection)) {
                        monitoredConnections.add(connection);
                        connection.on('stateChange', (oldState, newState) => {
                            const closeCode = newState.closeCode === undefined ? '' : `, close code ${newState.closeCode}`;
                            client.log(client.intlGet(null, 'infoCap'),
                                `[voice] guild ${interaction.guildId}: ${oldState.status} -> ${newState.status}${closeCode}`);
                        });
                        connection.on('error', error => {
                            client.log(client.intlGet(null, 'errorCap'), `[voice] guild ${interaction.guildId}: ${error.message}`, 'error');
                        });
                    }
                    try {
                        await entersState(connection, VoiceConnectionStatus.Ready, 20000);
                    } catch (error) {
                        const state = connection.state;
                        client.log(client.intlGet(null, 'errorCap'),
                            `[voice] Connection not ready for guild ${interaction.guildId}: ${state.status}, close code ${state.closeCode ?? 'none'}`, 'error');
                        if (state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
                        await DiscordMessages.sendVoiceMessage(interaction,
                            'Could not establish a voice connection. Check the bot logs for the connection status, then try /voice join again.');
                        break;
                    }
                    await DiscordMessages.sendVoiceMessage(interaction,
                        client.intlGet(interaction.guildId, 'commandsVoiceBotJoinedVoice'));
                    client.log(client.intlGet(null, 'infoCap'), client.intlGet(interaction.guildId, 'commandsVoiceJoin',
                        {   name: voiceChannel && voiceChannel.name ? voiceChannel.name : client.intlGet(interaction.guildId, 'unknown'), 
                            id: voiceChannel && voiceChannel.id ? voiceChannel.id : client.intlGet(interaction.guildId, 'unknown'), 
                            guild: voiceChannel && voiceChannel.guild.name ? voiceChannel.guild.name : client.intlGet(interaction.guildId, 'unknown')}
                        ));
                }
                else {
                    await DiscordMessages.sendVoiceMessage(interaction,
                        client.intlGet(interaction.guildId, 'commandsVoiceNotInVoice'));
                }
            } break;

            case 'leave': {
                const connection = getVoiceConnection(interaction.guild.id);
                if (connection) {
                    connection.destroy();
                    await DiscordMessages.sendVoiceMessage(interaction,
                        client.intlGet(interaction.guildId, 'commandsVoiceBotLeftVoice'));
                    client.log(client.intlGet(null, 'infoCap'),
                        client.intlGet(interaction.guildId, 'commandsVoiceLeave',
                            {
                                name: interaction.member.voice.channel.name,
                                id: interaction.member.voice.channel.id,
                                guild: interaction.member.guild.name
                            }));
                }
            } break;

            default: {
            } break;
        }

        client.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'slashCommandValueChange', {
            id: `${verifyId}`,
            value: `${interaction.options.getSubcommand()}`
        }));
    },
};
