// Inversion · 主控制器
// 视图状态机 + BYOK 流程 + 推演协调

import {
  testApiKey,
  generateClarifyingQuestions,
  runInversion,
  estimatePathCount,
  generateMitigation,
} from "./llm.js";

const { invoke } = window.__TAURI__.core;
const { open: openExt } = window.__TAURI__?.opener || {};

// ============ 全局状态 ============

const state = {
  provider: "deepseek",
  apiKey: null, // 仅在调用期间持有
  currentView: null,
  decision: "",
  clarifyQuestions: [], // [string]
  clarifyAnswers: [], // [string]
  paths: [], // 推演结果
  mitigations: new Map(), // pathIndex -> { actions: [...] }
  decisionHash: "", // 本次推演的稳定 hash，用于 localStorage key
  currentArchiveId: null, // 当前推演在 archive 里的 id（null = 未保存）
  archive: { archive_version: 1, decisions: [] }, // 全部历史
};

// 简单的字符串哈希（不要求加密，只是用来生成 localStorage key）
function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function mitDoneKey(pathIndex, actionIndex) {
  return `mit_done_${state.decisionHash}_${pathIndex}_${actionIndex}`;
}
function isMitDone(pathIndex, actionIndex) {
  return !!localStorage.getItem(mitDoneKey(pathIndex, actionIndex));
}
function setMitDone(pathIndex, actionIndex, done) {
  const key = mitDoneKey(pathIndex, actionIndex);
  if (done) localStorage.setItem(key, new Date().toISOString());
  else localStorage.removeItem(key);
}

// ============ DOM 引用 ============

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const views = {
  setup: $("view-setup"),
  input: $("view-input"),
  clarifying: $("view-clarifying"),
  analyzing: $("view-analyzing"),
  results: $("view-results"),
  history: $("view-history"),
  checkin: $("view-checkin"),
};

// ============ 视图切换 ============

function showView(name) {
  for (const [k, el] of Object.entries(views)) {
    if (k === name) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }
  state.currentView = name;
  window.scrollTo(0, 0);
}

// ============ Toast ============

const toastEl = $("toast");
let toastTimer = null;
function toast(msg, type = "info", ms = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.remove("err");
  if (type === "err") toastEl.classList.add("err");
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

// ============ Archive 管理（本地决策档案）============

async function loadArchive() {
  try {
    const text = await invoke("load_archive");
    if (text && text.length > 0) {
      const parsed = JSON.parse(text);
      if (parsed && parsed.archive_version && Array.isArray(parsed.decisions)) {
        state.archive = parsed;
      }
    }
  } catch (e) {
    console.warn("加载档案失败:", e);
  }
  updateHistoryCount();
}

let saveDebounceTimer = null;
async function saveArchive() {
  // 防抖：300ms 内多次调用合并
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    try {
      await invoke("save_archive", { json: JSON.stringify(state.archive) });
    } catch (e) {
      console.error("保存档案失败:", e);
      toast("档案保存失败：" + e, "err");
    }
  }, 300);
}

function updateHistoryCount() {
  const el = $("historyCount");
  if (el) el.textContent = state.archive.decisions.length.toString();
}

function newArchiveId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 把当前内存中的推演保存/更新到 archive */
function persistCurrentDecision() {
  if (!state.paths || state.paths.length === 0) return;

  // 序列化 mitigations Map
  const mitObj = {};
  for (const [k, v] of state.mitigations.entries()) mitObj[k] = v;

  const record = {
    id: state.currentArchiveId || newArchiveId(),
    ts: new Date().toISOString(),
    decision: state.decision,
    clarifyQuestions: state.clarifyQuestions,
    clarifyAnswers: state.clarifyAnswers,
    decisionHash: state.decisionHash,
    paths: state.paths,
    mitigations: mitObj,
  };

  // 找现有记录或前插
  const idx = state.archive.decisions.findIndex((d) => d.id === record.id);
  if (idx >= 0) {
    record.ts = state.archive.decisions[idx].ts; // 保留原始时间
    state.archive.decisions[idx] = record;
  } else {
    state.archive.decisions.unshift(record); // 最新在前
    state.currentArchiveId = record.id;
  }
  updateHistoryCount();
  saveArchive();
}

/** 从档案恢复某条推演到当前内存 */
function restoreFromArchive(record) {
  state.decision = record.decision || "";
  state.clarifyQuestions = record.clarifyQuestions || [];
  state.clarifyAnswers = record.clarifyAnswers || [];
  state.decisionHash = record.decisionHash || simpleHash(state.decision);
  state.paths = record.paths || [];
  state.mitigations = new Map();
  if (record.mitigations) {
    for (const [k, v] of Object.entries(record.mitigations)) {
      state.mitigations.set(parseInt(k, 10), v);
    }
  }
  state.currentArchiveId = record.id;
  renderResults();
  showView("results");
}

// ============ 启动检查 ============

async function init() {
  // 1. 渲染模板库（静态数据）
  renderTemplates();

  // 2. 加载历史档案
  await loadArchive();

  // 3. 检查是否已有 key
  const hasKey = await invoke("has_api_key", { provider: state.provider }).catch(() => false);
  updateApiStatus(hasKey);
  if (hasKey) {
    showView("input");
    // 进 input view 后检查 30 天 check-in
    maybeShowCheckin();
  } else {
    showView("setup");
  }
  bindEvents();
}

function updateApiStatus(hasKey) {
  const pill = $("apiStatus");
  const text = pill.querySelector(".status-text");
  if (hasKey) {
    pill.classList.add("ok");
    pill.classList.remove("err");
    text.textContent = "已配置";
  } else {
    pill.classList.remove("ok");
    text.textContent = "未配置";
  }
}

// ============ Setup view ============

function bindSetupEvents() {
  const keyInput = $("setupKeyInput");
  const saveBtn = $("setupSaveBtn");
  const statusEl = $("setupStatus");
  const toggleBtn = $("toggleKeyVisible");

  keyInput.addEventListener("input", () => {
    const val = keyInput.value.trim();
    saveBtn.disabled = val.length < 10;
    statusEl.textContent = "";
    statusEl.className = "setup-status";
  });

  toggleBtn.addEventListener("click", () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
  });

  // provider 切换
  $$(".provider-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".provider-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.provider = btn.dataset.provider;
      const help = $("setupKeyHelp");
      if (state.provider === "claude") {
        help.innerHTML =
          'Claude (Anthropic) 支持将在 v0.2 上线。<strong>v0.1 暂时只能选 DeepSeek</strong>。';
        saveBtn.disabled = true;
      } else {
        help.innerHTML =
          '从 <a href="#" class="ext-link" data-url="https://platform.deepseek.com/api_keys">DeepSeek 控制台</a> 申请 key（每月有免费额度）';
        bindExtLinks();
        keyInput.dispatchEvent(new Event("input"));
      }
    });
  });

  saveBtn.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) return;
    saveBtn.disabled = true;
    saveBtn.textContent = "测试中…";
    statusEl.className = "setup-status";
    statusEl.textContent = "";

    // 1. 先测试
    const r = await testApiKey(state.provider, key);
    if (!r.ok) {
      statusEl.className = "setup-status err";
      statusEl.textContent = "✗ " + r.message;
      saveBtn.disabled = false;
      saveBtn.textContent = "测试并保存";
      return;
    }

    // 2. 保存到 keyring
    try {
      await invoke("save_api_key", { provider: state.provider, key });
    } catch (e) {
      statusEl.className = "setup-status err";
      statusEl.textContent = "保存失败：" + e;
      saveBtn.disabled = false;
      saveBtn.textContent = "测试并保存";
      return;
    }

    statusEl.className = "setup-status ok";
    statusEl.textContent = "✓ 已保存到系统钥匙串";
    updateApiStatus(true);

    // 3. 跳到 input
    setTimeout(() => {
      saveBtn.textContent = "测试并保存";
      saveBtn.disabled = false;
      showView("input");
    }, 800);
  });

  bindExtLinks();
}

function bindExtLinks() {
  $$(".ext-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const url = a.dataset.url;
      if (openExt && url) openExt(url).catch(() => {});
    });
  });
}

// ============ Input view ============

function bindInputEvents() {
  const decisionInput = $("decisionInput");
  const charCount = $("charCount");
  const submitBtn = $("submitBtn");
  const form = $("decisionForm");
  const MIN = 20;
  const MAX = 2000;

  const update = () => {
    const len = decisionInput.value.length;
    const ready = len >= MIN;
    charCount.textContent = ready
      ? `${len} 字 · 按 Ctrl+Enter 提交`
      : `${len} / ${MAX} · 至少 ${MIN} 字`;
    submitBtn.disabled = !ready;
  };
  decisionInput.addEventListener("input", update);
  update();

  $$(".example-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      decisionInput.value = btn.dataset.example;
      update();
      decisionInput.focus();
    });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    state.decision = decisionInput.value.trim();
    startClarify();
  });

  // 顶部 API 状态点击 -> 回 setup
  $("apiStatus").addEventListener("click", () => {
    showView("setup");
  });

  // back 按钮（clarifying / results）
  $$(".back-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target || "input";
      showView(target);
    });
  });
}

// ============ Clarify view ============

async function startClarify() {
  showView("clarifying");
  $("clarifyLoading").classList.remove("hidden");
  $("clarifyQuestions").classList.add("hidden");
  $("clarifyActions").classList.add("hidden");
  state.clarifyQuestions = [];
  state.clarifyAnswers = ["", "", ""];

  try {
    const key = await invoke("load_api_key", { provider: state.provider });
    if (!key) {
      toast("API key 不在，请重新配置", "err");
      showView("setup");
      return;
    }
    state.apiKey = key;

    const questions = await generateClarifyingQuestions(state.provider, key, state.decision);
    state.clarifyQuestions = questions;
    renderClarifyQuestions();
  } catch (e) {
    toast("生成澄清问题失败：" + (e.message || e), "err", 5000);
    $("clarifyLoading").innerHTML =
      '<div style="color: var(--accent-red);">✗ 生成失败。点"改决策"重试。</div>';
  }
}

function renderClarifyQuestions() {
  const container = $("clarifyQuestions");
  const loading = $("clarifyLoading");
  const actions = $("clarifyActions");

  loading.classList.add("hidden");
  container.classList.remove("hidden");
  actions.classList.remove("hidden");

  container.innerHTML = "";
  state.clarifyQuestions.forEach((q, i) => {
    const div = document.createElement("div");
    div.className = "clarify-q";
    div.innerHTML = `
      <div class="clarify-q-num">问题 ${i + 1} / 3</div>
      <div class="clarify-q-text"></div>
      <textarea class="clarify-q-input" data-idx="${i}" rows="2" placeholder="一句话回答即可…"></textarea>
    `;
    div.querySelector(".clarify-q-text").textContent = q;
    container.appendChild(div);
  });

  // 监听输入更新按钮
  const startBtn = $("startAnalyzeBtn");
  const skipBtn = $("skipClarifyBtn");
  const checkReady = () => {
    const allAnswered = state.clarifyAnswers.every((a) => a.trim().length >= 2);
    startBtn.disabled = !allAnswered;
  };
  $$(".clarify-q-input").forEach((ta) => {
    ta.addEventListener("input", () => {
      const idx = parseInt(ta.dataset.idx, 10);
      state.clarifyAnswers[idx] = ta.value;
      checkReady();
    });
  });

  startBtn.onclick = () => startAnalyze(false);
  skipBtn.onclick = () => {
    if (confirm("跳过澄清会让推演质量明显下降。继续吗？")) startAnalyze(true);
  };

  checkReady();
}

// ============ Analyzing view ============

async function startAnalyze(skipped) {
  showView("analyzing");
  const statusEl = $("analyzingStatus");
  const previewEl = $("streamingPreview");
  statusEl.textContent = "AI 正在分析你的处境…";
  previewEl.textContent = "";

  const clarifications = skipped
    ? []
    : state.clarifyQuestions.map((q, i) => ({ q, a: state.clarifyAnswers[i].trim() }));

  try {
    const startAt = Date.now();
    let firstByteSeen = false;

    const result = await runInversion(
      state.provider,
      state.apiKey,
      state.decision,
      clarifications,
      (text) => {
        if (!firstByteSeen) {
          firstByteSeen = true;
          statusEl.textContent = "AI 开始输出路径…";
        }
        const n = estimatePathCount(text);
        previewEl.textContent = `已生成 ${n} 条 · ${Math.round((Date.now() - startAt) / 1000)}s`;
      }
    );

    state.paths = result.paths;
    state.mitigations = new Map();
    state.decisionHash = simpleHash(state.decision + "|" + state.clarifyAnswers.join("|"));
    state.currentArchiveId = null; // 新推演，等会儿 persistCurrentDecision 会生成 id
    persistCurrentDecision();
    renderResults();
    showView("results");
  } catch (e) {
    toast("推演失败：" + (e.message || e), "err", 5000);
    statusEl.textContent = "✗ 推演失败";
    previewEl.innerHTML =
      '<button class="btn-secondary" style="margin-top: 12px;" id="retryAnalyze">重试</button>';
    $("retryAnalyze").onclick = () => startAnalyze(skipped);
  }
}

// ============ Results view ============

function renderResults() {
  const paths = state.paths;
  const fatalN = paths.filter((p) => p.severity === "致命").length;
  const watchN = paths.filter((p) => p.severity === "警惕").length;
  const noticeN = paths.filter((p) => p.severity === "留意").length;

  $("resultsSummary").innerHTML = `
    <div class="summary-stat fatal"><div class="num">${fatalN}</div><div class="label">致命</div></div>
    <div class="summary-stat watch"><div class="num">${watchN}</div><div class="label">警惕</div></div>
    <div class="summary-stat notice"><div class="num">${noticeN}</div><div class="label">留意</div></div>
    <div class="summary-stat"><div class="num">${paths.length}</div><div class="label">总条</div></div>
  `;

  const sevClass = { 致命: "fatal", 警惕: "watch", 留意: "notice" };
  const list = $("resultsList");
  list.innerHTML = "";
  paths.forEach((p, idx) => {
    const pathIndex = p.index || idx + 1;
    const card = document.createElement("div");
    card.className = "result-card " + (sevClass[p.severity] || "notice");
    card.dataset.severity = p.severity;
    card.dataset.pathIndex = pathIndex;
    card.innerHTML = `
      <div class="result-head">
        <span class="result-tag"></span>
        <span class="result-severity ${sevClass[p.severity] || "notice"}"></span>
        <span class="result-index"></span>
      </div>
      <div class="result-title"></div>
      <div class="result-causal"></div>
      <div class="result-mitigation"></div>
    `;
    card.querySelector(".result-tag").textContent = p.category || "未分类";
    card.querySelector(".result-severity").textContent = p.severity || "?";
    card.querySelector(".result-index").textContent = `#${pathIndex}`;
    card.querySelector(".result-title").textContent = p.title || "(无标题)";
    card.querySelector(".result-causal").textContent = p.causal_chain || "";

    // 卡片整体点击展开/收起（避免点到内部按钮也触发）
    card.addEventListener("click", (e) => {
      if (e.target.closest(".mit-action, .mit-trigger, .mit-checkbox-wrap, .mit-retry"))
        return;
      card.classList.toggle("expanded");
      if (card.classList.contains("expanded")) {
        renderMitigationArea(card, p, pathIndex);
      }
    });

    list.appendChild(card);
  });

  // 过滤器
  $$(".filter-btn").forEach((btn) => {
    btn.onclick = () => {
      $$(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.dataset.filter;
      $$(".result-card").forEach((c) => {
        if (filter === "all" || c.dataset.severity === filter) {
          c.classList.remove("hidden");
        } else {
          c.classList.add("hidden");
        }
      });
    };
  });
}

// ============ 避险清单 ============

function renderMitigationArea(card, path, pathIndex) {
  const area = card.querySelector(".result-mitigation");
  const cached = state.mitigations.get(pathIndex);

  if (cached && Array.isArray(cached.actions) && cached.actions.length > 0) {
    renderMitigationList(area, pathIndex, cached.actions);
    return;
  }

  if (area.dataset.state === "loading") return; // 正在生成中，不重渲

  // 留意级别不显示按钮（PRD：只对致命/警惕推荐生成）
  if (path.severity === "留意") {
    area.innerHTML = `
      <div class="mit-hint">这条是"留意"级别——通常不需要立刻避险。可点下方按钮强制生成。</div>
      <button class="mit-trigger" data-force="1">仍然生成避险清单</button>
    `;
  } else {
    area.innerHTML = `
      <div class="mit-hint">本周做点什么能降低这条失败的概率？</div>
      <button class="mit-trigger">生成本周可执行的避险清单 →</button>
    `;
  }

  const triggerBtn = area.querySelector(".mit-trigger");
  triggerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    triggerMitigation(area, path, pathIndex);
  });
}

async function triggerMitigation(area, path, pathIndex) {
  area.dataset.state = "loading";
  area.innerHTML = `
    <div class="mit-loading">
      <div class="loading-dots"><span></span><span></span><span></span></div>
      <span>AI 正在为这条生成本周可执行的避险动作…</span>
    </div>
  `;

  try {
    const key = state.apiKey || (await invoke("load_api_key", { provider: state.provider }));
    if (!key) {
      throw new Error("API key 丢失，请回 setup 页重新配置");
    }
    state.apiKey = key;

    const clarifications = state.clarifyQuestions.map((q, i) => ({
      q,
      a: (state.clarifyAnswers[i] || "").trim(),
    }));

    const result = await generateMitigation(
      state.provider,
      key,
      state.decision,
      clarifications,
      path
    );
    state.mitigations.set(pathIndex, result);
    area.dataset.state = "done";
    persistCurrentDecision(); // 避险生成后落盘
    renderMitigationList(area, pathIndex, result.actions);
  } catch (e) {
    area.dataset.state = "error";
    area.innerHTML = `
      <div class="mit-error">✗ 生成失败：${(e.message || e).toString().slice(0, 200)}</div>
      <button class="mit-retry">重试</button>
    `;
    area.querySelector(".mit-retry").addEventListener("click", (ev) => {
      ev.stopPropagation();
      triggerMitigation(area, path, pathIndex);
    });
  }
}

function renderMitigationList(area, pathIndex, actions) {
  const list = actions
    .map((a, i) => {
      const done = isMitDone(pathIndex, i);
      return `
        <div class="mit-action ${done ? "done" : ""}" data-action-idx="${i}">
          <label class="mit-checkbox-wrap">
            <input type="checkbox" class="mit-checkbox" ${done ? "checked" : ""} />
            <span class="mit-num">${a.index || i + 1}</span>
            <div class="mit-body">
              <div class="mit-title"></div>
              <div class="mit-detail"></div>
            </div>
          </label>
        </div>
      `;
    })
    .join("");

  area.innerHTML = `
    <div class="mit-header">本周可执行的 ${actions.length} 条避险动作</div>
    <div class="mit-list">${list}</div>
    <button class="mit-regenerate" title="不满意？重新生成">↻ 重新生成</button>
  `;

  // 填充文本（避免 innerHTML 注入）
  const actionEls = area.querySelectorAll(".mit-action");
  actionEls.forEach((el, i) => {
    el.querySelector(".mit-title").textContent = actions[i].title || "(无标题)";
    el.querySelector(".mit-detail").textContent = actions[i].detail || "";
  });

  // 勾选事件
  area.querySelectorAll(".mit-checkbox").forEach((cb) => {
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      const actionEl = cb.closest(".mit-action");
      const actionIdx = parseInt(actionEl.dataset.actionIdx, 10);
      setMitDone(pathIndex, actionIdx, cb.checked);
      actionEl.classList.toggle("done", cb.checked);
      // 勾选状态本身用 localStorage 持久化（带 decisionHash），档案文件不存这个
    });
  });

  // 重新生成
  const regen = area.querySelector(".mit-regenerate");
  if (regen) {
    regen.addEventListener("click", (e) => {
      e.stopPropagation();
      state.mitigations.delete(pathIndex);
      const card = area.closest(".result-card");
      // 通过 pathIndex 找 path：优先匹配 .index 字段，否则用数组位置
      const path =
        state.paths.find((p) => p.index === pathIndex) ||
        state.paths[pathIndex - 1];
      if (!path) return;
      area.dataset.state = "";
      triggerMitigation(area, path, pathIndex);
    });
  }
}

// ============ 30 天 Check-in ============

const CHECKIN_AFTER_DAYS = 30;
const CHECKIN_SNOOZE_KEY = "checkin_snooze_until";

let pendingCheckinRecord = null; // 当前等待回访的记录

function daysSince(isoString) {
  const then = new Date(isoString).getTime();
  return Math.floor((Date.now() - then) / (24 * 3600 * 1000));
}

/** 找出需要 check-in 的最早一条 */
function findPendingCheckin() {
  const decisions = state.archive.decisions || [];
  // 候选：≥30 天前 且 没有 checkin 字段（或字段为空）
  for (const d of decisions.slice().reverse()) {
    // reverse 因为 unshift 时新的在前
    if (!d.ts) continue;
    if (daysSince(d.ts) < CHECKIN_AFTER_DAYS) continue;
    if (d.checkin && d.checkin.completedAt) continue;
    return d;
  }
  return null;
}

function shouldShowCheckinBanner(record) {
  if (!record) return false;
  // snooze 检查
  const snoozeUntil = parseInt(localStorage.getItem(CHECKIN_SNOOZE_KEY) || "0", 10);
  if (Date.now() < snoozeUntil) return false;
  return true;
}

function showCheckinBanner(record) {
  pendingCheckinRecord = record;
  const banner = $("checkinBanner");
  const hint = $("checkinBannerHint");
  const days = daysSince(record.ts);
  const preview = (record.decision || "").slice(0, 50);
  hint.textContent = `${days} 天前的「${preview}${(record.decision || "").length > 50 ? "…" : ""}」`;
  banner.classList.remove("hidden");
}

function hideCheckinBanner() {
  $("checkinBanner").classList.add("hidden");
}

function maybeShowCheckin() {
  const rec = findPendingCheckin();
  if (rec && shouldShowCheckinBanner(rec)) {
    showCheckinBanner(rec);
  } else {
    hideCheckinBanner();
  }
}

function bindCheckinEvents() {
  // 横幅按钮
  $("checkinSnoozeBtn").addEventListener("click", () => {
    // snooze 7 天
    const until = Date.now() + 7 * 24 * 3600 * 1000;
    localStorage.setItem(CHECKIN_SNOOZE_KEY, until.toString());
    hideCheckinBanner();
    toast("已推迟 7 天再问。", "info");
  });
  $("checkinOpenBtn").addEventListener("click", () => {
    if (!pendingCheckinRecord) return;
    openCheckinView(pendingCheckinRecord);
  });

  // Check-in view 按钮
  $("checkinCancelBtn").addEventListener("click", () => showView("input"));
  $("checkinSaveBtn").addEventListener("click", saveCheckin);
}

function openCheckinView(record) {
  pendingCheckinRecord = record;
  const days = daysSince(record.ts);
  const ts = new Date(record.ts);
  const tsStr = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;

  $("checkinDaysAgo").textContent = `${days} 天前`;
  $("checkinTs").textContent = tsStr;
  $("checkinDecision").textContent = record.decision || "(空)";
  $("checkinIntro").textContent = `${days} 天前你做了一次推演。现在回头看：当时 AI 列出的致命路径，有哪些真的发生了？这份回访会沉淀到你的决策档案里。`;

  // 列出致命路径
  const fatalPaths = (record.paths || []).filter((p) => p.severity === "致命");
  const pathsEl = $("checkinPaths");
  pathsEl.innerHTML = "";

  // 恢复已有的 checkin 数据（如果是重新打开）
  const existingStatus = (record.checkin && record.checkin.pathStatus) || {};

  fatalPaths.forEach((p) => {
    const pathIndex = p.index;
    const currStatus = existingStatus[pathIndex];
    const card = document.createElement("div");
    card.className = "checkin-path";
    card.dataset.pathIndex = pathIndex;
    card.innerHTML = `
      <div class="checkin-path-title"></div>
      <div class="checkin-path-status-row">
        <button class="checkin-status-btn happened" data-status="happened">✓ 真的发生了</button>
        <button class="checkin-status-btn avoided" data-status="avoided">○ 没发生</button>
        <button class="checkin-status-btn uncertain" data-status="uncertain">⏳ 还在路上</button>
      </div>
    `;
    card.querySelector(".checkin-path-title").textContent = `${p.index}. ${p.title || "(无标题)"}`;
    if (currStatus) {
      const btn = card.querySelector(`.checkin-status-btn[data-status="${currStatus}"]`);
      if (btn) btn.classList.add("active");
    }
    card.querySelectorAll(".checkin-status-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        card.querySelectorAll(".checkin-status-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    pathsEl.appendChild(card);
  });

  // notes
  $("checkinNotes").value = (record.checkin && record.checkin.notes) || "";

  hideCheckinBanner();
  showView("checkin");
}

function saveCheckin() {
  if (!pendingCheckinRecord) return;

  // 收集每条路径的状态
  const pathStatus = {};
  $$("#checkinPaths .checkin-path").forEach((card) => {
    const idx = parseInt(card.dataset.pathIndex, 10);
    const active = card.querySelector(".checkin-status-btn.active");
    if (active) pathStatus[idx] = active.dataset.status;
  });

  const notes = $("checkinNotes").value.trim();

  // 找到 archive 里的那条记录，更新 checkin 字段
  const target = state.archive.decisions.find((d) => d.id === pendingCheckinRecord.id);
  if (target) {
    target.checkin = {
      completedAt: new Date().toISOString(),
      pathStatus,
      notes,
    };
    saveArchive();
  }

  pendingCheckinRecord = null;
  toast("回访已保存到档案。", "info");
  showView("input");

  // 再检查有没有下一条等回访的
  setTimeout(maybeShowCheckin, 500);
}

// ============ 决策模板库 ============

const TEMPLATES = [
  {
    id: "quit-startup",
    icon: "🚪",
    name: "辞职创业",
    desc: "全职/合伙做产品、开店、做内容…",
    text: `我 [年龄] 岁，目前在 [城市] 做 [职业]，月薪 [金额]。
想辞职去做 [创业方向]，启动资金需要 [金额]，我个人出 [金额]。
当前家庭：[配偶状态] [孩子情况] [住房情况]。
最大顾虑：[一句话写出来]。`,
  },
  {
    id: "job-hop",
    icon: "🦘",
    name: "跳槽（同行业）",
    desc: "换公司不换方向",
    text: `我想从 [现公司类型] 跳到 [新公司类型]，岗位是 [岗位名]。
月薪 [现] → [新]，期权/股票 [情况]。
工作年限 [N] 年，目前 [城市]。
新公司给了什么/没给什么明确写在 offer 里：[列出]。
最大顾虑：[一句话]。`,
  },
  {
    id: "career-switch",
    icon: "🧭",
    name: "跨行业转型",
    desc: "比如学术→产品、技术→管理、行业 A→行业 B",
    text: `我目前在 [现行业] 做 [N] 年，岗位 [职位]。
想转去 [新行业] 做 [新岗位]。
转型理由：[一句话]。
已经准备了什么：[列出经历/作品/人脉]。
经济缓冲能撑 [N] 个月不工作。
家庭情况：[配偶/孩子]。`,
  },
  {
    id: "phd-decision",
    icon: "🎓",
    name: "读博 / 退博士",
    desc: "继续学位 vs 转行",
    text: `我目前 [博士第几年 / 即将申请博士]，方向 [研究方向]。
[问题 1：想退学还是想继续？]
[问题 2：拿到学位还要 N 年，机会成本是多少？]
导师关系：[融洽/紧张/糟糕]。
经济情况：[家里支持 / 自己负担]。
转行的话方向是：[具体方向]。`,
  },
  {
    id: "relocate",
    icon: "🏙️",
    name: "搬家 / 换城市",
    desc: "工作迁移、生活方式改变",
    text: `我目前在 [现城市]，做 [职业]，月薪 [金额]。
想搬到 [新城市]。
搬家理由：[一句话]。
新城市的工作/收入预期：[情况]。
家庭：[配偶意见] [孩子学校] [父母]。
住房：[现状] → [搬过去后]。`,
  },
  {
    id: "big-money",
    icon: "💰",
    name: "大额资金决策",
    desc: "买房/买车/重大投资/借贷",
    text: `我正在考虑 [买房/买车/投资 XX]，金额 [总价]。
我月入 [金额]，存款 [金额]。
准备首付/全款 [金额]，剩余 [借贷 N 万 / 月供 X / 长期 N 年]。
家庭：[配偶收入] [孩子教育支出]。
这笔钱的来源：[存款/借贷/卖资产]。`,
  },
  {
    id: "relationship",
    icon: "💔",
    name: "重大关系决策",
    desc: "结婚/离婚/分手/接父母同住",
    text: `我正在考虑 [结婚/离婚/分手/接父母同住]。
关系状态：[在一起 N 年 / 已婚 N 年 / 已有 N 个孩子]。
经济状况：我月入 [金额]，对方 [金额]。
我做这个决定的核心原因：[一句话]。
尝试过什么补救：[心理咨询/分居/沟通]。
不想这么做的顾虑：[一句话]。`,
  },
  {
    id: "education-plan",
    icon: "📚",
    name: "大额教育投入",
    desc: "出国/读 MBA/转专业/培训班",
    text: `我正在考虑 [出国留学/读 MBA/读硕士/参加 N 万的培训]，目标学校/课程 [名称]。
我目前 [年龄]，[职业]，月薪 [金额]。
学习费用 [金额]，时长 [N 月/年]。
学完后预期 [新职业方向 / 跳槽溢价]。
家庭：[配偶/孩子] 是否支持。
机会成本：这 N 年损失的工资约 [金额]。`,
  },
];

function renderTemplates() {
  const grid = $("templatesGrid");
  if (!grid) return;
  grid.innerHTML = "";
  TEMPLATES.forEach((t) => {
    const card = document.createElement("button");
    card.className = "template-card";
    card.type = "button";
    card.innerHTML = `
      <div class="template-name"><span class="icon"></span><span class="name-text"></span></div>
      <div class="template-desc"></div>
    `;
    card.querySelector(".icon").textContent = t.icon;
    card.querySelector(".name-text").textContent = t.name;
    card.querySelector(".template-desc").textContent = t.desc;
    card.addEventListener("click", (e) => {
      e.preventDefault();
      const decisionInput = $("decisionInput");
      decisionInput.value = t.text;
      decisionInput.dispatchEvent(new Event("input"));
      decisionInput.focus();
      // 自动滚到输入框
      decisionInput.scrollIntoView({ behavior: "smooth", block: "center" });
      // 收起 drawer
      const drawer = card.closest("details");
      if (drawer) drawer.open = false;
    });
    grid.appendChild(card);
  });
}

// ============ Markdown 导出 ============

function generateMarkdown() {
  const lines = [];
  const ts = new Date();
  const tsStr = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")} ${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`;

  lines.push("# Inversion 推演报告");
  lines.push("");
  lines.push(`> 生成时间：${tsStr}`);
  lines.push("> 工具：Inversion · 反演推演 App");
  lines.push("");
  lines.push("## 决策");
  lines.push("");
  lines.push("> " + (state.decision || "").replace(/\n/g, "\n> "));
  lines.push("");

  if (state.clarifyQuestions.length > 0) {
    lines.push("## 澄清问答");
    lines.push("");
    state.clarifyQuestions.forEach((q, i) => {
      const a = (state.clarifyAnswers[i] || "").trim() || "(未回答)";
      lines.push(`${i + 1}. **${q}**`);
      lines.push(`   ${a}`);
      lines.push("");
    });
  }

  const fatalN = state.paths.filter((p) => p.severity === "致命").length;
  const watchN = state.paths.filter((p) => p.severity === "警惕").length;
  const noticeN = state.paths.filter((p) => p.severity === "留意").length;

  lines.push(`## 20 条失败路径`);
  lines.push("");
  lines.push(`致命 **${fatalN}** | 警惕 **${watchN}** | 留意 **${noticeN}**`);
  lines.push("");

  // 按严重度分组
  const grouped = { 致命: [], 警惕: [], 留意: [] };
  state.paths.forEach((p) => {
    const s = p.severity || "留意";
    if (grouped[s]) grouped[s].push(p);
  });

  for (const sev of ["致命", "警惕", "留意"]) {
    if (grouped[sev].length === 0) continue;
    lines.push(`### 【${sev}】`);
    lines.push("");
    grouped[sev].forEach((p) => {
      const idx = p.index || "?";
      const cat = p.category || "未分类";
      lines.push(`#### ${idx}. ${p.title || "(无标题)"}  \`${cat}\``);
      lines.push("");
      if (p.causal_chain) lines.push(p.causal_chain);
      lines.push("");

      // 避险清单
      const mit = state.mitigations.get(p.index || -1);
      if (mit && Array.isArray(mit.actions) && mit.actions.length > 0) {
        lines.push("**避险清单**：");
        lines.push("");
        mit.actions.forEach((a, i) => {
          lines.push(`- **${a.title || "(无标题)"}**`);
          if (a.detail) lines.push(`  ${a.detail}`);
        });
        lines.push("");
      }
    });
  }

  lines.push("---");
  lines.push("");
  lines.push("*这是 AI 给出的可能失败路径，不是预测。决定权永远在你。*");
  lines.push("");
  lines.push("*Inversion App · 本地推演 · 数据不上传*");

  return lines.join("\n");
}

async function exportToClipboard() {
  const md = generateMarkdown();
  try {
    await navigator.clipboard.writeText(md);
    const btn = $("exportMdBtn");
    const orig = btn.innerHTML;
    btn.classList.add("copied");
    btn.innerHTML = "<span>✓</span><span>已复制 " + md.length + " 字</span>";
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = orig;
    }, 2000);
  } catch (e) {
    toast("复制失败：" + (e.message || e), "err");
  }
}

// ============ History view ============

async function renderHistoryView() {
  const listEl = $("historyList");
  const emptyEl = $("historyEmpty");
  const footerEl = $("historyFooter");
  const pathEl = $("archivePath");

  const decisions = state.archive.decisions || [];

  if (decisions.length === 0) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    footerEl.classList.add("hidden");
  } else {
    emptyEl.classList.add("hidden");
    footerEl.classList.remove("hidden");
    listEl.innerHTML = "";

    decisions.forEach((d) => {
      const card = document.createElement("div");
      card.className = "history-card";
      const fatalN = (d.paths || []).filter((p) => p.severity === "致命").length;
      const watchN = (d.paths || []).filter((p) => p.severity === "警惕").length;
      const noticeN = (d.paths || []).filter((p) => p.severity === "留意").length;
      const ts = new Date(d.ts);
      const tsStr = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")} ${String(ts.getHours()).padStart(2, "0")}:${String(ts.getMinutes()).padStart(2, "0")}`;
      const mitCount = d.mitigations ? Object.keys(d.mitigations).length : 0;
      card.innerHTML = `
        <div class="history-card-top">
          <span class="history-card-ts"></span>
          <div class="history-card-stats">
            <span class="stat fatal">致 <b></b></span>
            <span class="stat watch">警 <b></b></span>
            <span class="stat notice">留 <b></b></span>
            ${mitCount > 0 ? '<span class="stat" style="color: var(--accent-green);">★ 避险 ' + mitCount + '</span>' : ""}
          </div>
        </div>
        <div class="history-card-decision"></div>
      `;
      card.querySelector(".history-card-ts").textContent = tsStr;
      const stats = card.querySelectorAll(".history-card-stats .stat b");
      stats[0].textContent = fatalN;
      stats[1].textContent = watchN;
      stats[2].textContent = noticeN;
      card.querySelector(".history-card-decision").textContent = d.decision || "(空决策)";

      card.addEventListener("click", () => {
        restoreFromArchive(d);
      });
      listEl.appendChild(card);
    });
  }

  // 显示档案路径
  try {
    const p = await invoke("get_archive_path");
    pathEl.textContent = p;
    pathEl.dataset.path = p;
  } catch {
    pathEl.textContent = "(获取路径失败)";
  }
}

function bindHistoryEvents() {
  $("historyBtn").addEventListener("click", () => {
    renderHistoryView();
    showView("history");
  });

  $("openArchivePathBtn").addEventListener("click", async () => {
    const fullPath = $("archivePath").dataset.path;
    if (!fullPath) return;
    // 打开档案所在目录（不是文件本身）
    const dir = fullPath.replace(/[\\/][^\\/]+$/, "");
    if (openExt) {
      openExt(dir).catch((e) => toast("打开失败：" + e, "err"));
    }
  });
}

// ============ 全局事件绑定 ============

function bindEvents() {
  bindSetupEvents();
  bindInputEvents();
  bindHistoryEvents();
  bindCheckinEvents();
  bindGlobalShortcuts();

  // Markdown 导出按钮
  const exportBtn = $("exportMdBtn");
  if (exportBtn) exportBtn.addEventListener("click", exportToClipboard);

  // 生产模式（非 dev）下隐藏 dev banner
  // Tauri dev 时 window.__TAURI_INTERNALS__?.metadata?.currentWindow 等存在；
  // 简单判断：URL 含 1430 之类 dev port = dev 模式
  const isDev = /localhost:\d+|127\.0\.0\.1/.test(window.location.href);
  if (!isDev) {
    const banner = document.querySelector(".dev-banner");
    if (banner) banner.style.display = "none";
  }
}

// ============ 全局快捷键 ============

function bindGlobalShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Ctrl/Cmd + Enter：在 input view 提交
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      if (state.currentView === "input") {
        const submitBtn = $("submitBtn");
        if (submitBtn && !submitBtn.disabled) {
          e.preventDefault();
          submitBtn.click();
        }
      } else if (state.currentView === "clarifying") {
        const startBtn = $("startAnalyzeBtn");
        if (startBtn && !startBtn.disabled) {
          e.preventDefault();
          startBtn.click();
        }
      } else if (state.currentView === "checkin") {
        e.preventDefault();
        $("checkinSaveBtn").click();
      }
    }

    // Esc：返回 / 关闭
    if (e.key === "Escape") {
      const v = state.currentView;
      if (v === "history" || v === "checkin") {
        e.preventDefault();
        showView("input");
      } else if (v === "results") {
        // 在 results 不直接返回，避免误触丢失。Esc 在 results 收起所有展开卡片。
        const expanded = document.querySelectorAll(".result-card.expanded");
        if (expanded.length > 0) {
          e.preventDefault();
          expanded.forEach((c) => c.classList.remove("expanded"));
        }
      } else if (v === "setup") {
        // setup 时 Esc 不做事（必须先配置 key 才能走）
      }
    }

    // Ctrl/Cmd + K：打开历史档案
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      const btn = $("historyBtn");
      if (btn) btn.click();
    }
  });
}

// ============ 启动 ============

init();
