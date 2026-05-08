/**
 * POST /api/pdf-report/generate
 *
 * Generates a full PDF report by spawning the Python pdf_engine.py process.
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 * Method:  POST
 * Headers:
 *   X-Requested-With: XMLHttpRequest   (CSRF guard)
 *   Cookie: admin_auth=<token> OR mizzy_auth=<token>
 *            AND report_engine_uid=<uid>   (subscription gate)
 *
 * Body (JSON — see GenerateRequestBody in types/index.ts):
 *   {
 *     companyName:        string  (required, max 200)
 *     industry:           string  (required, max 200)
 *     tagline?:           string  (max 200)
 *     bio?:               string  (max 2000)
 *     executiveSummary?:  string  (max 3000)
 *     reportType?:        "AI Startup Audit" | "Creator Growth Report"
 *                       | "Enterprise Strategic Audit" | "SaaS Growth Analysis"
 *     metrics?:           Record<string, number>  (mrr, users, growth_rate, ...)
 *     kpis?:              KpiItem[]               (max 20)
 *     revenueProjections?: Record<string, unknown>
 *     riskItems?:         RiskItem[]              (max 30)
 *     roadmapItems?:      RoadmapItem[]           (max 30)
 *     competitiveData?:   CompetitorItem[]        (max 20)
 *     techStack?:         TechStackItem[]         (max 20)
 *     aiNarratives?:      Record<string, string>  (keys /^[a-zA-Z0-9_]{1,60}$/, values max 4000)
 *     logoBase64?:        string  (base64 image, no data URI prefix, /^[A-Za-z0-9+/=]{20,}$/)
 *     audienceData?:      Record<string, unknown>
 *   }
 *
 * ── Success Response ─────────────────────────────────────────────────────────
 * Status:  200
 * Content-Type: application/pdf
 * Content-Disposition: attachment; filename="<safeName>_report.pdf"
 * X-Report-Type: <reportType>
 * X-Company-Name: <companyName>
 * Body: raw PDF bytes
 *
 * ── Error Responses ──────────────────────────────────────────────────────────
 * 400: { error: "Invalid request body" }
 * 401: { error: "Unauthorized" }
 * 403: { error: "CSRF validation failed" }
 * 403: { error: "Report Engine requires an active subscription", code: "SUBSCRIPTION_REQUIRED" }
 * 429: { error: "Rate limit exceeded — 5 PDF reports per hour" }
 * 500: { error: "PDF generation failed", details?: string }  // details only in development
 *
 * ── Dependencies removed from original ───────────────────────────────────────
 * - @/app/lib/supabase-server (createServerSupabase) — used for rate-limit tracking.
 *   Replace checkRateLimit below with your own rate-limit implementation.
 * - @/app/lib/rate-limiter (checkRateLimit) — same as above.
 * - @/app/lib/auth-token (verifyToken) — replace with your auth helper.
 * - @/app/lib/report-engine-subscription (hasActiveReportEngineSubscription) — replace
 *   with your subscription-check logic.
 */

import { NextRequest, NextResponse } from "next/server";
// TODO: replace these imports with your own implementations
import { verifyToken } from "@/app/lib/auth-token";
import { createServerSupabase } from "@/app/lib/supabase-server";
import { checkRateLimit } from "@/app/lib/rate-limiter";
import { hasActiveReportEngineSubscription } from "@/app/lib/report-engine-subscription";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PDF_ENGINE_PATH = path.join(process.cwd(), "..", "resume", "pdf_engine.py");
const PYTHON_BIN = process.env.PYTHON_BIN ?? "python";
const MAX_COMPANY_NAME = 200;
const MAX_NARRATIVE_LEN = 4_000;
const MAX_TAGLINE_LEN = 200;
const MAX_BIO_LEN = 2_000;
const MAX_SUMMARY_LEN = 3_000;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function sanitizeString(val: unknown, max: number): string {
  if (typeof val !== "string") return "";
  return val.trim().slice(0, max);
}

const VALID_REPORT_TYPES = new Set([
  "AI Startup Audit",
  "Creator Growth Report",
  "Enterprise Strategic Audit",
  "SaaS Growth Analysis",
]);

function buildReportConfig(body: Record<string, unknown>): Record<string, unknown> {
  const reportType = VALID_REPORT_TYPES.has(body.reportType as string)
    ? (body.reportType as string)
    : "Enterprise Strategic Audit";

  const config: Record<string, unknown> = {
    report_type: reportType,
    company_name: sanitizeString(body.companyName, MAX_COMPANY_NAME) || "Company",
    industry: sanitizeString(body.industry, 200) || "Technology",
    tagline: sanitizeString(body.tagline, MAX_TAGLINE_LEN),
    bio: sanitizeString(body.bio, MAX_BIO_LEN),
    executive_summary: sanitizeString(body.executiveSummary, MAX_SUMMARY_LEN),
    generated_at: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  };

  // Metrics — whitelist only known numeric fields
  const rawMetrics = typeof body.metrics === "object" && body.metrics !== null ? body.metrics as Record<string, unknown> : {};
  const NUMERIC_METRIC_KEYS = ["mrr", "target_mrr", "users", "growth_rate", "churn_rate", "ltv", "cac", "nps", "uptime"];
  const metrics: Record<string, number> = {};
  for (const key of NUMERIC_METRIC_KEYS) {
    const v = rawMetrics[key];
    if (typeof v === "number" && isFinite(v) && v >= 0) {
      metrics[key] = v;
    }
  }
  if (Object.keys(metrics).length > 0) config.metrics = metrics;

  // KPIs — array of {label, value, maturity, trend}
  if (Array.isArray(body.kpis)) {
    const VALID_MATURITY = new Set(["Optimized", "Advanced", "Developing", "Initial", "Critical"]);
    config.kpis = body.kpis
      .slice(0, 20)
      .filter((k): k is Record<string, unknown> => typeof k === "object" && k !== null)
      .map((k) => ({
        label: sanitizeString(k.label, 60),
        value: sanitizeString(k.value, 40),
        maturity: VALID_MATURITY.has(k.maturity as string) ? k.maturity : "Developing",
        trend: sanitizeString(k.trend, 60),
      }));
  }

  // Revenue projections
  if (typeof body.revenueProjections === "object" && body.revenueProjections !== null) {
    config.revenue_projections = body.revenueProjections;
  }

  // Risk items
  if (Array.isArray(body.riskItems)) {
    const VALID_SEVERITY = new Set(["Critical", "High", "Medium", "Low"]);
    const VALID_LIKELIHOOD = new Set(["Certain", "Likely", "Possible", "Unlikely", "High", "Medium", "Low"]);
    config.risk_items = body.riskItems
      .slice(0, 30)
      .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      .map((r) => ({
        category: sanitizeString(r.category, 40),
        risk: sanitizeString(r.risk, 200),
        severity: VALID_SEVERITY.has(r.severity as string) ? r.severity : "Medium",
        likelihood: VALID_LIKELIHOOD.has(r.likelihood as string) ? r.likelihood : "Medium",
        mitigation: sanitizeString(r.mitigation, 300),
      }));
  }

  // Roadmap items
  if (Array.isArray(body.roadmapItems)) {
    config.roadmap_items = body.roadmapItems
      .slice(0, 30)
      .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      .map((r) => ({
        phase: sanitizeString(r.phase, 30),
        milestone: sanitizeString(r.milestone, 200),
        owner: sanitizeString(r.owner, 60),
        status: sanitizeString(r.status, 40),
      }));
  }

  // Competitive data
  if (Array.isArray(body.competitiveData)) {
    config.competitive_data = body.competitiveData
      .slice(0, 20)
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => ({
        competitor: sanitizeString(c.competitor, 100),
        strength: sanitizeString(c.strength, 200),
        weakness: sanitizeString(c.weakness, 200),
        positioning: sanitizeString(c.positioning, 100),
      }));
  }

  // Tech stack
  if (Array.isArray(body.techStack)) {
    config.tech_stack = body.techStack
      .slice(0, 20)
      .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
      .map((t) => ({
        layer: sanitizeString(t.layer, 60),
        tech: sanitizeString(t.tech, 100),
        hosting: sanitizeString(t.hosting, 100),
        status: sanitizeString(t.status, 40),
      }));
  }

  // AI narratives — validate each value is a non-empty string
  if (typeof body.aiNarratives === "object" && body.aiNarratives !== null) {
    const raw = body.aiNarratives as Record<string, unknown>;
    const narratives: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string" && v.trim().length > 0 && /^[a-zA-Z0-9_]{1,60}$/.test(k)) {
        narratives[k] = v.trim().slice(0, MAX_NARRATIVE_LEN);
      }
    }
    if (Object.keys(narratives).length > 0) config.ai_narratives = narratives;
  }

  // Logo — accept base64 (not a data URI)
  if (typeof body.logoBase64 === "string" && body.logoBase64.trim().length > 0) {
    const b64 = body.logoBase64.trim();
    if (/^[A-Za-z0-9+/=]{20,}$/.test(b64)) {
      config.logo_base64 = b64;
    }
  }

  // Audience data
  if (typeof body.audienceData === "object" && body.audienceData !== null) {
    config.audience_data = body.audienceData;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Python subprocess caller
// ---------------------------------------------------------------------------

function spawnPdfEngine(
  config: Record<string, unknown>,
  outputPath: string,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_BIN, [PDF_ENGINE_PATH, "--stdin", "--output", outputPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdin.write(JSON.stringify(config));
    proc.stdin.end();

    let stderr = "";
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stderr });
    });

    proc.on("error", (err) => {
      resolve({ exitCode: 1, stderr: err.message });
    });

    // Hard timeout: 120 seconds
    setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ exitCode: 1, stderr: "PDF generation timed out after 120s" });
    }, 120_000);
  });
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // CSRF
  if (req.headers.get("X-Requested-With") !== "XMLHttpRequest") {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  // Auth
  const adminCookie = req.cookies.get("admin_auth")?.value;
  const mizzyCookie = req.cookies.get("mizzy_auth")?.value;
  const isAdmin = await verifyToken(adminCookie, process.env.ADMIN_PASSWORD, "admin_session_v1");
  const isMizzy = await verifyToken(mizzyCookie, process.env.MIZZY_PASSWORD, "mizzy_session_v1");
  if (!isAdmin && !isMizzy) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Subscription gate
  const reportEngineUid = req.cookies.get("report_engine_uid")?.value ?? "";
  if (!reportEngineUid) {
    return NextResponse.json(
      { error: "Report Engine requires an active subscription", code: "SUBSCRIPTION_REQUIRED" },
      { status: 403 },
    );
  }
  const hasSubscription = await hasActiveReportEngineSubscription(reportEngineUid);
  if (!hasSubscription) {
    return NextResponse.json(
      { error: "Report Engine requires an active subscription", code: "SUBSCRIPTION_REQUIRED" },
      { status: 403 },
    );
  }

  // Rate limit: 5 reports/hour per IP
  // TODO: replace with your own rate-limit implementation if not using Supabase
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const supabase = createServerSupabase();
  const limited = await checkRateLimit(supabase, ip, "pdf-report-generate", 5, 3_600_000);
  if (limited) {
    return NextResponse.json(
      { error: "Rate limit exceeded — 5 PDF reports per hour" },
      { status: 429 },
    );
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (typeof raw !== "object" || raw === null) throw new Error("Not an object");
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Build validated config
  const reportConfig = buildReportConfig(body);

  // Temp output path
  const timestamp = Date.now();
  const safeName = (reportConfig.company_name as string)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 40);
  const outputDir = path.join(process.cwd(), "..", "resume", "_runs");
  const outputPath = path.join(outputDir, `${safeName}_${timestamp}.pdf`);

  // Ensure output directory exists
  try {
    const { mkdir } = await import("fs/promises");
    await mkdir(outputDir, { recursive: true });
  } catch {
    // already exists
  }

  // Spawn PDF engine
  const { exitCode, stderr } = await spawnPdfEngine(reportConfig, outputPath);

  if (exitCode !== 0) {
    console.error(JSON.stringify({
      level: "error",
      message: "PDF engine failed",
      timestamp: new Date().toISOString(),
      context: { exitCode, stderr: stderr.slice(0, 500) },
    }));
    return NextResponse.json(
      { error: "PDF generation failed", details: process.env.NODE_ENV === "development" ? stderr.slice(0, 500) : undefined },
      { status: 500 },
    );
  }

  // Read and return the PDF
  let pdfBuffer: Buffer;
  try {
    const { readFile } = await import("fs/promises");
    pdfBuffer = await readFile(outputPath);
    // Clean up temp file (non-blocking)
    import("fs/promises").then(({ unlink }) => unlink(outputPath).catch(() => {}));
  } catch {
    return NextResponse.json({ error: "Failed to read generated PDF" }, { status: 500 });
  }

  return new NextResponse(pdfBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}_report.pdf"`,
      "Content-Length": String(pdfBuffer.length),
      "X-Report-Type": reportConfig.report_type as string,
      "X-Company-Name": reportConfig.company_name as string,
    },
  });
}
