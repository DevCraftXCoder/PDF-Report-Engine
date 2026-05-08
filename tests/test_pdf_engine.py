"""
QA tests for pdf_engine.py covering 3 gaps identified in the 2026-05-07 QA report.

Gap 1 — Error paths: malformed JSON and empty stdin via --stdin
Gap 2 — Unicode in company_name / bio
Gap 3 — Section heading assertion ("Technical Infrastructure Audit" or "Tech Stack")
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

# Engine directory: the reportlab_engine package lives one level above this file.
engine_dir = Path(__file__).parent.parent / "python"


# ---------------------------------------------------------------------------
# Gap 1 — Error paths
# ---------------------------------------------------------------------------

class TestErrorPaths:
    """Subprocess invocations via --stdin that must exit code 1."""

    def test_malformed_json_exits_1(self, tmp_path):
        """Malformed JSON on stdin must exit 1 and write an error to stderr."""
        bad_json = b"{not valid json at all!!!"
        output_pdf = tmp_path / "out.pdf"

        result = subprocess.run(
            [sys.executable, "-m", "reportlab_engine.cli", "--stdin", "--output", str(output_pdf)],
            cwd=str(engine_dir),
            input=bad_json,
            capture_output=True,
        )

        assert result.returncode == 1, (
            f"Expected exit code 1 for malformed JSON, got {result.returncode}.\n"
            f"stdout: {result.stdout!r}\nstderr: {result.stderr!r}"
        )
        stderr_text = result.stderr.decode("utf-8", errors="replace").lower()
        assert any(keyword in stderr_text for keyword in ("json", "invalid", "error")), (
            f"Expected stderr to mention JSON/invalid/error, got: {result.stderr!r}"
        )
        assert not output_pdf.exists(), (
            "PDF file should NOT be created when input is malformed JSON."
        )

    def test_empty_stdin_exits_1(self, tmp_path):
        """Empty stdin with --stdin must exit 1 and write something to stderr."""
        output_pdf = tmp_path / "out.pdf"

        result = subprocess.run(
            [sys.executable, "-m", "reportlab_engine.cli", "--stdin", "--output", str(output_pdf)],
            cwd=str(engine_dir),
            input=b"",
            capture_output=True,
        )

        assert result.returncode == 1, (
            f"Expected exit code 1 for empty stdin, got {result.returncode}.\n"
            f"stdout: {result.stdout!r}\nstderr: {result.stderr!r}"
        )
        assert result.stderr.strip(), (
            "Expected non-empty stderr for empty stdin, got nothing."
        )
        assert not output_pdf.exists(), (
            "PDF file should NOT be created when stdin is empty."
        )

    def test_malformed_json_no_pdf_side_effect(self, tmp_path):
        """Double-check: the default 'report.pdf' is also not written on error."""
        unique_output = tmp_path / "should_not_exist.pdf"

        result = subprocess.run(
            [sys.executable, "-m", "reportlab_engine.cli", "--stdin", "--output", str(unique_output)],
            cwd=str(engine_dir),
            input=b"[[[bad",
            capture_output=True,
        )

        assert result.returncode == 1
        assert not unique_output.exists(), (
            f"No PDF should be written on error; found file at {unique_output}"
        )


# ---------------------------------------------------------------------------
# Gap 2 — Unicode in company_name / bio
# ---------------------------------------------------------------------------

class TestUnicodeContent:
    """Verify the engine handles non-ASCII characters without crashing."""

    def _minimal_config(self, company_name: str, bio: str) -> dict:
        """Build the smallest valid ReportConfig dict."""
        return {
            "company_name": company_name,
            "bio": bio,
            # Provide minimal required list/dict fields as empty to avoid KeyErrors.
            "metrics": {},
            "kpis": [],
            "revenue_projections": {},
            "risk_items": [],
            "roadmap_items": [],
            "competitive_data": [],
            "audience_data": {},
        }

    def test_unicode_arrows_and_accents(self, tmp_path):
        """company_name with arrow characters and bio with accented Latin chars."""
        config = self._minimal_config(
            company_name="AcmeCorp ↑↓",  # ↑↓
            bio="Sp\xe9cialit\xe9 \xe0 Paris — \xfc\xf1 quality",  # é à ü ñ
        )
        output_pdf = tmp_path / "unicode_report.pdf"

        result = subprocess.run(
            [sys.executable, "-m", "reportlab_engine.cli", "--stdin", "--output", str(output_pdf)],
            cwd=str(engine_dir),
            input=json.dumps(config, ensure_ascii=False).encode("utf-8"),
            capture_output=True,
        )

        assert result.returncode == 0, (
            f"Expected exit code 0 for unicode content, got {result.returncode}.\n"
            f"stdout: {result.stdout.decode('utf-8', errors='replace')}\n"
            f"stderr: {result.stderr.decode('utf-8', errors='replace')}"
        )
        assert output_pdf.exists(), (
            f"Expected output PDF to be created at {output_pdf}."
        )
        assert output_pdf.stat().st_size > 10_240, (
            f"Output PDF is suspiciously small ({output_pdf.stat().st_size} bytes); "
            "expected > 10 KB."
        )

    def test_unicode_company_name_in_pdf_text(self, tmp_path):
        """Optional: extract PDF text and verify company name appears on page 1."""
        pypdf = pytest.importorskip("pypdf")

        company = "AcmeCorp ↑↓"
        config = self._minimal_config(company_name=company, bio="Test bio with \xe9")
        output_pdf = tmp_path / "unicode_text_check.pdf"

        result = subprocess.run(
            [sys.executable, "-m", "reportlab_engine.cli", "--stdin", "--output", str(output_pdf)],
            cwd=str(engine_dir),
            input=json.dumps(config, ensure_ascii=False).encode("utf-8"),
            capture_output=True,
        )

        assert result.returncode == 0, (
            f"Engine exited {result.returncode}.\n"
            f"stderr: {result.stderr.decode('utf-8', errors='replace')}"
        )
        assert output_pdf.exists(), "PDF not created."

        reader = pypdf.PdfReader(str(output_pdf))
        first_page_text = reader.pages[0].extract_text() or ""
        # The engine uppercases company_name in headers; check case-insensitively.
        assert "ACMECORP" in first_page_text.upper() or "AcmeCorp" in first_page_text, (
            f"Company name not found in PDF page 1 text.\n"
            f"Extracted text (first 500 chars): {first_page_text[:500]!r}"
        )


# ---------------------------------------------------------------------------
# Gap 3 — Section heading assertion
# ---------------------------------------------------------------------------

class TestSectionHeadings:
    """Verify expected section headings appear in the generated --sample PDF."""

    def test_infrastructure_or_tech_stack_heading(self, tmp_path):
        """Either 'Technical Infrastructure Audit' or 'Tech Stack' must appear."""
        pypdf = pytest.importorskip("pypdf")

        output_pdf = tmp_path / "sample_report.pdf"

        result = subprocess.run(
            [sys.executable, "-m", "reportlab_engine.cli", "--sample", "--output", str(output_pdf)],
            cwd=str(engine_dir),
            capture_output=True,
        )

        assert result.returncode == 0, (
            f"--sample generation failed with exit code {result.returncode}.\n"
            f"stdout: {result.stdout.decode('utf-8', errors='replace')}\n"
            f"stderr: {result.stderr.decode('utf-8', errors='replace')}"
        )
        assert output_pdf.exists(), (
            f"--sample did not create a PDF at {output_pdf}."
        )

        reader = pypdf.PdfReader(str(output_pdf))
        full_text = ""
        for page in reader.pages:
            full_text += (page.extract_text() or "") + "\n"

        accepted_headings = [
            "Technical Infrastructure Audit",
            "Tech Stack",
        ]
        found = any(heading in full_text for heading in accepted_headings)
        assert found, (
            f"Neither {accepted_headings[0]!r} nor {accepted_headings[1]!r} found in PDF text.\n"
            f"Sample of extracted text (first 1000 chars):\n{full_text[:1000]!r}"
        )
