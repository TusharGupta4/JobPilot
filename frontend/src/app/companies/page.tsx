"use client";

import { useEffect, useState, useMemo, Fragment } from "react";
import Link from "next/link";
import {
  fetchCompanies,
  toggleCompanyContacted,
  enrichCompany,
  getCompanyExportUrl,
  getOutreachSettings,
  saveOutreachSettings,
  testSmtpConnection,
  generateEmailDraft,
  sendOutreachEmail,
  bulkSendOutreachEmails,
  CompanyData,
  EmailDraft,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Building,
  Mail,
  Phone,
  Globe,
  ExternalLink,
  Download,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Sparkles,
  RefreshCw,
  Copy,
  ChevronDown,
  ChevronUp,
  Briefcase,
  UserCheck,
  Check,
  Loader2,
  ArrowUpDown,
  Send,
  Building2,
  Settings,
  Paperclip,
  AlertTriangle,
  FileText,
  Bot,
  Eye,
} from "lucide-react";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrichingId, setEnrichingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  
  // Filtering & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"WITH_CONTACTS" | "ALL" | "NOT_CONTACTED" | "CONTACTED">("WITH_CONTACTS");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [expandedCompanyId, setExpandedCompanyId] = useState<number | null>(null);

  // Email Outreach Configuration Modal State
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [outreachSettings, setOutreachSettings] = useState({
    sender_email: "basutushar1234@gmail.com",
    sender_password: "tushar@7744",
    smtp_host: "smtp.gmail.com",
    smtp_port: 587,
    sender_name: "Tushar Gupta",
    resume_path: "Tushar_Gupta_CSE_2027_.pdf",
  });
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [smtpStatus, setSmtpStatus] = useState<{ success?: boolean; message?: string } | null>(null);

  // Single Company AI Outreach Composer Modal State
  const [composerModalOpen, setComposerModalOpen] = useState(false);
  const [activeCompanyForOutreach, setActiveCompanyForOutreach] = useState<CompanyData | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [selectedRecipient, setSelectedRecipient] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  // Bulk Outreach Modal State
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResults, setBulkResults] = useState<Array<{
    company_name: string;
    to_email?: string;
    success: boolean;
    message?: string;
    error?: string;
  }> | null>(null);

  useEffect(() => {
    loadCompanies();
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const s = await getOutreachSettings();
      if (s) {
        setOutreachSettings((prev) => ({
          ...prev,
          sender_email: s.sender_email || prev.sender_email,
          sender_name: s.sender_name || prev.sender_name,
          smtp_host: s.smtp_host || s.smtp_server || prev.smtp_host,
          smtp_port: s.smtp_port || prev.smtp_port,
          resume_path: s.resume_path || prev.resume_path,
        }));
      }
    } catch (e) {}
  }

  async function loadCompanies() {
    try {
      setLoading(true);
      const data = await fetchCompanies();
      setCompanies(data);
    } catch (err: any) {
      toast.error("Failed to load companies: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  // Filtered list
  const filteredCompanies = useMemo(() => {
    return companies.filter((c) => {
      // Tab filter
      if (activeTab === "WITH_CONTACTS") {
        const hasEmails = c.contact_emails && c.contact_emails.length > 0;
        const hasPhones = c.contact_phones && c.contact_phones.length > 0;
        if (!hasEmails && !hasPhones) return false;
      }
      if (activeTab === "CONTACTED" && !c.is_contacted) return false;
      if (activeTab === "NOT_CONTACTED" && c.is_contacted) return false;

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchName = c.name.toLowerCase().includes(query);
        const matchDomain = c.domain?.toLowerCase().includes(query);
        const matchEmail = c.contact_emails?.some((e) => e.toLowerCase().includes(query));
        const matchJob = c.active_jobs?.some((j) => j.title.toLowerCase().includes(query));
        if (!matchName && !matchDomain && !matchEmail && !matchJob) return false;
      }
      return true;
    });
  }, [companies, activeTab, searchQuery]);

  // Statistics
  const totalCount = companies.length;
  const withContactsCount = companies.filter(
    (c) => (c.contact_emails && c.contact_emails.length > 0) || (c.contact_phones && c.contact_phones.length > 0)
  ).length;
  const contactedCount = companies.filter((c) => c.is_contacted).length;
  const notContactedCount = totalCount - contactedCount;
  const totalEmailsCount = companies.reduce((acc, c) => acc + (c.contact_emails?.length || 0), 0);

  // Multi-Select Handlers
  const isAllSelected =
    filteredCompanies.length > 0 &&
    filteredCompanies.every((c) => selectedIds.includes(c.id));

  function handleToggleSelectAll() {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredCompanies.map((c) => c.id));
    }
  }

  function handleToggleSelect(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  // Interactive Contacted Toggle
  async function handleToggleContacted(company: CompanyData, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    const newStatus = !company.is_contacted;

    // Optimistic update
    setCompanies((prev) =>
      prev.map((c) =>
        c.id === company.id
          ? {
              ...c,
              is_contacted: newStatus,
              contacted_at: newStatus ? new Date().toISOString() : null,
            }
          : c
      )
    );

    try {
      setTogglingId(company.id);
      const updated = await toggleCompanyContacted(company.id);
      setCompanies((prev) =>
        prev.map((c) => (c.id === company.id ? updated : c))
      );
      toast.success(
        newStatus
          ? `Marked ${company.name} as Contacted ✅`
          : `Marked ${company.name} as Not Contacted`
      );
    } catch (err: any) {
      // Revert optimistic update on error
      setCompanies((prev) =>
        prev.map((c) =>
          c.id === company.id ? { ...c, is_contacted: !newStatus } : c
        )
      );
      toast.error("Failed to update status: " + err.message);
    } finally {
      setTogglingId(null);
    }
  }

  // Enrich Company On-Demand
  async function handleEnrich(company: CompanyData, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    try {
      setEnrichingId(company.id);
      toast.info(`Scanning official website for ${company.name}...`);
      const updated = await enrichCompany(company.id);
      setCompanies((prev) =>
        prev.map((c) => (c.id === company.id ? updated : c))
      );
      if (updated.contact_emails.length > 0 || updated.contact_phones.length > 0) {
        toast.success(
          `Found ${updated.contact_emails.length} emails & ${updated.contact_phones.length} phones for ${company.name}!`
        );
      } else {
        toast.info(`No new public contacts discovered on ${company.name}'s website.`);
      }
    } catch (err: any) {
      toast.error("Enrichment failed: " + err.message);
    } finally {
      setEnrichingId(null);
    }
  }

  // Copy to Clipboard
  function handleCopy(text: string, label: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${label} to clipboard!`);
  }

  // Trigger CSV Download
  function handleExportCsv(onlySelected = false) {
    const idsToExport = onlySelected ? selectedIds : undefined;
    const url = getCompanyExportUrl(idsToExport);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      onlySelected
        ? `JobPilot_Companies_Selected_${selectedIds.length}.csv`
        : `JobPilot_Companies_All_${companies.length}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // SMTP Configuration Handlers
  async function handleTestSmtp() {
    try {
      setTestingSmtp(true);
      setSmtpStatus(null);
      const res = await testSmtpConnection({
        sender_email: outreachSettings.sender_email,
        sender_password: outreachSettings.sender_password,
      });
      setSmtpStatus({ success: true, message: res.message });
      toast.success("SMTP Connection Verified! Ready to send emails.");
    } catch (err: any) {
      setSmtpStatus({ success: false, message: err.message });
      toast.error("SMTP Test Failed: " + err.message);
    } finally {
      setTestingSmtp(false);
    }
  }

  async function handleSaveSettings() {
    try {
      setSavingSettings(true);
      await saveOutreachSettings(outreachSettings);
      toast.success("Email outreach settings saved successfully!");
      setSettingsModalOpen(false);
    } catch (err: any) {
      toast.error("Failed to save settings: " + err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  // Single Company Outreach Handlers
  async function handleOpenComposer(company: CompanyData) {
    setActiveCompanyForOutreach(company);
    setComposerModalOpen(true);
    setDraftLoading(true);
    const defaultRecipient = company.contact_emails?.[0] || "";
    setSelectedRecipient(defaultRecipient);

    try {
      toast.info(`Analyzing ${company.name} and crafting tailored pitch with Gemini AI...`);
      const draft = await generateEmailDraft(company.id);
      setEmailSubject(draft.subject);
      setEmailBody(draft.body);
      if (draft.recipient_email) {
        setSelectedRecipient(draft.recipient_email);
      }
      toast.success("Tailored cold email generated with CV attached!");
    } catch (err: any) {
      toast.error("Draft generation error: " + err.message);
      setEmailSubject(`Application for Software Engineering Opportunities - Tushar Gupta`);
      setEmailBody(`Hi Hiring Team at ${company.name},\n\nI am writing to express my strong interest in software development opportunities at ${company.name}. With strong experience in Python, Full Stack architecture, and building scalable systems, I would love to contribute to your engineering goals.\n\nPlease find my resume attached for your review.\n\nBest regards,\nTushar Gupta`);
    } finally {
      setDraftLoading(false);
    }
  }

  async function handleSendEmail() {
    if (!activeCompanyForOutreach) return;
    if (!selectedRecipient) {
      toast.error("Please provide or select a recipient email address.");
      return;
    }
    if (!emailSubject.trim() || !emailBody.trim()) {
      toast.error("Subject and email body cannot be blank.");
      return;
    }

    try {
      setSendingEmail(true);
      toast.info(`Sending tailored email to ${selectedRecipient} with CV attached...`);
      await sendOutreachEmail(activeCompanyForOutreach.id, {
        to_email: selectedRecipient,
        subject: emailSubject,
        body: emailBody,
      });

      toast.success(`🎉 Email successfully sent to ${activeCompanyForOutreach.name}! CV attached.`);
      setComposerModalOpen(false);

      // Mark as contacted locally
      setCompanies((prev) =>
        prev.map((c) =>
          c.id === activeCompanyForOutreach.id
            ? { ...c, is_contacted: true, contacted_at: new Date().toISOString() }
            : c
        )
      );
    } catch (err: any) {
      toast.error("Failed to send email: " + err.message);
    } finally {
      setSendingEmail(false);
    }
  }

  // Bulk Outreach Handlers
  function handleTriggerBulkOutreach() {
    const companiesWithEmail = filteredCompanies.filter(
      (c) => selectedIds.includes(c.id) && c.contact_emails && c.contact_emails.length > 0
    );

    if (companiesWithEmail.length === 0) {
      toast.error("None of the selected companies have discovered recruiter emails.");
      return;
    }

    setBulkResults(null);
    setBulkModalOpen(true);
  }

  async function handleConfirmBulkSend() {
    try {
      setBulkSending(true);
      toast.info(`Generating tailored drafts & sending emails with CV to selected companies...`);
      const res = await bulkSendOutreachEmails(selectedIds);
      setBulkResults(res.results);

      // Update contacted status for successful companies
      const successfulIds = new Set(
        res.results.filter((r) => r.success).map((r) => r.company_id)
      );
      setCompanies((prev) =>
        prev.map((c) =>
          successfulIds.has(c.id)
            ? { ...c, is_contacted: true, contacted_at: new Date().toISOString() }
            : c
        )
      );

      toast.success(`🎉 Bulk Outreach finished! Sent ${res.sent_count} emails.`);
    } catch (err: any) {
      toast.error("Bulk email error: " + err.message);
    } finally {
      setBulkSending(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                Company Contact & Outreach Directory
                <Badge variant="outline" className="text-indigo-600 border-indigo-200 bg-indigo-50/50 text-xs">
                  Deduplicated
                </Badge>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Centralized recruiter contact directory with automatic website crawlers and CSV export.
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsModalOpen(true)}
            className="text-xs flex items-center gap-1.5 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 bg-indigo-50/50 dark:bg-indigo-950/40 hover:bg-indigo-100 font-semibold"
          >
            <Settings className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            Email Settings
          </Button>

          <Link href="/jobs">
            <Button variant="outline" size="sm" className="text-xs flex items-center gap-1.5 border-slate-300 dark:border-slate-700">
              <Briefcase className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
              Back to Jobs
            </Button>
          </Link>

          <Button
            variant="outline"
            size="sm"
            onClick={loadCompanies}
            disabled={loading}
            className="text-xs flex items-center gap-1.5 border-slate-300 dark:border-slate-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-indigo-600" : ""}`} />
            Refresh
          </Button>

          {selectedIds.length > 0 && (
            <Button
              onClick={() => handleExportCsv(true)}
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs flex items-center gap-1.5 shadow-sm shadow-indigo-500/20"
            >
              <Download className="w-3.5 h-3.5" />
              Export Selected ({selectedIds.length}) to CSV
            </Button>
          )}

          <Button
            onClick={() => handleExportCsv(false)}
            variant="default"
            size="sm"
            className="bg-slate-900 hover:bg-slate-800 text-white text-xs flex items-center gap-1.5 shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Export All ({companies.length}) to CSV
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-slate-200 bg-white/80 backdrop-blur-sm shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Unique Employers</p>
              <p className="text-xl font-bold text-slate-900">{totalCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/80 backdrop-blur-sm shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Contacted</p>
              <p className="text-xl font-bold text-emerald-600">{contactedCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/80 backdrop-blur-sm shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Pending Outreach</p>
              <p className="text-xl font-bold text-amber-600">{notContactedCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/80 backdrop-blur-sm shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Discovered Emails</p>
              <p className="text-xl font-bold text-indigo-600">{totalEmailsCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Tabs and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        {/* Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab("WITH_CONTACTS")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === "WITH_CONTACTS"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Ready for Outreach ({withContactsCount})
          </button>
          <button
            onClick={() => setActiveTab("ALL")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "ALL"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            All Employers ({totalCount})
          </button>
          <button
            onClick={() => setActiveTab("NOT_CONTACTED")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "NOT_CONTACTED"
                ? "bg-amber-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Pending ({notContactedCount})
          </button>
          <button
            onClick={() => setActiveTab("CONTACTED")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "CONTACTED"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Contacted ({contactedCount})
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search company, domain, email..."
            className="pl-9 pr-3 py-1.5 text-xs h-9 bg-slate-50 border-slate-200 focus-visible:bg-white"
          />
        </div>
      </div>

      {/* Table & Directory View */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold select-none">
                <th className="py-3 px-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">Company Name</th>
                <th className="py-3 px-4">Official Website</th>
                <th className="py-3 px-4">Discovered Emails</th>
                <th className="py-3 px-4">Phones</th>
                <th className="py-3 px-4 text-center">Openings</th>
                <th className="py-3 px-4 text-center">Outreach Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600 mb-2" />
                    Loading deduplicated company database...
                  </td>
                </tr>
              ) : filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <Building className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                    No companies match your current filters.
                  </td>
                </tr>
              ) : (
                filteredCompanies.map((c) => {
                  const isSelected = selectedIds.includes(c.id);
                  const isExpanded = expandedCompanyId === c.id;

                  return (
                    <Fragment key={c.id}>
                      <tr
                        onClick={() => setExpandedCompanyId(isExpanded ? null : c.id)}
                        className={`hover:bg-indigo-50/30 transition-colors cursor-pointer ${
                          isSelected ? "bg-indigo-50/40" : ""
                        }`}
                      >
                      {/* Checkbox */}
                      <td
                        className="py-3 px-4 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(c.id)}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </td>

                      {/* Company Name & Domain */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-100 to-slate-100 text-indigo-700 font-bold flex items-center justify-center shrink-0 text-xs shadow-2xs">
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900 block hover:text-indigo-600 transition-colors">
                              {c.name}
                            </span>
                            {c.domain && (
                              <span className="text-[11px] text-slate-400 font-mono">
                                {c.domain}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Website */}
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        {c.website ? (
                          <a
                            href={c.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 hover:underline font-mono text-[11px]"
                          >
                            <Globe className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate max-w-[140px]">
                              {c.domain || c.website.replace(/^https?:\/\//, "")}
                            </span>
                            <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
                          </a>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">No site URL</span>
                        )}
                      </td>

                      {/* Emails */}
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        {c.contact_emails && c.contact_emails.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {c.contact_emails.slice(0, 2).map((email, idx) => (
                              <div key={idx} className="flex items-center gap-1 group">
                                <a
                                  href={`mailto:${email}`}
                                  className="text-slate-700 hover:text-indigo-600 font-mono text-[11px] truncate max-w-[170px]"
                                  title={`Send email to ${email}`}
                                >
                                  {email}
                                </a>
                                <button
                                  onClick={(e) => handleCopy(email, "Email", e)}
                                  className="text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Copy Email"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                            {c.contact_emails.length > 2 && (
                              <span className="text-[10px] text-indigo-600 font-medium">
                                +{c.contact_emails.length - 2} more
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Pending crawl</span>
                        )}
                      </td>

                      {/* Phones */}
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        {c.contact_phones && c.contact_phones.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {c.contact_phones.slice(0, 1).map((phone, idx) => (
                              <div key={idx} className="flex items-center gap-1 group">
                                <a
                                  href={`tel:${phone}`}
                                  className="text-slate-700 hover:text-indigo-600 font-mono text-[11px]"
                                >
                                  {phone}
                                </a>
                                <button
                                  onClick={(e) => handleCopy(phone, "Phone", e)}
                                  className="text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                  title="Copy Phone"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">—</span>
                        )}
                      </td>

                      {/* Job Count */}
                      <td className="py-3 px-4 text-center">
                        <Badge
                          variant="secondary"
                          className="bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer font-medium"
                        >
                          {c.job_count} {c.job_count === 1 ? "Job" : "Jobs"}
                        </Badge>
                      </td>

                      {/* Contacted Checkbox Toggle */}
                      <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={(e) => handleToggleContacted(c, e)}
                          disabled={togglingId === c.id}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                            c.is_contacted
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                              : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                          }`}
                          title="Click to toggle contacted status"
                        >
                          {togglingId === c.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : c.is_contacted ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span>{c.is_contacted ? "Contacted ✅" : "Not Contacted"}</span>
                        </button>
                      </td>

                      {/* Actions: Direct Email, WhatsApp & Sync */}
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {c.contact_emails && c.contact_emails.length > 0 ? (
                            <Button
                              size="sm"
                              onClick={() => handleOpenComposer(c)}
                              className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-xs"
                              title={`Compose & send tailored AI cold email to ${c.name} with CV attached`}
                            >
                              <Send className="w-3 h-3 text-indigo-200" />
                              AI Email HR
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => handleEnrich(c, e)}
                              className="inline-flex items-center gap-1 h-7 px-2 text-[10px] text-slate-400 hover:text-indigo-600"
                              title="Find recruiter email"
                            >
                              <Search className="w-3 h-3 text-slate-400" />
                              Find Email
                            </Button>
                          )}

                          {c.contact_phones && c.contact_phones.length > 0 && (
                            <a
                              href={`https://wa.me/${c.contact_phones[0].replace(/\D/g, "")}?text=Hi,%20I%20am%20interested%20in%20software%20engineering%20roles%20at%20${encodeURIComponent(c.name)}.`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 h-7 px-2 text-[11px] font-semibold rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors border border-emerald-200"
                              title={`Chat with recruiter on WhatsApp (${c.contact_phones[0]})`}
                            >
                              <Phone className="w-3 h-3 text-emerald-600" />
                              WhatsApp
                            </a>
                          )}

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleEnrich(c, e)}
                            disabled={enrichingId === c.id}
                            title="Re-crawl official website"
                            className="h-7 px-2 text-[11px] text-slate-500 hover:text-indigo-600 hover:bg-slate-100"
                          >
                            <Sparkles
                              className={`w-3 h-3 ${
                                enrichingId === c.id ? "animate-spin text-indigo-600" : "text-amber-500"
                              }`}
                            />
                          </Button>

                          <button
                            onClick={() => setExpandedCompanyId(isExpanded ? null : c.id)}
                            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                            title="Toggle details"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/70 border-b border-slate-200">
                        <td colSpan={8} className="py-3 px-6">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                                <Briefcase className="w-3.5 h-3.5 text-indigo-600" />
                                Active Job Openings at {c.name} ({c.active_jobs?.length || 0}):
                              </span>
                              {c.contacted_at && (
                                <span className="text-[11px] text-slate-500 font-mono">
                                  Marked Contacted: {new Date(c.contacted_at).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {c.active_jobs && c.active_jobs.length > 0 ? (
                                c.active_jobs.map((job) => (
                                  <div
                                    key={job.id}
                                    className="p-2.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2 shadow-2xs hover:border-indigo-300 transition-colors"
                                  >
                                    <span className="font-medium text-slate-800 truncate text-xs">
                                      {job.title}
                                    </span>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <Badge
                                        variant="outline"
                                        className={`text-[10px] ${
                                          job.is_easy_apply
                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                            : "bg-amber-50 text-amber-700 border-amber-200"
                                        }`}
                                      >
                                        {job.is_easy_apply ? "Auto-Apply" : "Manual Apply"}
                                      </Badge>
                                      <a
                                        href={job.original_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-600 hover:text-indigo-800 p-1"
                                        title="View job on portal"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <p className="text-slate-400 text-xs italic">
                                  No active jobs tracked for this company.
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
          </table>
        </div>

        {/* Selected Bottom Action Bar */}
        {selectedIds.length > 0 && (
          <div className="bg-slate-900 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-indigo-300">
                {selectedIds.length} of {filteredCompanies.length} companies selected
              </span>
              <button
                onClick={() => setSelectedIds([])}
                className="text-slate-400 hover:text-white underline text-[11px]"
              >
                Clear selection
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleTriggerBulkOutreach}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/30"
              >
                <Send className="w-3.5 h-3.5 text-emerald-200" />
                Bulk AI Cold Email ({selectedIds.length})
              </Button>

              <Button
                size="sm"
                onClick={() => handleExportCsv(true)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs flex items-center gap-1.5 shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                Download CSV ({selectedIds.length})
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* 1. Email Outreach Settings Modal */}
      {settingsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">Email Outreach Settings</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Configure personal SMTP credentials for automated cold emails</p>
                </div>
              </div>
              <button
                onClick={() => setSettingsModalOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Sender Gmail Address
                </label>
                <Input
                  value={outreachSettings.sender_email}
                  onChange={(e) => setOutreachSettings({ ...outreachSettings, sender_email: e.target.value })}
                  placeholder="e.g. basutushar1234@gmail.com"
                  className="text-xs bg-slate-50 dark:bg-slate-800 dark:border-slate-700 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Sender Password / Google App Password
                </label>
                <Input
                  type="password"
                  value={outreachSettings.sender_password}
                  onChange={(e) => setOutreachSettings({ ...outreachSettings, sender_password: e.target.value })}
                  placeholder="e.g. tushar@7744 or 16-character app password"
                  className="text-xs bg-slate-50 dark:bg-slate-800 dark:border-slate-700 font-mono"
                />
                <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 block">
                  Tip: Standard Gmail accounts with 2FA require a 16-char App Password from Google Account Security.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    SMTP Host
                  </label>
                  <Input
                    value={outreachSettings.smtp_host}
                    onChange={(e) => setOutreachSettings({ ...outreachSettings, smtp_host: e.target.value })}
                    className="text-xs bg-slate-50 dark:bg-slate-800 dark:border-slate-700 font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    SMTP Port
                  </label>
                  <Input
                    type="number"
                    value={outreachSettings.smtp_port}
                    onChange={(e) => setOutreachSettings({ ...outreachSettings, smtp_port: parseInt(e.target.value) || 587 })}
                    className="text-xs bg-slate-50 dark:bg-slate-800 dark:border-slate-700 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Attached Candidate CV
                </label>
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                  <Paperclip className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span className="font-mono text-[11px] text-slate-800 dark:text-slate-200 truncate">
                    {outreachSettings.resume_path || "Tushar_Gupta_CSE_2027_.pdf"}
                  </span>
                  <Badge variant="outline" className="ml-auto text-[10px] bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                    PDF Attached
                  </Badge>
                </div>
              </div>

              {/* SMTP Test Status Feedback */}
              {smtpStatus && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                    smtpStatus.success
                      ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                      : "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300"
                  }`}
                >
                  {smtpStatus.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <span>{smtpStatus.message}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestSmtp}
                disabled={testingSmtp}
                className="text-xs flex items-center gap-1.5"
              >
                {testingSmtp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Test SMTP Connection
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSettingsModalOpen(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                >
                  {savingSettings ? "Saving..." : "Save Configuration"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Single Company AI Cold Email Composer Modal */}
      {composerModalOpen && activeCompanyForOutreach && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                    AI Cold Outreach • {activeCompanyForOutreach.name}
                    <Badge variant="outline" className="text-[10px] bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                      Gemini Tailored
                    </Badge>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Review and customize the tailored cold pitch before sending directly via personal email
                  </p>
                </div>
              </div>
              <button
                onClick={() => setComposerModalOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {draftLoading ? (
              <div className="py-16 text-center space-y-3">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Analyzing {activeCompanyForOutreach.name} & crafting tailored pitch...
                </p>
                <p className="text-xs text-slate-400">
                  Aligning your skills & experiences with the company&apos;s active openings
                </p>
              </div>
            ) : (
              <div className="space-y-3.5 text-xs">
                {/* Recruiter Email Selection */}
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Recipient Recruiter Email
                  </label>
                  {activeCompanyForOutreach.contact_emails && activeCompanyForOutreach.contact_emails.length > 1 ? (
                    <select
                      value={selectedRecipient}
                      onChange={(e) => setSelectedRecipient(e.target.value)}
                      className="w-full h-9 px-3 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                    >
                      {activeCompanyForOutreach.contact_emails.map((email) => (
                        <option key={email} value={email}>
                          {email}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={selectedRecipient}
                      onChange={(e) => setSelectedRecipient(e.target.value)}
                      placeholder="e.g. recruiter@company.com"
                      className="text-xs bg-slate-50 dark:bg-slate-800 dark:border-slate-700 font-mono"
                    />
                  )}
                </div>

                {/* Subject */}
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Email Subject Line
                  </label>
                  <Input
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Subject line..."
                    className="text-xs bg-slate-50 dark:bg-slate-800 dark:border-slate-700 font-medium"
                  />
                </div>

                {/* Body Textarea */}
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Email Body (Tailored Pitch)
                  </label>
                  <textarea
                    rows={8}
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-sans leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>

                {/* Attached CV Callout */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800">
                  <div className="flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 block text-xs">
                        Tushar_Gupta_CSE_2027_.pdf
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        Automatically attached from your profile media directory
                      </span>
                    </div>
                  </div>
                  <Badge className="bg-emerald-600 text-white border-0 text-[10px]">
                    Attached ✅
                  </Badge>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Sender: <b className="font-mono">{outreachSettings.sender_email}</b>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setComposerModalOpen(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSendEmail}
                  disabled={sendingEmail || draftLoading}
                  className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/30"
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Sending Email...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Send Cold Email
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Bulk AI Outreach Confirmation & Progress Modal */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-600 text-white flex items-center justify-center font-bold">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    Bulk AI Cold Email Outreach
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Queue tailored outreach with attached CV for {selectedIds.length} selected companies
                  </p>
                </div>
              </div>
              {!bulkSending && (
                <button
                  onClick={() => setBulkModalOpen(false)}
                  className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="space-y-3 text-xs">
              {!bulkResults && !bulkSending && (
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2">
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                    JobPilot will analyze each company&apos;s active openings, synthesize a tailored cold pitch with Gemini AI, and dispatch the email with your CV (<b className="font-mono">Tushar_Gupta_CSE_2027_.pdf</b>) attached via SMTP.
                  </p>
                  <div className="flex items-center gap-2 pt-1 text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold">
                    <span>Sender:</span>
                    <span className="font-mono">{outreachSettings.sender_email}</span>
                  </div>
                </div>
              )}

              {bulkSending && (
                <div className="py-8 text-center space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    Dispatching tailored emails with CV attached...
                  </p>
                  <p className="text-slate-400 text-[11px]">
                    Generating unique pitches and streaming through SMTP connection
                  </p>
                </div>
              )}

              {bulkResults && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">
                    Dispatch Results:
                  </span>
                  {bulkResults.map((r, idx) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-lg border flex items-center justify-between text-xs ${
                        r.success
                          ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
                          : "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200"
                      }`}
                    >
                      <div>
                        <span className="font-bold">{r.company_name}</span>
                        {r.to_email && <span className="font-mono text-[11px] text-slate-500 ml-1.5">({r.to_email})</span>}
                      </div>
                      <Badge
                        className={`text-[10px] ${
                          r.success ? "bg-emerald-600 text-white" : "bg-amber-600 text-white"
                        }`}
                      >
                        {r.success ? "Sent ✅" : "Skipped / Failed"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              {!bulkResults && !bulkSending && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBulkModalOpen(false)}
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleConfirmBulkSend}
                    className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Start Bulk AI Sending
                  </Button>
                </>
              )}
              {bulkResults && (
                <Button
                  size="sm"
                  onClick={() => setBulkModalOpen(false)}
                  className="text-xs bg-slate-900 text-white"
                >
                  Done
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
