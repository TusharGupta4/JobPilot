import re

# -----------------------------------------------------------------------------
# Domain Ontology & Semantic Concepts Taxonomy
# -----------------------------------------------------------------------------

DOMAINS_METADATA = {
    "all": {
        "key": "all",
        "label": "All Domains",
        "icon": "Globe",
        "color": "indigo",
        "description": "Show all incoming tech and engineering opportunities across portals.",
        "sample_tech": ["Python", "React", "AI/ML", "SQL", "Full Stack", "Cloud"],
    },
    "aiml": {
        "key": "aiml",
        "label": "AI / ML & Data Science",
        "icon": "Brain",
        "color": "purple",
        "description": "Artificial Intelligence, Machine Learning, Deep Learning, Computer Vision, NLP, LLMs, and Python AI tools.",
        "sample_tech": ["PyTorch", "TensorFlow", "NLP", "LLMs", "GenAI", "Computer Vision", "Scikit-Learn", "Data Science"],
        "terms": [
            "ai", "ml", "artificial intelligence", "machine learning", "deep learning",
            "nlp", "natural language", "computer vision", "cv", "neural network",
            "neural networks", "llm", "large language", "genai", "generative ai",
            "prompt engineer", "prompt engineering", "transformer", "transformers",
            "bert", "gpt", "rag", "embeddings", "vector db", "langchain",
            "data science", "data scientist", "data specialist", "pytorch", "tensorflow",
            "keras", "scikit", "scikit-learn", "pandas", "numpy", "opencv",
            "ai tools", "reinforcement learning", "model training", "inference",
            "applied scientist", "mlops"
        ],
    },
    "fullstack": {
        "key": "fullstack",
        "label": "Full Stack Development",
        "icon": "Layers",
        "color": "blue",
        "description": "End-to-end web applications, modern frameworks, client-server architectures, and trainee developer roles.",
        "sample_tech": ["React", "Django", "Next.js", "Node.js", "FastAPI", "PostgreSQL", "Tailwind CSS"],
        "terms": [
            "full stack", "fullstack", "full-stack", "web developer", "web development",
            "mern", "mean", "frontend + backend", "front-end and back-end",
            "software trainee", "trainee engineer", "graduate software trainee",
            "application developer", "web platform", "web engineer"
        ],
    },
    "backend": {
        "key": "backend",
        "label": "Backend & APIs",
        "icon": "Server",
        "color": "emerald",
        "description": "Server-side logic, high-throughput microservices, REST/GraphQL APIs, databases, and Python backend systems.",
        "sample_tech": ["Python", "Django", "FastAPI", "PostgreSQL", "Redis", "Celery", "REST APIs", "Microservices"],
        "terms": [
            "backend", "back-end", "python developer", "python engineer", "django",
            "fastapi", "flask", "api", "apis", "rest api", "restful", "microservice",
            "microservices", "sql", "database", "postgres", "postgresql", "mysql",
            "redis", "celery", "node.js backend", "golang", "go developer", "java",
            "spring boot", "backend engineer"
        ],
    },
    "frontend": {
        "key": "frontend",
        "label": "Frontend & UI/UX",
        "icon": "Layout",
        "color": "cyan",
        "description": "Client-side web development, reactive user interfaces, component design systems, and modern JavaScript.",
        "sample_tech": ["React", "Next.js", "TypeScript", "Tailwind CSS", "JavaScript", "HTML5/CSS3", "UI/UX"],
        "terms": [
            "frontend", "front-end", "ui", "ux", "ui/ux", "react", "react.js",
            "next.js", "nextjs", "vue", "angular", "typescript", "javascript",
            "tailwind", "tailwind css", "css", "html", "html5", "client-side",
            "responsive design", "web design", "frontend engineer", "frontend developer"
        ],
    },
    "data": {
        "key": "data",
        "label": "Data Engineering & Analytics",
        "icon": "BarChart3",
        "color": "amber",
        "description": "Data pipelines, ETL workflows, business intelligence, SQL querying, reporting, and quantitative analysis.",
        "sample_tech": ["SQL", "Data Pipelines", "ETL", "Tableau", "Power BI", "Snowflake", "Spark", "Pandas"],
        "terms": [
            "data analyst", "business analyst", "data engineer", "data engineering",
            "bi developer", "business intelligence", "analytics", "analytics engineer",
            "data pipeline", "etl", "data warehouse", "snowflake", "bigquery",
            "spark", "hadoop", "airflow", "tableau", "power bi"
        ],
    },
    "healthcare": {
        "key": "healthcare",
        "label": "Healthcare & Medicine",
        "icon": "Activity",
        "color": "rose",
        "description": "Healthtech systems, medical records (EMR/EHR), clinical workflows, telemedicine, and healthcare informatics.",
        "sample_tech": ["HealthTech", "EHR/EMR", "MediVault", "Clinical APIs", "HIPAA", "Medical Data", "Telehealth"],
        "terms": [
            "health", "healthcare", "healthtech", "medical", "medicine", "hospital",
            "clinical", "ehr", "emr", "telehealth", "telemedicine", "medtech",
            "biotech", "pharma", "pharmacy", "patient", "hipaa", "medivault",
            "health data", "clinical informatics"
        ],
    },
    "devops": {
        "key": "devops",
        "label": "Cloud & DevOps",
        "icon": "Cloud",
        "color": "sky",
        "description": "Cloud infrastructure, container orchestration, CI/CD automation, Linux system administration, and reliability.",
        "sample_tech": ["Docker", "Kubernetes", "AWS", "CI/CD", "Linux", "GCP", "Terraform"],
        "terms": [
            "cloud", "devops", "docker", "kubernetes", "k8s", "aws", "gcp", "azure",
            "linux", "ci/cd", "ci-cd", "terraform", "sre", "site reliability",
            "infrastructure", "cybersecurity", "security engineer"
        ],
    },
}


def classify_job_domains(job_title: str, description: str = "", required_skills: list = None) -> list:
    """
    Identifies all relevant domains for a given job using semantic boundary matching
    across title, description, and required skills.
    """
    title_lower = (job_title or "").lower()
    text_lower = f"{job_title} {description or ''} {' '.join(required_skills or [])}".lower()
    matched_domains = []

    for domain_key, data in DOMAINS_METADATA.items():
        if domain_key == "all":
            continue

        terms = data.get("terms", [])
        title_hits = sum(
            1 for t in terms
            if re.search(r"\b" + re.escape(t) + r"\b", title_lower)
        )
        text_hits = sum(
            1 for t in terms
            if re.search(r"\b" + re.escape(t) + r"\b", text_lower)
        )

        # Title match has high weight; description requires 2+ semantic hits
        if title_hits > 0 or text_hits >= 2:
            matched_domains.append(domain_key)

    # Fallback to fullstack/backend if no specific category triggered for a developer role
    if not matched_domains:
        if any(term in title_lower for term in ["developer", "engineer", "software", "coder"]):
            matched_domains.append("fullstack")

    return matched_domains


def is_job_in_domain(job_title: str, description: str = "", required_skills: list = None, target_domain: str = "all") -> bool:
    """
    Checks if a job contextually belongs to target_domain.
    If target_domain == 'all', returns True.
    """
    if not target_domain or target_domain.lower() in ("all", "any"):
        return True

    matched_domains = classify_job_domains(job_title, description, required_skills)
    return target_domain.lower() in matched_domains
