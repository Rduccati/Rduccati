export const money = (v: number | string | null | undefined, unit = true) => {
  const n = Number(v ?? 0);
  return (Number.isFinite(n) ? Math.round(n).toLocaleString('vi-VN') : '0') + (unit ? 'đ' : '');
};
export const shortMoney = (v: number) => {
  const n = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (n >= 1e9) return s + (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace('.', ',') + ' tỷ';
  if (n >= 1e6) return s + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace('.', ',') + ' tr';
  if (n >= 1e3) return s + Math.round(n / 1e3) + 'k';
  return s + n;
};
const TZ = 'Asia/Ho_Chi_Minh';
export const dateTime = (v?: string | null) => (v ? new Date(v).toLocaleString('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const date = (v?: string | null) => {
  if (!v) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-'); return `${d}/${m}/${y}`; }
  return new Date(v).toLocaleDateString('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
};
export const time = (v?: string | null) => (v ? new Date(v).toLocaleTimeString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—');
/** Ngày hôm nay theo giờ Việt Nam: YYYY-MM-DD */
export const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
export const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const monthStart = () => today().slice(0, 8) + '01';
export const pct = (v: number) => (Math.round(v * 1000) / 10).toLocaleString('vi-VN') + '%';
export const parseMoney = (s: string) => Number(String(s).replace(/[^\d-]/g, '')) || 0;

export const LABELS = {
  movement: { automatic: 'Automatic', quartz: 'Quartz', mechanical: 'Mechanical', solar: 'Solar', kinetic: 'Kinetic', spring_drive: 'Spring Drive', smart: 'Smartwatch' } as Record<string, string>,
  condition: { new: 'Mới', used: 'Đã qua sử dụng', repaired: 'Đã sửa chữa' } as Record<string, string>,
  serialStatus: { in_stock: 'Trong kho', sold: 'Đã bán', repairing: 'Đang sửa', exported: 'Đã xuất', returned_supplier: 'Đã trả' } as Record<string, string>,
  orderStatus: { completed: 'Hoàn thành', cancelled: 'Đã hủy', returned: 'Đã trả hàng', partial_returned: 'Trả một phần' } as Record<string, string>,
  method: { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' } as Record<string, string>,
  group: { normal: 'Thường', silver: 'Bạc', gold: 'Vàng', vip: 'VIP' } as Record<string, string>,
  docType: { import: 'Nhập hàng', export: 'Xuất hàng', transfer: 'Chuyển kho', stocktake: 'Kiểm kê', adjust: 'Điều chỉnh', consign_in: 'Nhận ký gửi', consign_return: 'Trả ký gửi', repair_out: 'Gửi sửa chữa', repair_in: 'Nhận từ sửa chữa' } as Record<string, string>,
  refType: { import: 'Nhập hàng', export: 'Xuất hàng', transfer: 'Chuyển kho', stocktake: 'Kiểm kê', adjust: 'Điều chỉnh', consign_in: 'Nhận ký gửi', consign_return: 'Trả ký gửi', repair_out: 'Gửi sửa', repair_in: 'Nhận từ sửa', sale: 'Bán hàng', sale_cancel: 'Hủy đơn', sale_return: 'Khách trả hàng' } as Record<string, string>,
  repairStatus: { received: 'Đã tiếp nhận', diagnosing: 'Đang kiểm tra', repairing: 'Đang sửa chữa', waiting_parts: 'Chờ linh kiện', done: 'Sửa xong – chờ giao', delivered: 'Đã giao khách', cancelled: 'Đã hủy' } as Record<string, string>,
  warrantyState: { active: 'Còn bảo hành', expired: 'Hết hạn', void: 'Đã hủy' } as Record<string, string>,
  attendance: { present: 'Đúng giờ', late: 'Đi muộn', leave: 'Nghỉ phép', absent: 'Vắng' } as Record<string, string>,
  careType: { call: 'Gọi điện', sms: 'SMS', zalo: 'Zalo', visit: 'Đến cửa hàng', email: 'Email', other: 'Khác' } as Record<string, string>,
  reminder: { maintenance: 'Bảo dưỡng định kỳ', battery: 'Thay pin', warranty_expiry: 'Sắp hết bảo hành', other: 'Khác' } as Record<string, string>,
};
