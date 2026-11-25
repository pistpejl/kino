"""Unit tests for the pure MuseTalk helpers (no GPU, no torch, no model download).

  python3 notebooks/test_kino_musetalk.py
"""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kino_musetalk as mt  # noqa: E402
import kino_worker as kw  # noqa: E402


def face68(x0=100, y0=100, w=100, h=120):
    """Rough 68-point face: jaw 0-16 along the bottom, nose 27-35 in the middle."""
    pts = [(x0 + i * w / 16, y0 + h * 0.5 + h * 0.5 * (1 - abs(i - 8) / 8)) for i in range(17)]
    pts += [(x0 + w * 0.3, y0 + h * 0.3)] * 10  # brows 17-26
    pts += [(x0 + w / 2, y0 + h * (0.35 + 0.05 * k)) for k in range(4)]  # nose bridge 27-30
    pts += [(x0 + w / 2, y0 + h * 0.6)] * 5  # 31-35
    pts += [(x0 + w * 0.4, y0 + h * 0.4)] * 12  # eyes 36-47
    pts += [(x0 + w / 2, y0 + h * 0.75)] * 20  # mouth 48-67
    return pts


class Helpers(unittest.TestCase):
    def test_bbox_follows_upstream_formula(self):
        lm = face68()
        x1, y1, x2, y2 = mt.bbox_from_landmarks(lm, (90, 90, 210, 230), 400, 400)
        self.assertEqual((x1, x2), (100, 200))
        self.assertEqual(y2, 220)  # chin
        half = int(lm[29][1])
        self.assertEqual(y1, max(0, half - (220 - half)))

    def test_bbox_falls_back_to_detector(self):
        flat = [(50, 50)] * 68
        self.assertEqual(mt.bbox_from_landmarks(flat, (10, 20, 90, 120, 0.9), 100, 200), (10, 20, 90, 100))

    def test_fill_missing(self):
        a, b = (1, 1, 2, 2), (3, 3, 4, 4)
        self.assertEqual(mt.fill_missing([None, a, None, b, None]), [a, a, a, b, b])
        self.assertIsNone(mt.fill_missing([None, None]))

    def test_ltx_frames(self):
        for s in (0.5, 1, 3, 4, 5, 12):
            n = mt.ltx_frames_for(s)
            self.assertEqual((n - 1) % 8, 0)
            self.assertTrue(9 <= n <= 97)
        self.assertEqual(mt.ltx_frames_for(12), 97)

    def test_extend_plan(self):
        self.assertEqual(mt.extend_plan(5, 4)["mode"], "trim")
        p = mt.extend_plan(4, 10)
        self.assertEqual(p["mode"], "pingpong")
        self.assertGreaterEqual(p["loops"] * 2 * 4, 10)

    def test_worker_advertises_musetalk_and_labels(self):
        self.assertIn("musetalk", kw.SUPPORTS)
        self.assertIn("musetalk-alive", kw.SUPPORTS)
        self.assertIn("levande bild", kw.engine_label({"engine": "musetalk-alive", "kind": "lipsync"}))
        self.assertEqual(kw.engine_label({"engine": "musetalk", "kind": "lipsync"}), "MuseTalk 1.5 läppsynk")
        self.assertEqual(kw.engine_label({"engine": "ltx-video", "kind": "video"}), "ltx-video")


class FfmpegDryRun(unittest.TestCase):
    """CPU-only: the I2V clip is stretched/trimmed to the audio length at 25 fps."""

    def test_fit_video_to_audio(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            src = d / "clip.mp4"
            subprocess.check_call(["ffmpeg", "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i",
                                   "testsrc=s=64x64:d=1:r=8", "-pix_fmt", "yuv420p", str(src)])
            out = mt.fit_video_to_audio(src, 2.6, d / "fit.mp4")
            self.assertAlmostEqual(mt.probe_seconds(out), 2.6, delta=0.15)
            out2 = mt.fit_video_to_audio(src, 0.6, d / "trim.mp4")
            self.assertAlmostEqual(mt.probe_seconds(out2), 0.6, delta=0.15)


if __name__ == "__main__":
    unittest.main(verbosity=2)
