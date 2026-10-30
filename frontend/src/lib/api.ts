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
