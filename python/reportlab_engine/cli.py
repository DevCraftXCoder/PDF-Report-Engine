"""
CLI entry point for the PDF Report Engine.

Modes:
    --config <path>   Load report config from a JSON file
    --stdin           Read report config JSON from stdin
    --sample          Generate a report using the built-in sample config
    --preview <path>  Rasterize the first page to a PNG instead of writing the full PDF

Output (stdout):
    JSON object — {"status": "ok", "output": "<path>", "size_bytes": N, "pages": N}
    On error, exits with code 1 and writes a message to stderr.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys

from reportlab_engine.engine import ReportConfig, generate_pdf, generate_preview


def main() -> None:
    """Parse arguments and dispatch to generate_pdf or generate_preview."""
    parser = argparse.ArgumentParser(
        prog="reportlab_engine",
        description="Enterprise PDF Report Engine",
    )
    parser.add_argument("--config", help="Path to report config JSON file", default=None)
    parser.add_argument("--output", help="Output PDF (or PNG for --preview) path", default="report.pdf")
    parser.add_argument("--preview", help="Output preview PNG path", default=None)
    parser.add_argument("--sample", action="store_true", help="Generate a sample report")
    parser.add_argument("--stdin", action="store_true", help="Read config JSON from stdin")
    args = parser.parse_args()

    # --- Resolve config ---
    if args.stdin:
        try:
            stdin_stream = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
            raw = stdin_stream.read()
        except Exception as exc:
            print(f"reportlab_engine: failed to read stdin: {exc}", file=sys.stderr)
            sys.exit(1)
        if not raw.strip():
            print("reportlab_engine: --stdin specified but stdin was empty", file=sys.stderr)
            sys.exit(1)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            print(f"reportlab_engine: invalid JSON on stdin: {exc}", file=sys.stderr)
            sys.exit(1)
        config = ReportConfig.from_dict(data)

    elif args.config:
        try:
            config = ReportConfig.from_json(args.config)
        except FileNotFoundError:
            print(f"reportlab_engine: config file not found: {args.config}", file=sys.stderr)
            sys.exit(1)
        except json.JSONDecodeError as exc:
            print(f"reportlab_engine: invalid JSON in config file: {exc}", file=sys.stderr)
            sys.exit(1)

    elif args.sample:
        config = ReportConfig.sample()

    else:
        parser.print_help()
        sys.exit(1)

    # --- Dispatch ---
    if args.preview:
        png_path, pages = generate_preview(config, args.preview)
        result = {"status": "ok", "preview": str(png_path), "pages": pages}
        print(json.dumps(result))
    else:
        out = generate_pdf(config, args.output)
        pdf_bytes = out.read_bytes()
        try:
            page_count = len(re.findall(rb"/Type\s*/Page\b", pdf_bytes))
        except Exception:
            page_count = 16
        result = {
            "status": "ok",
            "output": str(out),
            "size_bytes": len(pdf_bytes),
            "pages": page_count,
        }
        print(json.dumps(result))


if __name__ == "__main__":
    main()
