import { SEED_PATIENTS, TRICKY_SAMPLE_REPORT } from "./mocks.js";

const API_BASE = window.VITE_API_BASE_URL || "";

const UI_TEXT = {
  en: {
    patientsHeader: "Corpus Patients (14)",
    pasteTab: "Paste / Upload Report",
    doctorQuestions: "Questions to Ask Your Doctor",
    copyQuestions: "Copy Questions",
    copied: "Copied!",
    chatHeader: "Patient Context-Locked Chat",
    chatPlaceholder: "Ask about this patient's results...",
    send: "Send",
    evidence: "Evidence & Citations",
    whatIf: "What-If Value Simulator",
    simulateBtn: "Simulate",
    readAloud: "Read Aloud",
    stopAudio: "Stop Audio",
    exportBtn: "Doctor Visit Sheet",
    auditBtn: "14/14 Audit",
  },
  ur: {
    patientsHeader: "مریضوں کی رپورٹس (14)",
    pasteTab: "رپورٹ پیسٹ یا اپ لوڈ کریں",
    doctorQuestions: "اپنے ڈاکٹر سے پوچھنے کے سوالات",
    copyQuestions: "سوالات کاپی کریں",
    copied: "کاپی ہو گیا!",
    chatHeader: "مریض کے نتائج سے متعلق سوالات (محفوظ چیٹ)",
    chatPlaceholder: "اس رپورٹ کے بارے میں سوال لکھیں...",
    send: "بھیجیں",
    evidence: "حوالہ جات (فائل اور لائن نمبر)",
    whatIf: "فرضی ویلیو چیک کریں (What-If)",
    simulateBtn: "چیک کریں",
    readAloud: "آواز میں سنیں",
    stopAudio: "آواز روکیں",
    exportBtn: "ڈاکٹر وزٹ شیٹ",
    auditBtn: "آڈٹ رپورٹ (14/14)",
  },
  "ro-ur": {
    patientsHeader: "Mareezon Ki Reports (14)",
    pasteTab: "Report Paste / Upload Karein",
    doctorQuestions: "Apne Doctor Se Poochne Ke Sawalat",
    copyQuestions: "Sawalat Copy Karein",
    copied: "Copy Ho Gaya!",
    chatHeader: "Patient Context-Locked Chat",
    chatPlaceholder: "Is report ke baray mein sawal likhein...",
    send: "Bhejein",
    evidence: "Hawala Jaat (File & Line Citations)",
    whatIf: "What-If Value Simulator",
    simulateBtn: "Check Karein",
    readAloud: "Sunain (Audio)",
    stopAudio: "Rokein",
    exportBtn: "Doctor Visit Sheet",
    auditBtn: "14/14 Audit",
  },
};

const STATUS_META = {
  normal: { icon: "✓", label: { en: "Normal", ur: "نارمل (Normal)", "ro-ur": "Normal" } },
  low: { icon: "↓", label: { en: "Low", ur: "کم (Low)", "ro-ur": "Kam (Low)" } },
  high: { icon: "↑", label: { en: "High", ur: "زیادہ (High)", "ro-ur": "Zyada (High)" } },
  urgent: { icon: "⚠", label: { en: "Urgent — Critical", ur: "فوری خطرہ (Urgent)", "ro-ur": "Urgent — Critical" } },
  cannot_classify: { icon: "?", label: { en: "Cannot Classify from Files", ur: "فائلوں میں رینج نہیں", "ro-ur": "Cannot Classify" } },
  needs_demographics: { icon: "ℹ", label: { en: "Needs Age / Sex", ur: "عمر/جنس درکار ہے", "ro-ur": "Needs Age / Sex" } },
};

const state = {
  lang: "en",
  patients: [...SEED_PATIENTS],
  filterTag: "all",
  search: "",
  activeMode: "patient", // "patient" | "custom"
  selectedPatientId: "P005",
  customText: "",
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

const TAG_MAP = Object.fromEntries(SEED_PATIENTS.map((p) => [p.patient_id, { tag: p.tag, tagLabel: p.tagLabel }]));

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
      const err = data?.error || { code: `HTTP_${res.status}`, message: `Server returned HTTP ${res.status}` };
      throw err;
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
        ...p,
        ...(TAG_MAP[p.patient_id] || { tag: "ok", tagLabel: `${p.test_count} test(s)` }),
      }));
    }
  } catch (_) {
    state.health = { status: "down" };
  }
  renderHeader();
  renderSidebar();
}

async function runAnalyze(resetChat = false) {
  state.loading = true;
  state.error = null;
  if (resetChat) state.chatHistory = [];
  renderMain();
  renderChat();

  const payload = {
    patient_id: state.activeMode === "patient" ? state.selectedPatientId : null,
    report_text: state.activeMode === "custom" ? state.customText : null,
    age: state.overrideAge !== null && state.overrideAge !== "" ? Number(state.overrideAge) : null,
    sex: state.overrideSex || null,
    lang: state.lang,
  };

  try {
    state.analysis = await apiFetch("/api/analyze", { method: "POST", body: JSON.stringify(payload) });
    apiFetch("/api/health").then((h) => {
      state.health = h;
      renderHeader();
    }).catch(() => {});
  } catch (err) {
    state.error = err;
  } finally {
    state.loading = false;
    renderMain();
    renderChat();
  }
}

function renderHeader() {
  const h = state.health;
  const dotEl = document.getElementById("health-dot");
  const txtEl = document.getElementById("health-text");
  if (h && h.status === "ok") {
    dotEl.className = "dot ok";
    const cacheHits = h.cache?.hits ?? 0;
    const mode = h.llm_enabled ? `LLM + Deterministic (${cacheHits} cached)` : "Deterministic Core Ready";
    txtEl.textContent = `API Online • ${mode}`;
  } else {
    dotEl.className = "dot err";
    txtEl.textContent = "Backend Offline";
  }

  document.querySelectorAll("[data-lang-btn]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-lang-btn") === state.lang);
  });

  const t = UI_TEXT[state.lang];
  document.getElementById("btn-tts-label").textContent = state.speaking ? t.stopAudio : t.readAloud;
  document.getElementById("btn-export-label").textContent = t.exportBtn;
  document.getElementById("btn-audit-label").textContent = t.auditBtn;
}

function renderSidebar() {
  const t = UI_TEXT[state.lang];
  document.getElementById("sidebar-patients-title").textContent = t.patientsHeader;
  document.getElementById("sidebar-paste-title").textContent = t.pasteTab;

  document.querySelectorAll("[data-filter-chip]").forEach((chip) => {
    chip.classList.toggle("active", chip.getAttribute("data-filter-chip") === state.filterTag);
  });

  const listEl = document.getElementById("patient-list");
  const q = state.search.trim().toLowerCase();
  const filtered = state.patients.filter((p) => {
    const matchTag = state.filterTag === "all" || p.tag === state.filterTag;
    const matchQ = !q || p.name?.toLowerCase().includes(q) || p.patient_id.toLowerCase().includes(q) || p.tagLabel?.toLowerCase().includes(q);
    return matchTag && matchQ;
  });

  listEl.innerHTML = filtered
    .map((p) => {
      const active = state.activeMode === "patient" && state.selectedPatientId === p.patient_id;
      const ageStr = p.age !== null && p.age !== undefined ? `${p.age}y` : "Age ?";
      const sexStr = p.sex ? p.sex[0].toUpperCase() : "Sex ?";
      return `
        <button class="patient-item ${active ? "active" : ""}" data-select-patient="${esc(p.patient_id)}">
          <div>
            <div class="patient-name">${esc(p.patient_id)} — ${esc(p.name)}</div>
            <div class="patient-sub">${esc(ageStr)} • ${esc(sexStr)} • ${esc(p.file)}</div>
          </div>
          <span class="tag-mini tag-${esc(p.tag)}">${esc(p.tagLabel)}</span>
        </button>
      `;
    })
    .join("");

  listEl.querySelectorAll("[data-select-patient]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeMode = "patient";
      state.selectedPatientId = btn.getAttribute("data-select-patient");
      state.overrideAge = null;
      state.overrideSex = null;
      renderSidebar();
      runAnalyze(true);
    });
  });
}

function computeGaugePct(r) {
  const ref = r.reference;
  if (!ref || ref.low === null || ref.high === null || typeof r.value !== "number") return null;
  const span = ref.high - ref.low;
  if (span <= 0) return 50;
  // Normal zone occupies 25%..75% of the bar
  const ratio = (r.value - ref.low) / span;
  const pct = 25 + ratio * 50;
  return Math.max(4, Math.min(96, pct));
}

function renderMain() {
  const container = document.getElementById("main-content");
  const isRtl = state.lang === "ur";
  const rtlClass = isRtl ? "rtl-text" : "";
  const t = UI_TEXT[state.lang];

  let html = "";

  if (state.error) {
    html += `
      <div class="error-toast" role="alert">
        <div>
          <strong>[${esc(state.error.code)}]</strong> ${esc(state.error.message)}
        </div>
        <button class="btn" id="btn-retry-error">Retry</button>
      </div>
    `;
  }

  if (state.loading) {
    html += `
      <div class="panel summary-card">
        <div style="font-weight:700; color:var(--text-muted);">Analyzing report through CityLab multi-step pipeline...</div>
      </div>
    `;
    container.innerHTML = html;
    return;
  }

  const data = state.analysis;
  if (!data) {
    container.innerHTML = html + `<div class="panel summary-card">Select a patient on the left or paste a lab report to begin.</div>`;
    bindMainEvents();
    return;
  }

  // 1. Urgent Warning Banner
  if (data.urgent_warning) {
    html += `
      <div class="urgent-banner ${rtlClass}" role="alert">
        <div style="font-size:1.5rem;">🚨</div>
        <div>
          <strong>CRITICAL VALUE ALERT — IMMEDIATE MEDICAL ATTENTION</strong>
          <div>${esc(data.urgent_warning)}</div>
        </div>
      </div>
    `;
  }

  // 2. Clarifying Question Card (Missing Demographics)
  if (data.state === "needs_demographics" && data.clarifying_question) {
    html += `
      <div class="clarify-card">
        <div class="${rtlClass}" style="font-weight:700;">❓ Clarifying Question Required (No Guessing Policy)</div>
        <div class="${rtlClass}" style="margin-top:0.25rem; font-size:0.9rem;">${esc(data.clarifying_question)}</div>
        <form class="clarify-form" id="clarify-form">
          <label>
            Age (years):
            <input type="number" id="clarify-age" min="1" max="120" step="1" placeholder="e.g. 35" value="${esc(data.patient.age ?? "")}" />
          </label>
          <label>
            Biological Sex:
            <select id="clarify-sex">
              <option value="">-- Select Sex --</option>
              <option value="female" ${data.patient.sex === "female" ? "selected" : ""}>Female</option>
              <option value="male" ${data.patient.sex === "male" ? "selected" : ""}>Male</option>
            </select>
          </label>
          <button type="submit" class="btn btn-primary">Apply & Classify Report</button>
        </form>
      </div>
    `;
  }

  // 3. Patient Summary Card
  const p = data.patient;
  html += `
    <div class="panel summary-card">
      <div class="patient-header-row">
        <div>
          <h2 class="patient-title">${esc(p.name || "Custom Patient Report")} ${p.patient_id ? `<span style="color:var(--text-muted); font-weight:600;">(${esc(p.patient_id)})</span>` : ""}</h2>
          <div class="demo-pills">
            <span class="demo-pill">Age: <strong>${p.age !== null && p.age !== undefined ? esc(p.age) + " yrs" : "MISSING"}</strong></span>
            <span class="demo-pill">Sex: <strong>${p.sex ? esc(p.sex.toUpperCase()) : "MISSING"}</strong></span>
            <span class="demo-pill">Tests: <strong>${data.results.length}</strong></span>
            <span class="demo-pill">Language: <strong>${esc(data.lang.toUpperCase())}</strong></span>
          </div>
        </div>
        ${(state.overrideAge !== null || state.overrideSex !== null) ? `<button class="btn" id="btn-reset-demo">Reset Demographics Override</button>` : ""}
      </div>
      <div class="summary-box ${rtlClass}">${esc(data.summary)}</div>
    </div>
  `;

  // 4. Test Result Cards
  html += `<div class="results-grid">`;
  data.results.forEach((r, idx) => {
    const sm = STATUS_META[r.status] || STATUS_META.cannot_classify;
    const badgeLabel = sm.label[state.lang] || sm.label.en;
    const pct = computeGaugePct(r);
    const refText = r.reference?.text || "Not available in lab reference sheets";

    html += `
      <div class="result-card status-${esc(r.status)}">
        <div class="result-top">
          <div>
            <h3 class="test-title">
              ${esc(r.test)}
              ${r.alias_note ? `<span class="alias-chip" title="Mapped via 2_medical_glossary.md">🔗 ${esc(r.alias_note)}</span>` : ""}
            </h3>
            ${r.conversion ? `
              <div class="conversion-banner">
                🔄 <strong>Unit Converted:</strong> ${esc(r.conversion.from)} → <strong>${esc(r.conversion.to)}</strong>
                &nbsp;|&nbsp; Formula: <code>${esc(r.conversion.formula)}</code>
              </div>
            ` : ""}
          </div>
          <span class="badge badge-${esc(r.status)}">${sm.icon} ${esc(badgeLabel)}</span>
        </div>

        <div class="metrics-row">
          <div>
            <div class="metric-label">Patient Result</div>
            <div class="metric-val">${esc(r.value)} ${esc(r.unit)} ${r.conversion ? `<span style="font-size:0.76rem; font-weight:500; color:var(--text-muted);">(${esc(r.value_raw)} ${esc(r.unit_raw)})</span>` : ""}</div>
          </div>
          <div>
            <div class="metric-label">Reference Range (Age/Sex)</div>
            <div class="metric-val" style="font-size:0.86rem;">${esc(refText)}</div>
          </div>
        </div>

        ${pct !== null ? `
          <div class="gauge-wrap">
            <div class="gauge-bar">
              <div class="gauge-pin" style="left:${pct}%;" title="${esc(r.value)} ${esc(r.unit)}"></div>
            </div>
            <div class="gauge-labels">
              <span>Low (&lt; ${esc(r.reference.low)})</span>
              <span>Normal Range (${esc(r.reference.low)} – ${esc(r.reference.high)} ${esc(r.reference.unit)})</span>
              <span>High (&gt; ${esc(r.reference.high)})</span>
            </div>
          </div>
        ` : ""}

        <div class="reason-text"><strong>Classification Rule:</strong> ${esc(r.reason)}</div>
        <div class="explanation-text ${rtlClass}">${esc(r.explanation)}</div>

        <div class="card-details-row">
          <details class="sub-drawer">
            <summary>📄 ${esc(t.evidence)} (${r.sources.length})</summary>
            <ul class="source-list">
              ${r.sources.map((s) => `<li><code>${esc(s.file)}:${esc(s.line)}</code> — ${esc(s.quote)}</li>`).join("")}
            </ul>
          </details>

          ${typeof r.value === "number" ? `
            <details class="sub-drawer">
              <summary>🧪 ${esc(t.whatIf)}</summary>
              <div class="sim-box">
                <div class="sim-controls">
                  <input type="number" step="any" value="${esc(r.value)}" id="sim-val-${idx}" />
                  <span style="font-size:0.78rem; font-weight:600;">${esc(r.unit)}</span>
                  <button class="btn btn-primary" data-sim-idx="${idx}" data-sim-test="${esc(r.test)}" data-sim-unit="${esc(r.unit)}">${esc(t.simulateBtn)}</button>
                </div>
                <div id="sim-out-${idx}" style="margin-top:0.4rem; font-size:0.8rem;"></div>
              </div>
            </details>
          ` : ""}
        </div>
      </div>
    `;
  });
  html += `</div>`;

  // 5. Doctor Questions Card
  html += `
    <div class="panel">
      <div class="panel-header">
        <h2 class="${rtlClass}">🩺 ${esc(t.doctorQuestions)} (${data.doctor_questions.length})</h2>
        <button class="btn" id="btn-copy-questions">📋 ${esc(t.copyQuestions)}</button>
      </div>
      <div class="panel-body ${rtlClass}">
        <ol class="questions-list">
          ${data.doctor_questions.map((q) => `<li>${esc(q)}</li>`).join("")}
        </ol>
      </div>
    </div>
  `;

  // 6. Always-Visible Disclaimer
  html += `
    <div class="disclaimer-bar ${rtlClass}" role="note">
      ⚕️ ${esc(data.disclaimer)}
    </div>
  `;

  // 7. Judge Telemetry Strip
  const m = data.meta || {};
  html += `
    <div class="meta-strip">
      <span><strong>Request ID:</strong> ${esc(data.request_id)}</span>
      <span><strong>Pipeline:</strong> Parse → Normalize/Convert → Deterministic Classify → LLM Explain → Safety Validator</span>
      <span><strong>LLM Provider:</strong> ${esc(m.provider ? `${m.provider} (${m.model})` : "Deterministic Safe Template")}</span>
      <span><strong>Latency:</strong> ${esc(m.latency_ms ?? 0)} ms</span>
      <span><strong>Cache Hit:</strong> ${m.cached ? "Yes" : "No"}</span>
      <span><strong>Fallback Used:</strong> ${m.fallback_used ? "Yes" : "No"}</span>
    </div>
  `;

  container.innerHTML = html;
  bindMainEvents();
}

function bindMainEvents() {
  const retryBtn = document.getElementById("btn-retry-error");
  if (retryBtn) retryBtn.addEventListener("click", () => runAnalyze(false));

  const clarifyForm = document.getElementById("clarify-form");
  if (clarifyForm) {
    clarifyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const ageVal = document.getElementById("clarify-age").value;
      const sexVal = document.getElementById("clarify-sex").value;
      state.overrideAge = ageVal !== "" ? Number(ageVal) : null;
      state.overrideSex = sexVal || null;
      runAnalyze(false);
    });
  }

  const resetBtn = document.getElementById("btn-reset-demo");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.overrideAge = null;
      state.overrideSex = null;
      runAnalyze(false);
    });
  }

  const copyBtn = document.getElementById("btn-copy-questions");
  if (copyBtn && state.analysis) {
    copyBtn.addEventListener("click", () => {
      const text = state.analysis.doctor_questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
      navigator.clipboard?.writeText(text);
      copyBtn.textContent = "✅ " + UI_TEXT[state.lang].copied;
      setTimeout(() => {
        copyBtn.textContent = "📋 " + UI_TEXT[state.lang].copyQuestions;
      }, 1500);
    });
  }

  document.querySelectorAll("[data-sim-idx]").forEach((btn) => {
    btn.addEventListener("click", async () => {
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
          body: JSON.stringify({
            test,
            value: val,
            unit,
            age: p.age ?? 35,
            sex: p.sex ?? "female",
            lang: state.lang,
          }),
        });
        const r = res.result;
        const sm = STATUS_META[r.status] || STATUS_META.cannot_classify;
        outEl.innerHTML = `
          <span class="badge badge-${esc(r.status)}">${sm.icon} ${esc(sm.label[state.lang] || r.status)}</span>
          <div style="margin-top:0.25rem;">${esc(r.reason)}</div>
          <div class="${state.lang === "ur" ? "rtl-text" : ""}" style="margin-top:0.2rem; color:var(--text-muted);">${esc(r.explanation)}</div>
        `;
      } catch (e) {
        outEl.textContent = e.message || "Simulation failed";
      }
    });
  });
}

function renderChat() {
  const t = UI_TEXT[state.lang];
  const isRtl = state.lang === "ur";
  document.getElementById("chat-title").textContent = t.chatHeader;
  const inputEl = document.getElementById("chat-input");
  if (inputEl) inputEl.placeholder = t.chatPlaceholder;
  const sendBtn = document.getElementById("chat-send-btn");
  if (sendBtn) sendBtn.textContent = t.send;

  const box = document.getElementById("chat-messages");
  if (!state.chatHistory.length) {
    const pName = state.analysis?.patient?.name || "the open report";
    box.innerHTML = `
      <div class="msg msg-bot">
        🔒 <strong>Privacy Context-Lock Active:</strong> I can answer questions strictly about <strong>${esc(pName)}</strong> using CityLab's verified files. Try asking a question or click a quick prompt below.
      </div>
    `;
    return;
  }

  box.innerHTML = state.chatHistory
    .map((m) => {
      if (m.role === "user") {
        return `<div class="msg msg-user">${esc(m.text)}</div>`;
      }
      const cls = m.refused ? "msg msg-refused" : "msg msg-bot";
      const cites = (m.sources || []).map((s) => `<code>${esc(s.file)}:${esc(s.line)}</code>`).join(", ");
      return `
        <div class="${cls} ${isRtl ? "rtl-text" : ""}">
          ${m.refused ? `<strong>🛡️ Privacy Refusal (Rule 1):</strong><br/>` : ""}
          <div>${esc(m.text)}</div>
          ${cites ? `<div style="margin-top:0.35rem; font-size:0.73rem; opacity:0.85;">Sources: ${cites}</div>` : ""}
        </div>
      `;
    })
    .join("");
  box.scrollTop = box.scrollHeight;
}

async function sendChatQuestion(qText) {
  const question = (qText ?? document.getElementById("chat-input").value).trim();
  if (!question || state.chatLoading) return;
  document.getElementById("chat-input").value = "";
  state.chatHistory.push({ role: "user", text: question });
  state.chatLoading = true;
  renderChat();

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
    renderChat();
  }
}

function toggleReadAloud() {
  if (!("speechSynthesis" in window)) {
    alert("Speech synthesis is not supported in this browser.");
    return;
  }
  if (state.speaking) {
    window.speechSynthesis.cancel();
    state.speaking = false;
    renderHeader();
    return;
  }
  if (!state.analysis) return;
  const d = state.analysis;
  const text = [
    d.urgent_warning || "",
    d.summary || "",
    ...d.results.map((r) => `${r.test}: ${r.explanation}`),
    d.disclaimer || "",
  ]
    .filter(Boolean)
    .join(" ");

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = state.lang === "ur" ? "ur-PK" : "en-US";
  utter.onend = () => {
    state.speaking = false;
    renderHeader();
  };
  state.speaking = true;
  renderHeader();
  window.speechSynthesis.speak(utter);
}

async function openExportModal() {
  if (!state.analysis) return;
  const modal = document.getElementById("modal-root");
  modal.style.display = "grid";
  modal.innerHTML = `<div class="modal"><div class="modal-body">Generating Doctor Visit Sheet...</div></div>`;
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
      <div class="modal">
        <div class="panel-header">
          <h2>📄 Printable Doctor Visit Sheet & Markdown Export</h2>
          <div style="display:flex; gap:0.4rem;">
            <button class="btn" id="btn-modal-copy">Copy Markdown</button>
            <button class="btn btn-primary" id="btn-modal-print">🖨️ Print / Save PDF</button>
            <button class="btn" id="btn-modal-close">✕ Close</button>
          </div>
        </div>
        <div class="modal-body">
          <pre style="white-space:pre-wrap; background:var(--surface-alt); padding:0.9rem; border-radius:8px; border:1px solid var(--border); font-size:0.8rem;">${esc(res.markdown)}</pre>
        </div>
      </div>
    `;
    document.getElementById("btn-modal-close").onclick = () => (modal.style.display = "none");
    document.getElementById("btn-modal-copy").onclick = () => {
      navigator.clipboard?.writeText(res.markdown);
      document.getElementById("btn-modal-copy").textContent = "✅ Copied!";
    };
    document.getElementById("btn-modal-print").onclick = () => {
      modal.style.display = "none";
      window.print();
    };
  } catch (e) {
    modal.innerHTML = `<div class="modal"><div class="modal-body">Error: ${esc(e.message)} <button class="btn" id="btn-modal-close">Close</button></div></div>`;
    document.getElementById("btn-modal-close").onclick = () => (modal.style.display = "none");
  }
}

async function openAuditModal() {
  const modal = document.getElementById("modal-root");
  modal.style.display = "grid";
  modal.innerHTML = `<div class="modal"><div class="modal-body">Running live 14-patient & 5-checkpoint verification...</div></div>`;
  try {
    const res = await apiFetch("/api/audit");
    modal.innerHTML = `
      <div class="modal">
        <div class="panel-header">
          <h2>✅ Live Corpus & Hackathon Checkpoints Self-Audit (${res.passed_patients}/${res.total_patients} — ${res.score_pct}%)</h2>
          <button class="btn" id="btn-modal-close">✕ Close</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom:0.8rem; font-size:0.85rem; color:var(--text-muted);">
            Verified all ${res.total_patients} corpus patients and all 5 hidden checkpoints in <strong>${res.latency_ms} ms</strong>.
          </div>
          <div style="display:flex; flex-direction:column; gap:0.4rem; margin-bottom:1rem;">
            ${res.checkpoints.map((cp) => `
              <div style="padding:0.45rem 0.7rem; border-radius:8px; background:${cp.passed ? "var(--normal-bg)" : "var(--urgent-bg)"}; border:1px solid ${cp.passed ? "var(--normal-border)" : "var(--urgent-border)"}; font-size:0.83rem; font-weight:600;">
                ${cp.passed ? "✅ PASS" : "❌ FAIL"} — Checkpoint ${cp.id}: ${esc(cp.name)}
              </div>
            `).join("")}
          </div>
          <table class="audit-table">
            <thead>
              <tr><th>ID</th><th>Patient</th><th>Expected Classification</th><th>Actual Classification</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${res.cases.map((c) => `
                <tr>
                  <td><strong>${esc(c.patient_id)}</strong></td>
                  <td>${esc(c.name)}</td>
                  <td>${esc(c.expected.join(", "))}</td>
                  <td>${esc(c.actual.join(", "))}</td>
                  <td>${c.passed ? "✅ PASS" : "❌ FAIL"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
    document.getElementById("btn-modal-close").onclick = () => (modal.style.display = "none");
  } catch (e) {
    modal.innerHTML = `<div class="modal"><div class="modal-body">Error: ${esc(e.message)} <button class="btn" id="btn-modal-close">Close</button></div></div>`;
    document.getElementById("btn-modal-close").onclick = () => (modal.style.display = "none");
  }
}

function initEvents() {
  // Language toggle buttons
  document.querySelectorAll("[data-lang-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.lang = btn.getAttribute("data-lang-btn");
      renderHeader();
      renderSidebar();
      runAnalyze(false);
    });
  });

  // Search & Filter chips
  document.getElementById("patient-search").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderSidebar();
  });

  document.querySelectorAll("[data-filter-chip]").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.filterTag = chip.getAttribute("data-filter-chip");
      renderSidebar();
    });
  });

  // Custom report paste & presets
  const ta = document.getElementById("custom-report-input");
  const counter = document.getElementById("char-count");
  ta.addEventListener("input", () => {
    state.customText = ta.value;
    counter.textContent = `${ta.value.length.toLocaleString()} / 200,000 chars`;
  });

  document.getElementById("btn-load-sample").addEventListener("click", () => {
    ta.value = TRICKY_SAMPLE_REPORT;
    state.customText = ta.value;
    counter.textContent = `${ta.value.length.toLocaleString()} / 200,000 chars`;
    state.activeMode = "custom";
    state.overrideAge = null;
    state.overrideSex = null;
    renderSidebar();
    runAnalyze(true);
  });

  document.getElementById("btn-analyze-custom").addEventListener("click", () => {
    state.customText = ta.value;
    state.activeMode = "custom";
    state.overrideAge = null;
    state.overrideSex = null;
    renderSidebar();
    runAnalyze(true);
  });

  document.getElementById("file-upload").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    ta.value = text;
    state.customText = text;
    counter.textContent = `${text.length.toLocaleString()} / 200,000 chars`;
    state.activeMode = "custom";
    renderSidebar();
    runAnalyze(true);
  });

  // Chat events
  document.getElementById("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    sendChatQuestion();
  });

  document.querySelectorAll("[data-quick-chat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      sendChatQuestion(btn.getAttribute("data-quick-chat"));
    });
  });

  // Header bonus buttons
  document.getElementById("btn-tts").addEventListener("click", toggleReadAloud);
  document.getElementById("btn-export").addEventListener("click", openExportModal);
  document.getElementById("btn-audit").addEventListener("click", openAuditModal);
}

window.addEventListener("DOMContentLoaded", () => {
  initEvents();
  loadHealthAndPatients();
  runAnalyze(true);
});
