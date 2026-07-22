/**
 * 飞书导出 — 注入层 (MAIN world)
 * ----------------------------------------------------------------------------
 * 由 background.js 通过 chrome.scripting.executeScript({world:"MAIN"}) 注入飞书文档页。
 *
 * 主路径（高保真）：读飞书运行时块树
 *   window.PageMain.blockManager.rootBlockModel.children  →  归一化节点树  →  Markdown / HTML / Word / PDF
 *   - 文本来自 snapshot.text（Etherpad changeset + apool 属性池），所有块都有，不受虚拟滚动影响。
 *   - 图片来自 snapshot.image.token，经 internal-api-drive-stream.* 同源带 cookie 拉取并内嵌。
 * 兜底路径：PageMain 不可用时，退化为读渲染 DOM（仅覆盖已渲染部分）。
 *
 * 入口：window.__FEISHU_EXPORT_LITE__.run(format, options) → Promise<Result>
 *   format  : "markdown" | "html" | "word" | "pdf"
 *   options : { inlineImages?: boolean, maxImageBytes?: number }
 *   字段路径基于飞书文档运行时数据结构。
 */
(() => {
  "use strict";
  const NS = "__FEISHU_EXPORT_LITE__";
  // 不做"已注入就跳过"的早退：每次注入都重新定义并覆盖 window[NS]，
  // 保证扩展更新后即使页面未刷新也运行最新代码（注入只定义函数+赋值，无副作用）。

  // ===========================================================================
  // 工具
  // ===========================================================================
  const ZW = /​/g;
  const b36 = (s) => parseInt(s, 36);

  const util = {
    escapeHtml: (s) =>
      String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    mdEsc: (s) => String(s).replace(/([\\`*])/g, "\\$1"),
    cleanTitle: (raw) =>
      String(raw || "")
        .replace(/\s*[-|]\s*(飞书云文档|飞书|Feishu Docs?|Lark Docs?|Lark)\s*$/i, "")
        .trim() || "飞书文档",
    blobToDataUrl: (blob) =>
      new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(blob);
      }),
  };

  function streamHost() {
    const h = location.hostname;
    if (/larkoffice\.com$/i.test(h)) return "internal-api-drive-stream.larkoffice.com";
    if (/larksuite\.com$/i.test(h)) return "internal-api-drive-stream-sg.larksuite.com";
    return "internal-api-drive-stream.feishu.cn";
  }
  function imageUrl(token) {
    return `https://${streamHost()}/space/api/box/stream/download/preview/${token}?mount_point=docx_file&preview_type=16`;
  }

  // ===========================================================================
  // 富文本：snapshot.text（Etherpad changeset）→ 带属性 runs
  // ===========================================================================
  function decodeAttribs(attribStr, text, apool) {
    if (!attribStr) return [{ text, attrs: {} }];
    const runs = [];
    let pos = 0;
    let pending = [];
    const re = /([*|+\-])([0-9a-z]+)/g;
    let m;
    while ((m = re.exec(attribStr))) {
      const op = m[1];
      const num = m[2];
      if (op === "*") {
        pending.push(b36(num));
      } else if (op === "+") {
        const len = b36(num);
        const chunk = text.substr(pos, len);
        pos += len;
        const attrs = {};
        pending.forEach((n) => {
          const a = apool && apool[n];
          if (!a) return;
          const k = a[0];
          const v = a[1];
          if (k === "bold") attrs.bold = true;
          else if (k === "italic") attrs.italic = true;
          else if (k === "strikethrough") attrs.strike = true;
          else if (k === "underline") attrs.underline = true;
          else if (k === "inlineCode") attrs.code = true;
          else if (k === "link") attrs.link = v || true;
          // 颜色/高亮：值非 #/rgb 形式（可能是调色板枚举）时跳过，避免产出非法 CSS（待校验枚举映射）
          else if (k === "fontcolor" && /^(#|rgb)/i.test(v)) attrs.color = v;
          else if (
            (k === "backcolor" || k === "backgroundcolor" || k === "textHighlight" || k === "textHightlightBackground") &&
            /^(#|rgb)/i.test(v)
          )
            attrs.bg = v;
        });
        runs.push({ text: chunk, attrs });
        pending = [];
      }
    }
    if (pos < text.length) runs.push({ text: text.slice(pos), attrs: {} });
    return runs;
  }

  function richText(t) {
    if (!t || !t.initialAttributedTexts) return [{ text: "", attrs: {} }];
    const iat = t.initialAttributedTexts;
    const apool = (t.apool && t.apool.numToAttrib) || {};
    const keys = Object.keys(iat.text || {}).sort((a, b) => +a - +b);
    let runs = [];
    keys.forEach((k) => {
      runs = runs.concat(decodeAttribs((iat.attribs || {})[k] || "", iat.text[k] || "", apool));
    });
    return runs;
  }

  const plain = (runs) => runs.map((r) => r.text).join("").replace(ZW, "");

  function inlinesMd(runs) {
    return runs
      .map((r) => {
        const s = r.text.replace(ZW, "");
        if (!s) return "";
        if (r.attrs.code) return "`" + s.replace(/`/g, "") + "`";
        let w = util.mdEsc(s);
        if (r.attrs.bold) w = "**" + w + "**";
        if (r.attrs.italic) w = "*" + w + "*";
        if (r.attrs.strike) w = "~~" + w + "~~";
        if (r.attrs.underline) w = "<u>" + w + "</u>"; // MD 无原生下划线，用 HTML（GFM 支持）
        if (r.attrs.link) w = "[" + w + "](" + (r.attrs.link === true ? "" : r.attrs.link) + ")";
        return w;
      })
      .join("");
  }

  function inlinesHtml(runs) {
    return runs
      .map((r) => {
        let s = util.escapeHtml(r.text.replace(ZW, ""));
        if (!s) return "";
        if (r.attrs.code) return "<code>" + s + "</code>";
        if (r.attrs.bold) s = "<strong>" + s + "</strong>";
        if (r.attrs.italic) s = "<em>" + s + "</em>";
        if (r.attrs.strike) s = "<del>" + s + "</del>";
        if (r.attrs.underline) s = "<u>" + s + "</u>";
        const style =
          (r.attrs.color ? "color:" + r.attrs.color + ";" : "") + (r.attrs.bg ? "background-color:" + r.attrs.bg + ";" : "");
        if (style) s = `<span style="${style}">${s}</span>`;
        if (r.attrs.link) s = `<a href="${util.escapeHtml(r.attrs.link === true ? "#" : r.attrs.link)}">${s}</a>`;
        return s;
      })
      .join("");
  }

  // ===========================================================================
  // 块树 → 归一化节点
  // ===========================================================================
  function nodesOf(models) {
    const out = [];
    for (const b of models || []) {
      const n = toNode(b);
      if (n) out.push(n);
    }
    return out;
  }

  function toNode(b) {
    const s = b.snapshot;
    if (!s || s.hidden) return null;
    const type = s.type;
    const kids = Array.isArray(b.children) ? b.children : [];
    const hm = /^heading([1-9])$/.exec(type);
    if (hm) return { kind: "heading", level: +hm[1], runs: richText(s.text) };
    switch (type) {
      case "text":
      case "paragraph":
        return { kind: "paragraph", runs: richText(s.text), children: nodesOf(kids) };
      case "bullet":
        return { kind: "bullet", runs: richText(s.text), children: nodesOf(kids) };
      case "ordered":
        return { kind: "ordered", seq: s.seq, runs: richText(s.text), children: nodesOf(kids) };
      case "todo":
        return { kind: "todo", checked: !!(s.done || s.completed), runs: richText(s.text), children: nodesOf(kids) };
      case "code":
        return { kind: "code", language: normalizeLang(s.language), code: plain(richText(s.text)) };
      case "quote_container":
        return { kind: "quote", children: nodesOf(kids) };
      case "quote":
        return { kind: "quote", children: [{ kind: "paragraph", runs: richText(s.text) }] };
      case "callout": {
        const c = nodesOf(kids);
        return { kind: "callout", children: c.length ? c : [{ kind: "paragraph", runs: richText(s.text) }] };
      }
      case "divider":
        return { kind: "divider" };
      case "equation":
        // 块级公式：尽力从 snapshot 取 LaTeX（字段待校验，取不到则退化为文本）
        return { kind: "equation", tex: (s.equation && (s.equation.content || s.equation.tex)) || plain(richText(s.text)) || "" };
      case "table":
        return tableNode(b);
      case "image":
        return { kind: "image", token: s.image && s.image.token, alt: (s.image && s.image.name) || "" };
      case "page":
      case "grid":
      case "grid_column":
        return { kind: "group", children: nodesOf(kids) };
      default:
        if (s.text) return { kind: "paragraph", runs: richText(s.text), children: nodesOf(kids) };
        if (kids.length) return { kind: "group", children: nodesOf(kids) };
        return null;
    }
  }

  // 表格：children 为按行优先排列的 table_cell 块，列数取自 snapshot（按结构推断，待校验）
  function tableNode(b) {
    const s = b.snapshot || {};
    const cells = (b.children || []).filter((c) => c && c.snapshot);
    const cellContents = cells.map((c) => nodesOf(Array.isArray(c.children) ? c.children : []));
    let cols =
      (s.columns_id && s.columns_id.length) ||
      (s.table && (s.table.column_size || (s.table.columns_id && s.table.columns_id.length) || (s.table.cols && s.table.cols.length))) ||
      (s.cols_id && s.cols_id.length) ||
      0;
    // 兜底：有行数则由 单元格数/行数 反推列数
    const rowsCount = (s.rows_id && s.rows_id.length) || (s.table && s.table.row_size) || 0;
    if (!cols && rowsCount && cellContents.length) cols = Math.round(cellContents.length / rowsCount);
    if (cols > 0 && cellContents.length) {
      const rows = [];
      for (let i = 0; i < cellContents.length; i += cols) rows.push(cellContents.slice(i, i + cols));
      return { kind: "table", rows };
    }
    // 兜底：列数未知 → 逐格段落，宁可平铺也不错位
    return { kind: "group", children: cellContents.flat() };
  }

  function normalizeLang(lang) {
    if (!lang) return "";
    const l = String(lang).toLowerCase();
    if (l === "plain text" || l === "plaintext") return "";
    return l.replace(/\s+/g, "");
  }

  // 单元格 → 单行内容
  function cellMd(cellNodes) {
    return cellNodes
      .map((n) => (n.runs ? inlinesMd(n.runs) : n.children ? cellMd(n.children) : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/\|/g, "\\|")
      .trim();
  }
  function cellHtml(cellNodes) {
    return cellNodes.map((n) => (n.runs ? inlinesHtml(n.runs) : n.children ? cellHtml(n.children) : "")).join("<br>");
  }

  // 收集图片节点（含嵌套）：飞书 token 图 + 外链 url 图
  function collectImages(nodes, acc) {
    acc = acc || [];
    nodes.forEach((n) => {
      if (n.kind === "image" && (n.token || n.url)) acc.push(n);
      if (n.children) collectImages(n.children, acc);
      if (n.rows) n.rows.forEach((r) => r.forEach((c) => collectImages(c, acc)));
    });
    return acc;
  }

  function imageSrcOf(n) {
    if (n.token) return imageUrl(n.token);
    if (n.url) {
      try {
        return new URL(n.url, location.href).href;
      } catch (e) {
        return n.url;
      }
    }
    return "";
  }

  async function resolveImages(nodes, opts) {
    const imgs = collectImages(nodes);
    const stats = { total: imgs.length, inlined: 0, skipped: 0, bytes: 0 };
    if (opts.inlineImages === false) {
      imgs.forEach((n) => {
        n.url = imageSrcOf(n);
      });
      return stats;
    }
    const maxBytes = opts.maxImageBytes ?? 8 * 1024 * 1024;
    for (const n of imgs) {
      const src = imageSrcOf(n);
      if (!src) {
        stats.skipped++;
        continue;
      }
      try {
        const resp = await fetch(src, { credentials: "include" });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const blob = await resp.blob();
        if (stats.bytes + blob.size > maxBytes) {
          n.url = src;
          stats.skipped++;
          continue;
        }
        stats.bytes += blob.size;
        n.dataUrl = await util.blobToDataUrl(blob);
        n.url = src;
        stats.inlined++;
      } catch (e) {
        n.url = src;
        n.error = String(e && e.message);
        stats.skipped++;
      }
    }
    return stats;
  }

  // ===========================================================================
  // 渲染：节点 → Markdown
  // ===========================================================================
  function mdRender(nodes, depth) {
    depth = depth || 0;
    let out = "";
    let prevList = false;
    for (const n of nodes) {
      const ind = "  ".repeat(depth);
      const isList = n.kind === "bullet" || n.kind === "ordered" || n.kind === "todo";
      if (prevList && !isList) out += "\n";
      switch (n.kind) {
        case "heading":
          out += "#".repeat(Math.min(6, n.level)) + " " + inlinesMd(n.runs).trim() + "\n\n";
          break;
        case "paragraph": {
          const t = inlinesMd(n.runs).trim();
          if (t) out += ind + t + "\n\n";
          if (n.children && n.children.length) out += mdRender(n.children, depth);
          break;
        }
        case "bullet":
          out += ind + "- " + inlinesMd(n.runs).trim() + "\n";
          if (n.children) out += mdRender(n.children, depth + 1);
          break;
        case "ordered":
          out += ind + (n.seq || "1") + ". " + inlinesMd(n.runs).trim() + "\n";
          if (n.children) out += mdRender(n.children, depth + 1);
          break;
        case "todo":
          out += ind + "- [" + (n.checked ? "x" : " ") + "] " + inlinesMd(n.runs).trim() + "\n";
          if (n.children) out += mdRender(n.children, depth + 1);
          break;
        case "code":
          out += "```" + (n.language || "") + "\n" + n.code.replace(/\n$/, "") + "\n```\n\n";
          break;
        case "quote":
        case "callout": {
          const inner = mdRender(n.children).trim();
          out += inner.split("\n").map((l) => "> " + l).join("\n") + "\n\n";
          break;
        }
        case "divider":
          out += "---\n\n";
          break;
        case "equation":
          out += "$$\n" + (n.tex || "") + "\n$$\n\n";
          break;
        case "table": {
          if (!n.rows || !n.rows.length) break;
          const cols = Math.max(...n.rows.map((r) => r.length));
          const pad = (r) => {
            const c = r.slice();
            while (c.length < cols) c.push([]);
            return c;
          };
          const head = pad(n.rows[0]).map(cellMd);
          out += `| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n`;
          n.rows.slice(1).forEach((r) => (out += `| ${pad(r).map(cellMd).join(" | ")} |\n`));
          out += "\n";
          break;
        }
        case "image": {
          const src = n.dataUrl || n.url || "feishu-image:" + n.token;
          out += "![" + (n.alt || "") + "](" + src + ")\n\n";
          break;
        }
        case "group":
          out += mdRender(n.children, depth);
          break;
      }
      prevList = isList;
    }
    return out;
  }

  // ===========================================================================
  // 渲染：节点 → HTML（连续列表项合并为 ul/ol）
  // ===========================================================================
  function htmlRender(nodes) {
    let out = "";
    let i = 0;
    const isUl = (n) => n.kind === "bullet" || n.kind === "todo";
    while (i < nodes.length) {
      const n = nodes[i];
      if (isUl(n) || n.kind === "ordered") {
        const ordered = n.kind === "ordered";
        const tag = ordered ? "ol" : "ul";
        let lis = "";
        while (i < nodes.length && (ordered ? nodes[i].kind === "ordered" : isUl(nodes[i]))) {
          lis += "<li>" + liContent(nodes[i]) + "</li>";
          i++;
        }
        out += `<${tag}>${lis}</${tag}>`;
        continue;
      }
      out += blockHtml(n);
      i++;
    }
    return out;
  }

  function liContent(n) {
    const box = n.kind === "todo" ? `<input type="checkbox" disabled ${n.checked ? "checked" : ""}> ` : "";
    const inner = n.children && n.children.length ? htmlRender(n.children) : "";
    return box + inlinesHtml(n.runs) + inner;
  }

  function blockHtml(n) {
    switch (n.kind) {
      case "heading": {
        const lv = Math.min(6, n.level);
        return `<h${lv}>${inlinesHtml(n.runs)}</h${lv}>`;
      }
      case "paragraph": {
        const t = inlinesHtml(n.runs);
        const kids = n.children && n.children.length ? htmlRender(n.children) : "";
        return (t ? `<p>${t}</p>` : "") + kids;
      }
      case "code":
        return `<pre><code>${util.escapeHtml(n.code.replace(/\n$/, ""))}</code></pre>`;
      case "quote":
      case "callout":
        return `<blockquote>${htmlRender(n.children)}</blockquote>`;
      case "divider":
        return "<hr>";
      case "equation":
        return `<p class="fx-eq">$$${util.escapeHtml(n.tex || "")}$$</p>`;
      case "table": {
        if (!n.rows || !n.rows.length) return "";
        let h = "<table>";
        n.rows.forEach((r, ri) => {
          h += "<tr>";
          r.forEach((c) => {
            const tag = ri === 0 ? "th" : "td";
            h += `<${tag}>${cellHtml(c)}</${tag}>`;
          });
          h += "</tr>";
        });
        return h + "</table>";
      }
      case "image": {
        const src = n.dataUrl || n.url || imageUrl(n.token);
        return `<p><img src="${util.escapeHtml(src)}" alt="${util.escapeHtml(n.alt || "")}"></p>`;
      }
      case "group":
        return htmlRender(n.children);
      default:
        return "";
    }
  }

  const HTML_THEME = `
  :root{color-scheme:light} body{margin:0;background:#f5f6f7}
  .fx-doc{max-width:820px;margin:32px auto;padding:48px 56px;background:#fff;border-radius:8px;
    box-shadow:0 1px 4px rgba(0,0,0,.08);color:#1f2329;
    font:16px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",Segoe UI,sans-serif}
  .fx-doc h1{font-size:1.8em;margin:.8em 0 .4em} .fx-doc h2{font-size:1.5em;margin:.8em 0 .4em}
  .fx-doc h3{font-size:1.25em} .fx-doc h4,.fx-doc h5,.fx-doc h6{font-size:1.05em}
  .fx-doc p{margin:.5em 0} .fx-doc img{max-width:100%;border-radius:4px}
  .fx-doc pre{background:#f4f5f5;border-radius:6px;padding:14px 16px;overflow:auto}
  .fx-doc code{background:#f4f5f5;border-radius:3px;padding:.1em .3em;font-size:.92em}
  .fx-doc pre code{background:none;padding:0}
  .fx-doc blockquote{margin:.6em 0;padding:.2em 1em;border-left:3px solid #d0d3d6;color:#646a73}
  .fx-doc table{border-collapse:collapse;margin:.6em 0;width:100%}
  .fx-doc th,.fx-doc td{border:1px solid #dee0e3;padding:6px 10px} .fx-doc th{background:#f5f6f7}
  .fx-doc a{color:#3370ff;text-decoration:none} .fx-doc a:hover{text-decoration:underline}
  .fx-doc hr{border:none;border-top:1px solid #dee0e3;margin:1.2em 0}
  .fx-doc ul,.fx-doc ol{padding-left:1.6em;margin:.4em 0}
  @media print{body{background:#fff}.fx-doc{box-shadow:none;margin:0;max-width:none;padding:0}}`;

  function wrapHtml(title, bodyHtml) {
    const t = util.escapeHtml(title);
    return (
      `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n` +
      `<meta name="viewport" content="width=device-width, initial-scale=1.0">\n` +
      `<title>${t}</title>\n<style>${HTML_THEME}</style>\n</head>\n<body>\n` +
      `<article class="fx-doc"><h1>${t}</h1>\n${bodyHtml}\n</article>\n</body>\n</html>\n`
    );
  }

  // Word：HTML + msword（Office 命名空间）→ 可被 Word 打开的 .doc
  function wrapWord(title, bodyHtml) {
    const t = util.escapeHtml(title);
    return (
      `<!DOCTYPE html>\n<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
      `xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">\n` +
      `<head>\n<meta charset="UTF-8">\n<title>${t}</title>\n<style>${HTML_THEME}</style>\n</head>\n<body>\n` +
      `<article class="fx-doc"><h1>${t}</h1>\n${bodyHtml}\n</article>\n</body>\n</html>\n`
    );
  }

  // ===========================================================================
  // 提取入口
  // ===========================================================================
  function getRootModel() {
    // 多路径探测：飞书前端偶发改名 / 挂到不同全局上
    const tryBm = (bm) => {
      if (!bm) return null;
      const root =
        bm.rootBlockModel ||
        bm.rootBlock ||
        (typeof bm.getRootBlockModel === "function" && bm.getRootBlockModel()) ||
        (typeof bm.getRootBlock === "function" && bm.getRootBlock()) ||
        null;
      if (root && (Array.isArray(root.children) || (root.snapshot && root.snapshot.type))) return root;
      return null;
    };

    const candidates = [];
    try {
      if (window.PageMain) {
        candidates.push(window.PageMain.blockManager);
        candidates.push(window.PageMain.blockManagerService);
        candidates.push(window.PageMain.model && window.PageMain.model.blockManager);
      }
    } catch (e) {
      /* ignore */
    }
    try {
      // 部分版本把编辑器实例挂在其它命名空间
      if (window.Docx) candidates.push(window.Docx.blockManager);
      if (window.__DOCX__) candidates.push(window.__DOCX__.blockManager);
    } catch (e) {
      /* ignore */
    }

    for (const bm of candidates) {
      const root = tryBm(bm);
      if (root) return root;
    }
    return null;
  }

  function getTitle() {
    // 1) 页面根块（page block）的文本 = 文档真标题（无面包屑、无平台后缀，最干净）
    try {
      const root = getRootModel();
      if (root && root.snapshot && root.snapshot.text) {
        const t = plain(richText(root.snapshot.text)).trim();
        if (t) return t.slice(0, 150);
      }
    } catch (e) {
      /* ignore */
    }
    // 2) DOM 标题元素
    const el = document.querySelector(".docx-title, [data-page-title], .doc-title, .page-title, .title-content");
    const dt = el && el.textContent && el.textContent.replace(ZW, "").trim();
    if (dt) return dt.slice(0, 150);
    // 3) 兜底：document.title 去平台后缀；若仍含面包屑 " - "，取首段（文档名通常在最前）
    let t = util.cleanTitle(document.title);
    if (t.includes(" - ")) t = (t.split(" - ")[0] || t).trim();
    return t || "飞书文档";
  }

  function domFallbackNodes() {
    // 多种 DOM 选择器：data-record-id 为主，其次常见编辑器块节点
    let blocks = Array.from(document.querySelectorAll("[data-record-id]"));
    if (!blocks.length) {
      blocks = Array.from(
        document.querySelectorAll(
          '.docx-block, [class*="block-wrapper"], [data-block-type], [data-block-id]'
        )
      );
    }
    // 再兜底：主内容区文本段落（保底能导出可见正文）
    if (!blocks.length) {
      const root =
        document.querySelector(".docx-page, .page-block, .doc-content, #editor, .editor-container, main") ||
        document.body;
      const paras = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,pre,blockquote")).filter((el) =>
        (el.innerText || "").trim()
      );
      return paras
        .map((el) => {
          const text = (el.innerText || "").replace(ZW, "").trim();
          if (!text) return null;
          const tag = (el.tagName || "").toLowerCase();
          const runs = [{ text, attrs: {} }];
          if (/^h[1-6]$/.test(tag)) return { kind: "heading", level: +tag[1], runs };
          if (tag === "li") return { kind: "bullet", runs };
          if (tag === "pre") return { kind: "code", language: "", code: text };
          if (tag === "blockquote") return { kind: "quote", children: [{ kind: "paragraph", runs }] };
          return { kind: "paragraph", runs };
        })
        .filter(Boolean);
    }
    return blocks
      .map((el) => {
        const type = el.getAttribute("data-block-type") || el.getAttribute("data-type") || "text";
        const text = (el.innerText || "").replace(ZW, "").trim();
        if (!text && type !== "divider" && type !== "image") return null;
        const runs = [{ text, attrs: {} }];
        const hm = /^heading([1-9])$/.exec(type);
        if (hm) return { kind: "heading", level: +hm[1], runs };
        if (type === "bullet") return { kind: "bullet", runs };
        if (type === "ordered") return { kind: "ordered", runs };
        if (type === "divider") return { kind: "divider" };
        const tag = (el.tagName || "").toLowerCase();
        if (/^h[1-6]$/.test(tag)) return { kind: "heading", level: +tag[1], runs };
        return { kind: "paragraph", runs };
      })
      .filter(Boolean);
  }


  // ===========================================================================
  // 通用网页 / 生财有术 / X 长文提取
  // ===========================================================================
  function detectSiteKind() {
    const host = (location.hostname || "").toLowerCase();
    const path = location.pathname || "";
    if (/(^|\.)(feishu\.cn|feishu\.net|feishu-pre\.net|larkoffice\.com|larksuite\.com|larkenterprise\.com)$/i.test(host)) {
      return "feishu";
    }
    if (/(^|\.)(scys\.com|shengcaiyoushu\.com)$/i.test(host)) return "scys";
    if (/(^|\.)(x\.com|twitter\.com)$/i.test(host)) {
      if (/\/i\/article\//i.test(path) || /\/articles?\//i.test(path)) return "x-article";
      if (/\/status\/\d+/i.test(path)) return "x-status";
      return "x-other";
    }
    return "unknown";
  }

  function absUrl(href) {
    if (!href) return "";
    try {
      return new URL(href, location.href).href;
    } catch (e) {
      return href;
    }
  }

  function inlineRunsFromEl(el) {
    const runs = [];
    const walk = (node, attrs) => {
      attrs = attrs || {};
      if (node.nodeType === 3) {
        const t = node.textContent || "";
        if (t) runs.push({ text: t, attrs: { ...attrs } });
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "br") {
        runs.push({ text: "\n", attrs: {} });
        return;
      }
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "svg") return;
      const next = { ...attrs };
      if (tag === "strong" || tag === "b") next.bold = true;
      if (tag === "em" || tag === "i") next.italic = true;
      if (tag === "s" || tag === "del" || tag === "strike") next.strike = true;
      if (tag === "u") next.underline = true;
      if (tag === "code") next.code = true;
      if (tag === "a" && node.getAttribute("href")) next.link = absUrl(node.getAttribute("href"));
      Array.from(node.childNodes).forEach((c) => walk(c, next));
    };
    walk(el, {});
    if (!runs.length) {
      const t = (el.innerText || "").replace(ZW, "");
      if (t) runs.push({ text: t, attrs: {} });
    }
    return runs;
  }

  function isSkippable(el) {
    if (!el || el.nodeType !== 1) return true;
    const tag = el.tagName.toLowerCase();
    if (["script", "style", "noscript", "svg", "button", "nav", "footer", "header", "form", "input", "textarea", "select"].includes(tag)) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "navigation" || role === "banner" || role === "contentinfo") return true;
    const cls = (el.className && String(el.className)) || "";
    if (/comment|reply-list|sidebar|toolbar|breadcrumb|modal|toast|login/i.test(cls)) return true;
    return false;
  }

  function convertDomTree(root) {
    const out = [];
    if (!root) return out;

    const pushImage = (img) => {
      const src = img.getAttribute("src") || img.getAttribute("data-src") || img.currentSrc || "";
      if (!src || src.startsWith("data:image/svg")) return;
      out.push({ kind: "image", url: absUrl(src), alt: img.getAttribute("alt") || "", token: null });
    };

    const handleEl = (el) => {
      if (isSkippable(el)) return;
      const tag = el.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        const runs = inlineRunsFromEl(el);
        if (plain(runs).trim()) out.push({ kind: "heading", level: +tag[1], runs });
        return;
      }
      if (tag === "p") {
        el.querySelectorAll("img").forEach(pushImage);
        const runs = inlineRunsFromEl(el);
        if (plain(runs).trim()) out.push({ kind: "paragraph", runs, children: [] });
        return;
      }
      if (tag === "img") {
        pushImage(el);
        return;
      }
      if (tag === "figure") {
        const img = el.querySelector("img");
        if (img) pushImage(img);
        const cap = el.querySelector("figcaption");
        if (cap && (cap.innerText || "").trim()) {
          out.push({ kind: "paragraph", runs: inlineRunsFromEl(cap), children: [] });
        }
        return;
      }
      if (tag === "ul" || tag === "ol") {
        const ordered = tag === "ol";
        Array.from(el.children).forEach((li, idx) => {
          if ((li.tagName || "").toLowerCase() !== "li") return;
          out.push({
            kind: ordered ? "ordered" : "bullet",
            seq: ordered ? String(idx + 1) : undefined,
            runs: inlineRunsFromEl(li),
            children: [],
          });
        });
        return;
      }
      if (tag === "pre") {
        out.push({ kind: "code", language: "", code: (el.innerText || "").replace(/\n$/, "") });
        return;
      }
      if (tag === "blockquote") {
        const kids = convertDomTree(el);
        out.push({ kind: "quote", children: kids.length ? kids : [{ kind: "paragraph", runs: inlineRunsFromEl(el) }] });
        return;
      }
      if (tag === "hr") {
        out.push({ kind: "divider" });
        return;
      }
      if (tag === "table") {
        const rows = [];
        el.querySelectorAll("tr").forEach((tr) => {
          const cells = [];
          tr.querySelectorAll("th,td").forEach((td) => {
            cells.push([{ kind: "paragraph", runs: inlineRunsFromEl(td) }]);
          });
          if (cells.length) rows.push(cells);
        });
        if (rows.length) out.push({ kind: "table", rows });
        return;
      }
      if (tag === "li") {
        out.push({ kind: "bullet", runs: inlineRunsFromEl(el), children: [] });
        return;
      }
      // 容器：递归子元素（避免 text 节点碎裂）
      Array.from(el.children || []).forEach(handleEl);
    };

    // 若 root 本身是块，直接处理；否则遍历 children
    const rt = (root.tagName || "").toLowerCase();
    if (/^(h[1-6]|p|li|pre|blockquote|table|figure|img|ul|ol|hr)$/.test(rt)) handleEl(root);
    else Array.from(root.children || []).forEach(handleEl);

    // 若结构化提取为空，退化为按可见文本分段
    if (!out.length) {
      const text = (root.innerText || "").replace(ZW, "").trim();
      if (text) {
        text.split(/\n{2,}/).forEach((para) => {
          const t = para.replace(/\s+\n/g, "\n").trim();
          if (t) out.push({ kind: "paragraph", runs: [{ text: t, attrs: {} }], children: [] });
        });
      }
    }
    return out;
  }

  function firstMatch(selectors, root) {
    root = root || document;
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el && (el.innerText || "").trim().length > 40) return el;
      } catch (e) {
        /* invalid selector */
      }
    }
    return null;
  }

  function pickTitle(candidates) {
    for (const t of candidates) {
      const s = (t || "").replace(ZW, "").trim();
      if (s && s.length < 200) return s;
    }
    return util.cleanTitle(document.title) || "未命名";
  }

  function extractScys() {
    const titleEl =
      document.querySelector("h1") ||
      document.querySelector("[class*='title'], [class*='Title']") ||
      document.querySelector("article h1, .post-title, .topic-title");
    const title = pickTitle([titleEl && titleEl.innerText, document.title.replace(/[|\-·].*$/, "")]);

    const root =
      firstMatch([
        "article",
        "[class*='post-content']",
        "[class*='PostContent']",
        "[class*='topic-content']",
        "[class*='article-content']",
        "[class*='markdown-body']",
        "[class*='rich-text']",
        "[class*='RichText']",
        "main .content",
        "main",
      ]) || document.querySelector("main") || document.body;

    // 尽量避开整页导航：若选中了 body，再收窄到最长文本块
    let contentRoot = root;
    if (contentRoot === document.body || (contentRoot.innerText || "").length > 50000) {
      let best = null;
      let bestLen = 0;
      document.querySelectorAll("article, main div, [class*='content']").forEach((el) => {
        if (isSkippable(el)) return;
        const len = (el.innerText || "").trim().length;
        if (len > bestLen && len < 80000) {
          bestLen = len;
          best = el;
        }
      });
      if (best) contentRoot = best;
    }

    const nodes = convertDomTree(contentRoot);
    return { title, nodes, source: "web-scys" };
  }

  function extractXArticle() {
    const titleEl =
      document.querySelector("h1") ||
      document.querySelector('[data-testid="article-title"], [data-testid="articleTitle"]') ||
      document.querySelector("article h1");
    const title = pickTitle([titleEl && titleEl.innerText, document.title.replace(/\s*[|/].*$/, "")]);

    const root =
      firstMatch([
        '[data-testid="article-viewer"]',
        '[data-testid="article"]',
        "article [data-testid='tweetText']",
        "article",
        "main article",
        "main [role='article']",
        "main",
      ]) || document.querySelector("main") || document.body;

    const nodes = convertDomTree(root);
    return { title, nodes, source: "web-x-article" };
  }

  function extractXStatus() {
    // 长帖 / 普通帖：抓主帖正文（article 中第一条 tweetText）
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"], article'));
    const main = articles[0] || document.querySelector("main");
    let title = util.cleanTitle(document.title) || "X 帖子";
    const textEl =
      (main && main.querySelector('[data-testid="tweetText"]')) ||
      document.querySelector('[data-testid="tweetText"]');
    const nodes = [];
    if (textEl) {
      const runs = inlineRunsFromEl(textEl);
      const t = plain(runs).trim();
      if (t) {
        title = t.slice(0, 80) + (t.length > 80 ? "…" : "");
        nodes.push({ kind: "paragraph", runs, children: [] });
      }
    }
    // 附带主帖图片
    if (main) {
      main.querySelectorAll('img[src*="pbs.twimg.com/media"], img[src*="twimg.com/media"]').forEach((img) => {
        const src = img.getAttribute("src");
        if (src) nodes.push({ kind: "image", url: absUrl(src), alt: "", token: null });
      });
    }
    // 若主帖为空，退化为整页 article 转换
    if (!nodes.length && main) {
      const more = convertDomTree(main);
      more.forEach((n) => nodes.push(n));
    }
    return { title, nodes, source: "web-x-status" };
  }

  function extractWebBySite() {
    const kind = detectSiteKind();
    if (kind === "scys") return extractScys();
    if (kind === "x-article") return extractXArticle();
    if (kind === "x-status") return extractXStatus();
    return null;
  }

  function inspect() {
    const root = getRootModel();
    const site = detectSiteKind();
    const report = {
      url: location.href,
      title: getTitle(),
      site,
      hasPageMain: !!window.PageMain,
      hasRoot: !!root,
    };
    try {
      if (root && Array.isArray(root.children)) {
        report.topBlocks = root.children.length;
        const dist = {};
        root.children.forEach((b) => {
          const t = b.snapshot && b.snapshot.type;
          dist[t] = (dist[t] || 0) + 1;
        });
        report.typeDistribution = dist;
      }
      report.domRecordBlocks = document.querySelectorAll("[data-record-id]").length;
      if (site !== "feishu") {
        const web = extractWebBySite();
        if (web) {
          report.webTitle = web.title;
          report.webNodes = (web.nodes || []).length;
          report.webSource = web.source;
        }
      }
    } catch (e) {
      report.error = String(e && e.message);
    }
    return report;
  }

  // 探测一个 table 块的结构（校验列数字段用）
  function inspectTable() {
    const root = getRootModel();
    if (!root) return { error: "no PageMain" };
    const find = (arr) => {
      for (const b of arr || []) {
        if (b.snapshot && b.snapshot.type === "table") return b;
        const r = b.children && find(b.children);
        if (r) return r;
      }
      return null;
    };
    const tb = find(root.children);
    if (!tb) return { found: false };
    const s = tb.snapshot;
    return {
      found: true,
      snapshotKeys: Object.keys(s),
      columns_id: s.columns_id && s.columns_id.length,
      rows_id: s.rows_id && s.rows_id.length,
      tableMeta: s.table ? Object.keys(s.table) : null,
      childCount: (tb.children || []).length,
      firstChildType: tb.children && tb.children[0] && tb.children[0].snapshot && tb.children[0].snapshot.type,
    };
  }

  // ===========================================================================
  // 入口
  // ===========================================================================
  async function run(format, options) {
    const opts = options || {};
    try {
      const site = detectSiteKind();
      let nodes;
      let source;
      let title;

      // 非飞书站点：走网页提取
      if (site === "scys" || site === "x-article" || site === "x-status") {
        const web = extractWebBySite();
        nodes = (web && web.nodes) || [];
        source = (web && web.source) || "web";
        title = (web && web.title) || util.cleanTitle(document.title) || "未命名";
      } else {
        // 飞书：优先 PageMain 块树，否则 DOM 兜底
        const root = getRootModel();
        if (root && Array.isArray(root.children) && root.children.length) {
          nodes = nodesOf(root.children);
          source = "model";
        } else {
          nodes = domFallbackNodes();
          source = "dom-fallback";
        }
        title = getTitle();
      }

      if (!nodes.length) {
        return {
          ok: false,
          error:
            "未能从页面提取到内容。请确认：①页面已完全加载 ②在正文页（飞书 /docx|/wiki、生财有术帖子、X 长文）③扩展重载后已刷新本页。",
        };
      }

      // nodes 模式：返回结构化块树（供"转存到飞书"OpenAPI 映射），不在此拉图
      if (format === "nodes") {
        return { ok: true, title, nodes, source };
      }

      const imgStats = await resolveImages(nodes, opts);
      const mkStats = (f) => ({ format: f, source, images: imgStats });

      if (format === "html") {
        const html = wrapHtml(title, htmlRender(nodes));
        return { ok: true, title, text: html, mime: "text/html;charset=utf-8", ext: "html", stats: mkStats("html") };
      }
      if (format === "word") {
        const html = wrapWord(title, htmlRender(nodes));
        return { ok: true, title, text: html, mime: "application/msword", ext: "doc", stats: mkStats("word") };
      }
      if (format === "pdf") {
        // PDF 不直接落盘：返回打印用 HTML，由调用方打开打印页 → Chrome「另存为 PDF」
        const html = wrapHtml(title, htmlRender(nodes));
        return { ok: true, title, text: html, mime: "text/html;charset=utf-8", ext: "pdf", print: true, stats: mkStats("pdf") };
      }
      // 默认 markdown
      const md = ("# " + title + "\n\n" + mdRender(nodes)).replace(/\n{3,}/g, "\n\n").trim() + "\n";
      return { ok: true, title, text: md, mime: "text/markdown;charset=utf-8", ext: "md", stats: mkStats("markdown") };
    } catch (e) {
      return { ok: false, error: String((e && e.stack) || e) };
    }
  }

  window[NS] = { __ready: true, run, inspect, inspectTable, util };
})();
