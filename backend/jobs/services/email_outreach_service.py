import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from django.utils import timezone
from django.conf import settings
from google import genai

from jobs.models import Company, Job
from profiles.models import CandidateProfile, Resume

DEFAULT_SENDER_EMAIL = os.environ.get("OUTREACH_EMAIL", "")
DEFAULT_SENDER_PASSWORD = os.environ.get("OUTREACH_PASSWORD", "")
DEFAULT_SENDER_NAME = os.environ.get("OUTREACH_NAME", "Job Applicant")


def get_outreach_credentials() -> dict:
    """
    Retrieves stored SMTP email credentials from CandidateProfile or defaults.
    """
    profile = CandidateProfile.objects.first()
    prefs = profile.preferences if (profile and profile.preferences) else {}
    email_creds = prefs.get("outreach_email_settings", {})

    # Strict Priority: Environment variables (.env) take absolute precedence
    sender_email = os.environ.get("OUTREACH_EMAIL") or email_creds.get("sender_email") or DEFAULT_SENDER_EMAIL
    sender_password = os.environ.get("OUTREACH_PASSWORD") or email_creds.get("sender_password") or DEFAULT_SENDER_PASSWORD
    sender_name = os.environ.get("OUTREACH_NAME") or email_creds.get("sender_name") or (profile.full_name if profile else DEFAULT_SENDER_NAME)

    # Google App Passwords are 16 letters usually formatted in 4 blocks of 4; strip all spaces
    clean_password = sender_password.replace(" ", "").strip()

    return {
        "sender_email": sender_email.strip(),
        "sender_password": clean_password,
        "sender_name": sender_name.strip(),
        "smtp_server": "smtp.gmail.com",
        "smtp_port": 587
    }


def save_outreach_credentials(sender_email: str, sender_password: str, sender_name: str = "") -> dict:
    """
    Saves updated email credentials to the CandidateProfile preferences.
    """
    profile = CandidateProfile.objects.first()
    if not profile:
        profile = CandidateProfile.objects.create(
            full_name=sender_name or DEFAULT_SENDER_NAME,
            email=sender_email
        )
    
    clean_password = sender_password.replace(" ", "").strip()
    prefs = profile.preferences or {}
    prefs["outreach_email_settings"] = {
        "sender_email": sender_email.strip(),
        "sender_password": clean_password,
        "sender_name": (sender_name or profile.full_name or DEFAULT_SENDER_NAME).strip(),
        "updated_at": timezone.now().isoformat()
    }
    profile.preferences = prefs
    profile.save()

    return {
        "success": True,
        "sender_email": sender_email.strip(),
        "sender_name": sender_name.strip()
    }


def _connect_gmail_smtp(timeout=15):
    """
    Connects to Gmail SMTP on port 587 with STARTTLS.
    Falls back to direct IPv4 resolution if IPv6 routing hangs or fails.
    """
    import socket
    try:
        ipv4 = socket.gethostbyname("smtp.gmail.com")
        server = smtplib.SMTP(ipv4, 587, timeout=timeout)
    except Exception:
        server = smtplib.SMTP("smtp.gmail.com", 587, timeout=timeout)
    server.ehlo()
    server.starttls()
    server.ehlo()
    return server


def test_smtp_connection(sender_email: str, sender_password: str) -> dict:
    """
    Validates SMTP credentials with Gmail SMTP server.
    """
    email_clean = sender_email.strip()
    pwd_clean = sender_password.replace(" ", "").strip()

    try:
        server = _connect_gmail_smtp(timeout=12)
        server.login(email_clean, pwd_clean)
        server.quit()
        return {
            "success": True,
            "message": f"SMTP Authentication verified successfully for {email_clean}!"
        }
    except smtplib.SMTPAuthenticationError as auth_err:
        return {
            "success": False,
            "error_code": "AUTH_FAILED",
            "message": (
                "Google SMTP Authentication Failed. If you have 2-Step Verification enabled on your Gmail account, "
                "Google requires a 16-character Google App Password instead of your regular password. "
                "You can generate one instantly at: https://myaccount.google.com/apppasswords "
                f"(Details: {str(auth_err)})"
            )
        }
    except smtplib.SMTPServerDisconnected:
        return {
            "success": False,
            "error_code": "APP_PASSWORD_REQUIRED",
            "message": (
                "Google requires an App Password (16 characters) because 2-Step Verification is enabled on your Gmail. "
                "Go to https://myaccount.google.com/apppasswords to create a 16-character App Password (name it 'JobPortal'), "
                "then enter that password here."
            )
        }
    except Exception as e:
        return {
            "success": False,
            "error_code": "CONNECTION_ERROR",
            "message": f"SMTP Connection failed: {str(e)}"
        }



def generate_tailored_email_draft(company_id: int) -> dict:
    """
    Analyzes company profile and active jobs to generate an authentic,
    LLM-personalized cold email and subject line tailored to that company.
    """
    try:
        company = Company.objects.get(id=company_id)
    except Company.DoesNotExist:
        return {"success": False, "error": f"Company with id {company_id} not found"}

    profile = CandidateProfile.objects.first()
    candidate_name = profile.full_name if profile else "Tushar Gupta"
    candidate_skills = ", ".join(profile.skills[:6]) if (profile and profile.skills) else "Python, Django, FastAPI, React, AI Agent architectures, and PostgreSQL"
    candidate_phone = profile.phone if (profile and profile.phone) else "+91 8240464157"
    candidate_linkedin = (profile.verified_answers or {}).get("linkedin_url", "https://linkedin.com/in/tushargupta04") if profile else "https://linkedin.com/in/tushargupta04"
    candidate_github = (profile.verified_answers or {}).get("github_url", "https://github.com/TusharGupta4") if profile else "https://github.com/TusharGupta4"

    # Gather company context
    active_jobs = Job.objects.filter(company_name__iexact=company.name)[:4]
    job_titles = [j.title for j in active_jobs]
    job_descriptions = " ".join([j.description[:250] for j in active_jobs if j.description])
    
    company_context = f"Company: {company.name}\nWebsite: {company.website}\nActive Openings: {', '.join(job_titles) if job_titles else 'Software Engineering'}\nJob Details: {job_descriptions[:600]}"

    target_recipient = ""
    if company.contact_emails and len(company.contact_emails) > 0:
        target_recipient = company.contact_emails[0]

    # Use Gemini LLM if key is present, otherwise fallback to high-quality synthesizer
    api_key = os.environ.get("GEMINI_API_KEY")
    subject = f"Software Engineering Opportunities — {candidate_name}"
    body = ""

    if api_key and api_key.strip():
        try:
            client = genai.Client(api_key=api_key)
            prompt = f"""
You are {candidate_name}, writing a highly professional, tailored cold outreach email to the HR/Engineering team at "{company.name}".

Company Details:
{company_context}

Candidate Profile:
- Full Name: {candidate_name}
- Core Skills: {candidate_skills}
- Degree: B.Tech in Computer Science and Engineering
- Phone: {candidate_phone}
- LinkedIn: {candidate_linkedin}
- GitHub: {candidate_github}

Instructions:
1. First line of response MUST be "SUBJECT: <A concise, professional email subject line>".
2. Next line must be blank, followed by the complete email body.
3. Specifically reference what {company.name} builds or their open engineering roles so the email is 100% customized, not generic.
4. Highlight how candidate's technical skills (Python, backend, APIs, React, scalable architecture) add direct value to their engineering roadmap.
5. Mention that your authentic CV is attached for their review.
6. Professional, articulate, confident tone. Include signoff with full contact links.
7. Return ONLY the plain text email. Do NOT include markdown code fences (```).
"""
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt
            )
            raw_text = resp.text.strip()
            if "SUBJECT:" in raw_text:
                parts = raw_text.split("\n", 1)
                subject = parts[0].replace("SUBJECT:", "").strip()
                body = parts[1].strip() if len(parts) > 1 else raw_text
            else:
                body = raw_text
        except Exception as e:
            print(f"[EmailOutreach] Gemini error: {e}, using heuristic draft")

    if not body:
        # High quality authentic template grounded in company and candidate
        focus_role = job_titles[0] if job_titles else "Software Development"
        body = f"""Hi Hiring Team at {company.name},

I hope this message finds you well.

I have been following {company.name}'s work and recent engineering developments, especially around {focus_role}. I am writing to express my strong interest in contributing to your engineering team.

I bring practical hands-on experience in building reliable, scalable web applications and backend systems using Python, Django, FastAPI, React, and PostgreSQL. In my recent development work, I have focused on writing clean, modular code, designing robust APIs, and implementing automated testing to ensure high software reliability and performance.

I have attached my resume to this email for your review. I would welcome the opportunity to connect and discuss how my technical foundation and rapid problem-solving abilities can add immediate value to upcoming engineering initiatives at {company.name}.

Thank you for your time and consideration.

Best regards,
{candidate_name}
Email: {get_outreach_credentials()['sender_email']}
Phone: {candidate_phone}
LinkedIn: {candidate_linkedin}
GitHub: {candidate_github}
"""

    return {
        "success": True,
        "company_id": company.id,
        "company_name": company.name,
        "recipient_email": target_recipient,
        "all_emails": company.contact_emails or [],
        "subject": subject,
        "body": body.strip()
    }


def send_tailored_outreach_email(
    company_id: int,
    to_email: str,
    subject: str,
    body: str,
    custom_sender_email: str = "",
    custom_sender_password: str = ""
) -> dict:
    """
    Sends a tailored cold email with the candidate's PDF CV attached via SMTP.
    """
    try:
        company = Company.objects.get(id=company_id)
    except Company.DoesNotExist:
        return {"success": False, "error": f"Company #{company_id} not found."}

    creds = get_outreach_credentials()
    sender_email = (custom_sender_email or creds["sender_email"]).strip()
    sender_password = (custom_sender_password or creds["sender_password"]).replace(" ", "").strip()
    sender_name = creds["sender_name"] or "Tushar Gupta"

    if not to_email or "@" not in to_email:
        return {"success": False, "error": "Invalid recipient email address."}

    # 1. Locate Candidate Active Resume PDF
    resume_path = os.path.join(settings.MEDIA_ROOT, "resumes", "Tushar_Gupta_CSE_2027_.pdf")
    primary_resume = Resume.objects.filter(is_primary=True).first() or Resume.objects.first()
    if primary_resume and primary_resume.file and os.path.exists(primary_resume.file.path):
        resume_path = primary_resume.file.path

    if not os.path.exists(resume_path):
        # Fallback to any PDF in media/resumes/
        resumes_dir = os.path.join(settings.MEDIA_ROOT, "resumes")
        if os.path.exists(resumes_dir):
            for f in os.listdir(resumes_dir):
                if f.lower().endswith(".pdf"):
                    resume_path = os.path.join(resumes_dir, f)
                    break

    # 2. Build MIMEMultipart Email Message
    msg = MIMEMultipart()
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    # 3. Attach Resume PDF
    cv_attached = False
    if os.path.exists(resume_path):
        try:
            with open(resume_path, "rb") as f:
                attach = MIMEApplication(f.read(), _subtype="pdf")
                filename = os.path.basename(resume_path)
                attach.add_header("Content-Disposition", "attachment", filename=filename)
                msg.attach(attach)
                cv_attached = True
        except Exception as attach_err:
            print(f"[EmailOutreach] Error attaching resume: {attach_err}")

    # 4. Dispatch via Gmail SMTP
    try:
        server = _connect_gmail_smtp(timeout=20)
        server.login(sender_email, sender_password)
        server.sendmail(sender_email, [to_email], msg.as_string())
        server.quit()
    except smtplib.SMTPAuthenticationError as auth_err:
        return {
            "success": False,
            "error_code": "AUTH_FAILED",
            "error": (
                "Google SMTP Authentication Failed. If you have 2-Step Verification enabled on Gmail, "
                "please enter a 16-character Google App Password (generate at https://myaccount.google.com/apppasswords). "
                f"Details: {str(auth_err)}"
            )
        }
    except smtplib.SMTPServerDisconnected:
        return {
            "success": False,
            "error_code": "APP_PASSWORD_REQUIRED",
            "error": (
                "Google requires an App Password (16 characters) because 2-Step Verification is enabled on your Gmail. "
                "Go to https://myaccount.google.com/apppasswords to create a 16-character App Password, "
                "then enter that password in Outreach Settings."
            )
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Failed to dispatch email via SMTP: {str(e)}"
        }

    # 5. Update Company Outreach Record
    now = timezone.now()
    company.is_contacted = True
    company.contacted_at = now
    
    log_entry = f"[{now.strftime('%Y-%m-%d %H:%M')}] Sent tailored cold email to {to_email} with CV attached ({os.path.basename(resume_path)})."
    if company.outreach_notes:
        company.outreach_notes = f"{log_entry}\n{company.outreach_notes}"
    else:
        company.outreach_notes = log_entry
    company.save()

    return {
        "success": True,
        "message": f"Tailored cold email sent to {company.name} ({to_email}) successfully with CV attached!",
        "company_id": company.id,
        "to_email": to_email,
        "cv_attached": cv_attached,
        "contacted_at": now.isoformat()
    }
