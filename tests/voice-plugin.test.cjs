const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');

function fixture({ connected = true, ready = true, apiError = false } = {}) {
    const logs = [];
    const requests = [];
    const player = new EventEmitter();
    let played = false;
    player.play = () => { played = true; player.emit('stateChange', { status: 'idle' }, { status: 'playing' }); };
    const connection = { state: { status: ready ? 'ready' : 'disconnected', closeCode: 4017 }, subscribe: () => ({ unsubscribe() {} }) };
    const voice = {
        getVoiceConnection: () => connected ? connection : undefined,
        entersState: async () => { if (!ready) throw new Error('timeout'); },
        VoiceConnectionStatus: { Ready: 'ready' }, AudioPlayerStatus: { Idle: 'idle' },
        StreamType: { OggOpus: 'ogg' }, createAudioPlayer: () => player,
        createAudioResource: stream => stream
    };
    const context = {
        module: { exports: {} }, Buffer, AbortSignal,
        require: name => name === '@discordjs/voice' ? voice : require(name),
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: !apiError, text: async () => 'Rejected test-secret', json: async () => ({ audioContent: Buffer.from('audio').toString('base64') }) };
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugins/example-voice-from-steamid.js'), 'utf8'), context);
    const client = {
        intlGet: (_, key) => key,
        log: (_, text) => logs.push(text),
        getInstance: () => ({ generalSettings: { language: 'en' }, pluginSettings: {
            'example-voice-from-steamid.js': { steamId: '123', apiKey: 'test-secret', voiceName: 'en-US-Chirp3-HD-Fenrir' }
        } })
    };
    return { logs, requests, player, played: () => played,
        run: (steamId = '123') => context.module.exports.onInGameChat({ client, rustplus: { guildId: 'guild' }, message: { steamId, message: 'Test' } }) };
}

test('unrelated chat does not request speech', async () => {
    const f = fixture(); await f.run('456'); assert.equal(f.requests.length, 0);
});
test('missing voice connection is logged without requesting speech', async () => {
    const f = fixture({ connected: false }); await f.run();
    assert.equal(f.requests.length, 0); assert.match(f.logs.join('\n'), /no voice connection/);
});
test('failed voice readiness reports the close code and skips synthesis', async () => {
    const f = fixture({ ready: false }); await f.run();
    assert.equal(f.requests.length, 0); assert.match(f.logs.join('\n'), /close code 4017/);
});
test('ready connection plays Google audio and records playback state', async () => {
    const f = fixture(); await f.run();
    assert.equal(f.played(), true); assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url.includes('test-secret'), false);
    assert.equal(f.requests[0].options.headers['X-Goog-Api-Key'], 'test-secret');
    assert.match(f.logs.join('\n'), /playback idle -> playing/);
    f.player.emit('error', new Error('audio failed'));
    assert.match(f.logs.join('\n'), /playback error: audio failed/);
});
test('Google errors are logged with the API key redacted and no playback', async () => {
    const f = fixture({ apiError: true }); await f.run();
    assert.equal(f.played(), false); assert.match(f.logs.join('\n'), /Google TTS error/);
    assert.equal(f.logs.join('\n').includes('test-secret'), false);
});
