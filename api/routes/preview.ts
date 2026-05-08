/**
 * POST /api/pdf-report/preview
 *
 * Generates a PNG preview (page 1) of the report at 120 DPI by spawning
 * pdf_engine.py with the --preview flag.
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 * Method:  POST
 * Headers:
 *   X-Requested-With: XMLHttpRequest   (CSRF guard)
 *   Cookie: admin_auth=<token> OR mizzy_auth=<token>
 *
 * Body (JSON):
 *   Option A — wrapped:
 *   { reportConfig: { company_name?: string, ... } }
 *
 *   Option B — flat (same keys used by /generate):
 *   { companyName?: string, industry?: string, ... }
 *
 *   company_name / companyName defaults to "Preview" if absent.
 *   Accepts any partial config — preview does not require a full body.
 *   No subscription gate (preview is a fast, low-cost operation).
 *
 * ── Success Response ─────────────────────────────────────────────────────────
 * Status: 200
 * Body (JSON):
 *   {
 *     status:    "ok",
 *     preview:   string,   // data:image/png;base64,<base64> — PNG of page 1
 *     pageCount: number,   // reported by the Python engine (default 16)
 *     dpi:       number,   // 120
 *   }
 *
 * ── Error Responses ──────────────────────────────────────────────────────────
 * 400: { error: "Invalid request body" }
 * 401: { error: "Unauthorized" }
 * 403: { error: "CSRF validation failed" }
 * 500: { error: "Preview generation failed", details?: string }
 * 500: { error: "Failed to read preview image" }
 *
 * ── Dependencies removed from original ───────────────────────────────────────
 * - @/app/lib/auth-token (verifyToken) — replace with your auth helper.
 */

import { NextRequest, NextResponse } from "next/server";
// TODO: replace with your own auth implementation
import { verifyToken } from "@/app/lib/auth-token";
import { spawn } from "child_process";
import path from "path";
import { readFile, unlink, mkdir } from "fs/promises";

export const runtime = "nodejs";

const PDF_ENGINE_PATH = path.join(process.cwd(), "..", "resume", "pdf_engine.py");
const PYTHON_BIN = process.env.PYTHON_BIN ?? "python";
const PREVIEW_DPI = 120;

// ---------------------------------------------------------------------------
// Spawn Python engine for preview (PNG of page 1)
// ---------------------------------------------------------------------------

function spawnPreview(
  config: Record<string, unknown>,
  pngPath: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_BIN, [PDF_ENGINE_PATH, "--stdin", "--preview", pngPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdin.write(JSON.stringify(config));
    proc.stdin.end();

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    proc.on("error", (err) => resolve({ exitCode: 1, stdout: "", stderr: err.message }));

    // 90s timeout for preview generation
    setTimeout(() => {
      proc.kill("SIGKILL");
      resolve({ exitCode: 1, stdout: "", stderr: "Preview timed out" });
    }, 90_000);
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

  // Parse body — no rate limit on preview (fast op)
  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (typeof raw !== "object" || raw === null) throw new Error("Not an object");
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Extract reportConfig — accept full config or partial preview config
  const reportConfig = (typeof body.reportConfig === "object" && body.reportConfig !== null)
    ? (body.reportConfig as Record<string, unknown>)
    : body;

  // Minimal validation for preview
  if (!reportConfig.company_name && !reportConfig.companyName) {
    reportConfig.company_name = "Preview";
  }
  if (!reportConfig.company_name && reportConfig.companyName) {
    reportConfig.company_name = reportConfig.companyName;
  }

  // Temp paths
  const timestamp = Date.now();
  const runsDir = path.join(process.cwd(), "..", "resume", "_runs");
  try {
    await mkdir(runsDir, { recursive: true });
  } catch {
    // dir exists
  }
  const pngPath = path.join(runsDir, `preview_${timestamp}.png`);

  const { exitCode, stdout, stderr } = await spawnPreview(reportConfig, pngPath);

  if (exitCode !== 0) {
    console.error(JSON.stringify({
      level: "error",
      message: "PDF preview generation failed",
      timestamp: new Date().toISOString(),
      context: { exitCode, stderr: stderr.slice(0, 300) },
    }));
    return NextResponse.json(
      { error: "Preview generation failed", details: process.env.NODE_ENV === "development" ? stderr.slice(0, 300) : undefined },
      { status: 500 },
    );
  }

  // Parse page count from stdout JSON if available
  let pageCount = 16;
  try {
    const parsed = JSON.parse(stdout.trim());
    if (typeof parsed.pages === "number") pageCount = parsed.pages;
  } catch {
    // ignore parse failure
  }

  // Read PNG and return as base64
  let pngBuffer: Buffer;
  try {
    pngBuffer = await readFile(pngPath);
    unlink(pngPath).catch(() => {});
  } catch {
    return NextResponse.json({ error: "Failed to read preview image" }, { status: 500 });
  }

  const base64Image = pngBuffer.toString("base64");

  return NextResponse.json({
    status: "ok",
    preview: `data:image/png;base64,${base64Image}`,
    pageCount,
    dpi: PREVIEW_DPI,
  });
}
