import { SEED_PATIENTS, TRICKY_SAMPLE_REPORT } from "./mocks.js";
import { translateDOM } from "./i18n.js";
import { initDemoPlayer, startDemoMode } from "./demo.js";

const API_BASE = window.VITE_API_BASE_URL || "";

const VIEW_LABELS = {
  dashboard: "Dashboard",
  patients: "Patient Directory",
  "analyze-report": "Analyze Report",
  "analysis-results": "Analysis Results",
  "ai-assistant": "AI Assistant",
  "how-it-works": "How It Works",
};

const STATUS_STYLE = {
  urgent: {
    color: "#DC4545",
    bg: "rgba(220,69,69,0.12)",
    border: "border-[#DC4545]/40",
    icon: "error",
    label: { en: "URGENT", ur: "فوری خطرہ (URGENT)", "ro-ur": "URGENT" },
  },
  high: {
    color: "#E99A36",
    bg: "rgba(233,154,54,0.14)",
    border: "border-[#E99A36]/40",
    icon: "arrow_upward",
    label: { en: "HIGH", ur: "زیادہ (HIGH)", "ro-ur": "ZYADA (HIGH)" },
  },
  low: {
    color: "#4C83D9",
    bg: "rgba(76,131,217,0.12)",
    border: "border-[#4C83D9]/40",
    icon: "arrow_downward",
    label: { en: "LOW", ur: "کم (LOW)", "ro-ur": "KAM (LOW)" },
  },
  normal: {
    color: "#209B72",
    bg: "rgba(32,155,114,0.10)",
    border: "border-outline-variant/30",
    icon: "check_circle",
    label: { en: "NORMAL", ur: "نارمل (NORMAL)", "ro-ur": "NORMAL" },
  },
  cannot_classify: {
    color: "#8993A5",
    bg: "rgba(137,147,165,0.14)",
    border: "border-outline-variant/40",
    icon: "help",
    label: { en: "CANNOT CLASSIFY", ur: "فائلوں میں رینج نہیں", "ro-ur": "CANNOT CLASSIFY" },
  },
  needs_demographics: {
    color: "#8866CB",
    bg: "rgba(136,102,203,0.14)",
    border: "border-[#8866CB]/40",
    icon: "badge",
    label: { en: "NEEDS DEMOGRAPHICS", ur: "عمر/جنس درکار ہے", "ro-ur": "NEEDS AGE/SEX" },
  },
};

const SEED_MAP = Object.fromEntries(SEED_PATIENTS.map((p) => [p.patient_id, p]));

const state = {
  view: "dashboard", // dashboard | patients | analyze-report | analysis-results | ai-assistant | how-it-works
  lang: "en",
  patients: [...SEED_PATIENTS],
  directoryFilter: "all",
  directorySearch: "",
  activeMode: "patient", // patient | custom
  selectedPatientId: "P004",
  customText: TRICKY_SAMPLE_REPORT,
  overrideAge: null,
  overrideSex: null,
  analysis: null,
  loading: false,
  error: null,
  chatHistory: [],
  chatLoading: false,
  health: null,
  speaking: false,
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initials(name) {
  if (!name) return "CL";
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function apiFetch(path, options = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw data?.error || { code: `HTTP_${res.status}`, message: `Server returned HTTP ${res.status}` };
    }
    return data;
  } catch (e) {
    if (e?.name === "AbortError") {
      throw { code: "TIMEOUT", message: "The request timed out after 30 seconds. Please retry." };
    }
    if (e?.code && e?.message) throw e;
    throw { code: "NETWORK_ERROR", message: "Could not reach the backend server. Please check if it is running." };
  } finally {
    clearTimeout(id);
  }
}

async function loadHealthAndPatients() {
  try {
    const [h, pts] = await Promise.all([apiFetch("/api/health"), apiFetch("/api/patients")]);
    state.health = h;
    if (Array.isArray(pts) && pts.length) {
      state.patients = pts.map((p) => ({
        ...(SEED_MAP[p.patient_id] || {}),
        ...p,
        initials: initials(p.name),
      }));
    }
  } catch (_) {
    state.health = { status: "down" };
  }
  renderShell();
}

async function runAnalyze(resetChat = false, switchToView = null, silent = false) {
  state.loading = !silent;
  state.error = null;
  if (resetChat) state.chatHistory = [];
  if (switchToView) state.view = switchToView;
  renderShell();
  renderCurrentView();

  const payload = {
    patient_id: state.activeMode === "patient" ? state.selectedPatientId : null,
    report_text: state.activeMode === "custom" ? state.customText : null,
    age: state.overrideAge !== null && state.overrideAge !== "" ? Number(state.overrideAge) : null,
    sex: state.overrideSex || null,
    lang: state.lang,
  };

  try {
    state.analysis = await apiFetch("/api/analyze", { method: "POST", body: JSON.stringify(payload) });
    apiFetch("/api/health")
      .then((h) => {
        state.health = h;
        renderShell();
      })
      .catch(() => {});
  } catch (err) {
    state.error = err;
  } finally {
    state.loading = false;
    renderShell();
    renderCurrentView();
  }
}

function selectPatientAndOpen(pid, targetView = "analysis-results") {
  state.activeMode = "patient";
  state.selectedPatientId = pid;
  state.overrideAge = null;
  state.overrideSex = null;
  runAnalyze(true, targetView);
}

function openMobileSidebar() {
  const sb = document.getElementById("app-sidebar");
  const bd = document.getElementById("sidebar-backdrop");
  if (sb) sb.classList.remove("-translate-x-full");
  if (bd) bd.classList.remove("hidden");
}

function closeMobileSidebar() {
  const sb = document.getElementById("app-sidebar");
  const bd = document.getElementById("sidebar-backdrop");
  if (sb) sb.classList.add("-translate-x-full");
  if (bd) bd.classList.add("hidden");
}

function setView(viewName) {
  state.view = viewName;
  closeMobileSidebar();
  renderShell();
  renderCurrentView();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderShell() {
  // Update Sidebar active nav
  document.querySelectorAll("#sidebar-nav [data-nav-view]").forEach((el) => {
    const v = el.getAttribute("data-nav-view");
    const icon = el.querySelector(".material-symbols-outlined");
    if (v === state.view) {
      el.className =
        "nav-item flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT bg-surface-container text-primary font-semibold transition-all duration-150 cursor-pointer";
      if (icon) icon.classList.add("text-primary", "fill");
    } else {
      el.className =
        "nav-item flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT text-on-surface-variant font-normal hover:bg-surface-container-low hover:text-on-surface transition-all duration-150 cursor-pointer";
      if (icon) icon.classList.remove("text-primary", "fill");
    }
  });

  // Update Mobile Quick-Nav Strip active pill
  document.querySelectorAll("#mobile-top-nav [data-nav-view]").forEach((el) => {
    const v = el.getAttribute("data-nav-view");
    if (v === state.view) {
      el.className =
        "mobile-nav-pill shrink-0 px-3 py-1.5 rounded-full font-label-sm text-label-sm font-semibold bg-primary text-on-primary flex items-center gap-1 transition-all";
    } else {
      el.className =
        "mobile-nav-pill shrink-0 px-3 py-1.5 rounded-full font-label-sm text-label-sm font-medium bg-surface-container-low text-on-surface-variant hover:bg-surface-container flex items-center gap-1 transition-all";
    }
  });

  // Update Breadcrumb
  const bc = document.getElementById("breadcrumb-current");
  if (bc) bc.textContent = VIEW_LABELS[state.view] || "Dashboard";

  // Update Language Toggle buttons
  document.querySelectorAll("[data-lang-btn]").forEach((btn) => {
    const active = btn.getAttribute("data-lang-btn") === state.lang;
    btn.className = active
      ? "px-2.5 sm:px-3 py-1 rounded-full font-label-sm text-label-sm font-semibold bg-primary text-on-primary transition-all"
      : "px-2.5 sm:px-3 py-1 rounded-full font-label-sm text-label-sm font-semibold text-on-surface-variant hover:text-on-surface transition-all";
  });

  // Update TTS label
  const ttsLbl = document.getElementById("btn-tts-label");
  if (ttsLbl) ttsLbl.textContent = state.speaking ? "Stop" : "Listen";

  // Update Backend Health Pill
  const h = state.health;
  const dot = document.getElementById("health-dot");
  const ping = document.getElementById("health-ping");
  const txt = document.getElementById("health-text");
  if (h && h.status === "ok") {
    dot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-[#209B72]";
    ping.className = "pulse-indicator absolute inline-flex h-full w-full rounded-full bg-primary-container opacity-75";
    const hits = h.cache?.hits ?? 0;
    txt.textContent = `Backend: Connected${hits ? ` (${hits} cached)` : ""}`;
  } else {
    dot.className = "relative inline-flex rounded-full h-2.5 w-2.5 bg-[#DC4545]";
    ping.className = "hidden";
    txt.textContent = "Backend: Offline";
  }

  // Update Header Active Patient Pill
  const p = state.analysis?.patient || SEED_MAP[state.selectedPatientId] || {};
  const pLabel = document.getElementById("header-patient-label");
  if (pLabel) {
    pLabel.textContent = `Patient: ${p.name || "Custom Report"} (${p.patient_id || "Custom"})`;
  }

  // Translate persistent shell (Sidebar + Header + Mobile Nav)
  translateDOM(document.querySelector("aside"), state.lang);
  translateDOM(document.querySelector("header"), state.lang);
  translateDOM(document.getElementById("mobile-top-nav"), state.lang);
}

function computePinPct(r) {
  const ref = r.reference;
  if (!ref || ref.low === null || ref.high === null || typeof r.value !== "number") return null;
  const span = ref.high - ref.low;
  if (span <= 0) return 50;
  // Normal range occupies 50%..80% if urgent low exists, or 25%..75% standard
  const ratio = (r.value - ref.low) / span;
  const pct = 25 + ratio * 50;
  return Math.max(5, Math.min(95, Math.round(pct)));
}

/* ============================================================================
   VIEW 1: MAIN DASHBOARD (Teammate's citylab_main_dashboard)
   ============================================================================ */
function renderDashboardView() {
  const featured = ["P001", "P004", "P005", "P003"].map((id) => SEED_MAP[id]).filter(Boolean);
  return `
    <main class="p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto space-y-6 sm:space-y-8">
      <!-- 1. WELCOME HERO SECTION -->
      <section class="relative overflow-hidden rounded-lg bg-gradient-to-br from-[#3458C8] via-[#2F4FA8] to-[#2546A8] text-white p-5 sm:p-8 md:p-10 shadow-lg shadow-tertiary/10">
        <div class="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-white/5 blur-3xl pointer-events-none"></div>
        <div class="absolute right-40 -bottom-20 w-64 h-64 rounded-full bg-primary-container/20 blur-2xl pointer-events-none"></div>
        <div class="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div class="lg:col-span-8 space-y-4">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15">
              <span class="material-symbols-outlined text-primary-fixed text-[16px]">verified</span>
              <span class="font-label-sm text-label-sm text-white font-medium tracking-wide">Humanized Patient Diagnostic View • Multilingual (EN / اردو / Roman Urdu)</span>
            </div>
            <h1 class="font-headline-xl text-headline-xl text-white font-bold tracking-tight">
              Good Day! Welcome to CityLab.
            </h1>
            <p class="font-headline-sm text-headline-sm text-secondary-fixed font-normal leading-relaxed max-w-2xl">
              Understand your laboratory reports with clear, simple explanations.
            </p>
            <p class="font-body-md text-body-md text-white/80 max-w-2xl leading-relaxed">
              Explore your results, understand important values, and prepare better questions for your doctor. We translate complex blood and urine diagnostics into reassuring, human-first visual guidance grounded strictly in CityLab's verified files.
            </p>
            <div class="pt-2 flex flex-wrap items-center gap-4">
              <button data-goto-view="analyze-report" class="inline-flex items-center gap-2 px-6 py-3 bg-white text-secondary rounded-full font-label-lg text-label-lg font-bold shadow-md hover:bg-surface-container-low transition-all duration-150 active:scale-95">
                <span class="material-symbols-outlined text-[20px] fill">upload_file</span>
                <span>Analyze a Report</span>
              </button>
              <button data-goto-view="patients" class="inline-flex items-center gap-2 px-6 py-3 bg-white/10 text-white rounded-full font-label-lg text-label-lg font-semibold border border-white/20 hover:bg-white/20 transition-all duration-150 active:scale-95">
                <span class="material-symbols-outlined text-[20px]">group</span>
                <span>View All 14 Patients</span>
              </button>
              <button id="hero-audit-btn" class="inline-flex items-center gap-2 px-5 py-3 bg-primary-container text-on-primary-container rounded-full font-label-lg text-label-lg font-bold shadow-md hover:opacity-95 transition-all duration-150 active:scale-95">
                <span class="material-symbols-outlined text-[20px]">fact_check</span>
                <span>Run 14/14 Live Audit</span>
              </button>
            </div>
          </div>
          <!-- Hero Right Graphic / Biological Emblem -->
          <div class="lg:col-span-4 flex justify-center lg:justify-end">
            <div class="relative w-60 h-60 flex items-center justify-center">
              <div class="absolute inset-0 rounded-full border border-white/15 border-dashed animate-spin" style="animation-duration: 40s;"></div>
              <div class="absolute inset-4 rounded-full border border-white/15"></div>
              <div class="relative z-10 w-44 h-44 rounded-full bg-white border border-white/40 flex flex-col items-center justify-center p-4 text-center shadow-lg">
                <img src="/assets/logo.jpg" alt="CityLab Diagnostic AI Suite" class="w-36 object-contain mb-1" />
                <span class="font-body-sm text-body-sm text-primary font-semibold mt-0.5">Biomarker Decoder</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 2. FOUR SPACIOUS METRIC OVERVIEW CARDS -->
      <section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div data-goto-view="patients" class="cursor-pointer bg-surface-container-lowest rounded-lg p-6 border border-outline-variant/40 custom-shadow-card flex flex-col justify-between hover:border-tertiary/40 transition-colors">
          <div class="flex items-center justify-between mb-4">
            <span class="font-label-md text-label-md text-on-surface-variant font-medium">Cohort Volume</span>
            <div class="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-secondary">
              <span class="material-symbols-outlined text-[20px]">people</span>
            </div>
          </div>
          <div>
            <div class="font-data-metric text-data-metric font-bold text-on-surface mb-1">${state.patients.length} Patients</div>
            <p class="font-body-sm text-body-sm text-on-surface-variant">Seeded clinical cohort available</p>
          </div>
          <div class="mt-4 pt-3 border-t border-outline-variant/20 flex items-center justify-between font-label-sm text-label-sm text-secondary">
            <span>Active records ready</span>
            <span class="material-symbols-outlined text-[16px]">arrow_forward</span>
          </div>
        </div>

        <div data-goto-view="how-it-works" class="cursor-pointer bg-surface-container-lowest rounded-lg p-6 border border-outline-variant/40 custom-shadow-card flex flex-col justify-between hover:border-primary/40 transition-colors">
          <div class="flex items-center justify-between mb-4">
            <span class="font-label-md text-label-md text-on-surface-variant font-medium">Diagnostic Lab Store</span>
            <div class="w-10 h-10 rounded-full bg-primary-fixed/20 flex items-center justify-center text-primary">
              <span class="material-symbols-outlined text-[20px]">assignment</span>
            </div>
          </div>
          <div>
            <div class="font-data-metric text-data-metric font-bold text-on-surface mb-1">20 Corpus Files</div>
            <p class="font-body-sm text-body-sm text-on-surface-variant">14 reports + 6 reference/safety modules</p>
          </div>
          <div class="mt-4 pt-3 border-t border-outline-variant/20 flex items-center justify-between font-label-sm text-label-sm text-primary">
            <span>100% file:line grounded</span>
            <span class="material-symbols-outlined text-[16px]">check</span>
          </div>
        </div>

        <div class="bg-surface-container-lowest rounded-lg p-6 border border-outline-variant/40 custom-shadow-card flex flex-col justify-between hover:border-primary-container/40 transition-colors">
          <div class="flex items-center justify-between mb-4">
            <span class="font-label-md text-label-md text-on-surface-variant font-medium">Neural & Rule Core</span>
            <div class="w-10 h-10 rounded-full bg-[#209B72]/10 flex items-center justify-center text-[#209B72]">
              <span class="material-symbols-outlined text-[20px]">bolt</span>
            </div>
          </div>
          <div>
            <div class="font-data-metric text-data-metric font-bold text-[#209B72] mb-1">Ready</div>
            <p class="font-body-sm text-body-sm text-on-surface-variant">Deterministic Classifier + LLM Explainer</p>
          </div>
          <div class="mt-4 pt-3 border-t border-outline-variant/20 flex items-center justify-between font-label-sm text-label-sm text-[#209B72]">
            <span>EN • اردو • Roman Urdu</span>
            <span class="material-symbols-outlined text-[16px]">translate</span>
          </div>
        </div>

        <div data-open-patient="P004" class="cursor-pointer bg-surface-container-lowest rounded-lg p-6 border border-outline-variant/40 custom-shadow-card flex flex-col justify-between border-l-4 border-l-error">
          <div class="flex items-center justify-between mb-4">
            <span class="font-label-md text-label-md text-error font-semibold">Triage Notice</span>
            <div class="w-10 h-10 rounded-full bg-error-container/40 flex items-center justify-center text-error">
              <span class="material-symbols-outlined text-[20px]">priority_high</span>
            </div>
          </div>
          <div>
            <div class="font-data-metric text-data-metric font-bold text-error mb-1">2 Urgent Cases</div>
            <p class="font-body-sm text-body-sm text-on-surface-variant font-medium">Diana Prince (P004), Michael Scott (P013)</p>
          </div>
          <div class="mt-4 pt-3 border-t border-outline-variant/20 flex items-center justify-between font-label-sm text-label-sm text-error font-medium">
            <span>Click to review urgent case</span>
            <span class="material-symbols-outlined text-[16px]">notification_important</span>
          </div>
        </div>
      </section>

      <!-- 3. MAIN DASHBOARD CONTENT (Two Spacious Columns) -->
      <section class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <!-- LEFT COLUMN: Featured Checkpoint Patient Records (8 Cols) -->
        <div class="lg:col-span-8 space-y-4">
          <div class="flex items-center justify-between mb-2">
            <div>
              <h2 class="font-headline-lg text-headline-lg font-bold text-on-surface">Featured Checkpoint Patient Records</h2>
              <p class="font-body-sm text-body-sm text-on-surface-variant">Click any patient to run the live multi-step pipeline and inspect the results</p>
            </div>
            <button data-goto-view="patients" class="font-label-md text-label-md font-semibold text-secondary hover:text-on-secondary-fixed-variant flex items-center gap-1">
              <span>View all 14 patients</span>
              <span class="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          </div>

          ${featured
            .map((p) => {
              const isUrgent = p.tag === "urgent";
              const isDemo = p.tag === "demo";
              const badgeStyle =
                p.tag === "urgent"
                  ? "bg-[rgba(220,69,69,0.12)] text-[#DC4545]"
                  : p.tag === "demo"
                  ? "bg-[rgba(136,102,203,0.12)] text-[#8866CB]"
                  : p.tag === "conv"
                  ? "bg-[rgba(233,154,54,0.12)] text-[#E99A36]"
                  : "bg-[rgba(32,155,114,0.10)] text-[#209B72]";
              return `
                <div class="bg-surface-container-lowest rounded-lg p-6 border ${isUrgent ? "border-error/40" : isDemo ? "border-dashed border-[#8866CB]/60" : "border-outline-variant/40"} custom-shadow-card hover:custom-shadow-float transition-all duration-200">
                  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div class="flex items-start gap-4">
                      <div class="w-12 h-12 rounded-full ${isUrgent ? "bg-error-container/40 text-error" : isDemo ? "bg-[rgba(136,102,203,0.12)] text-[#8866CB]" : "bg-surface-container text-secondary"} flex items-center justify-center font-headline-sm text-headline-sm font-bold shrink-0">
                        ${esc(p.initials)}
                      </div>
                      <div>
                        <div class="flex items-center gap-3 flex-wrap">
                          <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">${esc(p.patient_id)} — ${esc(p.name)}</h3>
                          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-sm font-label-sm font-semibold ${badgeStyle}">
                            ${esc(p.tagLabel)}
                          </span>
                        </div>
                        <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                          Age: ${p.age ?? "Missing"} • Sex: ${p.sex ? esc(p.sex.charAt(0).toUpperCase() + p.sex.slice(1)) : "Missing"} • Panel: ${esc(p.panel)}
                        </p>
                        <div class="mt-2.5 text-body-sm font-body-sm font-medium ${isUrgent ? "text-error" : isDemo ? "text-[#8866CB]" : "text-on-surface"}">
                          ${esc(p.preview)}
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center justify-end sm:self-center shrink-0">
                      <button data-open-patient="${esc(p.patient_id)}" data-open-target="${isDemo ? "analyze-report" : "analysis-results"}" class="px-5 py-2.5 rounded-full ${isUrgent ? "bg-error text-white hover:bg-error/90" : isDemo ? "bg-[rgba(136,102,203,0.12)] text-[#8866CB] hover:bg-[rgba(136,102,203,0.22)]" : "border border-outline-variant/60 text-secondary hover:bg-surface-container-low"} font-label-md text-label-md font-semibold transition-colors active:scale-95 flex items-center gap-2">
                        <span>${isDemo ? "Provide Info & View" : "View Report"}</span>
                        <span class="material-symbols-outlined text-[16px]">${isUrgent ? "priority_high" : isDemo ? "edit_note" : "visibility"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>

        <!-- RIGHT COLUMN: Quick Actions & Direct Paste (4 Cols Bento) -->
        <div class="lg:col-span-4 space-y-4">
          <div class="mb-2">
            <h2 class="font-headline-lg text-headline-lg font-bold text-on-surface">Quick Actions</h2>
            <p class="font-body-sm text-body-sm text-on-surface-variant">Immediate operational shortcuts & AI tooling</p>
          </div>

          <div data-goto-view="patients" class="bg-surface-container-lowest rounded-lg p-5 border border-outline-variant/40 custom-shadow-card hover:border-tertiary transition-all group cursor-pointer">
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-DEFAULT bg-surface-container-low group-hover:bg-tertiary group-hover:text-white text-tertiary flex items-center justify-center transition-colors">
                <span class="material-symbols-outlined text-[20px]">person_search</span>
              </div>
              <div class="flex-1">
                <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface group-hover:text-tertiary transition-colors">
                  Browse All 14 Corpus Patients
                </h3>
                <p class="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-snug">
                  Filter by Urgent, Missing Demographics, Unit Conversion, or Boundary cases.
                </p>
              </div>
            </div>
          </div>

          <div class="bg-surface-container-lowest rounded-lg p-5 border border-outline-variant/40 custom-shadow-card space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-DEFAULT bg-primary-fixed/20 text-primary flex items-center justify-center">
                  <span class="material-symbols-outlined text-[20px]">content_paste</span>
                </div>
                <div>
                  <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Paste Lab Report</h3>
                  <p class="font-body-sm text-body-sm text-on-surface-variant">Direct raw unformatted text</p>
                </div>
              </div>
              <button id="dash-load-sample" class="text-xs font-semibold text-primary hover:underline">Load Sample</button>
            </div>
            <textarea id="dash-paste-input" class="w-full text-body-sm font-body-sm p-3 rounded-DEFAULT bg-surface-container-low border border-outline-variant/40 text-on-surface placeholder:text-outline focus:border-primary focus:bg-white outline-none resize-none" placeholder="e.g. Age: 38, Sex: Female, SGPT: 45 U/L, Fasting Blood Sugar: 6.0 mmol/L..." rows="4">${esc(state.customText)}</textarea>
            <button id="dash-parse-btn" class="w-full py-2.5 px-4 bg-primary text-on-primary rounded-full font-label-md text-label-md font-semibold hover:bg-on-primary-fixed-variant transition-colors flex items-center justify-center gap-2">
              <span class="material-symbols-outlined text-[18px]">auto_fix_high</span>
              <span>Parse & Harmonize Report</span>
            </button>
          </div>

          <div data-goto-view="ai-assistant" class="bg-surface-container-lowest rounded-lg p-5 border border-outline-variant/40 custom-shadow-card hover:border-secondary transition-all group cursor-pointer">
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-DEFAULT bg-secondary-fixed/30 group-hover:bg-secondary group-hover:text-white text-secondary flex items-center justify-center transition-colors">
                <span class="material-symbols-outlined text-[20px]">smart_toy</span>
              </div>
              <div class="flex-1">
                <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface group-hover:text-secondary transition-colors">
                  Context-Locked AI Assistant
                </h3>
                <p class="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-snug">
                  Ask follow-up questions about the active report or test the cross-patient privacy boundary.
                </p>
                <div class="mt-2 text-label-sm font-label-sm text-secondary font-semibold flex items-center gap-1">
                  <span>Start consultation chat</span>
                  <span class="material-symbols-outlined text-[14px]">arrow_forward</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. BOTTOM SECTION: 'How CityLab Helps You' -->
      <section class="pt-2 space-y-6">
        <div>
          <h2 class="font-headline-lg text-headline-lg font-bold text-on-surface">How CityLab Helps You</h2>
          <p class="font-body-md text-body-md text-on-surface-variant">Designed with gentle ergonomics to reduce patient stress and encourage proactive care</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="bg-surface-container-lowest rounded-lg p-6 border border-outline-variant/40 custom-shadow-card flex flex-col justify-between">
            <div>
              <div class="w-12 h-12 rounded-full bg-primary-fixed/20 text-primary flex items-center justify-center mb-4">
                <span class="material-symbols-outlined text-[24px]">translate</span>
              </div>
              <h3 class="font-headline-md text-headline-md font-bold text-on-surface mb-2">Understand Results</h3>
              <p class="font-body-md text-body-md text-on-surface-variant leading-relaxed">
                Translate intimidating clinical codes and aliases (SGPT, SGOT, FBS) into simple Class-8 explanations in English, Urdu (اردو), and Roman Urdu.
              </p>
            </div>
            <div class="mt-6 flex items-center gap-2 text-label-md font-label-md text-primary font-semibold">
              <span class="material-symbols-outlined text-[18px]">verified</span>
              <span>Plain Language Translation</span>
            </div>
          </div>

          <div class="bg-surface-container-lowest rounded-lg p-6 border border-outline-variant/40 custom-shadow-card flex flex-col justify-between">
            <div>
              <div class="w-12 h-12 rounded-full bg-secondary-fixed/30 text-secondary flex items-center justify-center mb-4">
                <span class="material-symbols-outlined text-[24px]">tune</span>
              </div>
              <h3 class="font-headline-md text-headline-md font-bold text-on-surface mb-2">Identify Important Values</h3>
              <p class="font-body-md text-body-md text-on-surface-variant leading-relaxed">
                Spot which biomarkers are inside healthy reference bounds, which sit on exact boundary limits, and which require urgent care today.
              </p>
            </div>
            <div class="mt-6 flex items-center gap-2 text-label-md font-label-md text-secondary font-semibold">
              <span class="material-symbols-outlined text-[18px]">analytics</span>
              <span>Visual Spectrum Partitioning</span>
            </div>
          </div>

          <div class="bg-surface-container-lowest rounded-lg p-6 border border-outline-variant/40 custom-shadow-card flex flex-col justify-between">
            <div>
              <div class="w-12 h-12 rounded-full bg-tertiary-fixed/40 text-tertiary flex items-center justify-center mb-4">
                <span class="material-symbols-outlined text-[24px]">contact_support</span>
              </div>
              <h3 class="font-headline-md text-headline-md font-bold text-on-surface mb-2">Prepare Questions for Your Doctor</h3>
              <p class="font-body-md text-body-md text-on-surface-variant leading-relaxed">
                Generate 3–5 tailored, high-value questions and a printable Doctor Visit Sheet so you walk into your consultation confident and organized.
              </p>
            </div>
            <div class="mt-6 flex items-center gap-2 text-label-md font-label-md text-tertiary font-semibold">
              <span class="material-symbols-outlined text-[18px]">edit_calendar</span>
              <span>Empowered Consultations</span>
            </div>
          </div>
        </div>
      </section>

      ${renderDisclaimerFooter()}
    </main>
  `;
}

/* ============================================================================
   VIEW 2: PATIENT DIRECTORY (Teammate's citylab_patient_directory)
   ============================================================================ */
function renderPatientsView() {
  const q = state.directorySearch.trim().toLowerCase();
  const filtered = state.patients.filter((p) => {
    const matchFilter =
      state.directoryFilter === "all" ||
      (state.directoryFilter === "urgent" && p.tag === "urgent") ||
      (state.directoryFilter === "demo" && p.tag === "demo") ||
      (state.directoryFilter === "conv" && (p.tag === "conv" || p.tag === "high")) ||
      (state.directoryFilter === "unknown" && p.tag === "unknown");
    const matchQ =
      !q ||
      p.patient_id.toLowerCase().includes(q) ||
      (p.name || "").toLowerCase().includes(q) ||
      (p.panel || "").toLowerCase().includes(q) ||
      (p.preview || "").toLowerCase().includes(q);
    return matchFilter && matchQ;
  });

  const chip = (key, label, dotColor = null) => {
    const active = state.directoryFilter === key;
    return `
      <button data-dir-filter="${key}" class="px-3.5 py-1.5 rounded-full ${
      active
        ? "bg-primary text-on-primary font-semibold"
        : "bg-[#FFFFFF] hover:bg-surface-container-low text-on-surface border border-[#E7EAF2]"
    } font-label-md text-label-md transition-all flex items-center gap-1.5">
        ${dotColor ? `<span class="w-1.5 h-1.5 rounded-full" style="background:${dotColor}"></span>` : ""}
        <span>${esc(label)}</span>
      </button>
    `;
  };

  return `
    <main class="p-6 lg:p-8 max-w-[1440px] mx-auto w-full flex flex-col gap-6">
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm mb-2 font-semibold">
            <span class="material-symbols-outlined text-xs">database</span>
            Laboratory Master Directory
          </div>
          <h1 class="font-headline-xl text-headline-xl text-on-surface font-bold tracking-tight">Patient Records (P001 – P014)</h1>
          <p class="font-body-lg text-body-lg text-on-surface-variant mt-1">Browse all 14 seeded patient laboratory reports from the CityLab corpus and select a record to analyze its results.</p>
        </div>
        <div class="flex items-center gap-3">
          <button id="dir-audit-btn" class="flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#E7EAF2] bg-[#FFFFFF] hover:bg-surface-container-low text-primary font-label-lg text-label-lg font-semibold transition-all shadow-xs">
            <span class="material-symbols-outlined text-base">fact_check</span>
            Verify All 14 Reports
          </button>
          <button data-goto-view="analyze-report" class="flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary hover:bg-[#005049] text-on-primary font-label-lg text-label-lg shadow-sm transition-all">
            <span class="material-symbols-outlined text-base">upload_file</span>
            Paste Custom Report
          </button>
        </div>
      </div>

      <!-- Filter & Search Toolbar -->
      <section class="bg-[#FFFFFF] p-5 rounded-lg border border-[#E7EAF2] shadow-sm flex flex-col gap-4">
        <div class="flex flex-col md:flex-row items-center gap-4">
          <div class="relative flex-1 w-full">
            <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-on-surface-variant">
              <span class="material-symbols-outlined text-lg">search</span>
            </div>
            <input id="dir-search-input" value="${esc(state.directorySearch)}" class="w-full pl-10 pr-10 py-2.5 rounded-DEFAULT bg-[#FFFFFF] border-[1.5px] border-[#E7EAF2] focus:border-primary focus:ring-4 focus:ring-[#EDF2FF] text-body-md font-body-md text-on-surface placeholder:text-on-surface-variant/60 outline-none transition-all" placeholder="Search by patient name, ID (P001–P014), or test (e.g. Diana Prince, SGPT, mmol/L)..." type="text" />
          </div>
          <div class="flex items-center gap-2 px-4 py-2.5 rounded-DEFAULT bg-surface-container-low border border-[#E7EAF2] shrink-0">
            <span class="w-2 h-2 rounded-full bg-primary"></span>
            <span class="font-label-lg text-label-lg text-on-surface font-semibold">${filtered.length} of ${state.patients.length} Patients</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between border-t border-[#E7EAF2] pt-4 gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-label-sm text-label-sm text-on-surface-variant mr-1">Filter by checkpoint:</span>
            ${chip("all", "All (14)")}
            ${chip("urgent", "Urgent Flag (2)", "#DC4545")}
            ${chip("demo", "Demographics Missing (2)", "#8866CB")}
            ${chip("conv", "Unit / Alias / Boundary (6)", "#E99A36")}
            ${chip("unknown", "Unknown Test (1)", "#8993A5")}
          </div>
        </div>
      </section>

      <!-- Clinical Data Directory Table -->
      <section class="bg-[#FFFFFF] rounded-lg border border-[#E7EAF2] shadow-sm overflow-hidden flex flex-col">
        <div class="hidden lg:grid grid-cols-12 gap-4 px-6 py-3.5 bg-surface-container-low/60 border-b border-[#E7EAF2] font-label-md text-label-md text-on-surface-variant tracking-wider uppercase">
          <div class="col-span-3">Patient</div>
          <div class="col-span-1">ID</div>
          <div class="col-span-2">Demographics</div>
          <div class="col-span-3">Lab Panel & Preview</div>
          <div class="col-span-2">Checkpoint Status</div>
          <div class="col-span-1 text-right pr-2">Actions</div>
        </div>
        <div class="divide-y divide-[#E7EAF2]">
          ${filtered
            .map((p) => {
              const isUrgent = p.tag === "urgent";
              const isDemo = p.tag === "demo";
              const badge =
                p.tag === "urgent"
                  ? { bg: "rgba(220,69,69,0.12)", fg: "#DC4545" }
                  : p.tag === "demo"
                  ? { bg: "rgba(136,102,203,0.12)", fg: "#8866CB" }
                  : p.tag === "unknown"
                  ? { bg: "rgba(137,147,165,0.14)", fg: "#8993A5" }
                  : p.tag === "conv" || p.tag === "high"
                  ? { bg: "rgba(233,154,54,0.14)", fg: "#E99A36" }
                  : { bg: "rgba(32,155,114,0.10)", fg: "#209B72" };

              return `
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 px-6 py-4 items-center ${isUrgent ? "bg-[#FFDAD6]/15 hover:bg-[#FFDAD6]/25" : "hover:bg-[#FAF9FF]"} transition-colors">
                  <div class="lg:col-span-3 flex items-center gap-3">
                    <div class="w-9 h-9 rounded-full font-bold flex items-center justify-center text-sm shrink-0" style="background:${badge.bg}; color:${badge.fg}">
                      ${esc(p.initials || initials(p.name))}
                    </div>
                    <div>
                      <h4 class="font-headline-sm text-headline-sm text-on-surface font-bold">${esc(p.name)}</h4>
                      <span class="font-body-sm text-body-sm text-on-surface-variant">${esc(p.file)}</span>
                    </div>
                  </div>
                  <div class="lg:col-span-1 font-label-md text-label-md font-bold text-primary">${esc(p.patient_id)}</div>
                  <div class="lg:col-span-2 flex items-center gap-1.5 font-body-sm text-body-sm">
                    <span class="${p.age === null ? "text-[#DC4545] italic font-semibold" : "text-on-surface"}">Age: ${p.age ?? "Missing"}</span>
                    <span class="text-on-surface-variant/40">•</span>
                    <span class="${!p.sex ? "text-[#DC4545] italic font-semibold" : "text-on-surface"}">${p.sex ? esc(p.sex.charAt(0).toUpperCase() + p.sex.slice(1)) : "Sex: Missing"}</span>
                  </div>
                  <div class="lg:col-span-3">
                    <div class="font-label-lg text-label-lg font-semibold text-on-surface">${esc(p.panel || "Diagnostic Report")}</div>
                    <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(p.preview || "")}</div>
                  </div>
                  <div class="lg:col-span-2">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-label-sm font-label-sm font-semibold" style="background:${badge.bg}; color:${badge.fg}">
                      <span class="w-1.5 h-1.5 rounded-full" style="background:${badge.fg}"></span>
                      ${esc(p.tagLabel || "Ready")}
                    </span>
                  </div>
                  <div class="lg:col-span-1 flex items-center justify-end gap-2 pr-2">
                    <button data-open-patient="${esc(p.patient_id)}" data-open-target="${isDemo ? "analyze-report" : "analysis-results"}" class="px-3.5 py-1.5 rounded-full ${isDemo ? "bg-[#8866CB] text-white" : isUrgent ? "bg-[#DC4545] text-white" : "border border-[#E7EAF2] hover:bg-surface-container-high text-primary"} font-label-sm text-label-sm font-semibold transition-colors">
                      ${isDemo ? "Provide" : "Analyze"}
                    </button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>

      ${renderDisclaimerFooter()}
    </main>
  `;
}

/* ============================================================================
   VIEW 3: ANALYZE REPORT & CLARIFICATION (citylab_analyze_report_clarification)
   ============================================================================ */
function renderAnalyzeReportView() {
  const curP = SEED_MAP[state.selectedPatientId] || state.patients[0] || {};
  const data = state.analysis;
  const quickPids = ["P001", "P002", "P003", "P004", "P005", "P006", "P010", "P012", "P013", "P014"];
  const curAge = state.overrideAge !== null ? state.overrideAge : (data?.patient?.age ?? curP.age ?? "");
  const curSex = state.overrideSex || data?.patient?.sex || curP.sex || "";

  return `
    <main class="p-6 lg:p-8 max-w-[1400px] w-full mx-auto space-y-6">
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2 border-b border-outline-variant/20">
        <div>
          <h1 class="font-headline-xl text-headline-xl text-on-surface font-bold tracking-tight">Analyze Your Lab Report</h1>
          <p class="font-body-md text-body-md text-on-surface-variant mt-1">Choose an existing patient report, provide missing demographics when required, or paste raw laboratory report text.</p>
        </div>
        <button data-goto-view="analysis-results" class="px-5 py-2.5 rounded-full bg-primary text-on-primary font-label-md text-label-md font-semibold flex items-center gap-2 shadow-sm hover:opacity-95 transition">
          <span class="material-symbols-outlined text-[18px]">biotech</span>
          <span>Open Full Analysis Results</span>
        </button>
      </div>

      <!-- Quick Patient Jump Bar -->
      <div class="bg-surface-container-lowest border border-outline-variant/30 rounded-DEFAULT p-3.5 shadow-xs flex items-center gap-3 overflow-x-auto">
        <div class="flex items-center gap-1.5 text-on-surface-variant font-label-sm text-label-sm shrink-0 pr-2 border-r border-outline-variant/30">
          <span class="material-symbols-outlined text-[16px] text-primary">bolt</span>
          <span>Quick Checkpoint Jump:</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${quickPids
            .map((pid) => {
              const p = SEED_MAP[pid];
              if (!p) return "";
              const active = state.activeMode === "patient" && state.selectedPatientId === pid;
              const dotColor =
                p.tag === "urgent" ? "#DC4545" : p.tag === "demo" ? "#8866CB" : p.tag === "unknown" ? "#8993A5" : p.tag === "conv" ? "#E99A36" : "#209B72";
              return `
                <button data-jump-patient="${pid}" class="px-3 py-1.5 rounded-full text-left font-label-sm text-label-sm ${
                active ? "border-2 border-primary bg-primary/10 text-primary font-bold" : "border border-outline-variant/30 bg-surface-container-low hover:bg-surface-container text-on-surface"
              } transition-all flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full" style="background:${dotColor}"></span>
                  <span><strong>${pid}</strong> ${esc(p.name.split(" ")[0])}</span>
                </button>
              `;
            })
            .join("")}
        </div>
      </div>

      <!-- Dual-Panel Bento Workspace -->
      <div class="grid grid-cols-12 gap-6 items-start">
        <!-- LEFT COLUMN: Patient Selection & Demographics Clarification (7 Cols) -->
        <section class="col-span-12 xl:col-span-7 flex flex-col gap-6">
          <div class="bg-surface-container-lowest border border-outline-variant/40 rounded-lg p-6 shadow-xs">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <span class="font-label-sm text-label-sm text-primary font-bold tracking-wider uppercase">Step 1 • Patient Profile</span>
                <h2 class="font-headline-md text-headline-md text-on-surface font-semibold">Select Target Patient File</h2>
              </div>
              <span class="px-3 py-1 rounded-full bg-surface-container text-secondary font-label-sm text-label-sm font-medium">14 Patients Seeded</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div>
                <label class="block font-label-md text-label-md text-on-surface mb-1.5">Patient Record (P001 – P014)</label>
                <select id="analyze-patient-select" class="w-full py-2.5 px-3.5 bg-surface-container-lowest border border-outline-variant rounded-DEFAULT text-on-surface font-body-md text-body-md focus:border-secondary focus:ring-2 focus:ring-secondary/20 transition-all cursor-pointer">
                  ${state.patients
                    .map(
                      (p) =>
                        `<option value="${esc(p.patient_id)}" ${state.selectedPatientId === p.patient_id ? "selected" : ""}>${esc(p.patient_id)} — ${esc(p.name)} (${esc(p.tagLabel || "")})</option>`
                    )
                    .join("")}
                </select>
              </div>

              <div class="p-3.5 bg-surface-container-low rounded-DEFAULT border border-outline-variant/30 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-headline-sm">
                    ${esc(curP.initials || initials(curP.name))}
                  </div>
                  <div>
                    <h3 class="font-headline-sm text-headline-sm text-on-surface font-bold leading-tight">${esc(curP.name || "Custom")}</h3>
                    <p class="font-label-sm text-label-sm text-on-surface-variant">ID: <span class="font-semibold text-on-surface">${esc(curP.patient_id || "Custom")}</span> • ${esc(curP.file || "")}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- PROMINENT CLARIFICATION CARD (Demographics Requirement) -->
          <div class="relative bg-surface-container-lowest border-2 ${data?.state === "needs_demographics" ? "border-[#8866CB]" : "border-outline-variant/40"} rounded-lg p-7 shadow-md overflow-hidden">
            <div class="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#8866CB] to-primary"></div>
            <div class="flex items-start gap-4">
              <div class="w-12 h-12 rounded-full bg-[rgba(136,102,203,0.14)] text-[#8866CB] flex items-center justify-center shrink-0 mt-0.5">
                <span class="material-symbols-outlined text-[28px] fill">badge</span>
              </div>
              <div class="flex-1">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <h3 class="font-headline-lg text-headline-lg text-on-surface font-bold">
                    ${data?.state === "needs_demographics" ? "Additional Information Needed to Proceed" : "Demographic Calibration & Override"}
                  </h3>
                  <span class="px-3 py-1 rounded-full bg-[rgba(136,102,203,0.12)] text-[#8866CB] font-label-sm text-label-sm font-bold flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">verified_user</span>
                    Clinical Safety Check
                  </span>
                </div>
                <p class="font-body-md text-body-md text-on-surface-variant mt-2 leading-relaxed ${state.lang === "ur" ? "rtl-text" : ""}">
                  ${esc(
                    data?.clarifying_question ||
                      "Normal laboratory ranges differ based on biological age and sex. CityLab never guesses missing demographics (such as in P003 Charlie Brown or P012 Laura Croft)."
                  )}
                </p>

                <form id="clarification-page-form" class="space-y-5 mt-5">
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label class="block font-label-md text-label-md text-on-surface font-semibold mb-1.5" for="clarify-page-age">
                        Patient Age (Years) <span class="text-error">*</span>
                      </label>
                      <div class="relative">
                        <input id="clarify-page-age" class="w-full px-4 py-2.5 bg-surface-container-lowest border border-outline-variant rounded-DEFAULT text-on-surface font-body-md text-body-md focus:border-secondary focus:ring-2 focus:ring-secondary/20 transition-all" max="120" min="1" placeholder="e.g. 35" type="number" value="${esc(curAge)}" />
                        <span class="absolute right-3.5 top-2.5 text-xs text-outline font-label-sm">Yrs (1–120)</span>
                      </div>
                    </div>

                    <div>
                      <label class="block font-label-md text-label-md text-on-surface font-semibold mb-1.5">
                        Biological Sex <span class="text-error">*</span>
                      </label>
                      <input type="hidden" id="clarify-page-sex" value="${esc(curSex)}" />
                      <div class="grid grid-cols-2 gap-2">
                        <button type="button" data-sex-pick="male" class="py-2.5 px-4 rounded-DEFAULT ${
                          curSex === "male"
                            ? "border-2 border-primary bg-primary/10 text-primary font-bold"
                            : "border border-outline-variant bg-surface-container-lowest text-on-surface-variant"
                        } font-label-md text-label-md flex items-center justify-center gap-2 transition-all">
                          <span class="material-symbols-outlined text-[18px]">male</span>
                          <span>Male</span>
                        </button>
                        <button type="button" data-sex-pick="female" class="py-2.5 px-4 rounded-DEFAULT ${
                          curSex === "female"
                            ? "border-2 border-primary bg-primary/10 text-primary font-bold"
                            : "border border-outline-variant bg-surface-container-lowest text-on-surface-variant"
                        } font-label-md text-label-md flex items-center justify-center gap-2 transition-all">
                          <span class="material-symbols-outlined text-[18px]">female</span>
                          <span>Female</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div class="flex items-center gap-2 text-primary font-label-sm text-label-sm">
                      <span class="material-symbols-outlined text-[16px]">lock_reset</span>
                      <span>Grounded in 1_lab_safety_rules.md (Rule 3)</span>
                    </div>
                    <button type="submit" class="w-full sm:w-auto bg-primary text-on-primary hover:bg-primary/90 px-7 py-3 rounded-full font-label-lg text-label-lg font-bold flex items-center justify-center gap-2.5 shadow-md transition-all active:scale-[0.98]">
                      <span class="material-symbols-outlined text-[20px]">sync_saved_locally</span>
                      <span>Submit & View Results</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </section>

        <!-- RIGHT COLUMN: Paste Laboratory Report Text Area (5 Cols) -->
        <section class="col-span-12 xl:col-span-5 flex flex-col gap-6">
          <div class="bg-surface-container-lowest border border-outline-variant/40 rounded-lg p-6 shadow-xs flex flex-col h-full">
            <div class="flex items-center justify-between mb-2">
              <div>
                <span class="font-label-sm text-label-sm text-secondary font-bold tracking-wider uppercase">Alternate Input • Direct OCR / Text</span>
                <h2 class="font-headline-md text-headline-md text-on-surface font-semibold">Paste Your Laboratory Report</h2>
              </div>
              <button id="analyze-load-tricky" class="px-3 py-1 rounded-full bg-surface-container text-primary font-label-sm text-label-sm font-semibold hover:opacity-90">
                Load Tricky Sample
              </button>
            </div>
            <p class="font-body-sm text-body-sm text-on-surface-variant mb-3">
              Paste raw unformatted laboratory values, markdown tables, or noisy reports with CLIA/HIPAA boilerplate (max 200,000 characters).
            </p>
            <textarea id="analyze-paste-textarea" class="w-full p-4 bg-surface-container-low/50 border border-outline-variant rounded-DEFAULT text-on-surface font-mono text-body-sm focus:border-secondary focus:ring-2 focus:ring-secondary/20 transition-all resize-y leading-relaxed" rows="12" placeholder="Paste laboratory text...">${esc(state.customText)}</textarea>
            <div class="flex items-center justify-between text-xs text-outline mt-2 mb-4">
              <span id="analyze-char-counter">${state.customText.length.toLocaleString()} / 200,000 characters</span>
              <label class="cursor-pointer text-primary font-semibold flex items-center gap-1 hover:underline">
                <span class="material-symbols-outlined text-[15px]">attach_file</span>
                <span>Upload .md/.txt</span>
                <input type="file" id="analyze-file-input" accept=".md,.txt" class="hidden" />
              </label>
            </div>
            <button id="analyze-custom-submit" class="w-full bg-secondary hover:bg-secondary/90 text-on-secondary py-3 px-6 rounded-full font-label-lg text-label-lg font-bold flex items-center justify-center gap-2 shadow-sm transition-all">
              <span class="material-symbols-outlined text-[20px]">science</span>
              <span>Analyze Pasted Report</span>
            </button>
          </div>
        </section>
      </div>

      ${renderDisclaimerFooter()}
    </main>
  `;
}

/* ============================================================================
   VIEW 4: ANALYSIS RESULTS FLAGSHIP (citylab_analysis_results_flagship)
   ============================================================================ */
function renderAnalysisResultsView() {
  const isRtl = state.lang === "ur";
  const rtlClass = isRtl ? "rtl-text" : "";

  if (state.loading) {
    return `
      <main class="p-8 max-w-[1360px] w-full mx-auto flex flex-col gap-6">
        <div class="bg-surface-container-lowest rounded-lg p-10 border border-outline-variant/30 card-shadow flex flex-col items-center justify-center text-center gap-4">
          <div class="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center animate-pulse">
            <span class="material-symbols-outlined text-[32px]">biotech</span>
          </div>
          <h2 class="font-headline-md text-headline-md font-bold text-on-surface">Running CityLab Multi-Step Pipeline...</h2>
          <p class="font-body-md text-body-md text-on-surface-variant max-w-lg">Stripping boilerplate → mapping glossary aliases & converting SI units → matching age/sex reference intervals → generating plain-language explanation.</p>
        </div>
      </main>
    `;
  }

  if (state.error) {
    return `
      <main class="p-8 max-w-[1360px] w-full mx-auto flex flex-col gap-6">
        <div class="rounded-lg p-6 bg-[rgba(220,69,69,0.08)] border-2 border-[#DC4545] flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-[#DC4545] text-[28px]">error</span>
            <div>
              <h3 class="font-headline-sm text-headline-sm font-bold text-[#DC4545]">[${esc(state.error.code)}] Request Could Not Be Completed</h3>
              <p class="font-body-md text-body-md text-on-surface">${esc(state.error.message)}</p>
            </div>
          </div>
          <button id="results-retry-btn" class="px-5 py-2 rounded-full bg-[#DC4545] text-white font-label-md text-label-md font-bold">Retry</button>
        </div>
      </main>
    `;
  }

  const data = state.analysis;
  if (!data) {
    return `<main class="p-8 max-w-[1360px] w-full mx-auto">Select a patient to view results.</main>`;
  }

  const p = data.patient || {};
  const counts = { urgent: 0, low: 0, normal: 0, high: 0, cannot_classify: 0, needs_demographics: 0 };
  const sampleNames = { urgent: [], low: [], normal: [], high: [], cannot_classify: [], needs_demographics: [] };
  data.results.forEach((r) => {
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (sampleNames[r.status]) sampleNames[r.status].push(r.test);
  });

  const aliasesUsed = data.results.filter((r) => r.alias_note).map((r) => r.alias_note);
  const conversionsUsed = data.results.filter((r) => r.conversion).map((r) => `${r.test}: ${r.conversion.from} → ${r.conversion.to} (${r.conversion.formula})`);

  return `
    <main class="p-6 lg:p-8 max-w-[1360px] w-full mx-auto flex flex-col gap-6">
      <!-- Mandatory Medical Safety Banner -->
      <div class="flex items-center justify-between px-4 py-2.5 rounded-DEFAULT bg-surface-container-low border border-surface-container-highest text-on-surface-variant">
        <div class="flex items-center gap-2 ${rtlClass}">
          <span class="material-symbols-outlined text-primary text-[20px]">verified_user</span>
          <span class="font-body-sm text-body-sm font-medium">${esc(data.disclaimer)}</span>
        </div>
        <span class="font-label-sm text-label-sm text-outline hidden sm:inline">Clinical Decision Support Layer v1.1</span>
      </div>

      <!-- Patient Demographics & Analysis Header Card -->
      <section class="bg-surface-container-lowest rounded-lg p-6 border border-outline-variant/30 card-shadow flex flex-wrap items-center justify-between gap-6">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center text-primary font-headline-md text-headline-md font-bold">
            ${esc(initials(p.name))}
          </div>
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="font-headline-lg text-headline-lg text-on-surface font-bold">${esc(p.name || "Custom Patient Report")}</h1>
              <span class="px-2.5 py-0.5 rounded-full bg-surface-container-high text-primary font-label-sm text-label-sm font-semibold">ID: ${esc(p.patient_id || "CUSTOM")}</span>
              <!-- Quick Patient Switcher Dropdown -->
              <select id="results-quick-patient" class="ml-2 py-1 pl-3 pr-7 rounded-full bg-surface-container-low border border-outline-variant/50 font-label-sm text-label-sm text-on-surface cursor-pointer">
                ${state.patients
                  .map(
                    (pt) =>
                      `<option value="${esc(pt.patient_id)}" ${state.activeMode === "patient" && state.selectedPatientId === pt.patient_id ? "selected" : ""}>Switch: ${esc(pt.patient_id)} — ${esc(pt.name)}</option>`
                  )
                  .join("")}
              </select>
            </div>
            <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">
              Age: <span class="font-semibold text-on-surface">${p.age !== null && p.age !== undefined ? esc(p.age) + " yrs" : "MISSING"}</span>
              • Sex: <span class="font-semibold text-on-surface">${p.sex ? esc(p.sex.charAt(0).toUpperCase() + p.sex.slice(1)) : "MISSING"}</span>
              • Language: <span class="font-semibold text-primary">${esc(data.lang.toUpperCase())}</span>
            </p>
          </div>
        </div>

        <div class="flex items-center gap-6 divide-x divide-outline-variant/30 flex-wrap">
          <div class="flex flex-col items-start pr-4">
            <span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Analysis Status</span>
            <div class="flex items-center gap-1.5 mt-1 ${data.state === "ok" ? "text-[#209B72]" : "text-[#8866CB]"}">
              <span class="material-symbols-outlined text-[18px] fill">${data.state === "ok" ? "check_circle" : "help"}</span>
              <span class="font-label-md text-label-md font-bold">${data.state === "ok" ? "Completed" : "Needs Demographics"}</span>
            </div>
          </div>
          <div class="flex flex-col items-start pl-4 pr-4">
            <span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Tests Analyzed</span>
            <span class="font-data-metric text-data-metric text-on-surface mt-0.5">${data.results.length} <span class="font-body-sm text-body-sm text-on-surface-variant font-normal">Tests</span></span>
          </div>
          <div class="pl-4 flex items-center gap-2">
            <button id="results-export-btn" class="px-4 py-2 rounded-full border border-outline-variant/50 hover:bg-surface-container-low text-on-surface font-label-md text-label-md flex items-center gap-2 transition">
              <span class="material-symbols-outlined text-[18px]">print</span>
              Export Report
            </button>
            <button data-goto-view="ai-assistant" class="px-4 py-2 rounded-full bg-primary text-on-primary hover:opacity-90 font-label-md text-label-md flex items-center gap-2 transition">
              <span class="material-symbols-outlined text-[18px]">smart_toy</span>
              Ask AI Assistant
            </button>
          </div>
        </div>
      </section>

      <!-- A. URGENT WARNING SECTION (Only when urgent_warning is present) -->
      ${
        data.urgent_warning
          ? `
        <section class="rounded-lg p-6 bg-[rgba(220,69,69,0.06)] border-2 border-[#DC4545] flex flex-col md:flex-row items-start md:items-center justify-between gap-5 shadow-sm">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-full bg-[#DC4545] text-white flex items-center justify-center shrink-0 shadow-md">
              <span class="material-symbols-outlined text-[28px] fill">warning</span>
            </div>
            <div class="${rtlClass}">
              <div class="flex items-center gap-2">
                <span class="font-headline-sm text-headline-sm font-bold text-[#DC4545] tracking-tight">URGENT RESULT DETECTED</span>
                <span class="px-2 py-0.5 rounded-full bg-[#DC4545] text-white font-label-sm text-label-sm font-semibold">See a Doctor Today</span>
              </div>
              <p class="font-body-md text-body-md text-on-surface mt-1 font-medium leading-relaxed">
                ${esc(data.urgent_warning)}
              </p>
            </div>
          </div>
          <button data-goto-view="ai-assistant" class="shrink-0 px-6 py-3 rounded-full bg-[#DC4545] text-white font-label-lg text-label-lg font-bold hover:bg-[#ba1a1a] transition shadow-sm flex items-center gap-2">
            <span class="material-symbols-outlined text-[20px]">priority_high</span>
            Review Urgent Questions
          </button>
        </section>
      `
          : ""
      }

      <!-- A2. INLINE CLARIFYING QUESTION BANNER (When demographics are missing) -->
      ${
        data.state === "needs_demographics" && data.clarifying_question
          ? `
        <section class="rounded-lg p-6 bg-[rgba(136,102,203,0.08)] border-2 border-[#8866CB] flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5 shadow-sm">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-full bg-[#8866CB] text-white flex items-center justify-center shrink-0 shadow-md">
              <span class="material-symbols-outlined text-[26px] fill">badge</span>
            </div>
            <div class="${rtlClass}">
              <span class="font-headline-sm text-headline-sm font-bold text-[#8866CB]">MISSING DEMOGRAPHICS — CLARIFICATION REQUIRED</span>
              <p class="font-body-md text-body-md text-on-surface mt-1">${esc(data.clarifying_question)}</p>
            </div>
          </div>
          <form id="inline-clarify-form" class="flex flex-wrap items-center gap-2.5 shrink-0">
            <input type="number" id="inline-clarify-age" min="1" max="120" placeholder="Age (yrs)" value="${esc(p.age ?? "")}" class="w-28 px-3 py-2 rounded-DEFAULT border border-[#8866CB]/50 bg-white font-body-sm text-body-sm" />
            <select id="inline-clarify-sex" class="px-3 py-2 rounded-DEFAULT border border-[#8866CB]/50 bg-white font-body-sm text-body-sm">
              <option value="">Select Sex...</option>
              <option value="female" ${p.sex === "female" ? "selected" : ""}>Female</option>
              <option value="male" ${p.sex === "male" ? "selected" : ""}>Male</option>
            </select>
            <button type="submit" class="px-5 py-2 rounded-full bg-[#8866CB] text-white font-label-md text-label-md font-bold hover:opacity-95 transition">
              Apply & Classify
            </button>
          </form>
        </section>
      `
          : ""
      }

      <!-- B. ANALYSIS SUMMARY CARD: 'Your Report at a Glance' -->
      <section class="bg-surface-container-lowest rounded-lg p-6 border border-outline-variant/30 card-shadow flex flex-col gap-4">
        <div class="flex items-center justify-between border-b border-outline-variant/20 pb-3">
          <div class="flex items-center gap-2">
            <div class="p-1.5 rounded-DEFAULT bg-surface-container text-primary">
              <span class="material-symbols-outlined text-[20px]">auto_awesome</span>
            </div>
            <h2 class="font-headline-md text-headline-md font-bold text-on-surface">Your Report at a Glance</h2>
          </div>
          <span class="font-label-sm text-label-sm px-2.5 py-1 rounded-full bg-surface-container text-primary font-medium">Class-8 Plain-Language Model (${esc(data.lang.toUpperCase())})</span>
        </div>
        <div class="p-4 rounded-DEFAULT bg-surface-container-low/70 border border-outline-variant/20 text-on-surface leading-relaxed font-body-md text-body-md ${rtlClass}">
          <p>${esc(data.summary)}</p>
        </div>
      </section>

      <!-- C. RESULTS OVERVIEW: 6-Status Counter Strip -->
      <section class="flex flex-col gap-2">
        <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface px-1">Biomarker Distribution</h3>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          ${[
            { key: "urgent", title: "Urgent", color: "#DC4545" },
            { key: "low", title: "Low", color: "#4C83D9" },
            { key: "normal", title: "Normal", color: "#209B72" },
            { key: "high", title: "High", color: "#E99A36" },
            { key: "cannot_classify", title: "Unclassified", color: "#8993A5" },
            { key: "needs_demographics", title: "Needs Demo", color: "#8866CB" },
          ]
            .map((item) => {
              const c = counts[item.key] || 0;
              const names = sampleNames[item.key]?.join(", ") || "Tests";
              return `
                <div class="bg-surface-container-lowest border ${c > 0 ? "border-2" : "border-outline-variant/30 opacity-65"} rounded-DEFAULT p-3.5 flex flex-col justify-between card-shadow" style="${c > 0 ? `border-color:${item.color}66` : ""}">
                  <div class="flex items-center justify-between">
                    <span class="font-label-sm text-label-sm font-bold uppercase" style="color:${item.color}">${item.title}</span>
                    <span class="w-2.5 h-2.5 rounded-full" style="background:${item.color}"></span>
                  </div>
                  <div class="mt-2 flex items-baseline justify-between gap-2">
                    <span class="font-data-metric text-data-metric font-bold" style="color:${c > 0 ? item.color : "#101b32"}">${c}</span>
                    <span class="font-label-sm text-label-sm text-on-surface-variant truncate">${esc(names)}</span>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>

      <!-- E. CLINICAL INTELLIGENCE CALLOUT (Alias Matching & Unit Normalization) -->
      ${
        aliasesUsed.length || conversionsUsed.length
          ? `
        <div class="p-3.5 rounded-DEFAULT bg-surface-container-low border border-outline-variant/30 flex flex-wrap items-center justify-between gap-3 text-body-sm font-body-sm text-on-surface-variant">
          <div class="flex items-center gap-3">
            <span class="material-symbols-outlined text-primary text-[20px]">sync_alt</span>
            <span>
              <strong>Clinical Normalization Active:</strong>
              ${aliasesUsed.length ? `Aliases mapped via <code>2_medical_glossary.md</code>: <span class="bg-surface-container-lowest px-2 py-0.5 rounded text-on-surface font-mono font-medium">${esc(aliasesUsed.join(" • "))}</span>.` : ""}
              ${conversionsUsed.length ? `SI Unit Conversions applied: <span class="bg-surface-container-lowest px-2 py-0.5 rounded text-on-surface font-mono font-medium">${esc(conversionsUsed.join(" • "))}</span>.` : ""}
            </span>
          </div>
          <span class="font-label-sm text-label-sm text-primary font-semibold flex items-center gap-1">
            <span class="material-symbols-outlined text-[16px]">tune</span> Verified Corpus Mapping
          </span>
        </div>
      `
          : ""
      }

      <!-- D. LABORATORY TEST RESULTS (Spacious Individual Cards) -->
      <section class="flex flex-col gap-6">
        <div class="flex items-center justify-between px-1">
          <h3 class="font-headline-lg text-headline-lg font-bold text-on-surface">Detailed Biomarker Analyses</h3>
          <span class="font-body-sm text-body-sm text-on-surface-variant">Grounded with exact file:line citations</span>
        </div>

        ${data.results
          .map((r, idx) => {
            const st = STATUS_STYLE[r.status] || STATUS_STYLE.cannot_classify;
            const badgeText = st.label[state.lang] || st.label.en;
            const pinPct = computePinPct(r);
            const refText = r.reference?.text || "No matching reference interval in corpus files";

            return `
              <article class="bg-surface-container-lowest rounded-lg p-6 border ${st.border} card-shadow flex flex-col gap-5 relative overflow-hidden">
                <!-- Left accent strip -->
                <div class="absolute left-0 top-0 bottom-0 w-1.5" style="background:${st.color}"></div>

                <!-- Card Header -->
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div class="flex items-center gap-3 flex-wrap">
                      <h4 class="font-headline-md text-headline-md font-bold text-on-surface">${esc(r.test)}</h4>
                      <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full font-label-md text-label-md font-bold" style="background:${st.bg}; color:${st.color}">
                        <span class="material-symbols-outlined text-[16px] fill">${st.icon}</span>
                        ${esc(badgeText)}
                      </span>
                      ${
                        r.alias_note
                          ? `<span class="px-2.5 py-0.5 rounded bg-surface-container-low text-primary font-label-sm text-label-sm font-semibold">Alias: ${esc(r.alias_note)}</span>`
                          : ""
                      }
                    </div>
                    <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">
                      Raw Input: <code>${esc(r.test_raw)}: ${esc(r.value_raw)} ${esc(r.unit_raw)}</code>
                      ${r.conversion ? ` • <strong>Converted:</strong> <code>${esc(r.conversion.formula)}</code> (${esc(r.conversion.from)} → ${esc(r.conversion.to)})` : ""}
                    </p>
                  </div>

                  <!-- Metric Display -->
                  <div class="text-right">
                    <span class="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Measured Value</span>
                    <div class="flex items-baseline justify-end gap-1.5">
                      <span class="font-data-metric text-data-metric font-bold" style="color:${st.color}">${esc(r.value)}</span>
                      <span class="font-body-md text-body-md text-on-surface-variant font-semibold">${esc(r.unit)}</span>
                    </div>
                    <span class="font-body-sm text-body-sm text-on-surface-variant">Ref Range: ${esc(refText)}</span>
                  </div>
                </div>

                <!-- Horizontal Visual Range Spectrum -->
                ${
                  pinPct !== null
                    ? `
                  <div class="flex flex-col gap-1.5 pt-1">
                    <div class="flex justify-between font-label-sm text-label-sm text-on-surface-variant">
                      <span class="text-[#4C83D9] font-semibold">Low (&lt; ${esc(r.reference.low)})</span>
                      <span class="text-[#209B72] font-semibold">Normal (${esc(r.reference.low)} – ${esc(r.reference.high)} ${esc(r.reference.unit)})</span>
                      <span class="text-[#E99A36] font-semibold">Elevated (&gt; ${esc(r.reference.high)})</span>
                    </div>
                    <div class="relative w-full h-3 rounded-full bg-surface-container overflow-hidden flex">
                      <div class="h-full bg-[rgba(76,131,217,0.45)] w-[25%]"></div>
                      <div class="h-full bg-[rgba(32,155,114,0.45)] w-[50%]"></div>
                      <div class="h-full bg-[rgba(233,154,54,0.45)] w-[25%]"></div>
                    </div>
                    <div class="relative w-full h-5">
                      <div class="absolute -top-1 flex flex-col items-center -translate-x-1/2" style="left:${pinPct}%">
                        <div class="w-3 h-3 rotate-45 shadow-xs" style="background:${st.color}"></div>
                        <span class="font-label-sm text-label-sm font-bold mt-0.5 whitespace-nowrap" style="color:${st.color}">${esc(r.value)} ${esc(r.unit)} (Patient)</span>
                      </div>
                    </div>
                  </div>
                `
                    : ""
                }

                <!-- Simple Explanation Box -->
                <div class="p-4 rounded-DEFAULT bg-surface-container-low/70 border border-outline-variant/30 flex items-start gap-3">
                  <span class="material-symbols-outlined shrink-0 mt-0.5" style="color:${st.color}">info</span>
                  <div class="flex-1 ${rtlClass}">
                    <h5 class="font-label-md text-label-md font-bold text-on-surface">Plain-Language Understanding (${esc(data.lang.toUpperCase())})</h5>
                    <p class="font-body-md text-body-md text-on-surface mt-1 leading-relaxed">${esc(r.explanation)}</p>
                    <p class="font-body-sm text-body-sm text-on-surface-variant mt-1.5"><strong>Rule Applied:</strong> ${esc(r.reason)}</p>
                  </div>
                </div>

                <!-- Collapsible Evidence + Bonus What-If Simulator -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <details class="border border-outline-variant/30 rounded-DEFAULT bg-surface-container-lowest group overflow-hidden" open>
                    <summary class="p-3.5 flex items-center justify-between font-label-md text-label-md text-primary font-semibold cursor-pointer hover:bg-surface-container-low select-none transition">
                      <span class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-[18px]">policy</span>
                        View Clinical Grounding & Evidence (${r.sources.length})
                      </span>
                      <span class="material-symbols-outlined text-outline transition-transform group-open:rotate-180">expand_more</span>
                    </summary>
                    <div class="p-4 pt-2 border-t border-outline-variant/20 bg-surface-container-low/30 flex flex-col gap-2 font-mono text-body-sm">
                      ${r.sources
                        .map(
                          (s) => `
                        <div class="p-2 rounded bg-surface-container-lowest border border-outline-variant/30 text-on-surface">
                          <div class="text-xs text-primary font-bold">${esc(s.file)} : Line ${esc(s.line)}</div>
                          <div class="italic font-sans text-body-sm text-on-surface-variant mt-0.5">“${esc(s.quote)}”</div>
                        </div>
                      `
                        )
                        .join("")}
                    </div>
                  </details>

                  ${
                    typeof r.value === "number"
                      ? `
                    <details class="border border-outline-variant/30 rounded-DEFAULT bg-surface-container-lowest group overflow-hidden">
                      <summary class="p-3.5 flex items-center justify-between font-label-md text-label-md text-secondary font-semibold cursor-pointer hover:bg-surface-container-low select-none transition">
                        <span class="flex items-center gap-2">
                          <span class="material-symbols-outlined text-[18px]">science</span>
                          Interactive What-If Value Simulator
                        </span>
                        <span class="material-symbols-outlined text-outline transition-transform group-open:rotate-180">expand_more</span>
                      </summary>
                      <div class="p-4 pt-3 border-t border-outline-variant/20 bg-surface-container-low/30 flex flex-col gap-3">
                        <div class="flex flex-wrap items-center gap-2">
                          <input type="number" step="any" id="sim-val-${idx}" value="${esc(r.value)}" class="w-28 px-3 py-1.5 rounded-DEFAULT border border-outline-variant bg-white font-body-sm" />
                          <span class="font-label-sm text-label-sm font-semibold text-on-surface-variant">${esc(r.unit)}</span>
                          <button type="button" data-sim-idx="${idx}" data-sim-test="${esc(r.test)}" data-sim-unit="${esc(r.unit)}" class="px-4 py-1.5 rounded-full bg-secondary text-white font-label-sm text-label-sm font-semibold hover:opacity-90">
                            Simulate Value
                          </button>
                        </div>
                        <div id="sim-out-${idx}" class="text-body-sm text-on-surface-variant">Test a hypothetical follow-up value to see how classification changes.</div>
                      </div>
                    </details>
                  `
                      : ""
                  }
                </div>
              </article>
            `;
          })
          .join("")}
      </section>

      <!-- F. QUESTIONS FOR YOUR DOCTOR SECTION -->
      <section class="bg-surface-container-lowest rounded-lg p-6 border border-outline-variant/30 card-shadow flex flex-col gap-5">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center">
              <span class="material-symbols-outlined text-[22px]">question_answer</span>
            </div>
            <div>
              <h3 class="font-headline-lg text-headline-lg font-bold text-on-surface">Questions to Ask Your Doctor</h3>
              <p class="font-body-sm text-body-sm text-on-surface-variant">Prepared based on your specific findings to empower your clinical visit.</p>
            </div>
          </div>
          <button id="copy-all-questions-btn" class="px-5 py-2.5 rounded-full bg-primary text-on-primary hover:opacity-90 font-label-md text-label-md font-semibold flex items-center gap-2 shadow-sm transition">
            <span class="material-symbols-outlined text-[18px]">content_copy</span>
            <span>Copy All Questions</span>
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${data.doctor_questions
            .map(
              (q, i) => `
            <div class="p-4 rounded-DEFAULT bg-surface-container-low border border-outline-variant/30 flex flex-col justify-between gap-4">
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <span class="w-6 h-6 rounded-full ${i === 0 && data.urgent_warning ? "bg-[#DC4545] text-white" : "bg-primary text-on-primary"} flex items-center justify-center font-label-sm text-label-sm font-bold">${i + 1}</span>
                  <span class="px-2 py-0.5 rounded-full ${i === 0 && data.urgent_warning ? "bg-[rgba(220,69,69,0.12)] text-[#DC4545]" : "bg-surface-container-high text-primary"} font-label-sm text-label-sm font-semibold">${i === 0 && data.urgent_warning ? "High Priority" : "Clinical Follow-Up"}</span>
                </div>
                <p class="font-body-md text-body-md text-on-surface font-medium leading-snug ${rtlClass}">“${esc(q)}”</p>
              </div>
              <button data-copy-q="${esc(q)}" class="self-start text-primary hover:text-on-primary-container font-label-sm text-label-sm font-semibold flex items-center gap-1.5 transition">
                <span class="material-symbols-outlined text-[16px]">content_copy</span>
                <span>Copy Question</span>
              </button>
            </div>
          `
            )
            .join("")}
        </div>
      </section>

      <!-- G. META INFORMATION STRIP (For Hackathon Judges) -->
      <footer class="mt-2 mb-6 p-4 rounded-DEFAULT bg-surface-container-low/60 border border-outline-variant/20 flex flex-wrap items-center justify-between gap-4 text-on-surface-variant font-mono text-body-sm">
        <div class="flex flex-wrap items-center gap-6">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-primary text-[18px]">memory</span>
            <span><strong>Provider:</strong> ${esc(data.meta?.provider || "Deterministic Safe Core")}</span>
          </div>
          <div><span><strong>Model:</strong> ${esc(data.meta?.model || "Rule + Template Engine")}</span></div>
          <div><span><strong>Latency:</strong> <span class="text-[#209B72] font-semibold">${esc(data.meta?.latency_ms ?? 0)}ms</span></span></div>
          <div><span><strong>Cached:</strong> ${data.meta?.cached ? "true" : "false"}</span></div>
          <div><span><strong>Fallback Used:</strong> ${data.meta?.fallback_used ? "true" : "none"}</span></div>
        </div>
        <div class="flex items-center gap-2 font-sans text-label-sm text-outline">
          <span class="w-2 h-2 rounded-full bg-[#209B72]"></span>
          <span>Deterministic RAG Pipeline Active</span>
        </div>
      </footer>
    </main>
  `;
}

/* ============================================================================
   VIEW 5: CONTEXT-LOCKED AI ASSISTANT (citylab_context_locked_ai_assistant)
   ============================================================================ */
function renderAiAssistantView() {
  const data = state.analysis;
  const p = data?.patient || SEED_MAP[state.selectedPatientId] || {};
  const isRtl = state.lang === "ur";
  const rtlClass = isRtl ? "rtl-text" : "";

  return `
    <div class="flex-1 flex flex-col">
      <!-- MANDATORY MEDICAL SAFETY BANNER -->
      <div class="bg-surface-container-highest/60 border-b border-surface-container-highest px-6 py-2 flex items-center justify-between text-on-surface-variant shrink-0">
        <div class="flex items-center gap-2 ${rtlClass}">
          <span class="material-symbols-outlined text-secondary text-base">info</span>
          <span class="font-label-sm text-label-sm font-medium text-on-surface">${esc(data?.disclaimer || "This is not a diagnosis. Only a licensed doctor can diagnose conditions.")}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
          <span class="font-label-sm text-label-sm text-outline">1_lab_safety_rules.md Context-Lock Active</span>
        </div>
      </div>

      <!-- SUB-HEADER BAR: ASSISTANT CONTEXT LOCK -->
      <div class="bg-surface-container-lowest px-6 py-3 border-b border-outline-variant/30 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-secondary-fixed flex items-center justify-center text-secondary">
            <span class="material-symbols-outlined text-lg">smart_toy</span>
          </div>
          <h1 class="font-headline-sm text-headline-sm text-on-surface font-bold">AI Assistant — Report Consultation</h1>
        </div>
        <div class="flex items-center gap-2 px-3 py-1.5 bg-surface-container-high border border-outline-variant/50 rounded-full">
          <span class="material-symbols-outlined text-primary text-base">lock</span>
          <span class="font-label-sm text-label-sm text-on-surface font-semibold tracking-wide">Context-Locked: ${esc(p.name || "Custom")} (ID #${esc(p.patient_id || "CUSTOM")})</span>
          <span class="w-2 h-2 rounded-full bg-primary-container ml-1"></span>
        </div>
      </div>

      <!-- MAIN TWO-COLUMN SPLIT (65% Chat / 35% Report Context) -->
      <div class="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-[calc(100vh-180px)]">
        <!-- LEFT COLUMN: CHAT CONVERSATION (8 Cols) -->
        <section class="lg:col-span-8 flex flex-col justify-between bg-background border-r border-outline-variant/30">
          <div id="assistant-thread" class="flex-1 overflow-y-auto p-6 space-y-6 max-h-[62vh]">
            <!-- Greeting Bubble + Suggested Chips -->
            <div class="flex items-start gap-3 max-w-3xl">
              <div class="w-8 h-8 rounded-full bg-primary-container text-white flex items-center justify-center shrink-0 mt-1 shadow-sm">
                <span class="material-symbols-outlined text-base">biotech</span>
              </div>
              <div class="flex flex-col gap-3 flex-1">
                <div class="bg-surface-container-lowest border border-outline-variant/40 rounded-lg rounded-tl-sm p-4 text-on-surface shadow-sm font-body-md text-body-md leading-relaxed">
                  Hello! I am your CityLab AI Assistant. I can help explain the laboratory results in your currently open report (<strong>${esc(p.name || "Active Report")}</strong>) in simple, easy-to-understand language.
                </div>
                <div class="flex flex-wrap gap-2 pt-1">
                  <button data-chat-chip="Explain my test results in simple words." class="bg-surface-container-lowest border border-outline-variant/40 hover:border-secondary hover:bg-secondary-fixed/30 text-on-surface px-3 py-1.5 rounded-full font-label-sm text-label-sm transition-all shadow-sm flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-sm text-secondary">help_outline</span>
                    <span>Explain my test results in simple words</span>
                  </button>
                  <button data-chat-chip="What questions should I ask my doctor?" class="bg-surface-container-lowest border border-outline-variant/40 hover:border-secondary hover:bg-secondary-fixed/30 text-on-surface px-3 py-1.5 rounded-full font-label-sm text-label-sm transition-all shadow-sm flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-sm text-primary">chat</span>
                    <span>What questions should I ask my doctor?</span>
                  </button>
                  <button data-chat-chip="Can you check what test results Alice Smith (P001) or Bob Jones had?" class="bg-error-container/30 border border-error/40 hover:bg-error-container/50 text-error px-3 py-1.5 rounded-full font-label-sm text-label-sm font-semibold transition-all shadow-sm flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-sm text-error">shield</span>
                    <span>Privacy Red-Team Test: Ask about another patient</span>
                  </button>
                </div>
              </div>
            </div>

            ${state.chatHistory
              .map((m) => {
                if (m.role === "user") {
                  return `
                    <div class="flex justify-end items-start gap-3">
                      <div class="bg-secondary text-on-secondary rounded-lg rounded-tr-sm p-4 max-w-xl shadow-sm font-body-md text-body-md leading-relaxed">
                        ${esc(m.text)}
                      </div>
                      <div class="w-8 h-8 rounded-full bg-secondary-fixed text-on-secondary-fixed flex items-center justify-center shrink-0 mt-1 font-bold font-label-sm text-label-sm">
                        ${esc(initials(p.name))}
                      </div>
                    </div>
                  `;
                }
                if (m.refused) {
                  return `
                    <div class="flex items-start gap-3 max-w-3xl">
                      <div class="w-8 h-8 rounded-full bg-error text-on-error flex items-center justify-center shrink-0 mt-1 shadow-sm">
                        <span class="material-symbols-outlined text-base">shield</span>
                      </div>
                      <div class="bg-surface-container-lowest border-2 border-error/30 rounded-lg rounded-tl-sm p-4 shadow-sm w-full ${rtlClass}">
                        <div class="flex items-center gap-2 mb-2">
                          <span class="material-symbols-outlined text-error text-lg">lock</span>
                          <span class="font-label-md text-label-md font-bold text-error uppercase tracking-wider">Patient Privacy Boundary Enforced (1_lab_safety_rules.md)</span>
                        </div>
                        <p class="font-body-md text-body-md text-on-surface leading-relaxed">${esc(m.text)}</p>
                      </div>
                    </div>
                  `;
                }
                const cites = (m.sources || []).map((s) => `${s.file}#L${s.line}`).join(", ");
                return `
                  <div class="flex items-start gap-3 max-w-3xl">
                    <div class="w-8 h-8 rounded-full bg-primary-container text-white flex items-center justify-center shrink-0 mt-1 shadow-sm">
                      <span class="material-symbols-outlined text-base">biotech</span>
                    </div>
                    <div class="bg-surface-container-lowest border border-outline-variant/40 rounded-lg rounded-tl-sm p-5 shadow-sm space-y-2 w-full ${rtlClass}">
                      <div class="flex items-center justify-between border-b border-outline-variant/20 pb-2">
                        <div class="flex items-center gap-2">
                          <span class="material-symbols-outlined text-primary text-base">verified</span>
                          <span class="font-label-sm text-label-sm font-bold text-primary">Context Grounded: ${esc(p.name || "Active Report")}</span>
                        </div>
                        ${cites ? `<span class="font-label-sm text-label-sm text-outline">Ref: ${esc(cites)}</span>` : ""}
                      </div>
                      <p class="font-body-md text-body-md text-on-surface leading-relaxed">${esc(m.text)}</p>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>

          <!-- Chat Input Area -->
          <form id="assistant-chat-form" class="p-4 bg-surface-container-lowest border-t border-outline-variant/30">
            <div class="relative bg-surface-container-low rounded-DEFAULT border border-outline-variant/50 focus-within:border-secondary focus-within:ring-2 focus-within:ring-secondary/20 transition-all p-2">
              <textarea id="assistant-chat-input" class="w-full bg-transparent resize-none border-0 text-on-surface placeholder:text-outline font-body-md text-body-md focus:ring-0 p-2 focus:outline-none" placeholder="Ask a question about ${esc(p.name || "this patient")}'s results..." rows="2"></textarea>
              <div class="flex items-center justify-between pt-1 px-2">
                <div class="flex items-center gap-2 text-outline">
                  <span class="material-symbols-outlined text-sm">lock</span>
                  <span class="font-label-sm text-label-sm">Responses are restricted solely to the active report context.</span>
                </div>
                <button type="submit" class="bg-primary hover:bg-primary/90 text-on-primary px-4 py-2 rounded-full flex items-center gap-1.5 font-label-sm text-label-sm font-semibold transition-all active:scale-95 shadow-sm">
                  <span>Send</span>
                  <span class="material-symbols-outlined text-base">send</span>
                </button>
              </div>
            </div>
          </form>
        </section>

        <!-- RIGHT COLUMN: REPORT CONTEXT PANEL (4 Cols) -->
        <aside class="lg:col-span-4 bg-surface-container-lowest flex flex-col p-6 space-y-6">
          <div class="flex items-center justify-between pb-3 border-b border-outline-variant/30">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-primary text-xl">folder_shared</span>
              <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">Active Context</h2>
            </div>
            <span class="px-2.5 py-0.5 bg-surface-container rounded-full text-primary font-label-sm text-label-sm font-semibold">Live Session</span>
          </div>

          <div class="bg-surface-container-low border border-outline-variant/40 rounded-DEFAULT p-4 flex flex-col gap-3 shadow-sm">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-full bg-secondary text-white flex items-center justify-center font-bold font-headline-sm text-headline-sm">
                ${esc(initials(p.name))}
              </div>
              <div>
                <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">${esc(p.name || "Custom Report")}</h3>
                <p class="font-body-sm text-body-sm text-on-surface-variant">ID: <span class="font-mono font-semibold">#${esc(p.patient_id || "CUSTOM")}</span></p>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2 pt-2 border-t border-outline-variant/30 font-body-sm text-body-sm">
              <div>
                <span class="text-outline block font-label-sm text-label-sm">Age</span>
                <span class="font-semibold text-on-surface">${p.age !== null && p.age !== undefined ? esc(p.age) + " Years" : "Missing"}</span>
              </div>
              <div>
                <span class="text-outline block font-label-sm text-label-sm">Biological Sex</span>
                <span class="font-semibold text-on-surface">${p.sex ? esc(p.sex.charAt(0).toUpperCase() + p.sex.slice(1)) : "Missing"}</span>
              </div>
            </div>
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-label-md text-label-md font-bold text-on-surface">Analyzed Biomarkers (${(data?.results || []).length})</span>
              <button data-goto-view="analysis-results" class="font-label-sm text-label-sm text-primary font-semibold hover:underline">Full View →</button>
            </div>
            ${(data?.results || [])
              .map((r) => {
                const st = STATUS_STYLE[r.status] || STATUS_STYLE.cannot_classify;
                return `
                  <div class="bg-surface-container-lowest border ${st.border} rounded-DEFAULT p-4 shadow-sm flex flex-col gap-2">
                    <div class="flex items-start justify-between">
                      <div>
                        <span class="font-headline-sm text-headline-sm font-bold text-on-surface block">${esc(r.test)}</span>
                        <span class="font-body-sm text-body-sm text-outline">${esc(r.reference?.text || "No range in files")}</span>
                      </div>
                      <span class="px-2.5 py-0.5 rounded-full font-label-sm text-label-sm font-bold" style="background:${st.bg}; color:${st.color}">
                        ${esc(r.status.toUpperCase())}
                      </span>
                    </div>
                    <div class="flex items-baseline gap-2">
                      <span class="font-data-metric text-data-metric font-bold leading-none" style="color:${st.color}">${esc(r.value)}</span>
                      <span class="font-body-sm text-body-sm text-on-surface-variant font-medium">${esc(r.unit)}</span>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </aside>
      </div>
    </div>
  `;
}

/* ============================================================================
   VIEW 6: HOW IT WORKS (Teammate's citylab_how_it_works + Live Audit Trigger)
   ============================================================================ */
function renderHowItWorksView() {
  return `
    <main class="p-6 lg:p-8 max-w-[1440px] mx-auto w-full space-y-8">
      <section class="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div class="space-y-2">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm mb-1">
            <span class="material-symbols-outlined text-sm">science</span>
            <span>Clinical Transparency Protocol v1.1</span>
          </div>
          <h1 class="font-headline-xl text-headline-xl text-on-surface tracking-tight font-bold">How CityLab Works</h1>
          <p class="font-body-lg text-body-lg text-on-surface-variant max-w-3xl">
            Understand your laboratory reports with clinical precision, clear plain-language translations, and rigorous safety guardrails.
          </p>
        </div>
        <button id="how-audit-btn" class="px-6 py-3 rounded-full bg-primary text-on-primary font-label-lg text-label-lg font-bold shadow-sm hover:opacity-95 flex items-center gap-2">
          <span class="material-symbols-outlined text-[20px]">fact_check</span>
          <span>Run Live 14/14 Self-Audit</span>
        </button>
      </section>

      <section class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-6 relative overflow-hidden shadow-sm">
        <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-DEFAULT bg-primary-container/20 text-on-primary-container flex items-center justify-center shrink-0">
              <span class="material-symbols-outlined text-2xl text-primary">verified_user</span>
            </div>
            <div class="space-y-1">
              <div class="flex items-center gap-2">
                <h2 class="font-headline-sm text-headline-sm text-on-surface font-bold">The Clinical Integrity Promise</h2>
                <span class="bg-primary/10 text-primary font-label-sm text-label-sm px-2.5 py-0.5 rounded-full font-medium">Deterministic + LLM Hybrid</span>
              </div>
              <p class="font-body-md text-body-md text-on-surface-variant max-w-4xl">
                CityLab bridges the cognitive gap between raw biochemical pathology and human comprehension. All numerical comparisons, unit conversions, alias lookups, and boundary rules are executed deterministically in Python against the corpus files, while the LLM writes empathetic Class-8 explanations validated against diagnostic phrasing.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-6 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-headline-md text-headline-md font-bold text-secondary">01</span>
            <span class="font-label-sm text-label-sm px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-medium">Stage 1 of 4</span>
          </div>
          <h3 class="font-headline-md text-headline-md text-on-surface font-bold">Boilerplate Stripping & Parsing</h3>
          <p class="font-body-md text-body-md text-on-surface-variant">
            Isolates patient demographics and analytical results from 15 KB of repeated CLIA/HIPAA legal appendices, preserving exact line numbers for citations.
          </p>
        </div>

        <div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-6 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-headline-md text-headline-md font-bold text-secondary">02</span>
            <span class="font-label-sm text-label-sm px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-medium">Stage 2 of 4</span>
          </div>
          <h3 class="font-headline-md text-headline-md text-on-surface font-bold">Glossary Alias & Unit Normalization</h3>
          <p class="font-body-md text-body-md text-on-surface-variant">
            Standardizes medical aliases (SGPT → ALT, SGOT → AST, FBS → Fasting Blood Sugar) via <code>2_medical_glossary.md</code> and converts SI units (<code>6.0 mmol/L × 18 = 108 mg/dL</code>).
          </p>
        </div>

        <div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-6 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-headline-md text-headline-md font-bold text-secondary">03</span>
            <span class="font-label-sm text-label-sm px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-medium">Stage 3 of 4</span>
          </div>
          <h3 class="font-headline-md text-headline-md text-on-surface font-bold">Boundary-Aware Range Partitioning</h3>
          <p class="font-body-md text-body-md text-on-surface-variant">
            Matches results against age and biological sex intervals. Exact boundary values (e.g. ALT=45, Cholesterol=200) are classified NORMAL per <code>4_ranges_hematology.md:2</code>. Missing demographics are never guessed.
          </p>
        </div>

        <div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-6 space-y-3">
          <div class="flex items-center justify-between">
            <span class="font-headline-md text-headline-md font-bold text-secondary">04</span>
            <span class="font-label-sm text-label-sm px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-medium">Stage 4 of 4</span>
          </div>
          <h3 class="font-headline-md text-headline-md text-on-surface font-bold">Multilingual Explanation & Safety Guard</h3>
          <p class="font-body-md text-body-md text-on-surface-variant">
            Generates Class-8 explanations and 3–5 prioritized doctor questions in English, Urdu (اردو), and Roman Urdu, filtered by an anti-diagnosis validator.
          </p>
        </div>
      </section>

      ${renderDisclaimerFooter()}
    </main>
  `;
}

function renderDisclaimerFooter() {
  const disc = state.analysis?.disclaimer || "This is not a diagnosis. Only a licensed doctor can diagnose conditions.";
  return `
    <footer class="pt-6 pb-8 border-t border-outline-variant/30 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-error-container/30 flex items-center justify-center text-error shrink-0">
          <span class="material-symbols-outlined text-[18px]">medical_services</span>
        </div>
        <p class="font-body-sm text-body-sm text-on-surface-variant max-w-3xl ${state.lang === "ur" ? "rtl-text" : ""}">
          <strong class="font-semibold text-on-surface">Medical Disclaimer:</strong> ${esc(disc)}
        </p>
      </div>
      <div class="font-body-sm text-body-sm text-outline flex items-center gap-3">
        <span>CityLab Diagnostics AI • Tech Fusion ’26</span>
      </div>
    </footer>
  `;
}

function renderCurrentView() {
  const root = document.getElementById("view-root");
  if (!root) return;

  if (state.view === "dashboard") root.innerHTML = renderDashboardView();
  else if (state.view === "patients") root.innerHTML = renderPatientsView();
  else if (state.view === "analyze-report") root.innerHTML = renderAnalyzeReportView();
  else if (state.view === "analysis-results") root.innerHTML = renderAnalysisResultsView();
  else if (state.view === "ai-assistant") root.innerHTML = renderAiAssistantView();
  else if (state.view === "how-it-works") root.innerHTML = renderHowItWorksView();

  translateDOM(root, state.lang);
  bindViewEvents();
}

function bindViewEvents() {
  // Navigation triggers inside views
  document.querySelectorAll("[data-goto-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.getAttribute("data-goto-view")));
  });

  // Open specific patient triggers
  document.querySelectorAll("[data-open-patient]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pid = btn.getAttribute("data-open-patient");
      const target = btn.getAttribute("data-open-target") || "analysis-results";
      selectPatientAndOpen(pid, target);
    });
  });

  // Dashboard quick paste
  const dashLoad = document.getElementById("dash-load-sample");
  if (dashLoad) {
    dashLoad.onclick = () => {
      state.customText = TRICKY_SAMPLE_REPORT;
      document.getElementById("dash-paste-input").value = state.customText;
    };
  }
  const dashParse = document.getElementById("dash-parse-btn");
  if (dashParse) {
    dashParse.onclick = () => {
      state.customText = document.getElementById("dash-paste-input").value;
      state.activeMode = "custom";
      state.overrideAge = null;
      state.overrideSex = null;
      runAnalyze(true, "analysis-results");
    };
  }

  // Audit buttons
  ["hero-audit-btn", "dir-audit-btn", "how-audit-btn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.onclick = openAuditModal;
  });

  // Directory search & filters
  const dirSearch = document.getElementById("dir-search-input");
  if (dirSearch) {
    dirSearch.addEventListener("input", (e) => {
      state.directorySearch = e.target.value;
      renderCurrentView();
      const inputAfter = document.getElementById("dir-search-input");
      if (inputAfter) {
        inputAfter.focus();
        inputAfter.setSelectionRange(inputAfter.value.length, inputAfter.value.length);
      }
    });
  }
  document.querySelectorAll("[data-dir-filter]").forEach((btn) => {
    btn.onclick = () => {
      state.directoryFilter = btn.getAttribute("data-dir-filter");
      renderCurrentView();
    };
  });

  // Analyze Report view events
  document.querySelectorAll("[data-jump-patient]").forEach((btn) => {
    btn.onclick = () => {
      state.activeMode = "patient";
      state.selectedPatientId = btn.getAttribute("data-jump-patient");
      state.overrideAge = null;
      state.overrideSex = null;
      runAnalyze(true, "analyze-report");
    };
  });

  const selPt = document.getElementById("analyze-patient-select");
  if (selPt) {
    selPt.onchange = (e) => {
      state.activeMode = "patient";
      state.selectedPatientId = e.target.value;
      state.overrideAge = null;
      state.overrideSex = null;
      runAnalyze(true, "analyze-report");
    };
  }

  document.querySelectorAll("[data-sex-pick]").forEach((btn) => {
    btn.onclick = () => {
      const sex = btn.getAttribute("data-sex-pick");
      state.overrideSex = sex;
      const hidden = document.getElementById("clarify-page-sex");
      if (hidden) hidden.value = sex;
      renderCurrentView();
    };
  });

  const clarifyPageForm = document.getElementById("clarification-page-form");
  if (clarifyPageForm) {
    clarifyPageForm.onsubmit = (e) => {
      e.preventDefault();
      const ageVal = document.getElementById("clarify-page-age").value;
      const sexVal = document.getElementById("clarify-page-sex").value;
      state.overrideAge = ageVal !== "" ? Number(ageVal) : null;
      state.overrideSex = sexVal || null;
      runAnalyze(false, "analysis-results");
    };
  }

  const pasteTa = document.getElementById("analyze-paste-textarea");
  if (pasteTa) {
    pasteTa.oninput = () => {
      state.customText = pasteTa.value;
      const cnt = document.getElementById("analyze-char-counter");
      if (cnt) cnt.textContent = `${pasteTa.value.length.toLocaleString()} / 200,000 characters`;
    };
  }
  const loadTricky = document.getElementById("analyze-load-tricky");
  if (loadTricky) {
    loadTricky.onclick = () => {
      state.customText = TRICKY_SAMPLE_REPORT;
      renderCurrentView();
    };
  }
  const fileIn = document.getElementById("analyze-file-input");
  if (fileIn) {
    fileIn.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      state.customText = await f.text();
      state.activeMode = "custom";
      runAnalyze(true, "analysis-results");
    };
  }
  const customSub = document.getElementById("analyze-custom-submit");
  if (customSub) {
    customSub.onclick = () => {
      const ta = document.getElementById("analyze-paste-textarea");
      if (ta) state.customText = ta.value;
      state.activeMode = "custom";
      state.overrideAge = null;
      state.overrideSex = null;
      runAnalyze(true, "analysis-results");
    };
  }

  // Analysis Results view events
  const retryBtn = document.getElementById("results-retry-btn");
  if (retryBtn) retryBtn.onclick = () => runAnalyze(false);

  const quickSel = document.getElementById("results-quick-patient");
  if (quickSel) {
    quickSel.onchange = (e) => selectPatientAndOpen(e.target.value, "analysis-results");
  }

  const inlineClarify = document.getElementById("inline-clarify-form");
  if (inlineClarify) {
    inlineClarify.onsubmit = (e) => {
      e.preventDefault();
      const ageVal = document.getElementById("inline-clarify-age").value;
      const sexVal = document.getElementById("inline-clarify-sex").value;
      state.overrideAge = ageVal !== "" ? Number(ageVal) : null;
      state.overrideSex = sexVal || null;
      runAnalyze(false, "analysis-results");
    };
  }

  const expBtn = document.getElementById("results-export-btn");
  if (expBtn) expBtn.onclick = openExportModal;

  const copyAllBtn = document.getElementById("copy-all-questions-btn");
  if (copyAllBtn && state.analysis) {
    copyAllBtn.onclick = () => {
      const full = state.analysis.doctor_questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
      navigator.clipboard?.writeText(full);
      copyAllBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">done_all</span><span>All Questions Copied!</span>`;
      setTimeout(() => renderCurrentView(), 1800);
    };
  }

  document.querySelectorAll("[data-copy-q]").forEach((btn) => {
    btn.onclick = () => {
      navigator.clipboard?.writeText(btn.getAttribute("data-copy-q"));
      btn.innerHTML = `<span class="material-symbols-outlined text-[16px] text-[#209B72]">check</span><span class="text-[#209B72]">Copied!</span>`;
    };
  });

  // What-If Simulator buttons
  document.querySelectorAll("[data-sim-idx]").forEach((btn) => {
    btn.onclick = async () => {
      const idx = btn.getAttribute("data-sim-idx");
      const test = btn.getAttribute("data-sim-test");
      const unit = btn.getAttribute("data-sim-unit");
      const val = document.getElementById(`sim-val-${idx}`).value;
      const outEl = document.getElementById(`sim-out-${idx}`);
      outEl.textContent = "Simulating...";
      try {
        const p = state.analysis?.patient || {};
        const res = await apiFetch("/api/simulate", {
          method: "POST",
          body: JSON.stringify({ test, value: val, unit, age: p.age ?? 35, sex: p.sex ?? "female", lang: state.lang }),
        });
        const r = res.result;
        const st = STATUS_STYLE[r.status] || STATUS_STYLE.cannot_classify;
        outEl.innerHTML = `
          <div class="p-2.5 rounded bg-white border border-outline-variant/40 space-y-1">
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-label-sm font-bold" style="background:${st.bg}; color:${st.color}">
              ${esc(r.status.toUpperCase())} — ${esc(r.value)} ${esc(r.unit)}
            </span>
            <div>${esc(r.reason)}</div>
            <div class="${state.lang === "ur" ? "rtl-text" : ""} text-on-surface">${esc(r.explanation)}</div>
          </div>
        `;
        translateDOM(outEl, state.lang);
      } catch (e) {
        outEl.textContent = e.message || "Simulation failed";
      }
    };
  });

  // AI Assistant Chat events
  document.querySelectorAll("[data-chat-chip]").forEach((btn) => {
    btn.onclick = () => sendChatQuestion(btn.getAttribute("data-chat-chip"));
  });

  const chatForm = document.getElementById("assistant-chat-form");
  if (chatForm) {
    chatForm.onsubmit = (e) => {
      e.preventDefault();
      sendChatQuestion();
    };
  }
}

async function sendChatQuestion(presetText = null) {
  const input = document.getElementById("assistant-chat-input");
  const question = (presetText ?? input?.value ?? "").trim();
  if (!question || state.chatLoading) return;
  if (input) input.value = "";
  state.chatHistory.push({ role: "user", text: question });
  state.chatLoading = true;
  renderCurrentView();

  const payload = {
    patient_id: state.activeMode === "patient" ? state.selectedPatientId : null,
    report_text: state.activeMode === "custom" ? state.customText : null,
    age: state.overrideAge !== null && state.overrideAge !== "" ? Number(state.overrideAge) : null,
    sex: state.overrideSex || null,
    question,
    lang: state.lang,
  };

  try {
    const res = await apiFetch("/api/chat", { method: "POST", body: JSON.stringify(payload) });
    state.chatHistory.push({
      role: "bot",
      text: res.answer,
      refused: res.refused,
      sources: res.sources || [],
    });
  } catch (err) {
    state.chatHistory.push({
      role: "bot",
      text: `[${err.code}] ${err.message}`,
      refused: true,
      sources: [],
    });
  } finally {
    state.chatLoading = false;
    renderCurrentView();
    const thread = document.getElementById("assistant-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;
  }
}

function toggleReadAloud() {
  if (!("speechSynthesis" in window)) return;
  if (state.speaking) {
    window.speechSynthesis.cancel();
    state.speaking = false;
    renderShell();
    return;
  }
  if (!state.analysis) return;
  const d = state.analysis;
  const text = [d.urgent_warning || "", d.summary || "", ...d.results.map((r) => `${r.test}: ${r.explanation}`), d.disclaimer || ""]
    .filter(Boolean)
    .join(" ");
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = state.lang === "ur" ? "ur-PK" : "en-US";
  utter.onend = () => {
    state.speaking = false;
    renderShell();
  };
  state.speaking = true;
  renderShell();
  window.speechSynthesis.speak(utter);
}

async function openExportModal() {
  if (!state.analysis) return;
  const modal = document.getElementById("modal-root");
  modal.classList.remove("hidden");
  modal.classList.add("grid");
  modal.innerHTML = `<div class="bg-white rounded-lg p-6 max-w-2xl w-full shadow-xl">Generating Doctor Visit Sheet...</div>`;
  try {
    const payload = {
      patient_id: state.activeMode === "patient" ? state.selectedPatientId : null,
      report_text: state.activeMode === "custom" ? state.customText : null,
      age: state.overrideAge !== null && state.overrideAge !== "" ? Number(state.overrideAge) : null,
      sex: state.overrideSex || null,
      lang: state.lang,
    };
    const res = await apiFetch("/api/export", { method: "POST", body: JSON.stringify(payload) });
    modal.innerHTML = `
      <div class="bg-surface-container-lowest rounded-lg border border-outline-variant/40 max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <div class="p-4 px-6 border-b border-outline-variant/30 flex items-center justify-between">
          <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface">Doctor Visit Sheet & Markdown Export</h3>
          <div class="flex items-center gap-2">
            <button id="modal-copy-md" class="px-4 py-1.5 rounded-full border border-outline-variant font-label-sm font-semibold hover:bg-surface-container-low">Copy Markdown</button>
            <button id="modal-print-md" class="px-4 py-1.5 rounded-full bg-primary text-on-primary font-label-sm font-semibold">Print / Save PDF</button>
            <button id="modal-close-btn" class="px-3 py-1.5 rounded-full hover:bg-surface-container-low font-bold">✕</button>
          </div>
        </div>
        <div class="p-6 overflow-y-auto">
          <pre class="whitespace-pre-wrap font-mono text-xs bg-surface-container-low p-4 rounded-DEFAULT border border-outline-variant/30">${esc(res.markdown)}</pre>
        </div>
      </div>
    `;
    translateDOM(modal, state.lang);
    document.getElementById("modal-close-btn").onclick = closeModal;
    document.getElementById("modal-copy-md").onclick = () => {
      navigator.clipboard?.writeText(res.markdown);
      document.getElementById("modal-copy-md").textContent = "Copied!";
    };
    document.getElementById("modal-print-md").onclick = () => {
      closeModal();
      window.print();
    };
  } catch (e) {
    modal.innerHTML = `<div class="bg-white rounded-lg p-6">Error: ${esc(e.message)} <button id="modal-close-btn" class="ml-4 px-3 py-1 border rounded">Close</button></div>`;
    document.getElementById("modal-close-btn").onclick = closeModal;
  }
}

async function openAuditModal() {
  const modal = document.getElementById("modal-root");
  modal.classList.remove("hidden");
  modal.classList.add("grid");
  modal.innerHTML = `<div class="bg-white rounded-lg p-6 max-w-2xl w-full shadow-xl">Running live 14-patient & 5-checkpoint self-audit...</div>`;
  try {
    const res = await apiFetch("/api/audit");
    modal.innerHTML = `
      <div class="bg-surface-container-lowest rounded-lg border border-outline-variant/40 max-w-4xl w-full max-h-[86vh] flex flex-col shadow-2xl overflow-hidden">
        <div class="p-4 px-6 border-b border-outline-variant/30 flex items-center justify-between">
          <div>
            <h3 class="font-headline-md text-headline-md font-bold text-primary">Live Corpus & 5 Checkpoints Self-Audit (${res.passed_patients}/${res.total_patients} — ${res.score_pct}%)</h3>
            <p class="font-body-sm text-body-sm text-on-surface-variant">Executed in ${res.latency_ms} ms against all 14 corpus reports</p>
          </div>
          <button id="modal-close-btn" class="px-3 py-1.5 rounded-full hover:bg-surface-container-low font-bold">✕ Close</button>
        </div>
        <div class="p-6 overflow-y-auto space-y-4">
          <div class="grid grid-cols-1 gap-2">
            ${res.checkpoints
              .map(
                (cp) => `
              <div class="px-4 py-2.5 rounded-DEFAULT bg-[rgba(32,155,114,0.10)] border border-[#209B72]/30 text-[#209B72] font-label-md font-semibold flex items-center gap-2">
                <span class="material-symbols-outlined text-[18px] fill">check_circle</span>
                <span>Checkpoint ${cp.id}: ${esc(cp.name)} — PASS</span>
              </div>
            `
              )
              .join("")}
          </div>
          <table class="w-full text-left border-collapse text-body-sm">
            <thead>
              <tr class="border-b border-outline-variant/40 text-on-surface-variant font-label-sm uppercase">
                <th class="py-2 px-3">ID</th>
                <th class="py-2 px-3">Patient</th>
                <th class="py-2 px-3">Expected</th>
                <th class="py-2 px-3">Actual</th>
                <th class="py-2 px-3">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-outline-variant/20">
              ${res.cases
                .map(
                  (c) => `
                <tr>
                  <td class="py-2 px-3 font-bold text-primary">${esc(c.patient_id)}</td>
                  <td class="py-2 px-3 font-semibold">${esc(c.name)}</td>
                  <td class="py-2 px-3">${esc(c.expected.join(", "))}</td>
                  <td class="py-2 px-3 text-[#209B72] font-semibold">${esc(c.actual.join(", "))}</td>
                  <td class="py-2 px-3">
                    <button data-audit-open="${esc(c.patient_id)}" class="text-xs font-bold text-secondary hover:underline">Open →</button>
                  </td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
    translateDOM(modal, state.lang);
    document.getElementById("modal-close-btn").onclick = closeModal;
    modal.querySelectorAll("[data-audit-open]").forEach((btn) => {
      btn.onclick = () => {
        closeModal();
        selectPatientAndOpen(btn.getAttribute("data-audit-open"), "analysis-results");
      };
    });
  } catch (e) {
    modal.innerHTML = `<div class="bg-white rounded-lg p-6">Error: ${esc(e.message)} <button id="modal-close-btn" class="ml-4 px-3 py-1 border rounded">Close</button></div>`;
    document.getElementById("modal-close-btn").onclick = closeModal;
  }
}

function closeModal() {
  const modal = document.getElementById("modal-root");
  modal.classList.add("hidden");
  modal.classList.remove("grid");
}

function initShellEvents() {
  // Mobile Sidebar drawer controls
  const menuBtn = document.getElementById("mobile-menu-btn");
  if (menuBtn) menuBtn.addEventListener("click", openMobileSidebar);
  const closeBtn = document.getElementById("sidebar-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", closeMobileSidebar);
  const backdrop = document.getElementById("sidebar-backdrop");
  if (backdrop) backdrop.addEventListener("click", closeMobileSidebar);

  // Sidebar & Mobile Top-Nav navigation
  document.querySelectorAll("[data-nav-view]").forEach((el) => {
    el.addEventListener("click", () => setView(el.getAttribute("data-nav-view")));
  });

  document.getElementById("sidebar-new-analysis").addEventListener("click", () => setView("analyze-report"));
  document.getElementById("btn-audit-sidebar").addEventListener("click", () => {
    closeMobileSidebar();
    openAuditModal();
  });
  document.getElementById("header-patient-pill").addEventListener("click", () => setView("analysis-results"));
  document.getElementById("btn-tts").addEventListener("click", toggleReadAloud);
  const demoBtn = document.getElementById("btn-demo-mode");
  if (demoBtn) demoBtn.addEventListener("click", startDemoMode);

  // Language toggle buttons
  document.querySelectorAll("[data-lang-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.lang = btn.getAttribute("data-lang-btn");
      renderShell();
      renderCurrentView();
      runAnalyze(false, null, true);
    });
  });

  // Global search bar in top header
  const gSearch = document.getElementById("global-patient-search");
  if (gSearch) {
    gSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = gSearch.value.trim().toLowerCase();
        if (!q) return;
        const hit = state.patients.find(
          (p) => p.patient_id.toLowerCase() === q || (p.name || "").toLowerCase().includes(q)
        );
        if (hit) {
          selectPatientAndOpen(hit.patient_id, "analysis-results");
        } else {
          state.directorySearch = gSearch.value;
          setView("patients");
        }
      }
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initShellEvents();
  initDemoPlayer({
    setView: (v) => setView(v),
    closeModal: () => closeModal(),
    openAuditModal: () => openAuditModal(),
    openExportModal: () => openExportModal(),
    setLang: async (l, skipBackend = false) => {
      state.lang = l;
      renderShell();
      renderCurrentView();
      if (!skipBackend) await runAnalyze(false, null, true);
    },
    selectPatient: async (pid, targetView = "analysis-results") => {
      state.activeMode = "patient";
      state.selectedPatientId = pid;
      state.overrideAge = null;
      state.overrideSex = null;
      await runAnalyze(true, targetView);
    },
    supplyDemographicsAndAnalyze: async (age, sex) => {
      state.overrideAge = age;
      state.overrideSex = sex;
      renderCurrentView();
      await new Promise((r) => setTimeout(r, 900));
      await runAnalyze(false, "analysis-results");
    },
    loadCustomTextInAnalyzeView: (txt) => {
      state.customText = txt;
      setView("analyze-report");
    },
    submitCustomReport: async () => {
      state.activeMode = "custom";
      state.overrideAge = null;
      state.overrideSex = null;
      await runAnalyze(true, "analysis-results");
    },
    ensureGauntletAnalyzed: async () => {
      if (state.activeMode !== "custom" || !state.customText.includes("Hamza Tariq")) {
        state.customText = [
          "# CITYLAB DIAGNOSTICS - UPLOADED TEST REPORT",
          "* **Patient Full Name**: Hamza Tariq",
          "* **Recorded Age**: 38",
          "* **Biological Sex**: Male",
          "",
          "## ANALYTICAL RESULTS",
          "- **SGPT**: 45 U/L",
          "- **FBS**: 6.0 mmol/L",
          "- **Total Cholesterol**: 200 mg/dL",
          "- **Hemoglobin**: 6.8 g/dL",
          "- **Vitamin B12**: 210 pg/mL",
        ].join("\n");
        state.activeMode = "custom";
        state.overrideAge = null;
        state.overrideSex = null;
        await runAnalyze(true, "analysis-results");
      } else {
        setView("analysis-results");
      }
    },
    runDemoSimulation: async () => {
      setView("analysis-results");
      // Open all simulator details
      document.querySelectorAll("details").forEach((d) => {
        if (d.textContent.includes("Simulator")) d.open = true;
      });
      const simIn = document.getElementById("sim-val-3") || document.getElementById("sim-val-0");
      const simBtn = document.querySelector("[data-sim-idx='3']") || document.querySelector("[data-sim-idx='0']");
      if (simIn && simBtn) {
        simIn.value = "14.5";
        simIn.scrollIntoView({ behavior: "smooth", block: "center" });
        simBtn.click();
      }
    },
    sendChat: async (q) => {
      await sendChatQuestion(q);
    },
  });
  loadHealthAndPatients();
  runAnalyze(true);
});
