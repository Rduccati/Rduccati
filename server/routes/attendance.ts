/** Chấm công: check-in/check-out theo GPS, ca làm việc, bảng công, đơn xin nghỉ */
import { Router } from 'express';
import { z } from 'zod';
import { db, type Queryable } from '../db.ts';
import { audit, badRequest, hasPerm, notFound, requirePerm, getSetting, zOptStr } from '../core.ts';
import { sendExcel } from '../excel.ts';

export const router = Router();

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

async function checkLocation(lat?: number | null, lng?: number | null) {
  const cfg = await getSetting<any>('attendance', {});
  if (!cfg.store_lat || !cfg.store_lng) return { distance: null };
  if (lat == null || lng == null) {
    if (cfg.require_location) throw badRequest('Cần bật định vị (GPS) để chấm công');
    return { distance: null };
  }
  const d = distanceM(Number(cfg.store_lat), Number(cfg.store_lng), lat, lng);
  const radius = Number(cfg.radius_m) || 200;
  if (cfg.require_location && d > radius) throw badRequest(`Bạn đang cách cửa hàng ${d}m (cho phép ${radius}m). Không thể chấm công.`);
  return { distance: d };
}

async function recompute(q: Queryable, id: number) {
  const r = (await q.query(`SELECT a.*, ws.start_time, ws.end_time, ws.grace_minutes FROM attendance_records a LEFT JOIN work_shifts ws ON ws.id=a.work_shift_id WHERE a.id=$1`, [id])).rows[0];
  if (!r || r.status === 'leave' || r.status === 'absent') return;
  const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600_000) : null);
  const ci = local(r.check_in);
  const co = local(r.check_out);
  let late = 0, early = 0, work = 0;
  if (ci && r.start_time) {
    const m = ci.getUTCHours() * 60 + ci.getUTCMinutes();
    const diff = m - toMin(r.start_time);
    late = diff > Number(r.grace_minutes || 0) ? diff : 0;
  }
  if (co && r.end_time) {
    const m = co.getUTCHours() * 60 + co.getUTCMinutes();
    early = Math.max(0, toMin(r.end_time) - m);
  }
  if (ci && co) work = Math.max(0, Math.round((co.getTime() - ci.getTime()) / 60000));
  await q.query(`UPDATE attendance_records SET late_minutes=$2, early_minutes=$3, work_minutes=$4, status=$5 WHERE id=$1`, [id, late, early, work, late > 0 ? 'late' : 'present']);
}

router.get('/attendance/today', async (req, res) => {
  const rec = (await db().query(`SELECT a.*, ws.name shift_name, ws.start_time, ws.end_time FROM attendance_records a LEFT JOIN work_shifts ws ON ws.id=a.work_shift_id
      WHERE a.user_id=$1 AND a.work_date=current_date`, [req.user!.id])).rows[0] ?? null;
  const shift = (await db().query(`SELECT ws.* FROM users u LEFT JOIN work_shifts ws ON ws.id=u.work_shift_id WHERE u.id=$1`, [req.user!.id])).rows[0];
  const cfg = await getSetting<any>('attendance', {});
  const history = (await db().query(`SELECT * FROM attendance_records WHERE user_id=$1 ORDER BY work_date DESC LIMIT 14`, [req.user!.id])).rows;
  res.json({ record: rec, shift: shift?.id ? shift : null, config: { has_location: !!(cfg.store_lat && cfg.store_lng), require_location: !!cfg.require_location, radius_m: cfg.radius_m ?? 200 }, history });
});

const geo = z.object({ lat: z.number().min(-90).max(90).optional().nullable(), lng: z.number().min(-180).max(180).optional().nullable(), note: zOptStr });
router.post('/attendance/check-in', async (req, res) => {
  const b = geo.parse(req.body);
  const { distance } = await checkLocation(b.lat, b.lng);
  const out = await db().tx(async (q) => {
    const ex = (await q.query(`SELECT * FROM attendance_records WHERE user_id=$1 AND work_date=current_date`, [req.user!.id])).rows[0];
    if (ex?.check_in) throw badRequest('Bạn đã check-in hôm nay');
    const shift = (await q.query(`SELECT work_shift_id FROM users WHERE id=$1`, [req.user!.id])).rows[0];
    const r = ex
      ? await q.query(`UPDATE attendance_records SET check_in=now(), check_in_lat=$2, check_in_lng=$3, check_in_distance=$4, note=coalesce($5,note), status='present' WHERE id=$1 RETURNING *`, [ex.id, b.lat ?? null, b.lng ?? null, distance, b.note])
      : await q.query(`INSERT INTO attendance_records(user_id, work_date, work_shift_id, check_in, check_in_lat, check_in_lng, check_in_distance, note)
          VALUES ($1, current_date, $2, now(), $3, $4, $5, $6) RETURNING *`, [req.user!.id, shift?.work_shift_id ?? null, b.lat ?? null, b.lng ?? null, distance, b.note]);
    await recompute(q, r.rows[0].id);
    return (await q.query(`SELECT * FROM attendance_records WHERE id=$1`, [r.rows[0].id])).rows[0];
  });
  await audit(req, 'checkin', 'attendance', out.id, `Check-in${distance != null ? ` (cách cửa hàng ${distance}m)` : ''}`);
  res.json(out);
});
router.post('/attendance/check-out', async (req, res) => {
  const b = geo.parse(req.body);
  const { distance } = await checkLocation(b.lat, b.lng);
  const out = await db().tx(async (q) => {
    const ex = (await q.query(`SELECT * FROM attendance_records WHERE user_id=$1 AND work_date=current_date`, [req.user!.id])).rows[0];
    if (!ex?.check_in) throw badRequest('Bạn chưa check-in hôm nay');
    await q.query(`UPDATE attendance_records SET check_out=now(), check_out_lat=$2, check_out_lng=$3, check_out_distance=$4, note=coalesce($5,note) WHERE id=$1`, [ex.id, b.lat ?? null, b.lng ?? null, distance, b.note]);
    await recompute(q, ex.id);
    return (await q.query(`SELECT * FROM attendance_records WHERE id=$1`, [ex.id])).rows[0];
  });
  await audit(req, 'checkout', 'attendance', out.id, `Check-out (${Math.round(out.work_minutes / 6) / 10} giờ)`);
  res.json(out);
});

/** Bảng công theo tháng */
router.get('/attendance', async (req, res) => {
  const month = String(req.query.month || new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('Tháng không hợp lệ');
  const canAll = hasPerm(req.user, 'staff.view');
  const userId = canAll ? (req.query.user_id ? Number(req.query.user_id) : null) : req.user!.id;
  const p: any[] = [month + '-01'];
  let cond = `a.work_date >= $1::date AND a.work_date < ($1::date + interval '1 month')`;
  if (userId) { p.push(userId); cond += ` AND a.user_id=$2`; }
  const rows = (await db().query(`SELECT a.*, u.full_name, ws.name shift_name, ab.full_name adjusted_by_name FROM attendance_records a JOIN users u ON u.id=a.user_id
      LEFT JOIN work_shifts ws ON ws.id=a.work_shift_id LEFT JOIN users ab ON ab.id=a.adjusted_by WHERE ${cond} ORDER BY a.work_date DESC, u.full_name`, p)).rows;
  const summary = (await db().query(`SELECT u.id user_id, u.full_name,
      count(a.id) FILTER (WHERE a.status IN ('present','late')) work_days,
      count(a.id) FILTER (WHERE a.status='late') late_days,
      count(a.id) FILTER (WHERE a.status='leave') leave_days,
      count(a.id) FILTER (WHERE a.status='absent') absent_days,
      coalesce(sum(a.late_minutes),0) late_minutes, coalesce(sum(a.early_minutes),0) early_minutes, coalesce(sum(a.work_minutes),0) work_minutes,
      count(a.id) FILTER (WHERE a.check_in IS NOT NULL AND a.check_out IS NULL AND a.work_date < current_date) missing_checkout
      FROM users u LEFT JOIN attendance_records a ON a.user_id=u.id AND ${cond.replace(/\ba\.user_id=\$2/, 'true')}
      WHERE u.is_active ${userId ? 'AND u.id=$2' : ''} GROUP BY u.id, u.full_name ORDER BY u.full_name`, p)).rows;
  if (req.query.format === 'xlsx') {
    const st: Record<string, string> = { present: 'Đúng giờ', late: 'Đi muộn', leave: 'Nghỉ phép', absent: 'Vắng' };
    const t = (v: string | null) => (v ? new Date(v).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }) : '');
    return sendExcel(res, `bang-cong-${month}.xlsx`, 'Bảng công', [
      { header: 'Ngày', key: 'work_date', width: 12 }, { header: 'Nhân viên', key: 'full_name', width: 22 }, { header: 'Ca', key: 'shift_name', width: 14 },
      { header: 'Vào', key: 'ci' }, { header: 'Ra', key: 'co' }, { header: 'Đi muộn (phút)', key: 'late_minutes' }, { header: 'Về sớm (phút)', key: 'early_minutes' },
      { header: 'Giờ làm', key: 'hours' }, { header: 'Trạng thái', key: 'st' }, { header: 'Ghi chú', key: 'note', width: 30 },
    ], rows.map((r: any) => ({ ...r, ci: t(r.check_in), co: t(r.check_out), hours: Math.round(r.work_minutes / 6) / 10, st: st[r.status] })));
  }
  res.json({ month, rows, summary });
});

const adjustSchema = z.object({
  user_id: z.coerce.number().int().positive().optional(),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  check_in: z.string().optional().nullable(), // HH:MM
  check_out: z.string().optional().nullable(),
  status: z.enum(['present', 'late', 'absent', 'leave']).optional(),
  work_shift_id: z.coerce.number().int().positive().optional().nullable(),
  note: zOptStr,
});
function toTs(date: string, hm?: string | null) {
  if (!hm) return null;
  if (!/^\d{2}:\d{2}$/.test(hm)) throw badRequest('Giờ không hợp lệ (HH:MM)');
  return `${date}T${hm}:00+07:00`;
}
router.post('/attendance', requirePerm('staff.edit'), async (req, res) => {
  const b = adjustSchema.parse(req.body);
  if (!b.user_id || !b.work_date) throw badRequest('Chọn nhân viên và ngày');
  const out = await db().tx(async (q) => {
    const shift = b.work_shift_id ?? (await q.query(`SELECT work_shift_id FROM users WHERE id=$1`, [b.user_id])).rows[0]?.work_shift_id ?? null;
    const r = (await q.query(`INSERT INTO attendance_records(user_id, work_date, work_shift_id, check_in, check_out, status, note, adjusted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.user_id, b.work_date, shift, toTs(b.work_date!, b.check_in), toTs(b.work_date!, b.check_out), b.status ?? 'present', b.note, req.user!.id])).rows[0];
    await recompute(q, r.id);
    return r;
  });
  await audit(req, 'create', 'attendance', out.id, `Thêm công thủ công cho NV #${b.user_id} ngày ${b.work_date}`);
  res.json(out);
});
router.put('/attendance/:id', requirePerm('staff.edit'), async (req, res) => {
  const b = adjustSchema.parse(req.body);
  await db().tx(async (q) => {
    const r = (await q.query(`SELECT * FROM attendance_records WHERE id=$1`, [req.params.id])).rows[0];
    if (!r) throw notFound();
    const d = r.work_date;
    await q.query(`UPDATE attendance_records SET check_in=$2, check_out=$3, status=$4, note=$5, work_shift_id=$6, adjusted_by=$7 WHERE id=$1`,
      [r.id, toTs(d, b.check_in), toTs(d, b.check_out), b.status ?? r.status, b.note, b.work_shift_id ?? r.work_shift_id, req.user!.id]);
    await recompute(q, r.id);
  });
  await audit(req, 'update', 'attendance', req.params.id as string, `Điều chỉnh chấm công #${req.params.id}`, b);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Ca làm việc
router.get('/work-shifts', async (_req, res) => res.json((await db().query(`SELECT * FROM work_shifts ORDER BY start_time`)).rows));
const wsSchema = z.object({
  name: z.string().trim().min(1, 'Nhập tên ca'), start_time: z.string().regex(/^\d{2}:\d{2}/, 'Giờ bắt đầu HH:MM'), end_time: z.string().regex(/^\d{2}:\d{2}/, 'Giờ kết thúc HH:MM'),
  grace_minutes: z.coerce.number().int().min(0).max(120).default(10), is_active: z.boolean().default(true),
});
router.post('/work-shifts', requirePerm('staff.edit'), async (req, res) => {
  const b = wsSchema.parse(req.body);
  const r = await db().query(`INSERT INTO work_shifts(name, start_time, end_time, grace_minutes, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [b.name, b.start_time, b.end_time, b.grace_minutes, b.is_active]);
  await audit(req, 'create', 'work_shift', r.rows[0].id, `Tạo ca ${b.name}`);
  res.json(r.rows[0]);
});
router.put('/work-shifts/:id', requirePerm('staff.edit'), async (req, res) => {
  const b = wsSchema.parse(req.body);
  await db().query(`UPDATE work_shifts SET name=$2, start_time=$3, end_time=$4, grace_minutes=$5, is_active=$6 WHERE id=$1`, [req.params.id, b.name, b.start_time, b.end_time, b.grace_minutes, b.is_active]);
  await audit(req, 'update', 'work_shift', req.params.id as string, `Sửa ca ${b.name}`);
  res.json({ ok: true });
});
router.delete('/work-shifts/:id', requirePerm('staff.edit'), async (req, res) => {
  await db().query(`DELETE FROM work_shifts WHERE id=$1`, [req.params.id]);
  await audit(req, 'delete', 'work_shift', req.params.id as string, 'Xóa ca làm việc');
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Đơn xin nghỉ
router.get('/leave-requests', async (req, res) => {
  const all = hasPerm(req.user, 'staff.edit');
  const rows = (await db().query(`SELECT l.*, u.full_name, rv.full_name reviewed_by_name FROM leave_requests l JOIN users u ON u.id=l.user_id LEFT JOIN users rv ON rv.id=l.reviewed_by
      ${all ? '' : 'WHERE l.user_id=$1'} ORDER BY l.id DESC LIMIT 200`, all ? [] : [req.user!.id])).rows;
  res.json(rows);
});
router.post('/leave-requests', async (req, res) => {
  const b = z.object({ from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Chọn ngày'), to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Chọn ngày'), reason: z.string().trim().min(1, 'Nhập lý do') })
    .refine((v) => v.to_date >= v.from_date, { message: 'Ngày kết thúc phải sau ngày bắt đầu', path: ['to_date'] }).parse(req.body);
  const r = await db().query(`INSERT INTO leave_requests(user_id, from_date, to_date, reason) VALUES ($1,$2,$3,$4) RETURNING *`, [req.user!.id, b.from_date, b.to_date, b.reason]);
  await audit(req, 'create', 'leave_request', r.rows[0].id, `Xin nghỉ ${b.from_date} → ${b.to_date}`);
  res.json(r.rows[0]);
});
router.post('/leave-requests/:id/review', requirePerm('staff.edit'), async (req, res) => {
  const b = z.object({ status: z.enum(['approved', 'rejected']) }).parse(req.body);
  await db().tx(async (q) => {
    const l = (await q.query(`SELECT * FROM leave_requests WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!l) throw notFound();
    if (l.status !== 'pending') throw badRequest('Đơn đã được xử lý');
    await q.query(`UPDATE leave_requests SET status=$2, reviewed_by=$3 WHERE id=$1`, [l.id, b.status, req.user!.id]);
    if (b.status === 'approved') {
      await q.query(`INSERT INTO attendance_records(user_id, work_date, status, note, adjusted_by)
          SELECT $1, d::date, 'leave', $4, $5 FROM generate_series($2::date, $3::date, '1 day') d
          ON CONFLICT (user_id, work_date) DO UPDATE SET status='leave', note=EXCLUDED.note`, [l.user_id, l.from_date, l.to_date, `Nghỉ phép: ${l.reason ?? ''}`, req.user!.id]);
    }
  });
  await audit(req, 'update', 'leave_request', req.params.id as string, `${b.status === 'approved' ? 'Duyệt' : 'Từ chối'} đơn nghỉ #${req.params.id}`);
  res.json({ ok: true });
});
