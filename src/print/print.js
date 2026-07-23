/* 码藏 — PDF 渲染面：把 background 暂存的导出 HTML 写入本文档，
   供 background 通过 CDP Page.printToPDF 静默生成 PDF（无打印对话框）。 */

chrome.storage.local.get("fx_print", ({ fx_print }) => {
  if (!fx_print || !fx_print.html) return;
  chrome.storage.local.remove("fx_print");
  document.open();
  document.write(fx_print.html);
  document.close();
});
