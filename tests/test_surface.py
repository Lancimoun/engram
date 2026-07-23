"""Contracts for ENGRAM's public evidence surface.

The observatory is a live application, not a static concept page.  These tests
separate new presentation expectations from the DOM hooks that ``app.js``
already owns so a cinematic redesign cannot turn working controls into props.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
STYLES = (ROOT / "static" / "styles.css").read_text(encoding="utf-8")
APP = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
README = (ROOT / "README.md").read_text(encoding="utf-8")
CI = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
SOCIAL_CARD = ROOT / "static" / "engram-social-card.png"


class PublicSurfaceTests(unittest.TestCase):
    def test_cinematic_hero_states_the_memory_accountability_contract(self) -> None:
        self.assertIn('class="evidence-hero"', INDEX)
        self.assertIn("Every belief leaves an audit trail.", INDEX)
        self.assertIn("Live evidence surface", INDEX)
        self.assertIn('href="#observatory"', INDEX)

    def test_evidence_chain_names_the_four_real_ledger_stages(self) -> None:
        for stage, label in (
            ("ingest", "Evidence arrives"),
            ("belief", "Belief recorded"),
            ("revision", "Revision explained"),
            ("restore", "Memory restored"),
        ):
            self.assertIn(f'data-stage="{stage}"', INDEX)
            self.assertIn(label, INDEX)

    def test_public_discovery_metadata_points_at_the_live_observatory(self) -> None:
        live_url = "https://engram-production-1a6b.up.railway.app/"
        self.assertIn(f'<link rel="canonical" href="{live_url}"', INDEX)
        self.assertIn(f'<meta property="og:url" content="{live_url}"', INDEX)
        self.assertIn('<meta name="twitter:card" content="summary_large_image"', INDEX)

    def test_social_preview_is_a_real_large_card(self) -> None:
        image_url = (
            "https://engram-production-1a6b.up.railway.app/"
            "static/engram-social-card.png"
        )
        alt = (
            "A forensic evidence vault showing a sourced belief, its preserved "
            "revision, a dormant memory, and a restoration path."
        )
        for metadata in (
            f'<meta property="og:image" content="{image_url}"',
            '<meta property="og:image:type" content="image/png"',
            '<meta property="og:image:width" content="1200"',
            '<meta property="og:image:height" content="630"',
            f'<meta property="og:image:alt" content="{alt}"',
            f'<meta name="twitter:image" content="{image_url}"',
            f'<meta name="twitter:image:alt" content="{alt}"',
        ):
            self.assertIn(metadata, INDEX)

        self.assertTrue(SOCIAL_CARD.is_file(), "social preview PNG is missing")
        png = SOCIAL_CARD.read_bytes()
        self.assertEqual(b"\x89PNG\r\n\x1a\n", png[:8])
        dimensions = (
            int.from_bytes(png[16:20], "big"),
            int.from_bytes(png[20:24], "big"),
        )
        self.assertEqual((1200, 630), dimensions)
        self.assertGreater(len(png), 100_000, "preview is suspiciously small")
        self.assertIn("static/engram-social-card.png", README)

    def test_ci_uses_supported_action_runtimes_and_has_manual_recovery(self) -> None:
        self.assertIn("workflow_dispatch:", CI)
        self.assertIn("actions/checkout@v5", CI)
        self.assertIn("actions/setup-python@v6", CI)
        self.assertNotIn("actions/checkout@v4", CI)
        self.assertNotIn("actions/setup-python@v5", CI)

    def test_reduced_motion_has_an_explicit_visual_fallback(self) -> None:
        self.assertIn("@media (prefers-reduced-motion: reduce)", STYLES)
        self.assertIn(".memory-orbit", STYLES)
        reduced_block = STYLES.split("@media (prefers-reduced-motion: reduce)", 1)[1]
        self.assertRegex(reduced_block, r"animation(?:-duration)?\s*:\s*(?:none|0\.01ms)")

    def test_every_application_selector_still_resolves_and_handlers_stay_external(self) -> None:
        hooks = set(re.findall(r'querySelector\("#([A-Za-z0-9_-]+)"\)', APP))
        self.assertGreaterEqual(len(hooks), 30)
        missing = sorted(hook for hook in hooks if f'id="{hook}"' not in INDEX)
        self.assertEqual([], missing, f"app.js hooks missing from index.html: {missing}")
        self.assertNotRegex(INDEX, r"\son[a-z]+\s*=")
        scripts = re.findall(r"<script\b([^>]*)>", INDEX, flags=re.IGNORECASE)
        self.assertTrue(scripts)
        self.assertTrue(all("src=" in attributes for attributes in scripts))


if __name__ == "__main__":
    unittest.main()
