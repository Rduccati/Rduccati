import { useState } from 'react';
import { api } from '../lib/api';
import { Field, Select, Textarea, useSubmit } from './ui';

export default function CustomerForm({ initial, onSaved, onCancel }: { initial?: any; onSaved: (c: any) => void; onCancel: () => void }) {
  const [f, setF] = useState<any>({ name: '', phone: '', email: '', address: '', birthday: '', gender: '', customer_group: 'normal', preferences: '', note: '', opening_debt: 0, ...initial });
  const { busy, run } = useSubmit();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => (f.id ? api.put(`/customers/${f.id}`, f) : api.post('/customers', f)), f.id ? 'Đã cập nhật khách hàng' : 'Đã thêm khách hàng');
    if (r) onSaved(r);
  };
  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Họ tên" required><input className="input" autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Số điện thoại"><input className="input" value={f.phone ?? ''} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Ngày sinh"><input className="input" type="date" value={f.birthday ?? ''} onChange={set('birthday')} /></Field>
        <Field label="Giới tính"><Select value={f.gender ?? ''} onChange={set('gender')} placeholder="—" options={[{ value: 'male', label: 'Nam' }, { value: 'female', label: 'Nữ' }, { value: 'other', label: 'Khác' }]} /></Field>
        <Field label="Nhóm khách hàng"><Select value={f.customer_group} onChange={set('customer_group')} options={[{ value: 'normal', label: 'Thường' }, { value: 'silver', label: 'Bạc' }, { value: 'gold', label: 'Vàng' }, { value: 'vip', label: 'VIP' }]} /></Field>
      </div>
      <Field label="Địa chỉ"><input className="input" value={f.address ?? ''} onChange={set('address')} /></Field>
      <Field label="Sở thích (thương hiệu, size, kiểu dáng...)"><Textarea rows={2} value={f.preferences ?? ''} onChange={set('preferences')} /></Field>
      <Field label="Ghi chú"><Textarea rows={2} value={f.note ?? ''} onChange={set('note')} /></Field>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-outline" onClick={onCancel}>Hủy</button>
        <button className="btn-primary" disabled={busy}>{f.id ? 'Lưu thay đổi' : 'Thêm khách hàng'}</button>
      </div>
    </form>
  );
}
