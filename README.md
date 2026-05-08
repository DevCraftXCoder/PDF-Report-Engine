# PDF Report Engine — Enterprise PDF Generation with Python + React

![Python 3.8+](https://img.shields.io/badge/Python-3.8%2B-blue?logo=python&logoColor=white)
![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow)

Dual Python + Node.js package for enterprise-grade PDF report generation. The Python layer renders multi-section PDFs with ReportLab; the Node.js layer exposes three API routes and a React component that wires them into a 4-step workflow UI.

---

## Quick Start

### Python

Install the engine from PyPI:

```
pip install reportlab-engine
```

Generate a sample report to verify the install:

```python
from reportlab_engine import generate_report
from reportlab_engine.engine import ReportConfig

config = ReportConfig.from_json("examples/sample-config.json")
generate_report(config, "output.pdf")
```

Expected output files:

```
output.pdf           — full multi-section PDF report
_runs/               — temp directory, auto-cleaned after generation
```

### Node.js

Install the package from npm:

```
npm install pdf-report-engine
```

Add the component to your Next.js app (App Router):

```tsx
"use client";

import { PanelPDFReportEngine } from "pdf-report-engine/components";
import type { ReportConfig } from "pdf-report-engine/types";

export default function ReportPage() {
  async function handlePreview(config: ReportConfig): Promise<string | null> {
    const res = await fetch("/api/pdf-report/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify(config.formData),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.preview; // data:image/png;base64,...
  }

  function handleExport(config: ReportConfig, format: "pdf" | "docx") {
    // trigger your export route
  }

  return (
    <PanelPDFReportEngine
      onPreview={handlePreview}
      onExport={handleExport}
    />
  );
}
```

---

## Architecture

The engine follows a single data path: a JSON config object flows from the browser into a Next.js API route, which validates the input and spawns a Python child process. The Python engine reads the config from stdin, renders the PDF with ReportLab, writes it to a temp file, and exits. The API route reads the temp file, streams it back as `application/pdf`, and deletes the temp file. The React component drives this through a 4-step wizard and surfaces a live PNG preview before the final export.

```
Browser (React component)
    |  POST JSON config
    v
Next.js API Route (Node.js runtime)
    |  child_process.spawn, config via stdin
    v
Python ReportLab Engine
    |  writes to _runs/<name>_<timestamp>.pdf
    v
API Route reads file → streams PDF → deletes temp file
    |
    v
Browser receives application/pdf download
```

---

## Components

### 1. Python Engine (`python/reportlab_engine/`)

Generates 16-section enterprise PDF reports from a JSON config object. Sections include: cover page, executive summary, company bio, KPI scorecard, revenue projections, competitive analysis, tech stack audit, risk matrix, roadmap, audience data, and AI-generated narrative sections.

**Input:** JSON config object (passed via stdin with `--stdin` flag, or loaded from a file with `--config`). See `examples/sample-config.json` for the full schema.

**Output:** PDF file written to the path specified by `--output`. When called with `--preview`, writes a base64-encoded PNG of page 1 to the specified path and prints `{"pages": N}` to stdout.

Key public API:

```python
from reportlab_engine import generate_report, generate_preview
from reportlab_engine.engine import ReportConfig

# Programmatic use
config = ReportConfig.from_json("report_config.json")
generate_report(config, "report.pdf")

# Preview (returns base64 PNG string)
png_b64 = generate_preview(config)
```

**Dependencies:** `reportlab==4.5.0`, `Pillow>=10.0.0`, `python-dotenv>=1.0.0`

### 2. API Routes (`api/routes/`)

Three Next.js App Router route handlers, all running on the Node.js runtime (not the Edge runtime — required for `child_process`).

| Route | Method | Description | Auth |
|-------|--------|-------------|------|
| `POST /api/pdf-report/generate` | POST | Spawns Python engine, returns raw PDF binary | Required + subscription gate |
| `POST /api/pdf-report/preview` | POST | Spawns Python engine in preview mode, returns base64 PNG | Required (no subscription gate) |
| `POST /api/pdf-report/export` | POST | Re-serves a previously generated PDF, or converts to DOCX | Required + subscription gate |
| `POST /api/pdf-report/activate` | POST | Issues `report_engine_uid` cookie after Stripe checkout | Required |

All routes require:
- `X-Requested-With: XMLHttpRequest` header (CSRF guard)
- `admin_auth` or `mizzy_auth` session cookie (auth placeholder — replace with your own)

Rate limit on `/generate`: 5 requests per hour per IP.

### 3. React UI Component (`components/PanelPDFReportEngine.tsx`)

A self-contained 4-step wizard that drives the full report workflow.

**Steps:**
1. Company / Project — name, industry, description, logo upload
2. Data Sources — web URLs, integration toggles, data connectors
3. AI Analysis Engine — analysis type selection (competitive, growth, risk, market, technical, financial), depth level, confidence threshold, tone
4. Structure + Export — section toggles, PDF/DOCX/PPT export buttons, live preview panel

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `onAnalyze` | `(config: ReportConfig) => void` | Called when user triggers AI analysis in Step 3 |
| `onPreview` | `(config: ReportConfig) => Promise<string \| null>` | Called to fetch a PNG preview; return value is injected as `previewUrl` |
| `onExport` | `(config: ReportConfig, format: "pdf" \| "docx" \| "ppt") => void` | Called when user clicks an export button |
| `previewUrl` | `string \| null` | External preview image URL, controlled by parent |
| `isAnalyzing` | `boolean` | Whether analysis is in progress (shows loading state) |

---

## Project Structure

```
C:/Za/PDF-Report-Engine/
├── api/
│   └── routes/
│       ├── activate.ts       — POST /api/pdf-report/activate (subscription cookie)
│       ├── export.ts         — POST /api/pdf-report/export   (PDF or DOCX download)
│       ├── generate.ts       — POST /api/pdf-report/generate (full PDF generation)
│       └── preview.ts        — POST /api/pdf-report/preview  (PNG preview)
├── components/
│   ├── PanelPDFReportEngine.tsx          — 4-step wizard React component
│   └── panel-pdf-report-engine.module.css
├── docs/                     — Architecture diagrams and ADRs
├── examples/
│   └── sample-config.json    — Example report config with all fields documented
├── python/
│   └── reportlab_engine/
│       ├── __init__.py       — Public API: generate_report, generate_preview, ReportConfig
│       ├── cli.py            — Entry point for the pdf-report command
│       └── engine.py         — Core PDF generation logic (ReportLab, 1400+ lines)
├── tests/
│   └── test_pdf_engine.py    — pytest suite (error paths, unicode, section headings)
├── types/
│   └── index.ts              — Shared TypeScript interfaces (ReportConfig, all request/response shapes)
├── ARCHITECTURE.md           — System diagram and layer breakdown
├── LICENSE                   — MIT
├── package.json              — npm package (pdf-report-engine v0.1.0)
└── pyproject.toml            — Python package (reportlab-engine v0.1.0)
```

---

## Development Setup

**Clone:**

```
git clone https://github.com/DevCraftXCoder/PDF-Report-Engine.git
cd PDF-Report-Engine
```

**Install Python dependencies:**

```
pip install -e ".[dev]"
```

**Install Node.js dependencies:**

```
npm install
```

**Run Python tests:**

```
python -m pytest tests/ -v
```

**Run TypeScript check:**

```
npm run typecheck
```

**Run lint:**

```
python -m ruff check python/
npm run lint
```

---

## License

MIT — Copyright 2026 Frxncois (DevCraftXCoder)

See [LICENSE](./LICENSE) for the full text.
