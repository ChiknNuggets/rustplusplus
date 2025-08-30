// Example plugin: responds to a custom in-game command and logs cargo events

// By default this example plugin is enabled. Set to false to default-off.
module.exports = {
  // Optional: default enabled/disabled for new guilds (can be toggled in settings per guild)
  defaultEnabled: true,
  displayName: 'Hello Demo',
  description: 'Adds a !hello command and logs cargo events.',
  // Demonstrate multiple configurable settings
  // - greetCommand: keyword after prefix to trigger greeting
  // - replyTemplate: supports {name} placeholder
  // - logCargo: toggle cargo event logging
  configSchema: {
    greetCommand: { type: 'text', label: 'Greet Command (without prefix)', default: 'hello' },
    replyTemplate: { type: 'text', label: 'Reply Template', default: 'Hello {name}! 👋' },
    logCargo: { type: 'bool', label: 'Log Cargo Events', default: true }
  },

  onLoad: ({ client }) => {
    client.log(client.intlGet(null, 'infoCap'), '[example-hello] loaded');
  },

  onInGameCommand: async ({ rustplus, client, command, caller }) => {
    const guildId = rustplus.guildId;
    const instance = client.getInstance(guildId);
    const settings = (instance.pluginSettings && instance.pluginSettings['example-hello.js']) || {};
    const greetCommand = (settings.greetCommand || 'hello').trim().toLowerCase();
    const replyTemplate = settings.replyTemplate || 'Hello {name}! 👋';

    const prefix = rustplus.generalSettings.prefix || '!';
    const expected = `${prefix}${greetCommand}`;
    if (command.trim().toLowerCase() === expected) {
      const reply = replyTemplate.replace('{name}', caller.name || 'there');
      await rustplus.sendInGameMessage(reply);
      client.log(client.intlGet(null, 'infoCap'), `[example-hello] greeted ${caller.name}`);
      return true;
    }
    return false;
  },

  onGameEvent: async ({ rustplus, client, event, text }) => {
    if (event !== 'cargo') return;
    const guildId = rustplus.guildId;
    const instance = client.getInstance(guildId);
    const settings = (instance.pluginSettings && instance.pluginSettings['example-hello.js']) || {};
    const logCargo = (typeof settings.logCargo === 'boolean') ? settings.logCargo : true;
    if (logCargo) {
      client.log(client.intlGet(null, 'infoCap'), `[example-hello] Cargo event: ${text}`);
    }
  },

  onPlayerDeath: async ({ client, player, location }) => {
    client.log(client.intlGet(null, 'infoCap'), `[example-hello] ${player.name} died at ${location ? location.string : 'spawn'}`);
  },

  onHelicopterDown: async ({ client, location }) => {
    client.log(client.intlGet(null, 'infoCap'), `[example-hello] Heli down at ${location?.string}`);
  },
};
