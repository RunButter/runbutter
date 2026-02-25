'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, uploadCV } from '@/lib/supabase';
import Link from 'next/link';
import { Upload, FileText, Loader2, CheckCircle } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import LogoContainer from '@/components/LogoContainer';
import { useEffect } from 'react';

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

      // Create candidate
      const { data: candidate, error: candidateError } = await supabase
        .from('candidates')
        .insert({
          company_id: position.company_id,
          position_id: params.positionId,
          full_name: formData.fullName,
          email: formData.email,
          phone: formData.phone || null,
          linkedin_url: formData.linkedinUrl || null,
          status: 'applied',
          source: 'direct',
        })
        .select()
        .single();

      if (candidateError) throw candidateError;

      // Upload CV
      const cvUrl = await uploadCV(cvFile, candidate.id);

      if (!cvUrl) {
        throw new Error('Failed to upload CV');
      }

      // Update candidate with CV URL
      await supabase
        .from('candidates')
        .update({ cv_url: cvUrl })
        .eq('id', candidate.id);

      // Log activity
      await supabase.from('activity_log').insert({
        company_id: position.company_id,
        candidate_id: candidate.id,
        action: 'application_submitted',
        details: {
          position_title: position.title,
          cv_uploaded: true,
        },
      });

      setSuccess(true);
      setCandidateId(candidate.id);
      setAccessToken(candidate.access_token);
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

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            {positionInfo?.logoUrl && (
              <div className="flex justify-center mb-6">
                <LogoContainer src={positionInfo.logoUrl} alt={positionInfo.companyName} />
              </div>
            )}
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Application Submitted!</h1>
            <p className="text-gray-600 mb-6">
              Thank you for applying. We&apos;ve received your application and CV.
            </p>

            <div className="p-6 bg-primary-50 rounded-xl border border-primary-100 mb-6">
              <h3 className="font-bold text-primary-900 mb-2">Step 2: Take the Assessment</h3>
              <p className="text-sm text-primary-700 mb-4">
                To complete your application, please take our 15-minute personality and skills assessment.
              </p>
              <Link
                href={`/apply/${params.positionId}/assessment?candidateId=${candidateId}&token=${accessToken}`}
                className="btn-primary w-full py-3 block text-center"
              >
                Start Assessment Now
              </Link>
            </div>

            <p className="text-xs text-gray-500">
              A link to this assessment has also been sent to <strong>{formData.email}</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          {positionInfo?.logoUrl && (
            <div className="flex justify-center mb-6">
              <LogoContainer src={positionInfo.logoUrl} alt={positionInfo.companyName} />
            </div>
          )}
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Apply for {positionInfo?.title || 'Position'}
            {positionInfo?.companyName ? ` at ${positionInfo.companyName}` : ''}
          </h1>
          <p className="text-gray-600">Fill out the form below to submit your application</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Personal Information */}
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Personal Information</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="John Smith"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    className="input-field"
                    placeholder="john@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    className="input-field"
                    placeholder="+1 (555) 123-4567"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    LinkedIn Profile
                  </label>
                  <input
                    type="url"
                    className="input-field"
                    placeholder="https://linkedin.com/in/johnsmith"
                    value={formData.linkedinUrl}
                    onChange={(e) => setFormData({ ...formData, linkedinUrl: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* CV Upload */}
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                Resume/CV <span className="text-red-500">*</span>
              </h3>

              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${isDragActive
                  ? 'border-primary-500 bg-primary-50'
                  : cvFile
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-300 hover:border-primary-400'
                  }`}
              >
                <input {...getInputProps()} />

                {cvFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="w-8 h-8 text-green-600" />
                    <div className="text-left">
                      <p className="font-medium text-gray-800">{cvFile.name}</p>
                      <p className="text-sm text-gray-600">
                        {(cvFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-700 mb-1">
                      {isDragActive ? 'Drop your file here' : 'Drag & drop your CV/Resume'}
                    </p>
                    <p className="text-sm text-gray-500">or click to browse</p>
                    <p className="text-xs text-gray-400 mt-2">PDF, DOC, DOCX (max 5MB)</p>
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary w-full py-3 text-lg flex items-center justify-center gap-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Application'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
