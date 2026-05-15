"use client";

import React, { useState, useRef, useCallback } from "react";
import styles from "./panel-pdf-report-engine.module.css";
// DarkVeil and PixelSnow removed — replaced with neutral stub divs below.
// If you want the original animated backgrounds, re-add those components from
// francois-landing and restore the imports above.

import type {
  ReportTemplate,
  AnalysisType,
  ReportTone,
  ReportSection,
  DataIntegration,
  ReportFormData,
  ReportConfig,
} from "../types";

export type {
  ReportTemplate,
  AnalysisType,
  ReportTone,
  ReportSection,
  DataIntegration,
  ReportFormData,
  ReportConfig,
};

// ── Component props ───────────────────────────────────────────────────────────

export interface PanelPDFReportEngineProps {
  /** Called when user triggers analysis in Step 3 */
  onAnalyze?: (config: ReportConfig) => void;
  /** Called when user requests a PDF preview */
  onPreview?: (config: ReportConfig) => Promise<string | null>;
  /** Called when user clicks a final export button */
  onExport?: (config: ReportConfig, format: "pdf" | "docx" | "ppt") => void;
  /** External preview URL (data URL or blob URL) injected by parent after onPreview */
  previewUrl?: string | null;
  /** Whether analysis is currently running (parent controls this) */
  isAnalyzing?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMPLATES: { id: ReportTemplate; label: string; icon: string; badge?: string }[] = [
  { id: "ai-startup-audit",           label: "AI Startup Audit",          icon: "🤖", badge: "HOT" },
  { id: "creator-growth-report",      label: "Creator Growth Report",     icon: "🎨" },
  { id: "enterprise-strategic-audit", label: "Enterprise Strategic Audit", icon: "🏢" },
  { id: "saas-growth-analysis",       label: "SaaS Growth Analysis",      icon: "📈" },
];

const STEP_LABELS = [
  "Company / Project",
  "Data Sources",
  "AI Analysis Engine",
  "Structure + Export",
];

const INDUSTRIES = [
  "Music & Entertainment",
  "SaaS / Software",
  "E-commerce & Retail",
  "Creator Economy",
  "Health & Wellness",
  "Finance & Fintech",
  "AI & Machine Learning",
  "Media & Publishing",
  "Education & EdTech",
  "Other",
];

const ANALYSIS_OPTIONS: { id: AnalysisType; name: string; icon: string; desc: string }[] = [
  { id: "competitive", name: "Competitive Analysis",    icon: "⚔️",  desc: "Map your competitive landscape and identify positioning gaps" },
  { id: "growth",      name: "Growth Vectors",          icon: "🚀",  desc: "Surface high-leverage growth opportunities and channels" },
  { id: "risk",        name: "Risk Assessment",         icon: "🛡️",  desc: "Identify threats, vulnerabilities and mitigation strategies" },
  { id: "market",      name: "Market Intelligence",     icon: "🌍",  desc: "TAM/SAM/SOM analysis with trend forecasting" },
  { id: "technical",   name: "Technical Audit",         icon: "🔧",  desc: "Architecture review, tech debt scoring, scalability roadmap" },
  { id: "financial",   name: "Financial Projection",    icon: "💰",  desc: "Revenue modeling, burn rate analysis, funding scenarios" },
];

const TONES: { id: ReportTone; label: string }[] = [
  { id: "executive",  label: "Executive"  },
  { id: "analytical", label: "Analytical" },
  { id: "narrative",  label: "Narrative"  },
  { id: "tactical",   label: "Tactical"   },
];

const DATA_INTEGRATIONS: DataIntegration[] = [
  { id: "google-analytics", name: "Google Analytics", icon: "📊", connected: false, category: "analytics" },
  { id: "spotify",          name: "Spotify for Artists", icon: "🎵", connected: false, category: "music" },
  { id: "twitter",          name: "X / Twitter",     icon: "𝕏",  connected: false, category: "social" },
  { id: "instagram",        name: "Instagram",        icon: "📸", connected: false, category: "social" },
  { id: "stripe",           name: "Stripe",           icon: "💳", connected: false, category: "payments" },
  { id: "youtube",          name: "YouTube Studio",   icon: "▶️", connected: false, category: "video" },
  { id: "semrush",          name: "SEMrush",          icon: "🔍", connected: false, category: "seo" },
  { id: "hubspot",          name: "HubSpot CRM",      icon: "🔶", connected: false, category: "crm" },
];

const DEFAULT_SECTIONS: ReportSection[] = [
  { id: "executive-summary",  name: "Executive Summary",   icon: "📋", enabled: true,  description: "High-level findings and key takeaways" },
  { id: "market-analysis",    name: "Market Analysis",     icon: "🌍", enabled: true,  description: "TAM/SAM/SOM with trend data" },
  { id: "competitive-intel",  name: "Competitive Intel",   icon: "⚔️", enabled: true,  description: "Competitor mapping and gap analysis" },
  { id: "growth-strategies",  name: "Growth Strategies",   icon: "🚀", enabled: true,  description: "Prioritized action recommendations" },
  { id: "financial-model",    name: "Financial Model",     icon: "💰", enabled: false, description: "Revenue projections and scenarios" },
  { id: "risk-matrix",        name: "Risk Matrix",         icon: "🛡️", enabled: true,  description: "Risk identification and mitigations" },
  { id: "tech-audit",         name: "Technical Audit",     icon: "🔧", enabled: false, description: "Infrastructure and scalability review" },
  { id: "appendix",           name: "Appendix & Data",     icon: "📎", enabled: true,  description: "Raw data tables and source citations" },
];

const INITIAL_FORM: ReportFormData = {
  companyName: "",
  industry: "",
  description: "",
  logoFile: null,
  logoDataUrl: "",
  websiteUrls: [],
  integrations: [],
  analysisTypes: ["growth", "competitive"],
  sections: DEFAULT_SECTIONS,
  depthLevel: 70,
  confidenceThreshold: 65,
  reportTone: "executive",
  includePredictions: true,
  includeCompetitors: true,
  includeActionItems: true,
};

// ── Sub-components ────────────────────────────────────────────────────────────

const ANALYSIS_CONFIDENCE: Record<AnalysisType, string> = {
  competitive: "94% match",
  growth:      "91% match",
  risk:        "88% match",
  market:      "96% match",
  technical:   "85% match",
  financial:   "90% match",
};

const AI_CHIPS = [
  "Revenue Growth", "Market Positioning", "Competitive Moat",
  "Churn Vectors", "TAM Expansion", "Unit Economics",
];

function StepProgress({
  current,
  onGoto,
  completedUpTo,
}: {
  current: number;
  onGoto: (i: number) => void;
  completedUpTo: number;
}): React.JSX.Element {
  const pct = Math.round(((current + 1) / STEP_LABELS.length) * 100);
  const timeRemaining = current === 0 ? "~3 min remaining" : current === 1 ? "~2 min remaining" : current === 2 ? "~1 min remaining" : "Ready to export";
  return (
    <div className={styles.stepList}>
      {/* Progress bar */}
      <div className={styles.sidebarProgress}>
        <div className={styles.sidebarProgressMeta}>
          <span className={styles.sidebarProgressStep}>Step {current + 1} of {STEP_LABELS.length}</span>
          <span className={styles.sidebarProgressPct}>{pct}%</span>
        </div>
        <div className={styles.sidebarProgressTrack}>
          <div className={styles.sidebarProgressFill} style={{ width: `${pct}%` }} />
        </div>
        <span className={styles.sidebarProgressTime}>{timeRemaining}</span>
      </div>

      {STEP_LABELS.map((label, i) => {
        const isActive = i === current;
        const isDone = i < completedUpTo;
        const isReachable = i <= completedUpTo;
        return (
          <div
            key={i}
            className={[
              styles.stepItem,
              isActive ? styles.active : "",
              isDone ? styles.completed : "",
            ].join(" ")}
            onClick={() => isReachable && onGoto(i)}
            role="button"
            tabIndex={isReachable ? 0 : -1}
            aria-label={`Step ${i + 1}: ${label}${isDone ? " (completed)" : ""}${isActive ? " (current)" : ""}`}
            onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && isReachable) onGoto(i); }}
            style={{ cursor: isReachable ? "pointer" : "default" }}
          >
            <div className={[
              styles.stepNumber,
              isActive ? styles.active : "",
              isDone ? styles.completed : "",
            ].join(" ")}>
              {isDone ? "✓" : i + 1}
            </div>
            <span className={styles.stepName}>
              {label}
            </span>
            {isDone && (
              <svg className={styles.stepCheck} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TemplatePicker({
  selected,
  onChange,
}: {
  selected: ReportTemplate;
  onChange: (t: ReportTemplate) => void;
}): React.JSX.Element {
  return (
    <div className={styles.templatePills}>
      {TEMPLATES.map((t) => (
        <button
          key={t.id}
          className={[
            styles.templatePill,
            selected === t.id ? styles.templatePillActive : "",
          ].join(" ")}
          onClick={() => onChange(t.id)}
          aria-pressed={selected === t.id}
        >
          <span className={styles.templatePillIcon}>{t.icon}</span>
          <span className={[
            styles.templatePillLabel,
            selected === t.id ? styles.templatePillLabelActive : "",
          ].join(" ")}>
            {t.label}
          </span>
          {t.badge && <span className={styles.templatePillBadge}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({
  name,
  desc,
  checked,
  onChange,
}: {
  name: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.JSX.Element {
  const id = `toggle-${name.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleInfo}>
        <div className={styles.toggleName}>{name}</div>
        {desc && <div className={styles.toggleDesc}>{desc}</div>}
      </div>
      <label className={styles.toggle} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className={styles.toggleInput}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className={styles.toggleSlider} />
      </label>
    </div>
  );
}

// ── SliderField ───────────────────────────────────────────────────────────────

function SliderField({
  name,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  name: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (v: number) => void;
}): React.JSX.Element {
  return (
    <div className={styles.sliderRow}>
      <div className={styles.sliderHeader}>
        <span className={styles.sliderName}>{name}</span>
        <span className={styles.sliderValue}>{value}{unit ?? "%"}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        className={styles.sliderInput}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={name}
      />
    </div>
  );
}

// ── PDF Preview Panel ─────────────────────────────────────────────────────────

function PDFPreviewPanel({
  formData,
  template,
  onExport,
  isAnalyzing = false,
  previewUrl,
}: {
  formData: ReportFormData;
  template: ReportTemplate;
  onExport: (format: "pdf" | "docx" | "ppt") => void;
  isAnalyzing?: boolean;
  previewUrl?: string | null;
}): React.JSX.Element {
  const templateLabel = TEMPLATES.find((t) => t.id === template)?.label ?? "Report";
  const hasName = formData.companyName.trim().length > 0;
  const displayName = hasName ? formData.companyName : "Your Company";

  const enabledSections = formData.sections.filter((s) => s.enabled);

  return (
    <div className={styles.preview}>
      <div className={styles.previewHeader}>
        <div className={styles.previewTitle}>
          <div className={styles.previewLiveDot} />
          Live Preview
        </div>
        <button className={styles.previewZoom} aria-label="Toggle zoom">100%</button>
      </div>

      {/* Shimmer overlay while analyzing */}
      {isAnalyzing && (
        <div className={styles.shimmerOverlay} aria-live="polite" aria-label="Analyzing report...">
          <div className={styles.analyzingText}>
            <span className={styles.analyzeSpinner} aria-hidden="true" />
            Analyzing data…
          </div>
          <div className={styles.shimmerStack}>
            <div className={styles.shimmerTitle} />
            <div className={styles.shimmerBar} style={{ width: "85%" }} />
            <div className={styles.shimmerLine} style={{ width: "70%" }} />
            <div className={styles.shimmerLine} style={{ width: "90%" }} />
          </div>
          <div className={styles.shimmerGrid}>
            <div className={styles.shimmerTile} />
            <div className={styles.shimmerTile} />
            <div className={styles.shimmerTile} />
            <div className={styles.shimmerTile} />
          </div>
        </div>
      )}

      {/* Empty state when no preview URL and not analyzing */}
      {!isAnalyzing && !previewUrl && (
        <div className={styles.previewEmpty} aria-label="No preview available">
          <div className={styles.previewEmptyIcon} aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div className={styles.previewEmptyTitle}>No preview yet</div>
          <div className={styles.previewEmptySub}>
            Complete the form steps and run AI analysis to generate your report preview.
          </div>
        </div>
      )}

      {/* Live preview iframe when URL is available */}
      {!isAnalyzing && previewUrl && (
        <iframe
          className={styles.previewIframe}
          src={previewUrl}
          title="Report preview"
          aria-label="Live report preview"
        />
      )}

      <div className={styles.previewScroll} style={{ display: (!isAnalyzing && !previewUrl) ? "none" : undefined }}>
        {/* Cover Page */}
        <div className={styles.pdfPage}>
          <div className={[styles.pdfPageInner, styles.pdfCoverPage].join(" ")}>
            <div className={styles.pdfCoverBand} />
            <div className={styles.pdfCoverContent}>
              <div className={styles.pdfCoverTag}>{templateLabel}</div>
              <div className={styles.pdfCoverTitle}>{displayName}</div>
              <div className={styles.pdfCoverSub}>
                {formData.industry || "Industry Analysis"} · Confidential Report · 2026
              </div>
              <div className={styles.pdfCoverKpis}>
                {[
                  { val: "94%",  label: "AI Confidence"  },
                  { val: `${enabledSections.length}`,    label: "Sections"       },
                  { val: formData.analysisTypes.length > 0 ? `${formData.analysisTypes.length}` : "—", label: "Analyses" },
                ].map((kpi) => (
                  <div key={kpi.label} className={styles.pdfCoverKpi}>
                    <div className={styles.pdfCoverKpiVal}>{kpi.val}</div>
                    <div className={styles.pdfCoverKpiLabel}>{kpi.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section pages (first 3 enabled sections) */}
        {enabledSections.slice(0, 3).map((section) => (
          <div key={section.id} className={styles.pdfPage}>
            <div className={[styles.pdfPageInner, styles.pdfSectionPage].join(" ")}>
              <div className={styles.pdfSectionHeader} />
              <div className={styles.pdfSectionBody}>
                <div className={styles.pdfSectionTitle}>
                  {section.icon} {section.name}
                </div>
                {/* Mock bar chart */}
                <div className={styles.pdfBarChart}>
                  {[85, 62, 78, 45, 91].map((pct, i) => (
                    <div key={i} className={styles.pdfBarRow}>
                      <div className={styles.pdfBarLabel}>Item {i + 1}</div>
                      <div className={styles.pdfBarTrack}>
                        <div className={styles.pdfBarFill} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Mock metric grid */}
                <div className={styles.pdfMetricGrid}>
                  {["2.4M", "+18%", "4.7", "$12K"].map((v) => (
                    <div key={v} className={styles.pdfMetricCard}>
                      <div className={styles.pdfMetricVal}>{v}</div>
                      <div className={styles.pdfMetricLabel}>metric</div>
                    </div>
                  ))}
                </div>
                {/* Mock text lines */}
                <div className={styles.pdfTextBlock}>
                  {[90, 100, 75, 85, 60].map((w, i) => (
                    <div key={i} className={styles.pdfTextLine} style={{ width: `${w}%` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Remaining pages teaser */}
        {enabledSections.length > 3 && (
          <div className={styles.previewMoreSections}>
            + {enabledSections.length - 3} more sections in final export
          </div>
        )}
      </div>

      <div className={styles.previewFooter}>
        <div className={styles.previewFooterLabel}>Export Report</div>
        <div className={styles.exportBtns}>
          <button
            className={[styles.exportBtn, styles.exportBtnPrimary].join(" ")}
            onClick={() => onExport("pdf")}
            aria-label="Export PDF"
          >
            📄 PDF
          </button>
          <button
            className={styles.exportBtn}
            onClick={() => onExport("docx")}
            aria-label="Export DOCX"
          >
            📝 DOCX
          </button>
          <button
            className={styles.exportBtn}
            onClick={() => onExport("ppt")}
            aria-label="Export PPT"
          >
            🖥️ PPT
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Company Input ─────────────────────────────────────────────────────

function Step1({
  formData,
  onChange,
  nav,
}: {
  formData: ReportFormData;
  onChange: (patch: Partial<ReportFormData>) => void;
  nav?: React.ReactNode;
}): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => onChange({ logoFile: file, logoDataUrl: e.target?.result as string });
    reader.readAsDataURL(file);
  }, [onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  }, [handleFile]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  return (
    <>
      <div className={styles.stepHeader}>
        <div className={styles.stepHeaderTop}>
          <span className={styles.stepBadge}>Step 1 / 4 · 25%</span>
        </div>
        <h2 className={styles.stepTitle}>Company / Project</h2>
        <div className={styles.progressIndicator}>
          <div className={styles.progressBar}>
            <div className={styles.progressBarFill} style={{ width: "25%" }} />
          </div>
          <span className={styles.progressPercentLabel}>25%</span>
        </div>
        {nav}
        <p className={styles.stepDesc}>
          Tell the AI engine about your company or project so it can tailor the report.
        </p>
      </div>

      <div className={styles.formCard}>
        <div className={styles.formCardTitle}>
          <span>🏢</span> Basic Information
        </div>

        <div className={styles.formRow}>
          <div className={styles.field}>
            <label className={[styles.fieldLabel, styles.fieldLabelRequired].join(" ")}>
              Company / Project Name
            </label>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. Frxncois Underground"
              value={formData.companyName}
              onChange={(e) => onChange({ companyName: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={[styles.fieldLabel, styles.fieldLabelRequired].join(" ")}>
              Industry
            </label>
            <select
              className={[styles.input, styles.select].join(" ")}
              value={formData.industry}
              onChange={(e) => onChange({ industry: e.target.value })}
              aria-label="Select industry"
            >
              <option value="">Select industry…</option>
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>{ind}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Description</label>
          <textarea
            className={[styles.input, styles.textarea].join(" ")}
            placeholder="Describe your company, target market, and current stage in 2–3 sentences…"
            value={formData.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={4}
            maxLength={400}
            aria-describedby="desc-counter"
          />
          {formData.description.length > 320 && (
            <span
              id="desc-counter"
              className={[
                styles.charCounter,
                formData.description.length >= 380 ? styles.charCounterWarn : "",
              ].filter(Boolean).join(" ")}
            >
              {formData.description.length} / 400
            </span>
          )}
        </div>
      </div>

      <div className={styles.formCard}>
        <div className={styles.formCardTitle}>
          <span>🖼️</span> Brand Logo
        </div>

        {formData.logoDataUrl ? (
          <div className={styles.logoPreviewWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={formData.logoDataUrl}
              alt="Logo preview"
              className={styles.logoPreviewImg}
            />
            <div className={styles.logoPreviewMeta}>
              <span className={styles.logoPreviewName}>{formData.logoFile?.name ?? "logo"}</span>
              <div className={styles.logoPreviewActions}>
                <button
                  className={styles.logoReplaceBtn}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Replace logo"
                >
                  Replace
                </button>
                <button
                  className={styles.logoRemoveBtn}
                  onClick={() => onChange({ logoFile: null, logoDataUrl: "" })}
                  aria-label="Remove logo"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className={[styles.uploadZone, dragging ? styles.uploadZoneDrag : ""].join(" ")}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            aria-label="Upload logo"
            onKeyDown={(e) => { if (e.key === "Enter") fileInputRef.current?.click(); }}
          >
            <div className={styles.uploadIcon}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className={styles.uploadText}>
              <span className={styles.uploadTextStrong}>Click to upload</span> or drag & drop
            </div>
            <div className={styles.uploadMeta}>PNG, JPG, SVG · max 2 MB</div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          aria-hidden="true"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
      </div>
    </>
  );
}

// ── Step 2: Data Sources ──────────────────────────────────────────────────────

function Step2({
  formData,
  onChange,
  nav,
}: {
  formData: ReportFormData;
  onChange: (patch: Partial<ReportFormData>) => void;
  nav?: React.ReactNode;
}): React.JSX.Element {
  const [urlInput, setUrlInput] = useState("");

  const addUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!formData.websiteUrls.includes(trimmed)) {
      onChange({ websiteUrls: [...formData.websiteUrls, trimmed] });
    }
    setUrlInput("");
  };

  const removeUrl = (url: string) => {
    onChange({ websiteUrls: formData.websiteUrls.filter((u) => u !== url) });
  };

  const toggleIntegration = (id: string) => {
    const current = formData.integrations;
    if (current.includes(id)) {
      onChange({ integrations: current.filter((i) => i !== id) });
    } else {
      onChange({ integrations: [...current, id] });
    }
  };

  return (
    <>
      <div className={styles.stepHeader}>
        <div className={styles.stepHeaderTop}>
          <span className={styles.stepBadge}>Step 2 / 4 · 50%</span>
        </div>
        <h2 className={styles.stepTitle}>Data Sources</h2>
        <div className={styles.progressIndicator}>
          <div className={styles.progressBar}>
            <div className={styles.progressBarFill} style={{ width: "50%" }} />
          </div>
          <span className={styles.progressPercentLabel}>50%</span>
        </div>
        {nav}
        <p className={styles.stepDesc}>
          Provide URLs to crawl and connect integrations so the AI can gather real intelligence.
        </p>
      </div>

      <div className={styles.formCard}>
        <div className={styles.formCardTitle}>
          <span>🔗</span> Website & Content URLs
        </div>

        <div className={styles.urlRow}>
          <input
            type="url"
            className={[styles.input, styles.urlInput].join(" ")}
            placeholder="https://yourwebsite.com"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } }}
          />
          <button className={styles.urlAddBtn} onClick={addUrl} aria-label="Add URL">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add URL
          </button>
        </div>

        {formData.websiteUrls.length > 0 && (
          <div className={styles.urlList}>
            {formData.websiteUrls.map((url) => (
              <div key={url} className={styles.urlChip}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: "var(--color-text-muted)" }}>
                  <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span className={styles.urlChipText}>{url}</span>
                <button className={styles.urlChipRemove} onClick={() => removeUrl(url)} aria-label={`Remove ${url}`}>×</button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.infoBanner}>
          <span className={styles.infoBannerIcon}>⚠️</span>
          <span className={styles.infoBannerText}>
            The AI engine will crawl these URLs during analysis. Ensure you have permission to analyze public content.
          </span>
        </div>
      </div>

      <div className={styles.formCard}>
        <div className={styles.formCardTitle}>
          <span>🔌</span> Data Integrations
        </div>

        <div className={styles.integrationGrid}>
          {DATA_INTEGRATIONS.map((intg) => {
            const active = formData.integrations.includes(intg.id);
            return (
              <div
                key={intg.id}
                className={[styles.integrationCard, active ? styles.integrationCardActive : ""].join(" ")}
                onClick={() => toggleIntegration(intg.id)}
                role="checkbox"
                aria-checked={active}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleIntegration(intg.id); } }}
              >
                <div className={styles.integrationIcon}>{intg.icon}</div>
                <div className={styles.integrationName}>{intg.name}</div>
                <div className={styles.integrationStatus}>
                  <div className={[styles.integrationStatusDot, active ? styles.integrationStatusDotActive : ""].join(" ")} />
                  {active ? "Selected" : "Click to add"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Step 3: AI Analysis Engine ────────────────────────────────────────────────

function Step3({
  formData,
  onChange,
  isAnalyzing,
  onAnalyze,
}: {
  formData: ReportFormData;
  onChange: (patch: Partial<ReportFormData>) => void;
  isAnalyzing: boolean;
  onAnalyze: () => void;
}): React.JSX.Element {
  const toggleAnalysis = (id: AnalysisType) => {
    const current = formData.analysisTypes;
    if (current.includes(id)) {
      if (current.length === 1) return; // keep at least one
      onChange({ analysisTypes: current.filter((a) => a !== id) });
    } else {
      onChange({ analysisTypes: [...current, id] });
    }
  };

  return (
    <>
      <div className={styles.stepHeader}>
        <div className={styles.stepHeaderTop}>
          <span className={styles.stepBadge}>Step 3 / 4 · 75%</span>
        </div>
        <h2 className={styles.stepTitle}>AI Analysis Engine</h2>
        <div className={styles.progressIndicator}>
          <div className={styles.progressBar}>
            <div className={styles.progressBarFill} style={{ width: "75%" }} />
          </div>
          <span className={styles.progressPercentLabel}>75%</span>
        </div>
        <p className={styles.stepDesc}>
          Configure the analysis parameters and choose which intelligence modules to activate.
        </p>
      </div>

      <div className={styles.formCard}>
        <div className={styles.formCardTitle}>
          <span>🧠</span> Analysis Modules
        </div>
        <div className={styles.analysisGrid}>
          {ANALYSIS_OPTIONS.map((opt) => {
            const active = formData.analysisTypes.includes(opt.id);
            return (
              <div
                key={opt.id}
                className={[styles.analysisCard, active ? styles.analysisCardActive : ""].join(" ")}
                onClick={() => toggleAnalysis(opt.id)}
                role="checkbox"
                aria-checked={active}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAnalysis(opt.id); } }}
              >
                <div className={styles.analysisCardHeader}>
                  <div className={styles.analysisCardLeft}>
                    <span className={styles.analysisCardIcon}>{opt.icon}</span>
                    <span className={styles.analysisCardName}>{opt.name}</span>
                  </div>
                  <span className={styles.confidenceBadge}>
                    {ANALYSIS_CONFIDENCE[opt.id]}
                  </span>
                </div>
                <div className={styles.analysisCardDesc}>{opt.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.aiChipsWrap} aria-label="AI recommendation topics">
        {AI_CHIPS.map((chip) => (
          <span key={chip} className={styles.aiChip}>
            <span className={styles.aiChipDot} aria-hidden="true" />
            {chip}
          </span>
        ))}
      </div>

      <div className={styles.formCard}>
        <div className={styles.formCardTitle}>
          <span>⚙️</span> Engine Parameters
        </div>

        <SliderField
          name="Analysis Depth"
          value={formData.depthLevel}
          min={20}
          max={100}
          onChange={(v) => onChange({ depthLevel: v })}
        />
        <SliderField
          name="Confidence Threshold"
          value={formData.confidenceThreshold}
          min={40}
          max={100}
          onChange={(v) => onChange({ confidenceThreshold: v })}
        />

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Report Tone</label>
          <div className={styles.tonePills}>
            {TONES.map((t) => (
              <button
                key={t.id}
                className={[styles.tonePill, formData.reportTone === t.id ? styles.tonePillActive : ""].join(" ")}
                onClick={() => onChange({ reportTone: t.id })}
                aria-pressed={formData.reportTone === t.id}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.formCard}>
        <div className={styles.formCardTitle}>
          <span>🔮</span> Content Flags
        </div>
        <Toggle
          name="Include AI Predictions"
          desc="Forward-looking market and growth projections"
          checked={formData.includePredictions}
          onChange={(v) => onChange({ includePredictions: v })}
        />
        <Toggle
          name="Include Competitor Profiles"
          desc="Automated competitor discovery and benchmarking"
          checked={formData.includeCompetitors}
          onChange={(v) => onChange({ includeCompetitors: v })}
        />
        <Toggle
          name="Include Action Items"
          desc="Concrete steps and sprint recommendations"
          checked={formData.includeActionItems}
          onChange={(v) => onChange({ includeActionItems: v })}
        />
      </div>

      <div className={styles.analyzeRow}>
        {isAnalyzing ? (
          <div className={styles.analysisPill}>
            <div className={styles.spinner} />
            AI analysis running — please wait…
          </div>
        ) : (
          <button
            className={styles.btnNext}
            onClick={onAnalyze}
            disabled={formData.analysisTypes.length === 0}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Run AI Analysis
          </button>
        )}
        {!isAnalyzing && (
          <span className={styles.analyzeModuleCount}>
            {formData.analysisTypes.length} module{formData.analysisTypes.length !== 1 ? "s" : ""} selected
          </span>
        )}
      </div>
    </>
  );
}

// ── Step 4: Structure + Export ────────────────────────────────────────────────

function Step4({
  formData,
  onChange,
  onExport,
  nav,
}: {
  formData: ReportFormData;
  onChange: (patch: Partial<ReportFormData>) => void;
  onExport: (format: "pdf" | "docx" | "ppt") => void;
  nav?: React.ReactNode;
}): React.JSX.Element {
  const toggleSection = (id: string) => {
    onChange({
      sections: formData.sections.map((s) =>
        s.id === id ? { ...s, enabled: !s.enabled } : s
      ),
    });
  };

  const enabledCount = formData.sections.filter((s) => s.enabled).length;
  const displayName = formData.companyName.trim() || "Your Company";

  return (
    <>
      <div className={styles.stepHeader}>
        <div className={styles.stepHeaderTop}>
          <span className={styles.stepBadge}>Step 4 / 4 · 100%</span>
        </div>
        <h2 className={styles.stepTitle}>Structure & Export</h2>
        <div className={styles.progressIndicator}>
          <div className={styles.progressBar}>
            <div className={styles.progressBarFill} style={{ width: "100%" }} />
          </div>
          <span className={styles.progressPercentLabel}>100%</span>
        </div>
        {nav}
        <p className={styles.stepDesc}>
          Select which sections to include in the final report, then export to your preferred format.
        </p>
      </div>

      <div className={styles.kpiGrid}>
        {[
          { icon: "📄", value: `${enabledCount}`, label: "Sections included",  colored: false },
          { icon: "🧠", value: `${formData.analysisTypes.length}`,    label: "AI modules active", colored: false },
          { icon: "🎯", value: `${formData.depthLevel}%`, label: "Analysis depth",    colored: true  },
        ].map((kpi) => (
          <div key={kpi.label} className={styles.kpiCard}>
            <div className={styles.kpiCardIcon}>{kpi.icon}</div>
            <div className={[styles.kpiCardValue, kpi.colored ? styles.kpiCardValueColored : ""].join(" ")}>
              {kpi.value}
            </div>
            <div className={styles.kpiCardLabel}>{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className={styles.formCard}>
        <div className={styles.formCardTitle}>
          <span>📑</span> Report Sections
        </div>
        <div className={styles.sectionGrid}>
          {formData.sections.map((section) => (
            <button
              key={section.id}
              className={[styles.sectionChip, section.enabled ? styles.sectionChipActive : ""].join(" ")}
              onClick={() => toggleSection(section.id)}
              aria-pressed={section.enabled}
              title={section.description}
            >
              {section.enabled && <span className={styles.sectionCheck}>✓</span>}
              {section.icon} {section.name}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.formCard}>
        <div className={styles.formCardTitle}>
          <span>🗂️</span> Page Order
        </div>
        {formData.sections.filter((s) => s.enabled).map((section) => (
          <div key={section.id} className={styles.structureRow}>
            <span className={styles.structureDrag}>⋮⋮</span>
            <span className={styles.structureIcon}>{section.icon}</span>
            <span className={styles.structureName}>{section.name}</span>
            <span className={styles.structureMeta}>{section.description}</span>
          </div>
        ))}
      </div>

      <div className={styles.successCard}>
        <div className={styles.successIcon}>📊</div>
        <div className={styles.successTitle}>{displayName} Report Ready</div>
        <div className={styles.successDesc}>
          Your report is configured and ready to export. Choose a format below.
          PDF includes full styling and charts. DOCX is editable. PPT is slide-ready.
        </div>
        <div className={styles.exportFinalBtns}>
          <button
            className={[styles.exportFinalBtn, styles.exportFinalBtnPrimary].join(" ")}
            onClick={() => onExport("pdf")}
          >
            📄 Export PDF
          </button>
          <button className={styles.exportFinalBtn} onClick={() => onExport("docx")}>
            📝 Export DOCX
          </button>
          <button className={styles.exportFinalBtn} onClick={() => onExport("ppt")}>
            🖥️ Export PPT
          </button>
        </div>
      </div>
    </>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function PanelPDFReportEngine({
  onAnalyze,
  onExport,
  isAnalyzing = false,
}: PanelPDFReportEngineProps): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [completedUpTo, setCompletedUpTo] = useState(0);
  const [template, setTemplate] = useState<ReportTemplate>("ai-startup-audit");
  const [formData, setFormData] = useState<ReportFormData>(INITIAL_FORM);

  const patchForm = useCallback((patch: Partial<ReportFormData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
  }, []);

  const buildConfig = (): ReportConfig => ({ template, formData });

  const handleNext = () => {
    const next = Math.min(step + 1, 3);
    setStep(next);
    setCompletedUpTo((prev) => Math.max(prev, next));
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleAnalyze = () => {
    onAnalyze?.(buildConfig());
    handleNext();
  };

  const handleExport = (format: "pdf" | "docx" | "ppt") => {
    onExport?.(buildConfig(), format);
  };

  const step1Valid = formData.companyName.trim().length > 0 && formData.industry.length > 0;
  const step2Valid = true; // urls and integrations are optional
  const step3Valid = formData.analysisTypes.length > 0;

  const canAdvance = [step1Valid, step2Valid, step3Valid, true][step] ?? true;

  return (
    <div className={styles.root}>
      {/*
        Background layer — DarkVeil + PixelSnow removed.
        Replace with your own animated background or leave as static dark bg
        (controlled by .bgLayer / .bgOverlay in the CSS module).
      */}
      <div className={styles.bgLayer} aria-hidden="true">
        <div className={styles.bgVeil} />
        <div className={styles.bgSnow} />
        <div className={styles.bgOverlay} aria-hidden="true" />
      </div>

      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div className={styles.logoWrap}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/report-engine-logo.png" alt="Report Engine" className={styles.logoImg} />
      </div>

      <div className={styles.shell}>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className={styles.sidebar} aria-label="Report engine sidebar">
          <div style={{ marginBottom: 4 }}>
            <div className={styles.sidebarLabel}>Progress</div>
            <StepProgress current={step} onGoto={setStep} completedUpTo={completedUpTo} />
          </div>

          <div>
            <div className={styles.sidebarLabel}>Report Type</div>
            <TemplatePicker selected={template} onChange={setTemplate} />
          </div>
        </aside>

        {/* ── Workspace ───────────────────────────────────────────────────── */}
        <main className={styles.workspace} aria-label="Report configuration workspace">
          <div className={styles.workspaceInner}>
            {step === 0 && (
              <Step1
                formData={formData}
                onChange={patchForm}
                nav={
                  <div className={styles.navBar}>
                    <button
                      className={styles.btnBack}
                      onClick={handleBack}
                      disabled={step === 0}
                      style={{ opacity: step === 0 ? 0 : 1, pointerEvents: step === 0 ? "none" : "auto" }}
                      aria-label="Previous step"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                      Back
                    </button>
                    <button
                      className={styles.btnNext}
                      onClick={handleNext}
                      disabled={!canAdvance}
                      aria-label="Next step"
                    >
                      Continue
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                }
              />
            )}
            {step === 1 && (
              <Step2
                formData={formData}
                onChange={patchForm}
                nav={
                  <div className={styles.navBar}>
                    <button
                      className={styles.btnBack}
                      onClick={handleBack}
                      disabled={false}
                      aria-label="Previous step"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                      Back
                    </button>
                    <button
                      className={styles.btnNext}
                      onClick={handleNext}
                      disabled={!canAdvance}
                      aria-label="Next step"
                    >
                      Continue
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                }
              />
            )}
            {step === 2 && (
              <Step3
                formData={formData}
                onChange={patchForm}
                isAnalyzing={isAnalyzing}
                onAnalyze={handleAnalyze}
              />
            )}
            {step === 3 && (
              <Step4
                formData={formData}
                onChange={patchForm}
                onExport={handleExport}
                nav={
                  <div className={styles.navBar}>
                    <button className={styles.btnBack} onClick={handleBack} aria-label="Previous step">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                      Back
                    </button>
                    <span className={styles.navBarMeta}>
                      {formData.companyName || "Untitled"} · {TEMPLATES.find((t) => t.id === template)?.label}
                    </span>
                  </div>
                }
              />
            )}
          </div>
        </main>

        {/* ── PDF Preview (desktop only via CSS) ──────────────────────────── */}
        <PDFPreviewPanel
          formData={formData}
          template={template}
          onExport={handleExport}
          isAnalyzing={isAnalyzing}
          previewUrl={null}
        />

      </div>
    </div>
  );
}
