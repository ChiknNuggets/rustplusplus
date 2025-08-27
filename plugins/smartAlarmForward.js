const DiscordTools = require('../src/discordTools/discordTools.js');

// Replace with the ID of the channel that should receive smart alarm notifications
const TARGET_CHANNEL_ID = 'REPLACE_ME';

module.exports = {
    name: 'smartAlarmForward',
    rustplus: {
        smartAlarm: async (rustplus, client, serverId, entityId) => {
            const channel = DiscordTools.getTextChannelById(rustplus.guildId, TARGET_CHANNEL_ID);
            if (!channel) return;
            const instance = client.getInstance(rustplus.guildId);
            const alarm = instance.serverList[serverId].alarms[entityId];
            channel.send(`Alarm ${alarm.name} triggered on server ${serverId}`);
        }
    }
};
