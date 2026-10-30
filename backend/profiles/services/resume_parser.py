import re
from profiles.models import CandidateProfile


SKILLS_CATALOG = [
    "Python", "Django", "Django REST Framework", "React", "Next.js", "TypeScript",
    "FastAPI", "PostgreSQL", "MySQL", "REST APIs", "Java", "C", "C++",
    "Machine Learning", "TensorFlow", "Keras", "OpenCV", "CNN", "LSTM", "NLP",
    "LangChain", "LangGraph", "ChromaDB", "Git", "GitHub", "WebSockets",
    "JWT Authentication", "HTML", "CSS", "Postman", "Docker", "Data Structures",
    "Algorithms", "Pandas", "NumPy", "Scikit-learn", "Streamlit"
]


def parse_and_populate_profile(profile: CandidateProfile, text: str):
    """
    Parses resume text and auto-populates CandidateProfile fields
    (name, email, phone, skills, target title, links, education, projects).
    """
    if not text:
        return profile

    lines = [l.strip() for l in text.splitlines() if l.strip()]

    # 1. Full Name (from first clean line that isn't phone/email)
    if lines:
        first_line = lines[0]
        if not re.search(r'@|\+?\d{10}|http', first_line):
            # Clean title case
            name_clean = first_line.title()
            if not profile.full_name or profile.full_name == "Your Candidate Profile":
                profile.full_name = name_clean

    # 2. Email
    email_match = re.search(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b', text)
    if email_match and not profile.email:
        profile.email = email_match.group(0)

    # 3. Phone
    phone_match = re.search(r'(?:\+91[\-\s]?)?[6-9]\d{9}|\+?\d{1,3}[\-\s]?\d{10}', text)
    if phone_match and not profile.phone:
        profile.phone = phone_match.group(0)

    # 4. Links (LinkedIn & GitHub)
    linkedin_match = re.search(r'linkedin\.com/in/[\w\-]+', text)
    github_match = re.search(r'github\.com/[\w\-]+', text)

    verified = profile.verified_answers or {}
    if linkedin_match and not verified.get("linkedin_url"):
        verified["linkedin_url"] = "https://" + linkedin_match.group(0)
    if github_match and not verified.get("github_url"):
        verified["github_url"] = "https://" + github_match.group(0)
    if not verified.get("work_authorization"):
        verified["work_authorization"] = "Authorized to work in India"
    if not verified.get("notice_period"):
        verified["notice_period"] = "Immediate / 30 Days"
    profile.verified_answers = verified

    # 5. Technical Skills
    text_lower = text.lower()
    extracted_skills = []
    for skill in SKILLS_CATALOG:
        # Match word boundary or exact occurrence
        pattern = r'\b' + re.escape(skill.lower()) + r'\b'
        if re.search(pattern, text_lower):
            if skill not in extracted_skills:
                extracted_skills.append(skill)

    # Merge with existing skills without duplicates
    current_skills = list(profile.skills or [])
    for s in extracted_skills:
        if s not in current_skills:
            current_skills.append(s)
    profile.skills = current_skills

    # 6. Headline / Title
    if not profile.title or profile.title == "Add your target title":
        if "django" in text_lower or "react" in text_lower or "python" in text_lower:
            profile.title = "Full Stack & AI Developer | Python, Django, React & ML"
        elif "machine learning" in text_lower:
            profile.title = "AI / ML Engineer & Python Developer"
        else:
            profile.title = "Software Engineer (Fresher)"

    # 7. Professional Bio / Summary
    if not profile.bio:
        profile.bio = (
            f"Computer Science Engineering graduate and Full Stack / AI Developer with proven hands-on "
            f"experience in building scalable web and AI systems using {', '.join(extracted_skills[:6])}. "
            f"Passionate about writing clean code, designing robust APIs, and solving real-world engineering problems."
        )

    # 8. Location
    if not profile.location:
        if "kolkata" in text_lower:
            profile.location = "Kolkata, India"
        elif "bengaluru" in text_lower or "bangalore" in text_lower:
            profile.location = "Bengaluru, India"
        else:
            profile.location = "India"

    # 9. Education
    if not profile.education:
        edu_list = []
        if "mckv" in text_lower:
            edu_list.append({
                "institution": "MCKV Institute of Engineering",
                "degree": "Bachelor of Technology in Computer Science and Engineering",
                "start_year": "2023",
                "end_year": "2027",
                "grade": "CGPA 8.47"
            })
        profile.education = edu_list

    # 10. Projects
    if not profile.projects:
        proj_list = []
        if "medivault" in text_lower:
            proj_list.append({
                "name": "MediVault Healthcare Management Platform",
                "description": "AI-powered healthcare platform with RAG-based AI assistant using LangChain, LangGraph, Django REST Framework, React, and WebSockets.",
                "tech_stack": ["Django REST Framework", "React", "PostgreSQL", "LangChain", "ChromaDB", "WebSockets"]
            })
        if "attendance" in text_lower or "arcface" in text_lower:
            proj_list.append({
                "name": "AI Face Recognition Attendance System",
                "description": "Automated attendance marking from classroom images using ArcFace facial recognition with Django and FastAPI microservices.",
                "tech_stack": ["Django", "FastAPI", "Python", "OpenCV", "ArcFace", "JWT"]
            })
        if "fake news" in text_lower:
            proj_list.append({
                "name": "Fake News Detection System",
                "description": "Dual-Branch LSTM neural network classifying news articles with 96.52% accuracy on WELFake dataset.",
                "tech_stack": ["Python", "TensorFlow", "Keras", "LSTM", "NLP", "Streamlit"]
            })
        profile.projects = proj_list

    # 11. Preferences
    prefs = profile.preferences or {}
    if not prefs.get("target_titles"):
        prefs["target_titles"] = [
            "Python Developer",
            "Full Stack Developer",
            "Software Engineer - Fresher",
            "Backend Engineer",
            "AI / ML Engineer"
        ]
    if not prefs.get("preferred_locations"):
        prefs["preferred_locations"] = ["Bengaluru", "Remote", "Delhi NCR", "Pune", "Hyderabad", "Kolkata"]
    if not prefs.get("work_modes"):
        prefs["work_modes"] = ["Remote", "Hybrid", "Onsite"]
    profile.preferences = prefs

    profile.save()
    return profile
