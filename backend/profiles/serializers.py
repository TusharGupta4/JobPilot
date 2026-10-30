from rest_framework import serializers
from .models import CandidateProfile, Resume


class ResumeSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = Resume
        fields = [
            "id",
            "profile",
            "file",
            "file_url",
            "filename",
            "file_size",
            "file_type",
            "extracted_text",
            "is_primary",
            "uploaded_at",
        ]
        read_only_fields = [
            "id",
            "profile",
            "filename",
            "file_size",
            "file_type",
            "extracted_text",
            "uploaded_at",
            "file_url",
        ]

    def get_file_url(self, obj):
        if obj.file:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None

    def create(self, validated_data):
        file_obj = validated_data.get("file")
        if file_obj:
            validated_data["filename"] = file_obj.name
            validated_data["file_size"] = file_obj.size
            validated_data["file_type"] = getattr(file_obj, "content_type", "")
        return super().create(validated_data)


class CandidateProfileSerializer(serializers.ModelSerializer):
    resumes = ResumeSerializer(many=True, read_only=True)

    class Meta:
        model = CandidateProfile
        fields = [
            "id",
            "full_name",
            "email",
            "phone",
            "location",
            "title",
            "bio",
            "skills",
            "experience",
            "education",
            "projects",
            "preferences",
            "verified_answers",
            "resumes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "resumes"]
