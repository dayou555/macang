/**
 * 多站点识别（background / sidepanel 共用）
 * 暴露：globalThis.FX_SITES.matchPage(url) → SiteInfo | null
 *
 * SiteInfo: { id, label, canExport, canTransfer, hostKind }
 */
(function (root) {
  "use strict";

  const FEISHU_HOST =
    /(^|\.)(feishu\.cn|feishu\.net|feishu-pre\.net|larkoffice\.com|larksuite\.com|larkenterprise\.com)$/i;
  const SCYS_HOST = /(^|\.)(scys\.com|shengcaiyoushu\.com)$/i;
  const X_HOST = /(^|\.)(x\.com|twitter\.com)$/i;

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

    // —— 飞书 / Lark ——
    if (FEISHU_HOST.test(host)) {
      if (/\/(docx|docs|wiki|doc)\b/i.test(path)) {
        return { id: "feishu", label: "飞书文档", canExport: true, canTransfer: true, hostKind: "feishu" };
      }
      return { id: "feishu-other", label: "飞书页面", canExport: false, canTransfer: false, hostKind: "feishu" };
    }

    // —— 生财有术 ——
    if (SCYS_HOST.test(host)) {
      // 帖子详情 /t/xxx；其它页面也尝试识别（正文 DOM 提取）
      const isPost = /\/t\/[^/]+/i.test(path) || /\/(topic|post|article)\//i.test(path);
      return {
        id: "scys",
        label: isPost ? "生财有术帖子" : "生财有术",
        canExport: true,
        canTransfer: true,
        hostKind: "scys",
      };
    }

    // —— X / Twitter 长文 Articles + 长帖 ——
    if (X_HOST.test(host)) {
      if (/\/i\/article\//i.test(path) || /\/articles?\//i.test(path)) {
        return { id: "x-article", label: "X 长文", canExport: true, canTransfer: true, hostKind: "x" };
      }
      if (/\/status\/\d+/i.test(path)) {
        return { id: "x-status", label: "X 帖子", canExport: true, canTransfer: true, hostKind: "x" };
      }
      return { id: "x-other", label: "X", canExport: false, canTransfer: false, hostKind: "x" };
    }

    return null;
  }

  /** 宽松：是否属于已支持站点主机（用于批量链接过滤等） */
  function isSupportedHost(url) {
    const s = matchPage(url);
    return !!(s && s.canExport);
  }

  root.FX_SITES = { matchPage, isSupportedHost, FEISHU_HOST, SCYS_HOST, X_HOST };
})(typeof globalThis !== "undefined" ? globalThis : self);
