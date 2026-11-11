import { useEffect, useRef, useState } from 'react';
import { Copy, Download, Edit3, FileSpreadsheet, ImagePlus, Plus, RefreshCw, Trash2, Upload, Watch, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, LABELS, money } from '../lib/format';
import { barcodeSvg } from '../lib/printer';
import { Badge, Empty, ErrorBox, Field, InfoRow, Loading, Modal, MoneyInput, PageHeader, Pagination, SearchInput, Select, Tabs, Textarea, Toggle, cx, useFetch, useSubmit, useUi } from '../components/ui';

export default function Products() {
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const [f, setF] = useState({ q: '', brand_id: '', condition: '', movement_type: '', stock: '', active: '1', min_price: '', max_price: '', sort: 'newest' });
  const [page, setPage] = useState(1);
  const { data: brands, reload: reloadBrands } = useFetch(() => api.get('/brands'), []);
  const { data, loading, error, reload } = useFetch(() => api.get('/products', { ...f, page, pageSize: 25 }), [f, page]);
  useEffect(() => setPage(1), [f]);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const showCost = can('products.cost');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const duplicate = async (p: any) => {
    try { const r = await api.post(`/products/${p.id}/duplicate`); toast.success(`Đã nhân bản → ${r.sku}`); reload(); setEditing(r); } catch (e) { toast.error(e); }
  };
  const remove = async (p: any) => {
    if (!(await confirm({ title: `Xóa sản phẩm ${p.sku}?`, danger: true, confirmText: 'Xóa', message: 'Nếu sản phẩm đã có giao dịch kho/bán hàng, hệ thống sẽ chuyển sang "Ngừng kinh doanh" để bảo toàn lịch sử.' }))) return;
    try { const r = await api.del(`/products/${p.id}`); toast.success(r.message ?? 'Đã xóa sản phẩm'); reload(); } catch (e) { toast.error(e); }
  };

  return (
    <div>
      <PageHeader title="Sản phẩm" subtitle={data ? `${data.total} mẫu đồng hồ & phụ kiện` : undefined}
        actions={<>
          {can('products.edit') && <button className="btn-outline" onClick={() => setImportOpen(true)}><Upload size={16} /> Import Excel</button>}
          <button className="btn-outline" onClick={() => api.download('/products/export.xlsx').catch(toast.error)}><FileSpreadsheet size={16} /> Export Excel</button>
          {can('products.edit') && <button className="btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Thêm sản phẩm</button>}
        </>} />
      <div className="card">
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-3 border-b border-ivory-200">
          <SearchInput className="col-span-2 md:col-span-4 2xl:col-span-2" value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="Tên, SKU, barcode, model, ref, serial..." />
          <Select value={f.brand_id} onChange={set('brand_id')} placeholder="Thương hiệu" options={(brands ?? []).map((b: any) => ({ value: b.id, label: b.name }))} />
          <Select value={f.condition} onChange={set('condition')} placeholder="Tình trạng" options={Object.entries(LABELS.condition).map(([value, label]) => ({ value, label }))} />
          <Select value={f.movement_type} onChange={set('movement_type')} placeholder="Bộ máy" options={Object.entries(LABELS.movement).map(([value, label]) => ({ value, label }))} />
          <Select value={f.stock} onChange={set('stock')} placeholder="Tồn kho" options={[{ value: 'in', label: 'Còn hàng' }, { value: 'out', label: 'Hết hàng' }, { value: 'low', label: 'Sắp hết' }]} />
          <div className="flex gap-1.5 col-span-2 md:col-span-1"><input className="input" placeholder="Giá từ" inputMode="numeric" value={f.min_price} onChange={set('min_price')} /><input className="input" placeholder="đến" inputMode="numeric" value={f.max_price} onChange={set('max_price')} /></div>
          <Select value={f.active} onChange={set('active')} options={[{ value: '1', label: 'Đang kinh doanh' }, { value: '0', label: 'Ngừng kinh doanh' }, { value: '', label: 'Tất cả' }]} />
        </div>
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Loading /> : data && data.rows.length === 0 ? <Empty icon={<Watch size={22} />} title="Chưa có sản phẩm phù hợp">Thử đổi bộ lọc hoặc thêm sản phẩm mới.</Empty> : data && (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Sản phẩm</th><th>SKU / Barcode</th><th>Bộ máy</th><th>Tình trạng</th>{showCost && <th className="num">Giá vốn</th>}<th className="num">Giá bán</th><th className="num">Tồn</th><th></th></tr></thead>
              <tbody>
                {data.rows.map((p: any) => (
                  <tr key={p.id} className="clickable" onClick={() => setViewId(p.id)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-ivory-200 overflow-hidden shrink-0 flex items-center justify-center">
                          {p.images?.[0] ? <img src={p.images[0]} className="w-full h-full object-cover" /> : <Watch size={18} className="text-ink-300" />}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-ink-900 truncate max-w-[280px]">{p.name}</div>
                          <div className="text-xs text-ink-400">{[p.brand_name, p.model, p.reference_number].filter(Boolean).join(' · ') || '—'}</div>
                        </div>
                        {!p.is_active && <Badge tone="red">Ngừng KD</Badge>}
                      </div>
                    </td>
                    <td><div className="font-mono text-xs">{p.sku}</div><div className="font-mono text-[11px] text-ink-400">{p.barcode}</div></td>
                    <td className="text-ink-600">{LABELS.movement[p.movement_type] ?? '—'}{p.case_diameter ? <span className="text-ink-400"> · {p.case_diameter}mm</span> : ''}</td>
                    <td><Badge tone={p.condition === 'new' ? 'green' : p.condition === 'used' ? 'amber' : 'blue'}>{LABELS.condition[p.condition]}</Badge></td>
                    {showCost && <td className="num text-ink-500">{money(p.cost_price)}</td>}
                    <td className="num">{p.promo_price ? <><div className="font-semibold text-red-700">{money(p.promo_price)}</div><div className="text-[11px] text-ink-300 line-through">{money(p.sale_price)}</div></> : <span className="font-semibold">{money(p.sale_price)}</span>}</td>
                    <td className="num"><span className={cx('font-semibold', p.stock_qty <= p.min_stock && 'text-amber-700', p.stock_qty === 0 && 'text-red-600')}>{p.stock_qty}</span>{p.repairing_qty > 0 && <div className="text-[11px] text-ink-400">+{p.repairing_qty} đang sửa</div>}</td>
                    <td onClick={(e) => e.stopPropagation()} className="whitespace-nowrap text-right">
                      {can('products.edit') && <>
                        <button className="btn-ghost btn-icon w-8 h-8" title="Sửa" onClick={() => setEditing(p)}><Edit3 size={15} /></button>
                        <button className="btn-ghost btn-icon w-8 h-8" title="Nhân bản" onClick={() => duplicate(p)}><Copy size={15} /></button>
                      </>}
                      {can('products.delete') && <button className="btn-ghost btn-icon w-8 h-8 hover:text-red-600" title="Xóa" onClick={() => remove(p)}><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={25} total={data.total} onChange={setPage} />
          </div>
        )}
      </div>
      {editing && <ProductForm product={editing} brands={brands ?? []} onBrandsChanged={reloadBrands} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {viewId && <ProductDetail id={viewId} onClose={() => setViewId(null)} onEdit={(p) => { setViewId(null); setEditing(p); }} />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={() => { reload(); reloadBrands(); }} />}
    </div>
  );
}

// =================================================================== FORM
function ProductForm({ product, brands, onClose, onSaved, onBrandsChanged }: { product: any; brands: any[]; onClose: () => void; onSaved: () => void; onBrandsChanged: () => void }) {
  const { can, settings } = useAuth();
  const { toast } = useUi();
  const isNew = !product.id;
  const [f, setF] = useState<any>(() => ({
    sku: '', barcode: '', barcode_type: settings.barcode?.type ?? 'EAN13', name: '', model: '', reference_number: '',
    case_material: '', strap_material: '', gender: '', condition: 'new', purchase_price: 0, cost_price: 0, sale_price: 0, promo_price: null, warranty_months: 12,
    description: '', images: [], track_serial: true, min_stock: 1, is_active: true, ...product, reason: '',
    brand_id: product.brand_id ?? '', supplier_id: product.supplier_id ?? '', movement_type: product.movement_type ?? (product.id ? '' : 'automatic'), case_diameter: product.case_diameter ?? '',
  }));
  const [opening, setOpening] = useState({ warehouse_id: '', unit_cost: 0, quantity: 0, serials: '' });
  const { data: suppliers } = useFetch(() => (can('suppliers.view', 'inventory.view') ? api.get('/suppliers') : Promise.resolve([])), []);
  const { data: warehouses } = useFetch(() => api.get('/warehouses'), []);
  useEffect(() => { if (warehouses && !opening.warehouse_id) setOpening((o) => ({ ...o, warehouse_id: (warehouses.find((w: any) => w.is_default) ?? warehouses[0])?.id ?? '' })); }, [warehouses]);
  const [newBrand, setNewBrand] = useState('');
  const { busy, run } = useSubmit();
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const genCodes = async () => {
    try { const r = await api.get('/products/generate-codes', { brand_id: f.brand_id, type: f.barcode_type }); setF({ ...f, sku: r.sku, barcode: r.barcode, barcode_type: r.barcode_type }); } catch (e) { toast.error(e); }
  };
  const uploadImg = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files).slice(0, 6)) {
      try { const r = await api.upload('/uploads', file); setF((x: any) => ({ ...x, images: [...x.images, r.url] })); } catch (e) { toast.error(e); }
    }
  };
  const addBrand = async () => {
    if (!newBrand.trim()) return;
    const ex = brands.find((b) => b.name.toLowerCase() === newBrand.trim().toLowerCase());
    if (ex) { setF({ ...f, brand_id: ex.id }); setNewBrand(''); return; }
    try { const b = await api.post('/brands', { name: newBrand.trim() }); onBrandsChanged(); setF({ ...f, brand_id: b.id }); setNewBrand(''); } catch (e) { toast.error(e); }
  };
  const save = async () => {
    const body: any = { ...f, promo_price: f.promo_price || null };
    if (isNew) {
      const serials = opening.serials.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      if (opening.warehouse_id && (serials.length || opening.quantity > 0)) {
        body.opening_stock = { warehouse_id: Number(opening.warehouse_id), unit_cost: opening.unit_cost || f.purchase_price, quantity: opening.quantity, serials: serials.map((s) => ({ serial_number: s })) };
      }
    }
    const r = await run(() => (isNew ? api.post('/products', body) : api.put(`/products/${product.id}`, body)), isNew ? 'Đã thêm sản phẩm' : 'Đã lưu sản phẩm');
    if (r) onSaved();
  };
  const priceChanged = !isNew && (Number(f.sale_price) !== Number(product.sale_price) || Number(f.promo_price || 0) !== Number(product.promo_price || 0) || Number(f.cost_price) !== Number(product.cost_price));
  const margin = f.sale_price > 0 && f.cost_price > 0 ? (((f.promo_price || f.sale_price) - f.cost_price) / (f.promo_price || f.sale_price)) * 100 : null;

  return (
    <Modal open size="xl" title={isNew ? 'Thêm sản phẩm' : `Sửa sản phẩm ${product.sku}`} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={save}>{isNew ? 'Tạo sản phẩm' : 'Lưu thay đổi'}</button></>}>
      <div className="grid lg:grid-cols-[1fr_300px] gap-6">
        <div className="space-y-5">
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gold-600 mb-3">Thông tin đồng hồ</h4>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Tên đồng hồ" required className="sm:col-span-2"><input className="input" autoFocus value={f.name} onChange={set('name')} placeholder="VD: Omega Seamaster Diver 300M" /></Field>
              <Field label="Thương hiệu">
                <div className="flex gap-1.5">
                  <Select value={f.brand_id} onChange={set('brand_id')} placeholder="— Chọn —" options={brands.map((b) => ({ value: b.id, label: b.name }))} />
                  <input className="input w-28" placeholder="+ Mới" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBrand(); } }} />
                  {newBrand && <button className="btn-outline btn-icon w-10 h-10" onClick={addBrand}><Plus size={15} /></button>}
                </div>
              </Field>
              <Field label="Model"><input className="input" value={f.model ?? ''} onChange={set('model')} /></Field>
              <Field label="Reference Number"><input className="input" value={f.reference_number ?? ''} onChange={set('reference_number')} /></Field>
              <Field label="Loại bộ máy"><Select value={f.movement_type ?? ''} onChange={set('movement_type')} placeholder="—" options={Object.entries(LABELS.movement).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Đường kính mặt (mm)"><input className="input" inputMode="decimal" value={f.case_diameter} onChange={set('case_diameter')} /></Field>
              <Field label="Tình trạng"><Select value={f.condition} onChange={set('condition')} options={Object.entries(LABELS.condition).map(([value, label]) => ({ value, label }))} /></Field>
              <Field label="Chất liệu vỏ"><input className="input" list="case-mats" value={f.case_material ?? ''} onChange={set('case_material')} /></Field>
              <Field label="Chất liệu dây"><input className="input" list="strap-mats" value={f.strap_material ?? ''} onChange={set('strap_material')} /></Field>
              <datalist id="case-mats">{['Thép không gỉ', 'Thép 904L', 'Titanium', 'Vàng 18K', 'Vàng hồng 18K', 'Ceramic', 'Nhựa'].map((x) => <option key={x} value={x} />)}</datalist>
              <datalist id="strap-mats">{['Dây thép', 'Dây da', 'Dây da cá sấu', 'Dây cao su', 'Dây vải NATO', 'Dây vàng', 'Dây titanium'].map((x) => <option key={x} value={x} />)}</datalist>
              <Field label="Nhà cung cấp"><Select value={f.supplier_id} onChange={set('supplier_id')} placeholder="—" options={(suppliers ?? []).map((s: any) => ({ value: s.id, label: s.name }))} /></Field>
              <Field label="Bảo hành (tháng)"><input className="input" type="number" min={0} value={f.warranty_months} onChange={set('warranty_months')} /></Field>
            </div>
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gold-600 mb-3">Giá</h4>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {can('products.cost') && <>
                <Field label="Giá nhập"><MoneyInput value={f.purchase_price} onChange={(v) => setF({ ...f, purchase_price: v, cost_price: isNew && (!f.cost_price || f.cost_price === f.purchase_price) ? v : f.cost_price })} /></Field>
                <Field label="Giá vốn" hint={isNew ? 'Tự cập nhật bình quân khi nhập hàng' : undefined}><MoneyInput value={f.cost_price} onChange={(v) => setF({ ...f, cost_price: v })} /></Field>
              </>}
              <Field label="Giá bán" required><MoneyInput value={f.sale_price} onChange={(v) => setF({ ...f, sale_price: v })} /></Field>
              <Field label="Giá khuyến mãi" hint={margin !== null && can('products.cost') ? `Biên lãi gộp: ${margin.toFixed(1)}%` : undefined}><MoneyInput value={f.promo_price} placeholder="Không" onChange={(v) => setF({ ...f, promo_price: v || null })} /></Field>
            </div>
            {priceChanged && <Field label="Lý do thay đổi giá (ghi vào lịch sử giá)" className="mt-3"><input className="input" value={f.reason ?? ''} onChange={set('reason')} placeholder="VD: Điều chỉnh theo giá hãng tháng 11" /></Field>}
          </section>
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gold-600 mb-3">Mô tả chi tiết</h4>
            <Textarea rows={4} value={f.description ?? ''} onChange={set('description')} placeholder="Đặc điểm, phụ kiện kèm theo, xuất xứ..." />
          </section>
          {isNew && (
            <section className="rounded-2xl border border-dashed border-gold-300 bg-gold-50/40 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gold-600 mb-1">Nhập tồn ban đầu (tùy chọn)</h4>
              <p className="text-xs text-ink-400 mb-3">Hệ thống sẽ tạo phiếu nhập kho để có lịch sử giao dịch. Có thể bỏ qua và nhập hàng sau ở mục Kho.</p>
              <div className="grid sm:grid-cols-3 gap-3">
                <Field label="Kho nhập"><Select value={opening.warehouse_id} onChange={(e) => setOpening({ ...opening, warehouse_id: e.target.value })} options={(warehouses ?? []).map((w: any) => ({ value: w.id, label: w.name }))} /></Field>
                {can('products.cost') && <Field label="Đơn giá nhập"><MoneyInput value={opening.unit_cost || f.purchase_price} onChange={(v) => setOpening({ ...opening, unit_cost: v })} /></Field>}
                {!f.track_serial && <Field label="Số lượng"><input className="input" type="number" min={0} value={opening.quantity} onChange={(e) => setOpening({ ...opening, quantity: Number(e.target.value) })} /></Field>}
              </div>
              {f.track_serial && <Field label="Serial Number (mỗi dòng 1 serial)" className="mt-3" hint={`${opening.serials.split(/[\n,;]+/).filter((s) => s.trim()).length} chiếc`}><Textarea rows={3} className="font-mono" value={opening.serials} onChange={(e) => setOpening({ ...opening, serials: e.target.value })} placeholder={'SN123456\nSN123457'} /></Field>}
            </section>
          )}
        </div>
        <div className="space-y-5">
          <section className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gold-600">Mã sản phẩm</h4>
              <button className="btn-ghost btn-sm" onClick={genCodes}><RefreshCw size={13} /> Tự tạo</button>
            </div>
            <div className="space-y-3">
              <Field label="SKU" hint="Để trống để hệ thống tự sinh"><input className="input font-mono" value={f.sku ?? ''} onChange={set('sku')} /></Field>
              <Field label="Loại barcode"><Select value={f.barcode_type} onChange={set('barcode_type')} options={[{ value: 'EAN13', label: 'EAN-13' }, { value: 'CODE128', label: 'Code 128' }]} /></Field>
              <Field label="Barcode" hint="Để trống để tự sinh mã duy nhất"><input className="input font-mono" value={f.barcode ?? ''} onChange={set('barcode')} /></Field>
              {f.barcode && <div className="bg-white border border-ivory-300 rounded-xl p-2 flex justify-center [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: barcodeSvg(f.barcode, f.barcode_type, { height: 40 }) }} />}
            </div>
          </section>
          <section className="card p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gold-600 mb-3">Hình ảnh</h4>
            <div className="grid grid-cols-3 gap-2">
              {f.images.map((img: string, i: number) => (
                <div key={img} className="relative aspect-square rounded-xl overflow-hidden bg-ivory-200 group">
                  <img src={img} className="w-full h-full object-cover" />
                  <button className="absolute top-1 right-1 w-6 h-6 rounded-full bg-ink-900/70 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center" onClick={() => setF({ ...f, images: f.images.filter((_: any, j: number) => j !== i) })}><X size={12} /></button>
                </div>
              ))}
              <button className="aspect-square rounded-xl border-2 border-dashed border-ivory-400 text-ink-400 hover:border-gold-400 hover:text-gold-600 flex flex-col items-center justify-center text-xs gap-1" onClick={() => fileRef.current?.click()}><ImagePlus size={18} /> Thêm ảnh</button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { uploadImg(e.target.files); e.target.value = ''; }} />
          </section>
          <section className="card p-4 space-y-3">
            <Toggle checked={f.track_serial} onChange={(v) => setF({ ...f, track_serial: v })} label="Quản lý theo Serial Number" />
            <p className="text-[11px] text-ink-400 -mt-1">Bật với đồng hồ: mỗi chiếc có serial riêng, quản lý độc lập. Tắt với phụ kiện (dây, pin, hộp).</p>
            <Field label="Cảnh báo sắp hết khi tồn ≤"><input className="input" type="number" min={0} value={f.min_stock} onChange={set('min_stock')} /></Field>
            <Toggle checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Đang kinh doanh" />
          </section>
        </div>
      </div>
    </Modal>
  );
}

// =================================================================== CHI TIẾT
function ProductDetail({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (p: any) => void }) {
  const { can } = useAuth();
  const { data: p, loading, reload } = useFetch(() => api.get(`/products/${id}`), [id]);
  const [tab, setTab] = useState<'info' | 'serials' | 'stock' | 'price' | 'moves'>('info');
  const [editSerial, setEditSerial] = useState<any>(null);
  const showCost = can('products.cost');
  const fieldLabel: Record<string, string> = { purchase_price: 'Giá nhập', cost_price: 'Giá vốn', sale_price: 'Giá bán', promo_price: 'Giá khuyến mãi' };
  return (
    <Modal open size="xl" onClose={onClose} title={p?.name ?? 'Sản phẩm'} subtitle={p ? `${p.sku} · ${p.barcode}` : undefined}
      footer={p && can('products.edit') && <button className="btn-primary" onClick={() => onEdit(p)}><Edit3 size={15} /> Sửa sản phẩm</button>}>
      {loading && !p ? <Loading /> : p && (
        <>
          <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
            { value: 'info', label: 'Thông tin' }, ...(p.track_serial ? [{ value: 'serials' as const, label: 'Serial', count: p.serials.length }] : []),
            { value: 'stock', label: 'Tồn theo kho' }, { value: 'price', label: 'Lịch sử giá', count: p.price_history.length }, { value: 'moves', label: 'Lịch sử nhập xuất', count: p.movements.length },
          ]} />
          {tab === 'info' && (
            <div className="grid md:grid-cols-[220px_1fr_1fr] gap-6">
              <div className="space-y-2">
                <div className="aspect-square rounded-2xl bg-ivory-200 overflow-hidden flex items-center justify-center">{p.images?.[0] ? <img src={p.images[0]} className="w-full h-full object-cover" /> : <Watch size={40} className="text-ink-300" />}</div>
                <div className="bg-white border border-ivory-300 rounded-xl p-2 flex justify-center [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: barcodeSvg(p.barcode, p.barcode_type, { height: 36 }) }} />
              </div>
              <div>
                <InfoRow label="Thương hiệu">{p.brand_name}</InfoRow><InfoRow label="Model">{p.model}</InfoRow><InfoRow label="Reference">{p.reference_number}</InfoRow>
                <InfoRow label="Bộ máy">{LABELS.movement[p.movement_type]}</InfoRow><InfoRow label="Đường kính">{p.case_diameter ? `${p.case_diameter} mm` : null}</InfoRow>
                <InfoRow label="Chất liệu vỏ">{p.case_material}</InfoRow><InfoRow label="Chất liệu dây">{p.strap_material}</InfoRow><InfoRow label="Tình trạng">{LABELS.condition[p.condition]}</InfoRow>
              </div>
              <div>
                {showCost && <><InfoRow label="Giá nhập gần nhất">{money(p.purchase_price)}</InfoRow><InfoRow label="Giá vốn bình quân">{money(p.cost_price)}</InfoRow></>}
                <InfoRow label="Giá bán">{money(p.sale_price)}</InfoRow><InfoRow label="Giá khuyến mãi">{p.promo_price ? money(p.promo_price) : null}</InfoRow>
                <InfoRow label="Bảo hành">{p.warranty_months} tháng</InfoRow><InfoRow label="Nhà cung cấp">{p.supplier_name}</InfoRow><InfoRow label="Tồn kho">{p.stock_qty}</InfoRow>
                <InfoRow label="Tạo bởi">{p.created_by_name} · {date(p.created_at)}</InfoRow><InfoRow label="Sửa gần nhất">{p.updated_by_name} · {dateTime(p.updated_at)}</InfoRow>
              </div>
              {p.description && <div className="md:col-span-3 text-sm text-ink-600 whitespace-pre-line bg-ivory-100 rounded-xl p-4">{p.description}</div>}
            </div>
          )}
          {tab === 'serials' && (
            <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl">
              <thead><tr><th>Serial</th><th>Movement No.</th><th>Tình trạng</th><th>Trạng thái</th><th>Kho</th>{showCost && <th className="num">Giá vốn</th>}<th>Ngày nhập</th><th>Ghi chú</th><th></th></tr></thead>
              <tbody>{p.serials.map((s: any) => (
                <tr key={s.id}><td className="font-mono font-semibold">{s.serial_number}{s.is_consignment && <Badge tone="violet" className="ml-1.5">Ký gửi</Badge>}</td><td className="font-mono text-xs">{s.movement_number ?? '—'}</td>
                  <td>{LABELS.condition[s.condition]}</td><td><Badge tone={s.status === 'in_stock' ? 'green' : s.status === 'sold' ? 'gray' : 'amber'}>{LABELS.serialStatus[s.status]}</Badge>{s.order_code && <div className="text-[11px] text-ink-400">{s.order_code}</div>}</td>
                  <td>{s.warehouse_name}</td>{showCost && <td className="num">{money(s.cost_price)}</td>}<td>{date(s.received_at)}</td><td className="text-xs text-ink-500 max-w-[180px]">{s.note}</td>
                  <td>{can('products.edit', 'inventory.edit') && <button className="btn-ghost btn-icon w-8 h-8" onClick={() => setEditSerial(s)}><Edit3 size={14} /></button>}</td></tr>
              ))}</tbody></table></div>
          )}
          {tab === 'stock' && (p.stock.length === 0 ? <Empty title="Chưa có tồn kho" /> : <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl"><thead><tr><th>Kho</th><th className="num">Tồn</th><th>Cập nhật</th></tr></thead>
            <tbody>{p.stock.map((s: any) => <tr key={s.warehouse_id}><td>{s.warehouse_name}</td><td className="num font-semibold">{s.quantity}</td><td>{dateTime(s.updated_at)}</td></tr>)}</tbody></table></div>)}
          {tab === 'price' && (p.price_history.length === 0 ? <Empty title="Chưa có thay đổi giá" /> : <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl"><thead><tr><th>Thời gian</th><th>Loại giá</th><th className="num">Giá cũ</th><th className="num">Giá mới</th><th>Người thay đổi</th><th>Lý do</th></tr></thead>
            <tbody>{p.price_history.map((h: any) => <tr key={h.id}><td>{dateTime(h.created_at)}</td><td>{fieldLabel[h.field]}</td><td className="num text-ink-400">{h.old_value != null ? money(h.old_value) : '—'}</td><td className="num font-semibold">{h.new_value != null ? money(h.new_value) : '—'}</td><td>{h.user_name}</td><td className="text-xs text-ink-500">{h.reason}</td></tr>)}</tbody></table></div>)}
          {tab === 'moves' && (p.movements.length === 0 ? <Empty title="Chưa có giao dịch kho" /> : <div className="table-wrap border border-ivory-300 rounded-xl"><table className="tbl"><thead><tr><th>Thời gian</th><th>Chứng từ</th><th>Loại</th><th>Serial</th><th>Kho</th><th className="num">Thay đổi</th><th className="num">Tồn sau</th><th>Người thực hiện</th></tr></thead>
            <tbody>{p.movements.map((m: any) => <tr key={m.id}><td className="whitespace-nowrap">{dateTime(m.created_at)}</td><td className="font-mono text-xs">{m.ref_code}</td><td>{LABELS.refType[m.ref_type] ?? m.ref_type}</td><td className="font-mono text-xs">{m.serial_number ?? '—'}</td><td>{m.warehouse_name}</td>
              <td className={cx('num font-semibold', m.qty_change > 0 ? 'text-emerald-700' : 'text-red-600')}>{m.qty_change > 0 ? '+' : ''}{m.qty_change}</td><td className="num">{m.balance_after}</td><td>{m.user_name}</td></tr>)}</tbody></table></div>)}
        </>
      )}
      {editSerial && <SerialEdit serial={editSerial} onClose={() => setEditSerial(null)} onSaved={() => { setEditSerial(null); reload(); }} />}
    </Modal>
  );
}

function SerialEdit({ serial, onClose, onSaved }: { serial: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ serial_number: serial.serial_number, movement_number: serial.movement_number ?? '', condition: serial.condition, note: serial.note ?? '' });
  const { busy, run } = useSubmit();
  return (
    <Modal open size="sm" title={`Sửa serial ${serial.serial_number}`} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={async () => { if (await run(() => api.put(`/serials/${serial.id}`, f), 'Đã lưu serial')) onSaved(); }}>Lưu</button></>}>
      <div className="space-y-3">
        <Field label="Serial Number"><input className="input font-mono" value={f.serial_number} onChange={(e) => setF({ ...f, serial_number: e.target.value })} /></Field>
        <Field label="Movement Number"><input className="input font-mono" value={f.movement_number} onChange={(e) => setF({ ...f, movement_number: e.target.value })} /></Field>
        <Field label="Tình trạng"><Select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} options={Object.entries(LABELS.condition).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Ghi chú"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <p className="text-xs text-ink-400">Trạng thái tồn kho của serial chỉ thay đổi qua phiếu kho / đơn hàng. Mọi chỉnh sửa được ghi lịch sử thao tác.</p>
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useUi();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const { busy, run } = useSubmit();
  return (
    <Modal open title="Import sản phẩm từ Excel" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Đóng</button><button className="btn-primary" disabled={!file || busy} onClick={async () => { const r = await run(() => api.upload('/products/import', file!)); if (r) { setResult(r); onDone(); } }}><Upload size={15} /> {busy ? 'Đang import...' : 'Import'}</button></>}>
      <div className="space-y-4 text-sm">
        <ol className="list-decimal pl-5 space-y-1 text-ink-600">
          <li>Tải file mẫu, điền dữ liệu (giữ nguyên dòng tiêu đề).</li>
          <li>SKU trùng với sản phẩm đã có → cập nhật thông tin; SKU trống → tạo mới và tự sinh mã.</li>
          <li>Điền "Kho nhập" + "Serial" (hoặc "Số lượng nhập") để tự tạo phiếu nhập tồn đầu.</li>
        </ol>
        <button className="btn-outline" onClick={() => api.download('/products/import-template.xlsx').catch(toast.error)}><Download size={15} /> Tải file mẫu</button>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:btn-outline file:mr-3" />
        {result && (
          <div className="rounded-xl bg-ivory-100 p-4 space-y-1">
            <div>✔ Tạo mới: <b>{result.created}</b> · Cập nhật: <b>{result.updated}</b> · Phiếu nhập tồn: <b>{result.stocked}</b></div>
            {result.errors.length > 0 && <div className="text-red-600 max-h-40 overflow-y-auto">{result.errors.map((e: string) => <div key={e}>✖ {e}</div>)}</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}
