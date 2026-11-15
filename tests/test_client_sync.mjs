import test from 'node:test';
import assert from 'node:assert/strict';
import activate, { clampPollInterval, getSongKey, shouldResumeAfterSongEnd } from '../mic-lyric-sync/client.mjs';

test('clampPollInterval 驗證預設值與邊界限制', () => {
  assert.equal(clampPollInterval(undefined), 30);
  assert.equal(clampPollInterval(null), 30);
  assert.equal(clampPollInterval(true), 30);
  assert.equal(clampPollInterval('invalid'), 30);
  assert.equal(clampPollInterval(1), 5);
  assert.equal(clampPollInterval(30), 30);
  assert.equal(clampPollInterval(45.6), 46);
  assert.equal(clampPollInterval(999), 300);
});

test('shouldResumeAfterSongEnd 判斷歌曲播畢、切歌與結束狀態', () => {
  const songA = { source: 'netease', id: '101' };
  const songB = { source: 'netease', id: '202' };
  const keyA = getSongKey(songA);

  assert.equal(shouldResumeAfterSongEnd({ song: songA, state: 'playing', position: 60, duration: 200 }, ''), false);
  assert.equal(shouldResumeAfterSongEnd({ song: songA, state: 'playing', position: 60, duration: 200 }, keyA), false);
  assert.equal(shouldResumeAfterSongEnd({ song: songA, state: 'playing', position: 199.6, duration: 200 }, keyA), true);
  assert.equal(shouldResumeAfterSongEnd({ song: songA, state: 'ended', position: 120, duration: 200 }, keyA), true);
  assert.equal(shouldResumeAfterSongEnd({ song: songA, state: 'stopped', position: 120, duration: 200 }, keyA), true);
  assert.equal(shouldResumeAfterSongEnd({ song: songB, state: 'playing', position: 1, duration: 180 }, keyA), true);
  assert.equal(shouldResumeAfterSongEnd({ song: null, state: 'stopped', position: 0, duration: 0 }, keyA), true);
});

test('activate 預設 30 秒間隔、播畢前暫停、播畢或關閉選項後恢復辨識', async (t) => {
  let cleanup = null;
  t.after(() => {
    if (cleanup) cleanup();
  });
  let registeredSection = null;
  let stateHandler = null;
  let settingsChangeHandler = null;
  let toggleCommand = null;
  const rpcCalls = [];
  const song = { source: 'test', id: 's1' };
  let playbackState = { song: null, state: 'stopped', position: 0, duration: 0 };
  let currentSettings = {};

  const folium = {
    env: { context: 'main' },
    host: { folium: { minor: 7 } },
    log: { info: () => {}, warn: () => {} },
    ui: { toast: () => {}, navigate: () => {}, icon: async () => null },
    omni: {
      searchSongs: async () => ({ items: [song] })
    },
    playback: {
      getState: () => playbackState,
      setMuted: async () => {},
      playSong: async () => {
        playbackState = { song, state: 'playing', position: 10, duration: 180 };
      },
      seek: async (pos) => {
        playbackState = { ...playbackState, position: pos };
      }
    },
    rpc: {
      on: (evt, fn) => {
        if (evt === 'state') stateHandler = fn;
        return () => {};
      },
      call: async (method, arg) => {
        rpcCalls.push([method, arg]);
        return { ok: true };
      }
    },
    registries: {
      settingsSections: {
        register: (sec) => {
          registeredSection = sec;
          for (const s of sec.settings) currentSettings[s.key] = s.defaultValue;
          return {
            settings: {
              get: () => ({ ...currentSettings }),
              onChange: (fn) => {
                settingsChangeHandler = fn;
                return () => {};
              }
            }
          };
        }
      },
      commands: {
        register: (cmd) => {
          if (cmd.id === 'toggle-sync') toggleCommand = cmd;
        }
      },
      progressButtons: { register: () => {} }
    }
  };

  cleanup = activate(folium);
  assert.equal(currentSettings.pollIntervalSec, 30);
  assert.equal(currentSettings.pauseUntilSongEnd, true);

  // 開啟辨識時，帶入預設 30 秒間隔
  await toggleCommand.run();
  assert.deepEqual(rpcCalls[0], ['startSync', {
    deviceId: '',
    pollIntervalSec: 30,
    pythonMode: 'auto',
    customPythonPath: ''
  }]);

  // 模擬辨識成功，應自動呼叫 setRecognitionPaused(true)
  stateHandler({ ok: true, title: 'Song A', artist: 'Artist A', position_sec: 12 });
  await new Promise((r) => setTimeout(r, 220));
  assert.ok(rpcCalls.some(([m, a]) => m === 'setRecognitionPaused' && a === true));

  // 模擬使用者在設定中關閉「播畢前不重複辨識」，應立即恢復辨識
  currentSettings.pauseUntilSongEnd = false;
  settingsChangeHandler({ ...currentSettings });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(rpcCalls.some(([m, a]) => m === 'setRecognitionPaused' && a === false));

  // 檢查變更間隔設定會同步給 worker
  currentSettings.pollIntervalSec = 45;
  settingsChangeHandler({ ...currentSettings });
  assert.ok(rpcCalls.some(([m, a]) => m === 'setPollInterval' && a === 45));

  cleanup();
});

test('按下開始辨識時立即暫停播放、清空佇列並靜音，停止時恢復原狀態', async (t) => {
  let cleanup = null;
  t.after(() => {
    if (cleanup) cleanup();
  });

  let toggleCommand = null;
  const oldSong = { source: 'test', id: 'old-1' };
  let queueItems = [{ song: oldSong }];
  let queueVersion = 'v1';
  let paused = false;
  let muted = false;
  let loopMode = 'all';

  const folium = {
    env: { context: 'main' },
    host: { folium: { minor: 7 } },
    log: { info: () => {}, warn: () => {} },
    ui: { toast: () => {}, navigate: () => {}, icon: async () => null },
    omni: { searchSongs: async () => ({ items: [] }) },
    playback: {
      getState: () => ({ song: queueItems[0]?.song || null, state: paused ? 'paused' : 'playing', position: 0, duration: 100 }),
      getLoopMode: () => loopMode,
      setLoopMode: (m) => { loopMode = m; },
      getVolume: () => ({ volume: 0.8, muted }),
      setVolume: async () => {},
      setMuted: async (m) => { muted = m; },
      pause: async () => { paused = true; },
      getQueue: (offset, limit) => ({
        version: queueVersion,
        length: queueItems.length,
        items: queueItems.slice(offset, offset + limit)
      }),
      replaceQueue: async (songs) => {
        queueItems = songs.map((s) => ({ song: s }));
        queueVersion = `v-${Date.now()}`;
      }
    },
    rpc: {
      on: () => () => {},
      call: async () => ({ ok: true })
    },
    registries: {
      settingsSections: {
        register: (sec) => {
          const settings = {};
          for (const s of sec.settings) settings[s.key] = s.defaultValue;
          return { settings: { get: () => ({ ...settings }), onChange: () => () => {} } };
        }
      },
      commands: {
        register: (cmd) => {
          if (cmd.id === 'toggle-sync') toggleCommand = cmd;
        }
      },
      progressButtons: { register: () => {} }
    }
  };

  cleanup = activate(folium);

  // 開啟辨識：應立即暫停、清空佇列、靜音並關閉循環
  await toggleCommand.run();
  assert.equal(paused, true);
  assert.equal(queueItems.length, 0);
  assert.equal(muted, true);
  assert.equal(loopMode, 'off');

  // 關閉辨識：應恢復原佇列、取消靜音與恢復原循環模式
  await toggleCommand.run();
  assert.deepEqual(queueItems.map((i) => i.song), [oldSong]);
  assert.equal(muted, false);
  assert.equal(loopMode, 'all');

  cleanup();
});
