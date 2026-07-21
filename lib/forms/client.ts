'use client';

import { rpc } from '@/lib/rpc';

export type FieldType = 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'checkbox';
export type FieldMap = '' | 'first_name' | 'last_name' | 'email' | 'phone' | 'title' | 'linkedin_url';

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];   // select only
  map?: FieldMap;       // people column this feeds, or '' → custom_fields
}

export interface FormRow {
  id: string; slug: string; name: string; title: string; enabled: boolean;
  fields: FormField[]; created_at: string; submissions: number;
}
export interface FormDetail {
  id: string | null; slug?: string; name: string; title: string; description: string;
  fields: FormField[]; submit_message: string; enabled: boolean;
}
export interface FormSubmission { id: string; data: Record<string, string>; person_id: string | null; created_at: string }

export async function getForms(privy: string, ws: string): Promise<FormRow[]> {
  const { data } = await rpc('get_forms', { p_privy: privy, p_workspace: ws });
  return Array.isArray(data) ? data : [];
}

export async function getForm(privy: string, ws: string, id: string): Promise<FormDetail | null> {
  const { data } = await rpc('get_form', { p_privy: privy, p_workspace: ws, p_id: id });
  return data ?? null;
}

export async function saveForm(privy: string, ws: string, f: FormDetail): Promise<{ id?: string; slug?: string; error?: string }> {
  const { data, error } = await rpc('save_form', {
    p_privy: privy, p_workspace: ws, p_id: f.id, p_name: f.name, p_title: f.title,
    p_description: f.description, p_fields: f.fields, p_submit_message: f.submit_message, p_enabled: f.enabled,
  });
  if (error) return { error: error.message };
  return { id: data?.id, slug: data?.slug };
}

export async function deleteForm(privy: string, ws: string, id: string): Promise<{ error?: string }> {
  const { error } = await rpc('delete_form', { p_privy: privy, p_workspace: ws, p_id: id });
  return error ? { error: error.message } : {};
}

export async function getFormSubmissions(privy: string, ws: string, formId: string): Promise<FormSubmission[]> {
  const { data } = await rpc('get_form_submissions', { p_privy: privy, p_workspace: ws, p_form_id: formId });
  return Array.isArray(data) ? data : [];
}
