import os
import json
from google import genai
from google.genai import types

from jobs.models import Job
from profiles.models import CandidateProfile, Resume


def analyze_job_match(job_id: int):
    """
    Performs AI match analysis comparing candidate's profile & resume
    against the target job description using Gemini.
    """
    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    profile = CandidateProfile.objects.first()
    if not profile:
        return {"error": "Candidate profile not found"}

    primary_resume = Resume.objects.filter(profile=profile, is_primary=True).first()
    if not primary_resume:
        primary_resume = Resume.objects.filter(profile=profile).first()

    resume_text = primary_resume.extracted_text if primary_resume else ""
    candidate_summary = f"""
Candidate Full Name: {profile.full_name}
Title / Headline: {profile.title}
Bio / Summary: {profile.bio}
Skills: {', '.join(profile.skills)}
Experience: {json.dumps(profile.experience)}
Education: {json.dumps(profile.education)}
Extracted Resume Text:
{resume_text[:2500]}
"""

    job_info = f"""
Job Title: {job.title}
Company: {job.company_name}
Location: {', '.join(job.locations) if job.locations else 'Not specified'}
Work Mode: {job.work_mode}
Experience Level: {job.experience_level}
Job Description:
{job.description}
"""

    api_key = os.environ.get("GEMINI_API_KEY")

    # If Gemini API key is provided, run full LLM analysis
    if api_key and api_key.strip():
        try:
            client = genai.Client(api_key=api_key)
            prompt = f"""
You are an expert technical recruiter and career coach analyzing a job opportunity for a candidate.

{candidate_summary}

--- TARGET JOB OPENING ---
{job_info}

Analyze how well this candidate matches the job opening.
Respond ONLY with a valid JSON object matching this structure:
{{
  "match_score": <integer from 0 to 100 representing overall suitability>,
  "priority_rank": <"HIGH" if match_score >= 75, "MEDIUM" if match_score >= 60, otherwise "LOW">,
  "match_summary": "<A 2-3 sentence clear explanation of why this candidate fits or what makes this role appealing>",
  "matched_skills": ["<skill1>", "<skill2>", ...],
  "missing_skills": ["<skillA>", "<skillB>", ...],
  "tailored_pitch": "<A short 2-3 sentence opening pitch/answer the candidate can use when applying>"
}}
"""
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                ),
            )
            data = json.loads(response.text)

            # Update job in database
            job.match_score = int(data.get("match_score", job.match_score))
            job.priority_rank = data.get("priority_rank", job.priority_rank)
            job.save(update_fields=["match_score", "priority_rank"])

            return {
                "source": "gemini",
                "match_score": job.match_score,
                "priority_rank": job.priority_rank,
                "match_summary": data.get("match_summary", ""),
                "matched_skills": data.get("matched_skills", []),
                "missing_skills": data.get("missing_skills", []),
                "tailored_pitch": data.get("tailored_pitch", ""),
            }
        except Exception as e:
            # Fall back to heuristic matching if API call fails
            pass

    # Heuristic Fallback Analysis
    all_text = (job.description + " " + job.title).lower()
    matched = [s for s in profile.skills if s.lower() in all_text]
    missing = [s for s in ["Docker", "Kubernetes", "AWS", "CI/CD", "TypeScript", "Microservices"] if s.lower() in all_text and s not in profile.skills]

    score = int((len(matched) / max(len(profile.skills), 1)) * 100)
    score = max(55, min(95, score + 15))
    priority = "HIGH" if score >= 75 else ("MEDIUM" if score >= 60 else "LOW")

    job.match_score = score
    job.priority_rank = priority
    job.save(update_fields=["match_score", "priority_rank"])

    return {
        "source": "heuristic",
        "match_score": score,
        "priority_rank": priority,
        "match_summary": f"Strong alignment with {len(matched)} of your core skills for {job.company_name}. Recommended for entry-level / fresher applications.",
        "matched_skills": matched if matched else profile.skills[:3],
        "missing_skills": missing[:3],
        "tailored_pitch": f"Passionate about applying modern software development practices with expertise in {', '.join(profile.skills[:3])} to deliver high-quality features at {job.company_name}.",
        "note": "Connect your GEMINI_API_KEY in backend/.env for deep LLM reasoning."
    }
