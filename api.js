// Lớp giao tiếp với Apps Script Web App (đóng vai trò database qua Google Sheets).

// Apps Script /exec redirect qua 1 URL echo tạm; dưới tải (nhiều request cùng lúc) URL đó
// đôi khi 404 và trả về trang lỗi HTML thay vì JSON. Lỗi này chỉ là tạm thời nên retry là đủ.
async function fetchJson_(url, options, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, options);
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`Phản hồi không phải JSON (status ${res.status})`);
      }
      return json;
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

async function apiList(sheetName) {
  const url = `${APPS_SCRIPT_URL}?sheet=${encodeURIComponent(sheetName)}`;
  const json = await fetchJson_(url);
  if (json.error) throw new Error(json.error);
  return json.data;
}

async function apiPost(payload) {
  // Content-Type text/plain tránh browser gửi CORS preflight (Apps Script không xử lý OPTIONS).
  const json = await fetchJson_(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (json.error) throw new Error(json.error);
  return json;
}

// Trả về 1 số "version" tăng mỗi lần có add/update/delete — rẻ hơn hẳn so với tải lại
// toàn bộ data, dùng để biết có cần đồng bộ lại hay không.
async function apiVersion() {
  const url = `${APPS_SCRIPT_URL}?action=version`;
  const json = await fetchJson_(url);
  if (json.error) throw new Error(json.error);
  return json.version;
}

const api = {
  list: (sheet) => apiList(sheet),
  add: (sheet, data) => apiPost({ sheet, action: 'add', data }),
  update: (sheet, id, data) => apiPost({ sheet, action: 'update', id, data }),
  remove: (sheet, id) => apiPost({ sheet, action: 'delete', id }),
  version: () => apiVersion(),
};
