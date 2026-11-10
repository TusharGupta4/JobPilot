"use client";

import { useEffect, useState, useRef, Fragment } from "react";
import Link from "next/link";
import {
  getJobs,
  discoverJobs,
  getLatestDiscoveryFeed,
  healDiscoveryStatuses,
  enrichJobContacts,
  updateJobStatus,
  triggerAiMatch,
  triggerAutoApply,
  getBulkJobContacts,
  getProfile,
  getBulkApplyRun,
  JobData,
  DiscoveryFilters,
  AiMatchResult,
  BulkContactsResponse,
  BulkApplyRunData,
  BulkApplyItemData,
  DiscoveryRunData,
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
  CheckSquare,
  StopCircle,
  CheckCircle2,
  Check,
  Download,
  Users,
  Bookmark,
  Play,
  SkipForward,
  X,
} from "lucide-react";

function cleanLocation(loc?: string): string {
  if (!loc) return "Remote";
  let c = loc.replace(/^View all .*? jobs\s*-\s*/i, "");
  c = c.replace(/jobsSalary Search:.*$/i, "");
  c = c.replace(/Salary Search:.*$/i, "");
  c = c.replace(/\s*-\s*.*jobs in .*$/i, "");
  c = c.replace(/\s*-\s*.*jobs$/i, "");
  c = c.trim();
  return c || "Remote";
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);

  const [selectedJob, setSelectedJob] = useState<JobData | null>(null);
  const [aiMatchData, setAiMatchData] = useState<AiMatchResult | null>(null);
  const [aiMatchJob, setAiMatchJob] = useState<JobData | null>(null);

  // Main View Navigation: "discover" (Search/Feed) vs "my_applications" (Tracker)
  const [activeMainTab, setActiveMainTab] = useState<"discover" | "my_applications">("discover");
  const [applicationsSubFilter, setApplicationsSubFilter] = useState<string>("ALL");

  // Search & Filter Panel State
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [keywords, setKeywords] = useState("Python Full Stack");
  const [location, setLocation] = useState("India");
  const [timeWindow, setTimeWindow] = useState<"24h" | "7d" | "14d" | "all">("all");
  const [experience, setExperience] = useState<"Fresher" | "0-2 Y" | "0-3 Y" | "1-3 Y" | "Junior" | "Mid-Level" | "Senior" | "Lead" | "Any">("Any");
  const [jobType, setJobType] = useState<"Full-time" | "Internship" | "Part-time" | "Contract" | "all">("all");
  const [workMode, setWorkMode] = useState<"Remote" | "Hybrid" | "Onsite" | "all">("all");
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [limit, setLimit] = useState(60);

  // In-Dashboard Tab Filters
  const [portalFilter, setPortalFilter] = useState<string>("all");
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Category & Company Filters
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "APPLIED" | "UNAPPLIED" | "AUTO_APPLY" | "MANUAL_APPLY">("ALL");
  const [companyFilter, setCompanyFilter] = useState<string>("ALL");
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);

  // Gallery-Style Job Selection State
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([]);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkRunId, setBulkRunId] = useState<number | null>(null);
  const [bulkItems, setBulkItems] = useState<BulkApplyItemData[]>([]);
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
    title: string;
    company: string;
    status: string;
    completed?: number;
    message?: string;
  } | null>(null);
  const bulkPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Automatic Background Contact Enrichment Tracking
  const autoEnrichingIds = useRef<Set<number>>(new Set());
  const [activelyCrawlingIds, setActivelyCrawlingIds] = useState<number[]>([]);

  // Progressive Multi-Page Scraping State
  const [progressiveInfo, setProgressiveInfo] = useState<{
    page: number;
    newJobsThisPage: number;
    totalAdded: number;
    statusText: string;
    isPausing: boolean;
    hasMore?: boolean;
    runId?: number | null;
  } | null>(null);
  const [discoveryRun, setDiscoveryRun] = useState<DiscoveryRunData | null>(null);
  const [trackerJobs, setTrackerJobs] = useState<JobData[]>([]);
  const stopProgressiveRef = useRef<boolean>(false);
  const activeDiscoveryRunIdRef = useRef<number | null>(null);

  function isOneClickReady(j: JobData) {
    if (j.application_status === "APPLIED" || j.application_status === "AUTO_APPLIED") return false;
    if (j.application_status === "MANUAL_APPLY_NEEDED" || j.application_status === "REJECTED") return false;
    if (j.listing_status === "expired") return false;
    if (j.apply_mode === "ineligible" || j.apply_mode === "already_applied" || j.apply_mode === "manual_external") return false;
    if (j.is_auto_ready === false) return false;
    if (j.is_auto_ready === true && j.is_easy_apply) return true;
    if (j.apply_mode === "one_click") return true;
    if (j.is_easy_apply) return true;
    return false;
  }

  const isHydratedRef = useRef(false);

  const saveToStorage = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  };

  // 1. Restore search keywords, domain selections, and filter states from localStorage on page mount
  useEffect(() => {
    try {
      const savedKeywords = localStorage.getItem("jobpilot_search_keywords");
      if (savedKeywords) setKeywords(savedKeywords);

      const savedDomains = localStorage.getItem("jobpilot_selected_domains");
      if (savedDomains) {
        try {
          const parsed = JSON.parse(savedDomains);
          if (Array.isArray(parsed)) setSelectedDomains(parsed);
        } catch (e) {}
      }

      const savedExp = localStorage.getItem("jobpilot_experience");
      if (savedExp) setExperience(savedExp as any);

      const savedLoc = localStorage.getItem("jobpilot_location");
      if (savedLoc) setLocation(savedLoc);

      const savedJobType = localStorage.getItem("jobpilot_job_type");
      if (savedJobType) setJobType(savedJobType as any);

      const savedWorkMode = localStorage.getItem("jobpilot_work_mode");
      if (savedWorkMode) setWorkMode(savedWorkMode as any);

      const savedTimeWindow = localStorage.getItem("jobpilot_time_window");
      if (savedTimeWindow) setTimeWindow(savedTimeWindow as any);

      const savedPortal = localStorage.getItem("jobpilot_portal_filter");
      if (savedPortal) setPortalFilter(savedPortal);

      const savedPriority = localStorage.getItem("jobpilot_priority_filter");
      if (savedPriority) setPriorityFilter(savedPriority);
    } catch (e) {
      console.warn("Failed to restore search preferences from localStorage:", e);
    }

    // CRITICAL: Delay setting isHydratedRef to true to guarantee that
    // the initial render pass never overwrites restored localStorage data!
    const timer = setTimeout(() => {
      isHydratedRef.current = true;
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  // 2. Persist whenever user modifies search keywords, domains, or filters AFTER hydration
  useEffect(() => {
    if (!isHydratedRef.current) return;
    try {
      if (keywords) localStorage.setItem("jobpilot_search_keywords", keywords);
      localStorage.setItem("jobpilot_selected_domains", JSON.stringify(selectedDomains));
      localStorage.setItem("jobpilot_experience", experience);
      localStorage.setItem("jobpilot_location", location);
      localStorage.setItem("jobpilot_job_type", jobType);
      localStorage.setItem("jobpilot_work_mode", workMode);
      localStorage.setItem("jobpilot_time_window", timeWindow);
      localStorage.setItem("jobpilot_portal_filter", portalFilter);
      localStorage.setItem("jobpilot_priority_filter", priorityFilter);
    } catch (e) {
      console.warn("Failed to save search preferences to localStorage:", e);
    }
  }, [keywords, selectedDomains, experience, location, jobType, workMode, timeWindow, portalFilter, priorityFilter]);

  useEffect(() => {
    loadJobs();

    const applyRunSnapshot = (run: BulkApplyRunData) => {
      setBulkItems(run.items || []);
      const completed = run.completed ?? 0;
      const currentJob = run.current_job;
      const isFinished = run.status === "completed" || run.status === "cancelled";

      // Sync jobs state live with per-item outcomes (applied, skipped_ineligible, failed, expired)
      if (run.items && run.items.length > 0) {
        setJobs((prev) =>
          prev.map((j) => {
            const it = run.items?.find((item) => item.job_id_snapshot === j.id);
            if (!it) return j;
            if (it.status === "applied") {
              return { ...j, application_status: "APPLIED", is_easy_apply: false, apply_mode: "already_applied" };
            } else if (it.status === "skipped_ineligible") {
              const reasons = Array.from(new Set([...(j.eligibility_reasons || []), it.reason].filter(Boolean))) as string[];
              return { ...j, application_status: "MANUAL_APPLY_NEEDED", is_easy_apply: false, apply_mode: "ineligible", eligibility_reasons: reasons };
            } else if (it.status === "failed") {
              const reasons = Array.from(new Set([...(j.eligibility_reasons || []), it.reason].filter(Boolean))) as string[];
              return { ...j, application_status: "MANUAL_APPLY_NEEDED", is_easy_apply: false, apply_mode: "manual_external", eligibility_reasons: reasons };
            } else if (it.status === "skipped_expired") {
              return { ...j, listing_status: "expired", application_status: "REJECTED", is_easy_apply: false, apply_mode: "ineligible" };
            }
            return j;
          })
        );
      }

      setBulkProgress({
        current: isFinished ? run.total_jobs : Math.min(completed + (currentJob ? 1 : 0), run.total_jobs),
        total: run.total_jobs,
        completed,
        title: isFinished ? "All jobs processed" : (currentJob?.title || bulkProgress?.title || ""),
        company: isFinished ? (run.status === "completed" ? "Queue Finished" : "Cancelled") : (currentJob?.company_name || bulkProgress?.company || ""),
        status: isFinished ? "FINISHED" : run.status,
      });

      if (isFinished) {
        setBulkApplying(false);
        if (bulkPollRef.current) {
          clearInterval(bulkPollRef.current);
          bulkPollRef.current = null;
        }
      }
    };

    const onBulkProgress = (e: any) => {
      const detail = e.detail;
      if (!detail) return;
      if (detail.run_id) setBulkRunId(detail.run_id);
      if (detail.items) setBulkItems(detail.items);

      if (detail.status === "FINISHED" || detail.status === "CANCELLED") {
        setBulkApplying(false);
        if (bulkPollRef.current) {
          clearInterval(bulkPollRef.current);
          bulkPollRef.current = null;
        }
        setBulkProgress((prev) => ({
          current: detail.total ?? prev?.total ?? 0,
          total: detail.total ?? prev?.total ?? 0,
          completed: detail.completed ?? detail.total ?? prev?.completed ?? 0,
          title: "All jobs processed",
          company: detail.status === "FINISHED" ? "Queue Finished" : "Cancelled",
          status: "FINISHED",
        }));
        loadJobs();
        if (detail.status === "FINISHED") {
          toast.success(`Bulk Auto-Pilot finished — ${detail.completed ?? detail.total ?? "all"} of ${detail.total || "queued"} jobs processed.`);
        } else {
          toast.info("Bulk Auto-Pilot stopped.");
        }
      } else if (detail.status === "PAUSED_CHALLENGE") {
        setBulkProgress((prev) =>
          prev
            ? {
                ...prev,
                status: "PAUSED_CHALLENGE",
                title: detail.title || prev.title,
                company: detail.company || prev.company,
                message: detail.message || "Bot challenge — complete verification manually",
              }
            : prev
        );
        toast.warning("Bot challenge detected — complete verification in the open tab, then continue.");
      } else if (detail.status === "APPLICATION_RECORDED" || detail.status === "STARTED") {
        if (detail.job_id) {
          setJobs((prev) =>
            prev.map((j) => {
              if (j.id !== detail.job_id) return j;
              if (detail.application_status === "applied") {
                return { ...j, application_status: "APPLIED", is_easy_apply: false, apply_mode: "already_applied" };
              } else if (detail.application_status === "skipped_ineligible") {
                const reasons = Array.from(new Set([...(j.eligibility_reasons || []), detail.reason].filter(Boolean))) as string[];
                return { ...j, application_status: "MANUAL_APPLY_NEEDED", is_easy_apply: false, apply_mode: "ineligible", eligibility_reasons: reasons };
              } else if (detail.application_status === "failed") {
                const reasons = Array.from(new Set([...(j.eligibility_reasons || []), detail.reason].filter(Boolean))) as string[];
                return { ...j, application_status: "MANUAL_APPLY_NEEDED", is_easy_apply: false, apply_mode: "manual_external", eligibility_reasons: reasons };
              } else if (detail.application_status === "skipped_expired") {
                return { ...j, listing_status: "expired", application_status: "REJECTED", is_easy_apply: false, apply_mode: "ineligible" };
              }
              return j;
            })
          );
        }
        setBulkProgress((prev) => ({
          current: detail.current ?? prev?.current ?? 0,
          total: detail.total ?? prev?.total ?? 0,
          completed: detail.completed ?? prev?.completed,
          title: detail.title || detail.job?.title || prev?.title || "",
          company: detail.company || detail.job?.company || prev?.company || "",
          status: detail.application_status || detail.status,
        }));
        if (detail.run_id) {
          getBulkApplyRun(detail.run_id).then(applyRunSnapshot).catch(() => {});
        }
      } else {
        setBulkProgress({
          current: detail.current,
          total: detail.total,
          completed: detail.completed,
          title: detail.job?.title || detail.title || "",
          company: detail.job?.company || detail.company || "",
          status: detail.status,
          message: detail.message,
        });
      }
    };

    const onBulkStarted = (e: any) => {
      setBulkApplying(true);
      if (e.detail?.run_id) {
        setBulkRunId(e.detail.run_id);
        if (bulkPollRef.current) clearInterval(bulkPollRef.current);
        bulkPollRef.current = setInterval(() => {
          getBulkApplyRun(e.detail.run_id)
            .then(applyRunSnapshot)
            .catch(() => {});
        }, 1500);
      }
      toast.info(`Bulk Auto-Pilot started for ${e.detail?.count || 0} jobs`);
    };

    const onNeedsRefreshGlobal = () => {
      setBulkApplying(false);
      setBulkProgress(null);
      toast.custom(
        (t) => (
          <div className="bg-slate-900 border border-amber-500/50 rounded-xl p-3 shadow-2xl flex flex-col gap-2 max-w-sm text-left">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
              <span>⚡</span> JobPilot Copilot Reloaded
            </div>
            <p className="text-slate-300 text-xs leading-relaxed">
              Extension reload hui hai! Please is dashboard tab ko ek baar <b>F5 (Refresh)</b> kare taaki background tabs smoothly open ho sakein!
            </p>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => {
                  toast.dismiss(t);
                  window.location.reload();
                }}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg transition-all"
              >
                🔄 Refresh Page (F5)
              </button>
            </div>
          </div>
        ),
        { duration: 8000 }
      );
    };

    window.addEventListener("JOBPILOT_BULK_PROGRESS", onBulkProgress);
    window.addEventListener("JOBPILOT_BULK_STARTED", onBulkStarted);
    window.addEventListener("JOBPILOT_EXTENSION_NEEDS_REFRESH", onNeedsRefreshGlobal);
    return () => {
      window.removeEventListener("JOBPILOT_BULK_PROGRESS", onBulkProgress);
      window.removeEventListener("JOBPILOT_BULK_STARTED", onBulkStarted);
      window.removeEventListener("JOBPILOT_EXTENSION_NEEDS_REFRESH", onNeedsRefreshGlobal);
      if (bulkPollRef.current) {
        clearInterval(bulkPollRef.current);
        bulkPollRef.current = null;
      }
    };
  }, []);

  async function loadJobs() {
    try {
      setLoading(true);

      // Discovery feed = latest scan only
      const feed = await getLatestDiscoveryFeed({ experience: experience || "Any" });
      const uniqueData = Array.from(new Map((feed.jobs || []).map((j: JobData) => [j.id, j])).values());
      setJobs(uniqueData);
      if (feed.run) {
        setDiscoveryRun(feed.run);
        activeDiscoveryRunIdRef.current = feed.run.id;
        if (feed.run.has_more) {
          setProgressiveInfo({
            page: feed.run.current_page,
            newJobsThisPage: 0,
            totalAdded: feed.run.total_results,
            statusText: `Scan #${feed.run.id} can continue — page ${feed.run.current_page} of up to ${feed.run.max_pages}.`,
            isPausing: false,
            hasMore: true,
            runId: feed.run.id,
          });
        }
      } else {
        setDiscoveryRun(null);
      }

      // Applications tracker = durable warehouse (Applied / Manual / Saved), independent of scan feed
      try {
        const warehouse = await getJobs({});
        const tracked = warehouse.filter((j) =>
          ["APPLIED", "AUTO_APPLIED", "MANUAL_APPLY_NEEDED", "SAVED"].includes(j.application_status)
        );
        setTrackerJobs(Array.from(new Map(tracked.map((j) => [j.id, j])).values()));
      } catch (_) {}

      autoEnrichMissingJobs(uniqueData);
    } catch (err: any) {
      toast.error("Failed to load discovery feed. Make sure Django backend is running.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function autoEnrichMissingJobs(jobList: JobData[]) {
    const missing = jobList.filter(
      (j) =>
        (!j.contact_emails || j.contact_emails.length === 0) &&
        !autoEnrichingIds.current.has(j.id) &&
        (j.company_website || j.company_name)
    );

    if (missing.length === 0) return;

    console.log(`[JobPilot] Automatically crawling company websites for ${missing.length} jobs in background...`);
    const batch = missing.slice(0, 10);
    batch.forEach((j) => {
      autoEnrichingIds.current.add(j.id);
      setActivelyCrawlingIds((prev) => [...prev, j.id]);
      enrichJobContacts(j.id)
        .then((res) => {
          if (res) {
            setJobs((prevJobs) =>
              prevJobs.map((item) =>
                item.id === j.id
                  ? {
                      ...item,
                      contact_emails: res.contact_emails,
                      contact_phones: res.contact_phones,
                      company_website: res.company_website || item.company_website,
                    }
                  : item
              )
            );
          }
        })
        .catch(() => {})
        .finally(() => {
          setActivelyCrawlingIds((prev) => prev.filter((id) => id !== j.id));
        });
    });
  }

  async function handleSyncWithResume() {
    try {
      setIsAutoFilling(true);
      toast.info("Extracting candidate profile & resume filters...");
      const profile = await getProfile();
      if (!profile) {
        toast.error("No profile found.");
        return;
      }

      // 1. Keywords / Target domain / Titles
      let newKeywords = "";
      if (profile.preferences?.target_titles && profile.preferences.target_titles.length > 0) {
        newKeywords = profile.preferences.target_titles[0];
      } else if (profile.title) {
        newKeywords = profile.title;
      } else if (profile.skills && profile.skills.length > 0) {
        newKeywords = profile.skills.slice(0, 3).join(", ");
      }
      if (newKeywords) setKeywords(newKeywords);

      // 2. Location
      let newLocation = "";
      if (profile.preferences?.preferred_locations && profile.preferences.preferred_locations.length > 0) {
        newLocation = profile.preferences.preferred_locations[0];
      } else if (profile.location) {
        newLocation = profile.location;
      }
      if (newLocation) setLocation(newLocation);

      // 3. Experience Level calculation
      const expCount = profile.experience?.length || 0;
      const years = parseFloat(profile.verified_answers?.years_of_experience || "0");
      let detectedTier: "Fresher" | "0-2 Y" | "0-3 Y" | "1-3 Y" | "Junior" | "Mid-Level" | "Senior" | "Lead" = "0-2 Y";
      if (expCount === 0 || years === 0) {
        detectedTier = "0-2 Y";
      } else if (years <= 2) {
        detectedTier = "0-2 Y";
      } else if (years <= 3) {
        detectedTier = "0-3 Y";
      } else if (years <= 5) {
        detectedTier = "Mid-Level";
      } else if (years <= 8) {
        detectedTier = "Senior";
      } else {
        detectedTier = "Lead";
      }
      setExperience(detectedTier);

      // 4. Work Mode
      if (profile.preferences?.work_modes && profile.preferences.work_modes.length > 0) {
        const prefMode = profile.preferences.work_modes[0];
        if (["Remote", "Hybrid", "Onsite"].includes(prefMode)) {
          setWorkMode(prefMode as any);
        }
      }

      toast.success(
        `⚡ Filters synchronized from ${profile.full_name || "Resume"} (${newKeywords || "Profile"}, ${newLocation || "India"}, ${expCount === 0 ? "Fresher" : "Entry-level"})!`
      );
    } catch (err: any) {
      toast.error("Failed to load resume details: " + err.message);
    } finally {
      setIsAutoFilling(false);
    }
  }

  async function handleRunDiscovery(options?: { continueRun?: boolean }) {
    try {
      setDiscovering(true);
      stopProgressiveRef.current = false;
      const continuing = Boolean(options?.continueRun && activeDiscoveryRunIdRef.current);
      let currentPage = continuing ? (discoveryRun?.current_page || 0) + 1 : 1;
      const maxPages = 10;
      let runId: number | null = continuing ? activeDiscoveryRunIdRef.current : null;

      if (!continuing) {
        // Fresh scan replaces the discovery feed
        setJobs([]);
        setDiscoveryRun(null);
        activeDiscoveryRunIdRef.current = null;
        setPortalFilter("all");
        saveToStorage("jobpilot_portal_filter", "all");
        toast.info(`Starting fresh scan for "${keywords}" in ${location}...`);
      } else {
        toast.info(`Continuing scan from page ${currentPage}...`);
      }

      // Auto-crawl a batch of pages, then pause with Continue if more remain
      const pagesThisBatch = continuing ? 3 : 3;

      for (let batch = 0; batch < pagesThisBatch && currentPage <= maxPages && !stopProgressiveRef.current; batch++) {
        setProgressiveInfo({
          page: currentPage,
          newJobsThisPage: 0,
          totalAdded: discoveryRun?.total_results || 0,
          statusText: `Crawling page ${currentPage} on Indeed, Wellfound, Cutshort...`,
          isPausing: false,
          hasMore: true,
          runId,
        });

        const res = await discoverJobs({
          keywords,
          location,
          time_window: timeWindow,
          experience,
          job_type: jobType,
          work_mode: workMode,
          limit,
          page: currentPage,
          discovery_run_id: runId || undefined,
          max_pages: maxPages,
          selected_domains: selectedDomains.filter((d) => d !== "all"),
        });

        if (res.discovery_run_id) {
          runId = res.discovery_run_id;
          activeDiscoveryRunIdRef.current = runId;
        }
        if (res.run) setDiscoveryRun(res.run);

        // Replace feed with full scan results (source of truth = this DiscoveryRun)
        const feedJobs = res.jobs || [];
        setJobs(Array.from(new Map(feedJobs.map((j) => [j.id, j])).values()));
        if (feedJobs.length > 0) autoEnrichMissingJobs(feedJobs);

        const hasMore = Boolean(res.has_more);
        setProgressiveInfo({
          page: currentPage,
          newJobsThisPage: res.page_count || 0,
          totalAdded: res.count || feedJobs.length,
          statusText: hasMore
            ? `Page ${currentPage} done (${res.count || 0} jobs in this scan). More pages available — click Continue Scan.`
            : `Scan complete — ${res.count || 0} jobs from live portals.`,
          isPausing: hasMore,
          hasMore,
          runId,
        });

        if (!hasMore || (res.page_count || 0) === 0) {
          toast.success(`Discovery complete — ${res.count || 0} jobs in this scan.`);
          break;
        }

        if (batch < pagesThisBatch - 1 && hasMore) {
          for (let i = 0; i < 20; i++) {
            if (stopProgressiveRef.current) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          if (stopProgressiveRef.current) {
            toast.info("Scan paused. Click Continue Scan to fetch more pages.");
            break;
          }
          currentPage++;
        } else if (hasMore) {
          toast.info(`Fetched through page ${currentPage}. Click Continue Scan for more portal pages.`);
          break;
        } else {
          break;
        }
      }
    } catch (err: any) {
      toast.error("Discovery error: " + err.message);
    } finally {
      setDiscovering(false);
      // Keep progressiveInfo when has_more so Continue Scan stays visible
    }
  }

  function handleStopDiscovery() {
    stopProgressiveRef.current = true;
    toast.info("Stopping after current page. Use Continue Scan to fetch more.");
  }

  function handleContinueDiscovery() {
    handleRunDiscovery({ continueRun: true });
  }

  async function handleAutoApply(job: JobData) {
    const targetUrl = job.apply_url || job.original_url;

    if (!targetUrl) {
      toast.error("No apply URL found for this job.");
      return;
    }

    let handledByExtension = false;

    const onDispatched = () => {
      handledByExtension = true;
      window.removeEventListener("JOBPILOT_APPLY_DISPATCHED", onDispatched);
      window.removeEventListener("JOBPILOT_EXTENSION_NEEDS_REFRESH", onNeedsRefresh);
      toast.success(`🚀 Auto-Pilot launched for ${job.company_name}! Applying in background tab...`, {
        duration: 4000,
      });
    };

    const onNeedsRefresh = () => {
      handledByExtension = true;
      window.removeEventListener("JOBPILOT_APPLY_DISPATCHED", onDispatched);
      window.removeEventListener("JOBPILOT_EXTENSION_NEEDS_REFRESH", onNeedsRefresh);
      toast.custom(
        (t) => (
          <div className="bg-slate-900 border border-amber-500/50 rounded-xl p-3 shadow-2xl flex flex-col gap-2 max-w-sm text-left">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
              <span>⚡</span> JobPilot Copilot Reloaded
            </div>
            <p className="text-slate-300 text-xs leading-relaxed">
              The Chrome Extension was updated/reloaded. Please refresh (F5) this page once to reconnect background tabs!
            </p>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => {
                  toast.dismiss(t);
                  window.location.reload();
                }}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg transition-all"
              >
                🔄 Refresh Page (F5)
              </button>
              <button
                onClick={() => {
                  toast.dismiss(t);
                  window.open(targetUrl, "_blank");
                }}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-all"
              >
                Open Tab Directly
              </button>
            </div>
          </div>
        ),
        { duration: 8000 }
      );
    };

    window.addEventListener("JOBPILOT_APPLY_DISPATCHED", onDispatched);
    window.addEventListener("JOBPILOT_EXTENSION_NEEDS_REFRESH", onNeedsRefresh);

    // Dispatch background tab event to companion Chrome Extension
    window.dispatchEvent(
      new CustomEvent("JOBPILOT_DISPATCH_APPLY", {
        detail: {
          url: targetUrl,
          jobId: job.id,
          company: job.company_name,
          title: job.title,
        },
      })
    );

    // Fallback: If extension was reloaded or inactive, provide interactive guidance
    setTimeout(() => {
      window.removeEventListener("JOBPILOT_APPLY_DISPATCHED", onDispatched);
      window.removeEventListener("JOBPILOT_EXTENSION_NEEDS_REFRESH", onNeedsRefresh);
      if (!handledByExtension) {
        console.log("[JobPilot Dashboard] Extension bridge did not respond within timeout.");
        toast.custom(
          (t) => (
            <div className="bg-slate-900 border border-indigo-500/40 rounded-xl p-3 shadow-2xl flex flex-col gap-2 max-w-sm text-left">
              <div className="flex items-center gap-2 text-indigo-400 font-semibold text-xs">
                <span>⚡</span> Extension Bridge Waiting
              </div>
              <p className="text-slate-300 text-xs leading-relaxed">
                If you just reloaded the extension in Chrome, press <b>F5</b> to refresh this dashboard so it can open background tabs.
              </p>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => {
                    toast.dismiss(t);
                    window.location.reload();
                  }}
                  className="px-3 py-1 bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-xs rounded-lg transition-all"
                >
                  🔄 Refresh Dashboard
                </button>
                <button
                  onClick={() => {
                    toast.dismiss(t);
                    window.open(targetUrl, "_blank");
                  }}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-all"
                >
                  Open Job Tab
                </button>
              </div>
            </div>
          ),
          { duration: 8000 }
        );
      }
    }, 450);
  }

  // Gallery-Style Job Selection Handlers
  function handleToggleJobSelect(jobId: number, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    setSelectedJobIds((prev) =>
      prev.includes(jobId) ? prev.filter((id) => id !== jobId) : [...prev, jobId]
    );
  }

  function handleToggleSelectAll() {
    const eligibleFilteredIds = filteredJobs
      .filter(
        (j) =>
          j.application_status !== "APPLIED" &&
          j.application_status !== "AUTO_APPLIED" &&
          j.is_easy_apply &&
          j.application_status !== "MANUAL_APPLY_NEEDED"
      )
      .map((j) => j.id);

    const areAllSelected =
      eligibleFilteredIds.length > 0 &&
      eligibleFilteredIds.every((id) => selectedJobIds.includes(id));

    if (areAllSelected) {
      setSelectedJobIds((prev) => prev.filter((id) => !eligibleFilteredIds.includes(id)));
    } else {
      setSelectedJobIds((prev) => Array.from(new Set([...prev, ...eligibleFilteredIds])));
    }
  }

  // Action 1: Sequential Bulk Auto Apply (with Strict Ineligibility Restriction)
  function handleTriggerBulkAutoApply() {
    const selectedJobsList = jobs.filter((j) => selectedJobIds.includes(j.id));
    const ineligibleJobs = selectedJobsList.filter((j) => !isOneClickReady(j));
    const eligibleJobs = selectedJobsList.filter((j) => isOneClickReady(j));

    if (ineligibleJobs.length > 0) {
      toast.error(
        `Bulk Auto Apply is restricted: ${ineligibleJobs.length} selected job(s) cannot be auto-applied because they are either already applied or require manual external application. Click 'Select Only Eligible' to proceed.`
      );
      return;
    }

    if (eligibleJobs.length === 0) {
      toast.error(
        "None of the selected jobs support 1-Click Auto-Apply."
      );
      return;
    }

    const queue = eligibleJobs.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company_name,
      url: j.apply_url || j.original_url,
    }));

    let confirmed = false;
    const confirmHandler = () => {
      confirmed = true;
      window.removeEventListener("JOBPILOT_BULK_STARTED", confirmHandler);
    };
    window.addEventListener("JOBPILOT_BULK_STARTED", confirmHandler);

    setBulkApplying(true);
    setBulkItems(
      queue.map((j, idx) => ({
        id: idx,
        job_id_snapshot: j.id,
        title: j.title,
        company_name: j.company,
        url: j.url,
        position: idx,
        status: "queued" as const,
        reason: "",
        updated_at: new Date().toISOString(),
      }))
    );
    setBulkProgress({
      current: 0,
      total: queue.length,
      completed: 0,
      title: queue[0].title,
      company: queue[0].company,
      status: "PROCESSING",
    });

    window.dispatchEvent(
      new CustomEvent("JOBPILOT_BULK_APPLY", {
        detail: { queue, experience_filter: experience },
      })
    );

    setTimeout(() => {
      window.removeEventListener("JOBPILOT_BULK_STARTED", confirmHandler);
      if (!confirmed) {
        console.warn("[JobPilot Dashboard] Extension bridge did not confirm bulk start.");
        setBulkApplying(false);
        setBulkProgress(null);
        toast.custom(
          (t) => (
            <div className="bg-slate-900 border border-amber-500/50 rounded-xl p-3 shadow-2xl flex flex-col gap-2 max-w-sm text-left">
              <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
                <span>⚡</span> Extension Reconnect Required
              </div>
              <p className="text-slate-300 text-xs leading-relaxed">
                Tab isliye open nahi hua kyuki extension update ke baad dashboard reconnect nahi hua. Please is page ko <b>F5 (Refresh)</b> kare!
              </p>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => {
                    toast.dismiss(t);
                    window.location.reload();
                  }}
                  className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg transition-all"
                >
                  🔄 Refresh Dashboard (F5)
                </button>
              </div>
            </div>
          ),
          { duration: 8000 }
        );
      }
    }, 2500);
  }

  function handleCancelBulkAutoApply() {
    window.dispatchEvent(new CustomEvent("JOBPILOT_CANCEL_BULK_APPLY"));
    setBulkApplying(false);
    setBulkProgress(null);
    setBulkRunId(null);
    setBulkItems([]);
    if (bulkPollRef.current) {
      clearInterval(bulkPollRef.current);
      bulkPollRef.current = null;
    }
    toast.info("Stop Auto-Pilot — queue cleared.");
    loadJobs();
  }

  // One-click helper: auto-selects only eligible unapplied auto-apply jobs
  function handleSelectOnlyEligible() {
    const eligible = jobs
      .filter((j) => selectedJobIds.includes(j.id))
      .filter((j) => isOneClickReady(j));
    setSelectedJobIds(eligible.map((j) => j.id));
    toast.success(`Selection updated to ${eligible.length} eligible job(s)!`);
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

  // Step 1: Base eligibility (Experience level, Posting Date Horizon, Search query)
  const baseEligibleJobs = jobs.filter((job) => {
    // Experience Level Filter
    if (experience && experience !== "Any") {
      const expLevel = (job.experience_level || "").toLowerCase();
      const targetExp = experience.toLowerCase();
      const titleLower = (job.title || "").toLowerCase();
      const descLower = (job.description || "").toLowerCase();

      const isLead = /\b(lead|principal|staff|architect|manager|director|head of|vp)\b/i.test(titleLower) || expLevel.includes("lead");
      const isSenior = /\b(senior|sr\.|sr\b|sde[- /]?(?:3|iii))\b/i.test(titleLower) || expLevel.includes("senior");
      const isMid = /\b(sde[- /]?(?:2|ii)|mid[- ]level|experienced)\b/i.test(titleLower) || expLevel.includes("mid");
      const isJuniorOrFresher = expLevel.includes("fresher") || expLevel.includes("entry") || expLevel.includes("junior") || expLevel.includes("intern");

      const notesLower = (job.notes || "").toLowerCase();
      const has4PlusYears = (
        /\b([4-9]|\d{2,})\+?\s*(?:years?|yrs?|y\b)/i.test(titleLower) ||
        /\b([4-9]|\d{2,})\+?\s*(?:years?|yrs?|y\b)/i.test(expLevel) ||
        notesLower.includes("4+ years") ||
        notesLower.includes("5+ years") ||
        descLower.includes("4+ years") ||
        descLower.includes("5+ years") ||
        descLower.includes("4-7 years") ||
        descLower.includes("5-8 years")
      );

      if (targetExp === "fresher") {
        if (isLead || isSenior || has4PlusYears) return false;
        if (job.min_years_required && job.min_years_required > 1) return false;
        if (/\b([2-9]|\d{2,})\+?\s*(?:years?|yrs?|y\b)/i.test(titleLower)) return false;
        if (!expLevel.includes("fresher") && !expLevel.includes("entry") && !expLevel.includes("intern") && !titleLower.includes("intern")) return false;
      } else if (targetExp === "0-2 y" || targetExp === "0-2") {
        if (isLead || isSenior || has4PlusYears) return false;
        if (job.min_years_required && job.min_years_required > 2) return false;
        if (/\b([3-9]|\d{2,})\+?\s*(?:years?|yrs?|y\b)/i.test(titleLower)) return false;
      } else if (targetExp === "0-3 y" || targetExp === "0-3") {
        if (isLead || isSenior || has4PlusYears) return false;
        if (job.min_years_required && job.min_years_required > 3) return false;
        if (/\b([4-9]|\d{2,})\+?\s*(?:years?|yrs?|y\b)/i.test(titleLower)) return false;
      } else if (targetExp === "1-3 y" || targetExp === "1-3") {
        if (isLead || isSenior || has4PlusYears) return false;
        if (job.min_years_required && job.min_years_required > 3) return false;
        if (/\b([4-9]|\d{2,})\+?\s*(?:years?|yrs?|y\b)/i.test(titleLower)) return false;
        if (expLevel.includes("fresher") && !job.min_years_required) return false;
      } else if (targetExp === "junior") {
        if (isLead || isSenior || has4PlusYears) return false;
        if (job.min_years_required && job.min_years_required > 3) return false;
        if (/\b([4-9]|\d{2,})\+?\s*(?:years?|yrs?|y\b)/i.test(titleLower)) return false;
        if (expLevel.includes("senior") || expLevel.includes("lead")) return false;
      } else if (targetExp === "mid-level" || targetExp === "mid") {
        if (isLead) return false;
        if (expLevel.includes("fresher") && !isMid) return false;
        if (!isMid && !expLevel.includes("junior") && !expLevel.includes("senior")) return false;
      } else if (targetExp === "senior") {
        if (expLevel.includes("fresher")) return false;
        if (!isSenior && !isLead && !isMid) return false;
      } else if (targetExp === "lead") {
        if (expLevel.includes("fresher") || expLevel.includes("junior")) return false;
        if (!isLead && !isSenior) return false;
      }
    }

    // Timeline / Posting Date Horizon Filter
    if (timeWindow && timeWindow !== "all") {
      if (!job.posted_at) return false;
      const postedTime = new Date(job.posted_at).getTime();
      const now = Date.now();
      if (isNaN(postedTime)) return false;
      if (timeWindow === "24h" && now - postedTime > 24 * 60 * 60 * 1000) return false;
      if (timeWindow === "7d" && now - postedTime > 7 * 24 * 60 * 60 * 1000) return false;
      if (timeWindow === "14d" && now - postedTime > 14 * 24 * 60 * 60 * 1000) return false;
    }

    // Job Type Filter
    if (jobType && jobType !== "all") {
      const jt = (job.job_type || "").toLowerCase();
      const targetJt = jobType.toLowerCase();
      const titleLower = (job.title || "").toLowerCase();
      if (targetJt === "internship") {
        if (!jt.includes("intern") && !titleLower.includes("intern")) return false;
      } else if (targetJt === "full-time") {
        if (jt.includes("intern") || titleLower.includes("intern")) return false;
        if (jt && !jt.includes("full")) return false;
      } else if (targetJt === "contract") {
        if (!jt.includes("contract") && !titleLower.includes("contract")) return false;
      } else if (targetJt === "part-time") {
        if (!jt.includes("part") && !titleLower.includes("part")) return false;
      }
    }

    // Work Mode Filter
    if (workMode && workMode !== "all") {
      const wm = (job.work_mode || "").toLowerCase();
      const targetWm = workMode.toLowerCase();
      const titleLower = (job.title || "").toLowerCase();
      const locs = (job.locations || []).map((l) => l.toLowerCase()).join(" ");

      if (targetWm === "remote") {
        const isRemote = wm.includes("remote") || titleLower.includes("remote") || locs.includes("remote");
        if (!isRemote) return false;
      } else if (targetWm === "hybrid") {
        const isHybrid = wm.includes("hybrid") || titleLower.includes("hybrid") || locs.includes("hybrid");
        if (!isHybrid) return false;
      } else if (targetWm === "onsite") {
        const isOnsite = wm.includes("onsite") || wm.includes("on-site") || (!wm.includes("remote") && !wm.includes("hybrid"));
        if (!isOnsite) return false;
      }
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = job.title.toLowerCase().includes(q);
      const matchComp = job.company_name.toLowerCase().includes(q);
      const matchDesc = job.description.toLowerCase().includes(q);
      if (!matchTitle && !matchComp && !matchDesc) return false;
    }
    return true;
  });

  // Multi-Domain Selection Toggle Helper
  const toggleDomain = (key: string) => {
    let next: string[];
    if (key === "all") {
      next = [];
    } else {
      if (selectedDomains.includes(key)) {
        next = selectedDomains.filter((d) => d !== key);
      } else {
        next = [...selectedDomains.filter((d) => d !== "all"), key];
      }
    }
    setSelectedDomains(next);
    saveToStorage("jobpilot_selected_domains", JSON.stringify(next));
  };

  // Quick Preset Selection Helper with Automatic Domain Synchronization
  const handleSelectPreset = (preset: string) => {
    setKeywords(preset);
    saveToStorage("jobpilot_search_keywords", preset);

    const presetLower = preset.toLowerCase();
    let domainTag: string | null = null;
    if (presetLower.includes("ai") || presetLower.includes("ml") || presetLower.includes("data science")) {
      domainTag = "aiml";
    } else if (presetLower.includes("backend") || presetLower.includes("django")) {
      domainTag = "backend";
    } else if (presetLower.includes("react") || presetLower.includes("frontend")) {
      domainTag = "frontend";
    } else if (presetLower.includes("full stack") || presetLower.includes("fullstack")) {
      domainTag = "fullstack";
    }

    if (domainTag) {
      setSelectedDomains([domainTag]);
      saveToStorage("jobpilot_selected_domains", JSON.stringify([domainTag]));
    }
  };

  // Step 2: Unique company options & company-scoped jobs
  const availableCompanies = Array.from(
    new Set(baseEligibleJobs.map((j) => j.company_name).filter(Boolean))
  ).sort();

  const companyScopedJobs = companyFilter === "ALL"
    ? baseEligibleJobs
    : baseEligibleJobs.filter((j) => j.company_name?.toLowerCase() === companyFilter.toLowerCase());

  // Step 3: Portal-filtered jobs (within companyScopedJobs)
  const portalEligibleJobs = portalFilter === "all"
    ? companyScopedJobs
    : companyScopedJobs.filter((j) => j.portal_source === portalFilter);

  // Step 4: Multi-Domain filtered jobs (within portalEligibleJobs)
  const domainEligibleJobs = selectedDomains.length === 0 || selectedDomains.includes("all")
    ? portalEligibleJobs
    : portalEligibleJobs.filter((j) => {
        const jDomains = j.semantic_domains || [];
        return selectedDomains.some((d) => jDomains.includes(d));
      });

  // Step 5: Application Category filter (All | Applied | Unapplied | 1-Click Auto Apply | Manual Apply)
  const categoryEligibleJobs = domainEligibleJobs.filter((job) => {
    const isApplied = job.application_status === "APPLIED" || job.application_status === "AUTO_APPLIED";
    if (categoryFilter === "APPLIED") return isApplied;
    if (categoryFilter === "UNAPPLIED") return !isApplied;
    if (categoryFilter === "AUTO_APPLY") {
      return !isApplied && isOneClickReady(job);
    }
    if (categoryFilter === "MANUAL_APPLY") {
      return !isApplied && !isOneClickReady(job) && job.apply_mode !== "already_applied";
    }
    return true; // "ALL"
  });

  // Step 6: Final filtered jobs (matching priority and application status)
  const rawFilteredJobs = categoryEligibleJobs.filter((job) => {
    if (priorityFilter !== "ALL" && job.priority_rank !== priorityFilter) return false;
    if (statusFilter !== "ALL" && job.application_status !== statusFilter) return false;
    return true;
  });

  // Deduplicate by unique job.id to guarantee strictly unique React children keys
  const filteredJobs = Array.from(
    new Map(rawFilteredJobs.map((j) => [j.id, j])).values()
  );

  // Filtered jobs that are unapplied and eligible for 1-Click Auto Apply
  const eligibleFilteredJobs = filteredJobs.filter((j) => isOneClickReady(j));
  const areAllEligibleSelected =
    eligibleFilteredJobs.length > 0 &&
    eligibleFilteredJobs.every((j) => selectedJobIds.includes(j.id));

  // Bulk Selection Eligibility Analysis
  const selectedJobsList = jobs.filter((j) => selectedJobIds.includes(j.id));
  const ineligibleJobs = selectedJobsList.filter((j) => !isOneClickReady(j));
  const eligibleJobs = selectedJobsList.filter((j) => isOneClickReady(j));
  const hasIneligibleSelection = ineligibleJobs.length > 0;

  // Tracked Applications Aggregations
  const trackedJobs = trackerJobs.filter((j) =>
    ["AUTO_APPLIED", "APPLIED", "MANUAL_APPLY_NEEDED", "SAVED"].includes(j.application_status)
  );
  const totalAppliedCount = trackerJobs.filter((j) =>
    ["AUTO_APPLIED", "APPLIED"].includes(j.application_status)
  ).length;
  const autoAppliedCount = trackerJobs.filter((j) => j.application_status === "AUTO_APPLIED").length;
  const manualAppliedCount = trackerJobs.filter((j) => j.application_status === "APPLIED").length;
  const manualNeededCount = trackerJobs.filter((j) => j.application_status === "MANUAL_APPLY_NEEDED").length;
  const savedCount = trackerJobs.filter((j) => j.application_status === "SAVED").length;

  const filteredApplications = trackedJobs.filter((job) => {
    if (applicationsSubFilter === "APPLIED_ALL") {
      if (job.application_status !== "AUTO_APPLIED" && job.application_status !== "APPLIED") return false;
    } else if (applicationsSubFilter !== "ALL") {
      if (job.application_status !== applicationsSubFilter) return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = job.title.toLowerCase().includes(q);
      const matchComp = job.company_name.toLowerCase().includes(q);
      if (!matchTitle && !matchComp) return false;
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

          <Link href="/companies">
            <Button
              variant="outline"
              className="border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 flex items-center gap-1.5 text-xs shadow-2xs font-semibold"
            >
              <Building className="w-3.5 h-3.5 text-indigo-600" />
              Company Directory ({Array.from(new Set(jobs.map((j) => j.company_name))).length})
            </Button>
          </Link>

          <Button
            onClick={() => handleRunDiscovery()}
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

      {/* View Mode Navigation Switcher: Job Discovery Feed vs My Applications Tracker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveMainTab("discover")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all ${
              activeMainTab === "discover"
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Briefcase className="w-4 h-4 text-indigo-400" />
            <span>Job Discovery Feed</span>
            <span
              className={`ml-1 px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                activeMainTab === "discover"
                  ? "bg-slate-800 text-indigo-200"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {filteredJobs.length}
            </span>
          </button>

          <button
            onClick={() => setActiveMainTab("my_applications")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all ${
              activeMainTab === "my_applications"
                ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/20"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <CheckSquare className="w-4 h-4 text-emerald-300" />
            <span>My Applications</span>
            <span
              className={`ml-1 px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                activeMainTab === "my_applications"
                  ? "bg-emerald-800 text-emerald-100"
                  : totalAppliedCount > 0
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {totalAppliedCount} applied
            </span>
          </button>
        </div>

        {activeMainTab === "my_applications" ? (
          <div className="flex items-center gap-3 text-xs text-slate-500 pr-2">
            <span>
              Total Tracked: <b className="text-slate-800 font-semibold">{trackedJobs.length}</b> opportunities
            </span>
            <span>•</span>
            <span className="text-emerald-700 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              {totalAppliedCount} Submitted
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs text-slate-500 pr-2">
            <span>
              Active In Feed: <b className="text-slate-800 font-semibold">{filteredJobs.length}</b> jobs
            </span>
            {totalAppliedCount > 0 && (
              <button
                onClick={() => setActiveMainTab("my_applications")}
                className="text-emerald-600 hover:text-emerald-800 font-semibold hover:underline flex items-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                View {totalAppliedCount} Applied Jobs →
              </button>
            )}
          </div>
        )}
      </div>

      {activeMainTab === "discover" ? (
        <>
          {/* Advanced Filter Panel */}
          {filtersOpen && (
        <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50/40 via-white to-slate-50 shadow-sm">
          <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2 text-slate-900">
                <Filter className="w-4 h-4 text-indigo-600" />
                Advanced Discovery Configuration
              </CardTitle>
              <CardDescription className="text-xs">
                Configure date range, domain, location, work mode, and experience to crawl and filter fresh opportunities.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncWithResume}
              disabled={isAutoFilling}
              className="text-xs bg-indigo-50/80 border-indigo-200 text-indigo-700 hover:bg-indigo-100 flex items-center gap-1.5 shadow-2xs font-medium cursor-pointer self-start sm:self-auto"
            >
              {isAutoFilling ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  Syncing Resume...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  ⚡ Auto-Fill from Resume
                </>
              )}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {/* Domain / Keywords */}
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-1 xl:col-span-1">
                <label className="text-xs font-semibold text-slate-700">Domain / Keywords</label>
                <Input
                  value={keywords}
                  onChange={(e) => {
                    setKeywords(e.target.value);
                    saveToStorage("jobpilot_search_keywords", e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRunDiscovery();
                  }}
                  placeholder="e.g. AI/ML, Python Full Stack"
                  className="bg-white h-9 text-xs"
                />
              </div>

              {/* Location */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Location</label>
                <Input
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    saveToStorage("jobpilot_location", e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRunDiscovery();
                  }}
                  placeholder="e.g. India, Remote"
                  className="bg-white h-9 text-xs"
                />
              </div>

              {/* Posting Date / Freshness */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Posting Date Horizon</label>
                <select
                  value={timeWindow}
                  onChange={(e) => {
                    const v = e.target.value as any;
                    setTimeWindow(v);
                    saveToStorage("jobpilot_time_window", v);
                  }}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">🌐 All Available</option>
                  <option value="24h">🔥 Last 24 Hours</option>
                  <option value="7d">📅 Last 7 Days</option>
                  <option value="14d">🗓️ Last 14 Days</option>
                </select>
              </div>

              {/* Experience Level */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Experience Level</label>
                <select
                  value={experience}
                  onChange={(e) => {
                    const v = e.target.value as any;
                    setExperience(v);
                    saveToStorage("jobpilot_experience", v);
                  }}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Any">✨ Any Experience (Show All Jobs)</option>
                  <option value="0-2 Y">🚀 0 - 2 Years (Fresher & Junior)</option>
                  <option value="0-3 Y">🎯 0 - 3 Years (Fresher to SDE-1)</option>
                  <option value="Fresher">🌱 Fresher Only (0-1 Y)</option>
                  <option value="1-3 Y">⚡ 1 - 3 Years (Associate)</option>
                  <option value="Mid-Level">💼 3 - 5 Years (Mid-Level)</option>
                  <option value="Senior">🏆 5 - 8 Years (Senior)</option>
                  <option value="Lead">👑 8+ Years (Lead / Architect)</option>
                </select>
              </div>

              {/* Work Mode */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Work Mode</label>
                <select
                  value={workMode}
                  onChange={(e) => {
                    const v = e.target.value as any;
                    setWorkMode(v);
                    saveToStorage("jobpilot_work_mode", v);
                  }}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">🏢 All Work Modes</option>
                  <option value="Remote">🏠 Remote Only</option>
                  <option value="Hybrid">🔄 Hybrid</option>
                  <option value="Onsite">🏢 On-site / Office</option>
                </select>
              </div>

              {/* Job Type */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Job Type</label>
                <select
                  value={jobType}
                  onChange={(e) => {
                    const v = e.target.value as any;
                    setJobType(v);
                    saveToStorage("jobpilot_job_type", v);
                  }}
                  className="w-full h-9 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">💼 All Job Types</option>
                  <option value="Full-time">🎯 Full-time</option>
                  <option value="Internship">🎓 Internship</option>
                  <option value="Contract">📝 Contract</option>
                  <option value="Part-time">⏱️ Part-time</option>
                </select>
              </div>
            </div>

            {/* Quick Domain Suggestions */}
            <div className="pt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Quick Presets:</span>
              {[
                "AI / ML Engineer",
                "Python Full Stack",
                "React / Next.js Developer",
                "Data Science / AI",
                "Backend Engineer (Django)",
                "Frontend Engineer",
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    keywords === preset
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-xs font-semibold"
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

      {/* Progressive Multi-Page Scraping Live Banner */}
      {(discovering || progressiveInfo) && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-gradient-to-r from-indigo-50 via-sky-50 to-white border border-indigo-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
              {discovering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : progressiveInfo?.hasMore ? (
                <Clock className="w-4 h-4" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-900">
                  {discovering
                    ? "Live portal scan in progress"
                    : progressiveInfo?.hasMore
                    ? "More portal pages available"
                    : "Scan finished"}
                </span>
                {progressiveInfo && (
                  <span className="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    Page {progressiveInfo.page}
                  </span>
                )}
                {discoveryRun && (
                  <span className="bg-slate-200 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    Scan #{discoveryRun.id}
                  </span>
                )}
                {(progressiveInfo?.totalAdded || 0) > 0 && (
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {progressiveInfo?.totalAdded} jobs in this scan
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                {progressiveInfo?.statusText || "Crawling Indeed, Wellfound, Cutshort with your filters…"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center">
            {progressiveInfo?.hasMore && !discovering && (
              <Button
                size="sm"
                onClick={handleContinueDiscovery}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
              >
                Continue Scan
              </Button>
            )}
            {discovering ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStopDiscovery}
                className="text-xs text-rose-600 border-rose-200 bg-white hover:bg-rose-50 font-semibold"
              >
                Stop after page
              </Button>
            ) : progressiveInfo && !progressiveInfo.hasMore ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setProgressiveInfo(null)}
                className="text-xs text-slate-500"
              >
                Dismiss
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {/* 1. SEPARATE PORTAL FILTER TABS */}
      <div className="p-1.5 bg-slate-100/90 rounded-2xl flex flex-wrap gap-1.5 border border-slate-200">
        {[
          { key: "all", label: "All Portals", count: baseEligibleJobs.length },
          { key: "indeed", label: "Indeed India", count: baseEligibleJobs.filter((j) => j.portal_source === "indeed").length },
          { key: "wellfound", label: "Wellfound", count: baseEligibleJobs.filter((j) => j.portal_source === "wellfound").length },
          { key: "cutshort", label: "Cutshort", count: baseEligibleJobs.filter((j) => j.portal_source === "cutshort").length },
          { key: "ats_direct", label: "Direct ATS", count: baseEligibleJobs.filter((j) => j.portal_source === "ats_direct").length },
        ].map((tab) => {
          const isSelected = portalFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setPortalFilter(tab.key);
                saveToStorage("jobpilot_portal_filter", tab.key);
              }}
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

      {/* 2. SEMANTIC DOMAIN MATCHING SELECTOR (MULTI-DOMAIN SUPPORT) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            <Brain className="w-4 h-4 text-purple-600" />
            <span>Semantic Domain Matching (Multi-Select Enabled)</span>
            {selectedDomains.length > 0 && !selectedDomains.includes("all") && (
              <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {selectedDomains.length} domains active
              </span>
            )}
          </div>
          {selectedDomains.length > 0 && !selectedDomains.includes("all") && (
            <button
              onClick={() => setSelectedDomains([])}
              className="text-xs text-indigo-600 hover:underline font-semibold flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
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
            const isSelected = pill.key === "all"
              ? selectedDomains.length === 0 || selectedDomains.includes("all")
              : selectedDomains.includes(pill.key);

            const count =
              pill.key === "all"
                ? portalEligibleJobs.length
                : portalEligibleJobs.filter((j) => (j.semantic_domains || []).includes(pill.key)).length;

            return (
              <button
                key={pill.key}
                onClick={() => toggleDomain(pill.key)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border transition-all ${
                  isSelected
                    ? "bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-600/20 font-bold"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300"
                }`}
              >
                {isSelected && pill.key !== "all" ? (
                  <Check className="w-3.5 h-3.5 text-white" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
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

      {/* Unified Pipeline Navigation & Filter Control Center */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-3 shadow-xs transition-colors">
        {/* Tier 1: Category Pipeline Tabs (Guaranteed Single Horizontal Line) */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 border-b border-slate-100 dark:border-slate-800 pb-3">
          {[
            { id: "ALL", label: "All Opportunities", count: domainEligibleJobs.length, icon: Briefcase, activeClass: "bg-indigo-600 text-white" },
            { id: "APPLIED", label: "Applied", count: domainEligibleJobs.filter((j) => j.application_status === "APPLIED" || j.application_status === "AUTO_APPLIED").length, icon: CheckCircle2, activeClass: "bg-emerald-600 text-white" },
            { id: "UNAPPLIED", label: "Unapplied", count: domainEligibleJobs.filter((j) => j.application_status !== "APPLIED" && j.application_status !== "AUTO_APPLIED").length, icon: Clock, activeClass: "bg-sky-600 text-white" },
            { id: "AUTO_APPLY", label: "1-Click Auto Apply", count: domainEligibleJobs.filter((j) => isOneClickReady(j)).length, icon: Zap, activeClass: "bg-amber-600 text-white" },
            { id: "MANUAL_APPLY", label: "Manual Apply", count: domainEligibleJobs.filter((j) => !isOneClickReady(j) && j.application_status !== "APPLIED" && j.application_status !== "AUTO_APPLIED").length, icon: ExternalLink, activeClass: "bg-slate-800 dark:bg-slate-700 text-white" },
          ].map((cat) => {
            const Icon = cat.icon;
            const isSelected = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id as any)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  isSelected
                    ? `${cat.activeClass} shadow-xs font-bold`
                    : "bg-slate-100/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 hover:bg-slate-200/80 dark:hover:bg-slate-700/80 border border-slate-200/50 dark:border-slate-700/50"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{cat.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    isSelected ? "bg-white/20 text-white" : "bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-xs"
                  }`}
                >
                  {cat.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Tier 2: Priority Filter Chips + Company Scoper + Search Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-0.5">
          {/* Left: Priority Filter Segmented Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
            <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-1 shrink-0">Priority:</span>
            {[
              { id: "ALL", label: "All", count: domainEligibleJobs.length },
              { id: "HIGH", label: "🔥 High", count: domainEligibleJobs.filter((j) => j.priority_rank === "HIGH").length },
              { id: "MEDIUM", label: "⚡ Medium", count: domainEligibleJobs.filter((j) => j.priority_rank === "MEDIUM").length },
              { id: "LOW", label: "Low", count: domainEligibleJobs.filter((j) => j.priority_rank === "LOW").length },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setPriorityFilter(tab.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  priorityFilter === tab.id
                    ? "bg-slate-900 text-white dark:bg-indigo-600 shadow-xs"
                    : "bg-slate-100/70 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 border border-transparent"
                }`}
              >
                {tab.label} {tab.count !== undefined && <span className="opacity-80">({tab.count})</span>}
              </button>
            ))}
          </div>

          {/* Right: Company Dropdown & Search Input */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            {/* Company Selector */}
            <div className="flex items-center gap-1.5 shrink-0 max-w-[200px] sm:max-w-[240px]">
              <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="h-8 w-full px-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 truncate"
              >
                <option value="ALL">All Companies ({availableCompanies.length})</option>
                {availableCompanies.map((comp) => (
                  <option key={comp} value={comp}>
                    {comp}
                  </option>
                ))}
              </select>
              {companyFilter !== "ALL" && (
                <button
                  onClick={() => setCompanyFilter("ALL")}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-semibold shrink-0"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Live Search */}
            <div className="relative flex-1 md:w-60 shrink-0">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search job or skill..."
                className="pl-8 h-8 bg-slate-50 dark:bg-slate-800 text-xs dark:border-slate-700"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Active Filter Info Strip */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1 py-1">
        <span>
          Showing <b className="text-slate-800 dark:text-slate-200 font-semibold">{filteredJobs.length}</b> {filteredJobs.length === 1 ? "job" : "jobs"}
          {baseEligibleJobs.length < jobs.length && (
            <span> (filtered from {jobs.length} total in database)</span>
          )}
        </span>
        {(timeWindow !== "all" || experience !== "Any" || portalFilter !== "all" || selectedDomains.length > 0 || priorityFilter !== "ALL" || statusFilter !== "ALL" || companyFilter !== "ALL" || categoryFilter !== "ALL") && (
          <button
            onClick={() => {
              setTimeWindow("all");
              setExperience("Any");
              setPortalFilter("all");
              setSelectedDomains([]);
              setPriorityFilter("ALL");
              setStatusFilter("ALL");
              setCompanyFilter("ALL");
              setCategoryFilter("ALL");
            }}
            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium hover:underline text-xs"
          >
            Reset all filters (show all {jobs.length} jobs)
          </button>
        )}
      </div>

      {/* Gallery-Style Selection & Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs transition-colors">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleSelectAll}
            disabled={eligibleFilteredJobs.length === 0}
            className={`text-xs flex items-center gap-2 font-medium h-8 ${
              areAllEligibleSelected
                ? "border-indigo-500 text-indigo-700 dark:text-indigo-300 bg-indigo-50/80 dark:bg-indigo-950/50 font-semibold"
                : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            }`}
          >
            <CheckCircle2
              className={`w-4 h-4 ${
                areAllEligibleSelected
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-slate-400"
              }`}
            />
            <span>
              {areAllEligibleSelected
                ? "Deselect All"
                : `Select All (${eligibleFilteredJobs.length})`}
            </span>
          </Button>

          {selectedJobIds.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-indigo-900 dark:text-indigo-200 bg-indigo-100/70 dark:bg-indigo-950/70 px-2.5 py-0.5 rounded-full">
                {selectedJobIds.length} of {filteredJobs.length} selected
              </span>
              <button
                onClick={() => setSelectedJobIds([])}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 underline text-xs"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Action Controls: Auto Apply & Stop Button (Strictly Disallows Ineligible Jobs) */}
        {(selectedJobIds.length > 0 || bulkApplying) && (
          <div className="flex flex-wrap items-center gap-2.5">
            {hasIneligibleSelection && !bulkApplying && (
              <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-300">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  {ineligibleJobs.length} selected cannot be auto-applied (already applied or manual).
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSelectOnlyEligible}
                  className="h-6 px-2 text-[11px] font-bold border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/60 hover:bg-amber-200 text-amber-900 dark:text-amber-100"
                >
                  Select Only Eligible ({eligibleJobs.length})
                </Button>
              </div>
            )}

            <Button
              size="sm"
              onClick={handleTriggerBulkAutoApply}
              disabled={bulkApplying || hasIneligibleSelection || eligibleJobs.length === 0}
              className={`text-white font-semibold text-xs h-8 flex items-center gap-1.5 shadow-xs transition-all ${
                bulkApplying
                  ? "bg-emerald-700/80 cursor-not-allowed"
                  : hasIneligibleSelection
                  ? "bg-slate-400 dark:bg-slate-700 cursor-not-allowed opacity-60"
                  : "bg-emerald-600 hover:bg-emerald-700"
              }`}
              title={
                hasIneligibleSelection
                  ? "Deselect ineligible or already applied jobs before auto-applying"
                  : "1-Click Sequential Auto-Apply for selected jobs"
              }
            >
              <Zap className={`w-3.5 h-3.5 text-amber-200 ${bulkApplying ? "animate-pulse" : ""}`} />
              {bulkApplying
                ? "Auto Apply in Progress..."
                : `Auto Apply (${eligibleJobs.length})`}
            </Button>

            {/* Prominent Stop / Abort Button */}
            {bulkApplying && (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleCancelBulkAutoApply}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-8 px-3 flex items-center gap-1.5 shadow-md shadow-rose-600/30 animate-pulse transition-all hover:scale-105"
                title="Stop current running queue and unlock selection immediately"
              >
                <StopCircle className="w-3.5 h-3.5 text-white" />
                Stop Auto-Pilot
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Jobs Grid / Feed */}
      {loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
          <p className="text-sm text-slate-500 font-medium">Loading discovered jobs...</p>
        </div>
      ) : filteredJobs.length === 0 ? (
        <Card className="border-dashed border-2 p-12 text-center space-y-3 bg-white dark:bg-slate-900 dark:border-slate-800">
          <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">No jobs matching your filter</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            Click &quot;Scan &amp; Discover Now&quot; above to search live portals for fresh matching openings.
          </p>
          <Button onClick={() => handleRunDiscovery()} className="mt-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs">
            Run Discovery Now
          </Button>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs transition-colors">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse table-fixed min-w-[1060px]">
              <thead>
                <tr className="bg-slate-50/90 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-semibold tracking-wider uppercase text-[11px]">
                  <th className="py-3 px-2 w-[38px] text-center shrink-0">
                    <input
                      type="checkbox"
                      checked={areAllEligibleSelected}
                      disabled={eligibleFilteredJobs.length === 0}
                      onChange={handleToggleSelectAll}
                      className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Select all eligible jobs"
                    />
                  </th>
                  <th className="py-3 px-3 font-semibold w-[22%]">Company & Links</th>
                  <th className="py-3 px-3 font-semibold w-[19%]">Role & Category</th>
                  <th className="py-3 px-3 font-semibold w-[16%]">Company Contacts</th>
                  <th className="py-3 px-3 font-semibold w-[14%]">Key Details</th>
                  <th className="py-3 px-3 font-semibold text-center w-[10%]">Status</th>
                  <th className="py-3 px-3 font-semibold text-right w-[19%] min-w-[180px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredJobs.map((job) => {
                  const isSelected = selectedJobIds.includes(job.id);
                  const isApplied = job.application_status === "AUTO_APPLIED" || job.application_status === "APPLIED";
                  const isAutoCrawling = activelyCrawlingIds.includes(job.id);
                  const isRowExpanded = expandedRowId === job.id;
                  const isEasyApply = isOneClickReady(job);
                  const autoReadyBlocked =
                    !isApplied &&
                    !isEasyApply &&
                    (job.auto_ready_reasons?.length || job.eligibility_reasons?.length);

                  return (
                    <Fragment key={job.id}>
                      <tr
                        onClick={() => (isApplied ? setSelectedJob(job) : handleToggleJobSelect(job.id))}
                        className={`transition-colors cursor-pointer select-none group ${
                          isSelected
                            ? "bg-indigo-50/70 dark:bg-indigo-950/40"
                            : isApplied
                            ? "bg-emerald-50/20 dark:bg-emerald-950/15 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/30"
                            : "hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
                        }`}
                      >
                        {/* 1. Selection Checkbox */}
                        <td className="py-3 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isApplied}
                            onChange={(e) => !isApplied && handleToggleJobSelect(job.id, e as any)}
                            className={`rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 w-4 h-4 ${
                              isApplied ? "opacity-30 cursor-not-allowed" : "cursor-pointer"
                            }`}
                          />
                        </td>

                        {/* 2. Company Name, Official Website & Direct Portal Links */}
                        <td className="py-3 px-3 overflow-hidden">
                          <div className="flex items-start gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500/10 to-violet-500/20 dark:from-indigo-500/20 dark:to-violet-500/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/50 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                              {(job.company_name || "C").charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                              <span className="font-bold text-slate-900 dark:text-white truncate block text-xs" title={job.company_name}>
                                {job.company_name}
                              </span>
                              <div className="flex flex-col gap-0.5">
                                {/* Company Website Link */}
                                {job.company_website ? (
                                  <a
                                    href={job.company_website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-[11px] text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400 hover:underline inline-flex items-center gap-1 font-mono truncate max-w-full"
                                    title={`Official Company Website: ${job.company_website}`}
                                  >
                                    <Globe className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                                    <span className="truncate">{job.company_website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
                                    <ExternalLink className="w-2.5 h-2.5 opacity-50 shrink-0" />
                                  </a>
                                ) : (
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 italic block truncate">No site url</span>
                                )}
                                {/* Direct Portal Job Posting Link */}
                                {(job.original_url || job.apply_url) && (
                                  <a
                                    href={job.original_url || job.apply_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-[10.5px] text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 hover:underline inline-flex items-center gap-1 truncate max-w-full font-medium"
                                    title={`Open posting on ${job.portal_source?.toUpperCase() || "Portal"}: ${job.original_url || job.apply_url}`}
                                  >
                                    <ExternalLink className="w-2.5 h-2.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                                    <span className="truncate capitalize font-semibold">
                                      {job.portal_source || "Portal"} Post ↗
                                    </span>
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 3. Role & Portal */}
                        <td className="py-3 px-3 overflow-hidden">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-bold text-slate-900 dark:text-white text-xs truncate block hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" title={job.title}>
                                {job.title}
                              </span>
                              {job.priority_rank === "HIGH" && (
                                <Badge className="bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800 text-[9px] font-bold py-0 px-1 shrink-0">
                                  🔥
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-wrap">
                              <Badge
                                variant="outline"
                                className={`text-[9px] font-bold uppercase tracking-wider py-0 px-1.5 ${
                                  job.portal_source === "cutshort"
                                    ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
                                    : job.portal_source === "wellfound"
                                    ? "bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                                    : job.portal_source === "linkedin"
                                    ? "bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800"
                                    : "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                                }`}
                              >
                                {job.portal_source}
                              </Badge>
                              {(job.semantic_domains || []).slice(0, 1).map((dom) => (
                                <span key={dom} className="text-[9px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded truncate max-w-[80px]">
                                  {dom}
                                </span>
                              ))}
                            </div>
                          </div>
                        </td>

                        {/* 4. Company Contacts (Discovered Emails & Phones) */}
                        <td className="py-3 px-3 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-0.5 min-w-0">
                            {job.contact_emails && job.contact_emails.length > 0 ? (
                              <div className="flex items-center gap-1 min-w-0">
                                <a
                                  href={`mailto:${job.contact_emails[0]}`}
                                  className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800 hover:underline truncate max-w-[130px]"
                                  title={`Email ${job.contact_emails[0]}`}
                                >
                                  <Mail className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
                                  <span className="truncate">{job.contact_emails[0]}</span>
                                </a>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(job.contact_emails[0]);
                                    toast.success(`Copied ${job.contact_emails[0]}!`);
                                  }}
                                  className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 shrink-0 transition-colors"
                                  title="Copy email"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                                {job.contact_emails.length > 1 && (
                                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold shrink-0" title={job.contact_emails.slice(1).join(", ")}>
                                    +{job.contact_emails.length - 1}
                                  </span>
                                )}
                              </div>
                            ) : isAutoCrawling ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">
                                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                                Crawling site...
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 dark:text-slate-500 italic block">
                                Online portal
                              </span>
                            )}

                            {job.contact_phones && job.contact_phones.length > 0 && (
                              <div className="flex items-center gap-1 min-w-0">
                                <a
                                  href={`tel:${job.contact_phones[0]}`}
                                  className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-700 dark:text-slate-300 hover:text-indigo-600 truncate max-w-[110px]"
                                  title={job.contact_phones[0]}
                                >
                                  <Phone className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                                  <span className="truncate">{job.contact_phones[0]}</span>
                                </a>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(job.contact_phones[0]);
                                    toast.success(`Copied ${job.contact_phones[0]}!`);
                                  }}
                                  className="text-slate-400 hover:text-indigo-600 p-0.5 shrink-0"
                                  title="Copy phone"
                                >
                                  <Copy className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 5. Key Details (Location, Experience, Job Type) */}
                        <td className="py-3 px-3 overflow-hidden">
                          <div className="space-y-0.5 text-[11px] text-slate-600 dark:text-slate-400 min-w-0">
                            <div className="flex items-center gap-1 min-w-0">
                              <MapPin className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                              <span className="truncate max-w-full text-slate-700 dark:text-slate-300" title={cleanLocation(job.locations[0])}>
                                {cleanLocation(job.locations[0])}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              <span className="font-semibold text-slate-700 dark:text-slate-300">{job.experience_level || "Any Exp"}</span>
                              <span>•</span>
                              <span>{job.job_type || "Full-time"}</span>
                            </div>
                          </div>
                        </td>

                        {/* 6. Application Status */}
                        <td className="py-3 px-3 text-center overflow-hidden" onClick={(e) => e.stopPropagation()}>
                          {isApplied ? (
                            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white border-0 text-[10px] font-bold shadow-xs inline-flex items-center gap-1 px-2 py-0.5 whitespace-nowrap">
                              <Check className="w-3 h-3" />
                              Applied
                            </Badge>
                          ) : isEasyApply ? (
                            <Badge className="bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700 text-[10px] font-bold inline-flex items-center gap-1 px-2 py-0.5 whitespace-nowrap">
                              <Zap className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                              Auto Ready
                            </Badge>
                          ) : (
                            <div className="flex flex-col items-center gap-0.5">
                              <Badge className={`${
                                job.apply_mode === "ineligible" || (job.eligibility_reasons && job.eligibility_reasons.length > 0)
                                  ? "bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800"
                                  : job.listing_status === "expired"
                                  ? "bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 border-red-300 dark:border-red-800"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700"
                              } text-[10px] font-semibold inline-flex items-center gap-1 px-2 py-0.5 whitespace-nowrap`}>
                                <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                                {job.listing_status === "expired"
                                  ? "Expired"
                                  : job.apply_mode === "already_applied"
                                  ? "Already Applied"
                                  : job.apply_mode === "ineligible"
                                  ? "Ineligible"
                                  : job.application_status === "MANUAL_APPLY_NEEDED"
                                  ? (job.eligibility_reasons?.length ? "Ineligible" : "Manual Needed")
                                  : "Manual"}
                              </Badge>
                              {((job.eligibility_reasons && job.eligibility_reasons.length > 0) || (job.auto_ready_reasons && job.auto_ready_reasons.length > 0)) ? (
                                <span
                                  className="text-[9.5px] text-rose-600 dark:text-rose-400 max-w-[135px] truncate font-medium"
                                  title={(job.eligibility_reasons || job.auto_ready_reasons || [])
                                    .filter((r) => !/unverif/i.test(r))
                                    .join("; ")}
                                >
                                  {(job.eligibility_reasons || job.auto_ready_reasons || []).find(
                                    (r) => !/unverif/i.test(r)
                                  )}
                                </span>
                              ) : job.listing_status === "unverified" ? (
                                <span className="text-[9px] text-slate-400" title="Liveness check inconclusive — still eligible for One-Click">
                                  Check pending
                                </span>
                              ) : null}
                            </div>
                          )}
                        </td>

                        {/* 7. Action Buttons */}
                        <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5 shrink-0">
                            {/* STRICT RULE: If already applied, show clean Details button only (no duplicate applied badge!) */}
                            {isApplied ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedJob(job)}
                                className="h-7 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                              >
                                Details
                              </Button>
                            ) : isEasyApply ? (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => handleAutoApply(job)}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-7 px-2.5 font-bold inline-flex items-center gap-1 shadow-xs whitespace-nowrap shrink-0"
                                  title="1-Click Auto Apply via Chrome Extension"
                                >
                                  <Zap className="w-3 h-3 text-amber-300 shrink-0" />
                                  <span>Auto Apply</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setSelectedJob(job)}
                                  className="h-7 px-2 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white shrink-0"
                                  title="View full description and AI match breakdown"
                                >
                                  Details
                                </Button>
                              </>
                            ) : (
                              <>
                                <a
                                  href={job.apply_url || job.original_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs h-7 px-2.5 font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors border border-slate-200 dark:border-slate-700 whitespace-nowrap shrink-0"
                                  title="Open external company portal to apply"
                                >
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                  <span>Apply</span>
                                </a>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setSelectedJob(job)}
                                  className="h-7 px-2 text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white shrink-0"
                                  title="View full description and AI match breakdown"
                                >
                                  Details
                                </Button>
                              </>
                            )}

                            <button
                              onClick={() => setExpandedRowId(isRowExpanded ? null : job.id)}
                              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                              title={isRowExpanded ? "Collapse preview" : "Expand preview"}
                            >
                              {isRowExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Sub-Row Expandable Drawer */}
                      {isRowExpanded && (
                        <tr className="bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800">
                          <td colSpan={7} className="py-3 px-6">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                                  Job Summary & AI Analysis:
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleAiMatch(job)}
                                    disabled={analyzingId === job.id}
                                    className="text-[11px] font-bold text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 px-2.5 py-0.5 rounded-full border border-purple-200 dark:border-purple-800 flex items-center gap-1"
                                  >
                                    {analyzingId === job.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
                                    {job.match_score}% AI Match
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 line-clamp-3">
                                {job.description || "No full description text."}
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </>
      ) : (
        <div className="space-y-6">
          {/* Top Application Metrics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
            <div
              onClick={() => setApplicationsSubFilter("APPLIED_ALL")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                applicationsSubFilter === "APPLIED_ALL"
                  ? "bg-emerald-50 border-emerald-400 ring-2 ring-emerald-500/20 shadow-xs"
                  : "bg-white border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-700 mb-1">
                <span>Total Applied</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-black text-slate-900">{totalAppliedCount}</div>
              <p className="text-[11px] text-slate-500 mt-1">Confirmed & auto-applied</p>
            </div>

            <div
              onClick={() => setApplicationsSubFilter("AUTO_APPLIED")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                applicationsSubFilter === "AUTO_APPLIED"
                  ? "bg-emerald-50 border-emerald-400 ring-2 ring-emerald-500/20 shadow-xs"
                  : "bg-white border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-semibold text-emerald-700 mb-1">
                <span>Auto-Pilot Done</span>
                <Zap className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-black text-slate-900">{autoAppliedCount}</div>
              <p className="text-[11px] text-slate-500 mt-1">Submitted via extension</p>
            </div>

            <div
              onClick={() => setApplicationsSubFilter("APPLIED")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                applicationsSubFilter === "APPLIED"
                  ? "bg-green-50 border-green-400 ring-2 ring-green-500/20 shadow-xs"
                  : "bg-white border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-semibold text-green-700 mb-1">
                <span>Manual Applied</span>
                <Check className="w-4 h-4 text-green-600" />
              </div>
              <div className="text-2xl font-black text-slate-900">{manualAppliedCount}</div>
              <p className="text-[11px] text-slate-500 mt-1">Applied on portal</p>
            </div>

            <div
              onClick={() => setApplicationsSubFilter("MANUAL_APPLY_NEEDED")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                applicationsSubFilter === "MANUAL_APPLY_NEEDED"
                  ? "bg-amber-50 border-amber-400 ring-2 ring-amber-500/20 shadow-xs"
                  : "bg-white border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-semibold text-amber-700 mb-1">
                <span>Action Required</span>
                <ExternalLink className="w-4 h-4 text-amber-600" />
              </div>
              <div className="text-2xl font-black text-slate-900">{manualNeededCount}</div>
              <p className="text-[11px] text-slate-500 mt-1">External company careers</p>
            </div>

            <div
              onClick={() => setApplicationsSubFilter("SAVED")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer col-span-2 md:col-span-1 ${
                applicationsSubFilter === "SAVED"
                  ? "bg-indigo-50 border-indigo-400 ring-2 ring-indigo-500/20 shadow-xs"
                  : "bg-white border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-semibold text-indigo-700 mb-1">
                <span>Saved for Later</span>
                <Bookmark className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-2xl font-black text-slate-900">{savedCount}</div>
              <p className="text-[11px] text-slate-500 mt-1">Bookmarked jobs</p>
            </div>
          </div>

          {/* Sub-Filter Tabs & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
              {[
                { id: "ALL", label: "All Tracked", count: trackedJobs.length },
                { id: "APPLIED_ALL", label: "✅ Submitted", count: totalAppliedCount },
                { id: "AUTO_APPLIED", label: "⚡ Auto-Pilot", count: autoAppliedCount },
                { id: "APPLIED", label: "Direct Applied", count: manualAppliedCount },
                { id: "MANUAL_APPLY_NEEDED", label: "🔗 Needs Action", count: manualNeededCount },
                { id: "SAVED", label: "📌 Saved", count: savedCount },
              ].map((sub) => {
                const isSelected = applicationsSubFilter === sub.id;
                return (
                  <button
                    key={sub.id}
                    onClick={() => setApplicationsSubFilter(sub.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      isSelected
                        ? "bg-white text-slate-900 shadow-xs border border-slate-200"
                        : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
                    }`}
                  >
                    <span>{sub.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        isSelected ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {sub.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search applications..."
                className="pl-9 h-9 bg-white text-xs"
              />
            </div>
          </div>

          {/* Applications Content List */}
          {filteredApplications.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 p-8 space-y-4">
              <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                <CheckSquare className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-900">No applications found in this category</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                {applicationsSubFilter === "ALL"
                  ? "You haven't tracked any applications yet. Explore fresh job opportunities in the discovery feed and submit or save them."
                  : "No jobs match the current sub-filter. Select 'All Tracked' or switch to the discovery feed."}
              </p>
              <Button
                onClick={() => setActiveMainTab("discover")}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
              >
                Explore Job Discovery Feed
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredApplications.map((job) => {
                const isApplied = job.application_status === "AUTO_APPLIED" || job.application_status === "APPLIED";

                return (
                  <Card
                    key={job.id}
                    className={`relative overflow-hidden transition-all duration-200 hover:shadow-md cursor-pointer border ${
                      isApplied
                        ? "border-l-4 border-l-emerald-500 bg-emerald-50/10 border-slate-200"
                        : "hover:border-slate-300 bg-white border-slate-200"
                    }`}
                    onClick={() => setSelectedJob(job)}
                  >
                    <CardHeader className="pb-3 pr-4">
                      {/* Status & Priority Badge */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {job.application_status === "AUTO_APPLIED" && (
                            <Badge className="bg-emerald-600 text-white border-0 text-[10px] font-bold shadow-xs flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-100" />
                              Auto-Applied ✅
                            </Badge>
                          )}
                          {job.application_status === "APPLIED" && (
                            <Badge className="bg-green-600 text-white border-0 text-[10px] font-bold shadow-xs flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              Applied ✅
                            </Badge>
                          )}
                          {job.application_status === "MANUAL_APPLY_NEEDED" && (
                            <Badge className="bg-amber-50 text-amber-800 border-amber-200 text-[10px] font-medium flex items-center gap-1">
                              <ExternalLink className="w-3 h-3 text-amber-600" />
                              Manual Apply Required
                            </Badge>
                          )}
                          {job.application_status === "SAVED" && (
                            <Badge className="bg-slate-100 text-slate-700 border-slate-300 text-[10px] font-medium flex items-center gap-1">
                              <Bookmark className="w-3 h-3 text-slate-500" />
                              Saved
                            </Badge>
                          )}
                          {job.application_status === "REJECTED" && (
                            <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-[10px] font-medium flex items-center gap-1">
                              ❌ Rejected
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] text-slate-600 font-semibold uppercase">
                            {job.portal_source}
                          </Badge>
                        </div>

                        <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          {job.match_score}% Match
                        </span>
                      </div>

                      {/* Job Title & Company */}
                      <CardTitle className="text-base font-bold text-slate-900 leading-snug">
                        {job.title}
                      </CardTitle>
                      <div className="flex items-center gap-2 text-xs text-slate-600 mt-1">
                        <span className="font-semibold text-slate-800">{job.company_name}</span>
                        {job.company_website && (
                          <a
                            href={job.company_website}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
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

                    <CardContent className="space-y-3 text-xs">
                      {/* Recruiter / Contact details */}
                      <div
                        className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="font-semibold text-slate-700 flex items-center gap-1.5 text-[11px]">
                          <Building className="w-3 h-3 text-indigo-600" />
                          Company Contacts
                        </span>
                        {job.contact_emails && job.contact_emails.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {job.contact_emails.map((email) => (
                              <a
                                key={email}
                                href={`mailto:${email}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 hover:underline"
                              >
                                <Mail className="w-2.5 h-2.5 text-indigo-500" />
                                {email}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-slate-400 italic">No direct public email found.</p>
                        )}
                      </div>

                      <Separator />

                      {/* Footer Actions */}
                      <div className="flex items-center justify-between gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-slate-500">Status:</span>
                          <select
                            value={job.application_status}
                            onChange={(e) => handleStatusChange(job.id, e.target.value)}
                            className="text-[11px] font-semibold rounded-lg border px-2 py-1 bg-white focus:outline-none"
                          >
                            <option value="AUTO_APPLIED">✅ Auto-Applied</option>
                            <option value="APPLIED">✅ Applied</option>
                            <option value="MANUAL_APPLY_NEEDED">🔗 Manual Apply Needed</option>
                            <option value="SAVED">📌 Saved for Later</option>
                            <option value="REJECTED">❌ Not Interested / Rejected</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedJob(job)}
                            className="text-xs h-7"
                          >
                            Details
                          </Button>

                          <a
                            href={job.apply_url || job.original_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              size="sm"
                              variant="secondary"
                              className="text-xs h-7 flex items-center gap-1"
                            >
                              Portal
                              <ExternalLink className="w-2.5 h-2.5" />
                            </Button>
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
                onClick={async () => {
                  try {
                    toast.info(`Scanning company website for ${selectedJob.company_name}...`);
                    const res = await enrichJobContacts(selectedJob.id);
                    setJobs((prev) =>
                      prev.map((j) => (j.id === selectedJob.id ? { ...j, contact_emails: res.contact_emails, contact_phones: res.contact_phones } : j))
                    );
                    setSelectedJob({ ...selectedJob, contact_emails: res.contact_emails, contact_phones: res.contact_phones });
                    toast.success("Discovered contact info updated!");
                  } catch (e: any) {
                    toast.error("Crawl error: " + e.message);
                  }
                }}
                className="text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Refresh Contacts
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

      {/* Live Floating Bulk Progress Modal */}
      {bulkProgress && (
        <div className="fixed bottom-6 right-6 z-50 w-[26rem] max-h-[70vh] overflow-hidden bg-slate-900/95 backdrop-blur-md border border-indigo-500/50 rounded-2xl p-4 text-white shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-5 flex flex-col">
          <div className="flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  bulkProgress.status === "PAUSED_CHALLENGE"
                    ? "bg-amber-400"
                    : bulkProgress.status === "FINISHED" || bulkProgress.status === "completed"
                    ? "bg-emerald-400"
                    : "bg-emerald-400 animate-ping"
                }`}
              />
              <span className="font-bold text-xs tracking-wide text-indigo-300 uppercase">
                {bulkProgress.status === "PAUSED_CHALLENGE"
                  ? "Paused — Bot Challenge"
                  : bulkProgress.status === "FINISHED" || bulkProgress.status === "completed"
                  ? "Bulk Auto-Pilot Finished"
                  : "Bulk Auto-Pilot Active"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge className="bg-indigo-500/30 text-indigo-300 border-indigo-400/40 text-[10px]">
                {(bulkProgress.completed ?? bulkItems.filter((i) => !["queued", "running"].includes(i.status)).length)} of {bulkProgress.total}
              </Badge>
              <button
                type="button"
                onClick={() => {
                  setBulkProgress(null);
                  setBulkApplying(false);
                  setBulkRunId(null);
                  setBulkItems([]);
                }}
                className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
                title="Dismiss modal"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-0.5 shrink-0">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Current job</p>
            <p className="text-xs font-semibold text-white truncate">
              {bulkProgress.status === "PAUSED_CHALLENGE" ? (bulkProgress.title || "Human Verification Challenge") : (bulkProgress.title || "Waiting...")}
            </p>
            <p className="text-[11px] text-slate-400 truncate">{bulkProgress.company}</p>
            {bulkProgress.message ? (
              <p className="text-[10px] text-amber-300">{bulkProgress.message}</p>
            ) : null}
          </div>

          {bulkProgress.status === "PAUSED_CHALLENGE" && (
            <div className="bg-amber-950/70 border border-amber-500/50 rounded-xl p-2.5 text-xs text-amber-200 space-y-2 shrink-0">
              <p className="font-semibold text-[11px] flex items-center gap-1.5 text-amber-300">
                <span>🛡️</span> Verification Required on Active Tab
              </p>
              <p className="text-[10px] text-amber-200/80 leading-relaxed">
                The job tab was brought to the front. Please complete the human check. Auto-Pilot will auto-detect completion and resume, or use the actions below:
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <Button
                  size="sm"
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("JOBPILOT_RESUME_CHALLENGE"));
                    toast.info("Resuming automation after verification...");
                  }}
                  className="flex-1 h-7 text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs"
                >
                  <Play className="w-3 h-3 mr-1 fill-current" />
                  Resume Application
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("JOBPILOT_SKIP_CHALLENGE"));
                    toast.warning("Skipping challenged job and advancing queue...");
                  }}
                  className="h-7 text-[10px] font-semibold border-amber-500/40 text-amber-300 hover:bg-amber-900/40"
                >
                  <SkipForward className="w-3 h-3 mr-1" />
                  Skip Job
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-1 shrink-0">
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-gradient-to-r from-indigo-500 to-emerald-400 h-full transition-all duration-500 rounded-full"
                style={{
                  width: `${Math.round(
                    ((bulkProgress.completed ?? 0) / Math.max(1, bulkProgress.total)) * 100
                  )}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>
                {Math.round(((bulkProgress.completed ?? 0) / Math.max(1, bulkProgress.total)) * 100)}% complete
              </span>
              <span>Per-job status live</span>
            </div>
          </div>

          {bulkItems.length > 0 && (
            <ul className="space-y-1 overflow-y-auto max-h-40 pr-1 text-[11px] shrink min-h-0">
              {bulkItems.map((item) => (
                <li
                  key={`${item.job_id_snapshot}-${item.position}`}
                  className="flex items-start justify-between gap-2 rounded-lg bg-slate-800/60 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-slate-100 font-medium">{item.title || `Job #${item.job_id_snapshot}`}</p>
                    <p className="truncate text-slate-500">{item.company_name}</p>
                    {item.reason ? <p className="truncate text-slate-500">{item.reason}</p> : null}
                  </div>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      item.status === "applied"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : item.status === "running"
                        ? "bg-indigo-500/20 text-indigo-300"
                        : item.status === "queued"
                        ? "bg-slate-600/40 text-slate-300"
                        : item.status === "blocked_challenge"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-rose-500/15 text-rose-300"
                    }`}
                  >
                    {item.status.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between pt-1 shrink-0">
            <span className="text-[10px] text-slate-400 italic">
              {bulkRunId ? `Run #${bulkRunId}` : "Syncing statuses…"}
            </span>
            {bulkProgress.status === "FINISHED" || bulkProgress.status === "completed" ? (
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  setBulkProgress(null);
                  setBulkApplying(false);
                  setBulkRunId(null);
                  setBulkItems([]);
                }}
                aria-label="Dismiss"
                className="h-8 px-3 text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-white"
              >
                <CheckCircle className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
                Dismiss
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleCancelBulkAutoApply}
                aria-label="Stop Auto-Pilot"
                className="h-8 px-3 text-[11px] font-bold bg-rose-600 hover:bg-rose-700"
              >
                <StopCircle className="w-3.5 h-3.5 mr-1.5" />
                Stop Auto-Pilot
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Floating Action Dock when jobs are selected */}
      {selectedJobIds.length > 0 && !bulkProgress && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-md border border-slate-700 dark:border-slate-800 text-white rounded-2xl px-5 py-3 shadow-2xl flex flex-wrap items-center gap-4 animate-in fade-in slide-in-from-bottom-5 max-w-xl">
          <div className="flex items-center gap-2.5 pr-3 border-r border-slate-700">
            <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
              {selectedJobIds.length}
            </div>
            <div>
              <span className="font-semibold text-xs text-white block">
                {selectedJobIds.length} {selectedJobIds.length === 1 ? "Job" : "Jobs"} Selected
              </span>
              <button
                onClick={() => setSelectedJobIds([])}
                className="text-[11px] text-slate-400 hover:text-white underline text-left block"
              >
                Deselect All
              </button>
            </div>
          </div>

          {/* Warning banner if any selected job is ineligible */}
          {hasIneligibleSelection && !bulkApplying && (
            <div className="flex items-center gap-2 text-xs text-amber-300">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{ineligibleJobs.length} ineligible selected</span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSelectOnlyEligible}
                className="h-7 px-2 text-[11px] font-bold border-amber-400/50 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200"
              >
                Clean ({eligibleJobs.length})
              </Button>
            </div>
          )}

          {/* The Actions */}
          <div className="flex items-center gap-2.5">
            {bulkApplying ? (
              <Button
                onClick={handleCancelBulkAutoApply}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-9 px-4 rounded-xl shadow-lg shadow-rose-600/30 flex items-center gap-1.5 animate-pulse"
              >
                <StopCircle className="w-4 h-4 text-white" />
                Stop Auto-Pilot
              </Button>
            ) : (
              <Button
                onClick={handleTriggerBulkAutoApply}
                disabled={hasIneligibleSelection || eligibleJobs.length === 0}
                className={`text-white font-bold text-xs h-9 px-4 rounded-xl shadow-lg flex items-center gap-1.5 transition-all ${
                  hasIneligibleSelection
                    ? "bg-slate-700 cursor-not-allowed opacity-60"
                    : "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-emerald-600/20"
                }`}
                title={
                  hasIneligibleSelection
                    ? "Cannot auto-apply: Deselect already applied or manual jobs first"
                    : "Start 1-Click Auto Apply for eligible jobs"
                }
              >
                <Zap className="w-4 h-4 text-amber-200" />
                Auto Apply ({eligibleJobs.length})
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
