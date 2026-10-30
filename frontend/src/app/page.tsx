import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  User,
  FileText,
  Briefcase,
  CheckCircle2,
  ArrowRight,
  Database,
  Search,
  Bot,
  Zap,
} from "lucide-react";

export default function Home() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-10">
      {/* Hero Welcome Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-8 sm:p-12 text-white shadow-xl">
        <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI-Powered Autonomous Job Copilot</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
            Supercharge Your Job Search With Intelligent Automation.
          </h1>

          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            Your single-user command center for job discovery, candidate matching, truthful
            application material generation, and automated pipeline tracking.
          </p>

          <div className="pt-2 flex flex-wrap gap-3">
            <Link href="/profile">
              <Button size="lg" className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-md shadow-indigo-600/30">
                <User className="w-4 h-4 mr-2" />
                Configure Profile & Resumes
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <a
              href="http://localhost:8000/api/profile/me/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="lg" variant="outline" className="text-slate-200 border-slate-700 hover:bg-slate-800">
                <Database className="w-4 h-4 mr-2" />
                View Django API
              </Button>
            </a>
          </div>
        </div>
      </div>

      {/* System Status & Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center mb-1">
              <Database className="w-5 h-5" />
            </div>
            <CardTitle className="text-sm font-semibold text-slate-700">Database Engine</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-slate-900">PostgreSQL 18</div>
            <p className="text-xs text-emerald-600 font-medium flex items-center gap-1 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Connected (job_portal)
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center mb-1">
              <FileText className="w-5 h-5" />
            </div>
            <CardTitle className="text-sm font-semibold text-slate-700">Candidate Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-slate-900">Phase 1 Active</div>
            <p className="text-xs text-indigo-600 font-medium mt-1">Ready for input & resume parsing</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center mb-1">
              <Search className="w-5 h-5" />
            </div>
            <CardTitle className="text-sm font-semibold text-slate-700">Discovery Engine</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-slate-900">Greenhouse / Lever</div>
            <p className="text-xs text-slate-500 mt-1">Phase 2 pipeline</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-2xs hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center mb-1">
              <Bot className="w-5 h-5" />
            </div>
            <CardTitle className="text-sm font-semibold text-slate-700">AI Scoring & Matching</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-slate-900">Gemini 2.5</div>
            <p className="text-xs text-slate-500 mt-1">Structured 2-stage matcher</p>
          </CardContent>
        </Card>
      </div>

      {/* Feature Walkthrough Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900">Architecture & Roadmap</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-slate-200 bg-gradient-to-b from-white to-slate-50/50">
            <CardHeader>
              <div className="flex items-center justify-between mb-2">
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Phase 1 (Live)</Badge>
                <User className="w-5 h-5 text-indigo-600" />
              </div>
              <CardTitle className="text-base font-semibold">Candidate Profile & Resumes</CardTitle>
              <CardDescription className="text-xs">
                Upload PDFs, extract experience and skills automatically with PyPDF, manage target titles, and maintain pre-verified answers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/profile" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1">
                Open Profile Editor <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-gradient-to-b from-white to-slate-50/50">
            <CardHeader>
              <div className="flex items-center justify-between mb-2">
                <Badge variant="outline" className="text-slate-600">Phase 2 (Next)</Badge>
                <Search className="w-5 h-5 text-purple-600" />
              </div>
              <CardTitle className="text-base font-semibold">Job Discovery & Ingestion</CardTitle>
              <CardDescription className="text-xs">
                ATS adapters for Greenhouse, Lever, and Ashby, email job-alert parsers, URL deduplication, and multi-location grouping.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-xs text-slate-400 font-medium">Ready after profile baseline</span>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-gradient-to-b from-white to-slate-50/50">
            <CardHeader>
              <div className="flex items-center justify-between mb-2">
                <Badge variant="outline" className="text-slate-600">Phase 3</Badge>
                <Zap className="w-5 h-5 text-amber-500" />
              </div>
              <CardTitle className="text-base font-semibold">Intelligent Match & Tiers</CardTitle>
              <CardDescription className="text-xs">
                Prefilter screening + deep LLM scoring into Strong / Stretch / Long-shot tiers with transparent reasoning and eligibility flags.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-xs text-slate-400 font-medium">Model provider: Gemini</span>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
