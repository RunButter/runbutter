// Core relational types for the HireBTR platform (CRM / Business-OS pivot).
// These mirror the Postgres schema in supabase/migrations/0001_platform_core.sql.

export type ObjectType = 'person' | 'company' | 'asset';
export type PipelineKind = 'sales' | 'recruitment' | 'hris' | 'custom';
export type FieldType = 'text' | 'number' | 'select' | 'date' | 'boolean' | 'relation' | 'currency' | 'tags' | 'avatar' | 'image';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  width?: number;           // px hint for the dense table
  align?: 'left' | 'right' | 'center';
  primary?: boolean;        // the headline column (gets the avatar + link)
}

export interface FormField {
  key: string;              // maps to a real table column
  label: string;
  input: 'text' | 'number' | 'select' | 'date' | 'textarea' | 'datalist' | 'relation' | 'image' | 'lookup';
  options?: string[];       // for select
  optionsObject?: string;   // for relation: which object's records to pick from (e.g. 'companies')
  required?: boolean;       // datalist = free text + autocomplete suggestions
}

export interface ObjectDef {
  slug: string;             // url + registry key, e.g. "people"
  singular: string;
  plural: string;
  icon: string;             // lucide icon name
  type: ObjectType;
  fields: FieldDef[];       // display columns (table)
  form?: FormField[];       // editable columns (create/edit) — omit = read-only
}

export interface Person {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  title?: string;
  phone?: string;
  source?: string;
  company?: string;
  avatar_url?: string | null;
  synergy?: number;         // 0-100 fit score (computed)
}

export interface Company {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  employee_count?: number;
  tax_id?: string;
  address?: string;
  country?: string;
}

export interface Asset {
  id: string;
  name: string;
  category: 'laptop' | 'monitor' | 'phone' | 'license' | 'other';
  serial_number?: string;
  status: 'available' | 'assigned' | 'repair' | 'retired';
  assigned_to?: string | null;
}

export interface PipelineStage {
  id: string;
  name: string;
  color: string;
  stage_type: 'open' | 'won' | 'lost';
}

export interface PipelineRecord {
  id: string;
  stage_id: string;
  title: string;
  amount?: number | null;
  status: 'active' | 'won' | 'lost';
  position: number;
  person?: { id: string; name: string; title?: string; avatar_url?: string | null } | null;
  company?: { id: string; name: string; domain?: string } | null;
}

export interface PipelineConfig {
  id: string;
  name: string;
  kind: PipelineKind;
  target: ObjectType;
}
