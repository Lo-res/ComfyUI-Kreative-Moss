import importlib.util
import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import conftest_stubs  # noqa: E402

conftest_stubs.install()

spec = importlib.util.spec_from_file_location("kreative_nodes", os.path.join(ROOT, "nodes.py"))
nodes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nodes)

FIXTURE = os.path.join(HERE, "fixtures", "size_cases.json")


def state(**kw):
    s = {"ratio": "2:3", "size_index": 5, "custom_ratio": [3, 2], "custom_res": [1024, 1024], "focal": "Off"}
    s.update(kw)
    return s


class SizeMaths(unittest.TestCase):
    def test_moss_default_is_1088_by_1632(self):
        self.assertEqual(nodes.resolve_resolution(state()), (1088, 1632, "2:3"))

    def test_3_2_list(self):
        sizes = [nodes.size_for_ratio(3, 2, L, 16) for L in nodes.LONG_SIDES]
        self.assertEqual(sizes[0], (768, 512))
        self.assertEqual(sizes[2], (1152, 768))
        self.assertEqual(sizes[-1], (2560, 1712))

    def test_everything_is_a_multiple_of_snap(self):
        for ratio in nodes.RATIOS:
            for idx in range(len(nodes.LONG_SIDES)):
                for snap in (8, 16, 32):
                    w, h, _ = nodes.resolve_resolution(state(ratio=ratio, size_index=idx), snap_to=snap)
                    self.assertEqual((w % snap, h % snap), (0, 0), (ratio, idx, snap))

    def test_portrait_puts_long_side_on_height(self):
        w, h, _ = nodes.resolve_resolution(state(ratio="9:16", size_index=7))
        self.assertEqual(h, 1920)
        self.assertLess(w, h)

    def test_swap(self):
        w, h, _ = nodes.resolve_resolution(state(ratio="3:2", size_index=2), swap_w_h=True)
        self.assertEqual((w, h), (768, 1152))

    def test_custom_resolution_snaps_and_clamps(self):
        w, h, label = nodes.resolve_resolution(state(ratio="Custom Resolution", custom_res=[1000, 99999]))
        self.assertEqual((w, h, label), (1008, nodes.MAX_DIM, "custom"))

    def test_custom_ratio(self):
        w, h, label = nodes.resolve_resolution(state(ratio="Custom Ratio", custom_ratio=[5, 4], size_index=1))
        self.assertEqual((w, label), (1024, "5:4"))

    def test_bad_state_falls_back(self):
        for raw in ("not json", "[]", "null", '{"ratio": "banana", "size_index": 99, "focal": "1000mm"}', None, 7):
            st = nodes.normalise_res_state(raw)
            self.assertIn(st["ratio"], nodes.RATIOS + ["Custom Ratio", "Custom Resolution"])
            self.assertTrue(0 <= st["size_index"] < len(nodes.LONG_SIDES))
            self.assertIn(st["focal"], nodes.FOCAL_IDS)

    def test_matches_shared_fixture(self):
        with open(FIXTURE, encoding="utf-8") as f:
            cases = json.load(f)
        self.assertGreater(len(cases), 100)
        for c in cases:
            w, h, label = nodes.resolve_resolution(c["state"], c["swap"], c["snap"], c["auto"], c["fisheye"])
            self.assertEqual([w, h, label], c["expect"], c)


class Lenses(unittest.TestCase):
    def test_all_lenses_plus_off(self):
        self.assertEqual(nodes.FOCAL_IDS, ["Off", "8mm", "16mm", "24mm", "35mm", "50mm", "85mm", "135mm", "XPan", "Widelux"])

    def test_off_adds_no_text(self):
        self.assertEqual(nodes.lens_text("Off"), "")

    def test_full_and_short(self):
        full = nodes.lens_text("50mm", detail="Full description")
        short = nodes.lens_text("50mm", detail="Short tag")
        self.assertIn("50mm focal length", full)
        self.assertGreater(len(full), len(short))

    def test_circular_fisheye(self):
        self.assertIn("circular", nodes.lens_text("8mm", "Circular"))
        self.assertIn("full-frame", nodes.lens_text("8mm", "Full-frame"))
        self.assertEqual(nodes.recommended_ratio("8mm", "Circular"), "1:1")
        self.assertEqual(nodes.recommended_ratio("8mm", "Full-frame"), "3:2")

    def test_lens_text_has_no_negative_phrasing(self):
        pattern = re.compile(r"\b(no|not|nothing|nobody|never|without|devoid of|free of|lacking|absent)\b", re.I)
        for lens in nodes.LENSES.values():
            for key in ("prompt", "prompt_circular", "short", "short_circular"):
                self.assertIsNone(pattern.search(lens.get(key, "")), (lens["id"], key))

    def test_recommended_ratios_are_known(self):
        for lens in nodes.LENSES.values():
            for key in ("ratio", "ratio_circular"):
                if lens.get(key):
                    self.assertIn(lens[key], nodes.RATIOS)

    def test_auto_ratio_overrides_manual(self):
        self.assertEqual(nodes.resolve_resolution(state(focal="85mm"), auto_ratio=True)[2], "4:5")
        self.assertEqual(nodes.resolve_resolution(state(focal="85mm"), auto_ratio=False)[2], "2:3")

    def test_auto_ratio_ignored_when_lens_off(self):
        self.assertEqual(nodes.resolve_resolution(state(ratio="16:9"), auto_ratio=True)[2], "16:9")


class NodeClass(unittest.TestCase):
    def run_node(self, **overrides):
        args = dict(ui_state=json.dumps(state(focal="50mm")), batch_size=2, snap_to=16, swap_w_h=False,
                    auto_ratio=False, fisheye_type="Full-frame", lens_detail="Full description")
        args.update(overrides)
        return nodes.KreativeResolutionFocal().get_resolution(**args)

    def test_outputs(self):
        w, h, latent, text, batch = self.run_node()
        self.assertEqual((w, h, batch), (1088, 1632, 2))
        self.assertEqual(tuple(latent["samples"].shape), (2, 4, 1632 // 8, 1088 // 8))
        self.assertIn("50mm", text)

    def test_first_three_outputs_match_old_node(self):
        cls = nodes.KreativeResolutionFocal
        self.assertEqual(len(cls.RETURN_TYPES), len(cls.RETURN_NAMES))
        self.assertEqual(cls.RETURN_NAMES[:3], nodes.KreativeResolution.RETURN_NAMES)

    def test_registered(self):
        self.assertIn("KreativeResolutionFocal", nodes.NODE_CLASS_MAPPINGS)
        self.assertIn("KreativeResolutionFocal", nodes.NODE_DISPLAY_NAME_MAPPINGS)

    def test_default_ui_state_roundtrips(self):
        st = json.loads(nodes.DEFAULT_RES_STATE_JSON)
        self.assertEqual(nodes.normalise_res_state(st), st)


class ExistingNodesStillWork(unittest.TestCase):
    def test_old_resolution_node(self):
        out = nodes.KreativeResolution().get_resolution("2:3 Portrait (1088x1632) [Moss Default]", False, 1088, 1632, 16)
        self.assertEqual(out[:2], (1088, 1632))

    def test_prompt_multi_picks_enabled_row(self):
        rows = json.dumps([{"enabled": False, "text": "a"}, {"enabled": True, "text": "b"}])
        self.assertEqual(nodes.KreativePromptMulti().get_prompt("Single Active (Radio)", " ", rows)[0], "b")

    def test_prompt_multi_ignores_blank_rows(self):
        rows = json.dumps([{"enabled": True, "text": "x"}, {"enabled": False, "text": ""}])
        self.assertEqual(nodes.KreativePromptMulti().get_prompt("Single Active (Radio)", " ", rows)[0], "x")

    def test_default_ideas_are_valid(self):
        self.assertEqual(sum(1 for r in nodes.DEFAULT_PROMPTS_LIST if r["enabled"]), 1)


if __name__ == "__main__":
    unittest.main()
