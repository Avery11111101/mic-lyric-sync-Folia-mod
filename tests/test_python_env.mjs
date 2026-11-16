import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  UV_VERSION,
  normalizePythonConfig,
  getUvAssetInfo,
  verifyFileSha256,
  createPythonEnvManager
} = require('../mic-lyric-sync/pythonEnv.cjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mic-lyric-py-env-'));
}

test('normalizePythonConfig 正規化模式與去除路徑前後引號', () => {
  assert.deepEqual(normalizePythonConfig({}), { pythonMode: 'auto', customPythonPath: '' });
  assert.deepEqual(
    normalizePythonConfig({ pythonMode: 'invalid', customPythonPath: ' "C:\\Py\\python.exe" ' }),
    { pythonMode: 'auto', customPythonPath: 'C:\\Py\\python.exe' }
  );
  assert.deepEqual(
    normalizePythonConfig({ pythonMode: 'custom', customPythonPath: "'/usr/bin/python3'" }),
    { pythonMode: 'custom', customPythonPath: '/usr/bin/python3' }
  );
  assert.equal(normalizePythonConfig({ pythonMode: 'managed' }).pythonMode, 'managed');
  assert.equal(normalizePythonConfig({ pythonMode: 'system' }).pythonMode, 'system');
});

test('getUvAssetInfo 依平台與架構回傳固定版本 uv 下載資訊與 sha256', () => {
  const win64 = getUvAssetInfo('win32', 'x64');
  assert.equal(win64.exeName, 'uv.exe');
  assert.equal(win64.version, UV_VERSION);
  assert.match(win64.archiveName, /x86_64-pc-windows-msvc\.zip$/);
  assert.ok(win64.url.includes(`/releases/download/${UV_VERSION}/`));
  assert.ok(!win64.url.includes('/releases/latest/'));
  assert.match(win64.sha256, /^[0-9a-f]{64}$/);

  const macArm = getUvAssetInfo('darwin', 'arm64');
  assert.equal(macArm.exeName, 'uv');
  assert.ok(macArm.url.includes(`/releases/download/${UV_VERSION}/`));
  assert.match(macArm.archiveName, /aarch64-apple-darwin\.tar\.gz$/);
  assert.match(macArm.sha256, /^[0-9a-f]{64}$/);

  const linux64 = getUvAssetInfo('linux', 'x64');
  assert.equal(linux64.exeName, 'uv');
  assert.ok(linux64.url.includes(`/releases/download/${UV_VERSION}/`));
  assert.match(linux64.archiveName, /x86_64-unknown-linux-gnu\.tar\.gz$/);
  assert.match(linux64.sha256, /^[0-9a-f]{64}$/);
});

test('未取得安裝同意時 ensureEnvironment 應拒絕下載與安裝', async () => {
  const dir = makeTempDir();
  try {
    const mgr = createPythonEnvManager({
      dataDir: dir,
      reqFile: path.join(dir, 'requirements.txt'),
      pushLog: () => {},
      platform: 'win32',
      runCommand: async () => {}
    });
    const status = await mgr.getEnvStatus();
    assert.equal(status.consented, false);
    assert.equal(status.needsConsent, true);
    await assert.rejects(() => mgr.ensureEnvironment(false), /INSTALL_CONSENT_REQUIRED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('system 模式在找不到系統 Python 時應拋出明確錯誤', async () => {
  const dir = makeTempDir();
  try {
    const mgr = createPythonEnvManager({
      dataDir: dir,
      reqFile: path.join(dir, 'requirements.txt'),
      pushLog: () => {},
      platform: 'win32',
      runCommand: async () => {
        throw new Error('not found');
      }
    });
    mgr.setInstallConsent(true);
    mgr.setConfig({ pythonMode: 'system' });
    await assert.rejects(() => mgr.ensureEnvironment(false), /找不到系統 Python/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('custom 模式驗證路徑不存在或未填寫時應拋出錯誤，存在時建立 venv', async () => {
  const dir = makeTempDir();
  const fakeCustomPy = path.join(dir, 'my-python.exe');
  fs.writeFileSync(fakeCustomPy, '');
  const calls = [];
  try {
    const mgr = createPythonEnvManager({
      dataDir: dir,
      reqFile: path.join(dir, 'requirements.txt'),
      pushLog: () => {},
      platform: 'win32',
      runCommand: async (cmd, args) => {
        calls.push([cmd, args]);
        if (args.includes('venv')) {
          const venvPy = path.join(dir, 'venv', 'Scripts', 'python.exe');
          fs.mkdirSync(path.dirname(venvPy), { recursive: true });
          fs.writeFileSync(venvPy, '');
        }
      }
    });

    mgr.setInstallConsent(true);
    mgr.setConfig({ pythonMode: 'custom', customPythonPath: '' });
    await assert.rejects(() => mgr.ensureEnvironment(false), /尚未填寫/);

    mgr.setConfig({ pythonMode: 'custom', customPythonPath: path.join(dir, 'missing.exe') });
    await assert.rejects(() => mgr.ensureEnvironment(false), /找不到自訂 Python 路徑/);

    mgr.setConfig({ pythonMode: 'custom', customPythonPath: fakeCustomPy });
    const venvPy = await mgr.ensureEnvironment(false);
    assert.equal(venvPy, path.join(dir, 'venv', 'Scripts', 'python.exe'));
    assert.ok(calls.some(([c, a]) => c === fakeCustomPy && a.includes('venv')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('auto 模式無系統 Python 時改用 uv managed Python，切換模式會重建 venv', async () => {
  const dir = makeTempDir();
  const uvBin = path.join(dir, 'uv', 'uv.exe');
  fs.mkdirSync(path.dirname(uvBin), { recursive: true });
  fs.writeFileSync(uvBin, '');
  const calls = [];
  let allowSystemPy = false;
  let pkgsInstalled = false;

  try {
    const mgr = createPythonEnvManager({
      dataDir: dir,
      reqFile: path.join(dir, 'requirements.txt'),
      pushLog: () => {},
      platform: 'win32',
      runCommand: async (cmd, args) => {
        calls.push([cmd, args]);
        if ((cmd === 'python' || cmd === 'py' || cmd === 'python3') && args.includes('--version')) {
          if (!allowSystemPy) throw new Error('no sys python');
          return;
        }
        if (args[0] === '-c' && !pkgsInstalled) {
          throw new Error('packages not installed');
        }
        if (args.includes('install')) {
          pkgsInstalled = true;
        }
        if (cmd === uvBin && args[0] === 'venv') {
          pkgsInstalled = false;
          const venvPy = path.join(dir, 'venv', 'Scripts', 'python.exe');
          fs.mkdirSync(path.dirname(venvPy), { recursive: true });
          fs.writeFileSync(venvPy, '');
        }
        if (cmd === 'python' && args.includes('venv')) {
          pkgsInstalled = false;
          const venvPy = path.join(dir, 'venv', 'Scripts', 'python.exe');
          fs.mkdirSync(path.dirname(venvPy), { recursive: true });
          fs.writeFileSync(venvPy, '');
        }
      }
    });

    mgr.setInstallConsent(true);
    mgr.setConfig({ pythonMode: 'auto' });
    await mgr.ensureEnvironment(false);
    assert.ok(calls.some(([c, a]) => c === uvBin && a[0] === 'venv'));
    const uvPipCall = calls.find(([c, a]) => c === uvBin && a[0] === 'pip');
    assert.ok(uvPipCall);
    assert.ok(uvPipCall[1].includes('--require-hashes'));
    assert.ok(!uvPipCall[1].includes('--upgrade'));

    // 切換為 system 模式時應重建 venv，且 pip 使用 --require-hashes 而不使用 --upgrade
    allowSystemPy = true;
    calls.length = 0;
    mgr.setConfig({ pythonMode: 'system' });
    await mgr.ensureEnvironment(false);
    assert.ok(calls.some(([c, a]) => c === 'python' && a.includes('venv')));
    const sysPipCall = calls.find(([, a]) => a.includes('pip') && a.includes('install'));
    assert.ok(sysPipCall);
    assert.ok(sysPipCall[1].includes('--require-hashes'));
    assert.ok(!sysPipCall[1].includes('--upgrade'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('下載 uv 壓縮檔時若 SHA-256 不符應拋出錯誤並拒絕解壓', async () => {
  const dir = makeTempDir();
  const calls = [];
  try {
    const mgr = createPythonEnvManager({
      dataDir: dir,
      reqFile: path.join(dir, 'requirements.txt'),
      pushLog: () => {},
      platform: 'win32',
      arch: 'x64',
      downloadFn: async (_url, destPath) => {
        fs.writeFileSync(destPath, 'corrupted-uv-archive');
      },
      runCommand: async (cmd, args) => {
        calls.push([cmd, args]);
      }
    });
    mgr.setInstallConsent(true);
    mgr.setConfig({ pythonMode: 'managed' });
    await assert.rejects(() => mgr.ensureEnvironment(false), /SHA-256 校驗失敗/);
    assert.ok(!calls.some(([c]) => c === 'tar'), 'SHA-256 不符時不可呼叫 tar 解壓');
    const archivePath = path.join(dir, 'uv', getUvAssetInfo('win32', 'x64').archiveName);
    assert.equal(fs.existsSync(archivePath), false, '失敗後應清除暫存壓縮檔');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyFileSha256 在雜湊相符時通過，不符時拒絕', async () => {
  const dir = makeTempDir();
  try {
    const file = path.join(dir, 'sample.bin');
    const content = 'folia-mic-lyric-sync-test';
    fs.writeFileSync(file, content);
    const expected = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(await verifyFileSha256(file, expected), expected);
    await assert.rejects(() => verifyFileSha256(file, '0'.repeat(64)), /SHA-256 校驗失敗/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('已有可用 venv 但缺 python_env_meta.json 且尚未同意安裝時應保留 venv 並補寫 meta', async () => {
  const dir = makeTempDir();
  const venvPy = path.join(dir, 'venv', 'Scripts', 'python.exe');
  const markerFile = path.join(dir, 'venv', 'existing_marker.txt');
  const metaFile = path.join(dir, 'python_env_meta.json');
  fs.mkdirSync(path.dirname(venvPy), { recursive: true });
  fs.writeFileSync(venvPy, '');
  fs.writeFileSync(markerFile, 'keep-me');

  try {
    const mgr = createPythonEnvManager({
      dataDir: dir,
      reqFile: path.join(dir, 'requirements.txt'),
      pushLog: () => {},
      platform: 'win32',
      runCommand: async (cmd, args) => {
        if (cmd === venvPy && args[0] === '-c') {
          return;
        }
        throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
      }
    });

    assert.equal(mgr.hasInstallConsent(), false);
    assert.equal(fs.existsSync(metaFile), false);

    const resolved = await mgr.ensureEnvironment(false);
    assert.equal(resolved, venvPy);
    assert.equal(fs.existsSync(markerFile), true, '不應刪除既有可用 venv');
    assert.equal(fs.existsSync(metaFile), true, '應補寫 python_env_meta.json');

    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    assert.deepEqual(meta, {
      pythonMode: 'auto',
      customPythonPath: '',
      runtimeKind: 'existing'
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('殘留損壞 venv（套件未就緒）且缺 python_env_meta.json 與同意時應要求安裝同意', async () => {
  const dir = makeTempDir();
  const venvPy = path.join(dir, 'venv', 'Scripts', 'python.exe');
  fs.mkdirSync(path.dirname(venvPy), { recursive: true });
  fs.writeFileSync(venvPy, '');

  try {
    const mgr = createPythonEnvManager({
      dataDir: dir,
      reqFile: path.join(dir, 'requirements.txt'),
      pushLog: () => {},
      platform: 'win32',
      runCommand: async () => {
        throw new Error('ModuleNotFoundError');
      }
    });

    await assert.rejects(() => mgr.ensureEnvironment(false), /INSTALL_CONSENT_REQUIRED/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
