import io
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
import pypdf

from .models import CandidateProfile, Resume
from .serializers import CandidateProfileSerializer, ResumeSerializer


def get_default_profile():
    """
    Returns the single user's active profile or creates one if it doesn't exist yet.
    """
    profile = CandidateProfile.objects.first()
    if not profile:
        profile = CandidateProfile.objects.create(
            full_name="",
            email="",
            title="",
            location="",
            bio="",
            skills=[],
            experience=[],
            education=[],
            projects=[],
            preferences={
                "target_titles": [],
                "preferred_locations": [],
                "work_modes": ["Remote", "Hybrid", "Onsite"],
                "min_salary": 0,
                "currency": "INR",
                "notice_period_days": 30,
            },
            verified_answers={
                "work_authorization": "Authorized to work in India",
                "notice_period": "30 days",
                "open_to_relocation": True,
            }
        )
    return profile


class ProfileMeView(APIView):
    """
    Convenience endpoint for single-user workflow:
    GET /api/profiles/me/ - get candidate profile
    PUT / PATCH /api/profiles/me/ - update candidate profile
    """
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        profile = get_default_profile()
        serializer = CandidateProfileSerializer(profile, context={"request": request})
        return Response(serializer.data)

    def patch(self, request):
        profile = get_default_profile()
        serializer = CandidateProfileSerializer(
            profile, data=request.data, partial=True, context={"request": request}
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def put(self, request):
        profile = get_default_profile()
        serializer = CandidateProfileSerializer(
            profile, data=request.data, partial=False, context={"request": request}
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class CandidateProfileViewSet(viewsets.ModelViewSet):
    """
    Standard CRUD viewset for profiles.
    """
    queryset = CandidateProfile.objects.all()
    serializer_class = CandidateProfileSerializer


class ResumeViewSet(viewsets.ModelViewSet):
    """
    Endpoint for uploading, inspecting, and managing resumes.
    Automatically extracts raw text from PDF files upon upload.
    """
    queryset = Resume.objects.all()
    serializer_class = ResumeSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def perform_create(self, serializer):
        profile = get_default_profile()
        file_obj = self.request.FILES.get("file")
        extracted_text = ""

        # Extract text if PDF
        if file_obj and (file_obj.name.lower().endswith(".pdf") or "pdf" in getattr(file_obj, "content_type", "")):
            try:
                reader = pypdf.PdfReader(file_obj)
                pages_text = []
                for page in reader.pages:
                    text = page.extract_text()
                    if text:
                        pages_text.append(text)
                extracted_text = "\n\n".join(pages_text).strip()
            except Exception as e:
                extracted_text = f"Text extraction warning: {str(e)}"
            finally:
                # Seek back to beginning so Django can save file content
                file_obj.seek(0)
        elif file_obj and file_obj.name.lower().endswith((".txt", ".md")):
            try:
                extracted_text = file_obj.read().decode("utf-8", errors="ignore")
                file_obj.seek(0)
            except Exception:
                pass

        # If this is the only resume or marked primary, adjust primary flags
        is_first = not Resume.objects.filter(profile=profile).exists()
        is_primary = self.request.data.get("is_primary")
        if is_primary is not None:
            is_primary = str(is_primary).lower() in ("true", "1")
        else:
            is_primary = is_first

        if is_primary:
            Resume.objects.filter(profile=profile).update(is_primary=False)

        resume_instance = serializer.save(
            profile=profile,
            extracted_text=extracted_text,
            is_primary=is_primary
        )

        # Auto-extract and populate CandidateProfile fields
        if extracted_text:
            try:
                from .services.resume_parser import parse_and_populate_profile
                parse_and_populate_profile(profile, extracted_text)
            except Exception as e:
                print(f"Resume profile population warning: {e}")

    @action(detail=True, methods=["post"], url_path="parse-profile")
    def parse_profile(self, request, pk=None):
        """
        Manually re-parses an uploaded resume to populate the candidate profile.
        """
        resume = self.get_object()
        from .services.resume_parser import parse_and_populate_profile
        profile = parse_and_populate_profile(resume.profile, resume.extracted_text)
        from .serializers import CandidateProfileSerializer
        return Response(CandidateProfileSerializer(profile, context={"request": request}).data)


    @action(detail=True, methods=["post"], url_path="set-primary")
    def set_primary(self, request, pk=None):
        resume = self.get_object()
        Resume.objects.filter(profile=resume.profile).update(is_primary=False)
        resume.is_primary = True
        resume.save(update_fields=["is_primary"])
        serializer = self.get_serializer(resume)
        return Response(serializer.data)


class AnswerQuestionView(APIView):
    """
    API endpoint for answering custom job screening questions and founder notes
    grounded in candidate's verified CV, experience, and Gemini LLM.
    POST /api/profile/answer-question/
    Payload: { "question": "...", "company": "...", "title": "...", "job_description": "..." }
    """
    parser_classes = [JSONParser]

    def post(self, request):
        question = request.data.get("question", "").strip()
        company = request.data.get("company", "").strip()
        job_title = request.data.get("title", "").strip()
        job_description = request.data.get("job_description", "").strip()

        if not question:
            return Response({"error": "question parameter is required"}, status=status.HTTP_400_BAD_REQUEST)

        from .services.question_answerer import answer_screening_question
        result = answer_screening_question(
            question_text=question,
            company=company,
            job_title=job_title,
            job_description=job_description
        )
        return Response(result, status=status.HTTP_200_OK)


class ResolveFormFieldView(APIView):
    """
    API endpoint for dynamically resolving unexpected application questions
    (Yes/No questions, multi-choice radio buttons, select dropdowns, text fields)
    using Gemini LLM reasoning.
    POST /api/profile/resolve-form-field/
    Payload: { "question_text": "...", "field_type": "radio", "options": [...], "company": "...", "title": "..." }
    """
    parser_classes = [JSONParser]

    def post(self, request):
        question_text = (
            request.data.get("question_text") or
            request.data.get("label") or
            request.data.get("question") or
            request.data.get("field_name") or
            ""
        ).strip()
        field_type = request.data.get("field_type", "radio").strip()
        options = request.data.get("options", [])
        company = request.data.get("company", "").strip()
        job_title = request.data.get("title", "").strip()
        job_description = request.data.get("job_description", "").strip()

        if not question_text:
            return Response({"error": "question_text, label, or question is required"}, status=status.HTTP_400_BAD_REQUEST)

        from .services.question_answerer import resolve_dynamic_form_field
        result = resolve_dynamic_form_field(
            question_text=question_text,
            field_type=field_type,
            options=options,
            job_title=job_title,
            company=company,
            job_description=job_description
        )
        return Response(result, status=status.HTTP_200_OK)



