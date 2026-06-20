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

// Best-effort auto-match a form field to a CSV header (case/space/underscore-insensitive).
export function autoMatch(fieldKey: string, fieldLabel: string, headers: string[]): number {
  const norm = (x: string) => x.toLowerCase().replace(/[\s_-]+/g, '');
  const targets = [norm(fieldKey), norm(fieldLabel)];
  return headers.findIndex((h) => targets.includes(norm(h)));
}
