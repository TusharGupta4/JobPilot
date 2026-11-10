const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export interface ResumeData {
  id: number;
  filename: string;
  file_url: string | null;
  file_size: number;
  file_type: string;
  extracted_text: string;
  is_primary: boolean;
  uploaded_at: string;
}

export interface CandidateProfileData {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  title: string;
  bio: string;
  skills: string[];
  experience: Array<{
    company: string;
    role: string;
    location?: string;
    start_date?: string;
    end_date?: string;
    current?: boolean;
    description?: string;
    highlights?: string[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field_of_study?: string;
    start_year?: string;
    end_year?: string;
  }>;
  projects: Array<{
    name: string;
    description: string;
    tech_stack?: string[];
    link?: string;
  }>;
  preferences: {
    target_titles?: string[];
    preferred_locations?: string[];
    work_modes?: string[];
    min_salary?: number;
    currency?: string;
    notice_period_days?: number;
    [key: string]: any;
  };
  verified_answers: {
    work_authorization?: string;
    notice_period?: string;
    expected_ctc?: string;
    current_ctc?: string;
    years_of_experience?: string;
    availability?: string;
    open_to_relocation?: boolean | string;
    github_url?: string;
    linkedin_url?: string;
    portfolio_url?: string;
    [key: string]: any;
  };
  resumes: ResumeData[];
  created_at: string;
  updated_at: string;
}

export interface JobData {
  id: number;
  title: string;
  company_name: string;
  company_website: string;
  portal_source: "indeed" | "wellfound" | "naukri" | "linkedin" | "cutshort" | "ats_direct" | "manual";
  external_id: string;
  original_url: string;
  apply_url: string;
  description: string;
  locations: string[];
  work_mode: string;
  job_type: string;
  experience_level: string;
  min_years_required?: number | null;
  required_skills: string[];
  salary_min: number | null;
  salary_max: number | null;
  currency: string;
  posted_at: string | null;
  discovered_at: string;
  last_verified_at?: string | null;
  is_easy_apply: boolean;
  match_score: number;
  priority_rank: "HIGH" | "MEDIUM" | "LOW";
  application_status:
    | "SAVED"
    | "AUTO_APPLY_ELIGIBLE"
    | "AUTO_APPLIED"
    | "MANUAL_APPLY_NEEDED"
    | "APPLIED"
    | "REJECTED";
  listing_status?: "active" | "expired" | "unverified";
  apply_mode?: "one_click" | "manual_external" | "already_applied" | "ineligible";
  eligibility_reasons?: string[];
  is_auto_ready?: boolean;
  auto_ready_reasons?: string[];
  contact_emails: string[];
  contact_phones: string[];
  notes: string;
  semantic_domains?: string[];
}

export interface DiscoveryRunData {
  id: number;
  status: "running" | "completed" | "cancelled";
  keywords: string;
  location: string;
  time_window: string;
  experience: string;
  job_type: string;
  work_mode: string;
  current_page: number;
  max_pages: number;
  has_more: boolean;
  total_results: number;
  created_at: string;
  updated_at: string;
}

export type BulkJobStatus =
  | "queued"
  | "running"
  | "applied"
  | "skipped_expired"
  | "skipped_ineligible"
  | "blocked_challenge"
  | "failed";

export interface BulkApplyItemData {
  id: number;
  job_id_snapshot: number;
  title: string;
  company_name: string;
  url: string;
  position: number;
  status: BulkJobStatus;
  reason: string;
  updated_at: string;
}

export interface BulkApplyRunData {
  id: number;
  status: "running" | "paused" | "completed" | "cancelled";
  total_jobs: number;
  completed: number;
  experience_filter: string;
  created_at: string;
  updated_at: string;
  current_job: {
    job_id: number;
    title: string;
    company_name: string;
    status: string;
  } | null;
  items: BulkApplyItemData[];
}

export interface DomainMetadata {
  key: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  sample_tech: string[];
  job_count: number;
}

export interface DomainStatsResponse {
  total_jobs: number;
  portals: {
    all: number;
    indeed: number;
    wellfound: number;
    cutshort: number;
    ats_direct: number;
    [key: string]: number;
  };
  domains: DomainMetadata[];
}

export interface DiscoveryFilters {
  keywords?: string;
  location?: string;
  time_window?: "24h" | "7d" | "14d" | "all";
  experience?: "Fresher" | "0-2 Y" | "0-3 Y" | "1-3 Y" | "Junior" | "Mid-Level" | "Senior" | "Lead" | "Entry-level" | "Internship" | "Any";
  job_type?: "Full-time" | "Internship" | "Part-time" | "Contract" | "all";
  work_mode?: "Remote" | "Hybrid" | "Onsite" | "all";
  limit?: number;
  page?: number;
  selected_domains?: string[];
}

// ----------------------------------------------------------------------------
// Candidate Profile & Resume APIs
// ----------------------------------------------------------------------------

export async function getProfile(): Promise<CandidateProfileData> {
  const res = await fetch(`${API_BASE_URL}/profile/me/`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch profile: ${res.statusText}`);
  }
  return res.json();
}

export async function updateProfile(
  data: Partial<CandidateProfileData>
): Promise<CandidateProfileData> {
  const res = await fetch(`${API_BASE_URL}/profile/me/`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Failed to update profile: ${res.statusText}`);
  }
  return res.json();
}

export async function uploadResume(file: File): Promise<ResumeData> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE_URL}/resumes/`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Upload failed: ${errorText || res.statusText}`);
  }
  return res.json();
}

export async function deleteResume(id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/resumes/${id}/`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Failed to delete resume: ${res.statusText}`);
  }
}

export async function setPrimaryResume(id: number): Promise<ResumeData> {
  const res = await fetch(`${API_BASE_URL}/resumes/${id}/set-primary/`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Failed to set primary resume: ${res.statusText}`);
  }
  return res.json();
}

export async function reparseResume(id: number): Promise<CandidateProfileData> {
  const res = await fetch(`${API_BASE_URL}/resumes/${id}/parse-profile/`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Failed to parse resume: ${res.statusText}`);
  }
  return res.json();
}


// ----------------------------------------------------------------------------
// Jobs & Discovery APIs
// ----------------------------------------------------------------------------

export async function getJobs(params?: Record<string, string>): Promise<JobData[]> {
  const searchParams = new URLSearchParams(params);
  const url = `${API_BASE_URL}/jobs/?${searchParams.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch jobs: ${res.statusText}`);
  }
  return res.json();
}

export async function getDomainStats(): Promise<DomainStatsResponse> {
  const res = await fetch(`${API_BASE_URL}/jobs/domain-stats/`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch domain stats: ${res.statusText}`);
  }
  return res.json();
}

export async function discoverJobs(
  filters: DiscoveryFilters & { discovery_run_id?: number; max_pages?: number }
): Promise<{
  message: string;
  count: number;
  page_count?: number;
  page?: number;
  has_more?: boolean;
  discovery_run_id?: number;
  run?: DiscoveryRunData;
  jobs: JobData[];
}> {
  const res = await fetch(`${API_BASE_URL}/jobs/discover/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(filters),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Discovery failed: ${errorText || res.statusText}`);
  }
  return res.json();
}

export async function getLatestDiscoveryFeed(params?: {
  experience?: string;
}): Promise<{
  run: DiscoveryRunData | null;
  jobs: JobData[];
  count: number;
  message?: string;
}> {
  const sp = new URLSearchParams();
  if (params?.experience) sp.set("experience", params.experience);
  const res = await fetch(`${API_BASE_URL}/jobs/discovery/latest/?${sp.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load discovery feed: ${res.statusText}`);
  return res.json();
}

export async function healDiscoveryStatuses(): Promise<{
  listing_status_healed: number;
  easy_apply_restored: number;
  apply_mode_healed?: number;
  active_easy_apply: number;
}> {
  const res = await fetch(`${API_BASE_URL}/jobs/discovery/heal-statuses/`, { method: "POST" });
  if (!res.ok) throw new Error(`Heal failed: ${res.statusText}`);
  return res.json();
}

export async function enrichJobContacts(
  jobId: number
): Promise<{ message: string; contact_emails: string[]; contact_phones: string[]; company_website?: string }> {
  const res = await fetch(`${API_BASE_URL}/jobs/${jobId}/enrich-contacts/`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Enrichment failed: ${res.statusText}`);
  }
  return res.json();
}

export async function updateJobStatus(
  jobId: number,
  newStatus: string
): Promise<JobData> {
  const res = await fetch(`${API_BASE_URL}/jobs/${jobId}/update-status/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: newStatus }),
  });
  if (!res.ok) {
    throw new Error(`Status update failed: ${res.statusText}`);
  }
  return res.json();
}

export async function startBulkApplyRun(payload: {
  jobs: Array<{ id: number; title: string; company: string; url: string }>;
  experience_filter?: string;
}): Promise<BulkApplyRunData> {
  const res = await fetch(`${API_BASE_URL}/jobs/bulk-apply/start/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Bulk start failed: ${res.statusText}`);
  return res.json();
}

export async function getBulkApplyRun(runId: number): Promise<BulkApplyRunData> {
  const res = await fetch(`${API_BASE_URL}/jobs/bulk-apply/${runId}/`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bulk status failed: ${res.statusText}`);
  return res.json();
}

export async function cancelBulkApplyRun(runId: number): Promise<BulkApplyRunData> {
  const res = await fetch(`${API_BASE_URL}/jobs/bulk-apply/${runId}/cancel/`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Bulk cancel failed: ${res.statusText}`);
  return res.json();
}

export interface AiMatchResult {
  source: string;
  match_score: number;
  priority_rank: string;
  match_summary: string;
  matched_skills: string[];
  missing_skills: string[];
  tailored_pitch: string;
  note?: string;
}

export interface AutoApplyResult {
  success: boolean;
  status: string;
  message: string;
}

export async function triggerAiMatch(jobId: number): Promise<AiMatchResult> {
  const res = await fetch(`${API_BASE_URL}/jobs/${jobId}/ai-match/`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`AI analysis failed: ${res.statusText}`);
  }
  return res.json();
}

export async function triggerAutoApply(jobId: number): Promise<AutoApplyResult> {
  const res = await fetch(`${API_BASE_URL}/jobs/${jobId}/auto-apply/`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Auto-apply request failed: ${res.statusText}`);
  }
  return res.json();
}

export interface CompanyData {
  id: number;
  name: string;
  domain: string;
  website: string;
  careers_url: string;
  contact_emails: string[];
  contact_phones: string[];
  is_contacted: boolean;
  contacted_at: string | null;
  outreach_notes: string;
  job_count: number;
  active_jobs: Array<{
    id: number;
    title: string;
    original_url: string;
    application_status: string;
    is_easy_apply: boolean;
  }>;
  created_at: string;
  updated_at: string;
}

export async function fetchCompanies(params?: {
  search?: string;
  contacted?: boolean;
}): Promise<CompanyData[]> {
  const query = new URLSearchParams();
  if (params?.search) query.append("search", params.search);
  if (params?.contacted !== undefined) {
    query.append("contacted", params.contacted ? "true" : "false");
  }
  const qs = query.toString() ? `?${query.toString()}` : "";
  const res = await fetch(`${API_BASE_URL}/companies/${qs}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch companies: ${res.statusText}`);
  }
  return res.json();
}

export async function toggleCompanyContacted(companyId: number): Promise<CompanyData> {
  const res = await fetch(`${API_BASE_URL}/companies/${companyId}/toggle-contacted/`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Failed to toggle contacted status: ${res.statusText}`);
  }
  return res.json();
}

export async function enrichCompany(companyId: number): Promise<CompanyData> {
  const res = await fetch(`${API_BASE_URL}/companies/${companyId}/enrich/`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Failed to enrich company: ${res.statusText}`);
  }
  return res.json();
}

export function getCompanyExportUrl(companyIds?: number[]): string {
  if (companyIds && companyIds.length > 0) {
    return `${API_BASE_URL}/companies/export/?ids=${companyIds.join(",")}`;
  }
  return `${API_BASE_URL}/companies/export/`;
}

export interface BulkCompanyContact {
  company_name: string;
  company_website: string;
  portal_source: string;
  contact_emails: string[];
  contact_phones: string[];
  job_count: number;
  jobs: Array<{
    id: number;
    title: string;
    application_status: string;
    is_easy_apply: boolean;
    apply_url: string;
  }>;
}

export interface BulkContactsResponse {
  total_companies: number;
  total_unique_emails: number;
  all_emails: string[];
  companies: BulkCompanyContact[];
}

export async function getBulkJobContacts(jobIds: number[]): Promise<BulkContactsResponse> {
  const res = await fetch(`${API_BASE_URL}/jobs/bulk-contacts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_ids: jobIds }),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch bulk contacts: ${res.statusText}`);
  }
  return res.json();
}

// ----------------------------------------------------------------------------
// Company Outreach & Automated HR Cold Email APIs
// ----------------------------------------------------------------------------

export interface OutreachSettings {
  sender_email: string;
  sender_name: string;
  has_password: boolean;
  smtp_server?: string;
  smtp_host?: string;
  smtp_port: number;
  resume_path?: string;
}

export async function getOutreachSettings(): Promise<OutreachSettings> {
  const res = await fetch(`${API_BASE_URL}/companies/outreach-settings/`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch outreach settings: ${res.statusText}`);
  }
  return res.json();
}

export async function saveOutreachSettings(data: {
  sender_email: string;
  sender_password: string;
  sender_name?: string;
}): Promise<{ success: boolean; sender_email: string; sender_name: string }> {
  const res = await fetch(`${API_BASE_URL}/companies/outreach-settings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to save settings: ${res.statusText}`);
  }
  return res.json();
}

export async function testSmtpConnection(data: {
  sender_email?: string;
  sender_password?: string;
}): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE_URL}/companies/test-smtp/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message || "SMTP connection failed");
  }
  return json;
}

export interface EmailDraft {
  success: boolean;
  company_id: number;
  company_name: string;
  recipient_email: string;
  all_emails: string[];
  subject: string;
  body: string;
}

export async function generateEmailDraft(companyId: number): Promise<EmailDraft> {
  const res = await fetch(`${API_BASE_URL}/companies/${companyId}/generate-draft/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to generate draft: ${res.statusText}`);
  }
  return res.json();
}

export async function sendOutreachEmail(
  companyId: number,
  payload: { to_email: string; subject: string; body: string }
): Promise<{ success: boolean; message: string; cv_attached: boolean }> {
  const res = await fetch(`${API_BASE_URL}/companies/${companyId}/send-email/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || json.message || "Failed to send email");
  }
  return json;
}

export async function bulkSendOutreachEmails(
  companyIds: number[]
): Promise<{
  success: boolean;
  total_requested: number;
  sent_count: number;
  failed_count: number;
  results: Array<{
    company_id: number;
    company_name: string;
    to_email?: string;
    success: boolean;
    message?: string;
    error?: string;
  }>;
}> {
  const res = await fetch(`${API_BASE_URL}/companies/bulk-send-emails/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_ids: companyIds }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || "Failed to bulk send emails");
  }
  return json;
}

// ----------------------------------------------------------------------------
// Dynamic LLM Form Field Question Resolution API
// ----------------------------------------------------------------------------

export async function resolveFormField(payload: {
  question_text: string;
  field_type?: "radio" | "checkbox" | "select" | "text";
  options?: string[];
  company?: string;
  title?: string;
  job_description?: string;
}): Promise<{ success: boolean; selected_option: string; reason: string }> {
  const res = await fetch(`${API_BASE_URL}/profile/resolve-form-field/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to resolve field: ${res.statusText}`);
  }
  return res.json();
}




