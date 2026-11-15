// index.cjs — Folium main 入口：自動建立隔離 venv、自動安裝/更新套件，並託管內建 Python 辨識子行程
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 每 7 天自動檢查更新一次
const DEFAULT_POLL_INTERVAL_SEC = 30;
const MIN_POLL_INTERVAL_SEC = 5;
const MAX_POLL_INTERVAL_SEC = 300;

function normalizePollInterval(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return DEFAULT_POLL_INTERVAL_SEC;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_POLL_INTERVAL_SEC;
  return Math.max(MIN_POLL_INTERVAL_SEC, Math.min(MAX_POLL_INTERVAL_SEC, Math.round(n)));
}

module.exports = function activate(api) {
  let proc = null;
  let stdoutBuf = '';
  let disposed = false;
  let bootstrapPromise = null;
  let desiredPollIntervalSec = DEFAULT_POLL_INTERVAL_SEC;

  const logHistory = [];
  let cachedMics = { current_device_id: null, devices: [] };
  let pendingMicWaiters = [];
  let latestState = { ok: false, title: '', artist: '', position_sec: 0, updated_at_ms: 0 };

  function flushMicWaiters(result) {
    if (pendingMicWaiters.length === 0) return;
    const waiters = pendingMicWaiters.splice(0, pendingMicWaiters.length);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve(result);
    }
  }

  function waitForNextMics(timeoutMs = 5000) {
    return new Promise((resolve) => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          const idx = pendingMicWaiters.indexOf(waiter);
          if (idx !== -1) pendingMicWaiters.splice(idx, 1);
          resolve(cachedMics);
        }, timeoutMs)
      };
      pendingMicWaiters.push(waiter);
    });
  }

  function pushLog(level, text) {
    const line = `[${new Date().toTimeString().slice(0, 8)}] [${level}] ${text}`;
    logHistory.push(line);
    if (logHistory.length > 80) logHistory.shift();
    if (!disposed && api.host.folium.minor >= 7) {
      try { api.rpc.send('log', { line }); } catch {}
    }
  }

  function sendCmd(obj) {
    if (!proc || !proc.stdin || proc.stdin.destroyed) return false;
    try {
      proc.stdin.write(JSON.stringify(obj) + '\n');
      return true;
    } catch {
      return false;
    }
  }

  function getSafeCwd() {
    try {
      return api.storage.paths.data;
    } catch {
      return process.cwd();
    }
  }

  function runCommand(cmd, args, onLine) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: getSafeCwd(),
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.on('error', reject);
      const handleChunk = (chunk) => {
        if (!onLine) return;
        for (const raw of chunk.toString('utf8').split(/\r?\n/)) {
          const t = raw.trim();
          if (t) onLine(t);
        }
      };
      child.stdout.on('data', handleChunk);
      child.stderr.on('data', handleChunk);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
      });
    });
  }

  async function findSystemPython() {
    const candidates = process.platform === 'win32'
      ? [['python', []], ['py', ['-3']], ['python3', []]]
      : [['python3', []], ['python', []]];
    for (const [cmd, baseArgs] of candidates) {
      try {
        await runCommand(cmd, [...baseArgs, '--version']);
        return [cmd, baseArgs];
      } catch {}
    }
    throw new Error('找不到系統 Python，請先安裝 Python 3.10+ 並勾選 Add Python to PATH');
  }

  async function ensureEnvironment(forceUpgrade = false) {
    if (bootstrapPromise) return bootstrapPromise;

    bootstrapPromise = (async () => {
      const dataDir = api.storage.paths.data;
      const venvDir = path.join(dataDir, 'venv');
      const venvPython = process.platform === 'win32'
        ? path.join(venvDir, 'Scripts', 'python.exe')
        : path.join(venvDir, 'bin', 'python');
      const stateFile = path.join(dataDir, 'pip_state.json');
      const reqFile = path.join(__dirname, 'requirements.txt');

      if (!fs.existsSync(venvPython)) {
        pushLog('INFO', '首次使用：正在搜尋系統 Python 並建立模組專屬隔離環境 (venv)...');
        const [sysCmd, sysArgs] = await findSystemPython();
        await runCommand(sysCmd, [...sysArgs, '-m', 'venv', venvDir], (line) => pushLog('INFO', line));
        pushLog('INFO', '隔離環境建立完成');
      }

      let pkgsReady = false;
      try {
        await runCommand(venvPython, ['-c', 'import shazamio, sounddevice, numpy']);
        pkgsReady = true;
      } catch {
        pkgsReady = false;
      }

      let lastCheck = 0;
      try {
        const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        lastCheck = Number(saved.lastUpgradeAt || 0);
      } catch {}

      const needUpgrade = forceUpgrade || !pkgsReady || (Date.now() - lastCheck > UPDATE_INTERVAL_MS);
      if (needUpgrade) {
        pushLog('INFO', pkgsReady ? '正在檢查並更新 Python 套件...' : '正在自動安裝辨識所需 Python 套件 (shazamio / sounddevice / numpy)...');
        await runCommand(
          venvPython,
          ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', '-r', reqFile],
          (line) => pushLog('INFO', line)
        );
        fs.writeFileSync(stateFile, JSON.stringify({ lastUpgradeAt: Date.now() }), 'utf8');
        pushLog('INFO', 'Python 套件準備與更新完成！');
      }

      return venvPython;
    })();

    try {
      return await bootstrapPromise;
    } finally {
      bootstrapPromise = null;
    }
  }

  function handleWorkerMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'log') {
      pushLog(msg.level || 'INFO', msg.text || '');
      return;
    }
    if (msg.type === 'mics') {
      cachedMics = {
        current_device_id: msg.current_device_id ?? null,
        devices: Array.isArray(msg.devices) ? msg.devices : []
      };
      flushMicWaiters(cachedMics);
      if (!disposed) {
        try { api.rpc.send('mics', cachedMics); } catch {}
      }
      return;
    }
    if (msg.type === 'level') {
      if (!disposed) {
        try { api.rpc.send('level', { peak: msg.peak || 0, rms: msg.rms || 0 }); } catch {}
      }
      return;
    }
    if (msg.type === 'state') {
      latestState = {
        ok: Boolean(msg.ok),
        title: msg.title || '',
        artist: msg.artist || '',
        position_sec: Number(msg.position_sec || 0),
        updated_at_ms: Number(msg.updated_at_ms || Date.now()),
        mono_received_ms: Date.now(),
        elapsed_ms: Number(msg.elapsed_ms || 0)
      };
      if (!disposed) {
        try { api.rpc.send('state', latestState); } catch {}
      }
    }
  }

  async function ensureWorker() {
    if (disposed || proc) return;
    const venvPython = await ensureEnvironment(false);
    if (disposed || proc) return;

    const workerPath = path.join(__dirname, 'bridge_worker.py');
    stdoutBuf = '';

    pushLog('INFO', '正在啟動內建辨識引擎...');
    // cwd 設在 mods-data 而非模組目錄，避免 Windows 更新覆蓋模組時發生 EBUSY 資料夾鎖定
    const child = spawn(venvPython, [workerPath], {
      cwd: getSafeCwd(),
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    proc = child;

    child.on('error', (err) => {
      if (proc === child) proc = null;
      pushLog('ERROR', `無法啟動辨識引擎: ${err.message}`);
    });

    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const rawLine = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!rawLine) continue;
        try {
          handleWorkerMessage(JSON.parse(rawLine));
        } catch {
          pushLog('INFO', rawLine);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) pushLog('WARN', text);
    });

    child.on('exit', (code) => {
      if (proc === child) proc = null;
      if (!disposed) pushLog('WARN', `辨識引擎已結束 (code=${code})`);
    });
  }

  function stopWorker() {
    flushMicWaiters(cachedMics);
    if (!proc) return;
    const target = proc;
    proc = null;
    try { sendCmd({ cmd: 'quit' }); } catch {}
    try {
      if (!target.killed) target.kill();
    } catch {}
  }

  api.rpc.handle('startSync', async (opts = {}) => {
    await ensureWorker();
    if (opts && opts.deviceId !== undefined && opts.deviceId !== '') {
      sendCmd({ cmd: 'select_mic', device_id: Number(opts.deviceId) });
    }
    if (opts && opts.pollIntervalSec !== undefined) {
      desiredPollIntervalSec = normalizePollInterval(opts.pollIntervalSec);
    }
    sendCmd({ cmd: 'start_sync', poll_interval_sec: desiredPollIntervalSec });
    return { ok: true };
  });

  api.rpc.handle('stopSync', () => {
    sendCmd({ cmd: 'stop_sync' });
    return { ok: true };
  });

  api.rpc.handle('setPollInterval', (seconds) => {
    desiredPollIntervalSec = normalizePollInterval(seconds);
    if (proc) {
      sendCmd({ cmd: 'set_poll_interval', seconds: desiredPollIntervalSec });
    }
    return { ok: true, pollIntervalSec: desiredPollIntervalSec };
  });

  api.rpc.handle('setRecognitionPaused', (paused) => {
    if (proc) {
      sendCmd({ cmd: paused ? 'pause_recognition' : 'resume_recognition' });
    }
    return { ok: true };
  });

  api.rpc.handle('listMics', async () => {
    await ensureWorker();
    const waitPromise = waitForNextMics(5000);
    if (!sendCmd({ cmd: 'list_mics' })) {
      flushMicWaiters(cachedMics);
      return cachedMics;
    }
    return await waitPromise;
  });

  api.rpc.handle('selectMic', async (deviceId) => {
    await ensureWorker();
    sendCmd({ cmd: 'select_mic', device_id: deviceId === '' || deviceId === null ? null : Number(deviceId) });
    return { ok: true };
  });

  api.rpc.handle('setMicTest', async (enabled) => {
    await ensureWorker();
    sendCmd({ cmd: 'set_test', enabled: Boolean(enabled) });
    return { ok: true };
  });

  api.rpc.handle('updatePackages', async () => {
    stopWorker();
    await ensureEnvironment(true);
    await ensureWorker();
    return { ok: true };
  });

  api.rpc.handle('getLogs', () => logHistory.slice());

  api.rpc.handle('getState', () => {
    if (!latestState.ok) return latestState;
    const extraSec = (Date.now() - (latestState.mono_received_ms || Date.now())) / 1000;
    return {
      ...latestState,
      position_sec: Math.max(0, latestState.position_sec + extraSec)
    };
  });

  api.onDispose(() => {
    disposed = true;
    stopWorker();
  });
};
