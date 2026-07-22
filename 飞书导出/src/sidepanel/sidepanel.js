/* 飞书导出 — 侧边栏主界面（飞书 / 生财有术 / X 长文） */

const $ = (id) => document.getElementById(id);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const send = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));

const state = {
  format: "markdown",
  inlineImages: true,
  busy: false,
  isDoc: false,
  canTransfer: false,
  tabId: null,
  siteLabel: "",
};

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function renderFormat() {
  $$(".fmt").forEach((el) => el.classList.toggle("active", el.dataset.format === state.format));
}

function cleanTitle(t) {
  return String(t || "")
    .replace(/\s*[-|]\s*(飞书云文档|飞书|Feishu Docs?|Lark Docs?|Lark|X|Twitter)\s*$/i, "")
    .trim();
}

// ---- 检测当前标签是否可导出 ----
async function detect() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch (e) {
    /* ignore */
  }
  const url = (tab && tab.url) || "";
  const site = (globalThis.FX_SITES && globalThis.FX_SITES.matchPage(url)) || null;
  const isDoc = !!(site && site.canExport);
  state.isDoc = isDoc;
  state.canTransfer = !!(site && site.canTransfer);
  state.tabId = tab && tab.id ? tab.id : null;
  state.siteLabel = (site && site.label) || "";

  $("detectIdle").style.display = isDoc ? "none" : "block";
  $("detectOk").style.display = isDoc ? "block" : "none";
  if (isDoc) {
    $("docTitle").textContent = cleanTitle(tab.title) || "（未命名）";
    const okTitle = $("detectOkTitle");
    if (okTitle) okTitle.textContent = "已识别" + (site.label || "页面");
  }

  const tag = $("tag");
  if (isDoc) {
    tag.textContent = "已就绪";
    tag.className = "tag ok";
  } else if (site && !site.canExport) {
    tag.textContent = "非正文页";
    tag.className = "tag";
  } else {
    tag.textContent = "未识别";
    tag.className = "tag";
  }

  $("export").disabled = !isDoc;
  $("transfer").disabled = !isDoc || !state.canTransfer;
}

// ---- 下载 ----
function downloadBlob(text, mime, filename) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 12000);
}

// ---- 导出前再解析一次当前标签，避免 tabId 过期或焦点漂移 ----
async function resolveExportTabId() {
  await detect();
  if (state.tabId) return state.tabId;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id) return tab.id;
  } catch (e) {
    /* ignore */
  }
  return null;
}

// ---- 导出 ----
async function onExport() {
  if (state.busy) return;
  const tabId = await resolveExportTabId();
  if (!state.isDoc || !tabId) {
    setStatus("请先打开生财有术帖子 / 飞书文档 / X 长文正文页", "err");
    return;
  }
  state.busy = true;
  $("export").disabled = true;
  setStatus("正在导出…", "");
  try {
    const res = await send({
      type: "FX_EXPORT",
      format: state.format,
      options: { inlineImages: state.inlineImages },
      tabId,
    });
    if (res && res.ok) {
      if (res.pdf) {
        setStatus(`已导出 PDF：${res.filename}`, "ok");
      } else {
        downloadBlob(res.text, res.mime, res.filename);
        const img = res.stats && res.stats.images;
        setStatus(`已导出：${res.filename}${img ? `，图片 ${img.inlined} 张` : ""}`, "ok");
      }
    } else {
      setStatus((res && res.error) || "导出失败", "err");
    }
  } catch (e) {
    setStatus(String(e && e.message), "err");
  } finally {
    state.busy = false;
    $("export").disabled = !state.isDoc;
  }
}

// ---- 转存到飞书 ----
async function onTransfer() {
  if (state.busy) return;
  const tabId = await resolveExportTabId();
  if (!state.isDoc || !state.canTransfer || !tabId) {
    setStatus("请先打开可转存的正文页", "err");
    return;
  }
  state.busy = true;
  $("transfer").disabled = true;
  setStatus("正在转存到飞书…（建文档 + 写块）", "");
  try {
    const res = await send({ type: "FX_TRANSFER", tabId });
    if (res && res.ok) {
      setStatus(`转存成功（${res.blocks} 块），正在打开…`, "ok");
      chrome.tabs.create({ url: res.url });
    } else if (res && res.error === "NO_CREDS") {
      chrome.runtime.openOptionsPage();
      setStatus("请先在设置页填写飞书应用 App ID / Secret", "err");
    } else {
      setStatus((res && res.error) || "转存失败", "err");
    }
  } catch (e) {
    setStatus(String(e && e.message), "err");
  } finally {
    state.busy = false;
    $("transfer").disabled = !state.isDoc || !state.canTransfer;
  }
}

// ---- 初始化 ----
async function init() {
  const r = await send({ type: "FX_GET_PREFS" });
  if (r && r.ok) {
    state.format = r.prefs.format || "markdown";
    state.inlineImages = r.prefs.inlineImages !== false;
  }
  $("inlineImages").checked = state.inlineImages;
  renderFormat();

  $$(".fmt").forEach((el) =>
    el.addEventListener("click", async () => {
      state.format = el.dataset.format;
      renderFormat();
      await send({ type: "FX_SET_PREFS", prefs: { format: state.format } });
    })
  );
  $("inlineImages").addEventListener("change", async (e) => {
    state.inlineImages = e.target.checked;
    await send({ type: "FX_SET_PREFS", prefs: { inlineImages: state.inlineImages } });
  });

  $("export").addEventListener("click", onExport);
  $("transfer").addEventListener("click", onTransfer);
  $("redetect").addEventListener("click", detect);
  $("gear").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("batch").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/batch/batch.html") }));
  $("history").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/history/history.html") }));

  chrome.tabs.onActivated.addListener(detect);
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.status === "complete" || info.title) detect();
  });
  detect();
}

document.addEventListener("DOMContentLoaded", init);
