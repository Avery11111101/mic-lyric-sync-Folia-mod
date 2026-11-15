"""
內建於 Folium 模組內的 Python 麥克風即時辨識 Worker（透過 stdin/stdout NDJSON 與 index.cjs 通訊）
依賴：pip install shazamio sounddevice numpy
"""

import asyncio
from collections import deque
import io
import json
import math
import sys
import threading
import time
import wave
from aiohttp_retry import ExponentialRetry
import numpy as np
import sounddevice as sd
from shazamio import HTTPClient, Serialize, Shazam

SAMPLE_RATE = 44100
WINDOW_SEC = 12.0        # ShazamIO 0.9+ 建議的 12 秒最佳辨識視窗
POLL_INTERVAL_SEC = 8.0  # 避免觸發 Shazam 429 限流的預設間隔
RECOGNIZE_TIMEOUT = 15.0
MIN_RMS = 0.0008
MAX_SKEW = 0.02


def emit(obj: dict) -> None:
    try:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except OSError:
        pass


def emit_log(level: str, text: str) -> None:
    emit({"type": "log", "level": level, "text": text})


def list_input_devices() -> list[dict]:
    devices = sd.query_devices()
    hostapis = sd.query_hostapis()
    default_in = sd.default.device[0]
    result = []
    for idx, dev in enumerate(devices):
        if dev["max_input_channels"] > 0:
            api_name = hostapis[dev["hostapi"]]["name"]
            result.append(
                {
                    "id": idx,
                    "name": f"{dev['name']} ({api_name})",
                    "is_default": idx == default_in,
                }
            )
    return result


class WorkerEngine:
    def __init__(self) -> None:
        self.device_id: int | None = None
        self.samplerate = SAMPLE_RATE
        self.stream_latency = 0.0
        self.max_samples = int(self.samplerate * (WINDOW_SEC + 2))
        self._lock = threading.Lock()
        self._chunks: deque[np.ndarray] = deque()
        self._total_samples = 0
        self.stream: sd.InputStream | None = None
        self.latest_peak = 0.0
        self.latest_rms = 0.0
        self.sync_active = False
        self.test_active = False
        self.should_quit = False

    def _audio_callback(self, indata: np.ndarray, frames: int, _time_info, status) -> None:
        mono = indata[:, 0].copy() if indata.ndim > 1 else indata.copy()
        n = len(mono)
        if n == 0:
            return
        self.latest_peak = float(np.max(np.abs(mono)))
        self.latest_rms = float(np.sqrt(np.mean(mono * mono)))

        if self.sync_active:
            with self._lock:
                self._chunks.append(mono)
                self._total_samples += n
                while self._total_samples > self.max_samples and self._chunks:
                    dropped = self._chunks.popleft()
                    self._total_samples -= len(dropped)

    def ensure_stream(self) -> None:
        if self.stream is not None:
            return
        dev_info = sd.query_devices(self.device_id, kind="input")
        self.samplerate = int(dev_info.get("default_samplerate") or SAMPLE_RATE)
        self.max_samples = int(self.samplerate * (WINDOW_SEC + 2))
        with self._lock:
            self._chunks.clear()
            self._total_samples = 0

        self.stream = sd.InputStream(
            device=self.device_id,
            channels=1,
            samplerate=self.samplerate,
            dtype="float32",
            callback=self._audio_callback,
        )
        self.stream.start()
        self.stream_latency = float(getattr(self.stream, "latency", 0.0) or 0.0)
        emit_log("INFO", f"麥克風已開啟：[{self.device_id}] {dev_info['name']} ({self.samplerate}Hz, 緩衝延遲={self.stream_latency*1000:.0f}ms)")

    def stop_stream_if_idle(self) -> None:
        if not self.sync_active and not self.test_active and self.stream is not None:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None
            emit_log("INFO", "麥克風串流已暫停")

    def select_mic(self, device_id: int | None) -> None:
        self.device_id = device_id
        if self.stream is not None:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None
        if self.sync_active or self.test_active:
            self.ensure_stream()

    def snapshot_wav(self) -> tuple[bytes, float, float, float, float] | None:
        with self._lock:
            if self._total_samples < int(self.samplerate * 4.5):
                return None
            merged = np.concatenate(list(self._chunks))
            snapshot_mono = time.monotonic()

        needed = int(self.samplerate * WINDOW_SEC)
        samples = merged[-needed:].copy() if len(merged) > needed else merged
        duration = len(samples) / self.samplerate

        samples -= float(np.mean(samples))
        rms = float(np.sqrt(np.mean(samples * samples)))
        peak = float(np.max(np.abs(samples)))
        peak_db = 20.0 * math.log10(max(peak, 1e-6))

        if rms < MIN_RMS:
            return b"", duration, rms, peak_db, snapshot_mono

        gain = min(25.0, 0.88 / max(peak, 1e-6))
        pcm16 = (np.clip(samples * gain, -1.0, 1.0) * 32767.0).astype(np.int16)

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.samplerate)
            wf.writeframes(pcm16.tobytes())
        return buf.getvalue(), duration, rms, peak_db, snapshot_mono


async def level_loop(engine: WorkerEngine) -> None:
    while not engine.should_quit:
        if engine.test_active and engine.stream is not None:
            emit({"type": "level", "peak": round(engine.latest_peak, 4), "rms": round(engine.latest_rms, 4)})
        await asyncio.sleep(0.15)


async def recognition_loop(engine: WorkerEngine) -> None:
    round_id = 0
    # 不在底層靜默重試 429，讓 RateLimited 立刻浮出以便記錄並冷卻
    client = HTTPClient(
        retry_options=ExponentialRetry(
            attempts=2,
            start_timeout=1.0,
            max_timeout=3.0,
            statuses={500, 502, 503, 504},
        )
    )
    async with Shazam(http_client=client) as shazam:
        while not engine.should_quit:
            if not engine.sync_active:
                await asyncio.sleep(0.3)
                continue

            snap = engine.snapshot_wav()
            if snap is None:
                await asyncio.sleep(1.0)
                continue

            round_id += 1
            wav_bytes, duration, rms, peak_db, snapshot_mono = snap
            if not wav_bytes:
                emit_log("INFO", f"#{round_id} 環境安靜 (RMS={rms:.5f}, Peak={peak_db:.1f}dBFS)，等待音樂中...")
                await asyncio.sleep(POLL_INTERVAL_SEC)
                continue

            emit_log("INFO", f"#{round_id} 開始辨識 | 時長={duration:.1f}s, RMS={rms:.4f}, Peak={peak_db:.1f}dBFS")
            t0 = time.perf_counter()
            try:
                raw_out = await asyncio.wait_for(shazam.recognize(wav_bytes), timeout=RECOGNIZE_TIMEOUT)
                serialized = Serialize.full_track(raw_out)
            except asyncio.TimeoutError:
                emit_log("WARN", f"#{round_id} ShazamIO 網路請求逾時（>{RECOGNIZE_TIMEOUT}s，請檢查網路或代理設定）")
                await asyncio.sleep(POLL_INTERVAL_SEC)
                continue
            except Exception as exc:
                err_name = type(exc).__name__
                if "RateLimited" in err_name or "429" in str(exc):
                    emit_log("WARN", f"#{round_id} 觸發 Shazam 429 限流，自動冷卻 20 秒後再試...")
                    await asyncio.sleep(20.0)
                else:
                    emit_log("ERROR", f"#{round_id} 辨識錯誤 ({err_name})：{exc}")
                    await asyncio.sleep(POLL_INTERVAL_SEC)
                continue

            elapsed_ms = (time.perf_counter() - t0) * 1000
            track = serialized.track
            matches = serialized.matches or []

            if not track or not matches:
                emit_log("INFO", f"#{round_id} 未比對到歌曲 | 耗時={elapsed_ms:.0f}ms, retry_ms={serialized.retry_ms}")
                await asyncio.sleep(POLL_INTERVAL_SEC)
                continue

            best = matches[0]
            t_skew = float(best.time_skew or 0.0)
            f_skew = float(best.frequency_skew or 0.0)
            if abs(t_skew) > MAX_SKEW or abs(f_skew) > MAX_SKEW:
                emit_log("WARN", f"#{round_id} 忽略高偏差匹配 (time_skew={t_skew:.4f}, freq_skew={f_skew:.4f})")
                await asyncio.sleep(POLL_INTERVAL_SEC)
                continue

            offset_sec = float(best.offset or 0.0)
            live_pos = offset_sec + duration + (time.monotonic() - snapshot_mono) + engine.stream_latency
            title = track.title or ""
            artist = track.subtitle or ""

            emit_log(
                "INFO",
                f"#{round_id} 辨識成功 | {title} - {artist} | 現場進度={live_pos:.2f}s | "
                f"耗時={elapsed_ms:.0f}ms, skew=({t_skew:.4f}, {f_skew:.4f})",
            )
            emit(
                {
                    "type": "state",
                    "ok": True,
                    "title": title,
                    "artist": artist,
                    "position_sec": round(live_pos, 3),
                    "updated_at_ms": int(time.time() * 1000),
                    "elapsed_ms": round(elapsed_ms),
                }
            )
            await asyncio.sleep(POLL_INTERVAL_SEC)


def stdin_reader(loop: asyncio.AbstractEventLoop, engine: WorkerEngine) -> None:
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        try:
            msg = json.loads(raw)
        except Exception:
            continue

        def handle(m=msg):
            cmd = m.get("cmd")
            if cmd == "list_mics":
                emit({"type": "mics", "current_device_id": engine.device_id, "devices": list_input_devices()})
            elif cmd == "select_mic":
                engine.select_mic(m.get("device_id"))
            elif cmd == "set_test":
                engine.test_active = bool(m.get("enabled"))
                if engine.test_active:
                    engine.ensure_stream()
                else:
                    engine.stop_stream_if_idle()
            elif cmd == "start_sync":
                engine.sync_active = True
                engine.ensure_stream()
                emit_log("INFO", "開始收集麥克風滑動視窗音訊...")
            elif cmd == "stop_sync":
                engine.sync_active = False
                engine.stop_stream_if_idle()
            elif cmd == "quit":
                engine.should_quit = True
                engine.sync_active = False
                engine.test_active = False
                engine.stop_stream_if_idle()

        loop.call_soon_threadsafe(handle)


async def main() -> None:
    engine = WorkerEngine()
    loop = asyncio.get_running_loop()
    emit({"type": "mics", "current_device_id": engine.device_id, "devices": list_input_devices()})
    threading.Thread(target=stdin_reader, args=(loop, engine), daemon=True).start()
    await asyncio.gather(recognition_loop(engine), level_loop(engine))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
