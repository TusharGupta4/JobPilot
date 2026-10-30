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
    open_to_relocation?: boolean;
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
  required_skills: string[];
  salary_min: number | null;
  salary_max: number | null;
  currency: string;
  posted_at: string | null;
  discovered_at: string;
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
  contact_emails: string[];
  contact_phones: string[];
  notes: string;
}

export interface DiscoveryFilters {
  keywords?: string;
  location?: string;
  time_window?: "24h" | "7d" | "14d" | "all";
  experience?: "Fresher" | "Internship" | "Entry-level" | "Any";
  job_type?: "Full-time" | "Internship" | "Part-time" | "Contract";
  limit?: number;
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

export async function discoverJobs(
  filters: DiscoveryFilters
): Promise<{ message: string; count: number; jobs: JobData[] }> {
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

export async function enrichJobContacts(
  jobId: number
): Promise<{ message: string; contact_emails: string[]; contact_phones: string[] }> {
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

