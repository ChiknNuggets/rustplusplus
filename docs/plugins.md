# Plugins

This project now supports simple plugins for in‑game events and commands.

- Folder: put `.js` plugin files in `plugins/` at the project root.
- Load: plugins are loaded automatically when the bot starts.
- Safety: exceptions inside a plugin are caught and logged; a broken plugin will not crash the bot.

## Plugin API

Export any of these optional async/sync handlers from your module:

- `onLoad({ client })`
- `onUnload({ client })`
- `onConnecting({ rustplus, client })`
- `onConnected({ rustplus, client })`
- `onDisconnected({ rustplus, client })`
- `onError({ rustplus, client, error })`
- `onRequest({ rustplus, client, request })`
- `onTeamChanged({ rustplus, client, teamInfo })`
- `onInGameChat({ rustplus, client, message, isCommand })`
- `onInGameCommand({ rustplus, client, command, caller }) -> boolean`
  - Return `true` if you handled the command to prevent default fallback.
- `onGameEvent({ rustplus, client, event, text, firstPoll, image, color, setting })`
  - Fires for in‑game events like cargo/heli/small/large/chinook.
- `onSmartSwitchChanged({ rustplus, client, entityId, active })`
- `onSmartSwitchGroupChanged({ rustplus, client, groupId, serverId })`
- `onSmartSwitchGroupToggled({ rustplus, client, groupId, serverId, active })`
- `onSmartAlarmState({ rustplus, client, entityId, active })`
- `onStorageMonitorUpdate({ rustplus, client, entityId, payload })`
- `onToolCupboardDecayingStart({ rustplus, client, entityId })`
- `onToolCupboardDecayingStop({ rustplus, client, entityId })`

Player hooks:
- `onPlayerDeath({ rustplus, client, player, location, text })`
- `onPlayerConnected({ rustplus, client, player })`
- `onPlayerDisconnected({ rustplus, client, player })`
- `onPlayerJoinedTeam({ rustplus, client, player })`
- `onPlayerLeftTeam({ rustplus, client, player })`
- `onPlayerAfkStart({ rustplus, client, player })`
- `onPlayerAfkReturn({ rustplus, client, player, duration, durationSeconds })`

Helicopter hooks:
- `onHelicopterEnterMap({ rustplus, client, location })`
- `onHelicopterLocated({ rustplus, client, location })`
- `onHelicopterLeftMap({ rustplus, client, location })`
- `onHelicopterDown({ rustplus, client, location })`

Chinook hooks:
- `onChinookEnterMap({ rustplus, client, location })`
- `onChinookLocated({ rustplus, client, location })`
- `onChinookLeftMap({ rustplus, client, location })`

Oil Rig hooks:
- `onOilRigHeavyScientistsCalled({ rustplus, client, size, location })` (size: `small` | `large`)
- `onOilRigCrateUnlocked({ rustplus, client, size, location })`

Cargo ship hooks:
- `onCargoEnterMap({ rustplus, client, location })`
- `onCargoLocated({ rustplus, client, location })`
- `onCargoLeftMap({ rustplus, client, location })`
- `onCargoDocked({ rustplus, client, location })`
- `onCargoLeftHarbor({ rustplus, client, location })`
- `onCargoEgressStage({ rustplus, client, location })`

Vending hooks:
- `onVendingMachineDetected({ rustplus, client, location })`

Traveling vendor hooks:
- `onTravelingVendorSpawned({ rustplus, client, location })`
- `onTravelingVendorLeft({ rustplus, client, location })`
- `onTravelingVendorHalted({ rustplus, client, location })`
- `onTravelingVendorResumed({ rustplus, client, location })`

Map hooks:
- `onMapUpdated({ rustplus, client })`
- `onWipeDetected({ rustplus, client })`

Objects:
- `client`: the DiscordBot instance (logger, config, intl, etc.).
- `rustplus`: the active RustPlus instance for a guild/server.

## Example

Create `plugins/example-hello.js`:

```
module.exports = {
  // Default to enabled (can be toggled in Settings → Plugins)
  defaultEnabled: true,
  onInGameCommand: async ({ rustplus, command, caller }) => {
    const prefix = rustplus.generalSettings.prefix || '!';
    if (command.trim().toLowerCase() === `${prefix}hello`) {
      await rustplus.sendInGameMessage(`Hello ${caller.name}!`);
      return true;
    }
    return false;
  },

  onGameEvent: async ({ event, text }) => {
    if (event === 'cargo') {
      // react to cargo events
      console.log('Cargo:', text);
    }
  },
};
```
- You may also export `defaultEnabled: boolean` to control the default on/off state for new guilds. Users can toggle per‑guild in Settings → Plugins.

Restart the bot; type `!hello` in team chat to see the response.

Voice-from-SteamID example
- Included: `plugins/example-voice-from-steamid.js` (default disabled)
- Behavior: when a configured SteamID speaks in team chat, the bot speaks the message in the connected voice channel.
- Configure: open Settings → Plugins → example-voice-from-steamid.js → Edit, and set the SteamID64.
