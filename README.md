# mic-lyric-sync — Folia 麥克風即時聽歌同步歌詞

為 [Folia](https://github.com/chthollyphile/folia-major)（Folium 1.7+）打造的即時聽歌識曲模組。透過麥克風接收環境音訊，自動辨識現場正在播放的歌曲，並同步驅動 Folia 播放器搜尋歌曲與對齊全螢幕歌詞進度。

## ✨ 核心功能

- **即時聽歌識曲與歌詞同步**：持續透過麥克風錄音辨識歌曲與當前播放秒數，自動於 Folia 搜尋並跳轉至對應時間軸顯示全螢幕歌詞。
- **零手動環境配置**：首次啟動會自動偵測系統 Python、建立專屬隔離虛擬環境（`venv`），並自動安裝與定期檢查更新所需套件（`shazamio`、`sounddevice`、`numpy`）。
- **智慧時間軸對齊**：支援硬體緩衝延遲補償、多輪辨識中位數平滑、自動漂移校正門檻，以及即時手動微調時間軸（`±0.5 秒`）。
- **內建麥克風測試與日誌面板**：可在模組設定頁面選擇指定麥克風裝置、測試即時收音音量條，並檢視即時辨識狀態與日誌。
- **防干擾播放控制**：同步時可自動靜音 Folia 原生音訊輸出，避免與現場聲音重疊。

---

## 📋 系統需求

- **Folia**：`>= 0.7.20`（需支援 Folium `1.7` 以上版本）
- **Python**：`3.10+`（Windows 安裝時請務必勾選 **Add Python to PATH**）
- **硬體與網路**：可用的麥克風輸入裝置，以及可連線至辨識服務的網路環境

---

## 🚀 安裝步驟

1. 前往 [Releases](../../releases) 下載最新版本的 `mic-lyric-sync-mod.zip`（或取得 `mic-lyric-sync` 模組資料夾）。
2. 在 Folia 中直接匯入 `mic-lyric-sync-mod.zip`，或將解壓縮後的整個 `mic-lyric-sync` 資料夾複製到 Folia 的模組目錄中：
   - **Windows 預設路徑**：`%APPDATA%\Folia\mods\mic-lyric-sync\`
   - 確認資料夾內包含 `mod.json`、`index.cjs`、`client.mjs`、`bridge_worker.py` 與 `requirements.txt`。
3. 重新啟動 Folia，並在設定／模組管理中確認已啟用 **「麥克風即時聽歌同步歌詞」**。

> [!NOTE]
> 首次開啟同步功能時，模組會自動在背景建立 Python 虛擬環境並安裝必要套件，可能需要數十秒至數分鐘，請留意設定面板中的日誌進度提示。

---

## 📖 使用說明

### 開啟與停止同步
- **播放器進度列**：點擊進度列右側的 **麥克風圖示** 按鈕即可開關即時同步。
- **指令面板**：搜尋並執行 `Toggle Mic Lyric Sync`（或 `开/关麦克风持续同步歌词`）。

### 微調時間軸
若歌詞顯示與現場音樂有細微快慢落差，可透過指令面板或全域快捷鍵即時調整：
- `Sync Timeline +0.5s`（時間軸 `+0.5 秒`）
- `Sync Timeline -0.5s`（時間軸 `-0.5 秒`）

### 模組設定項目

| 設定鍵 | 說明 | 預設值 |
| --- | --- | --- |
| `micDeviceId` | 指定麥克風輸入裝置 ID（留空則使用系統預設） | `""` |
| `pollIntervalSec` | 辨識間隔秒數（範圍 `5`～`300`，建議 `30` 秒） | `30` |
| `pauseUntilSongEnd` | 播放完畢前不重複辨識（等目前歌曲播完再繼續） | `true` |
| `driftThresholdSec` | 自動校正時間軸的誤差門檻（秒，範圍 `0.5`～`15`） | `5` |
| `offsetAdjustSec` | 固定手動時間軸偏移微調（秒，範圍 `-5`～`5`） | `0` |
| `autoMute` | 同步歌詞時自動將 Folia 播放器靜音 | `true` |
| `autoEnterPlayer` | 辨識到新歌曲時自動切換至全螢幕歌詞頁 | `true` |
| `preferredProvider` | 指定搜尋歌曲的音源 ID（留空則使用目前音源） | `""` |

---

## 🙏 致謝 (Acknowledgements)

- **[ShazamIO](https://github.com/shazamio/ShazamIO)**（[MIT License](https://github.com/shazamio/ShazamIO?tab=MIT-1-ov-file)）：感謝 ShazamIO 提供非同步 Python Shazam 音訊指紋辨識與時間軸偏移偵測核心能力，讓本模組得以實現即時聽歌識曲與歌詞同步對齊。

---

## 📝 更新日誌 (Changelog)

### v0.2
- 新增「辨識間隔（`5`–`300` 秒，建議 `30` 秒）」設定項目並將預設值調為 `30` 秒，大幅降低觸發 Shazam `429` 限流的機率。
- 新增「播放完畢前不重複辨識」設定項目（預設開啟），辨識成功並開始播放後暫停重複請求，待歌曲播放完畢或切換後自動恢復辨識；亦可手動關閉以定期校準時間軸。
- 改進 Python Worker 等待機制為可中斷休眠，確保長間隔下停止或恢復辨識仍可即時響應。
- 補齊 `client.mjs`、`index.cjs` 與 `bridge_worker.py` 三層參數驗證與邊界防護，並新增單元測試。

### v0.1
- 新增 GitHub Actions 自動封裝 `mic-lyric-sync-mod.zip` 與 Release 預發佈流程。
- 新增自動建立模組專屬隔離 Python 虛擬環境（`venv`）與每 7 天自動檢查更新套件機制。
- 新增設定面板內的麥克風裝置選單、即時音量測試條、即時辨識日誌框與手動更新套件按鈕。
- 優化時間軸同步演算法：加入硬體緩衝延遲補償、高偏差匹配過濾、5 輪中位數平滑與切歌後複查機制。
- 調整辨識視窗與限流處理策略，避免觸發 Shazam `429 RateLimited` 並提升錯誤回報可讀性。
- 修正 Windows 環境下停用或覆蓋模組時可能發生的 `EBUSY` 資料夾鎖定問題。
