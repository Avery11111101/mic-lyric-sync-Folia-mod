// i18n.mjs — 多語系支援模組（繁體中文、簡體中文、日語、英文）

export const SUPPORTED_LOCALES = ['zh-TW', 'zh-CN', 'ja', 'en'];
export const DEFAULT_LOCALE = 'zh-TW';

export const TRANSLATIONS = {
  'zh-TW': {
    'section.label': '麥克風聽歌同步',
    'section.description': '自動建立隔離 Python 環境並更新辨識套件，透過麥克風持續聽歌並同步顯示 Folia 原生歌詞。',
    'setting.language': '介面語言 / Language',
    'setting.language.auto': '自動偵測（跟隨系統）',
    'setting.language.zh-TW': '繁體中文',
    'setting.language.zh-CN': '簡體中文',
    'setting.language.ja': '日本語',
    'setting.language.en': 'English',
    'setting.micDeviceId': '麥克風裝置 ID',
    'setting.pollIntervalSec': '辨識間隔（秒，建議 30 秒）',
    'setting.pauseUntilSongEnd': '播放完畢前不重複辨識（等播完再繼續）',
    'setting.driftThresholdSec': '自動校正時間軸門檻（秒）',
    'setting.offsetAdjustSec': '手動時間軸微調（秒）',
    'setting.autoMute': '同步時自動靜音 Folia',
    'setting.autoEnterPlayer': '辨識到新歌時開啟全螢幕歌詞頁',
    'setting.preferredProvider': '指定音源 ID（留空用目前音源）',
    'cmd.toggleSync': '開/關麥克風持續同步歌詞',
    'cmd.nudgeForward': '同步時間軸 +0.5 秒',
    'cmd.nudgeBackward': '同步時間軸 -0.5 秒',
    'btn.syncActiveTitle': '持續辨識同步中（點擊停止）',
    'btn.syncIdleTitle': '開啟麥克風即時辨識同步歌詞',
    'mic.panelTitle': '麥克風裝置選擇與即時測試',
    'mic.systemDefault': '系統預設麥克風',
    'mic.defaultTag': '預設',
    'mic.rescan': '重新掃描',
    'mic.scanning': '掃描中...',
    'mic.noneFound': '未偵測到麥克風硬體裝置',
    'mic.scanFailed': '掃描麥克風失敗：{error}',
    'mic.testStart': '測試麥克風',
    'mic.testStop': '停止測試',
    'mic.levelIdle': '未測試',
    'mic.levelStopped': '已停止',
    'mic.levelOpening': '開啟中...',
    'mic.levelFailed': '啟動失敗',
    'mic.levelSilent': '無聲音',
    'mic.levelPercent': '音量 {pct}%',
    'panel.pollIntervalLabel': '辨識間隔（5–300 秒，建議 30 秒以避免 429 限流）',
    'panel.pauseUntilSongEndLabel': '播放完畢前不重複辨識（等目前歌曲播完再繼續，關閉可定期校準時間軸）',
    'panel.driftThresholdLabel': '自動校正時間軸門檻（0.5–15 秒）',
    'panel.offsetAdjustLabel': '手動時間軸微調（-5 到 +5 秒）',
    'panel.preferredProviderLabel': '指定音源 ID（留空用目前音源）',
    'panel.autoMuteLabel': '同步時自動靜音 Folia',
    'panel.autoEnterPlayerLabel': '辨識到新歌時自動開啟全螢幕歌詞頁',
    'panel.logTitle': '即時辨識與環境安裝日誌',
    'panel.updatePkg': '立即檢查／更新 Python 套件',
    'panel.updatingPkg': '更新中...',
    'panel.resetDefaults': '恢復預設值',
    'toast.noCurrentSong': '目前沒有正在顯示的歌曲',
    'toast.timelineNudged': '時間軸已微調 {sign}{sec} 秒',
    'toast.synced': '已同步：{track} ({time})',
    'toast.starting': '正在啟動麥克風辨識（首次會自動安裝套件）...',
    'toast.startFailed': '啟動失敗：{error}',
    'toast.stopped': '已停止麥克風聽歌同步',
    'toast.pkgUpdated': 'Python 套件已更新至最新版本',
    'toast.pkgUpdateFailed': '更新失敗：{error}',
    'log.resumeAfterSongEnd': '歌曲已播放完畢，繼續麥克風辨識',
    'log.resumeOptionDisabled': '已關閉「播畢前不重複辨識」，恢復定期辨識',
    'warn.requireFolium': '此模組需要 Folium 1.7 以上版本 (folium.omni / folium.rpc)'
  },
  'zh-CN': {
    'section.label': '麦克风听歌同步',
    'section.description': '自动创建隔离 Python 环境并更新识别套件，通过麦克风持续听歌并同步显示 Folia 原生歌词。',
    'setting.language': '界面语言 / Language',
    'setting.language.auto': '自动检测（跟随系统）',
    'setting.language.zh-TW': '繁體中文',
    'setting.language.zh-CN': '简体中文',
    'setting.language.ja': '日本語',
    'setting.language.en': 'English',
    'setting.micDeviceId': '麦克风设备 ID',
    'setting.pollIntervalSec': '识别间隔（秒，建议 30 秒）',
    'setting.pauseUntilSongEnd': '播放完毕前不重复识别（等播完再继续）',
    'setting.driftThresholdSec': '自动校准时间轴阈值（秒）',
    'setting.offsetAdjustSec': '手动时间轴微调（秒）',
    'setting.autoMute': '同步时自动静音 Folia',
    'setting.autoEnterPlayer': '识别到新歌时打开全屏歌词页',
    'setting.preferredProvider': '指定音源 ID（留空用当前音源）',
    'cmd.toggleSync': '开/关麦克风持续同步歌词',
    'cmd.nudgeForward': '同步时间轴 +0.5 秒',
    'cmd.nudgeBackward': '同步时间轴 -0.5 秒',
    'btn.syncActiveTitle': '持续识别同步中（点击停止）',
    'btn.syncIdleTitle': '开启麦克风实时识别同步歌词',
    'mic.panelTitle': '麦克风设备选择与实时测试',
    'mic.systemDefault': '系统默认麦克风',
    'mic.defaultTag': '默认',
    'mic.rescan': '重新扫描',
    'mic.scanning': '扫描中...',
    'mic.noneFound': '未检测到麦克风硬件设备',
    'mic.scanFailed': '扫描麦克风失败：{error}',
    'mic.testStart': '测试麦克风',
    'mic.testStop': '停止测试',
    'mic.levelIdle': '未测试',
    'mic.levelStopped': '已停止',
    'mic.levelOpening': '打开中...',
    'mic.levelFailed': '启动失败',
    'mic.levelSilent': '无声音',
    'mic.levelPercent': '音量 {pct}%',
    'panel.pollIntervalLabel': '识别间隔（5–300 秒，建议 30 秒以避免 429 限流）',
    'panel.pauseUntilSongEndLabel': '播放完毕前不重复识别（等当前歌曲播完再继续，关闭可定期校准时间轴）',
    'panel.driftThresholdLabel': '自动校准时间轴阈值（0.5–15 秒）',
    'panel.offsetAdjustLabel': '手动时间轴微调（-5 到 +5 秒）',
    'panel.preferredProviderLabel': '指定音源 ID（留空用当前音源）',
    'panel.autoMuteLabel': '同步时自动静音 Folia',
    'panel.autoEnterPlayerLabel': '识别到新歌时自动打开全屏歌词页',
    'panel.logTitle': '实时识别与环境安装日志',
    'panel.updatePkg': '立即检查／更新 Python 套件',
    'panel.updatingPkg': '更新中...',
    'panel.resetDefaults': '恢复默认值',
    'toast.noCurrentSong': '当前没有正在显示的歌曲',
    'toast.timelineNudged': '时间轴已微调 {sign}{sec} 秒',
    'toast.synced': '已同步：{track} ({time})',
    'toast.starting': '正在启动麦克风识别（首次会自动安装套件）...',
    'toast.startFailed': '启动失败：{error}',
    'toast.stopped': '已停止麦克风听歌同步',
    'toast.pkgUpdated': 'Python 套件已更新至最新版本',
    'toast.pkgUpdateFailed': '更新失败：{error}',
    'log.resumeAfterSongEnd': '歌曲已播放完毕，继续麦克风识别',
    'log.resumeOptionDisabled': '已关闭「播毕前不重复识别」，恢复定期识别',
    'warn.requireFolium': '此模块需要 Folium 1.7 以上版本 (folium.omni / folium.rpc)'
  },
  ja: {
    'section.label': 'マイク歌詞同期',
    'section.description': 'Python仮想環境を自動構築・更新し、マイクから楽曲を認識してFoliaの歌詞をリアルタイム同期します。',
    'setting.language': '表示言語 / Language',
    'setting.language.auto': '自動検出（システム設定に従う）',
    'setting.language.zh-TW': '繁體中文',
    'setting.language.zh-CN': '简体中文',
    'setting.language.ja': '日本語',
    'setting.language.en': 'English',
    'setting.micDeviceId': 'マイクデバイス ID',
    'setting.pollIntervalSec': '認識間隔（秒・推奨 30 秒）',
    'setting.pauseUntilSongEnd': '再生終了まで再認識しない（終了後に再開）',
    'setting.driftThresholdSec': '自動タイムライン補正しきい値（秒）',
    'setting.offsetAdjustSec': '手動タイムライン微調整（秒）',
    'setting.autoMute': '同期時に Folia を自動ミュート',
    'setting.autoEnterPlayer': '新しい曲を認識したら全画面歌詞を開く',
    'setting.preferredProvider': '音源 ID を指定（空欄で現在の音源を使用）',
    'cmd.toggleSync': 'マイク歌詞同期のオン／オフ',
    'cmd.nudgeForward': '同期タイムライン +0.5 秒',
    'cmd.nudgeBackward': '同期タイムライン -0.5 秒',
    'btn.syncActiveTitle': 'マイク認識同期中（クリックで停止）',
    'btn.syncIdleTitle': 'マイクリアルタイム歌詞同期を開始',
    'mic.panelTitle': 'マイクデバイス選択とリアルタイムテスト',
    'mic.systemDefault': 'システム既定のマイク',
    'mic.defaultTag': '既定',
    'mic.rescan': '再スキャン',
    'mic.scanning': 'スキャン中...',
    'mic.noneFound': 'マイクハードウェアが検出されませんでした',
    'mic.scanFailed': 'マイクスキャンに失敗しました：{error}',
    'mic.testStart': 'マイクテスト',
    'mic.testStop': 'テスト停止',
    'mic.levelIdle': '未テスト',
    'mic.levelStopped': '停止済み',
    'mic.levelOpening': '起動中...',
    'mic.levelFailed': '起動失敗',
    'mic.levelSilent': '無音',
    'mic.levelPercent': '音量 {pct}%',
    'panel.pollIntervalLabel': '認識間隔（5–300 秒・429 レート制限回避のため 30 秒推奨）',
    'panel.pauseUntilSongEndLabel': '曲が終わるまで再認識しない（オフにすると定期的に時刻を補正します）',
    'panel.driftThresholdLabel': '自動タイムライン補正しきい値（0.5–15 秒）',
    'panel.offsetAdjustLabel': '手動タイムライン微調整（-5 〜 +5 秒）',
    'panel.preferredProviderLabel': '音源 ID を指定（空欄で現在の音源を使用）',
    'panel.autoMuteLabel': '同期時に Folia を自動ミュート',
    'panel.autoEnterPlayerLabel': '新しい曲を認識したら自動で全画面歌詞を開く',
    'panel.logTitle': 'リアルタイム認識・環境セットアップログ',
    'panel.updatePkg': 'Python パッケージを確認／更新',
    'panel.updatingPkg': '更新中...',
    'panel.resetDefaults': '既定値に戻す',
    'toast.noCurrentSong': '現在表示中の曲はありません',
    'toast.timelineNudged': 'タイムラインを {sign}{sec} 秒調整しました',
    'toast.synced': '同期完了：{track} ({time})',
    'toast.starting': 'マイク認識を起動しています（初回はパッケージを自動インストールします）...',
    'toast.startFailed': '起動失敗：{error}',
    'toast.stopped': 'マイク歌詞同期を停止しました',
    'toast.pkgUpdated': 'Python パッケージを最新版に更新しました',
    'toast.pkgUpdateFailed': '更新失敗：{error}',
    'log.resumeAfterSongEnd': '再生が終了したため、マイク認識を再開します',
    'log.resumeOptionDisabled': '「再生終了まで再認識しない」がオフになったため、定期認識を再開します',
    'warn.requireFolium': 'このモジュールには Folium 1.7 以上が必要です (folium.omni / folium.rpc)'
  },
  en: {
    'section.label': 'Mic Lyric Sync',
    'section.description': 'Auto-provision Python venv/packages and sync Folia lyrics via microphone.',
    'setting.language': 'Language / 語言',
    'setting.language.auto': 'Auto-detect (System)',
    'setting.language.zh-TW': '繁體中文',
    'setting.language.zh-CN': '简体中文',
    'setting.language.ja': '日本語',
    'setting.language.en': 'English',
    'setting.micDeviceId': 'Microphone Device ID',
    'setting.pollIntervalSec': 'Recognition Interval (s, 30s recommended)',
    'setting.pauseUntilSongEnd': 'Pause Recognition Until Song Ends',
    'setting.driftThresholdSec': 'Drift Seek Threshold (s)',
    'setting.offsetAdjustSec': 'Manual Offset (s)',
    'setting.autoMute': 'Auto-mute Folia',
    'setting.autoEnterPlayer': 'Open Player on New Song',
    'setting.preferredProvider': 'Provider ID (optional)',
    'cmd.toggleSync': 'Toggle Mic Lyric Sync',
    'cmd.nudgeForward': 'Sync Timeline +0.5s',
    'cmd.nudgeBackward': 'Sync Timeline -0.5s',
    'btn.syncActiveTitle': 'Mic lyric sync active (click to stop)',
    'btn.syncIdleTitle': 'Start live microphone lyric sync',
    'mic.panelTitle': 'Microphone Device & Live Test',
    'mic.systemDefault': 'System Default Microphone',
    'mic.defaultTag': 'Default',
    'mic.rescan': 'Rescan',
    'mic.scanning': 'Scanning...',
    'mic.noneFound': 'No microphone hardware devices detected',
    'mic.scanFailed': 'Failed to scan microphones: {error}',
    'mic.testStart': 'Test Mic',
    'mic.testStop': 'Stop Test',
    'mic.levelIdle': 'Idle',
    'mic.levelStopped': 'Stopped',
    'mic.levelOpening': 'Opening...',
    'mic.levelFailed': 'Failed',
    'mic.levelSilent': 'Silent',
    'mic.levelPercent': 'Level {pct}%',
    'panel.pollIntervalLabel': 'Recognition Interval (5–300s, 30s recommended to avoid 429 rate limits)',
    'panel.pauseUntilSongEndLabel': 'Pause recognition until current song ends (disable for periodic drift correction)',
    'panel.driftThresholdLabel': 'Auto Drift Seek Threshold (0.5–15s)',
    'panel.offsetAdjustLabel': 'Manual Timeline Offset (-5 to +5s)',
    'panel.preferredProviderLabel': 'Provider ID (leave blank for active provider)',
    'panel.autoMuteLabel': 'Auto-mute Folia while syncing',
    'panel.autoEnterPlayerLabel': 'Open full-screen lyrics when a new song is recognized',
    'panel.logTitle': 'Live Recognition & Environment Logs',
    'panel.updatePkg': 'Check / Update Python Packages',
    'panel.updatingPkg': 'Updating...',
    'panel.resetDefaults': 'Reset Defaults',
    'toast.noCurrentSong': 'No song is currently displayed',
    'toast.timelineNudged': 'Timeline adjusted by {sign}{sec}s',
    'toast.synced': 'Synced: {track} ({time})',
    'toast.starting': 'Starting mic recognition (installing packages on first run)...',
    'toast.startFailed': 'Start failed: {error}',
    'toast.stopped': 'Mic lyric sync stopped',
    'toast.pkgUpdated': 'Python packages updated to the latest version',
    'toast.pkgUpdateFailed': 'Update failed: {error}',
    'log.resumeAfterSongEnd': 'Song ended; resuming microphone recognition',
    'log.resumeOptionDisabled': 'Disabled "Pause Until Song Ends"; resuming periodic recognition',
    'warn.requireFolium': 'This module requires Folium 1.7+ (folium.omni / folium.rpc)'
  }
};

export function normalizeLocale(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const s = raw.trim().toLowerCase().replace(/_/g, '-');
  if (!s || s === 'auto') return '';
  if (s === 'zh-tw' || s === 'zh-hk' || s === 'zh-mo' || s.startsWith('zh-hant')) return 'zh-TW';
  if (s === 'zh-cn' || s === 'zh-sg' || s.startsWith('zh-hans') || s === 'zh') return 'zh-CN';
  if (s === 'ja' || s.startsWith('ja-')) return 'ja';
  if (s === 'en' || s.startsWith('en-')) return 'en';
  return '';
}

export function resolveLocale(preferred, folium) {
  const direct = normalizeLocale(preferred);
  if (direct) return direct;

  const candidates = [
    typeof folium?.ui?.getLocale === 'function' ? folium.ui.getLocale() : '',
    folium?.env?.locale,
    folium?.host?.locale,
    typeof globalThis.navigator !== 'undefined' ? globalThis.navigator.language : '',
    typeof globalThis.navigator !== 'undefined' && Array.isArray(globalThis.navigator.languages)
      ? globalThis.navigator.languages[0]
      : ''
  ];

  for (const c of candidates) {
    const matched = normalizeLocale(c);
    if (matched) return matched;
  }
  return DEFAULT_LOCALE;
}

export function t(locale, key, params = {}) {
  const loc = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  const template = TRANSLATIONS[loc]?.[key] ?? TRANSLATIONS[DEFAULT_LOCALE]?.[key] ?? TRANSLATIONS.en?.[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] !== undefined ? String(params[name]) : `{${name}}`));
}

export function getLocaleMap(key) {
  const map = {};
  for (const loc of SUPPORTED_LOCALES) {
    map[loc] = TRANSLATIONS[loc][key];
  }
  return map;
}

export function formatSystemDefaultMicLabel(defaultDevice, locale) {
  const sysDefaultText = t(locale, 'mic.systemDefault');
  if (!defaultDevice) return sysDefaultText;
  const deviceName = String(defaultDevice.raw_name || defaultDevice.name || '').trim();
  if (!deviceName) return sysDefaultText;
  return `${deviceName} (${sysDefaultText})`;
}

export function formatMicOptionLabel(dev, locale) {
  const name = String(dev?.name || dev?.raw_name || `Device ${dev?.id ?? ''}`).trim();
  const suffix = dev?.is_default ? ` (${t(locale, 'mic.defaultTag')})` : '';
  return `[${dev?.id}] ${name}${suffix}`;
}
