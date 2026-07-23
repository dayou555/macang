/**
 * 码藏 — content script (ISOLATED world)
 * 在支持的正文页注入悬浮按钮，点击展开格式菜单，转发导出请求给 background。
 * 真正的抓取/转换在 background 注入的 MAIN world extractor 里完成。
 */
(() => {
  "use strict";
  if (window.__FX_LITE_FAB__) return;
  window.__FX_LITE_FAB__ = true;

  const FORMATS = [
    { format: "markdown", label: "导出 Markdown" },
    { format: "html", label: "导出 HTML" },
    { format: "word", label: "导出 Word" },
  ];

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          const err = chrome.runtime.lastError;
          if (err) resolve({ ok: false, error: err.message || String(err) });
          else resolve(res);
        });
      } catch (e) {
        // 扩展被重载后，旧 content script 的 runtime 会失效，需刷新页面
        resolve({ ok: false, error: "扩展上下文已失效，请刷新本页后再试。" });
      }
    });
  }

  function build() {
    const root = document.createElement("div");
    root.className = "fxlite-fab";

    const ball = document.createElement("button");
    ball.className = "fxlite-ball";
    ball.title = "码藏：导出当前页（飞书 / 生财有术 / X）";
    ball.textContent = "藏";

    const menu = document.createElement("div");
    menu.className = "fxlite-menu";

    FORMATS.forEach((f) => {
      const item = document.createElement("button");
      item.className = "fxlite-item";
      item.textContent = f.label;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        runExport(f.format, item);
      });
      menu.appendChild(item);
    });

    const toast = document.createElement("div");
    toast.className = "fxlite-toast";

    ball.addEventListener("click", (e) => {
      e.stopPropagation();
      root.classList.toggle("open");
    });
    document.addEventListener("click", () => root.classList.remove("open"));

    root.append(menu, ball, toast);
    document.body.appendChild(root);
    return { root, toast };
  }

  let ui;
  function showToast(text, kind) {
    if (!ui) return;
    ui.toast.textContent = text;
    ui.toast.className = "fxlite-toast show" + (kind ? " " + kind : "");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (ui.toast.className = "fxlite-toast"), 3200);
  }

  async function runExport(format, item) {
    const old = item.textContent;
    item.textContent = "导出中…";
    item.disabled = true;
    try {
      const res = await send({ type: "FX_EXPORT", format, options: {} });
      if (res && res.ok) {
        // content script 有 DOM，用 Blob 触发下载（绕开 SW 的 data URL 大小限制）
        const blob = new Blob([res.text], { type: res.mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        showToast(`已导出：${res.filename}`, "ok");
      } else {
        showToast((res && res.error) || "导出失败", "err");
      }
    } catch (e) {
      showToast(String(e && e.message), "err");
    } finally {
      item.textContent = old;
      item.disabled = false;
      ui.root.classList.remove("open");
    }
  }

  // 飞书是 SPA，body 可能晚于 content script 就绪；确保挂载
  function mount() {
    if (!document.body) return setTimeout(mount, 300);
    ui = build();
  }
  mount();
})();
