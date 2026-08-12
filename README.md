# Camping Trip Planner

Web app tĩnh (HTML/CSS/JS thuần) có 2 chức năng chính, dùng chung 1 Google Sheet làm database để cả nhóm cùng xem/sửa:

- **Chuẩn bị đồ**: phân việc, gán người phụ trách, cập nhật trạng thái (Chưa làm / Đang làm / Xong).
- **Chia tiền (kiểu Splitwise)**: ghi khoản chi, ai trả, chia cho ai, tự tính số dư và gợi ý "ai cần trả ai bao nhiêu".
- **Thành viên**: danh sách người tham gia chuyến đi, dùng chung cho 2 tab trên.

Vì GitHub Pages chỉ host file tĩnh (không có server để ghi dữ liệu), phần lưu trữ dùng **Google Sheets + Apps Script** đóng vai trò database miễn phí, để nhiều người cùng cập nhật và thấy dữ liệu mới nhất của nhau (app tự làm mới mỗi 15 giây, hoặc bấm nút "Làm mới").

## 0. Xem thử ngay với dữ liệu giả (chưa cần Google Sheet)

Nếu chỉ muốn xem giao diện / thử luồng thêm-sửa-xoá trước khi setup Google Sheet thật, chạy:

```bash
python camping-app/mock_server.py
```

Mở `http://localhost:5500`. Server Python này (chỉ dùng thư viện chuẩn, không cần cài gì) vừa serve giao diện, vừa giả lập API với vài dòng Task/Expense/Member mẫu có sẵn trong bộ nhớ — thêm/sửa/xoá đều hoạt động bình thường. `config.js` tự nhận diện đang chạy ở `localhost` để trỏ vào server giả này; khi deploy thật lên GitHub Pages (domain khác `localhost`) nó tự chuyển sang dùng `APPS_SCRIPT_URL` thật.

App yêu cầu đăng nhập bằng 1 mật khẩu chung trước khi xem/sửa dữ liệu. Mật khẩu mặc định khi chạy `mock_server.py` là `camp2026` (đổi trong biến `APP_PASSWORD` ở đầu file nếu muốn).

Lưu ý: dữ liệu chỉ tồn tại trong lúc server còn chạy — tắt server (Ctrl+C) hoặc khởi động lại là mất, không ảnh hưởng gì tới Google Sheets thật. Đây chỉ để xem giao diện, không phải nơi lưu dữ liệu lâu dài.

## 1. Tạo database (Google Sheet + Apps Script)

1. Tạo 1 Google Sheet mới (sheets.new).
2. Không cần tạo sẵn các tab — script sẽ tự tạo `Tasks`, `Expenses`, `Members` với đúng tiêu đề cột khi chạy lần đầu.
3. Vào **Extensions > Apps Script**. Xoá nội dung mặc định trong `Code.gs`, dán toàn bộ nội dung file [`apps-script/Code.gs`](apps-script/Code.gs) trong thư mục này vào.
4. Bấm **Deploy > New deployment**.
   - Chọn loại: **Web app**.
   - Execute as: **Me**.
   - Who has access: **Anyone**.
5. Bấm **Deploy**, cấp quyền khi được hỏi (đây là script của chính bạn nên an toàn).
6. Copy URL dạng `https://script.google.com/macros/s/XXXXXXX/exec`.
7. Đổi biến `APP_PASSWORD` ở đầu `Code.gs` thành mật khẩu chung của nhóm (khác mật khẩu mẫu `camp2026`), rồi **Deploy > Manage deployments** để áp dụng thay đổi.

## 2. Gắn URL vào app

Mở [`config.js`](config.js), thay giá trị mẫu bằng URL vừa copy:

```js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXX/exec';
```

## 3. Chạy thử local với dữ liệu thật (tuỳ chọn)

Sau khi đã điền `APPS_SCRIPT_URL` thật ở bước 2, có thể xem thử ngay trên máy trước khi đưa lên GitHub Pages bằng 1 server tĩnh đơn giản (khác với `mock_server.py` ở bước 0 — lần này gọi thẳng Google Sheet thật):

```bash
npx serve .
```

## 4. Đưa lên GitHub Pages

1. Tạo 1 repo GitHub mới, push toàn bộ thư mục `camping-app` (bao gồm `config.js` đã điền URL thật) lên nhánh `main`.
2. Vào **Settings > Pages**, chọn source là nhánh `main`, thư mục `/ (root)`.
3. Sau vài phút, app sẽ chạy tại `https://<username>.github.io/<repo>/`.
4. Gửi link này cho cả nhóm — ai cũng vào tab **Thành viên** thêm tên mình trước, rồi dùng 2 tab còn lại.

## Lưu ý

- URL Apps Script sau khi deploy "Anyone" nghĩa là bất kỳ ai có link đó đều gọi được — app có yêu cầu đăng nhập bằng mật khẩu chung (`APP_PASSWORD` trong `Code.gs`) để chặn người không biết mật khẩu đọc/ghi dữ liệu, kể cả khi họ có URL Apps Script. Chỉ chia sẻ mật khẩu cho người trong nhóm.
- Nếu sau này sửa code trong Apps Script, phải **Deploy > Manage deployments > sửa deployment hiện tại** (hoặc tạo bản deploy mới rồi cập nhật lại `config.js`) thì thay đổi mới có hiệu lực.
- Số tiền hiển thị theo định dạng VNĐ; có thể đổi trong hàm `fmtMoney` ở [`app.js`](app.js) nếu cần đơn vị khác.
