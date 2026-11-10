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
        "description": "Artificial Intelligence, Machine Learning, Deep Learning, Computer Vision, NLP, LLMs, GenAI, and Python AI frameworks.",
        "sample_tech": ["PyTorch", "TensorFlow", "NLP", "LLMs", "GenAI", "Computer Vision", "Scikit-Learn", "Data Science"],
        "terms": [
            "ai", "ml", "artificial intelligence", "machine learning", "deep learning",
            "nlp", "natural language", "computer vision", "cv", "neural network",
            "neural networks", "llm", "large language", "genai", "generative ai",
            "agentic", "agentic ai", "ai agent", "ai agents", "prompt engineer",
            "prompt engineering", "transformer", "transformers", "bert", "gpt",
            "rag", "embeddings", "embedding", "vector db", "vector database",
            "langchain", "langgraph", "crewai", "autogen", "data science",
            "data scientist", "data specialist", "pytorch", "tensorflow", "keras",
            "scikit", "scikit-learn", "pandas", "numpy", "opencv", "yolo",
            "ai tools", "reinforcement learning", "model training", "inference",
            "applied scientist", "mlops", "huggingface", "fine-tuning", "diffusion",
            "chromadb", "pinecone", "weaviate", "spacy", "nltk", "object detection",
            "deep neural", "autonomous", "machine vision", "research engineer",
            "research scientist", "ai researcher", "ml researcher", "deep learning researcher",
            "machine learning researcher", "algorithm engineer", "algorithms engineer",
            "algorithmic developer", "decision scientist", "perception engineer",
            "foundation model", "foundation model engineer", "speech scientist",
            "mlops engineer", "ai platform engineer", "ml platform engineer",
            "ai infrastructure engineer", "ai specialist", "ml specialist",
            "ai intern", "ml intern", "machine learning intern", "data science intern",
            "genai developer", "generative ai developer", "llm developer", "ai/ml", "aiml",
            "ai engineer", "ml engineer", "machine learning engineer", "ai developer",
            "applied ai engineer", "applied ml engineer", "deep learning engineer"
        ],
    },
    "fullstack": {
        "key": "fullstack",
        "label": "Full Stack Development",
        "icon": "Layers",
        "color": "blue",
        "description": "End-to-end web applications, modern frameworks, client-server architectures, and developer roles.",
        "sample_tech": ["React", "Django", "Next.js", "Node.js", "FastAPI", "PostgreSQL", "Tailwind CSS"],
        "terms": [
            "full stack", "fullstack", "full-stack", "web developer", "web development",
            "mern", "mean", "mern stack", "mean stack", "frontend + backend", "front-end and back-end",
            "software trainee", "trainee engineer", "graduate software trainee",
            "application developer", "web platform", "web engineer", "software engineer",
            "sde 1", "sde-1", "sde i", "associate software engineer", "junior developer",
            "software development engineer", "full stack engineer", "fullstack engineer",
            "web application developer"
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
            "fastapi", "flask", "api", "apis", "rest api", "restful", "graphql",
            "microservice", "microservices", "sql", "database", "postgres",
            "postgresql", "mysql", "sqlite", "mongodb", "redis", "celery",
            "rabbitmq", "kafka", "node.js backend", "node backend", "golang",
            "go developer", "java", "spring boot", "c#", ".net", "dotnet",
            "backend engineer", "server-side", "distributed systems", "api developer",
            "python backend", "backend developer", "api engineer"
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
            "responsive design", "web design", "frontend engineer", "frontend developer",
            "ui engineer", "ux engineer", "react developer", "next.js developer"
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
            "data pipeline", "data pipelines", "etl", "data warehouse", "snowflake",
            "bigquery", "spark", "hadoop", "airflow", "dbt", "tableau", "power bi",
            "data visualization", "sql querying", "databricks", "etl developer"
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
            "linux", "ci/cd", "ci-cd", "terraform", "ansible", "sre", "site reliability",
            "infrastructure", "cybersecurity", "security engineer", "cloud architect",
            "system engineer", "cloud engineer", "devops engineer"
        ],
    },
}


def classify_job_domains(job_title: str, description: str = "", required_skills: list = None) -> list:
    """
    Identifies all relevant domains for a given job using semantic boundary matching
    across title, description, and required skills.
    Supports multi-label semantic association (e.g. Python AI Developer -> aiml + backend).
    Normalizes punctuation (e.g. 'AI/ML' -> 'ai ml' and 'ai/ml') for boundary accuracy.
    """
    title_lower = (job_title or "").lower()
    title_normalized = re.sub(r"[/_\-+]", " ", title_lower)
    text_lower = f"{job_title} {description or ''} {' '.join(required_skills or [])}".lower()
    text_normalized = re.sub(r"[/_\-+]", " ", text_lower)
    matched_domains = []

    for domain_key, data in DOMAINS_METADATA.items():
        if domain_key == "all":
            continue

        terms = data.get("terms", [])
        title_hits = 0
        for t in terms:
            escaped = re.escape(t)
            if re.search(r"\b" + escaped + r"\b", title_lower) or re.search(r"\b" + escaped + r"\b", title_normalized):
                title_hits += 1

        text_hits = 0
        for t in terms:
            escaped = re.escape(t)
            if re.search(r"\b" + escaped + r"\b", text_lower) or re.search(r"\b" + escaped + r"\b", text_normalized):
                text_hits += 1

        # Title match has immediate high weight; description requires 2+ semantic hits or 1 strong tech keyword in text
        if title_hits > 0 or text_hits >= 2 or (title_hits == 0 and text_hits >= 1 and any(r in title_lower for r in ["developer", "engineer", "intern", "scientist", "analyst", "specialist"])):
            matched_domains.append(domain_key)

    # Fallback to fullstack if no specific category triggered for a general developer role
    if not matched_domains:
        if any(term in title_lower for term in ["developer", "engineer", "software", "coder"]):
            matched_domains.append("fullstack")

    return matched_domains


def is_job_in_domain(job_title: str, description: str = "", required_skills: list = None, target_domain: str = "all") -> bool:
    """
    Checks if a job contextually belongs to target_domain.
    If target_domain == 'all', returns True.
    """
    return is_job_in_domains(job_title, description, required_skills, target_domain)


def is_job_in_domains(job_title: str, description: str = "", required_skills: list = None, target_domains="all") -> bool:
    """
    Checks if a job belongs to ANY of target_domains.
    target_domains can be:
      - 'all' or 'any' -> returns True
      - A single domain string, e.g. 'aiml'
      - A comma-separated string, e.g. 'aiml,fullstack,backend'
      - A list or set of domain strings, e.g. ['aiml', 'fullstack']
    """
    if not target_domains:
        return True

    if isinstance(target_domains, str):
        if target_domains.lower() in ("all", "any"):
            return True
        domains_list = [d.strip().lower() for d in target_domains.split(",") if d.strip()]
    elif isinstance(target_domains, (list, tuple, set)):
        domains_list = [str(d).strip().lower() for d in target_domains if str(d).strip()]
    else:
        domains_list = [str(target_domains).strip().lower()]

    if not domains_list or any(d in ("all", "any") for d in domains_list):
        return True

    matched_domains = classify_job_domains(job_title, description, required_skills)
    return any(d in matched_domains for d in domains_list)
