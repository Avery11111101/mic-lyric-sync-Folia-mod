import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_LOCALES,
  TRANSLATIONS,
  formatMicOptionLabel,
  formatSystemDefaultMicLabel,
  getLocaleMap,
  normalizeLocale,
  resolveLocale,
  t
} from '../mic-lyric-sync/i18n.mjs';
import activate from '../mic-lyric-sync/client.mjs';

test('四種語系翻譯鍵值完整對齊且無空白翻譯', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['zh-TW', 'zh-CN', 'ja', 'en']);
  const baseKeys = Object.keys(TRANSLATIONS['zh-TW']).sort();
  for (const loc of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(TRANSLATIONS[loc]).sort(), baseKeys, `語系 ${loc} 鍵值不一致`);
    for (const k of baseKeys) {
      assert.equal(typeof TRANSLATIONS[loc][k], 'string');
      assert.ok(TRANSLATIONS[loc][k].trim().length > 0, `${loc}.${k} 不可為空`);
    }
  }
});

test('normalizeLocale 與 resolveLocale 正確解析四種語系', () => {
  assert.equal(normalizeLocale('zh_TW'), 'zh-TW');
  assert.equal(normalizeLocale('zh-Hant-TW'), 'zh-TW');
  assert.equal(normalizeLocale('zh-HK'), 'zh-TW');
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN');
  assert.equal(normalizeLocale('zh-Hans'), 'zh-CN');
  assert.equal(normalizeLocale('ja-JP'), 'ja');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('auto'), '');

  assert.equal(resolveLocale('ja', {}), 'ja');
  assert.equal(resolveLocale('auto', { ui: { getLocale: () => 'zh-CN' } }), 'zh-CN');
  assert.equal(resolveLocale('auto', { env: { locale: 'en-GB' } }), 'en');
  assert.equal(resolveLocale('auto', {}), 'zh-TW');
});

test('系統預設麥克風與硬體選項顯示格式符合需求（四語系）', () => {
  const defaultDev = {
    id: 1,
    raw_name: '麥克風 (Realtek(R) Audio)',
    name: '麥克風 (Realtek(R) Audio) (MME)',
    is_default: true
  };
  const extraDev = {
    id: 3,
    raw_name: 'Blue Yeti USB',
    name: 'Blue Yeti USB (Windows WASAPI)',
    is_default: false
  };

  assert.equal(
    formatSystemDefaultMicLabel(defaultDev, 'zh-TW'),
    '麥克風 (Realtek(R) Audio) (系統預設麥克風)'
  );
  assert.equal(
    formatSystemDefaultMicLabel(defaultDev, 'zh-CN'),
    '麥克風 (Realtek(R) Audio) (系统默认麦克风)'
  );
  assert.equal(
    formatSystemDefaultMicLabel(defaultDev, 'ja'),
    '麥克風 (Realtek(R) Audio) (システム既定のマイク)'
  );
  assert.equal(
    formatSystemDefaultMicLabel(defaultDev, 'en'),
    '麥克風 (Realtek(R) Audio) (System Default Microphone)'
  );
  assert.equal(formatSystemDefaultMicLabel(null, 'zh-TW'), '系統預設麥克風');

  assert.equal(
    formatMicOptionLabel(defaultDev, 'zh-TW'),
    '[1] 麥克風 (Realtek(R) Audio) (MME) (預設)'
  );
  assert.equal(
    formatMicOptionLabel(extraDev, 'en'),
    '[3] Blue Yeti USB (Windows WASAPI)'
  );
  assert.equal(t('zh-TW', 'mic.levelPercent', { pct: 42 }), '音量 42%');
});

test('activate 註冊四語系設定與指令標籤並包含 language 設定', () => {
  let registeredSection = null;
  const registeredCommands = [];
  const folium = {
    env: { context: 'main' },
    host: { folium: { minor: 7 } },
    log: { info: () => {}, warn: () => {} },
    ui: { toast: () => {}, navigate: () => {}, icon: async () => null },
    omni: { searchSongs: async () => ({ items: [] }) },
    playback: { getState: () => ({}), setMuted: async () => {}, playSong: async () => {}, seek: async () => {} },
    rpc: { on: () => () => {}, call: async () => ({ ok: true }) },
    registries: {
      settingsSections: {
        register: (sec) => {
          registeredSection = sec;
          return { settings: { get: () => ({ language: 'auto' }), onChange: () => () => {} } };
        }
      },
      commands: { register: (cmd) => registeredCommands.push(cmd) },
      progressButtons: { register: () => {} }
    }
  };

  const cleanup = activate(folium);
  assert.deepEqual(registeredSection.label, getLocaleMap('section.label'));
  assert.ok(registeredSection.settings.some((s) => s.key === 'language' && s.defaultValue === 'auto'));
  assert.equal(registeredCommands.length, 3);
  for (const cmd of registeredCommands) {
    for (const loc of SUPPORTED_LOCALES) {
      assert.ok(cmd.label[loc], `指令 ${cmd.id} 缺少語系 ${loc}`);
    }
  }
  cleanup();
});
