/**
 * Turn a lump of text into field values for one object.
 *
 * ZERO IMPORTS, for the reason lib/workspace/blueprint.ts and lib/insights/spec.ts
 * both carry: this is used inside a route handler, and reaching into lib/crm/*
 * pulls a `use client` module and the browser Supabase client into the build,
 * which fails at page-data collection with a message naming neither.
 *
 * ── THE MODEL FILLS A FORM, IT DOES NOT WRITE A RECORD ──────────────────────
 * It is handed the object's declared FIELDS and the text, and returns a flat
 * `{ key: value }` map. Every key is then checked against the form's real
 * fields, every value coerced to the declared input type, and anything that
 * does not fit is DROPPED and reported. Nothing is saved: the values open a
 * prefilled RecordForm and a person presses Save.
 *
 * That separation is the same one /api/workspace/build makes and for the same
 * reason. The text is untrusted — it is a pasted email, an invoice somebody was
 * sent, a PDF from a stranger — and so is anything a model does with it. The
 * worst a prompt injection achieves here is a wrong value sitting in a form
 * field, in front of the person who pasted it, before anything is written.
 *
 * FAILS CLOSED PER FIELD, not per document. One unparseable date should not
 * throw away a correctly-read total; the point is to save typing, and a form
 * that is three-quarters filled has done that.
 */

export interface ExtractField {
  key: string;
  label: string;
  /** Mirrors FormField['input'] in lib/crm/types.ts. */
  input: string;
  options?: string[];
}

export interface ExtractResult {
  values: Record<string, string>;
  /** Fields the model offered that could not be used, and why. Shown, not swallowed. */
  dropped: string[];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** `1 234,56 zł` / `$1,234.56` / `1.234,56` → `1234.56`. Null when there is no number. */
function toNumber(raw: string): string | null {
  const cleaned = raw.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return null;
  // Whichever separator appears LAST is the decimal one — this is the only rule
  // that reads "1.234,56" and "1,234.56" correctly without knowing the locale.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalised = cleaned;
  if (lastComma > lastDot) normalised = cleaned.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma) normalised = cleaned.replace(/,/g, '');
  else normalised = cleaned.replace(/[.,]/g, '');
  const n = Number(normalised);
  return Number.isFinite(n) ? String(n) : null;
}

/** Anything a model plausibly emits for a date → `YYYY-MM-DD`, or null. */
function toDate(raw: string): string | null {
  const s = raw.trim();
  const iso = ISO_DATE.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY and DD.MM.YYYY. NOT MM/DD/YYYY: guessing between them silently
  // moves an invoice by up to eleven months, so the ambiguous form is refused
  // rather than resolved by coin flip.
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (dmy) {
    const first = Number(dmy[1]); const second = Number(dmy[2]);
    // Only unambiguous when the first part CANNOT be a month. 03/04/2026 is
    // refused rather than resolved by coin flip — the model is asked for ISO,
    // so this fallback should be rare, and a silently wrong date on an invoice
    // is worse than an empty field the person fills in.
    if (first > 12 && second <= 12) {
      return `${dmy[3]}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`;
    }
    return null;
  }
  return null;
}

/** Case- and separator-insensitive match onto a declared option. */
function toOption(raw: string, options: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const target = norm(raw);
  return options.find((o) => norm(o) === target)
      ?? options.find((o) => norm(o).startsWith(target) && target.length >= 3)
      ?? null;
}

export function normalizeExtraction(raw: any, fields: ExtractField[]): ExtractResult {
  const out: Record<string, string> = {};
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object') return { values: out, dropped };

  const byKey = new Map(fields.map((f) => [f.key, f]));

  for (const [key, value] of Object.entries(raw)) {
    const field = byKey.get(key);
    // An undeclared key is dropped silently — a model naming a column this
    // object does not have is noise, not a decision anybody needs to review.
    if (!field) continue;
    if (value === null || value === undefined) continue;

    const text = String(value).trim();
    if (!text) continue;

    switch (field.input) {
      case 'number': {
        const n = toNumber(text);
        if (n === null) dropped.push(`${field.label}: “${text}” is not a number`);
        else out[key] = n;
        break;
      }
      case 'date': {
        const d = toDate(text);
        if (d === null) dropped.push(`${field.label}: “${text}” is not an unambiguous date`);
        else out[key] = d;
        break;
      }
      case 'select': {
        const opts = field.options || [];
        if (opts.length === 0) { out[key] = text; break; }
        const o = toOption(text, opts);
        if (o === null) dropped.push(`${field.label}: “${text}” is not one of ${opts.join(', ')}`);
        else out[key] = o;
        break;
      }
      // A relation is a uuid this workspace owns. A model cannot know one, and
      // accepting a NAME here would write a broken foreign key that only
      // surfaces later as a blank column — so the person picks it in the form.
      case 'relation':
      case 'lookup':
      case 'image':
        dropped.push(`${field.label}: pick this one yourself`);
        break;
      default:
        out[key] = text.slice(0, 2000);
    }
  }

  return { values: out, dropped };
}

/** The field list a model is shown. Kept short — labels and types, no prose. */
export function fieldsPrompt(fields: ExtractField[]): string {
  return fields
    .filter((f) => !['relation', 'lookup', 'image'].includes(f.input))
    .map((f) => `${f.key} (${f.input}${f.options?.length ? `: ${f.options.join('|')}` : ''}) — ${f.label}`)
    .join('\n');
}
