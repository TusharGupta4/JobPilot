"use client";

import { useEffect, useState } from "react";
import {
  getJobs,
  discoverJobs,
  enrichJobContacts,
  updateJobStatus,
  triggerAiMatch,
  triggerAutoApply,
  JobData,
  DiscoveryFilters,
  AiMatchResult,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Search,
  Filter,
  Sparkles,
  ExternalLink,
  Mail,
  Phone,
  Globe,
  CheckCircle,
  Clock,
  MapPin,
  Briefcase,
  Zap,
  Building,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Send,
  Loader2,
  Bot,
  Copy,
  Terminal,
  ShieldCheck,
  Brain,
  Layers,
  Server,
  Layout,
  BarChart3,
  Activity,
  Cloud,
} from "lucide-react";

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [enrichingId, setEnrichingId] = useState<number | null>(null);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);

  const [selectedJob, setSelectedJob] = useState<JobData | null>(null);
  const [aiMatchData, setAiMatchData] = useState<AiMatchResult | null>(null);
  const [aiMatchJob, setAiMatchJob] = useState<JobData | null>(null);

  // Search & Filter Panel State
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [keywords, setKeywords] = useState("Python Full Stack");
  const [location, setLocation] = useState("India");
  const [timeWindow, setTimeWindow] = useState<"24h" | "7d" | "14d" | "all">("24h");
  const [experience, setExperience] = useState<"Fresher" | "Internship" | "Entry-level" | "Any">("Fresher");
  const [jobType, setJobType] = useState<"Full-time" | "Internship" | "Part-time" | "Contract">("Full-time");
  const [limit, setLimit] = useState(30);

  // In-Dashboard Tab Filters
  const [portalFilter, setPortalFilter] = useState<string>("all");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    try {
      setLoading(true);
      const data = await getJobs();
      setJobs(data);
    } catch (err: any) {
      toast.error("Failed to load jobs. Make sure Django backend is running.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRunDiscovery() {
    try {
      setDiscovering(true);
      toast.info(`Scanning portals for "${keywords}" in ${location} (${timeWindow === "24h" ? "Past 24 Hours" : timeWindow})...`);

      const res = await discoverJobs({
        keywords,
        location,
        time_window: timeWindow,
        experience,
        job_type: jobType,
        limit,
      });

      setJobs(res.jobs);
      toast.success(res.message);
    } catch (err: any) {
      toast.error("Discovery error: " + err.message);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleEnrichContacts(job: JobData) {
    try {
      setEnrichingId(job.id);
      toast.info(`Crawling company website for ${job.company_name} contact info...`);
      const res = await enrichJobContacts(job.id);

      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? { ...j, contact_emails: res.contact_emails, contact_phones: res.contact_phones }
            : j
        )
      );

      if (selectedJob && selectedJob.id === job.id) {
        setSelectedJob({
          ...selectedJob,
          contact_emails: res.contact_emails,
          contact_phones: res.contact_phones,
        });
      }

      if (res.contact_emails.length > 0 || res.contact_phones.length > 0) {
        toast.success(`Discovered ${res.contact_emails.length} emails and ${res.contact_phones.length} phone numbers!`);
      } else {
        toast.info("No public emails or phone numbers found on the company pages.");
      }
    } catch (err: any) {
      toast.error("Contact enrichment failed: " + err.message);
    } finally {
      setEnrichingId(null);
    }
  }

  async function handleAutoApply(job: JobData) {
    try {
      setApplyingId(job.id);
      toast.info(`Launching stealth browser worker for ${job.company_name}...`);
      const res = await triggerAutoApply(job.id);

      if (res.success) {
        toast.success(res.message);
      } else {
        toast.warning(res.message);
      }

      await loadJobs();
    } catch (err: any) {
      toast.error("Auto-apply error: " + err.message);
    } finally {
      setApplyingId(null);
    }
  }

  async function handleAiMatch(job: JobData) {
    try {
      setAnalyzingId(job.id);
      setAiMatchJob(job);
      toast.info(`Analyzing match with Gemini AI for ${job.title}...`);
      const res = await triggerAiMatch(job.id);
      setAiMatchData(res);

      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? { ...j, match_score: res.match_score, priority_rank: res.priority_rank as any }
            : j
        )
      );
      toast.success("AI match analysis completed!");
    } catch (err: any) {
      toast.error("AI analysis failed: " + err.message);
    } finally {
      setAnalyzingId(null);
    }
  }

  async function handleStatusChange(jobId: number, newStatus: string) {
    try {
      const updated = await updateJobStatus(jobId, newStatus);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      if (selectedJob && selectedJob.id === jobId) {
        setSelectedJob(updated);
      }
      toast.success(`Status updated to ${newStatus}`);
    } catch (err: any) {
      toast.error("Failed to update status: " + err.message);
    }
  }

  const filteredJobs = jobs.filter((job) => {
    if (portalFilter !== "all" && job.portal_source !== portalFilter) return false;
    if (domainFilter !== "all" && !(job.semantic_domains || []).includes(domainFilter)) return false;
    if (priorityFilter !== "ALL" && job.priority_rank !== priorityFilter) return false;
    if (statusFilter !== "ALL" && job.application_status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = job.title.toLowerCase().includes(q);
      const matchComp = job.company_name.toLowerCase().includes(q);
      const matchDesc = job.description.toLowerCase().includes(q);
      if (!matchTitle && !matchComp && !matchDesc) return false;
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Multi-Portal Job Discovery & Auto-Apply
            </h1>
            <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">
              v2.0 Autonomous Engine
            </Badge>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Automated scanning across Indeed, Wellfound, Naukri, LinkedIn, and direct ATS boards with stealth auto-apply.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="flex items-center gap-2 text-slate-700"
          >
            <SlidersHorizontal className="w-4 h-4" />
            {filtersOpen ? "Hide Filters" : "Filter Controls"}
            {filtersOpen ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
          </Button>
          <Button
            onClick={handleRunDiscovery}
            disabled={discovering}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-md shadow-indigo-500/20"
          >
            {discovering ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Scanning Portals...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Scan & Discover Now
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Persistent Session / Password-Free Info Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border border-emerald-200 text-emerald-900 text-xs">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
          <div>
            <span className="font-semibold text-emerald-950">Password-Free Stealth Auto-Apply Ready:</span>{" "}
            Run{" "}
            <code className="bg-white/80 px-1.5 py-0.5 rounded border border-emerald-300 font-mono text-[11px] text-emerald-800">
              python manage.py setup_browser_session
            </code>{" "}
            once in terminal to log in to your portal accounts safely. Playwright saves your session cookies locally!
          </div>
        </div>
      </div>

      {/* Advanced Filter Panel */}
      {filtersOpen && (
        <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50/40 via-white to-slate-50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-slate-900">
              <Filter className="w-4 h-4 text-indigo-600" />
              Advanced Discovery Configuration
            </CardTitle>
            <CardDescription className="text-xs">
              Configure date range, industry domain, location, and experience criteria to target fresh opportunities.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Domain / Keywords */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Domain / Role Keywords</label>
                <Input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g. Python Full Stack, Medicine, Data Analyst"
                  className="bg-white"
                />
              </div>

              {/* Location */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Location</label>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. India, Remote, Bengaluru, Pune"
                  className="bg-white"
                />
              </div>

              {/* Posting Date / Freshness */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Posting Date Horizon</label>
                <select
                  value={timeWindow}
                  onChange={(e) => setTimeWindow(e.target.value as any)}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="24h">🔥 Last 24 Hours (Most Fresh)</option>
                  <option value="7d">📅 Last 7 Days</option>
                  <option value="14d">🗓️ Last 14 Days</option>
                  <option value="all">🌐 All Available</option>
                </select>
              </div>

              {/* Experience Level */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Experience Level</label>
                <select
                  value={experience}
                  onChange={(e) => setExperience(e.target.value as any)}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Fresher">🌱 Fresher / 0-1 Years</option>
                  <option value="Internship">🎓 Internship</option>
                  <option value="Entry-level">🚀 Entry-Level</option>
                  <option value="Any">✨ Any Experience</option>
                </select>
              </div>
            </div>

            {/* Quick Domain Suggestions */}
            <div className="pt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Quick Presets:</span>
              {[
                "Python Full Stack",
                "React / Next.js Developer",
                "Healthcare & Medicine",
                "Data Science / AI",
                "Backend Engineer (Django)",
                "Frontend Engineer",
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setKeywords(preset)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    keywords === preset
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 1. SEPARATE PORTAL FILTER TABS */}
      <div className="p-1.5 bg-slate-100/90 rounded-2xl flex flex-wrap gap-1.5 border border-slate-200">
        {[
          { key: "all", label: "All Portals", count: jobs.length },
          { key: "indeed", label: "Indeed India", count: jobs.filter((j) => j.portal_source === "indeed").length },
          { key: "wellfound", label: "Wellfound", count: jobs.filter((j) => j.portal_source === "wellfound").length },
          { key: "cutshort", label: "Cutshort", count: jobs.filter((j) => j.portal_source === "cutshort").length },
          { key: "ats_direct", label: "Direct ATS", count: jobs.filter((j) => j.portal_source === "ats_direct").length },
        ].map((tab) => {
          const isSelected = portalFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setPortalFilter(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                isSelected
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  isSelected ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 2. SEMANTIC DOMAIN MATCHING SELECTOR */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            <Brain className="w-4 h-4 text-purple-600" />
            <span>Semantic Domain Matching (Contextual Relevance)</span>
          </div>
          {domainFilter !== "all" && (
            <button
              onClick={() => setDomainFilter("all")}
              className="text-xs text-indigo-600 hover:underline font-medium"
            >
              Reset to All Domains
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { key: "all", label: "All Domains", icon: Globe },
            { key: "aiml", label: "AI / ML & Data Science", icon: Brain },
            { key: "fullstack", label: "Full Stack Development", icon: Layers },
            { key: "backend", label: "Backend & APIs", icon: Server },
            { key: "frontend", label: "Frontend & UI/UX", icon: Layout },
            { key: "data", label: "Data Engineering", icon: BarChart3 },
            { key: "healthcare", label: "Healthcare & Medicine", icon: Activity },
            { key: "devops", label: "Cloud & DevOps", icon: Cloud },
          ].map((pill) => {
            const Icon = pill.icon;
            const isSelected = domainFilter === pill.key;
            const count =
              pill.key === "all"
                ? jobs.length
                : jobs.filter((j) => (j.semantic_domains || []).includes(pill.key)).length;

            return (
              <button
                key={pill.key}
                onClick={() => setDomainFilter(pill.key)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border transition-all ${
                  isSelected
                    ? "bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-600/20 font-semibold"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{pill.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    isSelected ? "bg-purple-800 text-purple-200" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Priority Rank & Status Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* In-page priority tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "ALL", label: "All Opportunities" },
            { id: "HIGH", label: "🔥 High Priority", count: jobs.filter((j) => j.priority_rank === "HIGH").length },
            { id: "MEDIUM", label: "⚡ Medium Priority", count: jobs.filter((j) => j.priority_rank === "MEDIUM").length },
            { id: "LOW", label: "Low Priority", count: jobs.filter((j) => j.priority_rank === "LOW").length },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setPriorityFilter(tab.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                priorityFilter === tab.id
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {tab.label} {tab.count !== undefined && `(${tab.count})`}
            </button>
          ))}
        </div>

        {/* Live Search Box */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search company, title, or skill..."
            className="pl-9 h-9 bg-white text-xs"
          />
        </div>
      </div>

      {/* Jobs Grid / Feed */}
      {loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
          <p className="text-sm text-slate-500 font-medium">Loading discovered jobs...</p>
        </div>
      ) : filteredJobs.length === 0 ? (
        <Card className="border-dashed border-2 p-12 text-center space-y-3 bg-white">
          <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">No jobs matching your filter</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Click &quot;Scan &amp; Discover Now&quot; above to search live portals for fresh matching openings.
          </p>
          <Button onClick={handleRunDiscovery} className="mt-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs">
            Run Discovery Now
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredJobs.map((job) => (
            <Card
              key={job.id}
              className={`border transition-all hover:shadow-md ${
                job.priority_rank === "HIGH"
                  ? "border-rose-200 bg-gradient-to-b from-rose-50/20 via-white to-white"
                  : "border-slate-200 bg-white"
              }`}
            >
              <CardHeader className="pb-3">
                {/* Card Top Badges */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {job.priority_rank === "HIGH" && (
                      <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-[10px] font-bold">
                        🔥 HIGH PRIORITY
                      </Badge>
                    )}
                    {job.priority_rank === "MEDIUM" && (
                      <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] font-semibold">
                        MEDIUM
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] text-slate-600">
                      {job.portal_source.toUpperCase()}
                    </Badge>
                    {job.is_easy_apply && (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                        ⚡ Easy Apply
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleAiMatch(job)}
                      disabled={analyzingId === job.id}
                      className="text-[11px] font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded-full border border-purple-200 flex items-center gap-1 transition-colors"
                      title="Run Gemini AI match breakdown"
                    >
                      {analyzingId === job.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Bot className="w-3 h-3" />
                      )}
                      AI Match
                    </button>
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      {job.match_score}% Match
                    </span>
                  </div>
                </div>

                {/* Job Title & Company */}
                <CardTitle className="text-lg font-bold text-slate-900 leading-snug">
                  {job.title}
                </CardTitle>
                <div className="flex items-center gap-2 text-xs text-slate-600 mt-1">
                  <span className="font-semibold text-slate-800">{job.company_name}</span>
                  {job.company_website && (
                    <a
                      href={job.company_website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5"
                    >
                      <Globe className="w-3 h-3" />
                      Website
                    </a>
                  )}
                  <span>•</span>
                  <span className="flex items-center gap-1 text-slate-500">
                    <MapPin className="w-3 h-3" />
                    {job.locations.join(", ") || "Remote"}
                  </span>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 text-xs">
                {/* Description Snippet */}
                <p className="text-slate-600 line-clamp-2 leading-relaxed">
                  {job.description || "No full description provided. Click details to view full posting."}
                </p>

                {/* Company Contact Information Box */}
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <Building className="w-3.5 h-3.5 text-indigo-600" />
                      Company Contact Details
                    </span>
                    <button
                      onClick={() => handleEnrichContacts(job)}
                      disabled={enrichingId === job.id}
                      className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1 disabled:opacity-50"
                    >
                      {enrichingId === job.id ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Crawling...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3 h-3" />
                          Enrich Contacts
                        </>
                      )}
                    </button>
                  </div>

                  {job.contact_emails && job.contact_emails.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {job.contact_emails.map((email) => (
                        <a
                          key={email}
                          href={`mailto:${email}`}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 hover:underline"
                        >
                          <Mail className="w-3 h-3 text-indigo-500" />
                          {email}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 italic">
                      No public email yet. Click &quot;Enrich Contacts&quot; to crawl website.
                    </p>
                  )}

                  {job.contact_phones && job.contact_phones.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      {job.contact_phones.map((phone) => (
                        <a
                          key={phone}
                          href={`tel:${phone}`}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200 hover:underline"
                        >
                          <Phone className="w-3 h-3 text-emerald-600" />
                          {phone}
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Action Footer */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-slate-500">Status:</span>
                    <select
                      value={job.application_status}
                      onChange={(e) => handleStatusChange(job.id, e.target.value)}
                      className="text-[11px] font-medium rounded border border-slate-200 px-2 py-1 bg-white focus:outline-none"
                    >
                      <option value="MANUAL_APPLY_NEEDED">Manual Apply Needed</option>
                      <option value="AUTO_APPLY_ELIGIBLE">Auto-Apply Eligible</option>
                      <option value="AUTO_APPLIED">Auto-Applied ✅</option>
                      <option value="APPLIED">Applied (Manual) ✅</option>
                      <option value="SAVED">Saved</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Auto-Apply Button */}
                    <Button
                      size="sm"
                      onClick={() => handleAutoApply(job)}
                      disabled={applyingId === job.id}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 flex items-center gap-1 shadow-xs"
                      title="Launch stealth browser worker to auto-fill application"
                    >
                      {applyingId === job.id ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>
                          <Zap className="w-3 h-3" />
                          Auto-Apply
                        </>
                      )}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedJob(job)}
                      className="text-xs h-8"
                    >
                      Details
                    </Button>

                    <a
                      href={job.apply_url || job.original_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-xs h-8 flex items-center gap-1"
                      >
                        Portal Link
                        <ExternalLink className="w-3 h-3 ml-0.5" />
                      </Button>
                    </a>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* AI Match Modal Dialog */}
      {aiMatchData && aiMatchJob && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge className="bg-purple-100 text-purple-800 mb-1 flex items-center gap-1 w-fit">
                  <Bot className="w-3.5 h-3.5" />
                  AI Candidate Match Analysis ({aiMatchData.source})
                </Badge>
                <h3 className="text-lg font-bold text-slate-900">{aiMatchJob.title}</h3>
                <p className="text-xs text-slate-500">{aiMatchJob.company_name}</p>
              </div>
              <button
                onClick={() => setAiMatchData(null)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <Separator />

            {/* Score & Priority Overview */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-purple-50/60 border border-purple-100">
              <div>
                <span className="text-xs text-purple-900 font-semibold">Overall Match Score</span>
                <div className="text-2xl font-black text-purple-700">{aiMatchData.match_score}%</div>
              </div>
              <div className="text-right">
                <span className="text-xs text-purple-900 font-semibold">Priority Recommendation</span>
                <div>
                  <Badge className={aiMatchData.priority_rank === "HIGH" ? "bg-rose-500 text-white" : "bg-amber-500 text-white"}>
                    {aiMatchData.priority_rank} PRIORITY
                  </Badge>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="space-y-1.5 text-xs text-slate-700">
              <span className="font-semibold text-slate-900">Why You Fit This Role:</span>
              <p className="leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                {aiMatchData.match_summary}
              </p>
            </div>

            {/* Matched & Missing Skills */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100 space-y-1.5">
                <span className="font-semibold text-emerald-900 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                  Matching Skills ({aiMatchData.matched_skills.length})
                </span>
                <div className="flex flex-wrap gap-1">
                  {aiMatchData.matched_skills.map((s) => (
                    <span key={s} className="bg-white text-emerald-800 text-[10px] font-medium px-2 py-0.5 rounded border border-emerald-200">
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 space-y-1.5">
                <span className="font-semibold text-amber-900 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  Missing / Desired Skills
                </span>
                <div className="flex flex-wrap gap-1">
                  {aiMatchData.missing_skills.length > 0 ? (
                    aiMatchData.missing_skills.map((s) => (
                      <span key={s} className="bg-white text-amber-800 text-[10px] font-medium px-2 py-0.5 rounded border border-amber-200">
                        {s}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-amber-700 italic">No major gaps identified!</span>
                  )}
                </div>
              </div>
            </div>

            {/* Tailored Pitch */}
            {aiMatchData.tailored_pitch && (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">Tailored Application Pitch:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(aiMatchData.tailored_pitch);
                      toast.success("Pitch copied to clipboard!");
                    }}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium"
                  >
                    <Copy className="w-3 h-3" />
                    Copy Pitch
                  </button>
                </div>
                <p className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-slate-700 italic leading-relaxed">
                  &quot;{aiMatchData.tailored_pitch}&quot;
                </p>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={() => setAiMatchData(null)} className="text-xs bg-slate-900 text-white">
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Job Details Modal / Drawer */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Badge className="bg-indigo-100 text-indigo-700 mb-2">
                  {selectedJob.portal_source.toUpperCase()} • {selectedJob.priority_rank} PRIORITY
                </Badge>
                <h2 className="text-xl font-bold text-slate-900">{selectedJob.title}</h2>
                <p className="text-sm font-semibold text-slate-600 mt-0.5">{selectedJob.company_name}</p>
              </div>
              <button
                onClick={() => setSelectedJob(null)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <Separator />

            {/* Contact details callout */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <h4 className="font-semibold text-xs text-slate-800 flex items-center gap-1.5">
                <Building className="w-4 h-4 text-indigo-600" />
                Company Contact & Recruitment Information
              </h4>
              <div className="space-y-1 text-xs text-slate-600">
                <p>
                  <span className="font-medium text-slate-700">Emails:</span>{" "}
                  {selectedJob.contact_emails && selectedJob.contact_emails.length > 0 ? (
                    selectedJob.contact_emails.join(", ")
                  ) : (
                    <span className="italic text-slate-400">Not discovered yet.</span>
                  )}
                </p>
                <p>
                  <span className="font-medium text-slate-700">Phones:</span>{" "}
                  {selectedJob.contact_phones && selectedJob.contact_phones.length > 0 ? (
                    selectedJob.contact_phones.join(", ")
                  ) : (
                    <span className="italic text-slate-400">Not discovered yet.</span>
                  )}
                </p>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <h4 className="font-semibold text-xs text-slate-800">Job Description</h4>
              <div className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto p-3 rounded-lg border border-slate-100 bg-slate-50">
                {selectedJob.description || "No full description text available."}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleEnrichContacts(selectedJob)}
                disabled={enrichingId === selectedJob.id}
                className="text-xs"
              >
                {enrichingId === selectedJob.id ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Crawling Site...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Crawl Website for Contacts
                  </>
                )}
              </Button>

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelectedJob(null)} className="text-xs">
                  Close
                </Button>
                <a
                  href={selectedJob.apply_url || selectedJob.original_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs">
                    Open Official Application
                    <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
