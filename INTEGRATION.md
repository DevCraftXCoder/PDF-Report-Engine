# Integration Guide — Bringing PDF Report Engine into Your Next.js App

Target stack: **Next.js 14+ with App Router**. All examples use the `app/` directory structure.

---

## Section 1: Setup

### Install the npm package

```
npm install pdf-report-engine
```

The package ships the React component (`components/`) and TypeScript types (`types/`) pre-built. It does not bundle the API routes — those are copied manually (see Section 3).

### Install the Python engine

The Node.js API routes spawn Python as a child process. Python must be available on the machine running your Next.js server.

**Install from PyPI:**

```
pip install reportlab-engine
```

**Install from source (for development):**

```
git clone https://github.com/DevCraftXCoder/PDF-Report-Engine.git
cd PDF-Report-Engine
pip install -e ".[dev]"
```

### Configure the Python binary path

By default, the routes call `python`. If your environment uses `python3`, a virtual environment, or a non-default path, set the `PYTHON_BIN` environment variable:

```
# .env.local
PYTHON_BIN=python3
# or an absolute path:
PYTHON_BIN=/usr/local/bin/python3
```

The routes read this via `process.env.PYTHON_BIN ?? "python"`.

---

## Section 2: React Component

### Import

```tsx
"use client";

import { PanelPDFReportEngine } from "pdf-report-engine/components";
import type { ReportConfig } from "pdf-report-engine/types";
```

### Callbacks

The component is fully controlled — it calls your callbacks and you decide what to do with the result.

```tsx
// onPreview: fetch a PNG of page 1 and return it as a data URI.
// The component renders it in the preview panel.
async function handlePreview(config: ReportConfig): Promise<string | null> {
  const res = await fetch("/api/pdf-report/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({ reportConfig: config.formData }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.preview; // "data:image/png;base64,..."
}

// onExport: trigger a PDF or DOCX download.
function handleExport(config: ReportConfig, format: "pdf" | "docx" | "ppt") {
  // Fetch the generated PDF, then re-POST to /export for the download.
  // See the export route contract in Section 3 for the full flow.
}

// onAnalyze: called when the user triggers AI analysis in Step 3.
// Use this to kick off any server-side AI enrichment before export.
function handleAnalyze(config: ReportConfig) {
  console.log("Starting analysis for", config.formData.companyName);
}
```

### Form state

The component manages its own internal form state. The `ReportConfig` object passed to your callbacks has this shape:

```typescript
interface ReportConfig {
  template: "ai-startup-audit" | "creator-growth-report"
          | "enterprise-strategic-audit" | "saas-growth-analysis";
  formData: {
    companyName: string;
    industry: string;
    description: string;
    logoFile: File | null;
    logoDataUrl: string;
    websiteUrls: string[];
    integrations: string[];
    analysisTypes: Array<"competitive" | "growth" | "risk" | "market" | "technical" | "financial">;
    sections: ReportSection[];
    depthLevel: number;         // 1–5
    confidenceThreshold: number; // 0–100
    reportTone: "executive" | "analytical" | "narrative" | "tactical";
    includePredictions: boolean;
    includeCompetitors: boolean;
    includeActionItems: boolean;
  };
}
```

### Minimal example

```tsx
// app/reports/page.tsx
"use client";

import { useState } from "react";
import { PanelPDFReportEngine } from "pdf-report-engine/components";
import type { ReportConfig } from "pdf-report-engine/types";

export default function ReportsPage() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  async function handlePreview(config: ReportConfig): Promise<string | null> {
    const res = await fetch("/api/pdf-report/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify({ reportConfig: config.formData }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const url = data.preview as string;
    setPreviewUrl(url);
    return url;
  }

  function handleExport(config: ReportConfig, format: "pdf" | "docx" | "ppt") {
    // See Section 3 — export route for the full download flow
  }

  return (
    <PanelPDFReportEngine
      onAnalyze={() => setIsAnalyzing(true)}
      onPreview={handlePreview}
      onExport={handleExport}
      previewUrl={previewUrl}
      isAnalyzing={isAnalyzing}
    />
  );
}
```

---

## Section 3: API Routes

### Copy route files into your app

Create the directory structure in your Next.js project:

```
your-app/
└── app/
    └── api/
        └── pdf-report/
            ├── generate/
            │   └── route.ts
            ├── preview/
            │   └── route.ts
            ├── export/
            │   └── route.ts
            └── activate/
                └── route.ts
```

Copy the route handler files from this package:

```
node_modules/pdf-report-engine/api/routes/generate.ts  →  app/api/pdf-report/generate/route.ts
node_modules/pdf-report-engine/api/routes/preview.ts   →  app/api/pdf-report/preview/route.ts
node_modules/pdf-report-engine/api/routes/export.ts    →  app/api/pdf-report/export/route.ts
node_modules/pdf-report-engine/api/routes/activate.ts  →  app/api/pdf-report/activate/route.ts
```

### Replace auth helpers

Each route file contains `TODO` comments marking the three functions you must replace:

**`verifyToken`** — checks an auth cookie and returns a boolean. Signature:

```typescript
async function verifyToken(
  cookieValue: string | undefined,
  secret: string | undefined,
  audience: string,
): Promise<boolean>
```

Replace the import `from "@/app/lib/auth-token"` with your own implementation. Example using a signed cookie pattern:

```typescript
import { verifyToken } from "@/lib/auth";
// or inline:
async function verifyToken(cookie: string | undefined, secret: string | undefined): Promise<boolean> {
  if (!cookie || !secret) return false;
  // your HMAC or JWT verification here
  return true;
}
```

**`checkRateLimit`** — returns `true` if the request should be blocked, `false` if allowed. Used only in `/generate`.

```typescript
import { checkRateLimit } from "@/lib/rate-limiter";
// or inline: replace the Supabase-backed call with Redis, Upstash, or any counter
```

**`hasActiveReportEngineSubscription`** — returns `true` if the user has an active subscription. Used in `/generate`, `/export`, and `/activate`.

```typescript
import { hasActiveReportEngineSubscription } from "@/lib/subscriptions";
// or inline: query Stripe, your database, or a KV store
```

### Route contracts

**POST `/api/pdf-report/generate`**

Request:

```json
{
  "companyName": "string (required, max 200)",
  "industry": "string (required)",
  "tagline": "string (optional, max 200)",
  "bio": "string (optional, max 2000)",
  "executiveSummary": "string (optional, max 3000)",
  "reportType": "AI Startup Audit | Creator Growth Report | Enterprise Strategic Audit | SaaS Growth Analysis",
  "metrics": { "mrr": 0, "users": 0, "growth_rate": 0, "churn_rate": 0, "ltv": 0, "cac": 0, "nps": 0, "uptime": 0 },
  "kpis": [{ "label": "", "value": "", "maturity": "Developing", "trend": "" }],
  "revenueProjections": {},
  "riskItems": [{ "category": "", "risk": "", "severity": "Medium", "likelihood": "Medium", "mitigation": "" }],
  "roadmapItems": [{ "phase": "", "milestone": "", "owner": "", "status": "" }],
  "competitiveData": [{ "competitor": "", "strength": "", "weakness": "", "positioning": "" }],
  "techStack": [{ "layer": "", "tech": "", "hosting": "", "status": "" }],
  "aiNarratives": { "section_key": "narrative text up to 4000 chars" },
  "logoBase64": "base64 string (no data: prefix)",
  "audienceData": {}
}
```

Response (success): raw `application/pdf` binary. Headers include `Content-Disposition: attachment; filename="<company>_report.pdf"`, `X-Report-Type`, `X-Company-Name`.

Response (errors): `400 | 401 | 403 | 429 | 500` with `{ error: string, details?: string, code?: string }`.

**POST `/api/pdf-report/preview`**

Request: same shape as `/generate`, or wrapped as `{ reportConfig: { ... } }`. All fields optional — defaults to a "Preview" company name if `companyName` is absent.

Response (success):

```json
{
  "status": "ok",
  "preview": "data:image/png;base64,...",
  "pageCount": 16,
  "dpi": 120
}
```

No subscription gate. No rate limit.

**POST `/api/pdf-report/export`**

Request:

```json
{
  "pdfBase64": "string (required — base64-encoded PDF, must decode to %PDF magic bytes)",
  "format": "pdf | docx (default: pdf)",
  "filename": "string (optional, max 100 chars, sanitised)"
}
```

Response (success): raw binary file. `Content-Type` is `application/pdf` or `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. `Content-Disposition: attachment`.

DOCX conversion requires `pip install pdf2docx`. Falls back to a stub DOCX if `pdf2docx` is not installed but `python-docx` is. Returns 500 if neither is available.

**POST `/api/pdf-report/activate`**

Request:

```json
{ "user_id": "string (required, max 256 — matches Stripe metadata.user_id)" }
```

Response (success): `{ "ok": true }` — sets `report_engine_uid` cookie (HttpOnly, Secure, SameSite=Strict, 1-year Max-Age).

---

## Section 4: Authentication

### Adding auth checks

The default routes use a cookie-based pattern with two possible session cookies: `admin_auth` and `mizzy_auth`. Replace the `verifyToken` calls with your own auth check.

**Example: Supabase session**

```typescript
import { createServerSupabase } from "@/lib/supabase-server";

async function isAuthenticated(req: NextRequest): Promise<boolean> {
  const supabase = createServerSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  return session !== null;
}
```

**Example: custom JWT**

```typescript
import { jwtVerify } from "jose";

async function isAuthenticated(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("session")?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET!));
    return true;
  } catch {
    return false;
  }
}
```

### Adding subscription gates

The `/generate` and `/export` routes check `hasActiveReportEngineSubscription(userId)` before processing. Replace this with a call to your subscription store.

**Example: Stripe subscription lookup**

```typescript
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

async function hasActiveReportEngineSubscription(userId: string): Promise<boolean> {
  const subscriptions = await stripe.subscriptions.list({
    customer: userId,
    status: "active",
  });
  return subscriptions.data.some(sub =>
    sub.items.data.some(item => item.price.id === process.env.REPORT_ENGINE_PRICE_ID)
  );
}
```

**Example: database flag**

```typescript
async function hasActiveReportEngineSubscription(userId: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 FROM subscriptions WHERE user_id = ? AND product = 'report-engine' AND status = 'active'"
  ).bind(userId).first();
  return row !== null;
}
```

### Removing the subscription gate entirely

If you do not need a subscription check, replace the gate blocks with a passthrough:

```typescript
// Replace both subscription gate blocks in generate.ts and export.ts with:
const hasSubscription = true; // always allow
```

---

## Troubleshooting

**Python not found: `ENOENT python`**

The route cannot find the Python binary. Set `PYTHON_BIN` in your `.env.local` to the absolute path returned by `which python3` (macOS/Linux) or `where python` (Windows).

**`ModuleNotFoundError: No module named 'reportlab'`**

The Python engine is not installed in the environment that `PYTHON_BIN` points to. Run `pip install reportlab-engine` in the same environment.

**`ModuleNotFoundError: No module named 'reportlab_engine'`**

The Python package is installed but not discoverable. Either install with `pip install -e .` from the repo root, or ensure the `python/` directory is on your `PYTHONPATH`:

```
PYTHONPATH=/absolute/path/to/PDF-Report-Engine/python
```

**Preview returns 500 in development but works in production**

Check that `_runs/` is writable. The routes create this directory automatically via `mkdir({ recursive: true })`, but some containerised environments mount the working directory as read-only. Set `NODE_ENV=development` to get the full `stderr` in the error response body.

**DOCX export returns a stub file (not the real report)**

`pdf2docx` is not installed. Run `pip install pdf2docx`. The stub is generated by `python-docx` as a fallback — it contains a notice that `pdf2docx` is required for full fidelity.

**`CSRF validation failed` (403)**

All routes require the `X-Requested-With: XMLHttpRequest` header on every request. Add it to your fetch calls:

```typescript
headers: { "X-Requested-With": "XMLHttpRequest" }
```

**`PDF generation timed out after 120s`**

The Python engine took longer than 2 minutes. This usually means the machine running the server is under high load, or the config has very large `bio` / `executiveSummary` / `aiNarratives` fields that trigger many text-flow reflows in ReportLab. The timeout is set in the `spawnPdfEngine` function in `generate.ts` — increase it if needed.

**Next.js edge runtime error: `Module not found: Can't resolve 'child_process'`**

The route files require the Node.js runtime. Make sure each route file exports:

```typescript
export const runtime = "nodejs";
```

Do not use `export const runtime = "edge"` — `child_process` is not available on the Edge runtime.
