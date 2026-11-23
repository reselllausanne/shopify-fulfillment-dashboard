#!/usr/bin/env python3
"""Isolated tests (temp dir, no real data): detection, silence when clean, dedupe, resolution."""
import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit

CLEAN = "### D-001\n- topic: a\n- date: 2026-01-01\n- source: x\n- status: active\n- value: one\n"
CONFLICT = CLEAN + "### D-002\n- topic: a\n- date: 2026-02-01\n- source: y\n- status: active\n- value: two\n"

class T(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.d, "docs"))
        self.dec = os.path.join(self.d, "decisions.md")
        self.note = os.path.join(self.d, "note.md")
        open(self.note, "w").write("ok\n")
        open(os.path.join(self.d, "sources.txt"), "w").write("decisions.md\nnote.md\n")
        self.reg = os.path.join(self.d, "registry.json")
    def run_audit(self):
        return audit.run(self.d, os.path.join(self.d, "sources.txt"), self.reg)

    def test_silent_when_clean(self):
        open(self.dec, "w").write(CLEAN)
        self.assertEqual(self.run_audit(), [])
        self.assertEqual(self.run_audit(), [])

    def test_detects_contradiction_then_dedupes(self):
        open(self.dec, "w").write(CONFLICT)
        first = self.run_audit()
        self.assertEqual(len(first), 1); self.assertIn("contradiction", first[0]); self.assertIn("NOUVEAU", first[0])
        self.assertEqual(self.run_audit(), [])  # same problem, no repeat alert

    def test_broken_ref_detected(self):
        open(self.dec, "w").write(CLEAN)
        open(self.note, "w").write("voir `docs/absent.md` et [x](nope.md)\n")
        msgs = self.run_audit()
        self.assertEqual(len(msgs), 2); self.assertTrue(all("broken_ref" in m for m in msgs))

    def test_resolved_announced_once(self):
        open(self.dec, "w").write(CONFLICT)
        self.run_audit()
        open(self.dec, "w").write(CONFLICT.replace("- status: active\n- value: one", "- status: superseded\n- value: one"))
        out = self.run_audit()
        self.assertEqual(len(out), 1); self.assertIn("RÉSOLU", out[0])
        self.assertEqual(self.run_audit(), [])

    def test_new_problem_after_known_one_alerts_only_new(self):
        open(self.dec, "w").write(CONFLICT)
        self.run_audit()
        open(self.note, "w").write("`docs/absent.md`\n")
        out = self.run_audit()
        self.assertEqual(len(out), 1); self.assertIn("broken_ref", out[0])

    def test_sources_not_modified(self):
        open(self.dec, "w").write(CONFLICT)
        before = open(self.dec).read(); self.run_audit()
        self.assertEqual(before, open(self.dec).read())

if __name__ == "__main__":
    unittest.main(verbosity=2)
