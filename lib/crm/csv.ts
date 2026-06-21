// Tiny dependency-free CSV parser. Handles quoted fields, escaped quotes (""),
// embedded commas/newlines, and CRLF. Good enough for spreadsheet exports.
export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); out.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); out.push(row); }

  const nonEmpty = out.filter((r) => r.some((cell) => cell.trim() !== ''));
  const headers = (nonEmpty.shift() || []).map((h) => h.trim());
  return { headers, rows: nonEmpty };
}

// Serialise rows to CSV text (RFC-4180-ish: quote fields with comma/quote/newline).
export function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

// Trigger a client-side CSV download.
export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

// Best-effort auto-match a form field to a CSV header (case/space/underscore-insensitive).
export function autoMatch(fieldKey: string, fieldLabel: string, headers: string[]): number {
  const norm = (x: string) => x.toLowerCase().replace(/[\s_-]+/g, '');
  const targets = [norm(fieldKey), norm(fieldLabel)];
  return headers.findIndex((h) => targets.includes(norm(h)));
}
