/**
 * Backend cho app cắm trại (Tasks + Splitwise) dùng Google Sheets làm database.
 *
 * Cách cài đặt:
 * 1. Tạo 1 Google Sheet mới, tạo đúng 3 sheet (tab) với tên và dòng tiêu đề sau:
 *
 *    Sheet "Tasks"    | id | group | task | assignee | quantity | status | note
 *    Sheet "Expenses" | id | date | description | payer | amount | participants | note
 *    Sheet "Members"  | id | name | familySize
 *
 * 2. Trong Sheet, mở Extensions > Apps Script, xoá code mẫu, dán toàn bộ file này vào.
 * 3. Deploy > New deployment > chọn loại "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy URL /exec sau khi deploy, dán vào camping-app/config.js (APPS_SCRIPT_URL).
 */

const SHEETS = {
  Tasks: ['id', 'group', 'task', 'assignee', 'quantity', 'status', 'note'],
  Expenses: ['id', 'date', 'description', 'payer', 'amount', 'participants', 'note'],
  Members: ['id', 'name', 'familySize'],
};

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(SHEETS[name]);
  }
  return sheet;
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map((row, idx) => {
      const obj = { _row: idx + 2 };
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
}

// Bộ đếm "version" tăng mỗi lần add/update/delete, để client chỉ cần poll 1 số nguyên
// (rẻ, không đọc data) thay vì tải lại toàn bộ 3 sheet mỗi vòng lặp.
function getVersion_() {
  return Number(PropertiesService.getScriptProperties().getProperty('version') || 0);
}

function bumpVersion_() {
  const v = getVersion_() + 1;
  PropertiesService.getScriptProperties().setProperty('version', String(v));
  return v;
}

function doGet(e) {
  if (e.parameter.action === 'version') {
    return jsonOut_({ version: getVersion_() });
  }
  const name = e.parameter.sheet;
  if (!SHEETS[name]) return jsonOut_({ error: 'Unknown sheet: ' + name });
  const sheet = getSheet_(name);
  return jsonOut_({ data: sheetToObjects_(sheet) });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const name = body.sheet;
  if (!SHEETS[name]) return jsonOut_({ error: 'Unknown sheet: ' + name });
  const sheet = getSheet_(name);
  const headers = SHEETS[name];

  if (body.action === 'add') {
    const id = body.data.id || String(new Date().getTime());
    const row = headers.map(h => h === 'id' ? id : (body.data[h] !== undefined ? body.data[h] : ''));
    sheet.appendRow(row);
    return jsonOut_({ ok: true, id: id, version: bumpVersion_() });
  }

  if (body.action === 'update') {
    const rows = sheetToObjects_(sheet);
    const target = rows.find(r => String(r.id) === String(body.id));
    if (!target) return jsonOut_({ error: 'Not found: ' + body.id });
    headers.forEach((h, i) => {
      if (body.data[h] !== undefined) {
        sheet.getRange(target._row, i + 1).setValue(body.data[h]);
      }
    });
    return jsonOut_({ ok: true, version: bumpVersion_() });
  }

  if (body.action === 'delete') {
    const rows = sheetToObjects_(sheet);
    const target = rows.find(r => String(r.id) === String(body.id));
    if (!target) return jsonOut_({ error: 'Not found: ' + body.id });
    sheet.deleteRow(target._row);
    return jsonOut_({ ok: true, version: bumpVersion_() });
  }

  return jsonOut_({ error: 'Unknown action: ' + body.action });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
