'use client';

/**
 * Reading and writing the two structured kinds — as markdown.
 *
 * WHY MARKDOWN AND NOT JSON. Every kind lives in the same `body` column, so a
 * todo opened in the rich editor is a checklist, a sheet is a table, and both
 * are searchable by the same query and exportable by one code path. A JSON blob
 * would be easier to parse and would cost all three of those.
 */

// ── Checklists ──────────────────────────────────────────────────────────────

export interface TodoItem { id: string; text: string; done: boolean; indent: number }

// `- [ ] text`, `* [x] text`, and indented children. Leading spaces are the
// nesting level, two per step, matching what the rich editor emits.
const TODO_RE = /^(\s*)[-*]\s+\[([ xX])\]\s?(.*)$/;

export function parseTodo(body: string): { items: TodoItem[]; prelude: string } {
  const lines = body.split('\n');
  const items: TodoItem[] = [];
  const prelude: string[] = [];
  let seenItem = false;

  lines.forEach((line, i) => {
    const m = TODO_RE.exec(line);
    if (m) {
      seenItem = true;
      items.push({
        id: `i${i}`,
        indent: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)),
        done: m[2].toLowerCase() === 'x',
        text: m[3],
      });
    } else if (!seenItem && line.trim()) {
      // Text above the first item is a note about the list, and is kept. Text
      // BELOW an item is dropped on save — a checklist editor cannot show a
      // paragraph wedged between two items, and silently keeping something
      // invisible is worse than not keeping it.
      prelude.push(line);
    }
  });

  return { items, prelude: prelude.join('\n').trim() };
}

export function serializeTodo(items: TodoItem[], prelude = ''): string {
  const body = items
    .map((t) => `${'  '.repeat(t.indent)}- [${t.done ? 'x' : ' '}] ${t.text}`)
    .join('\n');
  return prelude ? `${prelude}\n\n${body}` : body;
}

// ── Tables ──────────────────────────────────────────────────────────────────

export interface Sheet { headers: string[]; rows: string[][] }

const isDivider = (line: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');

/** Split a `| a | b |` row, tolerating a missing leading or trailing pipe. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // `\|` is an escaped pipe inside a cell, not a separator.
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

export function parseSheet(body: string): Sheet {
  const lines = body.split('\n').filter((l) => l.trim());
  const tableLines = lines.filter((l) => l.includes('|'));
  if (!tableLines.length) return { headers: ['Column 1', 'Column 2'], rows: [['', '']] };

  const [head, ...rest] = tableLines;
  const headers = splitRow(head);
  const rows = rest.filter((l) => !isDivider(l)).map((l) => {
    const cells = splitRow(l);
    // Padded and trimmed to the header width, so a ragged table still renders
    // as a grid instead of throwing off every row after the bad one.
    while (cells.length < headers.length) cells.push('');
    return cells.slice(0, headers.length);
  });
  return { headers, rows: rows.length ? rows : [headers.map(() => '')] };
}

const esc = (c: string) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function serializeSheet(s: Sheet): string {
  const head = `| ${s.headers.map(esc).join(' | ')} |`;
  const div = `| ${s.headers.map(() => '---').join(' | ')} |`;
  const rows = s.rows.map((r) => `| ${r.map(esc).join(' | ')} |`);
  return [head, div, ...rows].join('\n');
}

/** RFC 4180: quote any cell containing a comma, quote or newline; double inner quotes. */
export function sheetToCsv(s: Sheet): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [s.headers, ...s.rows].map((r) => r.map(cell).join(','));
  // BOM + CRLF for the same reason as the spreadsheet feed (0078): without them
  // Excel on Windows mangles non-ASCII and runs the whole file onto one line.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function csvToSheet(csv: string): Sheet {
  const text = csv.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  const clean = rows.filter((r) => r.some((v) => v.trim()));
  if (!clean.length) return { headers: ['Column 1'], rows: [['']] };
  const [headers, ...rest] = clean;
  return {
    headers,
    rows: rest.length
      ? rest.map((r) => { while (r.length < headers.length) r.push(''); return r.slice(0, headers.length); })
      : [headers.map(() => '')],
  };
}
