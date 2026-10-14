// The survey email — SERVER ONLY. The question and the scale ARE the email:
// each number is a link that records that answer when it opens, so answering
// is one tap, and the page then asks the follow-up question.
import { surveyLink } from '@/lib/surveys/token';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface SurveyMailInput {
  surveyId: string; inviteId: string; firstName?: string | null;
  kind: 'nps' | 'csat'; question: string; company: string; accent?: string | null;
}

export function surveyEmail(m: SurveyMailInput): { subject: string; html: string; text: string; unsubscribe: string } {
  const scale = m.kind === 'csat' ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const color = /^#[0-9a-f]{6}$/i.test(m.accent || '') ? m.accent! : '#18181b';
  const optOut = surveyLink(m.surveyId, m.inviteId, { unsubscribe: 1 });
  const cell = (n: number) => `<td style="padding:2px"><a href="${esc(surveyLink(m.surveyId, m.inviteId, { score: n }))}" style="display:block;width:${m.kind === 'csat' ? 44 : 34}px;height:40px;line-height:40px;text-align:center;border:1px solid #d4d4d8;border-radius:8px;color:#18181b;text-decoration:none;font-size:15px;font-weight:600">${m.kind === 'csat' ? ['😞', '🙁', '😐', '🙂', '😄'][n - 1] : n}</a></td>`;
  const legend = m.kind === 'csat'
    ? '<td style="font-size:12px;color:#71717a">Very unsatisfied</td><td style="font-size:12px;color:#71717a;text-align:right">Very satisfied</td>'
    : '<td style="font-size:12px;color:#71717a">Not likely</td><td style="font-size:12px;color:#71717a;text-align:right">Very likely</td>';
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b;line-height:1.55">
    <p style="margin:0 0 6px;font-size:13px;color:${esc(color)}">${esc(m.company)}</p>
    <p style="margin:0 0 4px">${m.firstName ? `Hi ${esc(m.firstName)},` : 'Hi,'}</p>
    <p style="margin:0 0 18px;font-size:18px;font-weight:600">${esc(m.question)}</p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>${scale.map(cell).join('')}</tr></table>
    <table role="presentation" width="${m.kind === 'csat' ? 240 : 418}" cellspacing="0" cellpadding="0" style="margin-top:6px"><tr>${legend}</tr></table>
    <p style="margin:22px 0 0;font-size:13px;color:#52525b">One tap is enough — it takes you to a page where you can add a sentence if you like.</p>
    <p style="margin:22px 0 0;font-size:12px;color:#a1a1aa">You are getting this because you are a customer of ${esc(m.company)}. <a href="${esc(optOut)}" style="color:#a1a1aa">Don’t send me surveys</a></p>
  </div>`;
  const text = `${m.firstName ? `Hi ${m.firstName},` : 'Hi,'}\n\n${m.question}\n\n${scale.map((n) => `${n}: ${surveyLink(m.surveyId, m.inviteId, { score: n })}`).join('\n')}\n\nDon't send me surveys: ${optOut}\n`;
  return { subject: m.question.length <= 90 ? m.question : `A quick question from ${m.company}`, html, text, unsubscribe: optOut };
}
