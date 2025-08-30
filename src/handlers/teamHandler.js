/*
    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

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

const Constants = require('../util/constants.js');
const DiscordMessages = require('../discordTools/discordMessages.js');

module.exports = {
    handler: async function (rustplus, client, teamInfo) {
        /* Handle team changes */
        await module.exports.checkChanges(rustplus, client, teamInfo);
    },

    checkChanges: async function (rustplus, client, teamInfo) {
        let instance = client.getInstance(rustplus.guildId);
        const guildId = rustplus.guildId;
        const serverId = rustplus.serverId;
        const server = instance.serverList[serverId];

        if (rustplus.team.isLeaderSteamIdChanged(teamInfo)) return;

        const newPlayers = rustplus.team.getNewPlayers(teamInfo);
        const leftPlayers = rustplus.team.getLeftPlayers(teamInfo);

        for (const steamId of leftPlayers) {
            const player = rustplus.team.getPlayer(steamId);
            const str = client.intlGet(guildId, 'playerLeftTheTeam', { name: player.name });
            await DiscordMessages.sendActivityNotificationMessage(
                guildId, serverId, Constants.COLOR_GREY, str, steamId);
            if (instance.generalSettings.connectionNotify) await rustplus.sendInGameMessage(str);
            rustplus.log(client.intlGet(null, 'infoCap'), str);
            rustplus.updateConnections(steamId, str);

            // Plugin hook: player left team
            try {
                await client.pluginManager.emit('onPlayerLeftTeam', {
                    rustplus,
                    client,
                    player: { steamId, name: player.name }
                });
            }
            catch (_) { }
        }

        for (const steamId of newPlayers) {
            for (const player of teamInfo.members) {
                if (player.steamId.toString() === steamId) {
                    const str = client.intlGet(guildId, 'playerJoinedTheTeam', { name: player.name });
                    await DiscordMessages.sendActivityNotificationMessage(
                        guildId, serverId, Constants.COLOR_ACTIVE, str, steamId);
                    if (instance.generalSettings.connectionNotify) await rustplus.sendInGameMessage(str);
                    rustplus.log(client.intlGet(null, 'infoCap'), str);
                    rustplus.updateConnections(steamId, str);

                    // Plugin hook: player joined team
                    try {
                        await client.pluginManager.emit('onPlayerJoinedTeam', {
                            rustplus,
                            client,
                            player: { steamId, name: player.name }
                        });
                    }
                    catch (_) { }
                }
            }
        }

        for (const player of rustplus.team.players) {
            if (leftPlayers.includes(player.steamId)) continue;
            for (const playerUpdated of teamInfo.members) {
                if (player.steamId === playerUpdated.steamId.toString()) {
                    if (player.isGoneDead(playerUpdated)) {
                        const location = player.pos === null ? 'spawn' : player.pos.string;
                        const str = client.intlGet(guildId, 'playerJustDied', {
                            name: player.name,
                            location: location
                        });
                        await DiscordMessages.sendActivityNotificationMessage(
                            guildId, serverId, Constants.COLOR_INACTIVE, str, player.steamId);
                        if (instance.generalSettings.deathNotify) rustplus.sendInGameMessage(str);
                        rustplus.log(client.intlGet(null, 'infoCap'), str);
                        rustplus.updateDeaths(player.steamId, {
                            name: player.name,
                            location: player.pos
                        });

                        // Plugin hook: player death
                        try {
                            await client.pluginManager.emit('onPlayerDeath', {
                                rustplus,
                                client,
                                player: { steamId: player.steamId, name: player.name },
                                location: player.pos,
                                text: str
                            });
                        }
                        catch (_) { }
                    }

                    if (player.isGoneAfk(playerUpdated)) {
                        if (instance.generalSettings.afkNotify) {
                            const str = client.intlGet(guildId, 'playerJustWentAfk', { name: player.name });
                            rustplus.sendInGameMessage(str);
                            rustplus.log(client.intlGet(null, 'infoCap'), str);
                        }

                        // Plugin hook: AFK start
                        try {
                            await client.pluginManager.emit('onPlayerAfkStart', {
                                rustplus,
                                client,
                                player: { steamId: player.steamId, name: player.name }
                            });
                        }
                        catch (_) { }
                    }

                    if (player.isAfk() && player.isMoved(playerUpdated)) {
                        if (instance.generalSettings.afkNotify) {
                            const afkTime = player.getAfkTime('dhs');
                            const str = client.intlGet(guildId, 'playerJustReturned', {
                                name: player.name,
                                time: afkTime
                            });
                            rustplus.sendInGameMessage(str);
                            rustplus.log(client.intlGet(null, 'infoCap'), str);
                        }

                        // Plugin hook: AFK return
                        try {
                            await client.pluginManager.emit('onPlayerAfkReturn', {
                                rustplus,
                                client,
                                player: { steamId: player.steamId, name: player.name },
                                duration: player.getAfkTime('dhs'),
                                durationSeconds: player.getAfkSeconds()
                            });
                        }
                        catch (_) { }
                    }

                    if (player.isGoneOnline(playerUpdated)) {
                        const str = client.intlGet(guildId, 'playerJustConnected', { name: player.name });
                        await DiscordMessages.sendActivityNotificationMessage(
                            guildId, serverId, Constants.COLOR_ACTIVE, str, player.steamId);
                        if (instance.generalSettings.connectionNotify) await rustplus.sendInGameMessage(str);
                        rustplus.log(client.intlGet(null, 'infoCap'),
                            client.intlGet(null, 'playerJustConnectedTo', {
                                name: player.name,
                                server: server.title
                            }));
                        rustplus.updateConnections(player.steamId, str);

                        // Plugin hook: player connected (online)
                        try {
                            await client.pluginManager.emit('onPlayerConnected', {
                                rustplus,
                                client,
                                player: { steamId: player.steamId, name: player.name }
                            });
                        }
                        catch (_) { }
                    }

                    if (player.isGoneOffline(playerUpdated)) {
                        const str = client.intlGet(guildId, 'playerJustDisconnected', { name: player.name });
                        await DiscordMessages.sendActivityNotificationMessage(
                            guildId, serverId, Constants.COLOR_INACTIVE, str, player.steamId);
                        if (instance.generalSettings.connectionNotify) await rustplus.sendInGameMessage(str);
                        rustplus.log(client.intlGet(null, 'infoCap'),
                            client.intlGet(null, 'playerJustDisconnectedFrom', {
                                name: player.name,
                                server: server.title
                            }));
                        rustplus.updateConnections(player.steamId, str);

                        // Plugin hook: player disconnected (offline)
                        try {
                            await client.pluginManager.emit('onPlayerDisconnected', {
                                rustplus,
                                client,
                                player: { steamId: player.steamId, name: player.name }
                            });
                        }
                        catch (_) { }
                    }
                    break;
                }
            }
        }
    },
}
