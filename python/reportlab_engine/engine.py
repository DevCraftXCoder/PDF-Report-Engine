"""
Enterprise PDF Report Engine — ReportLab implementation.

Generates 16-section enterprise PDF reports with diagrams, KPI scorecards,
revenue projections, and AI-generated strategic narratives.

Repository structure:
    python/reportlab_engine/engine.py   — this file (core engine)
    python/reportlab_engine/cli.py      — CLI entry point
    python/reportlab_engine/__init__.py — public API exports
    tests/test_pdf_engine.py            — pytest test suite

Usage (CLI):
    python -m reportlab_engine.cli --config report_config.json --output report.pdf
    python -m reportlab_engine.cli --config report_config.json --preview preview.png
    python -m reportlab_engine.cli --sample --output sample.pdf

Usage (Python API):
    from reportlab_engine import generate_report
    from reportlab_engine.engine import ReportConfig

    config = ReportConfig.from_json("report_config.json")
    generate_report(config, "report.pdf")
"""

from __future__ import annotations

import base64
import io
import json
import textwrap
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    HRFlowable,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

# ---------------------------------------------------------------------------
# Color palette (enterprise dark-accented on white paper)
# ---------------------------------------------------------------------------
C_NAVY = colors.HexColor("#0D1B2A")        # headings, cover background
C_SLATE = colors.HexColor("#1A2634")       # section header background
C_ACCENT = colors.HexColor("#E94560")      # accent red
C_ACCENT_DARK = colors.HexColor("#B33347")
C_GOLD = colors.HexColor("#D4A017")        # KPI highlight
C_TEXT = colors.HexColor("#1A1A2E")        # body text
C_SUBTEXT = colors.HexColor("#4A5568")     # captions, sub-labels
C_LIGHT = colors.HexColor("#F7F8FA")       # alternating row even
C_WHITE = colors.white
C_ROW_ODD = colors.HexColor("#FFFFFF")
C_ROW_EVEN = colors.HexColor("#F0F4F8")
C_BORDER = colors.HexColor("#CBD5E0")
C_GREEN = colors.HexColor("#2D6A4F")
C_ORANGE = colors.HexColor("#E07B1A")

PAGE_W, PAGE_H = LETTER  # 8.5 x 11 inches

# ---------------------------------------------------------------------------
# Font registration
#
# Searches common system font directories across Windows, Linux, and macOS.
# Falls back to Helvetica on any platform where Inter is not installed —
# all layout logic is font-agnostic (ReportLab measures glyphs at render time).
# ---------------------------------------------------------------------------
try:
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # Sanitized: absolute Windows path (C:/Windows/Fonts) removed.
    # Fonts are resolved dynamically at runtime from these platform-standard
    # directories. No hardcoded machine-specific path required.
    _FONT_DIRS = [
        Path("/usr/share/fonts/truetype"),   # Debian/Ubuntu
        Path("/usr/local/share/fonts"),       # Linux (local install)
        Path("/Library/Fonts"),               # macOS system
        Path("~/Library/Fonts").expanduser(), # macOS user
    ]

    # On Windows, add the system font directory via environment variable
    # rather than a hardcoded drive letter — works across Windows editions.
    import os as _os
    _win_fonts = _os.environ.get("WINDIR")
    if _win_fonts:
        _FONT_DIRS.insert(0, Path(_win_fonts) / "Fonts")

    def _register(family: str, filenames: list[str]) -> bool:
        for d in _FONT_DIRS:
            for fn in filenames:
                p = d / fn
                if p.exists():
                    pdfmetrics.registerFont(TTFont(family, str(p)))
                    return True
        return False

    _HAVE_INTER = _register("Inter", ["Inter-Regular.ttf", "inter.ttf"])
    _HAVE_INTER_BOLD = _register("Inter-Bold", ["Inter-Bold.ttf"])
    BODY_FONT = "Inter" if _HAVE_INTER else "Helvetica"
    BOLD_FONT = "Inter-Bold" if _HAVE_INTER_BOLD else "Helvetica-Bold"
except Exception:
    BODY_FONT = "Helvetica"
    BOLD_FONT = "Helvetica-Bold"

MONO_FONT = "Courier"

# ---------------------------------------------------------------------------
# Paragraph styles
# ---------------------------------------------------------------------------
_base = getSampleStyleSheet()


def _style(
    name: str,
    parent: str = "Normal",
    font: str = BODY_FONT,
    size: float = 10,
    leading: float | None = None,
    color: colors.Color = C_TEXT,
    align: int = TA_LEFT,
    space_before: float = 0,
    space_after: float = 0,
    bold: bool = False,
    left_indent: float = 0,
) -> ParagraphStyle:
    return ParagraphStyle(
        name=name,
        fontName=BOLD_FONT if bold else font,
        fontSize=size,
        leading=leading or size * 1.4,
        textColor=color,
        alignment=align,
        spaceBefore=space_before,
        spaceAfter=space_after,
        leftIndent=left_indent,
    )


S = {
    # Cover
    "cover_title": _style("cover_title", font=BOLD_FONT, size=28, color=C_WHITE, align=TA_CENTER, leading=36),
    "cover_subtitle": _style("cover_subtitle", font=BODY_FONT, size=14, color=colors.HexColor("#CBD5E0"), align=TA_CENTER, leading=20),
    "cover_meta": _style("cover_meta", font=BODY_FONT, size=9, color=colors.HexColor("#718096"), align=TA_CENTER),
    # Headings
    "h1": _style("h1", font=BOLD_FONT, size=16, color=C_NAVY, space_before=18, space_after=6, leading=22),
    "h2": _style("h2", font=BOLD_FONT, size=13, color=C_NAVY, space_before=12, space_after=4, leading=18),
    "h3": _style("h3", font=BOLD_FONT, size=11, color=C_SLATE, space_before=8, space_after=3, leading=16),
    # Body
    "body": _style("body", font=BODY_FONT, size=10, leading=15, space_after=4),
    "body_sm": _style("body_sm", font=BODY_FONT, size=9, color=C_SUBTEXT, leading=13),
    "caption": _style("caption", font=BODY_FONT, size=8.5, color=C_SUBTEXT, align=TA_CENTER, space_before=2, space_after=6),
    "callout": _style("callout", font=BOLD_FONT, size=9.5, color=C_ACCENT_DARK, leading=14),
    "bullet": _style("bullet", font=BODY_FONT, size=10, leading=15, space_after=2, left_indent=12),
    # Table cells
    "cell": _style("cell", font=BODY_FONT, size=9, leading=13),
    "cell_bold": _style("cell_bold", font=BOLD_FONT, size=9, leading=13),
    "cell_header": _style("cell_header", font=BOLD_FONT, size=9, color=C_WHITE, leading=13),
    "cell_red": _style("cell_red", font=BOLD_FONT, size=9, color=C_ACCENT, leading=13),
    "cell_green": _style("cell_green", font=BOLD_FONT, size=9, color=C_GREEN, leading=13),
    # Callout box
    "insight_title": _style("insight_title", font=BOLD_FONT, size=9.5, color=C_ACCENT, leading=13),
    "insight_body": _style("insight_body", font=BODY_FONT, size=9, color=C_TEXT, leading=13),
    # TOC
    "toc_h1": _style("toc_h1", font=BOLD_FONT, size=10, color=C_NAVY, leading=16),
    "toc_h2": _style("toc_h2", font=BODY_FONT, size=9, color=C_SUBTEXT, leading=14, left_indent=12),
    "footer": _style("footer", font=BODY_FONT, size=8, color=C_SUBTEXT, align=TA_CENTER),
    "page_num": _style("page_num", font=BODY_FONT, size=8, color=C_SUBTEXT, align=TA_RIGHT),
}

# ---------------------------------------------------------------------------
# Flowable helpers
# ---------------------------------------------------------------------------


class ColorBox(Flowable):
    """Solid colored rectangle — used for section dividers and KPI tiles."""

    def __init__(
        self,
        width: float,
        height: float,
        fill_color: colors.Color,
        text: str = "",
        text_color: colors.Color = C_WHITE,
        font: str = BOLD_FONT,
        font_size: float = 10,
    ) -> None:
        super().__init__()
        self.box_width = width
        self.box_height = height
        self.fill_color = fill_color
        self.text = text
        self.text_color = text_color
        self.font = font
        self.font_size = font_size
        self.width = width
        self.height = height

    def draw(self) -> None:
        c = self.canv
        c.setFillColor(self.fill_color)
        c.rect(0, 0, self.box_width, self.box_height, fill=1, stroke=0)
        if self.text:
            c.setFillColor(self.text_color)
            c.setFont(self.font, self.font_size)
            c.drawCentredString(self.box_width / 2, self.box_height / 2 - self.font_size / 3, self.text)


class SectionHeader(Flowable):
    """Full-width dark section banner with number badge and title."""

    def __init__(self, number: str, title: str, width: float) -> None:
        super().__init__()
        self.number = number
        self.title = title
        self.width = width
        self.height = 32

    def draw(self) -> None:
        c = self.canv
        # background
        c.setFillColor(C_NAVY)
        c.roundRect(0, 0, self.width, self.height, 4, fill=1, stroke=0)
        # number badge
        badge_w = 28
        c.setFillColor(C_ACCENT)
        c.roundRect(6, 5, badge_w, 22, 3, fill=1, stroke=0)
        c.setFillColor(C_WHITE)
        c.setFont(BOLD_FONT, 10)
        c.drawCentredString(6 + badge_w / 2, 10, self.number)
        # title
        c.setFillColor(C_WHITE)
        c.setFont(BOLD_FONT, 12)
        c.drawString(40, 10, self.title.upper())


class InsightBox(Flowable):
    """Colored callout box for strategic insights."""

    def __init__(
        self,
        title: str,
        body: str,
        width: float,
        accent: colors.Color = C_ACCENT,
    ) -> None:
        super().__init__()
        self.title = title
        self.body = body
        self.box_width = width
        self.accent = accent
        # Estimate height
        lines = len(textwrap.wrap(body, 90)) + 1
        self.height = max(40, 6 + 16 + lines * 13 + 8)
        self.width = width

    def draw(self) -> None:
        c = self.canv
        h = self.height
        w = self.box_width
        # border-left accent
        c.setFillColor(colors.HexColor("#EDF2F7"))
        c.roundRect(0, 0, w, h, 3, fill=1, stroke=0)
        c.setFillColor(self.accent)
        c.rect(0, 0, 4, h, fill=1, stroke=0)
        # title
        c.setFillColor(self.accent)
        c.setFont(BOLD_FONT, 9.5)
        c.drawString(12, h - 16, self.title)
        # body
        c.setFillColor(C_TEXT)
        c.setFont(BODY_FONT, 9)
        y = h - 30
        for line in textwrap.wrap(self.body, 110):
            c.drawString(12, y, line)
            y -= 13
            if y < 4:
                break


# ---------------------------------------------------------------------------
# Diagram builders (pure ReportLab, no external SVG)
# ---------------------------------------------------------------------------


def _make_flow_diagram(
    boxes: list[str],
    width: float,
    title: str,
    caption: str,
) -> list[Flowable]:
    """Horizontal flow diagram: box → arrow → box …"""

    class FlowDiagram(Flowable):
        def __init__(self, boxes_: list[str], w: float) -> None:
            super().__init__()
            self.boxes = boxes_
            self.width = w
            n = len(boxes_)
            box_w = min(1.1 * inch, (w - 0.3 * inch) / n - 0.1 * inch)
            self.box_w = box_w
            self.box_h = 0.45 * inch
            self.height = self.box_h + 0.15 * inch

        def draw(self) -> None:
            c = self.canv
            n = len(self.boxes)
            gap = (self.width - n * self.box_w) / (n + 1)
            x = gap
            for i, label in enumerate(self.boxes):
                # box
                c.setFillColor(C_SLATE if i == 0 else (C_ACCENT if i == n - 1 else C_NAVY))
                c.roundRect(x, 0.05 * inch, self.box_w, self.box_h, 4, fill=1, stroke=0)
                c.setFillColor(C_WHITE)
                c.setFont(BOLD_FONT, 7)
                wrapped = textwrap.wrap(label, 14)
                line_h = 8
                y_start = 0.05 * inch + (self.box_h - len(wrapped) * line_h) / 2
                for j, ln in enumerate(wrapped):
                    c.drawCentredString(x + self.box_w / 2, y_start + (len(wrapped) - 1 - j) * line_h, ln)
                # arrow
                if i < n - 1:
                    ax = x + self.box_w + gap / 2 - 4
                    ay = 0.05 * inch + self.box_h / 2
                    c.setFillColor(C_ACCENT)
                    c.setStrokeColor(C_ACCENT)
                    c.line(x + self.box_w + 2, ay, ax + 6, ay)
                    p = c.beginPath()
                    p.moveTo(ax + 6, ay)
                    p.lineTo(ax + 2, ay + 3)
                    p.lineTo(ax + 2, ay - 3)
                    p.close()
                    c.drawPath(p, fill=1, stroke=0)
                x += self.box_w + gap

    items: list[Flowable] = [
        Spacer(1, 6),
        KeepTogether([
            Paragraph(title, S["h3"]),
            FlowDiagram(boxes, width),
            Paragraph(caption, S["caption"]),
            Spacer(1, 8),
        ]),
    ]
    return items


def _make_funnel_diagram(stages: list[tuple[str, str]], width: float, title: str, caption: str) -> list[Flowable]:
    """Vertical funnel — each stage narrower than the previous."""

    class FunnelDiagram(Flowable):
        def __init__(self, stages_: list[tuple[str, str]], w: float) -> None:
            super().__init__()
            self.stages = stages_
            self.width = w
            self.stage_h = 0.38 * inch
            self.height = len(stages_) * (self.stage_h + 2) + 4

        def draw(self) -> None:
            c = self.canv
            n = len(self.stages)
            for i, (label, metric) in enumerate(self.stages):
                ratio = 1.0 - i * 0.12
                bw = self.width * ratio
                bx = (self.width - bw) / 2
                by = self.height - (i + 1) * (self.stage_h + 2) + 2
                shade = C_NAVY if i == 0 else C_SLATE if i < n - 1 else C_ACCENT
                c.setFillColor(shade)
                c.roundRect(bx, by, bw, self.stage_h, 3, fill=1, stroke=0)
                c.setFillColor(C_WHITE)
                c.setFont(BOLD_FONT, 8)
                c.drawString(bx + 8, by + self.stage_h / 2 + 2, label)
                c.setFont(BODY_FONT, 7.5)
                c.drawRightString(bx + bw - 8, by + self.stage_h / 2 - 6, metric)

    items: list[Flowable] = [
        Spacer(1, 6),
        KeepTogether([
            Paragraph(title, S["h3"]),
            FunnelDiagram(stages, width),
            Paragraph(caption, S["caption"]),
            Spacer(1, 8),
        ]),
    ]
    return items


def _make_matrix_diagram(
    rows: list[str],
    cols: list[str],
    cells: dict[tuple[int, int], str],
    width: float,
    title: str,
    caption: str,
) -> list[Flowable]:
    """Grid matrix diagram (e.g., risk matrix)."""

    class MatrixDiagram(Flowable):
        def __init__(
            self,
            rows_: list[str],
            cols_: list[str],
            cells_: dict[tuple[int, int], str],
            w: float,
        ) -> None:
            super().__init__()
            self.rows = rows_
            self.cols = cols_
            self.cells = cells_
            self.width = w
            self.cell_w = (w - 0.6 * inch) / len(cols_)
            self.cell_h = 0.42 * inch
            self.label_w = 0.55 * inch
            self.height = (len(rows_) + 1) * self.cell_h + 4

        def draw(self) -> None:
            c = self.canv
            nc = len(self.cols)
            cw = self.cell_w
            ch = self.cell_h
            lw = self.label_w
            base_y = self.height - ch - 2

            # Column headers
            for j, col in enumerate(self.cols):
                c.setFillColor(C_NAVY)
                c.rect(lw + j * cw, base_y, cw, ch, fill=1, stroke=0)
                c.setFillColor(C_WHITE)
                c.setFont(BOLD_FONT, 7)
                c.drawCentredString(lw + j * cw + cw / 2, base_y + ch / 2 - 4, col)

            # Row labels + cells
            _heat = [C_GREEN, colors.HexColor("#8BC34A"), C_GOLD, C_ORANGE, C_ACCENT]
            for i, row in enumerate(self.rows):
                ry = base_y - (i + 1) * ch
                c.setFillColor(C_SLATE)
                c.rect(0, ry, lw, ch, fill=1, stroke=0)
                c.setFillColor(C_WHITE)
                c.setFont(BOLD_FONT, 7)
                c.drawCentredString(lw / 2, ry + ch / 2 - 4, row)
                for j in range(nc):
                    val = self.cells.get((i, j), "")
                    level = min(j + i, 4)
                    c.setFillColor(_heat[level])
                    c.setStrokeColor(C_WHITE)
                    c.rect(lw + j * cw, ry, cw, ch, fill=1, stroke=1)
                    c.setFillColor(C_WHITE)
                    c.setFont(BODY_FONT, 7)
                    wrapped = textwrap.wrap(val, 14)
                    for k, ln in enumerate(wrapped[:2]):
                        c.drawCentredString(lw + j * cw + cw / 2, ry + ch / 2 - 4 + (1 - k) * 8, ln)

    items: list[Flowable] = [
        Spacer(1, 6),
        KeepTogether([
            Paragraph(title, S["h3"]),
            MatrixDiagram(rows, cols, cells, width),
            Paragraph(caption, S["caption"]),
            Spacer(1, 8),
        ]),
    ]
    return items


def _make_bar_chart(
    labels: list[str],
    values: list[float],
    width: float,
    title: str,
    caption: str,
    color: colors.Color = C_NAVY,
    unit: str = "",
) -> list[Flowable]:
    """Simple horizontal bar chart."""

    class BarChart(Flowable):
        def __init__(
            self,
            labels_: list[str],
            values_: list[float],
            w: float,
            clr: colors.Color,
            unit_: str,
        ) -> None:
            super().__init__()
            self.labels = labels_
            self.values = values_
            self.width = w
            self.clr = clr
            self.unit = unit_
            self.bar_h = 0.28 * inch
            self.gap = 0.1 * inch
            self.label_w = 1.4 * inch
            self.height = len(labels_) * (self.bar_h + self.gap) + 8

        def draw(self) -> None:
            c = self.canv
            if not self.values:
                return
            max_v = max(self.values) or 1
            chart_w = self.width - self.label_w - 0.8 * inch
            y = self.height - self.bar_h - 4
            for label, val in zip(self.labels, self.values):
                bar_len = (val / max_v) * chart_w
                # label
                c.setFillColor(C_TEXT)
                c.setFont(BODY_FONT, 8)
                c.drawRightString(self.label_w - 4, y + self.bar_h / 2 - 4, label[:22])
                # bar
                c.setFillColor(self.clr)
                c.roundRect(self.label_w, y, bar_len, self.bar_h, 2, fill=1, stroke=0)
                # value label
                c.setFillColor(C_TEXT)
                c.setFont(BOLD_FONT, 8)
                c.drawString(self.label_w + bar_len + 4, y + self.bar_h / 2 - 4, f"{val:,.0f}{self.unit}")
                y -= self.bar_h + self.gap

    items: list[Flowable] = [
        Spacer(1, 4),
        KeepTogether([
            Paragraph(title, S["h3"]),
            BarChart(labels, values, width, color, unit),
            Paragraph(caption, S["caption"]),
            Spacer(1, 6),
        ]),
    ]
    return items


# ---------------------------------------------------------------------------
# Table builders
# ---------------------------------------------------------------------------


def _enterprise_table(
    data: list[list[Any]],
    col_widths: list[float] | None = None,
    header_bg: colors.Color = C_NAVY,
    stripe: bool = True,
    font_size: int = 9,
) -> Table:
    """Standard enterprise table with header row and optional striping."""
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("TEXTCOLOR", (0, 0), (-1, 0), C_WHITE),
        ("FONTNAME", (0, 0), (-1, 0), BOLD_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("FONTNAME", (0, 1), (-1, -1), BODY_FONT),
        ("TEXTCOLOR", (0, 1), (-1, -1), C_TEXT),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_ROW_ODD, C_ROW_EVEN] if stripe else [C_ROW_ODD]),
        ("GRID", (0, 0), (-1, -1), 0.4, C_BORDER),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("WORDWRAP", (0, 0), (-1, -1), True),
    ]
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle(style))
    return t


def _kpi_scorecard(kpis: list[dict[str, Any]], width: float) -> Table:
    """KPI tile grid — 4 per row, color-coded by maturity rating."""
    _maturity_color = {
        "Optimized": C_GREEN,
        "Advanced": colors.HexColor("#3182CE"),
        "Developing": C_GOLD,
        "Initial": C_ORANGE,
        "Critical": C_ACCENT,
    }
    # Build rows of 4
    rows: list[list[Any]] = []
    row: list[Any] = []
    for i, kpi in enumerate(kpis):
        mc = _maturity_color.get(kpi.get("maturity", "Developing"), C_GOLD)
        cell_content = Table(
            [
                [Paragraph(kpi.get("label", ""), _style("kl", font=BOLD_FONT, size=8, color=C_WHITE))],
                [Paragraph(kpi.get("value", "N/A"), _style("kv", font=BOLD_FONT, size=16, color=C_WHITE))],
                [Paragraph(kpi.get("maturity", ""), _style("km", font=BODY_FONT, size=7.5, color=colors.HexColor("#E2E8F0")))],
                [Paragraph(kpi.get("trend", ""), _style("kt", font=BODY_FONT, size=8, color=C_WHITE))],
            ],
            colWidths=[width / 4 - 12],
        )
        cell_content.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), mc),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [mc]),
            ("ROUNDEDCORNERS", [4]),
        ]))
        row.append(cell_content)
        if len(row) == 4 or i == len(kpis) - 1:
            while len(row) < 4:
                row.append("")
            rows.append(row)
            row = []

    tile_w = width / 4 - 8
    t = Table(rows, colWidths=[tile_w] * 4, spaceBefore=6, spaceAfter=8)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class ReportConfig:
    """Configuration for a single PDF report generation run.

    All fields have sensible defaults so callers only need to supply the
    fields relevant to their report type. Use `from_json()` or `from_dict()`
    for production use; use `sample()` for smoke-testing.
    """

    report_type: str = "Enterprise Strategic Audit"
    company_name: str = "DevXCoder"
    industry: str = "SaaS / Creator Tech"
    tagline: str = "Enterprise Strategic Intelligence Report"
    bio: str = ""
    executive_summary: str = ""
    logo_base64: str = ""  # base64-encoded PNG/JPG
    logo_path: str = ""
    generated_at: str = field(default_factory=lambda: datetime.now().strftime("%B %d, %Y"))
    prepared_by: str = "DevXCoder Intelligence Engine"
    confidentiality: str = "CONFIDENTIAL — DO NOT DISTRIBUTE"
    # Section data
    metrics: dict[str, Any] = field(default_factory=dict)
    kpis: list[dict[str, Any]] = field(default_factory=list)
    revenue_projections: dict[str, Any] = field(default_factory=dict)
    risk_items: list[dict[str, Any]] = field(default_factory=list)
    roadmap_items: list[dict[str, Any]] = field(default_factory=list)
    competitive_data: list[dict[str, Any]] = field(default_factory=list)
    audience_data: dict[str, Any] = field(default_factory=dict)
    tech_stack: list[dict[str, Any]] = field(default_factory=list)
    ai_narratives: dict[str, str] = field(default_factory=dict)  # section_key → AI text
    channels: list[dict[str, Any]] = field(default_factory=list)
    monetization_data: dict[str, Any] = field(default_factory=dict)
    saas_data: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ReportConfig:
        """Construct from a plain dictionary (e.g. parsed JSON)."""
        obj = cls()
        for k, v in d.items():
            if hasattr(obj, k):
                setattr(obj, k, v)
        return obj

    @classmethod
    def from_json(cls, path: str | Path) -> ReportConfig:
        """Load config from a JSON file on disk."""
        return cls.from_dict(json.loads(Path(path).read_text()))

    @classmethod
    def sample(cls) -> ReportConfig:
        """Return a fully-populated sample config for testing and demos."""
        return cls(
            company_name="DevXCoder",
            industry="SaaS / Creator Economy",
            tagline="AI-Powered Creator Growth Platform",
            bio=(
                "DevXCoder is an independent software studio building AI-native tools "
                "for the creator economy. Founded by a full-stack engineer with deep "
                "expertise in Cloudflare Workers, Next.js 15, and applied AI, the studio "
                "ships production-grade SaaS products serving independent artists, "
                "content creators, and early-stage founders."
            ),
            executive_summary=(
                "DevXCoder operates at the intersection of AI automation and creator monetization. "
                "The platform portfolio spans Growth Report AI, Frxncois Underground (social music), "
                "EV Betta (sports analytics), and the Proposal PDF Engine. "
                "Current MRR: $1,200 | 12-month target: $15,000 | Primary growth lever: "
                "organic distribution + AI-assisted B2B proposals."
            ),
            metrics={
                "mrr": 1200,
                "target_mrr": 15000,
                "users": 340,
                "growth_rate": 0.18,
                "churn_rate": 0.04,
                "ltv": 420,
                "cac": 45,
                "nps": 62,
                "uptime": 0.9997,
            },
            kpis=[
                {"label": "MRR", "value": "$1,200", "maturity": "Developing", "trend": "+18% MoM"},
                {"label": "Active Users", "value": "340", "maturity": "Initial", "trend": "+22% QoQ"},
                {"label": "Churn Rate", "value": "4%", "maturity": "Advanced", "trend": "↓ from 6%"},
                {"label": "NPS Score", "value": "62", "maturity": "Advanced", "trend": "↑ 8pts QoQ"},
                {"label": "LTV:CAC", "value": "9.3x", "maturity": "Optimized", "trend": "Improving"},
                {"label": "Uptime SLA", "value": "99.97%", "maturity": "Optimized", "trend": "Stable"},
                {"label": "Deploy Freq.", "value": "4.2/week", "maturity": "Advanced", "trend": "↑ velocity"},
                {"label": "AI Cost/User", "value": "$0.18", "maturity": "Developing", "trend": "Optimizing"},
            ],
            revenue_projections={
                "current_mrr": 1200,
                "scenarios": {
                    "conservative": [1400, 1680, 2050, 2400],
                    "moderate": [1700, 2300, 3400, 5200],
                    "aggressive": [2200, 3800, 6500, 11000],
                },
                "months": ["Month 1", "Month 2", "Month 3", "Month 6"],
                "pricing_tiers": [
                    {"name": "Starter", "price": "$29/mo", "target": "Solo creators", "seats": "1"},
                    {"name": "Growth", "price": "$79/mo", "target": "Small teams", "seats": "5"},
                    {"name": "Pro", "price": "$199/mo", "target": "Studios", "seats": "Unlimited"},
                    {"name": "Enterprise", "price": "Custom", "target": "Agencies", "seats": "Unlimited"},
                ],
            },
            risk_items=[
                {"category": "Market", "risk": "Creator platform saturation", "severity": "High", "likelihood": "Medium", "mitigation": "Niche on underground/independent artists vs mainstream"},
                {"category": "Technical", "risk": "AI cost escalation", "severity": "Medium", "likelihood": "High", "mitigation": "Cache AI responses, switch to smaller models for routine tasks"},
                {"category": "Competitive", "risk": "Big platforms add native AI reporting", "severity": "High", "likelihood": "Medium", "mitigation": "Move upmarket to white-label enterprise offering"},
                {"category": "Financial", "risk": "Insufficient runway for paid growth", "severity": "High", "likelihood": "Low", "mitigation": "Organic + SEO-first distribution strategy"},
                {"category": "Operational", "risk": "Single-founder bus factor", "severity": "Critical", "likelihood": "Medium", "mitigation": "Document SOPs, automate ops, build async contractor relationships"},
            ],
            roadmap_items=[
                {"phase": "30 Days", "milestone": "PDF Report Engine v1 launch", "owner": "Engineering", "status": "In Progress"},
                {"phase": "30 Days", "milestone": "Growth Report AI — enterprise tier", "owner": "Product", "status": "Planned"},
                {"phase": "60 Days", "milestone": "Proposal PDF white-label licensing", "owner": "Sales", "status": "Planned"},
                {"phase": "60 Days", "milestone": "Underground social — 1K MAU", "owner": "Growth", "status": "In Progress"},
                {"phase": "90 Days", "milestone": "EV Betta — subscription monetization", "owner": "Product", "status": "Planned"},
                {"phase": "90 Days", "milestone": "B2B sales pipeline — 3 agency deals", "owner": "Sales", "status": "Not Started"},
            ],
            competitive_data=[
                {"competitor": "Notion AI Reports", "strength": "UX polish", "weakness": "No creator focus", "positioning": "General-purpose"},
                {"competitor": "Typeform Insights", "strength": "Survey integration", "weakness": "No AI narrative", "positioning": "Data collection"},
                {"competitor": "Tome", "strength": "Presentation AI", "weakness": "No enterprise PDF", "positioning": "Pitch decks"},
                {"competitor": "DevXCoder", "strength": "AI narrative + enterprise PDF + creator niche", "weakness": "Brand awareness", "positioning": "DIFFERENTIATED"},
            ],
            tech_stack=[
                {"layer": "Frontend", "tech": "Next.js 15 + TypeScript", "hosting": "Cloudflare Workers", "status": "Production"},
                {"layer": "Backend API", "tech": "Hono + TypeScript", "hosting": "Cloudflare Workers", "status": "Production"},
                {"layer": "Database", "tech": "Cloudflare D1 + Supabase", "hosting": "Edge + Cloud", "status": "Production"},
                {"layer": "Storage", "tech": "Cloudflare R2", "hosting": "Edge CDN", "status": "Production"},
                {"layer": "AI Engine", "tech": "OpenRouter + Ollama", "hosting": "Cloud + Local", "status": "Production"},
                {"layer": "PDF Engine", "tech": "Python ReportLab", "hosting": "Self-hosted", "status": "Building"},
                {"layer": "Auth", "tech": "FastAPI + JWT + Cloudflare SSO", "hosting": "Docker + Edge", "status": "Production"},
            ],
            ai_narratives={
                "ecosystem_insight": (
                    "The DevXCoder ecosystem demonstrates a rare quality in independent software: "
                    "architectural coherence across 7 deployed products. The edge-native stack "
                    "(Cloudflare Workers + D1 + R2) eliminates cold starts and reduces infrastructure "
                    "costs by ~70% versus comparable AWS deployments. This cost advantage compounds "
                    "as the creator audience scales — a structural moat that directly-funded competitors "
                    "operating on Kubernetes cannot easily replicate."
                ),
                "revenue_insight": (
                    "At $1,200 MRR with a 4% churn rate, DevXCoder is positioned in the 'validation "
                    "zone' — product-market fit signals are positive but distribution has not yet been "
                    "unlocked. The LTV:CAC ratio of 9.3x is elite-tier, indicating that each acquired "
                    "customer generates significant return. The primary constraint is top-of-funnel "
                    "volume, not conversion or retention. The recommended intervention: systematically "
                    "productize outbound content into SEO-indexed assets."
                ),
                "strategic_recommendation": (
                    "The single highest-leverage action for DevXCoder in the next 90 days is launching "
                    "the white-label PDF Report Engine as an agency-facing B2B product at $299-499/month. "
                    "This monetizes the existing infrastructure investment while establishing an enterprise "
                    "positioning that differentiates from consumer-grade AI tools. Three agencies at "
                    "$399/month each generates $1,197/month in new MRR — effectively doubling current "
                    "revenue from a single product line with minimal incremental infrastructure cost."
                ),
            },
        )


# ---------------------------------------------------------------------------
# Page templates (header/footer)
# ---------------------------------------------------------------------------


def _build_page_templates(doc: BaseDocTemplate, config: ReportConfig) -> list[PageTemplate]:
    margin = 0.65 * inch
    content_w = PAGE_W - 2 * margin
    content_h = PAGE_H - 2 * margin

    def _cover_frame() -> Frame:
        return Frame(0, 0, PAGE_W, PAGE_H, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)

    def _body_frame() -> Frame:
        return Frame(margin, margin + 0.3 * inch, content_w, content_h - 0.5 * inch, id="body")

    def _on_cover(canvas: Any, document: Any) -> None:
        canvas.saveState()
        # Full dark background
        canvas.setFillColor(C_NAVY)
        canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        # Accent stripe at bottom
        canvas.setFillColor(C_ACCENT)
        canvas.rect(0, 0, PAGE_W, 0.08 * inch, fill=1, stroke=0)
        # Decorative top stripe
        canvas.setFillColor(C_SLATE)
        canvas.rect(0, PAGE_H - 0.08 * inch, PAGE_W, 0.08 * inch, fill=1, stroke=0)
        canvas.restoreState()

    def _on_body(canvas: Any, document: Any) -> None:
        canvas.saveState()
        # Top header bar
        canvas.setFillColor(C_NAVY)
        canvas.rect(0, PAGE_H - 0.4 * inch, PAGE_W, 0.4 * inch, fill=1, stroke=0)
        canvas.setFillColor(C_WHITE)
        canvas.setFont(BOLD_FONT, 8)
        canvas.drawString(margin, PAGE_H - 0.25 * inch, config.company_name.upper())
        canvas.setFont(BODY_FONT, 7.5)
        canvas.drawRightString(PAGE_W - margin, PAGE_H - 0.25 * inch, config.report_type)
        # Bottom footer
        canvas.setFillColor(C_NAVY)
        canvas.rect(0, 0, PAGE_W, 0.35 * inch, fill=1, stroke=0)
        canvas.setFillColor(C_SUBTEXT)
        canvas.setFont(BODY_FONT, 7.5)
        canvas.drawString(margin, 0.12 * inch, config.confidentiality)
        canvas.drawRightString(PAGE_W - margin, 0.12 * inch, f"Page {document.page}")
        # Accent top-left corner
        canvas.setFillColor(C_ACCENT)
        canvas.rect(0, PAGE_H - 0.4 * inch, 0.04 * inch, 0.4 * inch, fill=1, stroke=0)
        canvas.restoreState()

    cover_template = PageTemplate(id="Cover", frames=[_cover_frame()], onPage=_on_cover)
    body_template = PageTemplate(id="Body", frames=[_body_frame()], onPage=_on_body)
    return [cover_template, body_template]


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------


class EnterpriseReportBuilder:
    """Builds the complete 16-section enterprise PDF flowable story."""

    def __init__(self, config: ReportConfig) -> None:
        self.config = config
        self.c = config
        self.story: list[Flowable] = []
        self.margin = 0.65 * inch
        self.content_w = PAGE_W - 2 * self.margin

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def _add(self, *items: Flowable) -> None:
        self.story.extend(items)

    def _section_break(self, number: str, title: str) -> None:
        self._add(
            Spacer(1, 10),
            SectionHeader(number, title, self.content_w),
            Spacer(1, 8),
        )

    def _h1(self, text: str) -> None:
        self._add(Paragraph(text, S["h1"]))

    def _h2(self, text: str) -> None:
        self._add(Paragraph(text, S["h2"]))

    def _h3(self, text: str) -> None:
        self._add(Paragraph(text, S["h3"]))

    def _body(self, text: str) -> None:
        self._add(Paragraph(text, S["body"]))

    def _bullet(self, text: str) -> None:
        self._add(Paragraph(f"• {text}", S["bullet"]))

    def _spacer(self, h: float = 8) -> None:
        self._add(Spacer(1, h))

    def _insight(self, title: str, body: str, accent: colors.Color = C_ACCENT) -> None:
        self._add(InsightBox(title, body, self.content_w, accent))
        self._spacer(6)

    def _hr(self) -> None:
        self._add(HRFlowable(width=self.content_w, thickness=0.5, color=C_BORDER, spaceAfter=6))

    def _narrative(self, section_key: str, fallback: str) -> None:
        text = self.c.ai_narratives.get(section_key, fallback)
        self._body(text)
        self._spacer(6)

    # ------------------------------------------------------------------
    # Section 1 — Cover Page
    # ------------------------------------------------------------------

    def _build_cover(self) -> None:
        self._add(Spacer(1, 1.8 * inch))

        # Logo
        if self.c.logo_base64:
            try:
                img_data = base64.b64decode(self.c.logo_base64)
                img_buf = io.BytesIO(img_data)
                logo_img = Image(img_buf, width=1.6 * inch, height=1.6 * inch)
                logo_img.hAlign = "CENTER"
                self._add(logo_img)
                self._spacer(16)
            except Exception:
                pass
        elif self.c.logo_path and Path(self.c.logo_path).exists():
            try:
                logo_img = Image(self.c.logo_path, width=1.6 * inch, height=1.6 * inch)
                logo_img.hAlign = "CENTER"
                self._add(logo_img)
                self._spacer(16)
            except Exception:
                pass
        else:
            # Text logo fallback
            self._add(ColorBox(self.content_w, 0.65 * inch, C_ACCENT, self.c.company_name.upper(), font_size=18))
            self._spacer(20)

        self._add(
            Paragraph(self.c.company_name, S["cover_title"]),
            Spacer(1, 10),
            Paragraph(self.c.report_type, S["cover_subtitle"]),
            Spacer(1, 6),
            Paragraph(self.c.tagline, S["cover_subtitle"]),
            Spacer(1, 40),
            Paragraph(
                f"Prepared by {self.c.prepared_by}&nbsp;&nbsp;|&nbsp;&nbsp;{self.c.generated_at}",
                S["cover_meta"],
            ),
            Spacer(1, 8),
            Paragraph(self.c.confidentiality, S["cover_meta"]),
        )
        self._add(PageBreak())

    # ------------------------------------------------------------------
    # Section 2 — Executive Bio
    # ------------------------------------------------------------------

    def _build_executive_bio(self) -> None:
        self._section_break("02", "Executive Bio")
        self._h2("Founder & Technical Lead")
        self._hr()
        bio = self.c.bio or (
            f"{self.c.company_name} is built by an independent full-stack engineer specializing in "
            "edge-native architecture, AI automation, and creator economy infrastructure."
        )
        self._body(bio)
        self._spacer(10)

    # ------------------------------------------------------------------
    # Section 3 — Executive Summary
    # ------------------------------------------------------------------

    def _build_executive_summary(self) -> None:
        self._section_break("03", "Executive Summary")
        summary = self.c.executive_summary or (
            f"{self.c.company_name} operates at the intersection of AI and {self.c.industry}. "
            "This report documents the current state, growth trajectory, and 90-day strategic roadmap."
        )
        self._body(summary)
        self._spacer(8)

        m = self.c.metrics
        if m:
            summary_data = [
                ["Metric", "Current Value", "Context"],
                ["MRR", f"${m.get('mrr', 0):,.0f}", f"Target: ${m.get('target_mrr', 0):,.0f}"],
                ["Active Users", f"{m.get('users', 0):,}", f"Growth: +{m.get('growth_rate', 0):.0%} MoM"],
                ["Churn Rate", f"{m.get('churn_rate', 0):.1%}", "Industry avg: 5-7%"],
                ["LTV:CAC", f"{m.get('ltv', 0) / max(m.get('cac', 1), 1):.1f}x", "Target: >3x"],
                ["NPS Score", str(m.get("nps", "N/A")), "Benchmark: 30+ = good"],
                ["Uptime", f"{m.get('uptime', 0):.2%}", "SLA target: 99.9%"],
            ]
            col_ws = [2.1 * inch, 1.5 * inch, self.content_w - 3.6 * inch]
            self._add(KeepTogether([_enterprise_table(summary_data, col_ws)]))
            self._spacer(8)

    # ------------------------------------------------------------------
    # Section 4 — Ecosystem Overview
    # ------------------------------------------------------------------

    def _build_ecosystem_overview(self) -> None:
        self._section_break("04", "Ecosystem Overview")
        self._h2("Platform Portfolio & Integration Map")
        self._hr()
        self._narrative(
            "ecosystem_insight",
            f"{self.c.company_name} operates a multi-product ecosystem designed for compounding "
            "network effects. Each product contributes to the shared distribution channel while "
            "generating independent revenue streams.",
        )

        # Infrastructure flow diagram
        self._add(*_make_flow_diagram(
            boxes=["Next.js 15\nFrontend", "CF Workers\nAPI", "AI APIs\nOpenRouter", "PDF Engine\nReportLab", "D1 + R2\nStorage", "Analytics\nLayer"],
            width=self.content_w,
            title="Infrastructure Architecture",
            caption="Edge-native stack: 0 cold starts, globally distributed, ~70% lower infra cost vs AWS equivalents.",
        ))

        # SaaS ecosystem map
        self._add(*_make_flow_diagram(
            boxes=["Growth\nReport AI", "Proposal\nPDF Engine", "Creator\nAnalytics", "Reporting\nSystems", "Automation\nTooling"],
            width=self.content_w,
            title="SaaS Ecosystem Map",
            caption="Five interconnected product lines sharing edge infrastructure, auth layer, and AI pipeline.",
        ))
        self._spacer(6)

    # ------------------------------------------------------------------
    # Section 5 — Technical Infrastructure Audit
    # ------------------------------------------------------------------

    def _build_tech_audit(self) -> None:
        self._section_break("05", "Technical Infrastructure Audit")
        self._h2("Stack Inventory & Deployment Status")
        self._hr()

        tech_stack = self.c.tech_stack or [
            {"layer": "Frontend", "tech": "Next.js 15", "hosting": "Cloudflare Workers", "status": "Production"},
            {"layer": "API", "tech": "Hono + TypeScript", "hosting": "Cloudflare Workers", "status": "Production"},
        ]

        headers = ["Layer", "Technology", "Hosting", "Status"]
        rows = [[s["layer"], s["tech"], s["hosting"], s["status"]] for s in tech_stack]
        data = [headers, *rows]
        col_ws = [1.3 * inch, 2.2 * inch, 1.8 * inch, 1.0 * inch]
        self._add(KeepTogether([_enterprise_table(data, col_ws)]))
        self._spacer(8)

        self._insight(
            "Infrastructure Insight",
            "Cloudflare Workers eliminates cold starts and provides global distribution at a "
            "fraction of traditional cloud costs. D1 + R2 replace PostgreSQL + S3 with "
            "edge-native equivalents. This stack is production-validated across 7 deployed products.",
            C_NAVY,
        )

        # AI workflow diagram
        self._add(*_make_flow_diagram(
            boxes=["User Input", "AI Processing\nOpenRouter", "Analytics\nGeneration", "Report\nGeneration", "PDF Export"],
            width=self.content_w,
            title="AI Workflow Architecture",
            caption="5-stage AI pipeline: input → LLM processing → analytics → report assembly → PDF export.",
        ))

    # ------------------------------------------------------------------
    # Section 6 — AI Systems Architecture
    # ------------------------------------------------------------------

    def _build_ai_architecture(self) -> None:
        self._section_break("06", "AI Systems Architecture")
        self._h2("AI Engine Components & Model Strategy")
        self._hr()

        ai_data = [
            ["Component", "Model / Stack", "Purpose", "Cost Tier"],
            ["Report Narrative", "OpenRouter / Gemini 2.0 Flash", "Strategic text generation", "$$"],
            ["Growth Analysis", "Ollama / Llama 3.2 (local)", "Data interpretation", "$"],
            ["Recommendations", "Claude Opus (Anthropic)", "Complex reasoning", "$$$"],
            ["Embeddings", "CF Workers AI (bge-base)", "Semantic memory search", "Free tier"],
            ["Moderation", "CF Workers AI", "Content safety filter", "Free tier"],
            ["PDF Assembly", "ReportLab (Python)", "Document rendering", "Compute only"],
        ]
        col_ws = [1.5 * inch, 2.0 * inch, 1.8 * inch, 0.9 * inch]
        self._add(KeepTogether([_enterprise_table(ai_data, col_ws)]))
        self._spacer(8)

        # PDF engine architecture diagram
        self._add(*_make_flow_diagram(
            boxes=["Dashboard\nLayer", "AI Analysis\nLayer", "PDF Renderer\nReportLab", "Export\nSystem", "Analytics\nEngine"],
            width=self.content_w,
            title="PDF Engine Architecture",
            caption="5-layer PDF generation pipeline with AI narrative injection at the analysis layer.",
        ))

        self._insight(
            "Cost Optimization Strategy",
            "Using Ollama for routine report generation (local inference, $0) with OpenRouter "
            "as fallback reduces AI costs by ~85%. Claude Opus is reserved for high-value "
            "strategic reasoning tasks where quality justifies the cost premium.",
            C_NAVY,
        )

    # ------------------------------------------------------------------
    # Section 7 — Creator Funnel Analysis
    # ------------------------------------------------------------------

    def _build_creator_funnel(self) -> None:
        self._section_break("07", "Creator Funnel Analysis")
        self._h2("Audience Acquisition & Conversion Pipeline")
        self._hr()

        funnel_stages = [
            ("YouTube Discovery", f"{self.c.audience_data.get('youtube_views', '45K')} views/mo"),
            ("Spotify Conversion", f"{self.c.audience_data.get('spotify_listeners', '8.2K')} monthly listeners"),
            ("Email Capture", f"{self.c.audience_data.get('email_subs', '1,240')} subscribers"),
            ("Platform Signup", f"{self.c.metrics.get('users', 340)} registered users"),
            ("Monetization", f"${self.c.metrics.get('mrr', 1200):,.0f} MRR"),
        ]

        self._add(*_make_funnel_diagram(
            stages=funnel_stages,
            width=self.content_w,
            title="Creator → Platform Monetization Funnel",
            caption="Discovery-to-revenue funnel showing conversion rates at each stage. Each stage represents measurable drop-off requiring optimization.",
        ))

        funnel_data = [
            ["Stage", "Volume", "Conv. Rate", "Key Action", "Optimization Lever"],
            ["YouTube Discovery", "45K views/mo", "18%", "Subscribe CTA", "Thumbnails + end screens"],
            ["Spotify Listeners", "8.2K/mo", "15%", "Bio link click", "Smart link optimization"],
            ["Email Subscribers", "1,240 total", "27%", "Platform signup", "Lead magnet + welcome flow"],
            ["Active Platform Users", "340 MAU", "35%", "Feature adoption", "Onboarding sequence"],
            ["Paying Customers", "~41", "12%", "Upgrade CTA", "Value moment identification"],
        ]
        col_ws = [1.4 * inch, 1.2 * inch, 1.0 * inch, 1.4 * inch, self.content_w - 5.0 * inch]
        self._add(KeepTogether([_enterprise_table(funnel_data, col_ws)]))

    # ------------------------------------------------------------------
    # Section 8 — Audience Analytics
    # ------------------------------------------------------------------

    def _build_audience_analytics(self) -> None:
        self._section_break("08", "Audience Analytics")
        self._h2("Demographic Profile & Behavioral Patterns")
        self._hr()

        geo_data = [
            ["Market", "% Audience", "Engagement Rate", "Monetization Index"],
            ["United States", "38%", "4.2%", "1.8x"],
            ["Canada", "12%", "5.1%", "1.6x"],
            ["United Kingdom", "9%", "4.8%", "1.5x"],
            ["France", "7%", "6.3%", "0.9x"],
            ["Other", "34%", "3.1%", "0.7x"],
        ]
        col_ws = [2.0 * inch, 1.2 * inch, 1.4 * inch, self.content_w - 4.6 * inch]
        self._add(Paragraph("Geographic Distribution", S["h3"]))
        self._add(KeepTogether([_enterprise_table(geo_data, col_ws)]))
        self._spacer(8)

        platform_labels = ["YouTube", "Spotify", "Email List", "Underground", "TikTok"]
        platform_vals = [45000, 8200, 1240, 340, 2800]
        self._add(*_make_bar_chart(
            labels=platform_labels,
            values=platform_vals,
            width=self.content_w,
            title="Audience Size by Platform",
            caption="Cross-platform reach comparison. YouTube represents primary discovery layer; email list is highest-intent owned audience.",
        ))

    # ------------------------------------------------------------------
    # Section 9 — KPI Dashboard
    # ------------------------------------------------------------------

    def _build_kpi_dashboard(self) -> None:
        self._section_break("09", "KPI Dashboard")
        self._h2("Scorecard — Maturity Ratings & Performance Trends")
        self._hr()

        kpis = self.c.kpis
        if kpis:
            self._add(KeepTogether([_kpi_scorecard(kpis, self.content_w)]))
            self._spacer(8)

        maturity_data = [
            ["KPI Dimension", "Current Score", "Maturity Level", "Industry Benchmark", "Gap"],
            ["Revenue Generation", "6/10", "Developing", "7.5/10", "-1.5"],
            ["User Acquisition", "5/10", "Initial", "7.0/10", "-2.0"],
            ["Product Retention", "8/10", "Advanced", "6.5/10", "+1.5"],
            ["Infrastructure", "9/10", "Optimized", "7.0/10", "+2.0"],
            ["AI Integration", "7/10", "Advanced", "5.5/10", "+1.5"],
            ["Brand Awareness", "4/10", "Initial", "6.0/10", "-2.0"],
            ["Distribution", "5/10", "Developing", "6.5/10", "-1.5"],
            ["Monetization Depth", "6/10", "Developing", "7.0/10", "-1.0"],
        ]
        col_ws = [2.0 * inch, 1.0 * inch, 1.2 * inch, 1.4 * inch, 0.6 * inch]
        self._add(KeepTogether([_enterprise_table(maturity_data, col_ws)]))

    # ------------------------------------------------------------------
    # Section 10 — Revenue Projections
    # ------------------------------------------------------------------

    def _build_revenue_projections(self) -> None:
        self._section_break("10", "Revenue Projections")
        self._h2("MRR Scenarios, Pricing Architecture & Scaling Models")
        self._hr()

        rev = self.c.revenue_projections
        scenarios = rev.get("scenarios", {})
        months = rev.get("months", ["M1", "M2", "M3", "M6"])
        current = rev.get("current_mrr", self.c.metrics.get("mrr", 0))

        if scenarios:
            proj_headers = ["Scenario", *months, "Rationale"]
            rows = []
            for scenario_name, values in scenarios.items():
                row = [scenario_name.capitalize()] + [f"${v:,.0f}" for v in values]
                rationale = {
                    "conservative": "Organic only, no paid channels",
                    "moderate": "SEO + 1 paid channel + outbound",
                    "aggressive": "Full growth stack + agency deals",
                }.get(scenario_name.lower(), "")
                row.append(rationale)
                rows.append(row)
            proj_data = [proj_headers, *rows]
            month_w = (self.content_w - 2.0 * inch - 2.0 * inch) / len(months)
            col_ws = [1.5 * inch] + [month_w] * len(months) + [2.0 * inch]
            self._add(KeepTogether([_enterprise_table(proj_data, col_ws)]))
            self._spacer(8)

        self._add(*_make_bar_chart(
            labels=["Current", "Conservative 6mo", "Moderate 6mo", "Aggressive 6mo"],
            values=[
                current,
                scenarios.get("conservative", [0, 0, 0, current * 2])[-1],
                scenarios.get("moderate", [0, 0, 0, current * 4])[-1],
                scenarios.get("aggressive", [0, 0, 0, current * 9])[-1],
            ],
            width=self.content_w,
            title="6-Month MRR Projection Comparison",
            caption="Three-scenario revenue forecast anchored to current $1,200 MRR baseline. Moderate scenario assumes SEO + outbound activation.",
            unit="",
        ))

        pricing_tiers = rev.get("pricing_tiers", [])
        if pricing_tiers:
            self._h3("Pricing Tier Architecture")
            pt_headers = ["Tier", "Price", "Target Customer", "Seats"]
            pt_rows = [[t["name"], t["price"], t["target"], t["seats"]] for t in pricing_tiers]
            pt_data = [pt_headers, *pt_rows]
            col_ws = [1.2 * inch, 1.0 * inch, 2.4 * inch, self.content_w - 4.6 * inch]
            self._add(KeepTogether([_enterprise_table(pt_data, col_ws)]))

        self._spacer(6)
        self._narrative(
            "revenue_insight",
            "Revenue trajectory is constrained by distribution, not product quality. "
            "The LTV:CAC ratio indicates strong unit economics — the growth lever is "
            "top-of-funnel volume rather than conversion optimization.",
        )

    # ------------------------------------------------------------------
    # Section 11 — Monetization Strategy
    # ------------------------------------------------------------------

    def _build_monetization_strategy(self) -> None:
        self._section_break("11", "Monetization Strategy")
        self._h2("Revenue Stream Architecture & Expansion Opportunities")
        self._hr()

        streams_data = [
            ["Revenue Stream", "Current MRR", "Potential MRR", "Effort", "Priority"],
            ["Growth Report AI — SaaS", "$600", "$4,500", "Low", "P0"],
            ["PDF Report Engine — B2B", "$0", "$3,200", "Medium", "P0"],
            ["Underground Platform — Sub.", "$200", "$2,800", "Medium", "P1"],
            ["EV Betta — Subscription", "$400", "$1,800", "Low", "P1"],
            ["White-Label Licensing", "$0", "$5,000", "High", "P2"],
            ["Agency Partnerships", "$0", "$3,500", "High", "P2"],
        ]
        col_ws = [2.0 * inch, 1.0 * inch, 1.1 * inch, 0.8 * inch, 0.8 * inch]
        self._add(KeepTogether([_enterprise_table(streams_data, col_ws)]))
        self._spacer(8)

        self._insight(
            "Monetization Priority",
            "PDF Report Engine B2B launch represents the highest-leverage near-term opportunity: "
            "zero incremental infrastructure cost, clear agency buyer persona, and direct path to "
            "$3,200+ MRR within 60 days. Three agency clients at $399/month each nearly doubles "
            "current total MRR.",
            C_ACCENT,
        )

    # ------------------------------------------------------------------
    # Section 12 — Risk Assessment
    # ------------------------------------------------------------------

    def _build_risk_assessment(self) -> None:
        self._section_break("12", "Risk Assessment")
        self._h2("Risk Register & Mitigation Strategies")
        self._hr()

        risks = self.c.risk_items or [
            {"category": "Technical", "risk": "AI cost spike", "severity": "Medium", "likelihood": "High", "mitigation": "Cache responses, use smaller models"},
            {"category": "Market", "risk": "Platform saturation", "severity": "High", "likelihood": "Medium", "mitigation": "Niche positioning"},
        ]

        risk_headers = ["Category", "Risk", "Severity", "Likelihood", "Mitigation Strategy"]
        risk_rows = [[r["category"], r["risk"], r["severity"], r["likelihood"], r["mitigation"]] for r in risks]
        risk_data = [risk_headers, *risk_rows]
        col_ws = [1.0 * inch, 1.6 * inch, 0.85 * inch, 0.85 * inch, self.content_w - 4.3 * inch]
        self._add(KeepTogether([_enterprise_table(risk_data, col_ws)]))
        self._spacer(10)

        # Risk matrix
        self._add(*_make_matrix_diagram(
            rows=["Low", "Medium", "High", "Critical"],
            cols=["Unlikely", "Possible", "Likely", "Certain"],
            cells={
                (0, 0): "Low", (0, 1): "Low-Med",
                (1, 0): "Low-Med", (1, 1): "Medium", (1, 2): "Med-High",
                (2, 1): "Medium", (2, 2): "High", (2, 3): "Critical",
                (3, 2): "Critical", (3, 3): "Stop",
            },
            width=self.content_w,
            title="Risk Severity x Likelihood Matrix",
            caption="Color-coded risk matrix: green (acceptable) → red (immediate mitigation required). Current risk profile: 1 Critical (bus factor), 2 High (market + AI cost).",
        ))

    # ------------------------------------------------------------------
    # Section 13 — Competitive Positioning
    # ------------------------------------------------------------------

    def _build_competitive_positioning(self) -> None:
        self._section_break("13", "Competitive Positioning")
        self._h2("Market Landscape & Differentiation Analysis")
        self._hr()

        comp = self.c.competitive_data or []
        if comp:
            comp_headers = ["Competitor", "Core Strength", "Key Weakness", "Market Positioning"]
            comp_rows = [[c["competitor"], c["strength"], c["weakness"], c["positioning"]] for c in comp]
            comp_data = [comp_headers, *comp_rows]
            col_ws = [1.5 * inch, 1.8 * inch, 1.8 * inch, self.content_w - 5.1 * inch]
            self._add(KeepTogether([_enterprise_table(comp_data, col_ws)]))
            self._spacer(8)

        self._insight(
            "Differentiation Moat",
            f"{self.c.company_name} occupies a rare position: enterprise-grade PDF reports with "
            "AI narrative generation, focused on the creator economy. No direct competitor "
            "combines all three elements. This creates a defensible niche where "
            "switching costs are high (custom narratives + existing data integrations).",
            C_NAVY,
        )

    # ------------------------------------------------------------------
    # Section 14 — SaaS Expansion Strategy
    # ------------------------------------------------------------------

    def _build_saas_strategy(self) -> None:
        self._section_break("14", "SaaS Expansion Strategy")
        self._h2("Product-Led Growth & Enterprise Expansion Roadmap")
        self._hr()

        saas_data = [
            ["Growth Lever", "Tactic", "Timeline", "Target Metric", "Owner"],
            ["SEO Content", "Publish 10 AI report case studies", "30 days", "+500 organic visitors/mo", "Marketing"],
            ["Agency Outreach", "Cold email 50 creative agencies", "30 days", "3 demo calls", "Sales"],
            ["White-Label", "Build white-label PDF branding API", "60 days", "1 agency reseller", "Engineering"],
            ["Product Hunt", "Launch PDF Engine as new product", "45 days", "500 upvotes, 100 signups", "Marketing"],
            ["Partnership", "Integrate with Notion/Figma", "90 days", "300 referral users", "BD"],
            ["Enterprise", "SOC2 Type I compliance start", "90 days", "Unlock enterprise buyers", "Legal/Eng"],
        ]
        col_ws = [1.4 * inch, 2.0 * inch, 0.85 * inch, 1.5 * inch, 0.85 * inch]
        self._add(KeepTogether([_enterprise_table(saas_data, col_ws)]))
        self._spacer(8)

        self._body(
            "The SaaS expansion strategy centers on the 'land and expand' model: "
            "acquire agencies with a competitive-priced entry tier, then expand to white-label "
            "licensing at 5-10x the base price. Each agency relationship represents a "
            "distribution channel amplifier — an agency with 20 clients generates $20K+ ARR "
            "from a single partnership."
        )

    # ------------------------------------------------------------------
    # Section 15 — 30/60/90 Day Roadmap
    # ------------------------------------------------------------------

    def _build_roadmap(self) -> None:
        self._section_break("15", "30/60/90 Day Roadmap")
        self._h2("Execution Calendar & Milestone Tracker")
        self._hr()

        roadmap = self.c.roadmap_items or [
            {"phase": "30 Days", "milestone": "PDF Engine v1 launch", "owner": "Engineering", "status": "In Progress"},
        ]
        road_headers = ["Phase", "Milestone", "Owner", "Status"]
        road_rows = [[r["phase"], r["milestone"], r["owner"], r["status"]] for r in roadmap]
        road_data = [road_headers, *road_rows]

        col_ws = [0.85 * inch, 2.8 * inch, 1.1 * inch, 1.0 * inch]
        self._add(KeepTogether([_enterprise_table(road_data, col_ws)]))
        self._spacer(8)

        # Phase summary
        for phase_label, phase_color in [("30 Days", C_ACCENT), ("60 Days", C_GOLD), ("90 Days", C_GREEN)]:
            phase_items = [r for r in roadmap if r["phase"] == phase_label]
            if phase_items:
                self._add(ColorBox(self.content_w, 0.3 * inch, phase_color, f"PHASE — {phase_label}", font_size=9))
                for item in phase_items:
                    self._bullet(f"[{item['owner']}] {item['milestone']} — {item['status']}")
                self._spacer(4)

    # ------------------------------------------------------------------
    # Section 16 — Final Strategic Recommendation
    # ------------------------------------------------------------------

    def _build_recommendation(self) -> None:
        self._section_break("16", "Final Strategic Recommendation")
        self._h2("Executive Decision Brief")
        self._hr()

        self._narrative(
            "strategic_recommendation",
            f"The highest-leverage action for {self.c.company_name} in the next 90 days is "
            "launching white-label enterprise reporting as a B2B product. This monetizes "
            "existing infrastructure while establishing enterprise positioning that differentiates "
            "from consumer AI tools.",
        )

        self._spacer(10)
        self._h3("Top 5 Immediate Actions")
        top5 = [
            "Launch PDF Report Engine to Product Hunt — target 500+ upvotes to drive organic signups",
            "Cold email 50 creative agencies with a free sample report — convert 3+ to paid at $399/mo",
            "Publish 2 AI report case studies per week to build SEO authority in 'AI business report' SERP",
            "Instrument all funnel stages with analytics events — identify the single highest drop-off point",
            "Document the full product SOPs and build an async contractor onboarding kit to eliminate bus factor",
        ]
        for item in top5:
            self._bullet(item)

        self._spacer(12)
        self._insight(
            "Final Verdict",
            f"{self.c.company_name} has elite-tier unit economics (LTV:CAC 9.3x), production-grade "
            "infrastructure, and a differentiated product position. The gap between current state "
            "and $15K MRR is distribution — not product quality, not retention, not architecture. "
            "Ship the B2B sales motion in 30 days. Everything else is secondary.",
            C_ACCENT,
        )

    # ------------------------------------------------------------------
    # TOC
    # ------------------------------------------------------------------

    def _build_toc(self) -> None:
        toc_data = [
            ["#", "Section", "Description"],
            ["01", "Cover Page", "Company identity, report metadata"],
            ["02", "Executive Bio", "Founder profile and background"],
            ["03", "Executive Summary", "Key metrics snapshot and thesis"],
            ["04", "Ecosystem Overview", "Platform portfolio and architecture"],
            ["05", "Technical Infrastructure Audit", "Stack inventory and deployment status"],
            ["06", "AI Systems Architecture", "Model strategy and AI pipeline"],
            ["07", "Creator Funnel Analysis", "Audience acquisition pipeline"],
            ["08", "Audience Analytics", "Demographics and behavioral data"],
            ["09", "KPI Dashboard", "Maturity ratings and performance scorecards"],
            ["10", "Revenue Projections", "MRR scenarios and pricing ladder"],
            ["11", "Monetization Strategy", "Revenue stream architecture"],
            ["12", "Risk Assessment", "Risk register and mitigation matrix"],
            ["13", "Competitive Positioning", "Market landscape and differentiation"],
            ["14", "SaaS Expansion Strategy", "Product-led growth roadmap"],
            ["15", "30/60/90 Day Roadmap", "Execution calendar and milestones"],
            ["16", "Final Strategic Recommendation", "Executive decision brief"],
        ]
        col_ws = [0.4 * inch, 2.2 * inch, self.content_w - 2.6 * inch]
        self._add(
            Paragraph("Table of Contents", S["h1"]),
            Spacer(1, 8),
            _enterprise_table(toc_data, col_ws),
            PageBreak(),
        )

    # ------------------------------------------------------------------
    # Build full story
    # ------------------------------------------------------------------

    def build(self) -> list[Flowable]:
        """Assemble all 16 sections and return the ReportLab story list."""
        self._build_cover()
        self._build_toc()
        self._build_executive_bio()
        self._build_executive_summary()
        self._build_ecosystem_overview()
        self._build_tech_audit()
        self._build_ai_architecture()
        self._build_creator_funnel()
        self._build_audience_analytics()
        self._build_kpi_dashboard()
        self._build_revenue_projections()
        self._build_monetization_strategy()
        self._build_risk_assessment()
        self._build_competitive_positioning()
        self._build_saas_strategy()
        self._build_roadmap()
        self._build_recommendation()
        return self.story


# ---------------------------------------------------------------------------
# Report type variant metadata (informational — used by callers for labeling)
# ---------------------------------------------------------------------------

_REPORT_TYPE_OVERRIDES: dict[str, dict[str, Any]] = {
    "AI Startup Audit": {
        "cover_accent": "Emphasizes technical infrastructure, AI systems, monetization potential",
    },
    "Creator Growth Report": {
        "cover_accent": "Emphasizes audience funnel, platform presence, monetization opportunities",
    },
    "Enterprise Strategic Audit": {
        "cover_accent": "Emphasizes operational scale, market positioning, risk analysis",
    },
    "SaaS Growth Analysis": {
        "cover_accent": "Emphasizes pricing models, customer segmentation, scaling roadmap",
    },
}


# ---------------------------------------------------------------------------
# PDF rendering
# ---------------------------------------------------------------------------


def generate_pdf(config: ReportConfig, output_path: str | Path) -> Path:
    """Render the full 16-section enterprise PDF to output_path.

    Args:
        config: Populated ReportConfig instance.
        output_path: Destination file path (created with parent dirs as needed).

    Returns:
        Resolved Path to the written PDF file.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    doc = BaseDocTemplate(
        str(output_path),
        pagesize=LETTER,
        leftMargin=0.65 * inch,
        rightMargin=0.65 * inch,
        topMargin=0.65 * inch,
        bottomMargin=0.65 * inch,
        title=f"{config.company_name} — {config.report_type}",
        author=config.prepared_by,
        subject=config.tagline,
        creator="PDF Report Engine v1.0",
        allowSplitting=1,
    )

    templates = _build_page_templates(doc, config)
    doc.addPageTemplates(templates)

    builder = EnterpriseReportBuilder(config)
    story = builder.build()

    # Use cover template for page 1, body for the rest
    story.insert(0, _NextTemplate("Cover"))
    # Insert template switch after cover page break (after first PageBreak)
    for i, item in enumerate(story):
        if isinstance(item, PageBreak):
            story.insert(i + 1, _NextTemplate("Body"))
            break

    doc.build(story)
    return output_path


class _NextTemplate(Flowable):
    """Flowable that switches the active page template mid-document."""

    def __init__(self, template_name: str) -> None:
        super().__init__()
        self.template_name = template_name
        self.width = 0
        self.height = 0

    def draw(self) -> None:
        pass

    def beforeDrawOn(self, canvas: Any, doc: Any) -> None:  # noqa: N802 — ReportLab override
        canvas.setPageCallBack(lambda c: None)

    def wrap(self, avail_w: float, avail_h: float) -> tuple[float, float]:
        self.canv.doForm  # noqa: B018
        return 0, 0


# ---------------------------------------------------------------------------
# Preview (first-page PNG via PyMuPDF or pdf2image / Pillow fallback)
# ---------------------------------------------------------------------------


def generate_preview(config: ReportConfig, output_path: str | Path, dpi: int = 120) -> tuple[Path, int]:
    """Render full PDF to a temp buffer, then rasterize the first page to PNG.

    Args:
        config: Populated ReportConfig instance.
        output_path: Destination PNG path.
        dpi: Rasterization resolution (default 120 dpi).

    Returns:
        Tuple of (png_path, page_count).
    """
    import tempfile

    output_path = Path(output_path)

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_pdf = Path(tmp.name)

    generate_pdf(config, tmp_pdf)

    # Count pages and rasterize first page.
    # PyMuPDF (fitz) is preferred; falls back to pdf2image / Pillow.
    page_count = 16  # default estimate
    try:
        import fitz  # PyMuPDF — optional
        doc = fitz.open(str(tmp_pdf))
        page_count = len(doc)
        # Rasterize first page
        page = doc[0]
        zoom = dpi / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        pix.save(str(output_path))
        doc.close()
    except ImportError:
        # Fallback: use pdf2image / poppler
        try:
            from pdf2image import convert_from_path  # type: ignore

            images = convert_from_path(str(tmp_pdf), dpi=dpi, first_page=1, last_page=1)
            if images:
                images[0].save(str(output_path), "PNG")
        except Exception:
            # Last resort: blank white PNG via Pillow
            try:
                from PIL import Image as PILImage

                img = PILImage.new("RGB", (850, 1100), color=(255, 255, 255))
                img.save(str(output_path))
            except Exception:
                pass

    tmp_pdf.unlink(missing_ok=True)
    return output_path, page_count
