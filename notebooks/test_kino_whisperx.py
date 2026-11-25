"""Unit tests for the pure WhisperX helpers and the worker's ASR wiring (no GPU, no torch, no model download).

  python3 notebooks/test_kino_whisperx.py
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kino_whisperx as wx  # noqa: E402
import kino_worker as kw  # noqa: E402

try:
    import numpy as np  # noqa: F401
    HAS_NP = True
except Exception:
    HAS_NP = False


class Helpers(unittest.TestCase):
    def test_fill_missing_word_times(self):
        words = [{"w": "Det", "s": 1.0, "e": 1.2}, {"w": "1999", "s": None, "e": None}, {"w": "var", "s": 2.0, "e": 2.2}]
        out = wx.fill_word_times(words, 0.9, 2.5)
        self.assertEqual(out[1]["s"], 1.2)
        self.assertEqual(out[1]["e"], 2.0)
        self.assertTrue(all(w["e"] > w["s"] for w in out))

    def test_fill_missing_at_edges(self):
        out = wx.fill_word_times([{"w": "a"}, {"w": "b", "s": 3.0, "e": 3.5}, {"w": "c"}], 2.0, 4.0)
        self.assertEqual((out[0]["s"], out[0]["e"]), (2.0, 3.0))
        self.assertEqual((out[2]["s"], out[2]["e"]), (3.5, 4.0))

    def test_normalize_aligned(self):
        segs = [{"start": 0.5, "end": 2.0, "text": " Hej på dig. ", "words": [
            {"word": "Hej", "start": 0.5, "end": 0.8, "score": 0.91}, {"word": "på", "start": 0.9, "end": 1.0}, {"word": "dig.", "start": 1.1, "end": 1.5}]}]
        out = wx.normalize_segments(segs, True)
        self.assertEqual(len(out), 1)
        self.assertFalse(out[0]["est"])
        self.assertEqual([w["w"] for w in out[0]["words"]], ["Hej", "på", "dig."])
        self.assertEqual(out[0]["words"][0]["p"], 0.91)
        self.assertEqual(out[0]["start"], 0.5)

    def test_normalize_unaligned_estimates(self):
        out = wx.normalize_segments([{"start": 0, "end": 3, "text": "ett två tre"}], False)
        self.assertTrue(out[0]["est"])
        self.assertEqual(len(out[0]["words"]), 3)
        self.assertAlmostEqual(out[0]["words"][-1]["e"], 3.0, places=2)

    def test_windows(self):
        segs = wx.normalize_segments([{"start": 0, "end": 10, "text": " ".join(["ord"] * 20)}], False)
        wins = wx.speech_windows(segs)
        self.assertGreater(len(wins), 2)
        covered = sum(len(w[2]) for w in wins)
        self.assertEqual(covered, 20)

    @unittest.skipUnless(HAS_NP, "numpy saknas")
    def test_cluster_two_speakers(self):
        import numpy as np
        rng = np.random.default_rng(1)
        a = rng.normal(0, 1, 192); b = rng.normal(0, 1, 192)
        emb = [a + rng.normal(0, 0.2, 192) for _ in range(6)] + [b + rng.normal(0, 0.2, 192) for _ in range(5)] + [a + rng.normal(0, 0.2, 192)]
        labels = wx.cluster_embeddings(emb)
        self.assertEqual(labels[:6], [0] * 6)
        self.assertEqual(labels[6:11], [1] * 5)
        self.assertEqual(labels[11], 0)

    @unittest.skipUnless(HAS_NP, "numpy saknas")
    def test_cluster_caps_speakers(self):
        import numpy as np
        rng = np.random.default_rng(2)
        emb = [rng.normal(0, 1, 64) for _ in range(10)]
        self.assertLessEqual(len(set(wx.cluster_embeddings(emb, threshold=0.01, max_speakers=3))), 3)

    def test_assign_speakers(self):
        segs = wx.normalize_segments([{"start": 0, "end": 2, "text": "a b c d"}, {"start": 3, "end": 5, "text": "e f g h"}], False)
        wins = [(0, 2, [(0, i) for i in range(4)]), (3, 5, [(1, i) for i in range(4)])]
        out = wx.assign_speakers(segs, wins, [0, 1])
        self.assertEqual(out[0]["speaker"], 0)
        self.assertEqual(out[1]["speaker"], 1)
        self.assertEqual(out[1]["words"][0]["spk"], 1)


class Worker(unittest.TestCase):
    def test_supports_whisperx(self):
        self.assertIn("whisperx", kw.SUPPORTS)

    def test_mock_asr_transcribe_and_align(self):
        with tempfile.TemporaryDirectory() as d:
            out = kw.mock_asr({"options": {"lang": "auto", "diarize": True}}, Path(d))
            r = json.loads(out.read_text())
            self.assertTrue(r["ok"])
            self.assertEqual(r["diarization"]["speakers"], 2)
            self.assertTrue(all(w["e"] > w["s"] for s in r["segments"] for w in s["words"]))
            out = kw.mock_asr({"options": {"lang": "sv", "align": [{"start": 1, "end": 2, "text": "hej hopp"}]}}, Path(d))
            r = json.loads(out.read_text())
            self.assertEqual(r["mode"], "align")
            self.assertEqual([w["w"] for w in r["segments"][0]["words"]], ["hej", "hopp"])

    def test_engine_label(self):
        self.assertIn("WhisperX", kw.engine_label({"kind": "asr", "engine": "whisperx"}))


if __name__ == "__main__":
    unittest.main()
