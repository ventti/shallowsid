"""HVSC deployment boundary and data integrity checks."""

import contextlib
import gzip
import io
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from prepare_hvsc_hosting import needs_deploy, prepare


class HostingPreparationTests(unittest.TestCase):
    def test_update_decision_and_downgrade_protection(self):
        local = {"hvsc_version": 85, "fingerprint": "content", "hosting_config": "config", "gzip_bytes": 123}
        self.assertTrue(needs_deploy(local, {}))
        self.assertFalse(needs_deploy(local, {**local, "gzip_bytes": 124}))
        self.assertTrue(needs_deploy(local, {**local, "hosting_config": "old"}))
        self.assertTrue(needs_deploy(local, {**local, "fingerprint": "old"}))
        self.assertTrue(needs_deploy(local, {**local, "hvsc_version": 84}))
        with self.assertRaisesRegex(ValueError, "newer"):
            needs_deploy(local, {**local, "hvsc_version": 86})

    def test_only_collection_files_and_deterministic_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, out = Path(tmp) / "source", Path(tmp) / "output"
            tune = source / "MUSICIANS/A/Test/Space tune.sid"
            tune.parent.mkdir(parents=True)
            raw = b"PSID" + bytes(range(256)) * 4
            tune.write_bytes(raw)
            (source / "DOCUMENTS").mkdir()
            (source / "DOCUMENTS/Copyright.txt").write_text("Original collection notice")
            (source / "secret.json").write_text("must never be deployed")
            with contextlib.redirect_stdout(io.StringIO()):
                first = prepare(source, out, 85, workers=2)
                second = prepare(source, out, 85, workers=2)
            self.assertEqual(first, second)
            self.assertEqual(first["sid_files"], 1)
            self.assertEqual(first["files"], 2)
            self.assertEqual((out / tune.relative_to(source)).read_bytes(), raw)
            self.assertTrue((out / "DOCUMENTS/Copyright.txt").exists())
            self.assertFalse((out / "secret.json").exists())
            expected = len(gzip.compress(raw, compresslevel=9, mtime=0))
            expected += len(gzip.compress(b"Original collection notice", compresslevel=9, mtime=0))
            self.assertEqual(first["gzip_bytes"], expected)
            tune.write_bytes(raw + b"changed")
            with contextlib.redirect_stdout(io.StringIO()):
                changed = prepare(source, out, 85, workers=2)
            self.assertNotEqual(first["fingerprint"], changed["fingerprint"])

    def test_empty_source_cannot_replace_previous_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, out = Path(tmp) / "source", Path(tmp) / "output"
            source.mkdir()
            out.mkdir()
            marker = out / "manifest.json"
            marker.write_text("keep me")
            with self.assertRaisesRegex(ValueError, "No SID"):
                prepare(source, out, 85)
            self.assertEqual(marker.read_text(), "keep me")

    def test_source_and_output_cannot_overlap(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            with self.assertRaisesRegex(ValueError, "separate"):
                prepare(source, source / "output", 85)
            with self.assertRaisesRegex(ValueError, "separate"):
                prepare(source / "input", source, 85)

    def test_arbitrary_output_is_not_deleted(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, out = Path(tmp) / "source", Path(tmp) / "output"
            source.mkdir()
            (source / "test.sid").write_bytes(b"PSIDtest")
            out.mkdir()
            marker = out / "important.txt"
            marker.write_text("keep me")
            with self.assertRaisesRegex(ValueError, "previously prepared"):
                prepare(source, out, 85)
            self.assertEqual(marker.read_text(), "keep me")


if __name__ == "__main__":
    unittest.main()
