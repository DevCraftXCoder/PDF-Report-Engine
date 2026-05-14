/**
 * POST /api/pdf-report/webhook
 *
 * Stripe webhook handler for PDF Report Engine subscription lifecycle.
 *
 * Handled events:
 *   - customer.subscription.deleted  — subscription cancelled or expired; clears cookie
 *   - invoice.payment_failed         — logged; cookie cleared after definitive deletion only
 *
 * No CSRF header required — payload is authenticated by Stripe signature.
 * No mizzy_auth / admin_auth cookie required — this is an inbound server-to-server call.
 *
 * ── Required env vars ────────────────────────────────────────────────────────
 * STRIPE_WEBHOOK_SECRET   — whsec_... from Stripe dashboard
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Stripe HMAC-SHA-256 signature verification (Web Crypto — no stripe SDK)
// ---------------------------------------------------------------------------

async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  toleranceSeconds = 300
): Promise<boolean> {
  const parts = sigHeader.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts["t"];
  const sig = parts["v1"];
  if (!timestamp || !sig) return false;

  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSeconds) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signedPayload = `${timestamp}.${rawBody}`;
  const hmacBuf = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
  const hmacHex = Array.from(new Uint8Array(hmacBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hmacHex === sig;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error(JSON.stringify({
      level: "error",
      message: "STRIPE_WEBHOOK_SECRET is not configured",
      timestamp: new Date().toISOString(),
    }));
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const sigHeader = req.headers.get("stripe-signature");
  if (!sigHeader) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const rawBody = await req.text();
  const isValid = await verifyStripeSignature(rawBody, sigHeader, webhookSecret);
  if (!isValid) {
    console.error(JSON.stringify({
      level: "warn",
      message: "Stripe webhook signature verification failed",
      timestamp: new Date().toISOString(),
    }));
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = event.type as string;
  const subscription = (event.data as Record<string, unknown>)?.object as Record<string, unknown>;

  console.log(JSON.stringify({
    level: "info",
    message: "Stripe webhook received",
    event_type: eventType,
    event_id: event.id,
    timestamp: new Date().toISOString(),
  }));

  if (eventType === "customer.subscription.deleted") {
    const metadata = subscription?.metadata as Record<string, unknown> | undefined;
    const userId = typeof metadata?.user_id === "string" ? metadata.user_id : null;

    console.log(JSON.stringify({
      level: "info",
      message: "Subscription deleted — clearing report_engine_uid cookie",
      user_id: userId ?? "unknown",
      subscription_id: subscription?.id,
      customer: subscription?.customer,
      timestamp: new Date().toISOString(),
    }));

    // Clear the report_engine_uid cookie so the next request to /generate or /export
    // fails the subscription gate without requiring a live check to show 403.
    const res = NextResponse.json({ received: true });
    res.cookies.set("report_engine_uid", "", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 0,
      path: "/api/pdf-report",
    });
    return res;
  }

  if (eventType === "invoice.payment_failed") {
    // Log but do not clear immediately — Stripe retries before marking subscription deleted.
    // The subscription gate (hasActiveReportEngineSubscription) will return false when the
    // upstream system reflects the failed payment. Cookie is cleared on subscription.deleted.
    console.log(JSON.stringify({
      level: "info",
      message: "Invoice payment failed — subscription entering grace period",
      customer: subscription?.customer,
      subscription_id: subscription?.subscription,
      timestamp: new Date().toISOString(),
    }));
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}
