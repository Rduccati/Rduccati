import { useEffect, useState } from 'react';
import { LogIn, LogOut, MapPin, Send, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, LABELS, time, today } from '../lib/format';
import { Badge, Field, Loading, PageHeader, Textarea, cx, useFetch, useSubmit, useUi } from '../components/ui';

function getPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { enableHighAccuracy: true, timeout: 10000 });
  });
}

/** Chấm công cá nhân (kiểu Atwork): check-in/out có GPS, lịch sử, xin nghỉ */
export default function Attendance() {
  const { user } = useAuth();
  const { toast } = useUi();
  const { data, loading, reload } = useFetch(() => api.get('/attendance/today'), []);
  const { data: leaves, reload: reloadLeaves } = useFetch(() => api.get('/leave-requests'), []);
  const [now, setNow] = useState(new Date());
  const [note, setNote] = useState('');
  const [leave, setLeave] = useState({ from_date: today(), to_date: today(), reason: '' });
  const { busy, run } = useSubmit();
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const punch = async (kind: 'check-in' | 'check-out') => {
    const pos = await getPosition();
    if (!pos && data?.config.require_location) return toast.error('Cần cho phép truy cập vị trí (GPS) để chấm công');
    const r = await run(() => api.post(`/attendance/${kind}`, { lat: pos?.lat ?? null, lng: pos?.lng ?? null, note: note || null }), kind === 'check-in' ? 'Check-in thành công' : 'Check-out thành công');
    if (r) { setNote(''); reload(); }
  };
  if (loading || !data) return <Loading />;
  const rec = data.record;
  return (
    <div>
      <PageHeader title="Chấm công" subtitle={`${user?.full_name} · ${data.shift ? `${data.shift.name} (${data.shift.start_time.slice(0, 5)}–${data.shift.end_time.slice(0, 5)})` : 'Chưa gán ca làm việc'}`} />
      <div className="grid lg:grid-cols-[420px_1fr] gap-5">
        <div className="space-y-5">
          <div className="rounded-3xl bg-ink-900 text-ivory-50 p-6 text-center">
            <div className="text-xs uppercase tracking-[0.25em] text-gold-400">{now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</div>
            <div className="font-display text-6xl font-semibold mt-2 tabular-nums">{now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            <div className="grid grid-cols-2 gap-3 mt-6 text-sm">
              <div className="rounded-2xl bg-ink-800 p-3"><div className="text-ink-400 text-xs">Giờ vào</div><div className="text-lg font-semibold">{time(rec?.check_in)}</div>{rec?.late_minutes > 0 && <div className="text-amber-400 text-xs">Muộn {rec.late_minutes} phút</div>}</div>
              <div className="rounded-2xl bg-ink-800 p-3"><div className="text-ink-400 text-xs">Giờ ra</div><div className="text-lg font-semibold">{time(rec?.check_out)}</div>{rec?.work_minutes > 0 && <div className="text-ink-300 text-xs">{(rec.work_minutes / 60).toFixed(1)} giờ</div>}</div>
            </div>
            <input className="input mt-5 !bg-ink-800 !border-ink-600 !text-ivory-50" placeholder="Ghi chú (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <button className="btn-gold h-14 rounded-2xl text-base" disabled={busy || !!rec?.check_in} onClick={() => punch('check-in')}><LogIn size={18} /> Check-in</button>
              <button className="btn h-14 rounded-2xl text-base bg-ivory-100 text-ink-900 hover:bg-white" disabled={busy || !rec?.check_in || !!rec?.check_out} onClick={() => punch('check-out')}><LogOut size={18} /> Check-out</button>
            </div>
            <div className="text-xs text-ink-400 mt-4 flex items-center justify-center gap-1.5"><MapPin size={13} />
              {data.config.has_location ? `Chấm công trong bán kính ${data.config.radius_m}m quanh cửa hàng${data.config.require_location ? ' (bắt buộc GPS)' : ''}` : 'Chưa cấu hình vị trí cửa hàng – vẫn ghi nhận GPS nếu có'}</div>
          </div>
          <div className="card p-5">
            <h3 className="font-semibold mb-3">Gửi đơn xin nghỉ</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Từ ngày"><input className="input" type="date" value={leave.from_date} onChange={(e) => setLeave({ ...leave, from_date: e.target.value })} /></Field>
              <Field label="Đến ngày"><input className="input" type="date" value={leave.to_date} onChange={(e) => setLeave({ ...leave, to_date: e.target.value })} /></Field>
            </div>
            <Field label="Lý do" className="mt-3"><Textarea rows={2} value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} /></Field>
            <button className="btn-primary mt-3" disabled={busy || !leave.reason.trim()} onClick={async () => { if (await run(() => api.post('/leave-requests', leave), 'Đã gửi đơn xin nghỉ')) { setLeave({ from_date: today(), to_date: today(), reason: '' }); reloadLeaves(); } }}><Send size={15} /> Gửi đơn</button>
            {(leaves ?? []).filter((l: any) => l.user_id === user?.id).slice(0, 5).map((l: any) => (
              <div key={l.id} className="flex justify-between text-sm py-2 border-b border-ivory-200 last:border-0 mt-2"><span>{date(l.from_date)} → {date(l.to_date)}</span><Badge tone={l.status === 'approved' ? 'green' : l.status === 'rejected' ? 'red' : 'amber'}>{{ pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }[l.status as string]}</Badge></div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="px-5 py-4 border-b border-ivory-200 flex items-center gap-2"><Clock size={16} className="text-gold-500" /><h3 className="font-semibold">Lịch sử 14 ngày gần nhất</h3></div>
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Ngày</th><th>Vào</th><th>Ra</th><th className="num">Muộn</th><th className="num">Giờ làm</th><th>Trạng thái</th></tr></thead>
            <tbody>{data.history.map((r: any) => (
              <tr key={r.id}><td>{date(r.work_date)}</td><td>{time(r.check_in)}</td><td>{time(r.check_out)}</td><td className={cx('num', r.late_minutes > 0 && 'text-amber-700')}>{r.late_minutes || '—'}</td>
                <td className="num">{r.work_minutes ? (r.work_minutes / 60).toFixed(1) + 'h' : '—'}</td><td><Badge tone={r.status === 'present' ? 'green' : r.status === 'late' ? 'amber' : r.status === 'leave' ? 'blue' : 'red'}>{LABELS.attendance[r.status]}</Badge></td></tr>
            ))}</tbody></table></div>
        </div>
      </div>
    </div>
  );
}
