/* 码藏 — 设置页（侧边导航多分区） */

const $ = (id) => document.getElementById(id);
const send = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
const setMsg = (el, text, kind) => {
  el.textContent = text;
  el.className = "msg" + (kind ? " " + kind : "");
};

// ---- 侧边导航切换 ----
function activate(sec) {
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.sec === sec));
  document.querySelectorAll("main section").forEach((s) => s.classList.toggle("active", s.dataset.sec === sec));
}
document.querySelectorAll(".nav-item").forEach((n) => n.addEventListener("click", () => activate(n.dataset.sec)));

// ---- 通用设置：偏好（改即存） ----
async function loadPrefs() {
  const r = await send({ type: "FX_GET_PREFS" });
  if (r && r.ok) {
    $("format").value = r.prefs.format || "markdown";
    $("inlineImages").checked = r.prefs.inlineImages !== false;
  }
}
const savePrefs = () =>
  send({ type: "FX_SET_PREFS", prefs: { format: $("format").value, inlineImages: $("inlineImages").checked } });
$("format").addEventListener("change", savePrefs);
$("inlineImages").addEventListener("change", savePrefs);

// ---- 飞书配置：凭证 ----
async function loadCreds() {
  const r = await send({ type: "FX_GET_CREDS" });
  if (r && r.app_id) $("appId").value = r.app_id; // 不回显 Secret
}
$("save").addEventListener("click", async () => {
  const app_id = $("appId").value.trim();
  const app_secret = $("appSecret").value.trim();
  if (!app_id || !app_secret) return setMsg($("credMsg"), "请填写 App ID 和 App Secret", "err");
  await send({ type: "FX_SET_CREDS", app_id, app_secret });
  $("appSecret").value = "";
  setMsg($("credMsg"), "已保存 ✓", "ok");
});
$("test").addEventListener("click", async () => {
  setMsg($("credMsg"), "测试中…", "");
  const r = await send({ type: "FX_TEST_CREDS", app_id: $("appId").value.trim(), app_secret: $("appSecret").value.trim() });
  if (r && r.ok) setMsg($("credMsg"), "连接成功，凭证有效 ✓", "ok");
  else setMsg($("credMsg"), "失败：" + ((r && r.error) || "未知错误"), "err");
});
$("clearCreds").addEventListener("click", async () => {
  if (!confirm("确定清空已保存的飞书应用凭证？")) return;
  await send({ type: "FX_SET_CREDS", app_id: "", app_secret: "" });
  $("appId").value = "";
  $("appSecret").value = "";
  setMsg($("credMsg"), "已清空", "ok");
});

// ---- 功能入口 ----
const openPage = (p) => chrome.tabs.create({ url: chrome.runtime.getURL(p) });
$("goBatch").addEventListener("click", () => openPage("src/batch/batch.html"));
$("goHistory").addEventListener("click", () => openPage("src/history/history.html"));
$("goOpen").addEventListener("click", () => chrome.tabs.create({ url: "https://open.feishu.cn/app" }));

// ---- 系统 ----
$("reload").addEventListener("click", () => chrome.runtime.reload());
$("clearAll").addEventListener("click", async () => {
  if (!confirm("确定清空全部本地数据（历史 / 偏好 / 应用凭证）？此操作不可撤销。")) return;
  await chrome.storage.local.clear();
  setMsg($("sysMsg"), "已清空，正在重载…", "ok");
  setTimeout(() => chrome.runtime.reload(), 600);
});

// ---- 关于 ----
try {
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;
} catch (e) {
  /* ignore */
}

loadPrefs();
loadCreds();
