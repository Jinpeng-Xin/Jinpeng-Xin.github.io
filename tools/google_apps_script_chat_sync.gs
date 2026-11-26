// ============================================================================
// Google Apps Script：X-PHS 32 Agent 实时对话与远程启停云端中继
// 支持：大群/小群/私聊分频道存储 + 手机端远程 Start/Stop 控制（口令 2026）
// ============================================================================

const SHEET_NAME = 'AgentDialogues';
const CTRL_SHEET_NAME = 'AgentControl';
const CONTROL_PIN = '2026';

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['time', 'speaker', 'role', 'target', 'location', 'text', 'channel']);
  }
  return sh;
}

function getOrCreateControl() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CTRL_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CTRL_SHEET_NAME);
    sh.appendRow(['key', 'value', 'updated_at']);
    sh.appendRow(['running', 'true', Utilities.formatDate(new Date(), 'Asia/Shanghai', 'yyyy-MM-dd HH:mm:ss')]);
  }
  return sh;
}

function readControlState() {
  const sh = getOrCreateControl();
  const vals = sh.getRange(2, 1, 1, 3).getValues()[0];
  return {
    running: String(vals[1]).toLowerCase() !== 'false',
    updated_at: String(vals[2] || '')
  };
}

function writeControlState(running) {
  const sh = getOrCreateControl();
  const ts = Utilities.formatDate(new Date(), 'Asia/Shanghai', 'yyyy-MM-dd HH:mm:ss');
  sh.getRange(2, 1, 1, 3).setValues([['running', running ? 'true' : 'false', ts]]);
  return { running: !!running, updated_at: ts };
}

function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  if (params.action === 'set_control') {
    if (String(params.pin || '') !== CONTROL_PIN) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '口令错误' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const wantRun = String(params.running || '').toLowerCase() === 'true';
    const ctrl = writeControlState(wantRun);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, control: ctrl }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const sh = getOrCreateSheet();
  const rows = sh.getDataRange().getValues();
  const entries = [];
  const start = Math.max(1, rows.length - 200);
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r[5]) continue;
    entries.push({
      time: String(r[0] || ''),
      speaker: String(r[1] || ''),
      role: String(r[2] || ''),
      target: String(r[3] || ''),
      location: String(r[4] || ''),
      text: String(r[5] || ''),
      channel: String(r[6] || '工作总群')
    });
  }
  const ctrl = readControlState();
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, control: ctrl, count: entries.length, entries: entries }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse((e && e.postData && e.postData.contents) ? e.postData.contents : '{}');
  if (body.action === 'set_control') {
    if (String(body.pin || '') !== CONTROL_PIN) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: '口令错误' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const ctrl = writeControlState(!!body.running);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, control: ctrl }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sh = getOrCreateSheet();
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
      m.text,
      m.channel || '工作总群'
    ]);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, added: items.length }))
    .setMimeType(ContentService.MimeType.JSON);
}
