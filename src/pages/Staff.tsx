import { useMemo, useState } from 'react';
import { Check, Edit3, FileSpreadsheet, Plus, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, LABELS, time, today } from '../lib/format';
import { Badge, Empty, Field, Loading, Modal, PageHeader, Select, Tabs, Toggle, cx, useFetch, useSubmit, useUi } from '../components/ui';

type Tab = 'users' | 'roles' | 'timesheet' | 'shifts' | 'leave';

export default function Staff() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('users');
  return (
    <div>
      <PageHeader title="Nhân viên" subtitle="Tài khoản, phân quyền theo chức năng, chấm công và ca làm việc" />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { value: 'users', label: 'Tài khoản' }, { value: 'roles', label: 'Vai trò & phân quyền' }, { value: 'timesheet', label: 'Bảng chấm công' },
        { value: 'shifts', label: 'Ca làm việc' }, { value: 'leave', label: 'Đơn xin nghỉ' },
      ]} />
      {tab === 'users' && <Users canEdit={can('staff.edit')} />}
      {tab === 'roles' && <Roles canEdit={can('staff.edit')} />}
      {tab === 'timesheet' && <Timesheet canEdit={can('staff.edit')} />}
      {tab === 'shifts' && <WorkShifts canEdit={can('staff.edit')} />}
      {tab === 'leave' && <Leaves canEdit={can('staff.edit')} />}
    </div>
  );
}

function Users({ canEdit }: { canEdit: boolean }) {
  const { data, loading, reload } = useFetch(() => api.get('/users'), []);
  const { data: roles } = useFetch(() => api.get('/roles'), []);
  const { data: shifts } = useFetch(() => api.get('/work-shifts'), []);
  const [edit, setEdit] = useState<any>(null);
  if (loading || !data) return <Loading />;
  return (
    <div className="card">
      {canEdit && <div className="p-4 border-b border-ivory-200 flex justify-end"><button className="btn-primary" onClick={() => setEdit({ is_active: true })}><UserPlus size={16} /> Thêm nhân viên</button></div>}
      <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Nhân viên</th><th>Tên đăng nhập</th><th>Vai trò</th><th>Ca làm việc</th><th>Điện thoại</th><th>Đăng nhập gần nhất</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>{data.map((u: any) => (
          <tr key={u.id}><td className="font-medium">{u.full_name}</td><td className="font-mono text-xs">{u.username}</td><td><Badge tone={u.role_code === 'admin' ? 'dark' : 'gold'}>{u.role_name}</Badge></td>
            <td>{u.work_shift_name ?? '—'}</td><td>{u.phone ?? '—'}</td><td className="text-ink-500">{dateTime(u.last_login_at)}</td>
            <td>{u.is_active ? <Badge tone="green">Hoạt động</Badge> : <Badge tone="red">Đã khóa</Badge>}</td>
            <td>{canEdit && <button className="btn-ghost btn-icon w-8 h-8" onClick={() => setEdit(u)}><Edit3 size={15} /></button>}</td></tr>
        ))}</tbody></table></div>
      {edit && <UserForm user={edit} roles={roles ?? []} shifts={shifts ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function UserForm({ user, roles, shifts, onClose, onSaved }: { user: any; roles: any[]; shifts: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>(() => ({ username: '', full_name: '', phone: '', email: '', role_id: roles.find((r) => r.code === 'sales')?.id ?? '', work_shift_id: '', ...user, password: '' }));
  const { busy, run } = useSubmit();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open title={f.id ? `Sửa tài khoản ${f.username}` : 'Thêm nhân viên'} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => (f.id ? api.put(`/users/${f.id}`, { ...f, work_shift_id: f.work_shift_id || null }) : api.post('/users', { ...f, work_shift_id: f.work_shift_id || null })), 'Đã lưu tài khoản')) onSaved(); }}>Lưu</button></>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Họ tên" required><input className="input" autoFocus value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label="Tên đăng nhập" required><input className="input" value={f.username} onChange={set('username')} autoComplete="off" /></Field>
        <Field label={f.id ? 'Đặt lại mật khẩu' : 'Mật khẩu'} required={!f.id} hint={f.id ? 'Để trống nếu không đổi' : 'Tối thiểu 6 ký tự'}><input className="input" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
        <Field label="Vai trò" required><Select value={f.role_id} onChange={set('role_id')} options={roles.map((r) => ({ value: r.id, label: r.name }))} /></Field>
        <Field label="Ca làm việc mặc định"><Select value={f.work_shift_id ?? ''} onChange={set('work_shift_id')} placeholder="—" options={shifts.map((s) => ({ value: s.id, label: `${s.name} (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})` }))} /></Field>
        <Field label="Điện thoại"><input className="input" value={f.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input className="input" value={f.email ?? ''} onChange={set('email')} /></Field>
        <div className="flex items-end pb-2"><Toggle checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Đang hoạt động" /></div>
      </div>
    </Modal>
  );
}

function Roles({ canEdit }: { canEdit: boolean }) {
  const { data: roles, loading, reload } = useFetch(() => api.get('/roles'), []);
  const { data: perms } = useFetch(() => api.get('/permissions'), []);
  const [edit, setEdit] = useState<any>(null);
  const { confirm, toast } = useUi();
  if (loading || !roles || !perms) return <Loading />;
  const groups = [...new Set(perms.map((p: any) => p.group))] as string[];
  return (
    <div className="space-y-4">
      {canEdit && <div className="flex justify-end"><button className="btn-primary" onClick={() => setEdit({ code: '', name: '', permissions: [] })}><Plus size={16} /> Thêm vai trò</button></div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        {roles.map((r: any) => (
          <div key={r.id} className="card p-5">
            <div className="flex justify-between items-start">
              <div><div className="font-semibold flex items-center gap-2"><ShieldCheck size={16} className="text-gold-500" />{r.name}</div><div className="text-xs text-ink-400 mt-0.5">{r.user_count} tài khoản · {r.permissions.includes('*') ? 'Toàn quyền' : `${r.permissions.length} quyền`}</div></div>
              {canEdit && r.code !== 'admin' && <div className="flex">
                <button className="btn-ghost btn-icon w-8 h-8" onClick={() => setEdit(r)}><Edit3 size={14} /></button>
                {!r.is_system && <button className="btn-ghost btn-icon w-8 h-8 hover:text-red-600" onClick={async () => { if (await confirm({ title: `Xóa vai trò ${r.name}?`, danger: true })) { try { await api.del(`/roles/${r.id}`); reload(); } catch (e) { toast.error(e); } } }}><Trash2 size={14} /></button>}
              </div>}
            </div>
            <div className="flex flex-wrap gap-1 mt-3">{r.permissions.includes('*') ? <Badge tone="dark">Tất cả chức năng</Badge> : r.permissions.slice(0, 8).map((p: string) => <Badge key={p}>{perms.find((x: any) => x.key === p)?.label ?? p}</Badge>)}{r.permissions.length > 8 && <Badge>+{r.permissions.length - 8}</Badge>}</div>
          </div>
        ))}
      </div>
      {edit && <RoleForm role={edit} perms={perms} groups={groups} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function RoleForm({ role, perms, groups, onClose, onSaved }: { role: any; perms: any[]; groups: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ ...role, permissions: [...role.permissions] });
  const { busy, run } = useSubmit();
  const toggle = (k: string) => setF({ ...f, permissions: f.permissions.includes(k) ? f.permissions.filter((x: string) => x !== k) : [...f.permissions, k] });
  return (
    <Modal open size="lg" title={role.id ? `Phân quyền: ${role.name}` : 'Thêm vai trò'} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => (role.id ? api.put(`/roles/${role.id}`, f) : api.post('/roles', f)), 'Đã lưu phân quyền')) onSaved(); }}>Lưu</button></>}>
      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        <Field label="Tên vai trò" required><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mã vai trò" hint="chữ thường, không dấu"><input className="input" value={f.code} disabled={!!role.id} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {groups.map((g) => (
          <div key={g} className="rounded-xl border border-ivory-300 p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-gold-600 mb-2">{g}</div>
            {perms.filter((p) => p.group === g).map((p) => (
              <label key={p.key} className="flex items-center gap-2.5 py-1 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-amber-600" checked={f.permissions.includes(p.key)} onChange={() => toggle(p.key)} />{p.label}</label>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Timesheet({ canEdit }: { canEdit: boolean }) {
  const { toast } = useUi();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [userId, setUserId] = useState('');
  const { data: users } = useFetch(() => api.get('/users/options'), []);
  const { data, loading, reload } = useFetch(() => api.get('/attendance', { month, user_id: userId }), [month, userId]);
  const [edit, setEdit] = useState<any>(null);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <input type="month" className="input w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
        <Select className="w-auto" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Tất cả nhân viên" options={(users ?? []).map((u: any) => ({ value: u.id, label: u.full_name }))} />
        <button className="btn-outline" onClick={() => api.download('/attendance', { month, user_id: userId, format: 'xlsx' }).catch(toast.error)}><FileSpreadsheet size={16} /> Xuất bảng công</button>
        {canEdit && <button className="btn-primary sm:ml-auto" onClick={() => setEdit({ work_date: today(), status: 'present' })}><Plus size={16} /> Thêm công thủ công</button>}
      </div>
      {loading || !data ? <Loading /> : <>
        <div className="card"><div className="table-wrap"><table className="tbl">
          <thead><tr><th>Nhân viên</th><th className="num">Ngày công</th><th className="num">Đi muộn</th><th className="num">Phút muộn</th><th className="num">Phút về sớm</th><th className="num">Nghỉ phép</th><th className="num">Quên check-out</th><th className="num">Tổng giờ làm</th></tr></thead>
          <tbody>{data.summary.map((s: any) => <tr key={s.user_id}><td className="font-medium">{s.full_name}</td><td className="num font-semibold">{s.work_days}</td><td className={cx('num', s.late_days > 0 && 'text-amber-700')}>{s.late_days}</td><td className="num">{s.late_minutes}</td><td className="num">{s.early_minutes}</td><td className="num">{s.leave_days}</td><td className={cx('num', s.missing_checkout > 0 && 'text-red-600')}>{s.missing_checkout}</td><td className="num">{(s.work_minutes / 60).toFixed(1)}h</td></tr>)}</tbody>
        </table></div></div>
        <div className="card">
          {data.rows.length === 0 ? <Empty title="Chưa có dữ liệu chấm công trong tháng" /> : <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Ngày</th><th>Nhân viên</th><th>Ca</th><th>Vào</th><th>Ra</th><th className="num">Muộn</th><th className="num">Giờ làm</th><th>Vị trí</th><th>Trạng thái</th><th>Ghi chú</th><th></th></tr></thead>
            <tbody>{data.rows.map((r: any) => (
              <tr key={r.id}><td className="whitespace-nowrap">{date(r.work_date)}</td><td>{r.full_name}</td><td className="text-ink-500">{r.shift_name ?? '—'}</td><td>{time(r.check_in)}</td><td>{time(r.check_out)}</td>
                <td className={cx('num', r.late_minutes > 0 && 'text-amber-700')}>{r.late_minutes || '—'}</td><td className="num">{r.work_minutes ? (r.work_minutes / 60).toFixed(1) + 'h' : '—'}</td>
                <td className="text-xs text-ink-500">{r.check_in_distance != null ? `${r.check_in_distance}m` : r.check_in_lat ? 'Có GPS' : '—'}</td>
                <td><Badge tone={r.status === 'present' ? 'green' : r.status === 'late' ? 'amber' : r.status === 'leave' ? 'blue' : 'red'}>{LABELS.attendance[r.status]}</Badge></td>
                <td className="text-xs text-ink-500 max-w-[160px] truncate" title={r.note}>{r.note}{r.adjusted_by_name && <div className="text-ink-300">Sửa bởi {r.adjusted_by_name}</div>}</td>
                <td>{canEdit && <button className="btn-ghost btn-icon w-8 h-8" onClick={() => setEdit({ ...r, check_in: r.check_in ? time(r.check_in) : '', check_out: r.check_out ? time(r.check_out) : '' })}><Edit3 size={14} /></button>}</td></tr>
            ))}</tbody></table></div>}
        </div>
      </>}
      {edit && <AttendanceEdit rec={edit} users={users ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function AttendanceEdit({ rec, users, onClose, onSaved }: { rec: any; users: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ user_id: rec.user_id ?? '', work_date: rec.work_date, check_in: rec.check_in ?? '', check_out: rec.check_out ?? '', status: rec.status, note: rec.note ?? '' });
  const { busy, run } = useSubmit();
  const body = { ...f, check_in: f.check_in || null, check_out: f.check_out || null };
  return (
    <Modal open size="sm" title={rec.id ? `Điều chỉnh công ${rec.full_name} – ${date(rec.work_date)}` : 'Thêm công thủ công'} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => (rec.id ? api.put(`/attendance/${rec.id}`, body) : api.post('/attendance', body)), 'Đã lưu chấm công')) onSaved(); }}>Lưu</button></>}>
      <div className="space-y-3">
        {!rec.id && <>
          <Field label="Nhân viên"><Select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })} placeholder="— Chọn —" options={users.map((u) => ({ value: u.id, label: u.full_name }))} /></Field>
          <Field label="Ngày"><input className="input" type="date" value={f.work_date} onChange={(e) => setF({ ...f, work_date: e.target.value })} /></Field>
        </>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Giờ vào"><input className="input" type="time" value={f.check_in} onChange={(e) => setF({ ...f, check_in: e.target.value })} /></Field>
          <Field label="Giờ ra"><input className="input" type="time" value={f.check_out} onChange={(e) => setF({ ...f, check_out: e.target.value })} /></Field>
        </div>
        <Field label="Trạng thái"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={Object.entries(LABELS.attendance).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Ghi chú / lý do điều chỉnh"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <p className="text-xs text-ink-400">Trạng thái đúng giờ / đi muộn được tính lại tự động theo ca làm việc.</p>
      </div>
    </Modal>
  );
}

function WorkShifts({ canEdit }: { canEdit: boolean }) {
  const { data, loading, reload } = useFetch(() => api.get('/work-shifts'), []);
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useSubmit();
  const { confirm } = useUi();
  if (loading || !data) return <Loading />;
  return (
    <div className="card">
      {canEdit && <div className="p-4 border-b border-ivory-200 flex justify-end"><button className="btn-primary" onClick={() => setEdit({ name: '', start_time: '08:00', end_time: '17:00', grace_minutes: 10, is_active: true })}><Plus size={16} /> Thêm ca</button></div>}
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Tên ca</th><th>Giờ bắt đầu</th><th>Giờ kết thúc</th><th className="num">Cho phép trễ (phút)</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>{data.map((s: any) => <tr key={s.id}><td className="font-medium">{s.name}</td><td>{s.start_time.slice(0, 5)}</td><td>{s.end_time.slice(0, 5)}</td><td className="num">{s.grace_minutes}</td><td>{s.is_active ? <Badge tone="green">Áp dụng</Badge> : <Badge>Ngừng</Badge>}</td>
          <td className="whitespace-nowrap">{canEdit && <><button className="btn-ghost btn-icon w-8 h-8" onClick={() => setEdit({ ...s, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) })}><Edit3 size={14} /></button>
            <button className="btn-ghost btn-icon w-8 h-8 hover:text-red-600" onClick={async () => { if (await confirm({ title: `Xóa ca ${s.name}?`, danger: true })) { await run(() => api.del(`/work-shifts/${s.id}`)); reload(); } }}><Trash2 size={14} /></button></>}</td></tr>)}</tbody></table></div>
      {edit && (
        <Modal open size="sm" title={edit.id ? 'Sửa ca làm việc' : 'Thêm ca làm việc'} onClose={() => setEdit(null)}
          footer={<><button className="btn-outline" onClick={() => setEdit(null)}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => (edit.id ? api.put(`/work-shifts/${edit.id}`, edit) : api.post('/work-shifts', edit)), 'Đã lưu ca')) { setEdit(null); reload(); } }}>Lưu</button></>}>
          <div className="space-y-3">
            <Field label="Tên ca"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bắt đầu"><input className="input" type="time" value={edit.start_time} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></Field>
              <Field label="Kết thúc"><input className="input" type="time" value={edit.end_time} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></Field>
            </div>
            <Field label="Cho phép trễ (phút)"><input className="input" type="number" min={0} value={edit.grace_minutes} onChange={(e) => setEdit({ ...edit, grace_minutes: Number(e.target.value) })} /></Field>
            <Toggle checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Đang áp dụng" />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Leaves({ canEdit }: { canEdit: boolean }) {
  const { data, loading, reload } = useFetch(() => api.get('/leave-requests'), []);
  const { run } = useSubmit();
  const pending = useMemo(() => (data ?? []).filter((l: any) => l.status === 'pending').length, [data]);
  if (loading || !data) return <Loading />;
  return (
    <div className="card">
      <div className="px-5 py-3 border-b border-ivory-200 text-sm text-ink-500">{pending} đơn chờ duyệt · Nhân viên gửi đơn tại mục Chấm công</div>
      {data.length === 0 ? <Empty title="Chưa có đơn xin nghỉ" /> : <div className="table-wrap"><table className="tbl">
        <thead><tr><th>Nhân viên</th><th>Từ ngày</th><th>Đến ngày</th><th>Lý do</th><th>Trạng thái</th><th>Người duyệt</th><th></th></tr></thead>
        <tbody>{data.map((l: any) => <tr key={l.id}><td className="font-medium">{l.full_name}</td><td>{date(l.from_date)}</td><td>{date(l.to_date)}</td><td className="max-w-[260px]">{l.reason}</td>
          <td><Badge tone={l.status === 'approved' ? 'green' : l.status === 'rejected' ? 'red' : 'amber'}>{{ pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối' }[l.status as string]}</Badge></td><td>{l.reviewed_by_name ?? '—'}</td>
          <td className="whitespace-nowrap">{canEdit && l.status === 'pending' && <><button className="btn-outline btn-sm" onClick={async () => { if (await run(() => api.post(`/leave-requests/${l.id}/review`, { status: 'approved' }), 'Đã duyệt')) reload(); }}><Check size={13} /> Duyệt</button> <button className="btn-ghost btn-sm text-red-600" onClick={async () => { if (await run(() => api.post(`/leave-requests/${l.id}/review`, { status: 'rejected' }), 'Đã từ chối')) reload(); }}><X size={13} /></button></>}</td></tr>)}</tbody></table></div>}
    </div>
  );
}
