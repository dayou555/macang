/**
 * 码藏 — Service Worker (background)
 * ----------------------------------------------------------------------------
 * 支持：飞书文档 / 生财有术 / X 长文与帖子
 * 消息协议（runtime.sendMessage）：
 *   { type: "FX_EXPORT", format, options, tabId? }  → { ok, filename } | { ok:false, error }
 *   { type: "FX_INSPECT", tabId? }                  → { ok, report } | { ok:false, error }
 *   { type: "FX_GET_PREFS" } / { type:"FX_SET_PREFS", prefs }
 */

// ---------------------------------------------------------------------------
// 站点识别（内联，避免 importScripts 路径导致 SW 加载失败）
// ---------------------------------------------------------------------------
function matchPage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return null;
  }
  const host = (u.hostname || "").toLowerCase();
  const path = u.pathname || "";

  if (/(^|\.)(feishu\.cn|feishu\.net|feishu-pre\.net|larkoffice\.com|larksuite\.com|larkenterprise\.com)$/i.test(host)) {
    if (/\/(docx|docs|wiki|doc)\b/i.test(path)) {
      return { id: "feishu", label: "飞书文档", canExport: true };
    }
    return { id: "feishu-other", label: "飞书页面", canExport: false };
  }
  // 生财有术（含 www / 子域）
  if (/(^|\.)(scys\.com|shengcaiyoushu\.com)$/i.test(host)) {
    return { id: "scys", label: "生财有术", canExport: true };
  }
  // X / Twitter
  if (/(^|\.)(x\.com|twitter\.com)$/i.test(host)) {
    if (/\/i\/article\//i.test(path) || /\/articles?\//i.test(path) || /\/[^/]+\/article\//i.test(path) || /\/status\/\d+/i.test(path)) {
      return { id: "x", label: "X", canExport: true };
    }
    return { id: "x-other", label: "X", canExport: false };
  }
  return null;
}

function isExportableUrl(url) {
  const s = matchPage(url);
  return !!(s && s.canExport);
}

/** @deprecated 名称保留：实际为「是否可导出 URL」 */
const FEISHU_HOST_RE = {
  test(url) {
    return isExportableUrl(url);
  },
};

const EXTRACTOR_FILE = "src/injected/extractor.js";
const DEFAULT_PREFS = { format: "markdown", inlineImages: true };

// 点击工具栏图标 → 打开侧边栏（替代 popup，作为主界面）
try {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
} catch (e) {
  /* 旧版 Chrome 无 sidePanel */
}

// ---------------------------------------------------------------------------
// 偏好存取
// ---------------------------------------------------------------------------
async function getPrefs() {
  const stored = await chrome.storage.local.get("prefs");
  return { ...DEFAULT_PREFS, ...(stored.prefs || {}) };
}

async function setPrefs(patch) {
  const next = { ...(await getPrefs()), ...patch };
  await chrome.storage.local.set({ prefs: next });
  return next;
}

// ---------------------------------------------------------------------------
// 导出历史（元数据，存 storage.local，封顶 100 条）
// ---------------------------------------------------------------------------
async function recordHistory(rec) {
  try {
    const { fx_history } = await chrome.storage.local.get("fx_history");
    const list = Array.isArray(fx_history) ? fx_history : [];
    list.unshift(rec);
    await chrome.storage.local.set({ fx_history: list.slice(0, 100) });
  } catch (e) {
    /* 历史记录失败不影响导出主流程 */
  }
}

// ---------------------------------------------------------------------------
// 取目标标签页
// ---------------------------------------------------------------------------
async function resolveTab(tabId) {
  if (tabId) {
    try {
      return await chrome.tabs.get(tabId);
    } catch (e) {
      /* tab 可能已关，继续回退 */
    }
  }
  // Service Worker 无 window 上下文，currentWindow 不稳定；优先 lastFocusedWindow
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    const all = await chrome.tabs.query({ active: true });
    tab = all && all[0];
  }
  return tab;
}

// ---------------------------------------------------------------------------
// 注入 extractor 并调用其方法
// ---------------------------------------------------------------------------
async function injectExtractor(tabId) {
  // allFrames：wiki / 嵌套文档可能把编辑器放在 iframe 里
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      files: [EXTRACTOR_FILE],
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    throw new Error(msg);
  }
}

/** 在多 frame 结果中挑出成功且内容最完整的那一个 */
function pickScriptResult(results) {
  if (!results || !results.length) return null;
  let best = null;
  let bestScore = -1;
  for (const r of results) {
    const v = r && r.result;
    if (!v) continue;
    let score = 0;
    if (v.ok) score += 10000;
    if (v.text) score += Math.min(5000, String(v.text).length);
    if (Array.isArray(v.nodes)) score += v.nodes.length * 20;
    if (v.stats && v.stats.source === "model") score += 500;
    if (v.stats && v.stats.source && String(v.stats.source).indexOf("web") === 0) score += 300;
    if (v.hasPageMain || (v.report && v.report.hasPageMain)) score += 100;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

async function callRun(tabId, format, options) {
  await injectExtractor(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "MAIN",
    args: [format, options],
    func: (fmt, opts) => {
      const api = window.__FEISHU_EXPORT_LITE__;
      if (!api || typeof api.run !== "function") return null;
      return api.run(fmt, opts);
    },
  });
  return pickScriptResult(results);
}

async function callInspect(tabId) {
  await injectExtractor(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "MAIN",
    func: () => {
      const api = window.__FEISHU_EXPORT_LITE__;
      if (!api || typeof api.inspect !== "function") return null;
      return api.inspect();
    },
  });
  return pickScriptResult(results);
}

// ---------------------------------------------------------------------------
// 导出主流程
// ---------------------------------------------------------------------------
// 注意：下载不在 background 做。Service Worker 无 URL.createObjectURL，而 data: URL
// 下载对大文件（内嵌图片的 MD/HTML 可达数 MB）会失败。这里只负责提取并返回内容，
// 由调用方（popup / content）用 Blob + <a download> 触发下载，任意大小都稳。
async function handleExport(format, options, tabId) {
  const tab = await resolveTab(tabId);
  if (!tab || !tab.id) return { ok: false, error: "未找到当前标签页。请先点一下生财/飞书/X 页面再导出。" };
  const pageUrl = tab.url || "";
  const site = matchPage(pageUrl);
  if (!site || !site.canExport) {
    return {
      ok: false,
      error:
        "当前标签不可导出：" +
        (site ? site.label + "（非正文页）" : "未识别的站点") +
        "。url=" +
        (pageUrl.slice(0, 120) || "(空)") +
        "。请切到正文页后点「重新检测」。",
    };
  }

  let result;
  try {
    result = await callRun(tab.id, format, options || {});
  } catch (e) {
    const msg = String((e && e.message) || e);
    // 常见：更新扩展后未批准 host 权限，或未刷新目标页
    if (/Cannot access|permission|扩展没有|host/i.test(msg)) {
      return {
        ok: false,
        error:
          "无法访问该页面（权限或页面未刷新）。请到 chrome://extensions 确认本扩展已允许访问 scys.com / x.com，然后刷新目标页再试。详情：" +
          msg,
      };
    }
    return { ok: false, error: "导出注入失败：" + msg };
  }
  if (!result) return { ok: false, error: "注入脚本无返回（页面可能尚未加载完成，请刷新后重试）。" };
  if (!result.ok) return { ok: false, error: result.error || "导出失败。" };

  const safeName =
    (result.title || "飞书文档").replace(/[\\/:*?"<>|\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "飞书文档";

  // PDF：用 CDP 静默 printToPDF 直接下载（不弹打印对话框，文件名用文档标题）
  if (result.print) {
    const filename = `${safeName}.pdf`;
    try {
      await exportPdf(result.text, filename);
      recordHistory({ title: safeName, format, ext: "pdf", chars: (result.text || "").length, ts: Date.now() });
      return { ok: true, filename, pdf: true, stats: result.stats };
    } catch (e) {
      return { ok: false, error: "PDF 生成失败：" + String((e && e.message) || e) };
    }
  }

  const filename = `${safeName}.${result.ext}`;
  recordHistory({ title: safeName, format, ext: result.ext, chars: (result.text || "").length, ts: Date.now() });
  return { ok: true, filename, text: result.text, mime: result.mime, ext: result.ext, stats: result.stats };
}

// ---------------------------------------------------------------------------
// 静默生成 PDF：隐藏标签页渲染样式化 HTML → CDP Page.printToPDF → 下载
// ---------------------------------------------------------------------------
function dbgAttach(tabId) {
  return new Promise((resolve, reject) =>
    chrome.debugger.attach({ tabId }, "1.3", () => {
      const e = chrome.runtime.lastError;
      e ? reject(new Error(e.message)) : resolve();
    })
  );
}
function dbgDetach(tabId) {
  return new Promise((resolve) => chrome.debugger.detach({ tabId }, () => resolve()));
}
function dbgSend(tabId, method, params) {
  return new Promise((resolve, reject) =>
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (res) => {
      const e = chrome.runtime.lastError;
      e ? reject(new Error(e.message)) : resolve(res);
    })
  );
}

/** CDP printToPDF 的 base64 → blob: URL（比 data: 更兼容新版 Chrome downloads API） */
function pdfBase64ToObjectUrl(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

async function exportPdf(html, filename) {
  await chrome.storage.local.set({ fx_print: { html } });
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL("src/print/print.html"), active: false });
  let attached = false;
  let objectUrl = null;
  try {
    await waitTabComplete(tab.id, 30000);
    await delay(1000); // 等 print.js 写入文档 + 内嵌图片渲染
    await dbgAttach(tab.id);
    attached = true;
    const res = await dbgSend(tab.id, "Page.printToPDF", {
      printBackground: true,
      paperWidth: 8.27, // A4 英寸
      paperHeight: 11.69,
      marginTop: 0.4,
      marginBottom: 0.4,
      marginLeft: 0.4,
      marginRight: 0.4,
    });
    if (!res || !res.data) throw new Error("printToPDF 未返回数据");
    objectUrl = pdfBase64ToObjectUrl(res.data);
    await new Promise((resolve, reject) => {
      chrome.downloads.download({ url: objectUrl, filename, saveAs: false }, (id) => {
        const e = chrome.runtime.lastError;
        if (e) reject(new Error(e.message));
        else resolve(id);
      });
    });
  } finally {
    if (attached) await dbgDetach(tab.id);
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      /* tab 可能已关 */
    }
    if (objectUrl) {
      // 给 downloads 接管 blob URL 的时间
      setTimeout(() => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (e) {
          /* ignore */
        }
      }, 60000);
    }
  }
}
// ---------------------------------------------------------------------------
// 批量导出：在后台标签页逐篇打开 → 等加载 → 注入提取 → 关页
// ---------------------------------------------------------------------------
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitTabComplete(tabId, timeout) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(ok);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") finish(true);
    };
    const timer = setTimeout(() => finish(false), timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    // 标签页可能已经 complete（竞态：create 后极快加载完成）
    chrome.tabs.get(tabId).then((t) => {
      if (t && t.status === "complete") finish(true);
    }).catch(() => {});
  });
}

async function exportFromUrl(url, format, options) {
  if (!FEISHU_HOST_RE.test(url)) return { ok: false, error: "非支持链接，已跳过", url };
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitTabComplete(tab.id, 30000);
    await delay(2200); // 等 SPA 水合 + PageMain 块树就绪
    const result = await callRun(tab.id, format, options || {});
    if (!result) return { ok: false, error: "注入脚本无返回", url };
    if (!result.ok) return { ok: false, error: result.error || "提取失败", url };
    const safeName = (result.title || "飞书文档").replace(/[\\/:*?"<>|]/g, " ").trim() || "飞书文档";
    recordHistory({ title: safeName, format, ext: result.ext, chars: (result.text || "").length, ts: Date.now() });
    return { ok: true, url, filename: `${safeName}.${result.ext}`, text: result.text, mime: result.mime, ext: result.ext, print: !!result.print };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), url };
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      /* tab 可能已关 */
    }
  }
}

// ---------------------------------------------------------------------------
// 转存到飞书（合规路径：飞书开放平台 OpenAPI + 用户自建应用 tenant_access_token）
// ---------------------------------------------------------------------------
const OPEN = "https://open.feishu.cn/open-apis";

async function getCreds() {
  const { fx_creds } = await chrome.storage.local.get("fx_creds");
  return fx_creds || {};
}

async function getTenantToken(appId, appSecret) {
  const r = await fetch(`${OPEN}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`鉴权失败(${j.code}): ${j.msg}`);
  return j.tenant_access_token;
}

async function openapi(path, token, body, method) {
  const r = await fetch(OPEN + path, {
    method: method || "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: "Bearer " + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`飞书API(${j.code}): ${j.msg}`);
  return j.data;
}

// runs → docx text_run elements
function inlineElements(runs) {
  const els = (runs || [])
    .map((r) => {
      const content = (r.text || "").replace(/​/g, "");
      if (!content) return null;
      const st = {};
      const a = r.attrs || {};
      if (a.bold) st.bold = true;
      if (a.italic) st.italic = true;
      if (a.strike) st.strikethrough = true;
      if (a.underline) st.underline = true;
      if (a.code) st.inline_code = true;
      if (a.link) st.link = { url: encodeURIComponent(a.link === true ? "" : a.link) };
      return { text_run: { content, text_element_style: st } };
    })
    .filter(Boolean);
  return els.length ? els : [{ text_run: { content: "" } }];
}

// 块类型码（docx v1 文档块）
const HEADING_BT = { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 7: 9, 8: 10, 9: 11 };

function nodeToBlocks(node, out) {
  switch (node.kind) {
    case "heading": {
      const lv = Math.min(9, node.level || 1);
      const b = { block_type: HEADING_BT[lv] };
      b["heading" + lv] = { elements: inlineElements(node.runs) };
      out.push(b);
      break;
    }
    case "paragraph":
      out.push({ block_type: 2, text: { elements: inlineElements(node.runs) } });
      (node.children || []).forEach((c) => nodeToBlocks(c, out));
      break;
    case "bullet":
      out.push({ block_type: 12, bullet: { elements: inlineElements(node.runs) } });
      (node.children || []).forEach((c) => nodeToBlocks(c, out));
      break;
    case "ordered":
      out.push({ block_type: 13, ordered: { elements: inlineElements(node.runs) } });
      (node.children || []).forEach((c) => nodeToBlocks(c, out));
      break;
    case "todo":
      out.push({ block_type: 17, todo: { elements: inlineElements(node.runs), style: { done: !!node.checked } } });
      break;
    case "code":
      out.push({ block_type: 14, code: { elements: [{ text_run: { content: node.code || "" } }], style: { language: 1, wrap: true } } });
      break;
    case "quote":
    case "callout":
    case "group":
      // 容器：MVP 简化为拍平子块（嵌套需 descendant API）
      (node.children || []).forEach((c) => nodeToBlocks(c, out));
      break;
    case "divider":
      out.push({ block_type: 22, divider: {} });
      break;
    case "image":
      out.push({ block_type: 2, text: { elements: [{ text_run: { content: "🖼 [图片] " + (node.alt || "") } }] } });
      break;
    case "equation":
      out.push({ block_type: 2, text: { elements: [{ text_run: { content: "$$ " + (node.tex || "") + " $$" } }] } });
      break;
    case "table":
      out.push({ block_type: 2, text: { elements: [{ text_run: { content: "[表格暂未支持转存，请用导出]" } }] } });
      break;
  }
  return out;
}

function nodesToBlocks(nodes) {
  const out = [];
  (nodes || []).forEach((n) => nodeToBlocks(n, out));
  return out;
}

async function transferToFeishu(tabId, options) {
  const { app_id, app_secret } = await getCreds();
  if (!app_id || !app_secret) return { ok: false, error: "NO_CREDS" };
  const ext = await callRun(tabId, "nodes", options || {});
  if (!ext || !ext.ok) return { ok: false, error: (ext && ext.error) || "提取失败" };
  const token = await getTenantToken(app_id, app_secret);
  const doc = await openapi("/docx/v1/documents", token, { title: ext.title || "转存文档" });
  const docId = doc.document.document_id;
  const blocks = nodesToBlocks(ext.nodes);
  for (let i = 0; i < blocks.length; i += 50) {
    await openapi(`/docx/v1/documents/${docId}/blocks/${docId}/children`, token, { children: blocks.slice(i, i + 50) });
  }
  recordHistory({ title: ext.title || "转存文档", format: "feishu", ext: "docx", chars: blocks.length, ts: Date.now() });
  return { ok: true, url: `https://www.feishu.cn/docx/${docId}`, blocks: blocks.length };
}

// ---------------------------------------------------------------------------
// 消息路由
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // content script 自带 sender.tab；侧边栏应传 tabId，否则回退 lastFocused
      const tabIdFromSender = sender && sender.tab && sender.tab.id;
      const effectiveTabId = msg.tabId || tabIdFromSender;
      switch (msg && msg.type) {
        case "FX_EXPORT": {
          const prefs = await getPrefs();
          const format = msg.format || prefs.format;
          const options = { inlineImages: prefs.inlineImages, ...(msg.options || {}) };
          sendResponse(await handleExport(format, options, effectiveTabId));
          break;
        }
        case "FX_INSPECT": {
          const tab = await resolveTab(effectiveTabId);
          if (!tab || !tab.id) return sendResponse({ ok: false, error: "无标签页" });
          sendResponse({ ok: true, report: await callInspect(tab.id) });
          break;
        }
        case "FX_EXPORT_URL": {
          const prefs = await getPrefs();
          const options = { inlineImages: prefs.inlineImages, ...(msg.options || {}) };
          sendResponse(await exportFromUrl(msg.url, msg.format || prefs.format, options));
          break;
        }
        case "FX_TRANSFER": {
          const tab = await resolveTab(effectiveTabId);
          if (!tab || !tab.id) return sendResponse({ ok: false, error: "无标签页" });
          if (!FEISHU_HOST_RE.test(tab.url || "")) return sendResponse({ ok: false, error: "请在可导出的页面使用（飞书文档 / 生财有术 / X 长文）" });
          sendResponse(await transferToFeishu(tab.id, { inlineImages: false }));
          break;
        }
        case "FX_GET_CREDS": {
          const c = await getCreds();
          sendResponse({ ok: true, hasCreds: !!(c.app_id && c.app_secret), app_id: c.app_id || "" });
          break;
        }
        case "FX_TEST_CREDS": {
          const c = await getCreds();
          const appId = msg.app_id || c.app_id;
          const appSecret = msg.app_secret || c.app_secret;
          if (!appId || !appSecret) {
            sendResponse({ ok: false, error: "缺少 App ID / Secret" });
            break;
          }
          try {
            await getTenantToken(appId, appSecret);
            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: String((e && e.message) || e) });
          }
          break;
        }
        case "FX_SET_CREDS":
          await chrome.storage.local.set({ fx_creds: { app_id: msg.app_id || "", app_secret: msg.app_secret || "" } });
          sendResponse({ ok: true });
          break;
        case "FX_GET_PREFS":
          sendResponse({ ok: true, prefs: await getPrefs() });
          break;
        case "FX_SET_PREFS":
          sendResponse({ ok: true, prefs: await setPrefs(msg.prefs || {}) });
          break;
        default:
          sendResponse({ ok: false, error: "未知消息类型：" + (msg && msg.type) });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // 异步响应
});
