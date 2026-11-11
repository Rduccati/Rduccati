-- =====================================================================
-- WATCH POS - DATABASE SCHEMA (PostgreSQL 15+ / Supabase / PGlite)
-- Mọi thay đổi tồn kho CHỈ được thực hiện qua bảng stock_movements (sổ cái).
-- =====================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     integer PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- HỆ THỐNG
CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_system   boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS work_shifts (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  grace_minutes integer NOT NULL DEFAULT 10,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  phone         text,
  email         text,
  role_id       integer NOT NULL REFERENCES roles(id),
  work_shift_id integer REFERENCES work_shifts(id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          bigserial PRIMARY KEY,
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  description text,
  detail      jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS code_sequences (
  prefix  text PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- DANH MỤC
CREATE TABLE IF NOT EXISTS warehouses (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  address     text,
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brands (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  country     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id           serial PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  contact_name text,
  phone        text,
  email        text,
  address      text,
  tax_code     text,
  opening_debt bigint NOT NULL DEFAULT 0,
  note         text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id           serial PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  phone        text UNIQUE,
  email        text,
  address      text,
  birthday     date,
  gender       text CHECK (gender IN ('male','female','other')),
  customer_group text NOT NULL DEFAULT 'normal' CHECK (customer_group IN ('normal','silver','gold','vip')),
  preferences  text,
  note         text,
  opening_debt bigint NOT NULL DEFAULT 0,
  created_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_care_logs (
  id          serial PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  care_type   text NOT NULL DEFAULT 'call',
  content     text NOT NULL,
  next_care_date date,
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- SẢN PHẨM
CREATE TABLE IF NOT EXISTS products (
  id              serial PRIMARY KEY,
  sku             text NOT NULL UNIQUE,
  barcode         text NOT NULL UNIQUE,
  barcode_type    text NOT NULL DEFAULT 'CODE128' CHECK (barcode_type IN ('CODE128','EAN13')),
  name            text NOT NULL,
  brand_id        integer REFERENCES brands(id) ON DELETE SET NULL,
  model           text,
  reference_number text,
  movement_type   text CHECK (movement_type IN ('automatic','quartz','mechanical','solar','kinetic','spring_drive','smart')),
  case_diameter   numeric(5,1),
  case_material   text,
  strap_material  text,
  condition       text NOT NULL DEFAULT 'new' CHECK (condition IN ('new','used','repaired')),
  gender          text,
  purchase_price  bigint NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),  -- giá nhập gần nhất
  cost_price      bigint NOT NULL DEFAULT 0 CHECK (cost_price >= 0),      -- giá vốn (bình quân)
  sale_price      bigint NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  promo_price     bigint CHECK (promo_price >= 0),
  warranty_months integer NOT NULL DEFAULT 12 CHECK (warranty_months >= 0),
  supplier_id     integer REFERENCES suppliers(id) ON DELETE SET NULL,
  description     text,
  images          jsonb NOT NULL DEFAULT '[]'::jsonb,
  track_serial    boolean NOT NULL DEFAULT true,
  min_stock       integer NOT NULL DEFAULT 1,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(lower(name));
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);

-- Mỗi chiếc đồng hồ (serial) quản lý độc lập
CREATE TABLE IF NOT EXISTS product_serials (
  id              serial PRIMARY KEY,
  product_id      integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  serial_number   text NOT NULL UNIQUE,
  movement_number text,
  condition       text NOT NULL DEFAULT 'new' CHECK (condition IN ('new','used','repaired')),
  cost_price      bigint NOT NULL DEFAULT 0,
  warehouse_id    integer REFERENCES warehouses(id),
  status          text NOT NULL DEFAULT 'in_stock'
                  CHECK (status IN ('in_stock','sold','repairing','exported','returned_supplier')),
  is_consignment  boolean NOT NULL DEFAULT false,
  consignor_name  text,
  consignor_phone text,
  consignment_price bigint,
  consignment_settled_at timestamptz,
  supplier_id     integer REFERENCES suppliers(id) ON DELETE SET NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  sold_at         timestamptz,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_serials_product ON product_serials(product_id);

CREATE TABLE IF NOT EXISTS product_price_history (
  id          bigserial PRIMARY KEY,
  product_id  integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field       text NOT NULL,
  old_value   bigint,
  new_value   bigint,
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- KHO
-- Tồn kho hiện tại: KHÔNG được ghi trực tiếp, chỉ được cập nhật bởi trigger của stock_movements
CREATE TABLE IF NOT EXISTS stock_levels (
  product_id   integer NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  warehouse_id integer NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  quantity     integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_documents (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  doc_type        text NOT NULL CHECK (doc_type IN ('import','export','transfer','stocktake','adjust','consign_in','consign_return','repair_out','repair_in')),
  warehouse_id    integer NOT NULL REFERENCES warehouses(id),
  to_warehouse_id integer REFERENCES warehouses(id),
  supplier_id     integer REFERENCES suppliers(id) ON DELETE SET NULL,
  reason          text,
  total_amount    bigint NOT NULL DEFAULT 0,
  paid_amount     bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  note            text,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_document_items (
  id           serial PRIMARY KEY,
  document_id  integer NOT NULL REFERENCES stock_documents(id) ON DELETE CASCADE,
  product_id   integer NOT NULL REFERENCES products(id),
  serial_id    integer REFERENCES product_serials(id),
  quantity     integer NOT NULL,
  unit_cost    bigint NOT NULL DEFAULT 0,
  system_qty   integer,
  counted_qty  integer,
  note         text
);

-- SỔ CÁI TỒN KHO: bất biến (không sửa, không xóa)
CREATE TABLE IF NOT EXISTS stock_movements (
  id            bigserial PRIMARY KEY,
  product_id    integer NOT NULL REFERENCES products(id),
  warehouse_id  integer NOT NULL REFERENCES warehouses(id),
  serial_id     integer REFERENCES product_serials(id),
  qty_change    integer NOT NULL CHECK (qty_change <> 0),
  balance_after integer,
  unit_cost     bigint NOT NULL DEFAULT 0,
  ref_type      text NOT NULL,
  ref_id        integer,
  ref_code      text,
  note          text,
  created_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id, created_at DESC);

CREATE OR REPLACE FUNCTION fn_apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_balance integer;
BEGIN
  PERFORM set_config('watchpos.via_ledger', 'on', true);
  INSERT INTO stock_levels(product_id, warehouse_id, quantity, updated_at)
    VALUES (NEW.product_id, NEW.warehouse_id, NEW.qty_change, now())
  ON CONFLICT (product_id, warehouse_id)
    DO UPDATE SET quantity = stock_levels.quantity + NEW.qty_change, updated_at = now()
  RETURNING quantity INTO v_balance;
  PERFORM set_config('watchpos.via_ledger', 'off', true);
  IF v_balance < 0 THEN
    RAISE EXCEPTION 'Tồn kho không đủ (sản phẩm #%, kho #%)', NEW.product_id, NEW.warehouse_id;
  END IF;
  NEW.balance_after := v_balance;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stock_movement_apply ON stock_movements;
CREATE TRIGGER trg_stock_movement_apply BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_apply_stock_movement();

CREATE OR REPLACE FUNCTION fn_block_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sổ cái tồn kho là bất biến: không được sửa/xóa lịch sử nhập xuất';
END $$;
DROP TRIGGER IF EXISTS trg_stock_movement_immutable ON stock_movements;
CREATE TRIGGER trg_stock_movement_immutable BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION fn_block_ledger_change();

CREATE OR REPLACE FUNCTION fn_guard_stock_levels() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('watchpos.via_ledger', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'Không được thay đổi tồn kho trực tiếp. Hãy tạo phiếu kho để có lịch sử giao dịch.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stock_levels_guard ON stock_levels;
CREATE TRIGGER trg_stock_levels_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_levels
  FOR EACH ROW EXECUTE FUNCTION fn_guard_stock_levels();

-- ---------------------------------------------------------------- BÁN HÀNG
CREATE TABLE IF NOT EXISTS promotions (
  id           serial PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','amount')),
  discount_value bigint NOT NULL CHECK (discount_value > 0),
  max_discount bigint,
  min_order    bigint NOT NULL DEFAULT 0,
  start_date   date,
  end_date     date,
  usage_limit  integer,
  used_count   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_shifts (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  user_id       integer NOT NULL REFERENCES users(id),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  opening_cash  bigint NOT NULL DEFAULT 0,
  expected_cash bigint,
  counted_cash  bigint,
  difference    bigint,
  note          text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);

CREATE TABLE IF NOT EXISTS orders (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  customer_id     integer REFERENCES customers(id) ON DELETE SET NULL,
  warehouse_id    integer NOT NULL REFERENCES warehouses(id),
  shift_id        integer REFERENCES cash_shifts(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled','returned','partial_returned')),
  subtotal        bigint NOT NULL DEFAULT 0,
  item_discount   bigint NOT NULL DEFAULT 0,
  discount_type   text CHECK (discount_type IN ('percent','amount')),
  discount_value  bigint NOT NULL DEFAULT 0,
  discount_amount bigint NOT NULL DEFAULT 0,
  promotion_id    integer REFERENCES promotions(id) ON DELETE SET NULL,
  promotion_amount bigint NOT NULL DEFAULT 0,
  total           bigint NOT NULL DEFAULT 0,
  paid_amount     bigint NOT NULL DEFAULT 0,
  customer_given  bigint NOT NULL DEFAULT 0,
  change_amount   bigint NOT NULL DEFAULT 0,
  cost_total      bigint NOT NULL DEFAULT 0,
  refunded_amount bigint NOT NULL DEFAULT 0,
  note            text,
  cancel_reason   text,
  print_count     integer NOT NULL DEFAULT 0,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

CREATE TABLE IF NOT EXISTS order_items (
  id            serial PRIMARY KEY,
  order_id      integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    integer NOT NULL REFERENCES products(id),
  serial_id     integer REFERENCES product_serials(id),
  product_name  text NOT NULL,
  sku           text,
  serial_number text,
  quantity      integer NOT NULL CHECK (quantity > 0),
  unit_price    bigint NOT NULL,
  discount      bigint NOT NULL DEFAULT 0,
  line_total    bigint NOT NULL,
  unit_cost     bigint NOT NULL DEFAULT 0,
  returned_qty  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_payments (
  id          serial PRIMARY KEY,
  order_id    integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method      text NOT NULL CHECK (method IN ('cash','transfer','card')),
  amount      bigint NOT NULL,
  reference   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_returns (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  order_id      integer NOT NULL REFERENCES orders(id),
  reason        text,
  refund_amount bigint NOT NULL DEFAULT 0,
  refund_method text NOT NULL DEFAULT 'cash' CHECK (refund_method IN ('cash','transfer')),
  cost_amount   bigint NOT NULL DEFAULT 0,
  created_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_return_items (
  id            serial PRIMARY KEY,
  return_id     integer NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
  order_item_id integer NOT NULL REFERENCES order_items(id),
  quantity      integer NOT NULL CHECK (quantity > 0),
  refund_amount bigint NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- BẢO HÀNH & SỬA CHỮA
CREATE TABLE IF NOT EXISTS warranties (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  order_id      integer REFERENCES orders(id) ON DELETE SET NULL,
  customer_id   integer REFERENCES customers(id) ON DELETE SET NULL,
  product_id    integer REFERENCES products(id) ON DELETE SET NULL,
  serial_id     integer REFERENCES product_serials(id) ON DELETE SET NULL,
  serial_number text NOT NULL,
  product_name  text NOT NULL,
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  terms         text,
  note          text,
  created_by    integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair_tickets (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  customer_id     integer REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text NOT NULL,
  customer_phone  text,
  warranty_id     integer REFERENCES warranties(id) ON DELETE SET NULL,
  product_id      integer REFERENCES products(id) ON DELETE SET NULL,
  watch_brand     text,
  watch_model     text,
  serial_number   text,
  receive_condition text,
  accessories     text,
  issue           text NOT NULL,
  is_warranty     boolean NOT NULL DEFAULT false,
  estimated_cost  bigint NOT NULL DEFAULT 0,
  final_cost      bigint NOT NULL DEFAULT 0,
  deposit         bigint NOT NULL DEFAULT 0,
  technician      text,
  status          text NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','diagnosing','repairing','waiting_parts','done','delivered','cancelled')),
  received_at     timestamptz NOT NULL DEFAULT now(),
  expected_at     date,
  delivered_at    timestamptz,
  note            text,
  created_by      integer REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair_parts (
  id          serial PRIMARY KEY,
  ticket_id   integer NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  part_name   text NOT NULL,
  quantity    integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost   bigint NOT NULL DEFAULT 0,
  unit_price  bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair_logs (
  id          serial PRIMARY KEY,
  ticket_id   integer NOT NULL REFERENCES repair_tickets(id) ON DELETE CASCADE,
  status      text NOT NULL,
  note        text,
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maintenance_reminders (
  id           serial PRIMARY KEY,
  customer_id  integer REFERENCES customers(id) ON DELETE CASCADE,
  warranty_id  integer REFERENCES warranties(id) ON DELETE CASCADE,
  serial_number text,
  product_name text,
  due_date     date NOT NULL,
  reminder_type text NOT NULL DEFAULT 'maintenance',
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- THU CHI
CREATE TABLE IF NOT EXISTS cash_transactions (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  tx_type     text NOT NULL CHECK (tx_type IN ('receipt','payment')),
  category    text NOT NULL,
  method      text NOT NULL CHECK (method IN ('cash','transfer','card')),
  amount      bigint NOT NULL CHECK (amount > 0),
  ref_type    text,
  ref_id      integer,
  customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id integer REFERENCES suppliers(id) ON DELETE SET NULL,
  shift_id    integer REFERENCES cash_shifts(id) ON DELETE SET NULL,
  payer_name  text,
  note        text,
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_created ON cash_transactions(created_at DESC);

-- ---------------------------------------------------------------- CHẤM CÔNG
CREATE TABLE IF NOT EXISTS attendance_records (
  id            serial PRIMARY KEY,
  user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date     date NOT NULL,
  work_shift_id integer REFERENCES work_shifts(id) ON DELETE SET NULL,
  check_in      timestamptz,
  check_out     timestamptz,
  check_in_lat  double precision,
  check_in_lng  double precision,
  check_out_lat double precision,
  check_out_lng double precision,
  check_in_distance  integer,
  check_out_distance integer,
  late_minutes  integer NOT NULL DEFAULT 0,
  early_minutes integer NOT NULL DEFAULT 0,
  work_minutes  integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'present' CHECK (status IN ('present','late','absent','leave')),
  note          text,
  adjusted_by   integer REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_date   date NOT NULL,
  to_date     date NOT NULL,
  reason      text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
