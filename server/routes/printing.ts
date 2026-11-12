/**
 * In RAW qua máy chủ: máy tính chạy WATCH POS gửi lệnh ESC/POS / TSPL thẳng tới máy in đã cài trong hệ điều hành.
 * - Windows: Print Spooler (winspool.drv) với kiểu dữ liệu RAW, gọi qua PowerShell → không cần cài thêm gì.
 * - Linux/macOS: CUPS `lp -o raw`.
 * Dùng cho máy in tem Xprinter X350B (USB) và máy in bill nối với máy tính.
 */
import { Router } from 'express';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { audit, badRequest, requirePerm } from '../core.ts';
import { DATA_DIR } from '../db.ts';

export const router = Router();
const isWin = process.platform === 'win32';

const RAW_PS1 = `param([string]$PrinterName, [string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WatchPosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("Khong mo duoc may in (OpenPrinter) - ma loi " + Marshal.GetLastWin32Error());
    try {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = "WATCH POS";
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("StartDocPrinter loi " + Marshal.GetLastWin32Error());
      StartPagePrinter(h);
      int written;
      bool ok = WritePrinter(h, bytes, bytes.Length, out written);
      EndPagePrinter(h);
      EndDocPrinter(h);
      if (!ok || written != bytes.Length) throw new Exception("WritePrinter loi " + Marshal.GetLastWin32Error());
    } finally { ClosePrinter(h); }
  }
}
"@
[WatchPosRawPrinter]::Send($PrinterName, [System.IO.File]::ReadAllBytes($Path))
`;

function run(cmd: string, args: string[], timeout = 30000) {
  return new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim().split('\n').slice(-3).join(' ')));
      else resolve(stdout.toString());
    });
  });
}

export async function listPrinters(): Promise<string[]> {
  if (isWin) {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | ForEach-Object { $_.Name }']);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const out = await run('lpstat', ['-e']);
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export async function sendRaw(printer: string, data: Buffer) {
  const dir = path.join(DATA_DIR, 'print-jobs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.bin`);
  fs.writeFileSync(file, data);
  try {
    if (isWin) {
      const script = path.join(dir, 'raw-print.ps1');
      // Ghi script với BOM UTF-8 để PowerShell 5 đọc đúng
      if (!fs.existsSync(script) || fs.readFileSync(script, 'utf8').replace(/^﻿/, '') !== RAW_PS1) fs.writeFileSync(script, '﻿' + RAW_PS1);
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-PrinterName', printer, '-Path', file]);
    } else {
      await run('lp', ['-d', printer, '-o', 'raw', file]);
    }
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

router.get('/printing/printers', requirePerm('pos.sell', 'products.view'), async (_req, res) => {
  try {
    res.json({ platform: process.platform, host: os.hostname(), printers: await listPrinters() });
  } catch (e: any) {
    res.json({ platform: process.platform, host: os.hostname(), printers: [], error: `Không đọc được danh sách máy in: ${e.message}` });
  }
});

const rawSchema = z.object({
  printer: z.string().trim().min(1, 'Chọn máy in').max(200),
  data: z.string().min(1).max(30 * 1024 * 1024), // base64
  kind: z.enum(['receipt', 'label', 'test']).default('test'),
  ref: z.string().max(100).optional(),
});
router.post('/printing/raw', requirePerm('pos.sell', 'products.view'), async (req, res) => {
  const b = rawSchema.parse(req.body);
  if (/[\r\n"`$]/.test(b.printer)) throw badRequest('Tên máy in không hợp lệ');
  const buf = Buffer.from(b.data, 'base64');
  if (!buf.length) throw badRequest('Không có dữ liệu in');
  try {
    await sendRaw(b.printer, buf);
  } catch (e: any) {
    throw badRequest(`Gửi lệnh in tới "${b.printer}" thất bại: ${e.message}`);
  }
  if (b.kind !== 'test') await audit(req, 'print', b.kind === 'label' ? 'product' : 'order', b.ref ?? null, `In ${b.kind === 'label' ? 'tem' : 'hóa đơn'} trực tiếp qua máy in "${b.printer}" (${buf.length} byte)`);
  res.json({ ok: true, bytes: buf.length });
});
