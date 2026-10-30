"use client";

import { useEffect, useState, useRef } from "react";
import {
  getProfile,
  updateProfile,
  uploadResume,
  deleteResume,
  setPrimaryResume,
  reparseResume,
  CandidateProfileData,
  ResumeData,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  UploadCloud,
  FileText,
  Trash2,
  Star,
  CheckCircle,
  Plus,
  X,
  Save,
  Briefcase,
  GraduationCap,
  ShieldCheck,
  Settings,
  User,
  Eye,
  Loader2,
  Sparkles,
} from "lucide-react";

export default function ProfilePage() {
  const [profile, setProfile] = useState<CandidateProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [skillInput, setSkillInput] = useState("");
  const [viewingResumeText, setViewingResumeText] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      setLoading(true);
      const data = await getProfile();
      setProfile(data);
    } catch (err: any) {
      toast.error("Failed to load profile. Is Django server running?");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!profile) return;
    try {
      setSaving(true);
      const updated = await updateProfile(profile);
      setProfile(updated);
      toast.success("Profile updated successfully!");
    } catch (err: any) {
      toast.error("Error saving profile: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      toast.info("Uploading and extracting resume...");
      await uploadResume(file);
      await loadProfile();
      toast.success(`Resume "${file.name}" uploaded successfully!`);
    } catch (err: any) {
      toast.error("Upload error: " + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteResume(id: number) {
    if (!confirm("Are you sure you want to remove this resume?")) return;
    try {
      await deleteResume(id);
      await loadProfile();
      toast.success("Resume deleted");
    } catch (err: any) {
      toast.error("Delete failed: " + err.message);
    }
  }

  async function handleSetPrimary(id: number) {
    try {
      await setPrimaryResume(id);
      await loadProfile();
      toast.success("Set as primary resume");
    } catch (err: any) {
      toast.error("Failed to set primary: " + err.message);
    }
  }

  async function handleReparseResume(id: number) {
    try {
      toast.info("Auto-extracting skills, experience, and profile details from CV...");
      const updated = await reparseResume(id);
      setProfile(updated);
      toast.success("Candidate profile populated from your CV!");
    } catch (err: any) {
      toast.error("Failed to parse resume: " + err.message);
    }
  }


  function addSkill(skill: string) {
    const trimmed = skill.trim();
    if (!trimmed || !profile) return;
    if (profile.skills.includes(trimmed)) {
      toast.info("Skill already exists");
      return;
    }
    setProfile({
      ...profile,
      skills: [...profile.skills, trimmed],
    });
    setSkillInput("");
  }

  function removeSkill(skillToRemove: string) {
    if (!profile) return;
    setProfile({
      ...profile,
      skills: profile.skills.filter((s) => s !== skillToRemove),
    });
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <p className="text-sm text-slate-500 font-medium">Loading candidate profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center">
        <p className="text-red-500">Could not connect to backend.</p>
        <Button onClick={loadProfile} className="mt-4">
          Retry
        </Button>
      </div>
    );
  }

  const primaryResume = profile.resumes?.find((r) => r.is_primary) || profile.resumes?.[0];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center text-white text-2xl font-bold shadow-md shadow-indigo-500/20">
            {profile.full_name ? profile.full_name.charAt(0).toUpperCase() : <User className="w-8 h-8" />}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {profile.full_name || "Your Candidate Profile"}
            </h1>
            <p className="text-sm text-slate-500">
              {profile.title || "Add your target title"} • {profile.location || "Add location"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-sm transition-all"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Profile
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Resumes & Quick Actions */}
        <div className="lg:col-span-1 space-y-6">
          {/* Resume Upload Card */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                Resume Documents
              </CardTitle>
              <CardDescription>
                Upload your latest resume (PDF) to extract experience & skills.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-xl p-5 text-center cursor-pointer bg-slate-50/50 hover:bg-indigo-50/20 transition-colors"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".pdf,.doc,.docx,.txt"
                  className="hidden"
                />
                <UploadCloud className="w-8 h-8 mx-auto text-indigo-500 mb-2" />
                <p className="text-sm font-medium text-slate-700">Click to upload resume</p>
                <p className="text-xs text-slate-400 mt-1">PDF, DOCX up to 10MB</p>
                {uploading && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-xs text-indigo-600">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Extracting text with PyPDF...
                  </div>
                )}
              </div>

              {/* Uploaded resumes list */}
              <div className="space-y-2.5">
                {profile.resumes && profile.resumes.length > 0 ? (
                  profile.resumes.map((resume) => (
                    <div
                      key={resume.id}
                      className="p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-colors space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-xs text-slate-800 truncate max-w-[170px]" title={resume.filename}>
                              {resume.filename}
                            </span>
                            {resume.is_primary && (
                              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] py-0 px-1.5">
                                Primary
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 block mt-0.5">
                            {(resume.file_size / 1024).toFixed(1)} KB • {new Date(resume.uploaded_at).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          {!resume.is_primary && (
                            <button
                              onClick={() => handleSetPrimary(resume.id)}
                              title="Set as primary"
                              className="p-1 text-slate-400 hover:text-amber-500 transition-colors"
                            >
                              <Star className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setViewingResumeText(
                                viewingResumeText === resume.id ? null : resume.id
                              )
                            }
                            title="Preview extracted text"
                            className="p-1 text-slate-400 hover:text-indigo-600 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleReparseResume(resume.id)}
                            title="Auto-fill profile details from this CV"
                            className="p-1 text-purple-500 hover:text-purple-700 hover:bg-purple-50 rounded transition-colors"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteResume(resume.id)}
                            title="Delete"
                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Extracted text accordion */}
                      {viewingResumeText === resume.id && (
                        <div className="mt-2 p-2.5 bg-slate-50 rounded border border-slate-100 text-[11px] text-slate-600 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                          {resume.extracted_text ? (
                            resume.extracted_text
                          ) : (
                            <span className="italic text-slate-400">No text extracted from this file.</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400 text-center py-2">
                    No resumes uploaded yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats Card */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Profile Readiness</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Skills Defined</span>
                <span className="font-semibold text-slate-900">{profile.skills.length} skills</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Active Resumes</span>
                <span className="font-semibold text-slate-900">{profile.resumes?.length || 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Verified Answers</span>
                <span className="font-semibold text-slate-900">
                  {Object.keys(profile.verified_answers || {}).length} saved
                </span>
              </div>
              <div className="pt-2">
                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-indigo-600 h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        (profile.full_name ? 20 : 0) +
                          (profile.skills.length > 0 ? 30 : 0) +
                          (profile.resumes?.length ? 30 : 0) +
                          (profile.verified_answers?.work_authorization ? 20 : 0)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Tabbed Details */}
        <div className="lg:col-span-2 space-y-6">
          <Tabs defaultValue="basics" className="w-full">
            <TabsList className="grid grid-cols-4 bg-slate-100/80 p-1 rounded-xl">
              <TabsTrigger value="basics" className="text-xs font-medium">
                Basics
              </TabsTrigger>
              <TabsTrigger value="skills" className="text-xs font-medium">
                Skills
              </TabsTrigger>
              <TabsTrigger value="preferences" className="text-xs font-medium">
                Preferences
              </TabsTrigger>
              <TabsTrigger value="answers" className="text-xs font-medium">
                Verified Answers
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: BASICS */}
            <TabsContent value="basics" className="mt-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Personal Information</CardTitle>
                  <CardDescription>
                    Your contact information and public career headline.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="full_name">Full Name</Label>
                      <Input
                        id="full_name"
                        value={profile.full_name}
                        onChange={(e) =>
                          setProfile({ ...profile, full_name: e.target.value })
                        }
                        placeholder="e.g. Tushar Gupta"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email Address</Label>
                      <Input
                        id="email"
                        type="email"
                        value={profile.email}
                        onChange={(e) =>
                          setProfile({ ...profile, email: e.target.value })
                        }
                        placeholder="name@example.com"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input
                        id="phone"
                        value={profile.phone}
                        onChange={(e) =>
                          setProfile({ ...profile, phone: e.target.value })
                        }
                        placeholder="+91 98765 43210"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="location">Current Location</Label>
                      <Input
                        id="location"
                        value={profile.location}
                        onChange={(e) =>
                          setProfile({ ...profile, location: e.target.value })
                        }
                        placeholder="e.g. Bengaluru, India"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="title">Professional Headline</Label>
                    <Input
                      id="title"
                      value={profile.title}
                      onChange={(e) =>
                        setProfile({ ...profile, title: e.target.value })
                      }
                      placeholder="e.g. Full Stack Engineer | Python & React"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="bio">Professional Summary / Bio</Label>
                    <Textarea
                      id="bio"
                      rows={4}
                      value={profile.bio}
                      onChange={(e) =>
                        setProfile({ ...profile, bio: e.target.value })
                      }
                      placeholder="Brief overview of your experience, key strengths, and target domains..."
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 2: SKILLS */}
            <TabsContent value="skills" className="mt-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Technical & Domain Skills</CardTitle>
                  <CardDescription>
                    These skills are matched against job requirements during discovery & scoring.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex gap-2">
                    <Input
                      value={skillInput}
                      onChange={(e) => setSkillInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addSkill(skillInput);
                        }
                      }}
                      placeholder="Type a skill (e.g. Python, Docker, Next.js) and press Enter"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => addSkill(skillInput)}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add
                    </Button>
                  </div>

                  {/* Active skills */}
                  <div>
                    <Label className="text-xs text-slate-500 mb-2 block">
                      Active Skills ({profile.skills.length})
                    </Label>
                    <div className="flex flex-wrap gap-2 min-h-16 p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      {profile.skills.length > 0 ? (
                        profile.skills.map((skill) => (
                          <Badge
                            key={skill}
                            className="bg-white text-slate-800 border border-slate-200 hover:border-slate-300 px-2.5 py-1 text-xs flex items-center gap-1.5 shadow-2xs"
                          >
                            {skill}
                            <button
                              onClick={() => removeSkill(skill)}
                              className="text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400 my-auto">
                          No skills added yet. Add your core competencies above.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Quick suggested skills */}
                  <div>
                    <Label className="text-xs text-slate-400 mb-2 block">
                      Quick Suggestions
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        "Python",
                        "Django",
                        "TypeScript",
                        "React",
                        "Next.js",
                        "PostgreSQL",
                        "REST APIs",
                        "Docker",
                        "Git",
                        "Tailwind CSS",
                        "FastAPI",
                        "Celery",
                      ].map((suggested) => (
                        <button
                          key={suggested}
                          type="button"
                          onClick={() => addSkill(suggested)}
                          disabled={profile.skills.includes(suggested)}
                          className="px-2.5 py-1 rounded-full text-xs font-medium border border-slate-200 text-slate-600 bg-white hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all disabled:opacity-40 disabled:pointer-events-none"
                        >
                          + {suggested}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 3: PREFERENCES */}
            <TabsContent value="preferences" className="mt-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Job Search Preferences</CardTitle>
                  <CardDescription>
                    Soft criteria used to calculate match scores and tier recommendations.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="target_titles">Target Job Titles (comma-separated)</Label>
                    <Input
                      id="target_titles"
                      value={(profile.preferences?.target_titles || []).join(", ")}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          preferences: {
                            ...profile.preferences,
                            target_titles: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                      placeholder="e.g. Full Stack Developer, Software Engineer, Backend Developer"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="min_salary">Minimum Desired Salary (Annual)</Label>
                      <Input
                        id="min_salary"
                        type="number"
                        value={profile.preferences?.min_salary || ""}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            preferences: {
                              ...profile.preferences,
                              min_salary: Number(e.target.value) || 0,
                            },
                          })
                        }
                        placeholder="e.g. 1200000"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="currency">Currency</Label>
                      <Input
                        id="currency"
                        value={profile.preferences?.currency || "INR"}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            preferences: {
                              ...profile.preferences,
                              currency: e.target.value,
                            },
                          })
                        }
                        placeholder="INR, USD, EUR"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="preferred_locations">Preferred Locations</Label>
                    <Input
                      id="preferred_locations"
                      value={(profile.preferences?.preferred_locations || []).join(", ")}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          preferences: {
                            ...profile.preferences,
                            preferred_locations: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          },
                        })
                      }
                      placeholder="e.g. Bengaluru, Remote, Delhi NCR, Hyderabad"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Work Modes Allowed</Label>
                    <div className="flex gap-4">
                      {["Remote", "Hybrid", "Onsite"].map((mode) => {
                        const activeModes = profile.preferences?.work_modes || ["Remote", "Hybrid", "Onsite"];
                        const isChecked = activeModes.includes(mode);
                        return (
                          <label key={mode} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const newModes = e.target.checked
                                  ? [...activeModes, mode]
                                  : activeModes.filter((m: string) => m !== mode);
                                setProfile({
                                  ...profile,
                                  preferences: {
                                    ...profile.preferences,
                                    work_modes: newModes,
                                  },
                                });
                              }}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            {mode}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 4: VERIFIED ANSWERS */}
            <TabsContent value="answers" className="mt-4">
              <Card className="border-slate-200">
                <CardHeader>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Verified Answers Store
                  </CardTitle>
                  <CardDescription>
                    Pre-saved truthful answers for common job portal application fields.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="work_authorization">Work Authorization</Label>
                      <Input
                        id="work_authorization"
                        value={profile.verified_answers?.work_authorization || ""}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            verified_answers: {
                              ...profile.verified_answers,
                              work_authorization: e.target.value,
                            },
                          })
                        }
                        placeholder="e.g. Authorized to work in India"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="notice_period">Notice Period</Label>
                      <Input
                        id="notice_period"
                        value={profile.verified_answers?.notice_period || ""}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            verified_answers: {
                              ...profile.verified_answers,
                              notice_period: e.target.value,
                            },
                          })
                        }
                        placeholder="e.g. Immediate / 30 days"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="linkedin_url">LinkedIn Profile URL</Label>
                    <Input
                      id="linkedin_url"
                      value={profile.verified_answers?.linkedin_url || ""}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          verified_answers: {
                            ...profile.verified_answers,
                            linkedin_url: e.target.value,
                          },
                        })
                      }
                      placeholder="https://linkedin.com/in/username"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="github_url">GitHub Profile URL</Label>
                    <Input
                      id="github_url"
                      value={profile.verified_answers?.github_url || ""}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          verified_answers: {
                            ...profile.verified_answers,
                            github_url: e.target.value,
                          },
                        })
                      }
                      placeholder="https://github.com/username"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="portfolio_url">Portfolio Website URL</Label>
                    <Input
                      id="portfolio_url"
                      value={profile.verified_answers?.portfolio_url || ""}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          verified_answers: {
                            ...profile.verified_answers,
                            portfolio_url: e.target.value,
                          },
                        })
                      }
                      placeholder="https://yourportfolio.dev"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
