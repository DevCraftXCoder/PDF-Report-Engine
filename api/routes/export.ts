/**
 * POST /api/pdf-report/export
 *
 * Accepts the base64-encoded PDF from a prior /generate call and re-serves it
 * as a download, optionally converting to DOCX via pdf2docx (Python).
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 * Method:  POST
 * Headers:
 *   X-Requested-With: XMLHttpRequest   (CSRF guard)
 *   Cookie: admin_auth=<token> OR mizzy_auth=<token>
 *            AND report_engine_uid=<uid>   (subscription gate)
 *
 * Body (JSON):
 *   {
 *     format?:     "pdf" | "docx"    Defaults to "pdf"
 *     filename?:   string            Desired filename without extension (max 100 chars)
 *                                    Sanitised to [a-zA-Z0-9_- ] server-side.
 *                                    Defaults to "enterprise_report".
 *     pdfBase64:   string            Required. Base64-encoded PDF bytes (no data URI prefix).
 *                                    Must decode to a valid PDF (magic bytes %PDF).
 *   }
 *
 * ── Success Response ─────────────────────────────────────────────────────────
 * Status: 200
 * Content-Type: application/pdf  OR
 *               application/vnd.openxmlformats-officedocument.wordprocessingml.document
 * Content-Disposition: attachment; filename="<safeFilename>.<ext>"
 * Content-Length: <bytes>
 * Body: raw file bytes
 *
 * ── Error Responses ──────────────────────────────────────────────────────────
 * 400: { error: "pdfBase64 is required" }
 * 400: { error: "Invalid PDF data" }
 * 400: { error: "Failed to decode pdfBase64" }
 * 400: { error: "Invalid request body" }
 * 401: { error: "Unauthorized" }
 * 403: { error: "CSRF validation failed" }
 * 403: { error: "Report Engine requires an active subscription", code: "SUBSCRIPTION_REQUIRED" }
 * 500: { error: "DOCX conversion failed", details?: string }
 *
 * ── DOCX conversion ──────────────────────────────────────────────────────────
 * Requires Python package pdf2docx: pip install pdf2docx
 * Falls back to a stub DOCX (via python-docx) if pdf2docx is not installed.
 * Falls back to a 500 error if neither package is available.
 *
 * ── Dependencies removed from original ───────────────────────────────────────
 * - @/app/lib/auth-token (verifyToken) — replace with your auth helper.
 * - @/app/lib/report-engine-subscription (hasActiveReportEngineSubscription)
 *   — replace with your subscription-check logic.
 */

import { NextRequest, NextResponse } from "next/server";
// TODO: replace with your own implementations
import { verifyToken } from "@/app/lib/auth-token";
import { hasActiveReportEngineSubscription } from "@/app/lib/report-engine-subscription";
import { spawn } from "child_process";
import path from "path";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";

export const runtime = "nodejs";

if (!process.env.PYTHON_BIN) {
  throw new Error("PYTHON_BIN environment variable is not set — cannot start PDF export service");
}
const PYTHON_BIN: string = process.env.PYTHON_BIN;
const RUNS_DIR = process.env.PDF_RUNS_DIR ?? path.join(process.cwd(), "pdf-runs");

// ---------------------------------------------------------------------------
// Supported export formats
// ---------------------------------------------------------------------------

type ExportFormat = "pdf" | "docx";

const VALID_FORMATS = new Set<ExportFormat>(["pdf", "docx"]);

// ---------------------------------------------------------------------------
// PDF → DOCX conversion via python-docx (best-effort)
// ---------------------------------------------------------------------------

function spawnDocxConverter(pdfPath: string, docxPath: string): Promise<{ exitCode: number; stderr: string }> {
  // Inline Python that uses pdf2docx for conversion, falls back to a stub docx
  const script = `
import sys, os
try:
    from pdf2docx import Converter
    cv = Converter(sys.argv[1])
    cv.convert(sys.argv[2])
    cv.close()
    print('ok')
except ImportError:
    # Fallback: create a stub DOCX with python-docx
    try:
        from docx import Document
        doc = Document()
        doc.add_heading('Report exported from PDF Engine', 0)
        doc.add_paragraph('Install pdf2docx for full fidelity conversion: pip install pdf2docx')
        doc.save(sys.argv[2])
        print('ok-stub')
    except ImportError:
        print('error: neither pdf2docx nor python-docx is installed', file=sys.stderr)
        sys.exit(1)
`.trim();

  return new Promise((resolve) => {
    const proc = spawn(PYTHON_BIN, ["-c", script, pdfPath, docxPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ exitCode: code ?? 1, stderr }));
    proc.on("error", (err) => resolve({ exitCode: 1, stderr: err.message }));
    setTimeout(() => { proc.kill("SIGKILL"); resolve({ exitCode: 1, stderr: "DOCX conversion timed out" }); }, 60_000);
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

  // Parse body
  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (typeof raw !== "object" || raw === null) throw new Error("Not an object");
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Validate format
  const rawFormat = typeof body.format === "string" ? body.format.toLowerCase() : "pdf";
  const format: ExportFormat = VALID_FORMATS.has(rawFormat as ExportFormat)
    ? (rawFormat as ExportFormat)
    : "pdf";

  // Validate filename
  const rawFilename = typeof body.filename === "string" ? body.filename.trim() : "";
  const safeFilename = rawFilename
    .replace(/[^a-zA-Z0-9_\- ]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 100) || "enterprise_report";

  // Accept PDF as base64
  const rawPdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64.trim() : "";
  if (!rawPdfBase64) {
    return NextResponse.json({ error: "pdfBase64 is required" }, { status: 400 });
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = Buffer.from(rawPdfBase64, "base64");
    // Verify PDF magic bytes: %PDF
    if (pdfBuffer.slice(0, 4).toString("ascii") !== "%PDF") {
      return NextResponse.json({ error: "Invalid PDF data" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Failed to decode pdfBase64" }, { status: 400 });
  }

  const timestamp = Date.now();
  try {
    await mkdir(RUNS_DIR, { recursive: true });
  } catch {
    // exists
  }

  // --- PDF export: return directly ---
  if (format === "pdf") {
    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename}.pdf"`,
        "Content-Length": String(pdfBuffer.length),
      },
    });
  }

  // --- DOCX export ---
  const tmpPdfPath = path.join(RUNS_DIR, `export_${timestamp}.pdf`);
  const tmpDocxPath = path.join(RUNS_DIR, `export_${timestamp}.docx`);

  try {
    await writeFile(tmpPdfPath, pdfBuffer);
    const { exitCode, stderr } = await spawnDocxConverter(tmpPdfPath, tmpDocxPath);

    if (exitCode !== 0) {
      console.error(JSON.stringify({
        level: "error",
        message: "DOCX conversion failed",
        timestamp: new Date().toISOString(),
        context: { stderr: stderr.slice(0, 300) },
      }));
      return NextResponse.json(
        { error: "DOCX conversion failed", details: process.env.NODE_ENV === "development" ? stderr.slice(0, 300) : undefined },
        { status: 500 },
      );
    }

    const docxBuffer = await readFile(tmpDocxPath);
    return new NextResponse(docxBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeFilename}.docx"`,
        "Content-Length": String(docxBuffer.length),
      },
    });
  } finally {
    unlink(tmpPdfPath).catch(() => {});
    unlink(tmpDocxPath).catch(() => {});
  }
}
