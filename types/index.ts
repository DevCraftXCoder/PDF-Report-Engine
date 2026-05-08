/**
 * PDF Report Engine — Shared Types
 *
 * Extracted from francois-landing/components/mizzy-panels/PanelPDFReportEngine.tsx
 * and api/mizzy-tools/pdf-report/* route handlers.
 */

// ── Component-level types ────────────────────────────────────────────────────

export type ReportTemplate =
  | "ai-startup-audit"
  | "creator-growth-report"
  | "enterprise-strategic-audit"
  | "saas-growth-analysis";

export type AnalysisType =
  | "competitive"
  | "growth"
  | "risk"
  | "market"
  | "technical"
  | "financial";

export type ReportTone = "executive" | "analytical" | "narrative" | "tactical";

export interface ReportSection {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  description: string;
}

export interface DataIntegration {
  id: string;
  name: string;
  icon: string;
  connected: boolean;
  category: string;
}

export interface ReportFormData {
  companyName: string;
  industry: string;
  description: string;
  logoFile: File | null;
  logoDataUrl: string;
  websiteUrls: string[];
  integrations: string[];
  analysisTypes: AnalysisType[];
  sections: ReportSection[];
  depthLevel: number;
  confidenceThreshold: number;
  reportTone: ReportTone;
  includePredictions: boolean;
  includeCompetitors: boolean;
  includeActionItems: boolean;
}

export interface ReportConfig {
  template: ReportTemplate;
  formData: ReportFormData;
}

// ── API route — generate (/api/pdf-report/generate) ─────────────────────────

/**
 * POST /api/pdf-report/generate
 *
 * Request body shape (all optional except companyName + industry):
 */
export interface GenerateRequestBody {
  /** Required. Max 200 chars. */
  companyName: string;
  /** Required. */
  industry: string;
  /** Optional. Max 200 chars. */
  tagline?: string;
  /** Optional. Max 2000 chars. */
  bio?: string;
  /** Optional. Max 3000 chars. */
  executiveSummary?: string;
  /**
   * One of the four supported report types.
   * Defaults to "Enterprise Strategic Audit" if unrecognised.
   */
  reportType?: "AI Startup Audit" | "Creator Growth Report" | "Enterprise Strategic Audit" | "SaaS Growth Analysis";
  /** Key/value numeric metrics (mrr, users, growth_rate, churn_rate, ltv, cac, nps, uptime). */
  metrics?: Record<string, number>;
  /** Up to 20 KPI items. */
  kpis?: KpiItem[];
  /** Revenue projection data (passed verbatim to the Python engine). */
  revenueProjections?: Record<string, unknown>;
  /** Up to 30 risk items. */
  riskItems?: RiskItem[];
  /** Up to 30 roadmap items. */
  roadmapItems?: RoadmapItem[];
  /** Up to 20 competitor profiles. */
  competitiveData?: CompetitorItem[];
  /** Up to 20 tech stack rows. */
  techStack?: TechStackItem[];
  /**
   * Map of section-key → narrative text (max 4000 chars per value).
   * Keys must match /^[a-zA-Z0-9_]{1,60}$/.
   */
  aiNarratives?: Record<string, string>;
  /**
   * Base64-encoded logo image (no data URI prefix).
   * Must match /^[A-Za-z0-9+/=]{20,}$/.
   */
  logoBase64?: string;
  /** Audience demographic / persona data (passed verbatim). */
  audienceData?: Record<string, unknown>;
}

/**
 * POST /api/pdf-report/generate — success response
 * Returns the raw PDF as application/pdf binary.
 * Response headers:
 *   Content-Type: application/pdf
 *   Content-Disposition: attachment; filename="<safeName>_report.pdf"
 *   X-Report-Type: <reportType>
 *   X-Company-Name: <companyName>
 */
export type GenerateSuccessResponse = ArrayBuffer; // binary PDF body

/** POST /api/pdf-report/generate — error response */
export interface GenerateErrorResponse {
  error: string;
  /** Only present in development mode */
  details?: string;
  /** Set to "SUBSCRIPTION_REQUIRED" when subscription check fails */
  code?: string;
}

// ── API route — preview (/api/pdf-report/preview) ───────────────────────────

/**
 * POST /api/pdf-report/preview
 *
 * Accepts the same shape as GenerateRequestBody, or a partial config.
 * company_name / companyName defaults to "Preview" if missing.
 */
export interface PreviewRequestBody {
  /** Wrap in reportConfig key, or send flat. */
  reportConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

/** POST /api/pdf-report/preview — success response */
export interface PreviewSuccessResponse {
  status: "ok";
  /** data: URI — data:image/png;base64,<base64> — PNG of page 1. */
  preview: string;
  pageCount: number;
  dpi: number;
}

/** POST /api/pdf-report/preview — error response */
export interface PreviewErrorResponse {
  error: string;
  details?: string;
}

// ── API route — export (/api/pdf-report/export) ──────────────────────────────

/**
 * POST /api/pdf-report/export
 *
 * Accepts the base64-encoded PDF from a prior /generate call and
 * re-serves it (or converts to DOCX) as a file download.
 */
export interface ExportRequestBody {
  /** "pdf" | "docx". Defaults to "pdf". */
  format?: "pdf" | "docx";
  /** Desired filename (without extension). Sanitised server-side. Max 100 chars. */
  filename?: string;
  /** Required. Base64-encoded PDF. Must start with %PDF magic bytes after decode. */
  pdfBase64: string;
}

/**
 * POST /api/pdf-report/export — success response
 * Returns binary file.
 * Content-Type: application/pdf  OR  application/vnd.openxmlformats-officedocument.wordprocessingml.document
 * Content-Disposition: attachment; filename="<safeFilename>.<ext>"
 */
export type ExportSuccessResponse = ArrayBuffer;

/** POST /api/pdf-report/export — error response */
export interface ExportErrorResponse {
  error: string;
  details?: string;
  code?: string;
}

// ── API route — activate (/api/pdf-report/activate) ─────────────────────────

/**
 * POST /api/pdf-report/activate
 *
 * Called after Stripe checkout success to set the report_engine_uid cookie.
 * Verifies the subscription is active before issuing the cookie.
 */
export interface ActivateRequestBody {
  /** The user_id from Stripe metadata. Max 256 chars. */
  user_id: string;
}

/** POST /api/pdf-report/activate — success response */
export interface ActivateSuccessResponse {
  ok: true;
}

/** POST /api/pdf-report/activate — error response */
export interface ActivateErrorResponse {
  error: string;
  code?: "SUBSCRIPTION_NOT_FOUND";
}

// ── Shared sub-shapes ────────────────────────────────────────────────────────

export interface KpiItem {
  label: string;
  value: string;
  maturity?: "Optimized" | "Advanced" | "Developing" | "Initial" | "Critical";
  trend?: string;
}

export interface RiskItem {
  category: string;
  risk: string;
  severity?: "Critical" | "High" | "Medium" | "Low";
  likelihood?: "Certain" | "Likely" | "Possible" | "Unlikely" | "High" | "Medium" | "Low";
  mitigation?: string;
}

export interface RoadmapItem {
  phase: string;
  milestone: string;
  owner?: string;
  status?: string;
}

export interface CompetitorItem {
  competitor: string;
  strength?: string;
  weakness?: string;
  positioning?: string;
}

export interface TechStackItem {
  layer: string;
  tech: string;
  hosting?: string;
  status?: string;
}
