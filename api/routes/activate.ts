/**
 * POST /api/pdf-report/activate
 *
 * Called by the PDF Report Engine checkout success redirect to set the
 * report_engine_uid cookie. The cookie identifies the subscriber to the
 * downstream subscription gate on /generate and /export.
 *
 * Verifies the user_id has an active subscription before issuing the cookie.
 * Auth: mizzy_auth or admin_auth cookie required (gate to logged-in users only).
 *
 * ── Request ──────────────────────────────────────────────────────────────────
 * Method:  POST
 * Headers:
 *   X-Requested-With: XMLHttpRequest   (CSRF guard)
 *   Cookie: admin_auth=<token> OR mizzy_auth=<token>
 *
 * Body (JSON):
 *   {
 *     user_id: string   // Required. The value used in Stripe metadata[user_id]. Max 256 chars.
 *   }
 *
 * ── Success Response ─────────────────────────────────────────────────────────
 * Status: 200
 * Sets cookie: report_engine_uid=<user_id>
 *   HttpOnly, Secure, SameSite=Strict, Max-Age=31536000 (1 year), Path=/
 * Body (JSON): { ok: true }
 *
 * ── Error Responses ──────────────────────────────────────────────────────────
 * 400: { error: "user_id is required" }
 * 400: { error: "Invalid request body" }
 * 401: { error: "Unauthorized" }
 * 403: { error: "CSRF validation failed" }
 * 403: { error: "No active Report Engine subscription found for this user_id",
 *        code: "SUBSCRIPTION_NOT_FOUND" }
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

export const runtime = "nodejs";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year — subscription is ongoing

export async function POST(req: NextRequest) {
  // CSRF
  if (req.headers.get("X-Requested-With") !== "XMLHttpRequest") {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }

  // Auth: must be logged in as admin or mizzy user
  const adminCookie = req.cookies.get("admin_auth")?.value;
  const mizzyCookie = req.cookies.get("mizzy_auth")?.value;
  const isAdmin = await verifyToken(adminCookie, process.env.ADMIN_PASSWORD, "admin_session_v1");
  const isMizzy = await verifyToken(mizzyCookie, process.env.MIZZY_PASSWORD, "mizzy_session_v1");
  if (!isAdmin && !isMizzy) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!userId || userId.length > 256) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  // Verify the subscription is active before issuing the cookie
  const active = await hasActiveReportEngineSubscription(userId);
  if (!active) {
    return NextResponse.json(
      { error: "No active Report Engine subscription found for this user_id", code: "SUBSCRIPTION_NOT_FOUND" },
      { status: 403 },
    );
  }

  // Set the report_engine_uid cookie (HttpOnly, Secure, SameSite=Strict)
  const res = NextResponse.json({ ok: true });
  res.cookies.set("report_engine_uid", userId, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  return res;
}
