// pythonEnv.cjs — 管理 Python 執行環境：支援系統 Python、自訂路徑、與 uv 自動下載免安裝 Python
const fs = require('fs');
const path = require('path');
const https = require('https');
const { pipeline } = require('stream/promises');

const VALID_MODES = new Set(['auto', 'system', 'custom', 'managed']);
const MANAGED_PYTHON_VERSION = '3.12';
const UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function stripWrappingQuotes(value) {
  const s = String(value || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function normalizePythonConfig(raw = {}) {
  const mode = VALID_MODES.has(raw?.pythonMode) ? raw.pythonMode : 'auto';
  const customPythonPath = stripWrappingQuotes(raw?.customPythonPath);
  return { pythonMode: mode, customPythonPath };
}

function getUvAssetInfo(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') {
    if (arch === 'arm64') {
      return {
        archiveName: 'uv-aarch64-pc-windows-msvc.zip',
        exeName: 'uv.exe',
        url: 'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-pc-windows-msvc.zip'
      };
    }
    return {
      archiveName: 'uv-x86_64-pc-windows-msvc.zip',
      exeName: 'uv.exe',
      url: 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip'
    };
  }
  if (platform === 'darwin') {
    const target = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
    return {
      archiveName: `uv-${target}.tar.gz`,
      exeName: 'uv',
      url: `https://github.com/astral-sh/uv/releases/latest/download/uv-${target}.tar.gz`
    };
  }
  const target = arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  return {
    archiveName: `uv-${target}.tar.gz`,
    exeName: 'uv',
    url: `https://github.com/astral-sh/uv/releases/latest/download/uv-${target}.tar.gz`
  };
}

function findFileRecursive(dir, targetName) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === targetName.toLowerCase()) {
      return full;
    }
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, targetName);
      if (found) return found;
    }
  }
  return null;
}

function downloadFile(url, destPath, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('下載 uv 時重新導向次數過多'));
  }
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'folia-mic-lyric-sync' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const nextUrl = new URL(res.headers.location, url).toString();
          downloadFile(nextUrl, destPath, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} (${url})`));
          return;
        }
        const out = fs.createWriteStream(destPath);
        pipeline(res, out).then(resolve, reject);
      })
      .on('error', reject);
  });
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function createPythonEnvManager({ dataDir, reqFile, pushLog, runCommand, platform = process.platform, arch = process.arch }) {
  const configFile = path.join(dataDir, 'python_config.json');
  const metaFile = path.join(dataDir, 'python_env_meta.json');
  const stateFile = path.join(dataDir, 'pip_state.json');
  const venvDir = path.join(dataDir, 'venv');
  const uvDir = path.join(dataDir, 'uv');
  const managedPythonDir = path.join(dataDir, 'python-managed');

  const venvPython = platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

  let cachedConfig = normalizePythonConfig(readJsonSafe(configFile, {}));

  function getConfig() {
    return { ...cachedConfig };
  }

  function setConfig(raw) {
    cachedConfig = normalizePythonConfig(raw);
    writeJsonSafe(configFile, cachedConfig);
    return getConfig();
  }

  async function findSystemPython() {
    const candidates = platform === 'win32'
      ? [['python', []], ['py', ['-3']], ['python3', []]]
      : [['python3', []], ['python', []]];
    for (const [cmd, baseArgs] of candidates) {
      try {
        await runCommand(cmd, [...baseArgs, '--version']);
        return [cmd, baseArgs];
      } catch {}
    }
    return null;
  }

  async function validateCustomPython(customPath) {
    if (!customPath) {
      throw new Error('已選擇自訂 Python 路徑，但尚未填寫執行檔路徑');
    }
    if (!fs.existsSync(customPath)) {
      throw new Error(`找不到自訂 Python 路徑：${customPath}`);
    }
    try {
      await runCommand(customPath, ['--version']);
      return [customPath, []];
    } catch (err) {
      throw new Error(`自訂 Python 無法執行 (${customPath})：${err.message}`);
    }
  }

  async function ensureUvBinary() {
    const info = getUvAssetInfo(platform, arch);
    const existing = findFileRecursive(uvDir, info.exeName);
    if (existing) return existing;

    fs.mkdirSync(uvDir, { recursive: true });
    const archivePath = path.join(uvDir, info.archiveName);
    pushLog('INFO', `正在下載免安裝 Python 管理工具 (${info.archiveName})...`);
    await downloadFile(info.url, archivePath);

    pushLog('INFO', '正在解壓縮管理工具...');
    await runCommand('tar', ['-xf', archivePath, '-C', uvDir]);
    try { fs.unlinkSync(archivePath); } catch {}

    const binPath = findFileRecursive(uvDir, info.exeName);
    if (!binPath) {
      throw new Error(`解壓縮後找不到 ${info.exeName}`);
    }
    if (platform !== 'win32') {
      try { fs.chmodSync(binPath, 0o755); } catch {}
    }
    return binPath;
  }

  function getUvEnv() {
    return {
      UV_PYTHON_INSTALL_DIR: managedPythonDir,
      UV_PYTHON_PREFERENCE: 'only-managed'
    };
  }

  async function createVenvWithSystemOrCustom(cmd, baseArgs) {
    await runCommand(cmd, [...baseArgs, '-m', 'venv', venvDir], (line) => pushLog('INFO', line));
  }

  async function createVenvWithUv(uvBin) {
    pushLog('INFO', `正在透過 uv 下載並建立免安裝 Python ${MANAGED_PYTHON_VERSION} 隔離環境...`);
    await runCommand(
      uvBin,
      ['venv', venvDir, '--python', MANAGED_PYTHON_VERSION, '--managed-python'],
      (line) => pushLog('INFO', line),
      getUvEnv()
    );
  }

  async function installPackages(runtimeKind) {
    if (runtimeKind === 'managed') {
      const uvBin = await ensureUvBinary();
      await runCommand(
        uvBin,
        ['pip', 'install', '--python', venvPython, '--upgrade', '-r', reqFile],
        (line) => pushLog('INFO', line),
        getUvEnv()
      );
      return;
    }
    await runCommand(
      venvPython,
      ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', '-r', reqFile],
      (line) => pushLog('INFO', line)
    );
  }

  function isConfigMatchingMeta(cfg, meta) {
    if (!meta || meta.pythonMode !== cfg.pythonMode) return false;
    if (cfg.pythonMode === 'custom' && meta.customPythonPath !== cfg.customPythonPath) return false;
    return true;
  }

  async function ensureEnvironment(forceUpgrade = false) {
    const cfg = getConfig();
    const prevMeta = readJsonSafe(metaFile, null);
    const configChanged = !isConfigMatchingMeta(cfg, prevMeta);

    if (configChanged && fs.existsSync(venvDir)) {
      pushLog('INFO', `Python 環境設定已變更 (${cfg.pythonMode})，正在重建隔離環境...`);
      fs.rmSync(venvDir, { recursive: true, force: true });
      try { fs.unlinkSync(stateFile); } catch {}
    }

    let runtimeKind = prevMeta?.runtimeKind || null;

    if (!fs.existsSync(venvPython)) {
      if (cfg.pythonMode === 'custom') {
        pushLog('INFO', `正在使用自訂 Python 建立隔離環境：${cfg.customPythonPath}`);
        const [cmd, args] = await validateCustomPython(cfg.customPythonPath);
        await createVenvWithSystemOrCustom(cmd, args);
        runtimeKind = 'custom';
      } else if (cfg.pythonMode === 'system') {
        pushLog('INFO', '正在搜尋系統 Python 並建立隔離環境 (venv)...');
        const found = await findSystemPython();
        if (!found) {
          throw new Error('找不到系統 Python，請安裝 Python 3.10+ 並勾選 Add Python to PATH，或切換為「自動下載」模式');
        }
        await createVenvWithSystemOrCustom(found[0], found[1]);
        runtimeKind = 'system';
      } else if (cfg.pythonMode === 'managed') {
        const uvBin = await ensureUvBinary();
        await createVenvWithUv(uvBin);
        runtimeKind = 'managed';
      } else {
        pushLog('INFO', '正在偵測系統 Python...');
        const found = await findSystemPython();
        if (found) {
          pushLog('INFO', '已偵測到系統 Python，正在建立隔離環境 (venv)...');
          await createVenvWithSystemOrCustom(found[0], found[1]);
          runtimeKind = 'system';
        } else {
          pushLog('INFO', '未偵測到系統 Python，將自動下載免安裝 Python...');
          const uvBin = await ensureUvBinary();
          await createVenvWithUv(uvBin);
          runtimeKind = 'managed';
        }
      }

      writeJsonSafe(metaFile, {
        pythonMode: cfg.pythonMode,
        customPythonPath: cfg.customPythonPath,
        runtimeKind
      });
      pushLog('INFO', '隔離環境建立完成');
    }

    let pkgsReady = false;
    try {
      await runCommand(venvPython, ['-c', 'import shazamio, sounddevice, numpy']);
      pkgsReady = true;
    } catch {
      pkgsReady = false;
    }

    const savedState = readJsonSafe(stateFile, {});
    const lastCheck = Number(savedState?.lastUpgradeAt || 0);
    const needUpgrade = forceUpgrade || !pkgsReady || (Date.now() - lastCheck > UPDATE_INTERVAL_MS);

    if (needUpgrade) {
      pushLog('INFO', pkgsReady ? '正在檢查並更新 Python 套件...' : '正在自動安裝辨識所需 Python 套件 (shazamio / sounddevice / numpy)...');
      await installPackages(runtimeKind);
      writeJsonSafe(stateFile, { lastUpgradeAt: Date.now() });
      pushLog('INFO', 'Python 套件準備與更新完成！');
    }

    return venvPython;
  }

  return {
    getConfig,
    setConfig,
    ensureEnvironment,
    findSystemPython,
    validateCustomPython
  };
}

module.exports = {
  MANAGED_PYTHON_VERSION,
  normalizePythonConfig,
  getUvAssetInfo,
  createPythonEnvManager
};
