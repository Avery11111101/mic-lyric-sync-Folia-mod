// client.mjs — 整合式麥克風即時聽歌同步歌詞 (透過 folium.rpc 驅動內建主行程引擎)
export default function activate(folium) {
  if (folium.env.context !== 'main') return;
  if (folium.host.folium.minor < 7) {
    folium.log.warn('此模組需要 Folium 1.7 以上版本 (folium.omni / folium.rpc)');
    return;
  }

  let syncEnabled = false;
  let lastTrackSig = '';
  let songStartRefMs = 0; // 用於平滑多輪 Shazam 偏移的中位數基準時間
  let anchorSamples = []; // 儲存同一首歌最近 5 輪推算出的 t0 (trackStartWallClockMs)
  const buttonUpdaters = new Set();

  const settingsSection = folium.registries.settingsSections.register({
    id: 'prefs',
    label: { 'zh-CN': '麦克风听歌同步', en: 'Mic Lyric Sync' },
    description: {
      'zh-CN': '自動建立隔離 Python 環境並更新辨識套件，透過麥克風持續聽歌並同步顯示 Folia 原生歌詞。',
      en: 'Auto-provision Python venv/packages and sync Folia lyrics via microphone.'
    },
    settings: [
      {
        key: 'micDeviceId',
        type: 'text',
        label: { 'zh-CN': '麥克風裝置 ID', en: 'Microphone Device ID' },
        defaultValue: ''
      },
      {
        key: 'driftThresholdSec',
        type: 'number',
        label: { 'zh-CN': '自動校正時間軸門檻（秒）', en: 'Drift Seek Threshold (s)' },
        min: 0.5,
        max: 15,
        step: 0.1,
        defaultValue: 5
      },
      {
        key: 'offsetAdjustSec',
        type: 'number',
        label: { 'zh-CN': '手動時間軸微調（秒）', en: 'Manual Offset (s)' },
        min: -5,
        max: 5,
        step: 0.1,
        defaultValue: 0
      },
      {
        key: 'autoMute',
        type: 'boolean',
        label: { 'zh-CN': '同步時自動靜音 Folia', en: 'Auto-mute Folia' },
        defaultValue: true
      },
      {
        key: 'autoEnterPlayer',
        type: 'boolean',
        label: { 'zh-CN': '辨識到新歌時開啟全螢幕歌詞頁', en: 'Open Player on New Song' },
        defaultValue: true
      },
      {
        key: 'preferredProvider',
        type: 'text',
        label: { 'zh-CN': '指定音源 ID（留空用目前音源）', en: 'Provider ID (optional)' },
        defaultValue: ''
      }
    ],
    settingsPanel(container, panelCtx) {
      return mountSettingsPanel(container, panelCtx, folium);
    }
  });

  function notifyButtons() {
    for (const fn of buttonUpdaters) fn();
  }

  function recordAnchorSample(positionSec) {
    const now = performance.now();
    // 推算「歌曲 0:00 對應的本機 performance.now() 時刻」
    const projectedStartMs = now - positionSec * 1000;
    anchorSamples.push(projectedStartMs);
    if (anchorSamples.length > 5) anchorSamples.shift();
    const sorted = [...anchorSamples].sort((a, b) => a - b);
    songStartRefMs = sorted[Math.floor(sorted.length / 2)]; // 取中位數濾除單次抖動
  }

  function getSmoothedPos(cfg) {
    if (!songStartRefMs) return 0;
    const elapsedSec = (performance.now() - songStartRefMs) / 1000;
    return Math.max(0, elapsedSec + Number(cfg.offsetAdjustSec || 0));
  }

  async function nudgeTimeline(deltaSec) {
    const state = folium.playback.getState();
    if (!state || !state.song) {
      folium.ui.toast('目前沒有正在顯示的歌曲', { type: 'info', durationMs: 2000 });
      return;
    }
    const nextPos = Math.max(0, (state.position || 0) + deltaSec);
    await folium.playback.seek(nextPos);
    const sign = deltaSec >= 0 ? '+' : '';
    folium.ui.toast(`時間軸已微調 ${sign}${deltaSec.toFixed(1)} 秒`, { type: 'info', durationMs: 1800 });
  }

  async function handleRecognizedState(data) {
    if (!syncEnabled || !data || !data.ok || !data.title) return;
    const cfg = settingsSection.settings.get();
    const title = String(data.title).trim();
    const artist = String(data.artist || '').trim();
    const trackSig = `${title.toLowerCase()}::${artist.toLowerCase()}`;

    const currentState = folium.playback.getState();
    const isSameSong = trackSig === lastTrackSig && Boolean(currentState?.song);

    if (isSameSong) {
      recordAnchorSample(Number(data.position_sec || 0));
      const targetPos = getSmoothedPos(cfg);
      const currentPos = Number(currentState.position || 0);
      const drift = targetPos - currentPos;
      const threshold = Math.max(0.5, Math.min(15, Number(cfg.driftThresholdSec) || 5));
      if (Math.abs(drift) > threshold) {
        await folium.playback.seek(targetPos);
        folium.log.info(`[MicSync] 平滑誤差 ${drift.toFixed(2)}s 超過門檻 (${threshold}s)，已自動校正至 ${targetPos.toFixed(2)}s`);
      }
      return;
    }

    // 切換新歌：重置中位數樣本
    anchorSamples = [];
    recordAnchorSample(Number(data.position_sec || 0));

    const providerId = String(cfg.preferredProvider || '').trim() || undefined;
    const query = artist ? `${title} ${artist}` : title;
    let page = await folium.omni.searchSongs(query, { providerId, limit: 5 });
    if (!page.items.length && artist) {
      page = await folium.omni.searchSongs(title, { providerId, limit: 5 });
    }
    if (!syncEnabled) return;

    if (!page.items.length) {
      folium.log.warn(`[MicSync] 辨識「${title} - ${artist}」，但目前音源查無此曲`);
      lastTrackSig = trackSig;
      return;
    }

    const song = page.items[0];
    if (cfg.autoMute) {
      await folium.playback.setMuted(true);
    }
    await folium.playback.playSong(song);
    await waitForPlaybackReady(folium, song, 3500);
    if (!syncEnabled) return;

    const finalPos = getSmoothedPos(cfg);
    await folium.playback.seek(finalPos);
    lastTrackSig = trackSig;

    // 450ms 後複查一次，避免串流剛緩衝完成把進度條彈回 0:00
    setTimeout(async () => {
      if (!syncEnabled || lastTrackSig !== trackSig) return;
      const st = folium.playback.getState();
      const expected = getSmoothedPos(settingsSection.settings.get());
      if (st && Math.abs(Number(st.position || 0) - expected) > 1.5) {
        await folium.playback.seek(expected);
      }
    }, 450);

    if (cfg.autoEnterPlayer) {
      folium.ui.navigate('player');
    }

    folium.ui.toast(`已同步：${title}${artist ? ' - ' + artist : ''} (${formatTime(finalPos)})`, {
      type: 'success',
      durationMs: 3000
    });
  }

  const offState = folium.rpc.on('state', (payload) => {
    void handleRecognizedState(payload);
  });

  async function toggleSync() {
    syncEnabled = !syncEnabled;
    notifyButtons();

    if (syncEnabled) {
      lastTrackSig = '';
      songStartRefMs = 0;
      anchorSamples = [];
      const cfg = settingsSection.settings.get();
      folium.ui.toast('正在啟動麥克風辨識（首次會自動安裝套件）...', { type: 'info', durationMs: 3000 });
      try {
        await folium.rpc.call('startSync', { deviceId: cfg.micDeviceId || '' });
      } catch (err) {
        syncEnabled = false;
        notifyButtons();
        folium.ui.toast(`啟動失敗：${err?.message || err}`, { type: 'error', durationMs: 4500 });
      }
    } else {
      await folium.rpc.call('stopSync');
      folium.ui.toast('已停止麥克風聽歌同步', { type: 'info', durationMs: 1800 });
    }
  }

  folium.registries.commands.register({
    id: 'toggle-sync',
    label: { 'zh-CN': '开/关麦克风持续同步歌词', en: 'Toggle Mic Lyric Sync' },
    keywords: ['mic', 'shazam', 'lyrics', 'sync', '麥克風', '字幕'],
    globalShortcut: true,
    run: () => toggleSync()
  });

  folium.registries.commands.register({
    id: 'nudge-forward',
    label: { 'zh-CN': '同步时间轴 +0.5 秒', en: 'Sync Timeline +0.5s' },
    keywords: ['sync', 'offset', 'timeline', '微調'],
    globalShortcut: true,
    run: () => nudgeTimeline(0.5)
  });

  folium.registries.commands.register({
    id: 'nudge-backward',
    label: { 'zh-CN': '同步时间轴 -0.5 秒', en: 'Sync Timeline -0.5s' },
    keywords: ['sync', 'offset', 'timeline', '微調'],
    globalShortcut: true,
    run: () => nudgeTimeline(-0.5)
  });

  folium.registries.progressButtons.register({
    id: 'mic-sync-btn',
    slot: 'progress.trailing',
    hideWhenCollapsed: true,
    mount(container) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = [
        'display:inline-flex',
        'align-items:center',
        'justify-content:center',
        'width:28px',
        'height:28px',
        'border:none',
        'border-radius:999px',
        'background:transparent',
        'color:var(--folium-primary, currentColor)',
        'cursor:pointer',
        'padding:0'
      ].join(';');

      let disposed = false;
      const updateAppearance = async () => {
        if (disposed) return;
        btn.style.color = syncEnabled
          ? 'var(--folium-accent, #f43f5e)'
          : 'var(--folium-primary, currentColor)';
        btn.title = syncEnabled ? '持續辨識同步中（點擊停止）' : '開啟麥克風即時辨識同步歌詞';
        const svg = await folium.ui.icon(syncEnabled ? 'radio' : 'mic', { size: 16, strokeWidth: 2 });
        if (!disposed && svg) btn.replaceChildren(svg);
      };

      const onClick = () => void toggleSync();
      btn.addEventListener('click', onClick);
      buttonUpdaters.add(updateAppearance);
      container.appendChild(btn);
      void updateAppearance();

      return () => {
        disposed = true;
        buttonUpdaters.delete(updateAppearance);
        btn.removeEventListener('click', onClick);
        btn.remove();
      };
    }
  });

  return () => {
    syncEnabled = false;
    if (typeof offState === 'function') offState();
    void folium.rpc.call('stopSync').catch(() => {});
    buttonUpdaters.clear();
  };
}

function mountSettingsPanel(container, panelCtx, folium) {
  const root = document.createElement('div');
  root.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:10px',
    'font-family:var(--folium-font, system-ui, sans-serif)',
    'color:var(--folium-primary, inherit)',
    'font-size:13px'
  ].join(';');

  const inputStyle = [
    'width:100%',
    'box-sizing:border-box',
    'padding:6px 10px',
    'border-radius:8px',
    'border:1px solid color-mix(in srgb, currentColor 20%, transparent)',
    'background:color-mix(in srgb, currentColor 6%, transparent)',
    'color:inherit',
    'font-size:13px'
  ].join(';');

  const btnStyle = [
    'padding:6px 12px',
    'border-radius:8px',
    'border:1px solid color-mix(in srgb, currentColor 22%, transparent)',
    'background:color-mix(in srgb, currentColor 10%, transparent)',
    'color:inherit',
    'cursor:pointer',
    'font-size:12px',
    'white-space:nowrap'
  ].join(';');

  const micBox = document.createElement('div');
  micBox.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:8px',
    'padding:10px 12px',
    'border-radius:10px',
    'border:1px solid color-mix(in srgb, currentColor 15%, transparent)',
    'background:color-mix(in srgb, currentColor 4%, transparent)'
  ].join(';');

  const micTitle = document.createElement('div');
  micTitle.textContent = '麥克風裝置選擇與即時測試';
  micTitle.style.cssText = 'font-weight:600;font-size:13px;';

  const micRow = document.createElement('div');
  micRow.style.cssText = 'display:flex;gap:8px;align-items:center;';

  const micSelect = document.createElement('select');
  micSelect.style.cssText = inputStyle + ';flex:1;';

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = '重新掃描';
  refreshBtn.style.cssText = btnStyle;

  micRow.append(micSelect, refreshBtn);

  const testRow = document.createElement('div');
  testRow.style.cssText = 'display:flex;gap:10px;align-items:center;';

  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.textContent = '測試麥克風';
  testBtn.style.cssText = btnStyle;

  const meterTrack = document.createElement('div');
  meterTrack.style.cssText = [
    'flex:1',
    'height:10px',
    'border-radius:999px',
    'overflow:hidden',
    'background:color-mix(in srgb, currentColor 12%, transparent)'
  ].join(';');

  const meterFill = document.createElement('div');
  meterFill.style.cssText = [
    'width:0%',
    'height:100%',
    'border-radius:999px',
    'background:var(--folium-accent, #22c55e)',
    'transition:width 0.08s linear'
  ].join(';');
  meterTrack.appendChild(meterFill);

  const meterText = document.createElement('span');
  meterText.textContent = '未測試';
  meterText.style.cssText = 'min-width:68px;text-align:right;font-size:12px;opacity:0.8;';

  testRow.append(testBtn, meterTrack, meterText);
  micBox.append(micTitle, micRow, testRow);
  root.appendChild(micBox);

  const driftInput = addNumberField(root, '自動校正時間軸門檻（0.5–15 秒）', 0.5, 15, 0.1, inputStyle, (v) => panelCtx.settings.set({ driftThresholdSec: v }));
  const offsetInput = addNumberField(root, '手動時間軸微調（-5 到 +5 秒）', -5, 5, 0.1, inputStyle, (v) => panelCtx.settings.set({ offsetAdjustSec: v }));
  const providerInput = addTextField(root, '指定音源 ID（留空用目前音源）', inputStyle, (v) => panelCtx.settings.set({ preferredProvider: v }));
  const autoMuteChk = addBoolField(root, '同步時自動靜音 Folia', (v) => panelCtx.settings.set({ autoMute: v }));
  const autoPlayerChk = addBoolField(root, '辨識到新歌時自動開啟全螢幕歌詞頁', (v) => panelCtx.settings.set({ autoEnterPlayer: v }));

  const logTitle = document.createElement('div');
  logTitle.textContent = '即時辨識與環境安裝日誌';
  logTitle.style.cssText = 'font-size:12px;opacity:0.85;margin-top:4px;';

  const logPre = document.createElement('pre');
  logPre.style.cssText = [
    'margin:0',
    'padding:8px 10px',
    'max-height:150px',
    'overflow-y:auto',
    'border-radius:8px',
    'font-family:ui-monospace, Consolas, monospace',
    'font-size:11px',
    'line-height:1.45',
    'white-space:pre-wrap',
    'word-break:break-word',
    'background:color-mix(in srgb, currentColor 6%, transparent)',
    'border:1px solid color-mix(in srgb, currentColor 12%, transparent)'
  ].join(';');

  const footerRow = document.createElement('div');
  footerRow.style.cssText = 'display:flex;justify-content:space-between;gap:8px;margin-top:4px;';

  const updatePkgBtn = document.createElement('button');
  updatePkgBtn.type = 'button';
  updatePkgBtn.textContent = '立即檢查／更新 Python 套件';
  updatePkgBtn.style.cssText = btnStyle;
  updatePkgBtn.addEventListener('click', async () => {
    updatePkgBtn.disabled = true;
    updatePkgBtn.textContent = '更新中...';
    try {
      await folium.rpc.call('updatePackages');
      folium.ui.toast('Python 套件已更新至最新版本', { type: 'success', durationMs: 2500 });
    } catch (err) {
      folium.ui.toast(`更新失敗：${err?.message || err}`, { type: 'error', durationMs: 4000 });
    } finally {
      updatePkgBtn.disabled = false;
      updatePkgBtn.textContent = '立即檢查／更新 Python 套件';
    }
  });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = '恢復預設值';
  resetBtn.style.cssText = btnStyle;
  resetBtn.addEventListener('click', () => panelCtx.settings.reset());

  footerRow.append(updatePkgBtn, resetBtn);
  root.append(logTitle, logPre, footerRow);
  container.appendChild(root);

  let testing = false;

  function renderMics(data) {
    const savedId = String(panelCtx.settings.get().micDeviceId || '');
    micSelect.innerHTML = '';
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = '系統預設麥克風';
    micSelect.appendChild(defOpt);
    for (const dev of data?.devices || []) {
      const opt = document.createElement('option');
      opt.value = String(dev.id);
      opt.textContent = `[${dev.id}] ${dev.name}${dev.is_default ? ' (預設)' : ''}`;
      micSelect.appendChild(opt);
    }
    micSelect.value = savedId;
  }

  const offMics = folium.rpc.on('mics', renderMics);
  const offLevel = folium.rpc.on('level', (d) => {
    if (!testing) return;
    const pct = Math.min(100, Math.round(Number(d?.peak || 0) * 180));
    meterFill.style.width = `${pct}%`;
    meterText.textContent = pct < 1 ? '無聲音' : `音量 ${pct}%`;
  });
  const offLog = folium.rpc.on('log', (d) => {
    if (!d?.line) return;
    logPre.textContent = (logPre.textContent ? logPre.textContent + '\n' : '') + d.line;
    logPre.scrollTop = logPre.scrollHeight;
  });

  micSelect.addEventListener('change', () => {
    panelCtx.settings.set({ micDeviceId: micSelect.value });
    void folium.rpc.call('selectMic', micSelect.value);
  });

  refreshBtn.addEventListener('click', () => {
    void folium.rpc.call('listMics').then(renderMics).catch(() => {});
  });

  testBtn.addEventListener('click', () => {
    testing = !testing;
    testBtn.textContent = testing ? '停止測試' : '測試麥克風';
    if (!testing) {
      meterFill.style.width = '0%';
      meterText.textContent = '已停止';
    } else {
      meterText.textContent = '開啟中...';
    }
    void folium.rpc.call('setMicTest', testing).catch(() => {
      testing = false;
      testBtn.textContent = '測試麥克風';
      meterText.textContent = '啟動失敗';
    });
  });

  function syncFromSettings() {
    const v = panelCtx.settings.get();
    micSelect.value = v.micDeviceId || '';
    driftInput.value = String(v.driftThresholdSec ?? 5);
    offsetInput.value = String(v.offsetAdjustSec ?? 0);
    providerInput.value = v.preferredProvider || '';
    autoMuteChk.checked = Boolean(v.autoMute);
    autoPlayerChk.checked = Boolean(v.autoEnterPlayer);
  }

  const offChange = panelCtx.settings.onChange(syncFromSettings);
  syncFromSettings();
  void folium.rpc.call('listMics').then(renderMics).catch(() => {});
  void folium.rpc.call('getLogs').then((lines) => {
    if (Array.isArray(lines)) {
      logPre.textContent = lines.join('\n');
      logPre.scrollTop = logPre.scrollHeight;
    }
  });

  return () => {
    if (testing) void folium.rpc.call('setMicTest', false).catch(() => {});
    if (typeof offMics === 'function') offMics();
    if (typeof offLevel === 'function') offLevel();
    if (typeof offLog === 'function') offLog();
    if (typeof offChange === 'function') offChange();
    root.remove();
  };
}

function addTextField(parent, labelText, style, onCommit) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  const title = document.createElement('span');
  title.textContent = labelText;
  title.style.cssText = 'font-size:12px;opacity:0.85;';
  const input = document.createElement('input');
  input.type = 'text';
  input.style.cssText = style;
  input.addEventListener('change', () => onCommit(input.value));
  wrap.append(title, input);
  parent.appendChild(wrap);
  return input;
}

function addNumberField(parent, labelText, min, max, step, style, onCommit) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  const title = document.createElement('span');
  title.textContent = labelText;
  title.style.cssText = 'font-size:12px;opacity:0.85;';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.style.cssText = style;
  input.addEventListener('change', () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) onCommit(n);
  });
  wrap.append(title, input);
  parent.appendChild(wrap);
  return input;
}

function addBoolField(parent, labelText, onCommit) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.addEventListener('change', () => onCommit(input.checked));
  const title = document.createElement('span');
  title.textContent = labelText;
  wrap.append(input, title);
  parent.appendChild(wrap);
  return input;
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

async function waitForPlaybackReady(folium, targetSong, timeoutMs) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const st = folium.playback.getState();
    if (
      st?.song &&
      st.song.source === targetSong.source &&
      st.song.id === targetSong.id &&
      (st.state === 'playing' || (st.duration && st.duration > 0))
    ) {
      await new Promise((r) => setTimeout(r, 150));
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}
