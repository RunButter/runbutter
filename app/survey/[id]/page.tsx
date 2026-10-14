import type { Metadata } from 'next';
import SurveyRespond from '@/components/surveys/SurveyRespond';

/**
 * /survey/<id> — answering a customer survey (0138). Public and framable
 * (next.config.js exempts /survey/* like /book/* and /support/*): an emailed
 * button lands here with `?i=&t=&score=`, the share link without.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Quick question', robots: { index: false, follow: false } };

export default function SurveyPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  return <SurveyRespond surveyId={params.id} embed={searchParams.embed === '1'} />;
}
