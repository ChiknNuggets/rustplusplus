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

const Fs = require("fs");
const Path = require('path');
const Rest = require('@discordjs/rest');
const Types = require('discord-api-types/v9');

const Config = require('../../config');

module.exports = async (client, guild) => {
    const commands = [];
    const commandFiles = Fs.readdirSync(Path.join(__dirname, '..', 'commands')).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const command = require(`../commands/${file}`);
        commands.push(command.getData(client, guild.id).toJSON());
    }

    // Include plugin-provided slash commands, if any
    try {
        const plugins = client.pluginManager?.plugins || [];
        const instance = client.getInstance(guild.id);
        for (const p of plugins) {
            // Respect per-guild plugin enabled state
            const enabled = (instance && instance.pluginSettings && (p.name in instance.pluginSettings)) ?
                !!instance.pluginSettings[p.name].enabled : (p.defaultEnabled ?? true);
            if (!enabled) continue;

            const list = p.mod && Array.isArray(p.mod.slashCommands) ? p.mod.slashCommands : [];
            for (const sc of list) {
                try {
                    if (!sc || typeof sc.getData !== 'function') continue;
                    commands.push(sc.getData(client, guild.id).toJSON());
                } catch (_) { /* ignore poorly-formed plugin slash commands */ }
            }
        }
    } catch (_) { /* ignore */ }

    const rest = new Rest.REST({ version: '9' }).setToken(Config.discord.token);

    try {
        await rest.put(Types.Routes.applicationGuildCommands(Config.discord.clientId, guild.id), { body: commands });
    }
    catch (e) {
        client.log(
            client.intlGet(null, 'errorCap'),
            client.intlGet(null, 'couldNotRegisterSlashCommands', { guildId: guild.id }) +
            client.intlGet(null, 'makeSureApplicationsCommandsEnabled'),
            'error'
        );
        process.exit(1);
    }
    client.log(client.intlGet(null, 'infoCap'),
        client.intlGet(null, 'slashCommandsSuccessRegister', { guildId: guild.id }));
};
