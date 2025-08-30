/*
    Minimal plugin system for rustplusplus

    Plugins are simple Node.js modules placed in the top-level `plugins/` folder.
    Each plugin may export any of the optional handler functions below:

      - onLoad(context)
      - onUnload(context)
      - onConnected({ rustplus, client })
      - onDisconnected({ rustplus, client })
      - onTeamChanged({ rustplus, client, teamInfo })
      - onInGameChat({ rustplus, client, message, isCommand })
      - onInGameCommand({ rustplus, client, command, caller }) -> boolean | Promise<boolean>
      - onGameEvent({ rustplus, client, event, text, firstPoll, image, color, setting })
      - onSmartSwitchChanged({ rustplus, client, entityId, active })
      - onSmartAlarmState({ rustplus, client, entityId, active })
      - onStorageMonitorUpdate({ rustplus, client, entityId, payload })

      - onPlayerDeath({ rustplus, client, player, location, text })
      - onPlayerConnected({ rustplus, client, player })
      - onPlayerDisconnected({ rustplus, client, player })
      - onPlayerJoinedTeam({ rustplus, client, player })
      - onPlayerLeftTeam({ rustplus, client, player })
      - onPlayerAfkStart({ rustplus, client, player })
      - onPlayerAfkReturn({ rustplus, client, player, duration, durationSeconds })

      - onHelicopterEnterMap({ rustplus, client, location })
      - onHelicopterLocated({ rustplus, client, location })
      - onHelicopterLeftMap({ rustplus, client, location })
      - onHelicopterDown({ rustplus, client, location })

      - onChinookEnterMap({ rustplus, client, location })
      - onChinookLocated({ rustplus, client, location })
      - onChinookLeftMap({ rustplus, client, location })

      - onOilRigHeavyScientistsCalled({ rustplus, client, size, location })
      - onOilRigCrateUnlocked({ rustplus, client, size, location })

      - onCargoEnterMap({ rustplus, client, location })
      - onCargoLocated({ rustplus, client, location })
      - onCargoLeftMap({ rustplus, client, location })
      - onCargoDocked({ rustplus, client, location })
      - onCargoLeftHarbor({ rustplus, client, location })
      - onCargoEgressStage({ rustplus, client, location })

      - onVendingMachineDetected({ rustplus, client, location })

      - onTravelingVendorSpawned({ rustplus, client, location })
      - onTravelingVendorLeft({ rustplus, client, location })
      - onTravelingVendorHalted({ rustplus, client, location })
      - onTravelingVendorResumed({ rustplus, client, location })

      - onConnecting({ rustplus, client })
      - onConnected({ rustplus, client })
      - onDisconnected({ rustplus, client })
      - onError({ rustplus, client, error })
      - onRequest({ rustplus, client, request })
      - onMapUpdated({ rustplus, client })
      - onWipeDetected({ rustplus, client })

    If a handler throws, it is caught and logged so a single plugin cannot crash the bot.
*/

const Fs = require('fs');
const Path = require('path');

class PluginManager {
    constructor(client) {
        this.client = client;
        this.plugins = [];
        this.pluginsDir = Path.join(__dirname, '..', '..', 'plugins');
    }

    logError(err, where, pluginName = 'unknown') {
        try {
            this.client.log(this.client.intlGet(null, 'errorCap'), `Plugin ${pluginName} ${where} error: ${err?.stack || err}`, 'error');
        }
        catch (_) {
            // Fallback to console if logger not ready
            // eslint-disable-next-line no-console
            console.error(`Plugin ${pluginName} ${where} error:`, err);
        }
    }

    ensurePluginsDir() {
        try {
            if (!Fs.existsSync(this.pluginsDir)) {
                Fs.mkdirSync(this.pluginsDir, { recursive: true });
            }
        }
        catch (e) {
            this.logError(e, 'ensurePluginsDir');
        }
    }

    loadPlugins() {
        this.ensurePluginsDir();

        let files = [];
        try {
            files = Fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.js'));
        }
        catch (e) {
            this.logError(e, 'readdir');
            return;
        }

        for (const file of files) {
            const full = Path.join(this.pluginsDir, file);
            try {
                delete require.cache[require.resolve(full)];
                const mod = require(full);
                const defaultEnabled = (typeof mod.defaultEnabled === 'boolean') ? mod.defaultEnabled : true;
                const displayName = typeof mod.displayName === 'string' ? mod.displayName : null;
                const description = typeof mod.description === 'string' ? mod.description : null;
                this.plugins.push({ name: file, mod, defaultEnabled, displayName, description });
                if (typeof mod.onLoad === 'function') {
                    try { mod.onLoad({ client: this.client }); } catch (e) { this.logError(e, 'onLoad', file); }
                }
                this.client.log(this.client.intlGet(null, 'infoCap'), `Loaded plugin: ${file}`);
            }
            catch (e) {
                this.logError(e, 'load', file);
            }
        }
    }

    unloadPlugins() {
        for (const p of this.plugins) {
            if (typeof p.mod.onUnload === 'function') {
                try { p.mod.onUnload({ client: this.client }); } catch (e) { this.logError(e, 'onUnload', p.name); }
            }
        }
        this.plugins = [];
    }

    async emit(handlerName, payload) {
        const guildId = payload && payload.rustplus && payload.rustplus.guildId ? payload.rustplus.guildId : null;
        let instance = null;
        if (guildId) {
            try { instance = this.client.getInstance(guildId); } catch (_) { /* ignore */ }
        }

        for (const p of this.plugins) {
            // Per-guild enable/disable support
            if (instance && instance.pluginSettings) {
                const settings = instance.pluginSettings[p.name] || { enabled: p.defaultEnabled };
                if (settings.enabled === false) continue;
            }

            const fn = p.mod && p.mod[handlerName];
            if (typeof fn === 'function') {
                try { await fn(payload); } catch (e) { this.logError(e, handlerName, p.name); }
            }
        }
    }

    // Special helper to route custom in-game commands to plugins.
    // Returns true if any plugin handled the command.
    async handleInGameCommand(rustplus, client, command, caller) {
        for (const p of this.plugins) {
            const fn = p.mod && p.mod.onInGameCommand;
            if (typeof fn === 'function') {
                try {
                    const handled = await fn({ rustplus, client, command, caller });
                    if (handled) return true;
                }
                catch (e) {
                    this.logError(e, 'onInGameCommand', p.name);
                }
            }
        }
        return false;
    }
}

module.exports = PluginManager;
