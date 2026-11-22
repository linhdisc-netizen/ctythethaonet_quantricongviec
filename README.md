# Quản lý đơn hàng – Thể Thao Net

Web app đơn giản để Shop (lên đơn), Kho (đóng hàng) và Chủ cùng làm việc trên **một Google Sheet mới**.

```
Trình duyệt (GitHub Pages)  ──mật khẩu──►  Apps Script (backend)  ──►  Google Sheet
```

- Giao diện là trang tĩnh trên GitHub Pages. Trang **không lưu dữ liệu**, mọi dữ liệu nằm trong Google Sheet.
- Repo này công khai nên **không chứa dữ liệu đơn hàng hay mật khẩu**.
- Ba vai trò, mỗi vai trò một mật khẩu: **Shop** (lên đơn), **Kho** (đóng hàng, nhập tồn), **Chủ** (làm được mọi thao tác).

## Cấu trúc Google Sheet (lấy từ file Excel mẫu `Don-hang-TTS-moi.xlsx`)
| Tab | Nội dung |
|---|---|
| Đơn hàng | Một dòng một đơn, **mọi tháng chung một tab**. Có cột ID cố định (D000001…), Trạng thái, Nguồn, Người tạo, Cập nhật lúc |
| Tồn kho | Hàng hoàn và hàng lấy dư (ID T000001…), tình trạng Còn hàng / Đã dùng, dùng cho đơn nào |
| Danh mục | Danh sách chọn: sản phẩm, size, màu, đóng kèm |
| Bình luận, Nhật ký | Do app ghi: ai nói gì, ai đổi gì, lúc nào |
| Tổng quan, Hướng dẫn | Số liệu tự tính và hướng dẫn dùng file |

App tìm dòng theo **ID**, không theo số dòng hay tên sheet theo tháng, nên sắp xếp, lọc hay chèn dòng trong Sheet không làm app ghi nhầm chỗ. Không đổi tên tab và không đổi tên cột ở dòng 1.

## Cài đặt (làm một lần)

### 1. Tạo Google Sheet mới từ file Excel
1. Vào https://sheets.google.com, tạo **Bảng tính trống**.
2. **Tệp → Nhập → Tải lên**, chọn `Don-hang-TTS-moi.xlsx`, chọn **Thay thế bảng tính** → **Nhập dữ liệu**.
3. Đặt tên Sheet (ví dụ "Đơn hàng TTS"). Kiểm tra có đủ 7 tab và các cột Trạng thái có ô chọn danh sách.
4. Copy **ID của Sheet** từ link: đoạn nằm giữa `/d/` và `/edit`.

### 2. Backend Apps Script
1. Mở `backend/apps-script.gs`, thay `__PW_SHOP__`, `__PW_KHO__`, `__PW_CHU__` bằng 3 mật khẩu thật và dán **ID của Sheet** vào `SHEET_ID`. **Đừng commit bản đã sửa lên GitHub.**
2. Trong **chính Google Sheet mới**, chọn **Tiện ích mở rộng → Apps Script**. Xóa code mẫu, dán toàn bộ nội dung, rồi **Lưu**.
   > Dự án tạo từ trang script.google.com (dự án độc lập) cũng chạy được, nhưng **bắt buộc** phải điền `SHEET_ID`. Thiếu `SHEET_ID` sẽ báo lỗi "Script chưa gắn với Google Sheet".
3. **Triển khai → Tùy chọn triển khai mới → Ứng dụng web**: *Thực thi với tư cách* = **Tôi**, *Người có quyền truy cập* = **Bất kỳ ai**. Cấp quyền (Google báo "chưa xác minh" thì chọn **Nâng cao → Tiếp tục**).
4. Copy **URL ứng dụng web** (dạng `https://script.google.com/macros/s/.../exec`).

> Khi sửa script (đổi mật khẩu, cập nhật), phải **Triển khai → Quản lý bản triển khai → Chỉnh sửa → Phiên bản mới**, không thì thay đổi chưa có hiệu lực.

### 3. Dán link vào giao diện
Sửa `config.js`: `window.APP_CONFIG = { api: 'URL-vừa-copy' };` rồi commit. Link này không phải bí mật.

### 4. Bật GitHub Pages
Repo → **Settings → Pages**: *Source* = **Deploy from a branch**, *Branch* = **main** / **(root)** → Save.

## Đơn nhiều đôi (kiện)
- Mỗi dòng trong tab Đơn hàng là **một đôi**. Các dòng có **cùng Mã đơn** được app gom thành **một đơn** (kiện). Khi nhập tay trong Sheet, hãy ghi cùng mã ở mọi dòng, đừng gộp ô.
- **Đóng kèm viết tự do:** ô Đóng kèm gõ gì cũng được (ví dụ `2 tất đen + 1 bó gối`), có gợi ý bó gối, tất. Mỗi đôi có **ô ghi chú riêng**, và có **ghi chú chung cả đơn** khi tạo mới. Ghi chú hiện cho cả Shop và Kho (📝). Khi dán nhiều đơn: sau chữ **kèm** là đồ đóng kèm, sau **ghi chú** là ghi chú.
- **Sản phẩm và size gõ tay:** ô Sản phẩm có danh sách chọn (các mẫu chủ yếu) và mục **Khác (gõ tên)…** để gõ tên bất kỳ (ví dụ tất, bó gối hay mẫu mới); ô Size cũng gõ tự do (ví dụ `Free size`). Gõ trùng tên một mẫu có sẵn (kể cả viết thường) thì app tự nhận là mẫu đó. Muốn mẫu mới có sẵn trong danh sách chọn thì thêm vào tab Danh mục, cột Sản phẩm.
- **Nguồn hàng từng dòng:** mỗi dòng trong form Thêm đơn có lựa chọn **Lấy hàng mới** (mặc định) hoặc **Dùng hàng tồn**. Chọn hàng tồn thì app liệt kê các đôi tồn đúng mẫu (tự tick tối đa số đôi cần), các đôi được chọn sẽ **đánh dấu Đã dùng** (ghi ngày dùng và đơn đã dùng) và **trừ khỏi kho**. Đủ tồn bao nhiêu dùng bấy nhiêu, thiếu thì phần còn lại lấy hàng mới. Dòng tổng cuối form cho biết bao nhiêu đôi trừ kho. Dán nhiều đơn có ô "Tự dùng hàng tồn" (mặc định tắt).
- **Shop:** form Thêm đơn có nút **+ thêm đôi** và ô **số đôi** cho các đôi giống nhau. Có thể dán nhiều dòng cùng mã, thêm `x2` hoặc `2 đôi` cho số lượng. Nút **✎** để sửa đơn (mã, ngày, mẫu, size, màu, đóng kèm), hủy từng đôi hoặc hủy cả đơn, thêm đôi vào đơn có sẵn.
- **Kho:** tab Cần đóng hiển thị theo kiện, ví dụ "3 đôi, kèm 2 bó gối", tick từng đôi khi nhặt hàng, rồi bấm **Đã đóng cả kiện**. Có nút **Hết hàng** cho từng đôi và bảng **Tổng hợp cần lấy hàng**.
- Trạng thái của đơn lấy từ các đôi: đơn **Không có hàng** nếu có đôi hết hàng; **Đã hủy** khi hủy hết các đôi.
- Sửa đơn chỉ Shop/Chủ làm được; đơn đã giao chỉ Chủ sửa được. Đổi mẫu của một đôi đang dùng hàng tồn thì đôi tồn tự trả lại kho.

## Cách app làm việc với Sheet
- Sheet vẫn sửa tay bình thường được. App tự cập nhật sau tối đa 20 giây hoặc khi bấm "Tải lại".
- Dòng bạn gõ tay vào cuối tab Đơn hàng (chưa có ID) sẽ được app tự cấp ID và điền mặc định (Chờ đóng, Mới) ở lần tải kế tiếp.
- Mỗi thao tác kiểm tra trạng thái hiện tại: hai người cùng đổi một đơn thì người đến sau được báo "đơn vừa được người khác thay đổi" và dữ liệu được tải lại. Hai người cùng lấy một đôi tồn thì chỉ người đến trước được, người sau được tạo đơn như hàng mới.
- Phân quyền kiểm tra ở backend, không chỉ ẩn nút: Shop không đổi sang "Đã đóng", Kho không thêm đơn, Shop không nhập kho.
- Không xóa dòng nào trong Sheet của bạn. Muốn hủy đơn, dùng nút Hủy trong app hoặc đổi trạng thái thành "Đã hủy".
- Sheet càng nhiều dòng thì tải càng chậm; từ khoảng vài nghìn đơn nên sao lưu và chuyển đơn cũ sang một file khác.

## Bảo mật
- Mật khẩu chỉ được kiểm tra trong Apps Script. Trên máy người dùng, mật khẩu được nhớ trong trình duyệt cho đến khi bấm **Đăng xuất**.
- Hãy dùng mật khẩu đủ dài. Link Apps Script là công khai và chưa giới hạn số lần thử sai.
- Muốn thu hồi quyền của ai đó: đổi mật khẩu vai trò của họ và triển khai phiên bản mới.
