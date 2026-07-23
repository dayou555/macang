/* 码藏 — 导出历史页 */

const listEl = document.getElementById("list");
const countEl = document.getElementById("count");
const clearBtn = document.getElementById("clear");

const FORMAT_LABEL = { markdown: "MD", html: "HTML", word: "WORD", pdf: "PDF" };
const FORMAT_CLASS = { markdown: "b-md", html: "b-html", word: "b-word", pdf: "b-pdf" };

function fmtSize(chars) {
  if (!chars) return "";
  if (chars < 1024) return chars + " 字符";
  return (chars / 1024).toFixed(1) + " KB";
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function render(list) {
  countEl.textContent = list.length ? `共 ${list.length} 条` : "";
  if (!list.length) {
    listEl.innerHTML = `<div class="empty">还没有导出记录。去飞书文档导出一篇试试～</div>`;
    return;
  }
  listEl.innerHTML = "";
  list.forEach((rec) => {
    const item = document.createElement("div");
    item.className = "item";

    const badge = document.createElement("span");
    badge.className = "badge " + (FORMAT_CLASS[rec.format] || "b-other");
    badge.textContent = FORMAT_LABEL[rec.format] || (rec.ext || "?").toUpperCase();

    const meta = document.createElement("div");
    meta.className = "meta";
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = rec.title || "未命名文档";
    const s = document.createElement("div");
    s.className = "s";
    s.textContent = [fmtTime(rec.ts), fmtSize(rec.chars)].filter(Boolean).join(" · ");
    meta.append(t, s);

    item.append(badge, meta);
    listEl.appendChild(item);
  });
}

function load() {
  chrome.storage.local.get("fx_history", ({ fx_history }) => {
    render(Array.isArray(fx_history) ? fx_history : []);
  });
}

clearBtn.addEventListener("click", () => {
  if (!confirm("确定清空全部导出历史？此操作不可撤销。")) return;
  chrome.storage.local.set({ fx_history: [] }, load);
});

load();
