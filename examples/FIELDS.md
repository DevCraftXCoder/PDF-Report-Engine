# Report Config — Field Reference

All fields accepted by `POST /api/pdf-report/generate` and the Python engine's `ReportConfig`. Corresponds to the `GenerateRequestBody` interface in `C:/Za/PDF-Report-Engine/types/index.ts`.

---

## Top-level fields

| Field | Required | Type | Max length | Notes |
|-------|----------|------|-----------|-------|
| `company_name` / `companyName` | Yes | string | 200 chars | The route normalises camelCase to snake_case before passing to Python |
| `industry` | Yes | string | 200 chars | Appears on cover page and section headers |
| `tagline` | No | string | 200 chars | Subtitle on cover page |
| `bio` | No | string | 2000 chars | Company background narrative |
| `executive_summary` / `executiveSummary` | No | string | 3000 chars | Opening section of the report |
| `report_type` / `reportType` | No | enum | — | See valid values below. Defaults to `"Enterprise Strategic Audit"` |
| `generated_at` | No | string | — | Set automatically by the route to today's date |
| `logo_base64` / `logoBase64` | No | string | — | Base64-encoded image, no `data:` prefix. Must match `/^[A-Za-z0-9+/=]{20,}$/` |

**Valid `report_type` values:**

- `"AI Startup Audit"`
- `"Creator Growth Report"`
- `"Enterprise Strategic Audit"`
- `"SaaS Growth Analysis"`

---

## `metrics` object

Key/value map of numeric metrics. All keys are optional. Non-numeric values are ignored.

| Key | Description |
|-----|-------------|
| `mrr` | Monthly Recurring Revenue (number) |
| `target_mrr` | MRR target |
| `users` | Active user count |
| `growth_rate` | MoM growth rate as a percentage (e.g. `22.5` for 22.5%) |
| `churn_rate` | Monthly churn rate as a percentage |
| `ltv` | Lifetime Value per customer |
| `cac` | Customer Acquisition Cost |
| `nps` | Net Promoter Score (-100 to 100) |
| `uptime` | Service uptime percentage (e.g. `99.94`) |

---

## `kpis` array

Up to 20 items. Each item:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `label` | Yes | string (max 60) | KPI name, e.g. "MRR" |
| `value` | Yes | string (max 40) | Formatted value, e.g. "$15,000" |
| `maturity` | No | enum | `"Optimized"` \| `"Advanced"` \| `"Developing"` \| `"Initial"` \| `"Critical"`. Defaults to `"Developing"` |
| `trend` | No | string (max 60) | Short trend description, e.g. "+22% MoM" |

---

## `revenue_projections` object

Passed verbatim to the Python engine. No schema enforcement. Recommended keys:

| Key | Type | Description |
|-----|------|-------------|
| `current_arr` | number | Current ARR |
| `q3_2026_target` | number | Q3 ARR target |
| `q4_2026_target` | number | Q4 ARR target |
| `2027_target` | number | Full-year 2027 target |
| `growth_model` | string | e.g. "land-and-expand", "product-led-growth" |
| `key_assumptions` | string[] | List of growth assumptions |

---

## `risk_items` array

Up to 30 items. Each item:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `category` | Yes | string (max 40) | Risk category, e.g. "Competitive", "Technical" |
| `risk` | Yes | string (max 200) | Risk description |
| `severity` | No | enum | `"Critical"` \| `"High"` \| `"Medium"` \| `"Low"`. Defaults to `"Medium"` |
| `likelihood` | No | enum | `"Certain"` \| `"Likely"` \| `"Possible"` \| `"Unlikely"` \| `"High"` \| `"Medium"` \| `"Low"`. Defaults to `"Medium"` |
| `mitigation` | No | string (max 300) | Mitigation strategy |

---

## `roadmap_items` array

Up to 30 items. Each item:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `phase` | Yes | string (max 30) | Timeline label, e.g. "Q3 2026" |
| `milestone` | Yes | string (max 200) | Milestone description |
| `owner` | No | string (max 60) | Responsible team or person |
| `status` | No | string (max 40) | e.g. "In Progress", "Planned", "Design", "Pipeline" |

---

## `competitive_data` array

Up to 20 items. Each item:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `competitor` | Yes | string (max 100) | Competitor name |
| `strength` | No | string (max 200) | What they do well |
| `weakness` | No | string (max 200) | Where they fall short |
| `positioning` | No | string (max 100) | One-line positioning relative to your product |

---

## `tech_stack` array

Up to 20 items. Each item:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `layer` | Yes | string (max 60) | Architecture layer, e.g. "API", "Database", "Frontend" |
| `tech` | Yes | string (max 100) | Technology name and version |
| `hosting` | No | string (max 100) | Hosting provider or environment |
| `status` | No | string (max 40) | e.g. "Production", "Planned", "Deprecated" |

---

## `ai_narratives` object

Map of section key to narrative text. Keys must match `/^[a-zA-Z0-9_]{1,60}$/`. Values are capped at 4000 characters. Up to however many keys fit within that constraint.

Common section keys used in the provided examples:

| Key | Purpose |
|-----|---------|
| `executive_overview` | Strategic summary for the opening section |
| `growth_analysis` | Analysis of growth drivers and constraints |
| `risk_summary` | Synthesis of the risk landscape |
| `competitive_positioning` | Competitive positioning narrative |

---

## `audience_data` object

Passed verbatim to the Python engine. No schema enforcement. Recommended keys:

| Key | Type | Description |
|-----|------|-------------|
| `primary_persona` | string | Primary buyer persona |
| `secondary_persona` | string | Secondary buyer persona |
| `geographic_focus` | string | Target geography |
| `deal_cycle` | string | Typical sales cycle length |
| `avg_stakeholders_per_deal` | number | Average buying committee size |

---

## Example files in this directory

| File | Report type | Description |
|------|-------------|-------------|
| `sample-config.json` | AI Startup Audit | NovaMind AI — Series A-stage AI company with $180k ARR |
| `sample-config-saas.json` | SaaS Growth Analysis | Helix HQ — bootstrapped SaaS at $3.2M ARR |
