// Database Types
export interface Company {
  id: string;
  name: string;
  subdomain: string;
  logo_url?: string;
  brand_color: string;
  created_at: string;
  updated_at: string;
  settings: Record<string, any>;
  plan: 'free' | 'starter' | 'professional' | 'enterprise';
  is_active: boolean;
}

export interface CompanyUser {
  id: string;
  company_id: string;
  email: string;
  full_name: string;
  role: 'owner' | 'admin' | 'recruiter' | 'viewer';
  auth_user_id?: string;
  created_at: string;
  last_login?: string;
}

export interface Position {
  id: string;
  company_id: string;
  title: string;
  description?: string;
  department?: string;
  location?: string;
  employment_type?: 'full-time' | 'part-time' | 'contract' | 'internship';
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface Candidate {
  id: string;
  company_id: string;
  position_id: string;
  email: string;
  full_name: string;
  phone?: string;
  linkedin_url?: string;
  cv_url?: string;
  status: CandidateStatus;
  applied_at: string;
  updated_at: string;
  notes?: string;
  source?: string;
}

export type CandidateStatus = 
  | 'applied'
  | 'screening'
  | 'assessment_sent'
  | 'assessment_completed'
  | 'interview_scheduled'
  | 'interviewed'
  | 'offered'
  | 'rejected'
  | 'hired';

export interface AssessmentTemplate {
  id: string;
  company_id: string;
  position_id?: string;
  name: string;
  description?: string;
  questions: AssessmentQuestion[];
  scoring_weights: Record<string, number>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface AssessmentQuestion {
  id: string;
  category: 'personality' | 'work_style' | 'cognitive';
  trait?: string;
  text: string;
  subtext?: string;
  type: 'scale' | 'choice' | 'multiple_choice';
  options: string[];
  correct_answer?: number; // for cognitive tests
  weight?: number;
}

export interface AssessmentResponse {
  id: string;
  candidate_id: string;
  assessment_template_id: string;
  answers: AssessmentAnswer[];
  started_at: string;
  completed_at?: string;
  time_taken_seconds?: number;
  is_completed: boolean;
}

export interface AssessmentAnswer {
  question_id: string;
  answer_index: number;
  time_spent_seconds?: number;
}

export interface AssessmentResult {
  id: string;
  candidate_id: string;
  assessment_response_id: string;
  overall_score: number;
  personality_scores: PersonalityScores;
  work_style_scores: WorkStyleScores;
  cognitive_scores: CognitiveScores;
  calculated_at: string;
  insights: AssessmentInsight[];
}

export interface PersonalityScores {
  extraversion: number;
  agreeableness: number;
  conscientiousness: number;
  neuroticism: number;
  openness: number;
}

export interface WorkStyleScores {
  collaboration: number;
  structure: number;
  strategic: number;
  innovation: number;
}

export interface CognitiveScores {
  logical_reasoning: number;
  pattern_recognition: number;
  problem_solving: number;
  overall: number;
}

export interface AssessmentInsight {
  type: 'strength' | 'fit' | 'development';
  title: string;
  description: string;
}

export interface Interview {
  id: string;
  candidate_id: string;
  interviewer_id: string;
  scheduled_at: string;
  duration_minutes: number;
  google_calendar_event_id?: string;
  google_meet_link?: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  notes?: string;
  feedback?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  company_id: string;
  user_id?: string;
  candidate_id: string;
  action: string;
  details: Record<string, any>;
  created_at: string;
}

export interface IntegrationToken {
  id: string;
  company_id: string;
  user_id: string;
  provider: 'google' | 'microsoft' | 'linkedin';
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  scope: string[];
  created_at: string;
  updated_at: string;
}

// Expanded types with relations
export interface CandidateWithDetails extends Candidate {
  position?: Position;
  assessment_result?: AssessmentResult;
  interviews?: Interview[];
  latest_activity?: ActivityLog[];
}

export interface PositionWithStats extends Position {
  total_applications: number;
  pending_review: number;
  assessment_completed: number;
  interviewed: number;
}
