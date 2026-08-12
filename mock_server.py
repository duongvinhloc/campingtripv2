"""
Server local dùng Python (chỉ dùng thư viện chuẩn, không cần cài gì thêm) để:
  1. Serve các file tĩnh (index.html, style.css, app.js, ...) trong thư mục này.
  2. Giả lập API của Apps Script (doGet/doPost) với dữ liệu MẪU lưu trong bộ nhớ,
     để xem/thử app đầy đủ (thêm/sửa/xoá) trước khi deploy Google Sheets thật.

Lưu ý: dữ liệu chỉ tồn tại trong lúc server chạy, tắt server (Ctrl+C) là mất,
không liên quan gì tới Google Sheets thật — chỉ để xem giao diện & luồng hoạt động.

Chạy:
    python mock_server.py
Rồi mở http://localhost:5500
"""

import http.server
import json
import os
import sys
import time
import urllib.parse

if sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")

PORT = 5500
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

DB = {
    "Members": [
        {"id": "1", "name": "Ngọc", "familySize": 2},
        {"id": "2", "name": "Lu", "familySize": 3},
        {"id": "3", "name": "Ni", "familySize": 1},
    ],
    "Tasks": [
        {"id": "101", "group": "Lều & ngủ nghỉ", "task": "Mang lều", "assignee": "Ngọc", "quantity": 1, "status": "done", "note": "lều 4 người"},
        {"id": "102", "group": "Đồ ăn & nước uống", "task": "Mua đồ ăn", "assignee": "Lu", "quantity": "", "status": "doing", "note": ""},
        {"id": "103", "group": "Nấu nướng", "task": "Chuẩn bị bếp gas", "assignee": "Ni", "quantity": 1, "status": "todo", "note": "nhớ mang thêm ga"},
        {"id": "104", "group": "Giải trí", "task": "Mang loa, đèn pin", "assignee": "", "quantity": 2, "status": "todo", "note": ""},
    ],
    "Expenses": [
        {"id": "201", "date": "2026-08-10", "description": "Đổ xăng", "payer": "Ngọc",
         "amount": 300000, "participants": "Ngọc, Lu, Ni", "note": ""},
        {"id": "202", "date": "2026-08-10", "description": "Mua đồ ăn, nước uống", "payer": "Lu",
         "amount": 550000, "participants": "Ngọc, Lu, Ni", "note": "nhớ giữ hoá đơn"},
        {"id": "203", "date": "2026-08-11", "description": "Vé khu cắm trại", "payer": "Ni",
         "amount": 240000, "participants": "Ngọc, Lu, Ni", "note": ""},
    ],
}


def next_id():
    return str(int(time.time() * 1000))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Tắt cache trình duyệt để mỗi lần sửa file là thấy ngay, không cần xoá cache tay.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if "sheet" in params:
            sheet = params["sheet"][0]
            if sheet not in DB:
                self._send_json({"error": f"Unknown sheet: {sheet}"})
                return
            self._send_json({"data": DB[sheet]})
            return
        super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON"})
            return

        sheet = body.get("sheet")
        action = body.get("action")
        if sheet not in DB:
            self._send_json({"error": f"Unknown sheet: {sheet}"})
            return
        rows = DB[sheet]

        if action == "add":
            data = dict(body.get("data", {}))
            data["id"] = data.get("id") or next_id()
            rows.append(data)
            self._send_json({"ok": True, "id": data["id"]})
        elif action == "update":
            target = next((r for r in rows if str(r.get("id")) == str(body.get("id"))), None)
            if not target:
                self._send_json({"error": f"Not found: {body.get('id')}"})
                return
            target.update(body.get("data", {}))
            self._send_json({"ok": True})
        elif action == "delete":
            idx = next((i for i, r in enumerate(rows) if str(r.get("id")) == str(body.get("id"))), None)
            if idx is None:
                self._send_json({"error": f"Not found: {body.get('id')}"})
                return
            rows.pop(idx)
            self._send_json({"ok": True})
        else:
            self._send_json({"error": f"Unknown action: {action}"})


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("", PORT), Handler) as httpd:
        print(f"Camping app (dữ liệu giả) đang chạy tại http://localhost:{PORT}")
        httpd.serve_forever()
