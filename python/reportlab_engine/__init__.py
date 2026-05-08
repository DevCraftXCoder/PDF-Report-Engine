"""
reportlab_engine — Enterprise PDF Report Engine using ReportLab.

Generates 16-section enterprise PDF reports with diagrams, KPI scorecards,
revenue projections, and AI-generated strategic narratives.
"""

from reportlab_engine.engine import ReportConfig, generate_pdf, generate_preview

__all__ = [
    "ReportConfig",
    "generate_preview",
    "generate_report",
]


def generate_report(config: ReportConfig, output_path: str) -> str:
    """Generate a PDF report and return the output path as a string.

    This is the primary public entry point for programmatic use.

    Args:
        config: Populated ReportConfig instance.
        output_path: Destination file path for the PDF.

    Returns:
        Absolute path to the written PDF file.
    """
    result = generate_pdf(config, output_path)
    return str(result)
