"""Deterministic tracking regressions; run with .venv/Scripts/python.exe."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("tracker", ROOT / "tracker.py")
tracker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tracker)


def face(x, y=20, w=30, h=30):
    return np.array([x, y, w, h, x+8, y+10, x+22, y+10, x+15, y+16, x+10, y+23, x+20, y+23, .99], dtype=np.float32)


class Capture:
    def __init__(self, count):
        self.frames = iter(np.full((120, 200, 3), i, np.uint8) for i in range(count))
    def read(self):
        item = next(self.frames, None)
        return item is not None, item


class Engine:
    rec = object()
    def __init__(self, detections):
        self.detections = detections
        self.embedded = []
    def detect(self, frame):
        return self.detections[int(frame[0, 0, 0])]
    def embed(self, frame, value):
        self.embedded.append(float(value[0]))
        return float(value[0])
    def similarity(self, a, b):
        return 1. if a == b else 0.


class StableTracker:
    def init(self, frame, box):
        self.box = box
        assert box[0] + box[2] <= frame.shape[1]
        assert box[1] + box[3] <= frame.shape[0]
    def update(self, frame):
        return True, self.box


class TrackingTests(unittest.TestCase):
    def test_acquires_person_entering_after_first_frame(self):
        engine = Engine([[], [], [face(80)], [face(80)]])
        with patch.object(tracker, 'make_tracker', StableTracker):
            _, boxes = tracker.run_single(Capture(4), engine, 1, 200, 120, 200, 120, 10, 1, 4, None)
        self.assertIsNone(boxes[0][1])
        self.assertIsNotNone(boxes[2][1])

    def test_lost_person_has_no_stale_green_box(self):
        class LostTracker(StableTracker):
            def update(self, frame): return False, self.box
        engine = Engine([[face(80)], [], []])
        with patch.object(tracker, 'make_tracker', LostTracker):
            centers, boxes = tracker.run_single(Capture(3), engine, 1, 200, 120, 200, 120, 10, 1, 3, None)
        self.assertIsNone(boxes[1][1])
        self.assertEqual(centers[0][1], centers[1][1])

    def test_manual_selection_at_edge_stays_inside_frame(self):
        with patch.object(tracker, 'make_tracker', StableTracker):
            _, boxes = tracker.run_single(Capture(1), Engine([[]]), 1, 200, 120, 200, 120, 10, 1, 1, (199, 119))
        x, y, w, h = boxes[0][1]
        self.assertLessEqual(x + w, 1)
        self.assertLessEqual(y + h, 1)

    def test_nearby_faces_do_not_share_track(self):
        engine = Engine([[face(50), face(75)]])
        tracker.run_speaker(Capture(1), engine, 1, 200, 120, 200, 120, 10, 1, 1, None)
        # Both faces create an identity and both get independently revalidated.
        self.assertEqual(engine.embedded.count(50), 2)
        self.assertEqual(engine.embedded.count(75), 2)

    def test_speaker_disappearance_hides_mask(self):
        engine = Engine([[face(50)], []])
        _, boxes = tracker.run_speaker(Capture(2), engine, 1, 200, 120, 200, 120, 10, 1, 2, None)
        self.assertIsNotNone(boxes[0][1])
        self.assertIsNone(boxes[1][1])

    def test_silence_does_not_open_speech_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            file = str(Path(directory) / 'silence.wav')
            with wave.open(file, 'wb') as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
                wav.writeframes(np.zeros(16000, dtype=np.int16).tobytes())
            env = tracker.load_audio_env(file)
            self.assertLess(env(.5), tracker.SPEECH_THRESH)

    def test_scene_cut_never_blends_next_scene_into_previous(self):
        with tempfile.TemporaryDirectory() as directory:
            out = str(Path(directory) / 'cmds.txt')
            tracker.write_output([(0, 100, 0), (.1, 100, 0), (.2, 180, 1)], [], out, None, 200, 120)
            lines = Path(out).read_text().splitlines()
            self.assertEqual(lines[0].split(' x ')[1], lines[1].split(' x ')[1])
            self.assertNotEqual(lines[1].split(' x ')[1], lines[2].split(' x ')[1])

    def test_narrow_portrait_never_crops_outside_source(self):
        with tempfile.TemporaryDirectory() as directory:
            out = str(Path(directory) / 'cmds.txt')
            tracker.write_output([(0, 150, 0), (.1, 50, 0)], [], out, None, 200, 600)
            self.assertTrue(all(line.endswith('x 0;') for line in Path(out).read_text().splitlines()))


if __name__ == '__main__':
    unittest.main()
