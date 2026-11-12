/** Kiểm thử bộ mã hóa lệnh in (ESC/POS, TSPL) và API in RAW của máy chủ */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { escposRaster, tsplLabels, type MonoBitmap } from '../src/lib/raster.ts';

// Ảnh 16x2: hàng 0 = 8 chấm đen bên trái, hàng 1 = toàn trắng
const bmp: MonoBitmap = { width: 16, height: 2, data: new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, ...Array(16).fill(0)]) };

test('ESC/POS: lệnh GS v 0 đúng kích thước và bit 1 = đen', () => {
  const b = escposRaster(bmp, { cut: true, feed: 1 });
  assert.deepEqual([...b.slice(0, 2)], [0x1b, 0x40]);
  const i = b.findIndex((v, k) => v === 0x1d && b[k + 1] === 0x76 && b[k + 2] === 0x30);
  assert.ok(i > 0);
  assert.deepEqual([...b.slice(i + 4, i + 8)], [2, 0, 2, 0], 'rộng 2 byte, cao 2 dòng');
  assert.deepEqual([...b.slice(i + 8, i + 12)], [0xff, 0x00, 0x00, 0x00]);
  assert.deepEqual([...b.slice(-4)], [0x1d, 0x56, 0x42, 0x00], 'lệnh cắt giấy');
});

test('TSPL: SIZE/GAP/BITMAP/PRINT, mặc định bit 0 = in (đen)', () => {
  const b = tsplLabels([{ bmp, copies: 3 }], { width_mm: 50, height_mm: 30, gap_mm: 2, density: 10, speed: 4, direction: 1, invert: false });
  const txt = Buffer.from(b).toString('latin1');
  assert.match(txt, /^SIZE 50 mm,30 mm\r\nGAP 2 mm,0 mm\r\n/);
  assert.match(txt, /BITMAP 0,0,2,2,0,/);
  assert.match(txt, /\r\nPRINT 1,3\r\n$/);
  const start = txt.indexOf('BITMAP 0,0,2,2,0,') + 'BITMAP 0,0,2,2,0,'.length;
  assert.deepEqual([...b.slice(start, start + 4)], [0x00, 0xff, 0xff, 0xff]);
  const inv = tsplLabels([{ bmp, copies: 1 }], { width_mm: 50, height_mm: 30, gap_mm: 2, density: 10, speed: 4, direction: 1, invert: true });
  const s2 = Buffer.from(inv).toString('latin1').indexOf('BITMAP 0,0,2,2,0,') + 17;
  assert.deepEqual([...inv.slice(s2, s2 + 4)], [0xff, 0x00, 0x00, 0x00], 'chế độ đảo màu');
});

// ---------------------------------------------------------------- API in RAW (giả lập CUPS `lp` trên Linux/macOS)
const skip = process.platform === 'win32';
let server: Server; let base = ''; let token = '';
const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-lp-'));
const outFile = path.join(binDir, 'printed.bin');

before(async () => {
  if (skip) return;
  fs.writeFileSync(path.join(binDir, 'lp'), `#!/bin/sh\nfor a; do last="$a"; done\necho "$@" > "${binDir}/args.txt"\ncp "$last" "${outFile}"\necho "request id is X350B-1"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'lpstat'), `#!/bin/sh\necho "Xprinter_XP_350B"\necho "Bill_K80"\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}:${process.env.PATH}`;
  process.env.WATCHPOS_MEMORY_DB = '1';
  process.env.WATCHPOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'watchpos-print-'));
  process.env.JWT_SECRET = 'x';
  delete process.env.DATABASE_URL;
  const { openDatabase } = await import('../server/db.ts');
  const { bootstrap, createApp } = await import('../server/app.ts');
  await openDatabase({ memory: true });
  await bootstrap();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const r: any = await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })).json();
  token = r.token;
});
after(async () => { if (!skip) { server.close(); (await import('../server/db.ts')).closeDatabase(); } });

test('API liệt kê máy in và gửi RAW đúng từng byte', { skip }, async () => {
  const h = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const list: any = await (await fetch(base + '/printing/printers', { headers: h })).json();
  assert.deepEqual(list.printers, ['Xprinter_XP_350B', 'Bill_K80']);
  const data = tsplLabels([{ bmp, copies: 2 }], { width_mm: 40, height_mm: 25, gap_mm: 2, density: 8, speed: 4, direction: 1, invert: false });
  const res = await fetch(base + '/printing/raw', { method: 'POST', headers: h, body: JSON.stringify({ printer: 'Xprinter_XP_350B', data: Buffer.from(data).toString('base64'), kind: 'label' }) });
  assert.equal(res.status, 200, await res.text());
  assert.deepEqual([...fs.readFileSync(outFile)], [...data]);
  assert.match(fs.readFileSync(path.join(binDir, 'args.txt'), 'utf8'), /-d Xprinter_XP_350B -o raw/);
  const bad = await fetch(base + '/printing/raw', { method: 'POST', headers: h, body: JSON.stringify({ printer: 'x"; rm -rf /', data: 'AA==' }) });
  assert.equal(bad.status, 400);
  const noAuth = await fetch(base + '/printing/raw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noAuth.status, 401);
});
