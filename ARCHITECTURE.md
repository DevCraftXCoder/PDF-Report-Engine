# PDF Report Engine — Architecture

> Full diagrams and narrative are a separate task. This is the structural outline.

---

## System Overview

```
JSON Config Input
      |
      v
Next.js API Route (/api/routes/)
      |
      v (child_process spawn)
Python ReportLab Engine (python/reportlab_engine/)
      |
      v
PDF / PNG / DOCX Output
      |
      v
React Component (components/) — live preview + export
```

---

## Layers

| Layer | Path | Technology | Responsibility |
|-------|------|-----------|----------------|
| Engine | `python/reportlab_engine/` | Python 3.8+, ReportLab 4.5 | PDF rendering, diagrams, layouts |
| API | `api/routes/` | Next.js 16, TypeScript | generate, preview, export handlers |
| UI | `components/` | React 19, TypeScript | 4-step workflow, live preview |
| Types | `types/` | TypeScript | Shared interfaces for config + output |
| Tests | `tests/` | pytest + jest | Unit + integration stubs |
| Docs | `docs/` | Markdown | Architecture diagrams, ADRs |

---

## Data Flow

### Generate (POST /api/generate)

1. Client submits `ReportConfig` JSON
2. API route validates input, applies rate limit
3. Spawns Python engine via `child_process.spawn`
4. Engine reads JSON from stdin, renders PDF to temp file
5. API streams PDF buffer back as `application/pdf`

### Preview (POST /api/preview)

1. Same flow as generate
2. Engine returns base64-encoded PNG of first page
3. React component renders inline for live preview

### Export (POST /api/export)

1. Supports `pdf` and `docx` format targets
2. DOCX output uses ReportLab-generated PDF converted via python-docx (planned)
3. Triggers browser download via `Content-Disposition: attachment`

---

## Python Package Structure

```
python/
  reportlab_engine/
    __init__.py        — public API surface
    cli.py             — CLI entrypoint (pdf-report command)
    engine.py          — core PDF generation logic
    sections/          — one module per report section (cover, bio, kpi, etc.)
    diagrams/          — diagram renderers (flow, funnel, bar, matrix)
    themes/            — color palettes and typography presets
    utils.py           — shared helpers (color, measurement, text)
  tests/
    test_engine.py     — engine unit tests
    test_sections.py   — section rendering tests
    test_cli.py        — CLI integration tests
    fixtures/          — sample JSON configs + expected output checksums
```

---

## Node.js Package Structure

```
api/routes/
  generate.ts          — POST handler: spawn Python, stream PDF
  preview.ts           — POST handler: spawn Python, return base64 PNG
  export.ts            — POST handler: spawn Python, stream download

components/
  PdfReportBuilder.tsx — 4-step wizard component
  SectionPreview.tsx   — live preview panel
  ExportPanel.tsx      — format selector + download buttons

types/
  report.ts            — ReportConfig, SectionConfig, OutputFormat
  api.ts               — Request/response interfaces for all routes
```

---

## Security

- No secrets in source — all env via `.env`
- Rate limiting on generate + export endpoints (5 req/hr per user)
- Auth: reuses existing admin_auth / mizzy_auth cookie pattern
- Python subprocess: `--` separator before all user-supplied paths
- Output temp files in `_runs/` (gitignored), cleaned after response

---

## Diagram Index

<!-- Full Mermaid/PNG diagrams — separate task -->

1. System architecture (client → API → Python → output)
2. PDF section layout map (16 sections, page flow)
3. Data schema (ReportConfig → sections → diagrams)
4. CI/CD pipeline (lint → test → build → publish npm + PyPI)
