import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizePythonConfig,
  getUvAssetInfo,
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

test('getUvAssetInfo 依平台與架構回傳正確 uv 下載資訊', () => {
  const win64 = getUvAssetInfo('win32', 'x64');
  assert.equal(win64.exeName, 'uv.exe');
  assert.match(win64.archiveName, /x86_64-pc-windows-msvc\.zip$/);

  const macArm = getUvAssetInfo('darwin', 'arm64');
  assert.equal(macArm.exeName, 'uv');
  assert.match(macArm.archiveName, /aarch64-apple-darwin\.tar\.gz$/);

  const linux64 = getUvAssetInfo('linux', 'x64');
  assert.equal(linux64.exeName, 'uv');
  assert.match(linux64.archiveName, /x86_64-unknown-linux-gnu\.tar\.gz$/);
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
        if (cmd === uvBin && args[0] === 'venv') {
          const venvPy = path.join(dir, 'venv', 'Scripts', 'python.exe');
          fs.mkdirSync(path.dirname(venvPy), { recursive: true });
          fs.writeFileSync(venvPy, '');
        }
        if (cmd === 'python' && args.includes('venv')) {
          const venvPy = path.join(dir, 'venv', 'Scripts', 'python.exe');
          fs.mkdirSync(path.dirname(venvPy), { recursive: true });
          fs.writeFileSync(venvPy, '');
        }
      }
    });

    mgr.setConfig({ pythonMode: 'auto' });
    await mgr.ensureEnvironment(false);
    assert.ok(calls.some(([c, a]) => c === uvBin && a[0] === 'venv'));
    assert.ok(calls.some(([c, a]) => c === uvBin && a[0] === 'pip'));

    // 切換為 system 模式時應重建 venv
    allowSystemPy = true;
    calls.length = 0;
    mgr.setConfig({ pythonMode: 'system' });
    await mgr.ensureEnvironment(false);
    assert.ok(calls.some(([c, a]) => c === 'python' && a.includes('venv')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
