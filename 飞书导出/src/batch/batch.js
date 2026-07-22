/* 飞书导出 — 批量导出页 */

const $ = (id) => document.getElementById(id);

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function downloadBlob(text, mime, filename) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function parseUrls(raw) {
  const seen = new Set();
  const ok = (u) => (globalThis.FX_SITES ? globalThis.FX_SITES.isSupportedHost(u) : false);
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && ok(l))
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
}

function addItem(url) {
  const el = document.createElement("div");
  el.className = "p-item run";
  el.innerHTML = `<span class="ic">⏳</span><span class="u"></span>`;
  el.querySelector(".u").textContent = url;
  $("progress").appendChild(el);
  return el;
}

function setItem(el, status, text) {
  el.className = "p-item " + status;
  el.querySelector(".ic").textContent = status === "ok" ? "✓" : status === "err" ? "✕" : "⏳";
  if (text) el.querySelector(".u").textContent = text;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const urls = parseUrls($("urls").value);
  if (!urls.length) {
    $("summary").textContent = "没有有效的飞书链接（每行一个）。";
    return;
  }
  const format = $("format").value;
  const inlineImages = $("inlineImages").checked;

  $("start").disabled = true;
  $("progress").innerHTML = "";
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    $("summary").textContent = `进行中… ${i + 1}/${urls.length}（成功 ${ok}，失败 ${fail}）`;
    const item = addItem(url);
    try {
      const res = await send({ type: "FX_EXPORT_URL", url, format, options: { inlineImages } });
      if (res && res.ok) {
        downloadBlob(res.text, res.mime, res.filename);
        ok++;
        setItem(item, "ok", res.filename);
      } else {
        fail++;
        setItem(item, "err", `${url} — ${(res && res.error) || "失败"}`);
      }
    } catch (e) {
      fail++;
      setItem(item, "err", `${url} — ${String(e && e.message)}`);
    }
    await delay(600); // 间隔，给浏览器与下载留余地
  }

  $("summary").textContent = `完成：成功 ${ok}，失败 ${fail}，共 ${urls.length}。`;
  $("start").disabled = false;
}

$("start").addEventListener("click", start);
