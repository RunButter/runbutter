'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, uploadCV } from '@/lib/supabase';
import Link from 'next/link';
import { Upload, FileText, Loader2, CheckCircle2, ArrowRight, X } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import LogoContainer from '@/components/LogoContainer';

export default function ApplyPage({ params }: { params: { positionId: string } }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [positionInfo, setPositionInfo] = useState<{ title: string; companyName: string; logoUrl: string | null } | null>(null);

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    linkedinUrl: '',
  });

  // Source attribution captured on load (UTM params, referrer, tracking link).
  const [attribution, setAttribution] = useState<{
    source: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    referrer: string | null;
    tracking_link_id: string | null;
  }>({ source: 'direct', utm_source: null, utm_medium: null, utm_campaign: null, referrer: null, tracking_link_id: null });

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const base = {
      source: qs.get('source') || qs.get('utm_source') || null,
      utm_source: qs.get('utm_source'),
      utm_medium: qs.get('utm_medium'),
      utm_campaign: qs.get('utm_campaign'),
      referrer: document.referrer || null,
    };
    const lt = qs.get('lt');
    if (lt) {
      // Authoritative attribution from the tracking link (also counts the click).
      // supabase.rpc returns a PromiseLike without .catch — use then(ok, err).
      supabase.rpc('register_link_click', { p_token: lt }).then(({ data }) => {
        if (data) {
          setAttribution({
            source: data.source || base.source || 'direct',
            utm_source: data.utm_source || base.utm_source,
            utm_medium: data.utm_medium || base.utm_medium,
            utm_campaign: data.utm_campaign || base.utm_campaign,
            referrer: base.referrer,
            tracking_link_id: data.id,
          });
        } else {
          setAttribution({ ...base, source: base.source || 'direct', tracking_link_id: null });
        }
      }, () => setAttribution({ ...base, source: base.source || 'direct', tracking_link_id: null }));
    } else {
      setAttribution({ ...base, source: base.source || 'direct', tracking_link_id: null });
    }
  }, []);

  useEffect(() => {
    const fetchPositionDetails = async () => {
      const { data, error } = await supabase
        .from('positions')
        .select(`
          title,
          companies (
            name,
            logo_url
          )
        `)
        .eq('id', params.positionId)
        .single();

      if (data && !error) {
        setPositionInfo({
          title: data.title,
          companyName: (data.companies as any).name,
          logoUrl: (data.companies as any).logo_url,
        });
      }
    };

    fetchPositionDetails();
  }, [params.positionId]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setCvFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024, // 5MB
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate
      if (!formData.fullName || !formData.email) {
        throw new Error('Please fill in all required fields');
      }

      if (!cvFile) {
        throw new Error('Please upload your CV/Resume');
      }

      // Get position details to get company_id
      const { data: position } = await supabase
        .from('positions')
        .select('company_id, title')
        .eq('id', params.positionId)
        .single();

      if (!position) {
        throw new Error('Position not found');
      }

      // Create the candidate + log the application in one SECURITY DEFINER RPC.
      // This replaces the direct anon table writes (candidates/activity_log are
      // no longer anon-accessible) and enforces the plan cap server-side. The
      // returned access_token gates the follow-up CV attach.
      const { data: created, error: candidateError } = await supabase.rpc('apply_to_position', {
        p_position_id: params.positionId,
        p_full_name: formData.fullName,
        p_email: formData.email,
        p_phone: formData.phone || null,
        p_linkedin: formData.linkedinUrl || null,
        p_source: attribution.source || 'direct',
        p_utm_source: attribution.utm_source,
        p_utm_medium: attribution.utm_medium,
        p_utm_campaign: attribution.utm_campaign,
        p_referrer: attribution.referrer,
        p_tracking_link_id: attribution.tracking_link_id,
      });

      if (candidateError) throw candidateError;
      const candidate = created as { id: string; access_token: string };

      // Upload CV
      const cvUrl = await uploadCV(cvFile, candidate.id);

      if (!cvUrl) {
        throw new Error('Failed to upload CV');
      }

      // Attach the CV url (gated by the access_token we just received).
      await supabase.rpc('set_candidate_cv', {
        p_candidate_id: candidate.id, p_access_token: candidate.access_token, p_cv_url: cvUrl,
      });

      // Extract resume text for zero-cost FTS search (fire-and-forget —
      // must never block or fail the candidate's application).
      fetch('/api/candidates/parse-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: candidate.id, cvUrl }),
      }).catch(console.error);

      // Notify the company's webhook integrations (Slack/Discord/Zapier/…),
      // fire-and-forget so it never blocks or fails the application.
      fetch('/api/webhooks/applicant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: candidate.id }),
      }).catch(console.error);

      setSuccess(true);
      setCandidateId(candidate.id);
      setAccessToken(candidate.access_token);

      // Trigger Welcome Email (non-blocking)
      const assessmentLink = `${window.location.origin}/apply/${params.positionId}/assessment?candidateId=${candidate.id}&token=${candidate.access_token}`;
      fetch('/api/email/candidate-welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          name: formData.fullName,
          position: position.title,
          company: positionInfo?.companyName,
          assessmentLink
        })
      }).catch(console.error);

    } catch (err: unknown) {
      console.error('Application error:', err);
      // Try to extract message from Supabase error object
      let message = 'Failed to submit application';
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === 'object' && err !== null && 'message' in err) {
        message = (err as any).message;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full h-11 px-3.5 text-[15px] rounded-xl bg-surface ring-1 ring-subtle shadow-card placeholder:text-tertiary focus:ring-2 focus:ring-accent/30 outline-none transition-shadow';

  // Shared brand header: the company applying to, not RunButter.
  const CompanyMark = ({ big = false }: { big?: boolean }) =>
    positionInfo?.logoUrl ? (
      <div className="flex justify-center">
        <LogoContainer src={positionInfo.logoUrl} alt={positionInfo.companyName} width={big ? '220px' : '160px'} height={big ? '90px' : '56px'} showBorder={false} className="" />
      </div>
    ) : (
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center text-accent-fg font-semibold text-lg">
            {positionInfo?.companyName?.charAt(0) || 'C'}
          </div>
          <span className="text-lg font-medium text-primary">{positionInfo?.companyName || ''}</span>
        </div>
      </div>
    );

  if (success) {
    return (
      <div className="min-h-[100dvh] bg-surface-sunken flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="bg-surface rounded-2xl ring-1 ring-subtle shadow-popover shadow-slate-200/50 p-8 text-center">
            <div className="mb-6"><CompanyMark /></div>
            <div className="w-14 h-14 bg-success/10 ring-1 ring-success/30 rounded-full flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-8 h-8 text-success" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-primary mb-2">Application submitted</h1>
            <p className="text-[15px] text-secondary mb-6">
              Thanks for applying. We received your details and CV.
            </p>

            <div className="rounded-xl bg-accent/10 ring-1 ring-accent/30 p-5 mb-5 text-left">
              <div className="text-[11px] font-medium uppercase tracking-wide text-accent mb-1">One more step</div>
              <h3 className="font-medium text-primary mb-1">Take the assessment</h3>
              <p className="text-[13px] text-secondary mb-4">
                A 10-15 minute work-style questionnaire completes your application. No right or wrong answers.
              </p>
              <Link
                href={`/apply/${params.positionId}/assessment?candidateId=${candidateId}&token=${accessToken}`}
                className="w-full h-11 rounded-xl bg-inverse text-inverse-fg font-medium inline-flex items-center justify-center gap-2 hover:bg-inverse/90 transition-colors"
              >
                Start assessment <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <p className="text-[12px] text-tertiary">
              This link was also emailed to <strong className="text-secondary">{formData.email}</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-surface-sunken py-10 px-4 sm:px-6">
      <div className="max-w-xl mx-auto">
        <div className="text-center mb-8">
          <div className="mb-6"><CompanyMark big /></div>
          <h1 className="text-3xl font-semibold tracking-tight text-primary">
            {positionInfo?.title || 'Apply'}
          </h1>
          {positionInfo?.companyName && (
            <p className="mt-1.5 text-[15px] text-secondary">Application for {positionInfo.companyName}</p>
          )}
        </div>

        <div className="bg-surface rounded-2xl ring-1 ring-subtle shadow-popover shadow-slate-200/50 p-6 sm:p-8">
          {error && (
            <div className="mb-6 flex items-start gap-2.5 p-3.5 rounded-xl bg-danger/10 ring-1 ring-danger/30 text-danger text-[14px]">
              <X className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block sm:col-span-2">
                <span className="block text-[13px] font-semibold text-secondary mb-1.5">Full name <span className="text-danger">*</span></span>
                <input type="text" className={inputCls} placeholder="Ada Nowak"
                  value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} required />
              </label>
              <label className="block sm:col-span-2">
                <span className="block text-[13px] font-semibold text-secondary mb-1.5">Email <span className="text-danger">*</span></span>
                <input type="email" className={inputCls} placeholder="ada@example.com"
                  value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
              </label>
              <label className="block">
                <span className="block text-[13px] font-semibold text-secondary mb-1.5">Phone</span>
                <input type="tel" className={inputCls} placeholder="+48 600 000 000"
                  value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              </label>
              <label className="block">
                <span className="block text-[13px] font-semibold text-secondary mb-1.5">LinkedIn</span>
                <input type="url" className={inputCls} placeholder="linkedin.com/in/ada"
                  value={formData.linkedinUrl} onChange={(e) => setFormData({ ...formData, linkedinUrl: e.target.value })} />
              </label>
            </div>

            <div>
              <span className="block text-[13px] font-semibold text-secondary mb-1.5">CV / Resume <span className="text-danger">*</span></span>
              <div
                {...getRootProps()}
                className={`rounded-xl ring-1 ring-dashed p-7 text-center cursor-pointer transition-colors ${isDragActive
                  ? 'ring-accent/30 bg-accent/10'
                  : cvFile
                    ? 'ring-success/30 bg-success/10'
                    : 'ring-strong hover:ring-accent/30 hover:bg-surface-sunken'
                  }`}
              >
                <input {...getInputProps()} />

                {cvFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-surface ring-1 ring-success/30 flex items-center justify-center">
                      <FileText className="w-5 h-5 text-success" />
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-primary text-[14px]">{cvFile.name}</p>
                      <p className="text-[12px] text-secondary">{(cvFile.size / 1024 / 1024).toFixed(2)} MB · click to replace</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-8 h-8 text-tertiary mx-auto mb-2.5" />
                    <p className="text-[14px] font-semibold text-secondary">
                      {isDragActive ? 'Drop your file here' : 'Drag & drop your CV, or click to browse'}
                    </p>
                    <p className="text-[12px] text-tertiary mt-1">PDF, DOC or DOCX · max 5 MB</p>
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="w-full h-12 rounded-xl bg-inverse text-inverse-fg text-[15px] font-medium inline-flex items-center justify-center gap-2 hover:bg-inverse/90 active:scale-[0.99] transition disabled:opacity-60"
              disabled={loading}
            >
              {loading ? (<><Loader2 className="w-5 h-5 animate-spin" /> Submitting…</>) : (<>Submit application <ArrowRight className="w-4 h-4" /></>)}
            </button>
            <p className="text-center text-[12px] text-tertiary">Takes under a minute. The assessment comes after.</p>
          </form>
        </div>
      </div>
    </div>
  );
}
