// ============================================================================
// Google Apps Script：X-PHS 32 Agent 实时对话云端中继（贴入 Google Sheets 即可）
// 使用步骤：
// 1. 打开 Google Sheets 新建表格 → 扩展程序(Extensions) → Apps Script
// 2. 清空默认代码，粘贴本文件全部内容并保存
// 3. 点击右上角「部署(Deploy)」→「新建部署」→ 类型选「Web 应用(Web app)」
//    - 执行身份：我 (Me)
//    - 谁可以访问：任何人 (Anyone)
// 4. 复制生成的 Web App URL (https://script.google.com/macros/s/.../exec)
//    - 填入 3D 场景 [L] 面板的「Google Sheet 推送地址」
//    - 填入个人主页 agent-society.html 的「数据源配置」(或写进 DEFAULT_SHEET_API)
// ============================================================================

const SHEET_NAME = 'AgentDialogues';

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['time', 'speaker', 'role', 'target', 'location', 'text']);
  }
  return sh;
}

function doGet(e) {
  const sh = getOrCreateSheet();
  const rows = sh.getDataRange().getValues();
  const entries = [];
  const start = Math.max(1, rows.length - 200); // 返回最新 200 条
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r[5]) continue;
    entries.push({
      time: String(r[0] || ''),
      speaker: String(r[1] || ''),
      role: String(r[2] || ''),
      target: String(r[3] || ''),
      location: String(r[4] || ''),
      text: String(r[5] || '')
    });
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, count: entries.length, entries: entries }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const sh = getOrCreateSheet();
  const body = JSON.parse(e.postData.contents || '{}');
  const items = Array.isArray(body.entries) ? body.entries : [body];
  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    if (!m || !m.text) continue;
    sh.appendRow([
      m.time || Utilities.formatDate(new Date(), 'Asia/Shanghai', 'HH:mm:ss'),
      m.speaker || 'Agent',
      m.role || '',
      m.target || '',
      m.location || '',
      m.text
    ]);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, added: items.length }))
    .setMimeType(ContentService.MimeType.JSON);
}
