import test from 'node:test';
import assert from 'node:assert/strict';
import activate from '../mic-lyric-sync/client.mjs';
import { createPlaybackGuard, readAllQueueSongs } from '../mic-lyric-sync/playbackGuard.mjs';

test('readAllQueueSongs 支援分頁讀取完整播放佇列', () => {
  const songs = [
    { source: 's', id: '1', ref: 'r1' },
    { source: 's', id: '2', ref: 'r2' },
    { source: 's', id: '3', ref: 'r3' }
  ];
  const playback = {
    getQueue: (offset, limit) => {
      const slice = songs.slice(offset, offset + Math.min(limit, 2));
      return {
        items: slice.map((song, idx) => ({ song, index: offset + idx })),
        length: songs.length,
        version: 'v1'
      };
    }
  };
  assert.deepEqual(readAllQueueSongs(playback), songs);
});

test('createPlaybackGuard 辨識時停止自動下一首，關閉時恢復 loopMode、音量/靜音與佇列', async () => {
  const originalSong1 = { source: 'test', id: 'orig-1', ref: 'ref-orig-1' };
  const originalSong2 = { source: 'test', id: 'orig-2', ref: 'ref-orig-2' };
  const recognizedSong = { source: 'test', id: 'rec-1', ref: 'ref-rec-1' };

  let loopMode = 'all';
  let volume = 0.65;
  let muted = false;
  let queue = [originalSong1, originalSong2];
  let queueVersion = 1;

  const folium = {
    playback: {
      getLoopMode: () => loopMode,
      setLoopMode: (mode) => { loopMode = mode; },
      getVolume: () => ({ volume, muted }),
      setVolume: (v) => { volume = v; },
      setMuted: (m) => { muted = m; },
      getQueue: (offset, limit) => ({
        items: queue.slice(offset, offset + limit).map((song, idx) => ({ song, index: offset + idx })),
        length: queue.length,
        version: `q-v${queueVersion}`
      }),
      replaceQueue: async (songs, opts) => {
        assert.equal(opts.expectedVersion, `q-v${queueVersion}`);
        queue = [...songs];
        queueVersion += 1;
      }
    }
  };

  const guard = createPlaybackGuard(folium);
  guard.captureAndApplyOnStart();
  assert.equal(loopMode, 'off');

  await guard.applyBeforePlay(true);
  assert.equal(muted, true);

  await guard.isolateQueueAfterPlay(recognizedSong);
  assert.deepEqual(queue, [recognizedSong]);
  assert.equal(loopMode, 'off');

  // 模擬使用者在辨識過程中或停止前狀態改變
  await guard.restoreOnStop();
  assert.equal(loopMode, 'all');
  assert.equal(muted, false);
  assert.equal(volume, 0.65);
  assert.deepEqual(queue, [originalSong1, originalSong2]);
});

test('createPlaybackGuard 未開啟 autoMute 時不主動覆寫音量與靜音', async () => {
  let setMutedCalls = 0;
  let setVolumeCalls = 0;
  let loopMode = 'one';

  const guard = createPlaybackGuard({
    playback: {
      getLoopMode: () => loopMode,
      setLoopMode: (m) => { loopMode = m; },
      getVolume: () => ({ volume: 0.4, muted: false }),
      setMuted: () => { setMutedCalls += 1; },
      setVolume: () => { setVolumeCalls += 1; }
    }
  });

  guard.captureAndApplyOnStart();
  assert.equal(loopMode, 'off');
  await guard.applyBeforePlay(false);
  await guard.restoreOnStop();

  assert.equal(loopMode, 'one');
  assert.equal(setMutedCalls, 0);
  assert.equal(setVolumeCalls, 0);
});

test('activate 整合流程：開啟辨識停用自動下一首，關閉辨識恢復設定與音量，startSync 失敗會回滾', async (t) => {
  let cleanup = null;
  t.after(() => {
    if (cleanup) cleanup();
  });

  let stateHandler = null;
  let toggleCommand = null;
  let startSyncShouldFail = false;

  const origSong = { source: 'test', id: 'orig', ref: 'ref-orig' };
  const recSong = { source: 'test', id: 'rec', ref: 'ref-rec' };

  let loopMode = 'all';
  let volume = 0.8;
  let muted = false;
  let queue = [origSong];
  let queueVer = 1;
  let playbackState = { song: origSong, state: 'playing', position: 5, duration: 200 };
  const currentSettings = {};

  const folium = {
    env: { context: 'main' },
    host: { folium: { minor: 7 } },
    log: { info: () => {}, warn: () => {} },
    ui: { toast: () => {}, navigate: () => {}, icon: async () => null },
    omni: {
      searchSongs: async () => ({ items: [recSong] })
    },
    playback: {
      getState: () => playbackState,
      getLoopMode: () => loopMode,
      setLoopMode: (m) => { loopMode = m; },
      getVolume: () => ({ volume, muted }),
      setVolume: (v) => { volume = v; },
      setMuted: (m) => { muted = m; },
      getQueue: (offset, limit) => ({
        items: queue.slice(offset, offset + limit).map((song, idx) => ({ song, index: offset + idx })),
        length: queue.length,
        version: `v${queueVer}`
      }),
      replaceQueue: async (songs, opts) => {
        assert.equal(opts.expectedVersion, `v${queueVer}`);
        queue = [...songs];
        queueVer += 1;
      },
      playSong: async (s) => {
        playbackState = { song: s, state: 'playing', position: 0, duration: 180 };
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
      call: async (method) => {
        if (method === 'startSync' && startSyncShouldFail) {
          throw new Error('boom');
        }
        return { ok: true };
      }
    },
    registries: {
      settingsSections: {
        register: (sec) => {
          for (const s of sec.settings) currentSettings[s.key] = s.defaultValue;
          return {
            settings: {
              get: () => ({ ...currentSettings }),
              onChange: () => () => {}
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

  // 1. startSync 失敗時應立即回滾 loopMode
  startSyncShouldFail = true;
  await toggleCommand.run();
  assert.equal(loopMode, 'all');

  // 2. 正常開啟辨識 -> 辨識到歌曲 -> 停止循環、隔離佇列、自動靜音
  startSyncShouldFail = false;
  await toggleCommand.run();
  assert.equal(loopMode, 'off');

  stateHandler({ ok: true, title: 'Rec', artist: 'Art', position_sec: 15 });
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(muted, true);
  assert.deepEqual(queue, [recSong]);

  // 3. 關閉辨識 -> 恢復原本 loopMode、靜音狀態、音量與佇列
  await toggleCommand.run();
  assert.equal(loopMode, 'all');
  assert.equal(muted, false);
  assert.equal(volume, 0.8);
  assert.deepEqual(queue, [origSong]);
});
