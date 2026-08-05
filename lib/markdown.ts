/**
 * A small, dependency-free markdown → HTML renderer for the docs site.
 *
 * WHY NOT A LIBRARY. This renders files that live in this repository and are
 * reviewed in pull requests, at build time, on the server. That is a narrow
 * enough job that `marked` + a sanitiser + their transitive dependencies would
 * be more supply chain than the feature is worth. It is deliberately NOT
 * general-purpose: do not point it at anything a user typed.
 *
 * Source text is HTML-escaped first, so a `<script>` in a doc renders as
 * characters. The only HTML in the output is what this file emits.
 *
 * `lib/crm/doc-export.ts` has its own markdown→HTML for Word export. They are
 * not merged because that one renders checkboxes as printable characters and
 * drops images by design; the differences are the point of each.
 */

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Heading id, matching what a GitHub anchor would be, so links carry over. */
export const slugifyHeading = (s: string) =>
  s.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

function inline(src: string): string {
  let s = escapeHtml(src);
  // Code first: whatever is inside a backtick span must not then be read as
  // emphasis or a link.
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);

  s = s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
      const external = /^https?:\/\//.test(href);
      const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${rel}>${text}</a>`;
    })
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/(?<![\w*])\*([^*\n]+)\*(?!\w)/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const cells = (row: string) =>
  row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export interface Heading { level: number; text: string; id: string }

export interface Rendered { html: string; title: string; headings: Heading[] }

export function renderMarkdown(src: string): Rendered {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const headings: Heading[] = [];
  let title = '';
  let i = 0;
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code. Everything inside is literal, including things that look
    // like markdown — which is most of what the install docs contain.
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      closeList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre><code data-lang="${fence[1] || ''}">${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { closeList(); i++; continue; }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeList(); out.push('<hr />'); i++; continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1].length;
      const text = h[2].replace(/\s*#+\s*$/, '');
      const id = slugifyHeading(text.replace(/[*`_]/g, ''));
      if (level === 1 && !title) title = text.replace(/[*`_]/g, '');
      else headings.push({ level, text: text.replace(/[*`_]/g, ''), id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    // Table: a header row, a separator of dashes, then rows.
    if (line.includes('|') && /^\s*\|?[\s:-]*-[-\s:|]*\|?\s*$/.test(lines[i + 1] || '')) {
      closeList();
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(cells(lines[i++]));
      out.push(
        '<div class="table-scroll"><table><thead><tr>' +
        head.map((c) => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table></div>',
      );
      continue;
    }

    // Blockquote, including the multi-line kind.
    if (/^>\s?/.test(line)) {
      closeList();
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${body.map((b) => `<p>${inline(b)}</p>`).join('')}</blockquote>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      i++;
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(ordered[1])}</li>`);
      i++;
      continue;
    }

    // A wrapped list item: indented, inside a list, not a new bullet. Without
    // this the second line of "3. Paste one SQL file — if you would rather not\n
    // run a migration command" becomes its own paragraph BELOW the list, which
    // is how a sentence ends up cut in half on the page.
    if (list && /^\s{2,}\S/.test(line)) {
      const prev = out.pop() as string;
      out.push(prev.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`));
      i++;
      continue;
    }

    // A paragraph runs until a blank line, so wrapped prose stays one <p>.
    closeList();
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() &&
      !/^(#{1,4}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }

  closeList();
  return { html: out.join('\n'), title, headings };
}
