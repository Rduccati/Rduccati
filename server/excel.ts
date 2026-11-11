import ExcelJS from 'exceljs';
import type { Response } from 'express';

export interface Col { header: string; key: string; width?: number; money?: boolean }

export async function sendExcel(res: Response, filename: string, sheet: string, cols: Col[], rows: any[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WATCH POS';
  const ws = wb.addWorksheet(sheet);
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 4) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C1B19' } };
  for (const r of rows) ws.addRow(r);
  cols.forEach((c, i) => { if (c.money) ws.getColumn(i + 1).numFmt = '#,##0'; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  await wb.xlsx.write(res);
  res.end();
}

/** Đọc sheet đầu tiên thành mảng object theo tiêu đề cột (dòng 1) */
export async function readExcel(buffer: Buffer): Promise<Record<string, any>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value ?? '').trim(); });
  const out: Record<string, any>[] = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const o: Record<string, any> = {};
    let has = false;
    row.eachCell((cell, col) => {
      const h = headers[col];
      if (!h) return;
      let v: any = cell.value;
      if (v && typeof v === 'object') {
        if ('result' in v) v = v.result;
        else if ('text' in v) v = v.text;
        else if ('richText' in v) v = v.richText.map((t: any) => t.text).join('');
        else if (v instanceof Date) v = v.toISOString().slice(0, 10);
      }
      if (v !== null && v !== undefined && v !== '') has = true;
      o[h] = v;
    });
    if (has) out.push(o);
  });
  return out;
}
