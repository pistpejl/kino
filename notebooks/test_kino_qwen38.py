"""Unit tests for kino_qwen38 (no GPU, no download).  python3 notebooks/test_kino_qwen38.py"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kino_qwen38 as q  # noqa: E402


class Plan(unittest.TestCase):
    def test_two_t4_gets_q4_split(self):
        with mock.patch.object(q, "gpus", return_value=[15360, 15360]):
            p = q.plan()
        self.assertEqual(p["quant"], q.QUANT_2GPU)
        self.assertTrue(p["split"])

    def test_one_t4_gets_iq3(self):
        with mock.patch.object(q, "gpus", return_value=[15360]):
            p = q.plan()
        self.assertEqual(p["quant"], q.QUANT_1GPU)
        self.assertFalse(p["split"])

    def test_small_gpu_none(self):
        with mock.patch.object(q, "gpus", return_value=[8192]):
            self.assertIsNone(q.plan())
        with mock.patch.object(q, "gpus", return_value=[]):
            self.assertIsNone(q.plan())

    def test_mock_answer(self):
        d = Path(tempfile.mkdtemp())
        self.assertEqual(json.loads(q.mock_answer({"json": True}, d).read_text())["content"], '{"mock":true}')

    def test_unload_without_server_is_noop(self):
        q.unload()
        self.assertFalse(q.loaded())


if __name__ == "__main__":
    unittest.main()
