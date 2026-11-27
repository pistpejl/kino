"""Unit tests for the LatentSync 1.5 / EchoMimic V3 helpers and worker wiring (no GPU, no torch, no downloads).

  python3 notebooks/test_kino_lipsync_engines.py
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kino_echomimic as em  # noqa: E402
import kino_latentsync as ls  # noqa: E402
import kino_venv as kv  # noqa: E402
import kino_worker as kw  # noqa: E402


class LatentSyncHelpers(unittest.TestCase):
    def test_fp16_on_turing(self):
        self.assertTrue(ls.use_fp16((7, 5)))       # T4
        self.assertTrue(ls.use_fp16((6, 0)) is False)  # P100: fp32
        self.assertFalse(ls.use_fp16((7, 5), force_fp32=True))
        self.assertFalse(ls.use_fp16(None))

    def test_scale_and_seconds(self):
        self.assertEqual(ls.scale_for(1920, 1080), (1280, 720))
        self.assertEqual(ls.scale_for(1081, 1921), (720, 1280))
        self.assertEqual(ls.scale_for(640, 360), (640, 360))
        self.assertEqual(ls.clip_seconds(45), 30.0)
        self.assertEqual(ls.clip_seconds(0), 4.0)
        self.assertEqual(ls.clip_seconds(0.3), 1.0)

    def test_fill_faces(self):
        self.assertEqual(ls.fill_faces([False, True, False, True, False]), [1, 1, 1, 3, 3])
        self.assertIsNone(ls.fill_faces([False, False]))
        self.assertEqual(ls.fill_faces([True]), [0])

    def test_prepare_cmd_still_and_video(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            img = d / "p.png"
            subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x96",
                                   "-frames:v", "1", str(img)])
            out = d / "still.mp4"
            subprocess.check_call(ls.ffmpeg_prepare_cmd(img, out, 1.2, True), timeout=60)
            self.assertAlmostEqual(ls._probe(out), 1.2, delta=0.1)
            src = d / "v.mp4"
            subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=128x72:d=3:r=30",
                                   "-pix_fmt", "yuv420p", str(src)])
            cut = d / "cut.mp4"
            subprocess.check_call(ls.ffmpeg_prepare_cmd(src, cut, 1.5, False, (64, 36)), timeout=60)
            self.assertAlmostEqual(ls._probe(cut), 1.5, delta=0.1)
            self.assertEqual(ls._probe_size(cut), (64, 36))

    def test_pins(self):
        self.assertIn("torch==2.5.1", ls.PIP_PACKAGES)
        self.assertEqual(ls.UNET_CONFIG, "configs/unet/stage2.yaml")
        self.assertEqual(ls.WEIGHTS_REPO, "ByteDance/LatentSync-1.5")


class EchoMimicHelpers(unittest.TestCase):
    def test_fits(self):
        self.assertTrue(em.fits(15360, 60)[0])
        self.assertFalse(em.fits(8192, 60)[0])
        self.assertFalse(em.fits(15360, 10)[0])
        self.assertTrue(em.fits(15360, 10, installed=True)[0])
        self.assertFalse(em.fits(0, 100)[0])

    def test_chunk_plan_covers_and_is_4k1(self):
        for total in (5, 50, 81, 82, 120, 250, 300):
            plan = em.chunk_plan(total)
            self.assertEqual(plan[0][0], 0)
            for (s, n) in plan:
                self.assertEqual((n - 1) % 4, 0, (total, plan))
                self.assertLessEqual(n, em.CHUNK)
            for (a, b) in zip(plan, plan[1:]):
                self.assertEqual(b[0], a[0] + a[1] - 1)  # one-frame overlap
            last = plan[-1]
            self.assertGreaterEqual(last[0] + last[1], total)
            # output after dropping overlaps
            self.assertGreaterEqual(sum(n for _, n in plan) - (len(plan) - 1), total)

    def test_frames_and_sizes(self):
        self.assertEqual(em.frames_for(4), 100)
        self.assertEqual(em.frames_for(40), em.MAX_SECONDS * 25)
        h, w = em.sample_hw(1080, 1920, 512 * 512)
        self.assertEqual((h % 16, w % 16), (0, 0))
        self.assertLessEqual(h * w, 512 * 512)
        self.assertGreater(h, w)
        self.assertEqual(em.output_size(672, 384, 720), (720, 1260))
        self.assertEqual(em.output_size(1024, 1024, 720), (1024, 1024))

    def test_weights_list(self):
        rels = [r for _, _, r, _ in em.WEIGHTS]
        self.assertIn("flash/transformer/diffusion_pytorch_model.safetensors", rels)
        self.assertIn(f"{em.BASE}/models_t5_umt5-xxl-enc-bf16.pth", rels)
        self.assertIn("chinese-wav2vec2-base/model.safetensors", rels)


class VenvHelpers(unittest.TestCase):
    def test_pick_home_skips_kaggle_working(self):
        with tempfile.TemporaryDirectory() as d:
            home, free, ok = kv.pick_home("x_test", 0.001, [Path("/kaggle/working"), Path(d)])
            self.assertEqual(home, Path(d) / "kino_x_test")
            self.assertTrue(ok)

    def test_lib_env_drops_tokens(self):
        with mock.patch.dict(os.environ, {"HF_TOKEN": "secret", "PYTHONPATH": "/x"}):
            env = kv.lib_env(Path("/nonexistent/venv"), Path("/tmp/c"))
        self.assertNotIn("HF_TOKEN", env)
        self.assertNotIn("PYTHONPATH", env)
        self.assertEqual(env["HF_HOME"], "/tmp/c/hf")

    def test_run_logged_tail(self):
        rc, tail = kv.run_logged([sys.executable, "-c", "import sys\nfor i in range(50): print(i)\nsys.exit(3)"], prefix="t", keep=5)
        self.assertEqual(rc, 3)
        self.assertEqual(tail, ["45", "46", "47", "48", "49"])
        self.assertEqual(kv.error_tail(["a", "", "Traceback", "RuntimeError: x"]), "a | Traceback | RuntimeError: x")


class WorkerWiring(unittest.TestCase):
    def setUp(self):
        kw._SUPPORTS_CACHE.clear()

    def tearDown(self):
        kw._SUPPORTS_CACHE.clear()

    def test_mock_advertises_new_engines(self):
        with mock.patch.dict(os.environ, {"KINO_WORKER_MOCK": "1", "KINO_LATENTSYNC": "1", "KINO_ECHOMIMIC": "1"}):
            s = kw.supports_list()
        self.assertIn("latentsync", s)
        self.assertIn("echomimic-v3", s)
        self.assertIn("musetalk-alive", s)
        self.assertLessEqual(len(s), 16)

    def test_flags_turn_engines_off(self):
        with mock.patch.dict(os.environ, {"KINO_WORKER_MOCK": "1", "KINO_LATENTSYNC": "0", "KINO_ECHOMIMIC": "0"}):
            s = kw.supports_list()
        self.assertNotIn("latentsync", s)
        self.assertNotIn("echomimic-v3", s)

    def test_small_gpu_hides_echomimic(self):
        with mock.patch.dict(os.environ, {"KINO_WORKER_MOCK": "0", "KINO_ECHOMIMIC": "1"}), \
             mock.patch.object(em, "gpu_vram_mb", return_value=8000):
            self.assertFalse(kw.echomimic_wanted())

    def test_labels(self):
        self.assertIn("LatentSync", kw.engine_label({"kind": "lipsync", "engine": "latentsync"}))
        self.assertIn("EchoMimic", kw.engine_label({"kind": "lipsync", "engine": "echomimic-v3"}))

    def test_mock_job_end_to_end(self):
        """A lipsync job for the new engines goes through the mock path (ffmpeg only, no model)."""
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            wav = d / "a.wav"
            subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=d=1.5", str(wav)])
            out = kw.mock_render({"kind": "lipsync", "engine": "latentsync", "seconds": 1.5, "ratio": "9:16"}, None, d, wav)
            self.assertTrue(out.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
