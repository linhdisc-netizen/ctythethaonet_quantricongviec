# Quản lý đơn hàng – Thể Thao Net

Web app đơn giản để Shop (lên đơn), Kho (đóng hàng) và Chủ cùng làm việc trên **một Google Sheet** "Đóng đơn TTS- A LINH".

```
Trình duyệt (GitHub Pages)  ──mật khẩu──►  Apps Script (gắn trong Sheet)  ──►  Google Sheet
```

- Giao diện là trang tĩnh, nằm trên GitHub Pages. Trang **không lưu dữ liệu**, mọi dữ liệu nằm trong Google Sheet.
- Repo này công khai nên **không chứa dữ liệu đơn hàng hay mật khẩu**. Không có mật khẩu thì không đọc hoặc ghi được gì.
- Ba vai trò, mỗi vai trò một mật khẩu: **Shop** (lên đơn), **Kho** (đóng hàng, nhập tồn), **Chủ** (làm được mọi thao tác).

## Tính năng
- **Đơn hàng:** lọc theo ngày và trạng thái, tìm kiếm, thêm từng đơn hoặc dán nhiều đơn, xuất CSV.
- **Cần đóng:** đơn chờ đóng gom theo mẫu, size, màu; đóng cả nhóm; đếm số bó gối, tất cần đóng kèm.
- **Tồn kho:** hàng hoàn và hàng lấy dư. Khi lên đơn trùng mẫu với hàng tồn, app gợi ý dùng lại, và đôi tồn tự chuyển sang "Đã dùng". Hoàn tác đơn thì tồn được trả lại.
- **Bình luận và lịch sử** trên từng đơn (ai đổi trạng thái, lúc nào).
- **Tổng quan:** thống kê theo tháng, cảnh báo mã đơn trùng và đơn bị bỏ quên.

## Cài đặt (làm một lần)

### 1. Backend Apps Script
1. Mở file `backend/apps-script.gs`, thay `__PW_SHOP__`, `__PW_KHO__`, `__PW_CHU__` bằng 3 mật khẩu thật (dài, ngẫu nhiên, mỗi vai trò một mật khẩu). **Đừng commit bản đã sửa lên GitHub.**
2. Mở Google Sheet, chọn **Tiện ích mở rộng → Apps Script**. Xóa code mẫu, dán toàn bộ nội dung, rồi **Lưu**.
3. **Triển khai → Tùy chọn triển khai mới → Ứng dụng web**: *Thực thi với tư cách* = **Tôi**, *Người có quyền truy cập* = **Bất kỳ ai**. Cấp quyền (Google báo "chưa xác minh" thì chọn **Nâng cao → Tiếp tục**).
4. Copy **URL ứng dụng web** (dạng `https://script.google.com/macros/s/.../exec`).

> Khi sửa script (đổi mật khẩu, cập nhật), phải **Triển khai → Quản lý bản triển khai → Chỉnh sửa → Phiên bản mới**, không thì thay đổi chưa có hiệu lực.

### 2. Dán link vào giao diện
Sửa `config.js`: `window.APP_CONFIG = { api: 'URL-vừa-copy' };` rồi commit. Link này không phải bí mật.

### 3. Bật GitHub Pages
Repo → **Settings → Pages → Build and deployment**: *Source* = **Deploy from a branch**, *Branch* = **main** / **(root)** → Save. Sau 1–2 phút trang chạy tại `https://<tài-khoản>.github.io/<tên-repo>/`.

## Cách app dùng Google Sheet
- Đọc sheet **"Tháng M/YYYY"** của tháng hiện tại và **"Tồn tháng <tháng trước>"**. Sang tháng mới, hãy tạo sheet tháng mới như bình thường.
- Chỉ ghi: cột **J, K** (Đã đóng / Đã giao), **thêm dòng mới** ở cuối, cột **H** của sheet tồn. Không xóa hay ghi đè dòng nào của bạn.
- Mỗi lần ghi đều kiểm tra dòng đó còn đúng sản phẩm, size, màu, mã đơn. Nếu sheet vừa bị sửa hoặc dời dòng thì bỏ qua và báo.
- Sheet cũng cứ sửa tay bình thường được. App tự cập nhật sau tối đa 20 giây hoặc khi bấm "Tải lại".
- Script tự tạo 3 sheet ở cuối file: `App_BinhLuan`, `App_LienKet`, `App_NhatKy` (bình luận, liên kết đơn–hàng tồn, nhật ký thay đổi).

## Bảo mật
- Mật khẩu chỉ được kiểm tra trong Apps Script. Trên máy người dùng, mật khẩu được nhớ trong trình duyệt cho đến khi bấm **Đăng xuất**.
- Hãy dùng mật khẩu dài, ngẫu nhiên. Muốn thu hồi quyền thì đổi mật khẩu và triển khai lại phiên bản mới.
- Không dùng chung máy công cộng mà không đăng xuất.
