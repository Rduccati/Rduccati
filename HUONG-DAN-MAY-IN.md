# Hướng dẫn kết nối & test máy in – WATCH POS

Thiết bị tại cửa hàng:

| Thiết bị | Vai trò | Kết nối | Cách WATCH POS in |
|---|---|---|---|
| **Xprinter X350B** (Thermal Barcode Printer, 20–82mm, 203 DPI, USB) | In **tem sản phẩm** | Cắm USB vào **máy tính chạy WATCH POS** | Máy chủ gửi lệnh **TSPL** thẳng tới máy in qua Windows (không hiện hộp thoại in) |
| **iMin M2 Pro** (Android, máy in nhiệt 58mm tích hợp) | Bán hàng cầm tay + in **bill** | Wi-Fi cùng mạng với máy tính | Dùng WATCH POS qua Chrome, bill gửi dạng ảnh **ESC/POS** sang app **RawBT** → máy in tích hợp |

Tem và bill được dựng thành ảnh trước khi gửi tới máy in. Nhờ vậy **tiếng Việt có dấu in đúng**, không phụ thuộc bảng mã của máy in.
Cấu hình máy in **lưu riêng trên từng thiết bị**: máy tính cấu hình máy tem, iMin cấu hình máy bill.

---

## PHẦN A – Chuẩn bị máy tính chủ (Windows)

1. Chạy WATCH POS bằng `start-windows.bat`. Giữ cửa sổ đen mở trong suốt thời gian dùng.
2. Lấy địa chỉ IP của máy tính: mở **cmd** → gõ `ipconfig` → ghi lại **IPv4 Address** (ví dụ `192.168.1.10`).
3. Mở cổng 3000 cho máy iMin truy cập. Mở **PowerShell (Run as administrator)** và chạy:
   ```powershell
   New-NetFirewallRule -DisplayName "WATCH POS" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```
4. (Nên làm) Vào trang quản trị router, gán **IP cố định** cho máy tính để địa chỉ không bị đổi.

✅ **Kiểm tra A:** trên máy tính, mở `http://localhost:3000` và đăng nhập được.

---

## PHẦN B – Máy in tem Xprinter X350B

### B1. Cài driver
1. Cài driver Xprinter, chọn model **XP-350B** (đĩa kèm máy hoặc trang hỗ trợ của Xprinter).
2. Cắm cáp USB và bật nguồn máy in (24V).
3. Mở **Settings → Bluetooth & devices → Printers & scanners** → phải thấy máy in (ví dụ "Xprinter XP-350B"). Ghi lại **đúng tên** máy in.

### B2. Lắp tem & cân chỉnh
1. Lắp cuộn tem, mặt in hướng lên, chỉnh 2 thanh gạt sát mép cuộn tem.
2. Cân chỉnh khe tem (calibrate) theo hướng dẫn trong sách của máy. Thông thường là **giữ nút FEED** khi bật nguồn, hoặc nhấn FEED 2 lần, để máy tự đo khe giữa 2 tem.
3. Đo kích thước **1 tem thật**: rộng × cao (mm) và khe giữa 2 tem (thường 2mm).

### B3. Khai báo kích thước tem trong WATCH POS (làm trên máy tính)
1. Vào **Mã vạch & In tem**.
2. Nhập **Rộng / Cao** đúng như tem thật (ví dụ 50 × 30), **Khổ giấy = Cuộn tem**.
3. Chọn thông tin muốn in trên tem: thương hiệu, model, giá, SKU, barcode.
4. Bấm **Lưu làm mẫu tem mặc định**.

### B4. Chọn máy in (làm trên máy tính)
1. Vào **Cài đặt → Máy in & in thử → Máy in tem sản phẩm**.
2. **Cách in** = *In thẳng TSPL qua máy tính chủ*.
3. **Máy in** = chọn tên X350B (bấm 🔄 nếu danh sách trống). Khoảng cách tem = 2mm, Độ đậm = 10.
4. Bấm **Lưu**.

### B5. Bốn bài test tem
| # | Bấm nút | Kết quả đúng | Nếu sai |
|---|---|---|---|
| 1 | **Kiểm tra lệnh TSPL gốc** | Tem có khung viền, chữ `WATCH POS TSPL OK` và 1 mã vạch | Không ra gì: kiểm tra lại tên máy in. Nếu vẫn không ra gì, máy in có thể không ở chế độ TSPL: in trang tự kiểm tra (giữ FEED khi bật máy) xem dòng "Emulation/Language" |
| 2 | **In thử 1 tem** | Giống ảnh xem trước bên phải, rõ nét, có dấu tiếng Việt | Nền đen chữ trắng → bật **Đảo màu**. In ngược → bật **Xoay 180°**. Lệch trái/phải → chỉnh **Lệch ngang** (8 chấm = 1mm). Mờ → tăng **Độ đậm** |
| 3 | **In thử 3 tem liên tiếp** | 3 tem, mỗi tem dừng đúng khe, không nhảy tem | Chỉnh lại khoảng cách tem, cân chỉnh lại (B2) |
| 4 | Vào **Mã vạch & In tem** → thêm 1 sản phẩm thật → **In 1 tem**. Sau đó ra **POS** quét tem vừa in bằng máy quét hoặc camera iMin | POS thêm đúng sản phẩm đó vào giỏ | Mã vạch quá nhỏ → tăng kích thước tem hoặc tắt bớt dòng chữ |

### B6. In hàng loạt
Vào **Mã vạch & In tem** → **In theo danh sách tồn kho** (số tem = số lượng tồn) → **In N tem**.

> **Phương án dự phòng** (chỉ dùng khi TSPL không chạy): chọn Cách in = *Hộp thoại in của trình duyệt*.
> 1. Trong driver: **Printing preferences → Page Setup → New**, tạo khổ giấy đúng kích thước tem.
> 2. Khi in: chọn máy X350B, khổ giấy vừa tạo, **Margins = None**, **Scale = 100%**.

---

## PHẦN C – Máy bill iMin M2 Pro (58mm)

### C1. Mở WATCH POS trên iMin
1. Kết nối iMin vào **cùng Wi-Fi** với máy tính.
2. Mở **Chrome** → vào `http://192.168.1.10:3000` (thay bằng IP ở bước A2) → đăng nhập.
3. Menu ⋮ → **Thêm vào màn hình chính** để mở nhanh như một app.

### C2. Cài RawBT
1. Cài app **RawBT** (gói `ru.a402d.rawbtprinter`) từ Google Play.
2. Mở RawBT → **Settings → Connection / Printer**: chọn **máy in tích hợp** của thiết bị (tên có thể là *Built-in*, *Inner printer*, *iMin*... tùy phiên bản).
3. Đặt khổ giấy **58mm**, độ rộng **384 chấm**.
4. Bấm **Test print trong RawBT** để chắc RawBT in ra được máy tích hợp.
   ⚠️ Chưa xác minh được RawBT có hỗ trợ máy in tích hợp của iMin M2 Pro hay không. Nếu RawBT **không có lựa chọn này**, chuyển sang **C5**.

### C3. Cấu hình trong WATCH POS (làm trên iMin)
1. Vào **Cài đặt → Máy in & in thử → Máy in hóa đơn**.
2. **Cách in** = *Android: gửi sang app RawBT*, **Khổ giấy** = *K58*.
3. Bấm **Lưu**.

### C4. Ba bài test bill
| # | Thao tác | Kết quả đúng | Nếu sai |
|---|---|---|---|
| 1 | **Thử kết nối RawBT** | Ra dòng `WATCH POS - KET NOI RAWBT OK`. Lần đầu Android hỏi mở bằng app nào → chọn **RawBT → Luôn luôn** | Báo chưa cài app → cài lại RawBT. RawBT mở nhưng không in → xem lại C2 |
| 2 | **In thử hóa đơn** | Bill 58mm có logo/tên cửa hàng, **tiếng Việt có dấu**, mã vạch mã đơn | Chữ bị cắt mép → kiểm tra RawBT đang để 384 chấm/58mm |
| 3 | Bán thử 1 đơn ở POS → **In hóa đơn** | In đúng đơn vừa bán | Muốn in tự động sau mỗi đơn → bật *Tự động in bill sau khi thanh toán* |

### C5. Phương án dự phòng cho iMin
- **Cách 1:** Cách in = *Hộp thoại in của trình duyệt* → In thử. Trong hộp thoại của Android, chọn máy in tích hợp (nếu máy có dịch vụ in) hoặc *RawBT* (RawBT có dịch vụ in Android), chọn khổ 58mm.
- **Cách 2:** iMin có **bộ SDK in cho web (JavaScript) chính thức**. Nếu cả RawBT lẫn hộp thoại in đều không in được, hãy báo tôi. Môi trường làm việc hiện tại của tôi đang chặn tên miền tài liệu của iMin (`oss-sg.imin.sg`); bạn cho phép tên miền này trong cài đặt mạng, tôi sẽ đọc tài liệu và tích hợp trực tiếp.

---

## PHẦN D – Quét mã vạch bằng camera iMin & GPS chấm công

Chrome chỉ cho dùng camera/GPS trên kết nối an toàn. Với mạng nội bộ (http), cần bật một lần:
1. Trên iMin, mở Chrome → gõ `chrome://flags` → tìm **Insecure origins treated as secure**.
2. Nhập `http://192.168.1.10:3000` → chọn **Enabled** → **Relaunch**.
3. Ở POS, bấm biểu tượng 📷 trong ô tìm kiếm → đưa mã vạch vào khung → sản phẩm tự thêm vào giỏ.

Máy tính quầy dùng **máy quét mã vạch USB** cắm vào là chạy ngay: quét tại ô "Quét mã vạch" (phím **F3**).

---

## PHẦN E – Kịch bản test tổng (đánh dấu khi đạt)

- [ ] A: Máy tính mở `localhost:3000`, iMin mở `http://IP:3000` được
- [ ] B5-1: Lệnh TSPL gốc ra tem
- [ ] B5-2: In thử 1 tem rõ nét, đúng hướng, đúng màu
- [ ] B5-3: 3 tem liên tiếp đúng khe
- [ ] B5-4: Tem in ra quét được ở POS
- [ ] C4-1: iMin kết nối RawBT
- [ ] C4-2: Bill thử tiếng Việt chuẩn
- [ ] C4-3: Bán 1 đơn thật trên iMin và in bill
- [ ] D: Quét camera trên iMin thêm được sản phẩm
- [ ] Nhập 1 lô hàng trên máy tính → in tem → bán trên iMin → in bill → đóng ca → xem báo cáo

Gửi lại tôi **ảnh chụp tem/bill thực tế** và **ghi chú bước nào lỗi**, tôi sẽ chỉnh tiếp.
