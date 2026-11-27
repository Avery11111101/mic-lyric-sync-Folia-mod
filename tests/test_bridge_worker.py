import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np


def load_bridge_worker():
    """以假套件替換音訊與網路相依模組，純粹測試 Worker 核心邏輯。"""
    fake_sd = types.ModuleType("sounddevice")
    fake_sd.query_devices = lambda *args, **kwargs: []
    fake_sd.query_hostapis = lambda: []
    fake_sd.default = types.SimpleNamespace(device=[0, 0])

    fake_retry = types.ModuleType("aiohttp_retry")
    fake_retry.ExponentialRetry = lambda **kwargs: kwargs

    fake_shazamio = types.ModuleType("shazamio")
    fake_shazamio.HTTPClient = lambda **kwargs: None
    fake_shazamio.Serialize = types.SimpleNamespace(full_track=lambda x: x)
    fake_shazamio.Shazam = lambda **kwargs: None

    worker_path = Path(__file__).resolve().parent.parent / "mic-lyric-sync" / "bridge_worker.py"
    with patch.dict(
        sys.modules,
        {
            "sounddevice": fake_sd,
            "aiohttp_retry": fake_retry,
            "shazamio": fake_shazamio,
        },
    ):
        spec = importlib.util.spec_from_file_location("bridge_worker_test", worker_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module


bw = load_bridge_worker()


class TestBridgeWorker(unittest.TestCase):
    def test_default_and_clamp_poll_interval(self):
        self.assertEqual(bw.DEFAULT_POLL_INTERVAL_SEC, 30.0)
        self.assertEqual(bw.POLL_INTERVAL_SEC, 30.0)
        self.assertEqual(bw.clamp_poll_interval(30), 30.0)
        self.assertEqual(bw.clamp_poll_interval(1), 5.0)
        self.assertEqual(bw.clamp_poll_interval(999), 300.0)
        self.assertEqual(bw.clamp_poll_interval("abc"), 30.0)
        self.assertEqual(bw.clamp_poll_interval(True), 30.0)
        self.assertEqual(bw.clamp_poll_interval(float("nan")), 30.0)
        self.assertEqual(bw.clamp_poll_interval(float("inf")), 30.0)

    def test_pause_prevents_audio_buffering_and_clears_buffer(self):
        engine = bw.WorkerEngine()
        engine.sync_active = True

        samples = np.ones((1024, 1), dtype=np.float32) * 0.2
        engine._audio_callback(samples, 1024, None, None)
        self.assertEqual(engine._total_samples, 1024)

        with patch.object(bw, "emit_log"):
            engine.set_recognition_paused(True)
        self.assertTrue(engine.recognition_paused)
        self.assertEqual(engine._total_samples, 0)

        # 暫停期間不累積音訊緩衝，避免恢復時混入舊歌尾奏
        engine._audio_callback(samples, 1024, None, None)
        self.assertEqual(engine._total_samples, 0)

        with patch.object(bw, "emit_log"):
            engine.set_recognition_paused(False)
        self.assertFalse(engine.recognition_paused)
        engine._audio_callback(samples, 1024, None, None)
        self.assertEqual(engine._total_samples, 1024)

    def test_interruptible_sleep_wakes_immediately(self):
        async def run():
            engine = bw.WorkerEngine()
            engine.ensure_wake_event()

            async def wake_soon():
                await asyncio.sleep(0.03)
                engine.wake()

            t0 = asyncio.get_running_loop().time()
            await asyncio.gather(bw.interruptible_sleep(engine, 10.0), wake_soon())
            elapsed = asyncio.get_running_loop().time() - t0
            self.assertLess(elapsed, 1.0)

        asyncio.run(run())

    def test_list_input_devices_and_refresh(self):
        calls = []
        fake_devices = [
            {"name": "Speakers (Realtek)", "max_input_channels": 0, "hostapi": 0},
            {"name": "麥克風 (Realtek(R) Audio)", "max_input_channels": 2, "hostapi": 0},
            {"name": "USB Condenser Mic", "max_input_channels": 1, "hostapi": 1},
        ]
        fake_hostapis = [
            {"name": "MME", "default_input_device": 1},
            {"name": "Windows WASAPI", "default_input_device": 2},
        ]

        with (
            patch.object(bw.sd, "query_devices", return_value=fake_devices),
            patch.object(bw.sd, "query_hostapis", return_value=fake_hostapis),
            patch.object(bw.sd, "default", types.SimpleNamespace(device=(1, 0))),
            patch.object(bw.sd, "_terminate", lambda: calls.append("term"), create=True),
            patch.object(bw.sd, "_initialize", lambda: calls.append("init"), create=True),
        ):
            res = bw.list_input_devices(refresh=True)

        self.assertEqual(calls, ["term", "init"])
        self.assertEqual(len(res), 2)
        self.assertEqual(res[0]["id"], 1)
        self.assertEqual(res[0]["raw_name"], "麥克風 (Realtek(R) Audio)")
        self.assertEqual(res[0]["name"], "麥克風 (Realtek(R) Audio) (MME)")
        self.assertTrue(res[0]["is_default"])
        self.assertEqual(res[1]["id"], 2)
        self.assertFalse(res[1]["is_default"])

    def test_list_input_devices_handles_invalid_default_and_query_error(self):
        fake_devices = [{"name": "Line In", "max_input_channels": 2, "hostapi": 0}]
        fake_hostapis = [{"name": "MME", "default_input_device": 0}]

        with (
            patch.object(bw.sd, "query_devices", return_value=fake_devices),
            patch.object(bw.sd, "query_hostapis", return_value=fake_hostapis),
            patch.object(bw.sd, "default", types.SimpleNamespace(device=None)),
        ):
            res = bw.list_input_devices(refresh=False)
        self.assertEqual(len(res), 1)
        self.assertTrue(res[0]["is_default"])

        with (
            patch.object(bw.sd, "query_devices", side_effect=RuntimeError("PortAudio error")),
            patch.object(bw, "emit_log") as mock_log,
        ):
            res_err = bw.list_input_devices(refresh=False)
        self.assertEqual(res_err, [])
        mock_log.assert_called_once()

    def test_ensure_stream_falls_back_from_mme_error_to_wasapi(self):
        fake_devices = [
            {"name": "Microphone (USB)", "max_input_channels": 2, "default_samplerate": 44100.0, "hostapi": 0},
            {"name": "Microphone (USB)", "max_input_channels": 2, "default_samplerate": 48000.0, "hostapi": 1},
        ]
        fake_hostapis = [
            {"name": "MME", "default_input_device": 0},
            {"name": "Windows WASAPI", "default_input_device": 1},
        ]
        attempts = []

        class FakeStream:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
                self.latency = 0.02
                self.closed = False

            def start(self):
                attempts.append((self.kwargs["device"], self.kwargs["channels"], self.kwargs["samplerate"]))
                if self.kwargs["device"] == 0:
                    raise RuntimeError("Error opening InputStream: Unanticipated host error [PaErrorCode -9999] [MME error 11]")

            def close(self):
                self.closed = True

        engine = bw.WorkerEngine()
        with (
            patch.object(bw.sd, "query_devices", return_value=fake_devices),
            patch.object(bw.sd, "query_hostapis", return_value=fake_hostapis),
            patch.object(bw.sd, "default", types.SimpleNamespace(device=(0, 0))),
            patch.object(bw.sd, "InputStream", side_effect=lambda **kw: FakeStream(**kw), create=True),
            patch.object(bw, "emit_log") as mock_log,
        ):
            engine.ensure_stream()

        self.assertIsNotNone(engine.stream)
        self.assertEqual(engine.stream.kwargs["device"], 1)
        self.assertEqual(engine.samplerate, 48000)
        self.assertTrue(any(dev == 0 for dev, _, _ in attempts))
        self.assertEqual(attempts[-1], (1, 1, 48000))
        mock_log.assert_called_once()

    def test_ensure_stream_refreshes_portaudio_and_raises_clear_error_when_all_fail(self):
        fake_devices = [
            {"name": "Mic", "max_input_channels": 1, "default_samplerate": 44100.0, "hostapi": 0},
        ]
        fake_hostapis = [{"name": "MME", "default_input_device": 0}]
        closed_streams = []

        class FailingStream:
            def __init__(self, **_kwargs):
                pass

            def start(self):
                raise RuntimeError("MME error 11")

            def close(self):
                closed_streams.append(True)

        engine = bw.WorkerEngine()
        with (
            patch.object(bw.sd, "query_devices", return_value=fake_devices),
            patch.object(bw.sd, "query_hostapis", return_value=fake_hostapis),
            patch.object(bw.sd, "default", types.SimpleNamespace(device=(0, 0))),
            patch.object(bw.sd, "InputStream", side_effect=lambda **kw: FailingStream(**kw), create=True),
            patch.object(bw, "_refresh_portaudio") as mock_refresh,
        ):
            with self.assertRaises(RuntimeError) as ctx:
                engine.ensure_stream()

        self.assertIn("無法開啟麥克風輸入串流", str(ctx.exception))
        mock_refresh.assert_called_once()
        self.assertGreater(len(closed_streams), 0)

    def test_fast_and_full_window_snapshot(self):
        self.assertEqual(bw.FAST_WINDOW_SEC, 4.0)
        self.assertEqual(bw.FULL_WINDOW_SEC, 12.0)
        engine = bw.WorkerEngine()
        engine.sync_active = True
        self.assertTrue(engine.fast_window_mode)

        # 3.0 秒音訊：快速視窗（需 3.5s+）應回傳 None
        samples_3s = np.ones((int(engine.samplerate * 3.0), 1), dtype=np.float32) * 0.1
        engine._audio_callback(samples_3s, len(samples_3s), None, None)
        self.assertIsNone(engine.snapshot_wav())

        # 補到 4.0 秒音訊：快速視窗應成功回傳且 duration 為 4.0 秒
        samples_1s = np.ones((int(engine.samplerate * 1.0), 1), dtype=np.float32) * 0.1
        engine._audio_callback(samples_1s, len(samples_1s), None, None)
        snap_fast = engine.snapshot_wav()
        self.assertIsNotNone(snap_fast)
        self.assertAlmostEqual(snap_fast[1], 4.0, delta=0.05)

        # 切換為完整視窗（需 4.5s+）：目前 4.0s 應回傳 None
        engine.fast_window_mode = False
        self.assertIsNone(engine.snapshot_wav())

        # 補滿至 12 秒音訊：完整視窗應回傳 12.0 秒
        samples_8s = np.ones((int(engine.samplerate * 8.0), 1), dtype=np.float32) * 0.1
        engine._audio_callback(samples_8s, len(samples_8s), None, None)
        snap_full = engine.snapshot_wav()
        self.assertIsNotNone(snap_full)
        self.assertAlmostEqual(snap_full[1], 12.0, delta=0.05)

    def test_trigger_transition_resets_buffer_and_sets_fast_mode(self):
        engine = bw.WorkerEngine()
        engine.ensure_wake_event()
        engine.fast_window_mode = False
        samples = np.ones((2048, 1), dtype=np.float32) * 0.1
        engine.sync_active = True
        engine._audio_callback(samples, 2048, None, None)
        self.assertEqual(engine._total_samples, 2048)

        emitted = []
        with patch.object(bw, "emit", side_effect=lambda obj: emitted.append(obj)), patch.object(bw, "emit_log"):
            engine.trigger_transition(dip_duration=0.6)

        self.assertTrue(engine.fast_window_mode)
        self.assertEqual(engine._total_samples, 0)
        self.assertEqual(len(engine._chunks), 0)
        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0]["type"], "transition")
        self.assertEqual(emitted[0]["gap_sec"], 0.6)
        self.assertTrue(engine.ensure_wake_event().is_set())

    def test_audio_callback_detects_gap_transition(self):
        engine = bw.WorkerEngine()
        engine.sync_active = True
        engine.ensure_wake_event()

        clock = [100.0]

        def fake_mono():
            return clock[0]

        loud = np.ones((1024, 1), dtype=np.float32) * 0.08
        quiet = np.ones((1024, 1), dtype=np.float32) * 0.0001

        with patch.object(bw.time, "monotonic", side_effect=fake_mono):
            # 建立穩定的 long_rms
            for _ in range(80):
                clock[0] += 0.03
                engine._audio_callback(loud, 1024, None, None)

            self.assertGreater(engine._long_rms, 0.01)

            # 音訊中斷（靜音/掉落 0.5 秒）
            for _ in range(15):
                clock[0] += 0.035
                engine._audio_callback(quiet, 1024, None, None)

            self.assertIsNotNone(engine._dip_start_mono)

            # 音樂重新響起（切歌開頭）
            emitted = []
            with patch.object(bw, "emit", side_effect=lambda obj: emitted.append(obj)), patch.object(bw, "emit_log"):
                for _ in range(3):
                    clock[0] += 0.03
                    engine._audio_callback(loud, 1024, None, None)

            self.assertEqual(len(emitted), 1)
            self.assertEqual(emitted[0]["type"], "transition")
            self.assertTrue(engine.fast_window_mode)


if __name__ == "__main__":
    unittest.main()
