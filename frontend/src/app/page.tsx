"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  getJobs,
  getDomainStats,
  triggerAutoApply,
  triggerAiMatch,
  enrichJobContacts,
  JobData,
  DomainMetadata,
  DomainStatsResponse,
  AiMatchResult,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Sparkles,
  Search,
  ExternalLink,
  Mail,
  Phone,
  Globe,
  CheckCircle,
  Briefcase,
  Zap,
  Building,
  RefreshCw,
  SlidersHorizontal,
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
  CheckCircle2,
  MapPin,
  Clock,
  ArrowRight,
  User,
  Database,
  Filter,
} from "lucide-react";

export default function Home() {
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [domainStats, setDomainStats] = useState<DomainStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPortal, setSelectedPortal] = useState<string>("all");
  const [selectedDomain, setSelectedDomain] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [enrichingId, setEnrichingId] = useState<number | null>(null);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);

  // Modals & Details
  const [selectedJob, setSelectedJob] = useState<JobData | null>(null);
  const [aiMatchData, setAiMatchData] = useState<AiMatchResult | null>(null);
  const [aiMatchJob, setAiMatchJob] = useState<JobData | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    try {
      setLoading(true);
      const [jobsData, statsData] = await Promise.all([
        getJobs(),
        getDomainStats().catch(() => null),
      ]);
      setJobs(jobsData);
      setDomainStats(statsData);
    } catch (err: any) {
      toast.error("Failed to load dashboard jobs. Ensure backend is running.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Multi-Portal Tabs Configuration
  const portalTabs = [
    { key: "all", label: "All Portals", count: jobs.length, color: "bg-slate-900 text-white" },
    {
      key: "indeed",
      label: "Indeed India",
      count: jobs.filter((j) => j.portal_source === "indeed").length,
      badgeClass: "bg-blue-600 text-white hover:bg-blue-700",
      icon: "Indeed",
    },
    {
      key: "wellfound",
      label: "Wellfound",
      count: jobs.filter((j) => j.portal_source === "wellfound").length,
      badgeClass: "bg-neutral-800 text-white hover:bg-neutral-900",
      icon: "Wellfound",
    },
    {
      key: "cutshort",
      label: "Cutshort",
      count: jobs.filter((j) => j.portal_source === "cutshort").length,
      badgeClass: "bg-purple-600 text-white hover:bg-purple-700",
      icon: "Cutshort",
    },
    {
      key: "ats_direct",
      label: "Direct ATS",
      count: jobs.filter((j) => j.portal_source === "ats_direct").length,
      badgeClass: "bg-emerald-600 text-white hover:bg-emerald-700",
      icon: "ATS",
    },
  ];

  // Semantic Domain Taxonomy
  const domainPills = [
    {
      key: "all",
      label: "All Domains",
      icon: Globe,
      desc: "All technology and software engineering opportunities",
    },
    {
      key: "aiml",
      label: "AI / ML & Data Science",
      icon: Brain,
      desc: "Machine Learning, Deep Learning, NLP, LLMs, Computer Vision, and Python AI tools",
    },
    {
      key: "fullstack",
      label: "Full Stack Development",
      icon: Layers,
      desc: "Client-server web apps, React, Node, Django, Next.js, and software trainees",
    },
    {
      key: "backend",
      label: "Backend & APIs",
      icon: Server,
      desc: "High-throughput APIs, microservices, databases, Django, FastAPI, and SQL",
    },
    {
      key: "frontend",
      label: "Frontend & UI/UX",
      icon: Layout,
      desc: "Interactive web interfaces, React, Tailwind CSS, TypeScript, and UI engineering",
    },
    {
      key: "data",
      label: "Data Engineering",
      icon: BarChart3,
      desc: "ETL pipelines, analytics, SQL querying, Business Intelligence, and data analysis",
    },
    {
      key: "healthcare",
      label: "Healthcare & Medicine",
      icon: Activity,
      desc: "Healthtech platforms, medical records (EHR/EMR), clinical informatics, and HIPAA",
    },
    {
      key: "devops",
      label: "Cloud & DevOps",
      icon: Cloud,
      desc: "Docker, Kubernetes, AWS cloud infrastructure, CI/CD pipelines, and Linux",
    },
  ];

  // Filtered Jobs via Portal AND Semantic Domain
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      // 1. Portal filter
      if (selectedPortal !== "all" && job.portal_source !== selectedPortal) {
        return false;
      }

      // 2. Semantic Domain filter
      if (selectedDomain !== "all") {
        const domains = job.semantic_domains || [];
        if (!domains.includes(selectedDomain)) {
          return false;
        }
      }

      // 3. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = job.title.toLowerCase().includes(q);
        const matchesComp = job.company_name.toLowerCase().includes(q);
        const matchesDesc = job.description.toLowerCase().includes(q);
        const matchesLoc = job.locations.some((l) => l.toLowerCase().includes(q));
        if (!matchesTitle && !matchesComp && !matchesDesc && !matchesLoc) {
          return false;
        }
      }

      return true;
    });
  }, [jobs, selectedPortal, selectedDomain, searchQuery]);

  // Actions
  async function handleAutoApply(job: JobData) {
    try {
      setApplyingId(job.id);
      toast.info(`Launching Playwright stealth worker for "${job.title}"...`);
      const res = await triggerAutoApply(job.id);

      if (res.status === "AUTO_APPLIED") {
        toast.success(res.message);
      } else {
        toast.info(res.message);
      }
      loadDashboardData();
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
      toast.info(`Analyzing resume fit for "${job.title}" with Gemini AI...`);
      const res = await triggerAiMatch(job.id);
      setAiMatchData(res);
    } catch (err: any) {
      toast.error("AI Match error: " + err.message);
    } finally {
      setAnalyzingId(null);
    }
  }

  async function handleEnrichContacts(jobId: number) {
    try {
      setEnrichingId(jobId);
      toast.info("Scanning company career portal & contact pages for HR contacts...");
      const res = await enrichJobContacts(jobId);
      toast.success(res.message);
      loadDashboardData();
    } catch (err: any) {
      toast.error("Contact scan failed: " + err.message);
    } finally {
      setEnrichingId(null);
    }
  }

  // Active domain info
  const activeDomainMeta = domainPills.find((d) => d.key === selectedDomain);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Hero Welcome & Quick Stats */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-8 sm:p-10 text-white shadow-xl">
        <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Multi-Portal Autonomous Copilot</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Command Center: Multi-Portal Discovery & Semantic Domain Matching
            </h1>

            <p className="text-slate-300 text-sm leading-relaxed">
              Scan across Indeed India, Wellfound, Cutshort, and Unicorn ATS boards with contextual
              semantic filtering. Isolate opportunities by platform or domain with transparent matching.
            </p>
          </div>

          <div className="flex flex-wrap md:flex-col gap-3">
            <Link href="/jobs">
              <Button className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/30">
                <Search className="w-4 h-4 mr-2" />
                Live 24h Portal Scanner
              </Button>
            </Link>
            <Link href="/profile">
              <Button variant="outline" className="text-slate-200 border-slate-700 hover:bg-slate-800">
                <User className="w-4 h-4 mr-2" />
                Profile & Resumes
              </Button>
            </Link>
          </div>
        </div>

        {/* Live Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-slate-800/80">
          <div>
            <div className="text-2xl font-bold text-white">{jobs.length}</div>
            <div className="text-xs text-slate-400 font-medium">Total Live Opportunities</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-400">
              {jobs.filter((j) => j.is_easy_apply).length}
            </div>
            <div className="text-xs text-slate-400 font-medium">1-Click / Auto-Apply Ready</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-indigo-400">
              {jobs.filter((j) => j.priority_rank === "HIGH").length}
            </div>
            <div className="text-xs text-slate-400 font-medium">High Priority Matches (&gt;80%)</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-400">
              {jobs.filter((j) => (j.contact_emails && j.contact_emails.length > 0) || (j.contact_phones && j.contact_phones.length > 0)).length}
            </div>
            <div className="text-xs text-slate-400 font-medium">HR Contacts Discovered</div>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* DEDICATED INCOMING JOBS COMMAND SECTION */}
      {/* --------------------------------------------------------------------- */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Building className="w-5 h-5 text-indigo-600" />
              Incoming Multi-Portal Opportunities
            </h2>
            <p className="text-xs sm:text-sm text-slate-500">
              Filtered in real-time across source platforms and contextually matched domains.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <Input
                placeholder="Search company, title, skill..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadDashboardData}
              disabled={loading}
              className="h-9 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* 1. SEPARATE PORTAL FILTER TABS */}
        <div className="p-1.5 bg-slate-100/90 rounded-2xl flex flex-wrap gap-1.5 border border-slate-200">
          {portalTabs.map((tab) => {
            const isSelected = selectedPortal === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setSelectedPortal(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-2xs ${
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

        {/* 2. DOMAIN-BASED SEMANTIC MATCHING SELECTOR */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Brain className="w-4 h-4 text-purple-600" />
              <span>Semantic Domain Matching (Contextual Relevance)</span>
            </div>
            {selectedDomain !== "all" && (
              <button
                onClick={() => setSelectedDomain("all")}
                className="text-xs text-indigo-600 hover:underline font-medium"
              >
                Reset to All Domains
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {domainPills.map((pill) => {
              const Icon = pill.icon;
              const isSelected = selectedDomain === pill.key;
              const count =
                pill.key === "all"
                  ? jobs.length
                  : jobs.filter((j) => (j.semantic_domains || []).includes(pill.key)).length;

              return (
                <button
                  key={pill.key}
                  onClick={() => setSelectedDomain(pill.key)}
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

          {/* Contextual Explainer Banner */}
          {activeDomainMeta && (
            <div className="mt-2 p-3 rounded-xl bg-purple-50/70 border border-purple-200/60 flex items-start gap-2.5 text-xs text-purple-900">
              <Brain className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">{activeDomainMeta.label}: </span>
                <span className="text-purple-800">{activeDomainMeta.desc}.</span>
                <span className="block mt-0.5 text-[11px] text-purple-600">
                  {selectedDomain === "aiml"
                    ? "✓ Only jobs with genuine AI/ML, NLP, Deep Learning, or AI-integrated tech overlap are shown. Unrelated roles are excluded."
                    : selectedDomain === "all"
                    ? "✓ Showing all opportunities across selected portals."
                    : `✓ Semantic similarity detects roles matching ${activeDomainMeta.label} even when portals use alternate naming conventions.`}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* JOBS GRID */}
        {/* ------------------------------------------------------------------- */}
        {loading ? (
          <div className="py-20 text-center space-y-3">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-indigo-600" />
            <p className="text-sm text-slate-500">Loading incoming opportunities from portals...</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <Card className="border-dashed border-2 border-slate-200 p-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-800">
              No matching jobs found in this view
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
              We didn&apos;t find active jobs for portal &ldquo;{selectedPortal}&rdquo; in domain &ldquo;
              {activeDomainMeta?.label}&rdquo;. Run a live scan to discover fresh postings!
            </p>
            <div className="flex justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedPortal("all");
                  setSelectedDomain("all");
                }}
              >
                Clear Filters
              </Button>
              <Link href="/jobs">
                <Button size="sm" className="bg-indigo-600 text-white hover:bg-indigo-700">
                  <Zap className="w-3.5 h-3.5 mr-1.5" />
                  Run Live 24h Scan
                </Button>
              </Link>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filteredJobs.map((job) => {
              // Determine portal badge style
              let portalBadge = {
                name: "Indeed",
                className: "bg-blue-50 text-blue-700 border-blue-200",
              };
              if (job.portal_source === "wellfound") {
                portalBadge = {
                  name: "Wellfound",
                  className: "bg-neutral-100 text-neutral-800 border-neutral-300",
                };
              } else if (job.portal_source === "cutshort") {
                portalBadge = {
                  name: "Cutshort",
                  className: "bg-purple-50 text-purple-700 border-purple-200",
                };
              } else if (job.portal_source === "ats_direct") {
                portalBadge = {
                  name: "Direct ATS",
                  className: "bg-emerald-50 text-emerald-700 border-emerald-200",
                };
              }

              const hasContacts =
                (job.contact_emails && job.contact_emails.length > 0) ||
                (job.contact_phones && job.contact_phones.length > 0);

              return (
                <Card
                  key={job.id}
                  className="border-slate-200 hover:border-indigo-300 transition-all hover:shadow-md flex flex-col justify-between"
                >
                  <CardHeader className="pb-3 space-y-2.5">
                    {/* Top Row: Portal Badge + Domain Tag + Priority */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 ${portalBadge.className}`}
                        >
                          {portalBadge.name}
                        </Badge>

                        {job.semantic_domains && job.semantic_domains.length > 0 && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-medium bg-purple-50 text-purple-700 border-purple-200"
                          >
                            {job.semantic_domains.includes("aiml")
                              ? "🧠 AI/ML"
                              : job.semantic_domains.includes("fullstack")
                              ? "💻 Full Stack"
                              : job.semantic_domains.includes("backend")
                              ? "⚙️ Backend"
                              : "🚀 Tech"}
                          </Badge>
                        )}

                        {job.is_easy_apply && (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                          >
                            <Zap className="w-2.5 h-2.5 mr-0.5 fill-emerald-600" />
                            Easy Apply
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleAiMatch(job)}
                          disabled={analyzingId === job.id}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-600 hover:text-purple-700 bg-purple-50 hover:bg-purple-100 px-2 py-0.5 rounded-md border border-purple-200 transition-colors"
                        >
                          {analyzingId === job.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                          AI Match
                        </button>
                        <Badge
                          className={`text-[11px] font-bold ${
                            job.match_score >= 80
                              ? "bg-emerald-500 text-white"
                              : job.match_score >= 60
                              ? "bg-amber-500 text-white"
                              : "bg-slate-400 text-white"
                          }`}
                        >
                          {job.match_score}% Match
                        </Badge>
                      </div>
                    </div>

                    {/* Job Title & Company */}
                    <div>
                      <h3 className="text-base font-bold text-slate-900 leading-snug hover:text-indigo-600 transition-colors">
                        {job.title}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-slate-500 mt-1 flex-wrap">
                        <span className="font-semibold text-slate-700">{job.company_name}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {job.locations?.join(", ") || "India"}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {job.work_mode}
                        </span>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3.5 pt-0">
                    {/* Snippet */}
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {job.description || "Active opportunity discovered via official portal API."}
                    </p>

                    {/* Contact Info Card */}
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs space-y-1.5">
                      <div className="flex items-center justify-between text-slate-500 text-[11px] font-medium">
                        <span className="flex items-center gap-1">
                          <Building className="w-3 h-3 text-slate-400" />
                          Company Contact Details
                        </span>
                        <button
                          onClick={() => handleEnrichContacts(job.id)}
                          disabled={enrichingId === job.id}
                          className="text-indigo-600 hover:underline flex items-center gap-1 text-[10px]"
                        >
                          {enrichingId === job.id ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-2.5 h-2.5" />
                          )}
                          {hasContacts ? "Re-crawl" : "Enrich Contacts"}
                        </button>
                      </div>

                      {hasContacts ? (
                        <div className="space-y-1">
                          {job.contact_emails?.map((email) => (
                            <div key={email} className="flex items-center justify-between gap-1 text-slate-700">
                              <span className="flex items-center gap-1 truncate text-[11px]">
                                <Mail className="w-3 h-3 text-indigo-500 shrink-0" />
                                {email}
                              </span>
                              <a
                                href={`mailto:${email}?subject=Application for ${encodeURIComponent(
                                  job.title
                                )}`}
                                className="text-[10px] text-indigo-600 hover:underline font-medium shrink-0"
                              >
                                Email HR
                              </a>
                            </div>
                          ))}
                          {job.contact_phones?.map((phone) => (
                            <div key={phone} className="flex items-center gap-1 text-slate-700 text-[11px]">
                              <Phone className="w-3 h-3 text-emerald-500 shrink-0" />
                              {phone}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 italic">
                          No public email yet. Click &ldquo;Enrich Contacts&rdquo; to crawl website.
                        </div>
                      )}
                    </div>

                    <Separator />

                    {/* Bottom Action Buttons */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="text-[11px] text-slate-500 font-medium">
                        Status:{" "}
                        <span
                          className={`font-semibold ${
                            job.application_status === "AUTO_APPLIED"
                              ? "text-emerald-600"
                              : "text-slate-700"
                          }`}
                        >
                          {job.application_status.replace(/_/g, " ")}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => handleAutoApply(job)}
                          disabled={applyingId === job.id || job.application_status === "AUTO_APPLIED"}
                          className={`h-8 text-xs font-medium ${
                            job.application_status === "AUTO_APPLIED"
                              ? "bg-emerald-600 text-white"
                              : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs"
                          }`}
                        >
                          {applyingId === job.id ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              Applying...
                            </>
                          ) : job.application_status === "AUTO_APPLIED" ? (
                            <>
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Applied
                            </>
                          ) : (
                            <>
                              <Zap className="w-3 h-3 mr-1 fill-white" />
                              Auto-Apply
                            </>
                          )}
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedJob(job)}
                          className="h-8 text-xs text-slate-700"
                        >
                          Details
                        </Button>

                        <a
                          href={job.apply_url || job.original_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center h-8 px-2.5 rounded-md border border-slate-200 text-slate-600 hover:text-indigo-600 hover:bg-slate-50 text-xs font-medium transition-colors"
                          title="Open original job posting"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* AI MATCH MODAL DIALOG */}
      {/* --------------------------------------------------------------------- */}
      {aiMatchJob && aiMatchData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-purple-700">
                  <Sparkles className="w-3.5 h-3.5" />
                  AI RECRUITER MATCH ANALYSIS
                </div>
                <h3 className="text-lg font-bold text-slate-900 mt-1">{aiMatchJob.title}</h3>
                <p className="text-xs text-slate-500">{aiMatchJob.company_name}</p>
              </div>
              <button
                onClick={() => {
                  setAiMatchData(null);
                  setAiMatchJob(null);
                }}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-md"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Score & Priority */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-purple-50 border border-purple-200">
                <div>
                  <div className="text-[11px] font-bold text-purple-900 uppercase">Match Score</div>
                  <div className="text-2xl font-black text-purple-700">
                    {aiMatchData.match_score}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-bold text-purple-900 uppercase">Priority Tier</div>
                  <Badge className="bg-purple-700 text-white font-bold text-xs">
                    {aiMatchData.priority_rank} PRIORITY
                  </Badge>
                </div>
              </div>

              {/* Recruiter Summary */}
              <div>
                <div className="font-bold text-slate-800 mb-1">Recruiter Evaluation:</div>
                <p className="text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {aiMatchData.match_summary}
                </p>
              </div>

              {/* Matched Skills */}
              <div>
                <div className="font-bold text-slate-800 mb-1.5 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Matched Competencies ({aiMatchData.matched_skills?.length || 0}):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {aiMatchData.matched_skills?.map((skill) => (
                    <Badge
                      key={skill}
                      className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                    >
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Gap Analysis */}
              {aiMatchData.missing_skills && aiMatchData.missing_skills.length > 0 && (
                <div>
                  <div className="font-bold text-slate-800 mb-1.5 text-amber-700">
                    Skill Gaps / Learning Opportunities:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {aiMatchData.missing_skills.map((skill) => (
                      <Badge
                        key={skill}
                        variant="outline"
                        className="border-amber-300 text-amber-800 bg-amber-50 text-[10px]"
                      >
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Tailored Elevator Pitch */}
              {aiMatchData.tailored_pitch && (
                <div>
                  <div className="font-bold text-slate-800 mb-1 flex items-center justify-between">
                    <span>Tailored Application Pitch:</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(aiMatchData.tailored_pitch);
                        toast.success("Pitch copied to clipboard!");
                      }}
                      className="text-purple-600 hover:underline flex items-center gap-1 text-[11px]"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                  </div>
                  <div className="p-3 bg-slate-900 text-slate-200 rounded-lg text-[11px] leading-relaxed font-mono">
                    &ldquo;{aiMatchData.tailored_pitch}&rdquo;
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button
                size="sm"
                onClick={() => {
                  setAiMatchData(null);
                  setAiMatchJob(null);
                }}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                Close Analysis
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* JOB DETAIL DRAWER / MODAL */}
      {/* --------------------------------------------------------------------- */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs font-bold uppercase">
                    {selectedJob.portal_source}
                  </Badge>
                  <Badge className="bg-indigo-600 text-white text-xs">
                    {selectedJob.priority_rank} PRIORITY
                  </Badge>
                </div>
                <h3 className="text-xl font-bold text-slate-900">{selectedJob.title}</h3>
                <p className="text-xs text-slate-500 font-medium">
                  {selectedJob.company_name} • {selectedJob.locations?.join(", ") || "India"} •{" "}
                  {selectedJob.work_mode}
                </p>
              </div>
              <button
                onClick={() => setSelectedJob(null)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <h4 className="font-bold text-slate-800 mb-1">Full Description / Requirements:</h4>
                <div className="p-3 bg-slate-50 border rounded-lg text-slate-700 leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap">
                  {selectedJob.description}
                </div>
              </div>

              {/* Contacts */}
              <div className="p-3 bg-indigo-50/50 border border-indigo-200 rounded-lg space-y-2">
                <div className="font-bold text-indigo-900">Official Company Contacts:</div>
                {selectedJob.contact_emails && selectedJob.contact_emails.length > 0 ? (
                  selectedJob.contact_emails.map((em) => (
                    <div key={em} className="flex items-center justify-between text-slate-700">
                      <span>{em}</span>
                      <a
                        href={`mailto:${em}?subject=Application for ${encodeURIComponent(
                          selectedJob.title
                        )}`}
                        className="text-indigo-600 font-semibold hover:underline"
                      >
                        Send Direct Email
                      </a>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500 italic">No direct email found yet.</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="outline" size="sm" onClick={() => setSelectedJob(null)}>
                Close
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    handleAutoApply(selectedJob);
                    setSelectedJob(null);
                  }}
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  <Zap className="w-3.5 h-3.5 mr-1" />
                  Auto-Apply Now
                </Button>
                <a
                  href={selectedJob.apply_url || selectedJob.original_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
                >
                  Visit Portal <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
