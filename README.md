# WATCH POS – Phần mềm quản lý bán hàng đồng hồ

Phần mềm POS chuyên biệt cho cửa hàng đồng hồ: quản lý **từng chiếc theo Serial Number**, kho với sổ cái bất biến, bán hàng nhanh bằng máy quét, bảo hành – sửa chữa, CRM, thu chi, báo cáo, phân quyền và chấm công.
100% mã nguồn mở, không dùng dịch vụ trả phí, dữ liệu lưu tại máy của cửa hàng.

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Giao diện | React 19 + TypeScript + Tailwind CSS 4, Recharts, lucide-react |
| Máy chủ | Node.js (Express 5) + TypeScript, Zod validation, JWT + bcrypt |
| Database | **PostgreSQL** – mặc định chạy PostgreSQL nhúng (PGlite, không cần cài đặt); chuyển sang PostgreSQL riêng / Supabase bằng 1 biến `DATABASE_URL` |
| In ấn | Print Preview của trình duyệt + PDF (pdfmake, font hỗ trợ tiếng Việt), mã vạch JsBarcode (Code 128, EAN-13) |
| Excel | ExcelJS (import/export) |

## Cài đặt & chạy trên Windows

1. Cài **Node.js LTS** (≥ 22) tại https://nodejs.org
2. Tải mã nguồn về máy, nháy đúp **`start-windows.bat`**
   – lần đầu sẽ tự cài thư viện và build giao diện (vài phút), sau đó mở trình duyệt `http://localhost:3000`.
3. Đăng nhập: **admin / admin123** → vào *Cài đặt → Tài khoản* để đổi mật khẩu ngay.

Hoặc chạy bằng dòng lệnh:

```bash
npm install
npm run build      # build giao diện
npm start          # chạy tại http://localhost:3000
```

Các máy khác trong cùng mạng LAN (máy bán hàng thứ 2, tablet, điện thoại) truy cập `http://<IP-máy-chủ>:3000`.
Điện thoại có thể "Thêm vào màn hình chính" để dùng như ứng dụng.

### Chế độ phát triển

```bash
npm run dev        # API :3000 + giao diện Vite :5173 (hot reload)
npm test           # 18 bài kiểm thử nghiệp vụ + mã hóa lệnh in (PostgreSQL trong bộ nhớ)
npm run typecheck
```

## Dữ liệu mẫu

Lần chạy đầu tiên hệ thống tự tạo dữ liệu mẫu (22 sản phẩm, ~75 serial, ~46 đơn hàng trong 60 ngày, khách hàng, sửa chữa, chấm công...) để kiểm tra toàn bộ chức năng. Tài khoản mẫu (mật khẩu `123456`):

| Tài khoản | Vai trò |
|---|---|
| `quanly` | Quản lý cửa hàng |
| `banhang1`, `banhang2` | Nhân viên bán hàng |
| `kho` | Quản lý kho |

Khi dùng thật: **Cài đặt → Dữ liệu mẫu → Xóa dữ liệu mẫu** (tự sao lưu trước khi xóa; giữ lại tài khoản, phân quyền, cài đặt). Muốn không tạo dữ liệu mẫu ngay từ đầu: đặt `SEED_SAMPLE=0` trong file `.env`.

## Dữ liệu, sao lưu, khôi phục

- Toàn bộ dữ liệu nằm trong thư mục **`data/`** (database `data/pgdata`, ảnh `data/uploads`, sao lưu `data/backups`).
- Hệ thống **tự sao lưu mỗi ngày** (giữ 30 bản). *Cài đặt → Sao lưu & khôi phục* để tải bản sao lưu (.json) về USB/Drive hoặc khôi phục.
- Trước mỗi lần khôi phục/xóa dữ liệu, hệ thống tự tạo bản sao lưu an toàn.

## Chuyển sang PostgreSQL riêng hoặc Supabase (miễn phí)

1. Tạo project Supabase (gói Free) hoặc cài PostgreSQL 15+.
2. Sao chép `.env.example` → `.env`, điền `DATABASE_URL=postgresql://...` (Supabase: *Project Settings → Database → Connection string*, thêm `?sslmode=require`).
3. Chạy `npm start` – schema được tạo tự động. Chuyển dữ liệu cũ: tải bản sao lưu từ hệ thống cũ → khôi phục trên hệ thống mới.

Toàn bộ bộ test đã chạy đạt trên cả PGlite và PostgreSQL 16 thật.

## Chức năng chính

- **Tổng quan**: doanh thu hôm nay/tháng, đơn hàng, tồn kho & giá trị tồn, lợi nhuận gộp, khách hàng, sản phẩm bán chạy, tồn kho lâu, biểu đồ theo ngày/tuần/tháng/năm, đơn mới nhất, cảnh báo.
- **Sản phẩm**: đầy đủ thông số đồng hồ (thương hiệu, model, reference, serial, movement number, bộ máy, đường kính, chất liệu vỏ/dây, tình trạng, giá nhập/vốn/bán/KM, ảnh, bảo hành, NCC, SKU, barcode); thêm/sửa/xóa/nhân bản, lọc, import/export Excel, lịch sử giá & lịch sử nhập xuất.
- **Serial độc lập**: mỗi chiếc đồng hồ có serial, giá vốn, tình trạng, kho, trạng thái riêng – kể cả cùng model.
- **Kho**: nhập (công nợ NCC, giá vốn bình quân), xuất, chuyển kho, kiểm kê (theo serial hoặc số lượng), điều chỉnh, ký gửi (nhận / trả / thanh toán người ký gửi), gửi sửa & nhận về, cảnh báo sắp hết & tồn lâu.
  **Tồn kho chỉ thay đổi qua sổ cái `stock_movements`** – trigger trong database chặn mọi sửa trực tiếp và chặn sửa/xóa lịch sử.
- **POS**: quét barcode/SKU/serial bằng máy quét (Enter), nhiều đơn chờ, giảm giá dòng / đơn (tiền hoặc %), mã khuyến mãi, chọn/tạo nhanh khách hàng, tiền mặt + chuyển khoản + thẻ (kết hợp), tiền khách đưa/tiền thừa, bán nợ, ca bán hàng & đối soát tiền mặt; phím tắt F2/F3/F4/F8/F9.
- **Hóa đơn**: K80, K58, A5 – xem trước, in qua trình duyệt, PDF, in lại (ghi lịch sử), hủy đơn & trả hàng có lịch sử, tùy chỉnh logo/thông tin cửa hàng.
- **Mã vạch & tem**: tự sinh SKU, barcode EAN-13 (check digit chuẩn) / Code 128 duy nhất; thiết kế tem (kích thước, cột, nội dung), xem trước, in lẻ/hàng loạt/theo tồn kho, xuất PDF (A4 hoặc cuộn tem).
- **Khách hàng (CRM)**: hồ sơ, nhóm VIP/Vàng/Bạc, lịch sử mua, tổng chi tiêu, số lần mua, sở thích, lịch sử chăm sóc, công nợ & thu nợ, lọc sinh nhật, xuất Excel.
- **Bảo hành & hậu mãi**: phiếu bảo hành tự tạo khi bán (liên kết serial), tạo/gia hạn thủ công, in phiếu bảo hành; phiếu nhận sửa chữa (in 2 liên), linh kiện thay thế, tiến độ, đặt cọc/thu tiền/hoàn cọc; nhắc lịch bảo dưỡng đồng hồ cơ; tra cứu nhanh theo serial/SĐT.
- **Nhà cung cấp**: hồ sơ, lịch sử nhập, tổng giá trị nhập, công nợ phải trả, lịch sử thanh toán, import/export Excel.
- **Thu chi**: phiếu thu/chi, tiền mặt/ngân hàng, sổ quỹ đầu kỳ–cuối kỳ, công nợ khách/NCC/ký gửi, tổng kết ca.
- **Báo cáo** (Excel/PDF): lãi lỗ – phân biệt *doanh thu thuần, lợi nhuận gộp, chi phí, lợi nhuận ròng, dòng tiền*; doanh thu theo kỳ; lợi nhuận theo sản phẩm; thương hiệu; tồn kho & giá trị tồn; hiệu quả nhân viên; khách hàng mua nhiều.
- **Nhân viên & phân quyền**: 4 vai trò mặc định + tạo vai trò tùy chỉnh với 26 quyền theo chức năng (VD ẩn giá vốn với nhân viên bán hàng); ghi nhận người tạo/sửa đơn; lịch sử thao tác.
- **Chấm công (kiểu Atwork)**: check-in/out có GPS và bán kính cho phép, ca làm việc, tính đi muộn/về sớm/giờ làm, bảng công tháng (Excel), điều chỉnh công, đơn xin nghỉ & duyệt.
- **Cài đặt**: thông tin cửa hàng & logo, mẫu hóa đơn, mẫu tem, cấu hình barcode, máy in, kho, chấm công, khuyến mãi, thương hiệu, sao lưu/khôi phục, đổi mật khẩu, lịch sử hoạt động.

## Máy in & thiết bị

👉 Hướng dẫn kết nối & test từng bước: **[HUONG-DAN-MAY-IN.md](HUONG-DAN-MAY-IN.md)** (Xprinter X350B in tem, iMin M2 Pro in bill).

- **In tem trực tiếp (TSPL):** máy tem cắm USB vào máy tính chủ. Máy chủ gửi lệnh RAW qua Windows Print Spooler (`server/routes/printing.ts`, không cần thư viện cài thêm). Linux/macOS dùng CUPS `lp -o raw`.
- **In bill trực tiếp (ESC/POS):** qua máy tính chủ (máy bill USB), hoặc trên Android gửi sang app **RawBT** (iMin M2 Pro và các máy POS Android có máy in tích hợp).
- Tem và bill được dựng thành **ảnh 1-bit** (`src/lib/raster.ts`), nên in tiếng Việt chuẩn trên mọi máy in nhiệt.
- Mỗi thiết bị có cấu hình máy in riêng: **Cài đặt → Máy in & in thử**, có ảnh xem trước và nút in thử.
- Dự phòng: in qua hộp thoại của trình duyệt (driver) và xuất PDF.
- Quét mã vạch: máy quét USB/Bluetooth dạng bàn phím, hoặc **camera** trên Android (Chrome BarcodeDetector).

## Bảo mật

Mật khẩu băm bcrypt; phiên JWT 12 giờ; chống dò mật khẩu (khóa 5 phút sau 5 lần sai); phân quyền kiểm tra ở máy chủ; ẩn giá vốn theo quyền; mọi thao tác quan trọng ghi lịch sử (người, thời gian, IP). Khi mở ra Internet nên đặt sau HTTPS (Caddy/Nginx) và đặt `JWT_SECRET`.

## Cấu trúc thư mục

```
server/            API Node.js
  schema.sql       Schema PostgreSQL (bảng, ràng buộc, trigger sổ kho)
  db.ts            Kết nối PGlite / PostgreSQL
  services/        Nghiệp vụ: kho, bán hàng, sao lưu
  routes/          API theo module
  seed.ts          Dữ liệu mẫu
src/               Giao diện React
  pages/           Các màn hình
  components/      UI dùng chung
  lib/             API client, định dạng, Printer Service, mẫu in
tests/             Kiểm thử nghiệp vụ
```
