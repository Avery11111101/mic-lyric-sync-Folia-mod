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


if __name__ == "__main__":
    unittest.main()
