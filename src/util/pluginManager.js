const Fs = require('fs');
const Path = require('path');

class PluginManager {
    constructor() {
        this.plugins = [];
        this.loadPlugins();
    }

    loadPlugins() {
        const pluginDir = Path.join(__dirname, '..', '..', 'plugins');
        if (!Fs.existsSync(pluginDir)) {
            Fs.mkdirSync(pluginDir);
            return;
        }
        const files = Fs.readdirSync(pluginDir).filter(f => f.endsWith('.js'));
        for (const file of files) {
            try {
                const plugin = require(Path.join(pluginDir, file));
                this.plugins.push(plugin);
            } catch (err) {
                console.error(`Failed to load plugin ${file}:`, err);
            }
        }
    }

    emitRustPlus(eventName, rustplus, client, ...args) {
        for (const plugin of this.plugins) {
            const handler = plugin.rustplus && plugin.rustplus[eventName];
            if (typeof handler === 'function') {
                try {
                    handler(rustplus, client, ...args);
                } catch (err) {
                    console.error(`Plugin ${plugin.name || 'unknown'} rustplus ${eventName} error:`, err);
                }
            }
        }
    }

    emitDiscord(eventName, client, ...args) {
        for (const plugin of this.plugins) {
            const handler = plugin.discord && plugin.discord[eventName];
            if (typeof handler === 'function') {
                try {
                    handler(client, ...args);
                } catch (err) {
                    console.error(`Plugin ${plugin.name || 'unknown'} discord ${eventName} error:`, err);
                }
            }
        }
    }
}

module.exports = new PluginManager();
