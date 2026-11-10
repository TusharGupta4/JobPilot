/**
 * JobPilot Copilot - Background Service Worker (Manifest V3)
 * Handles backend synchronization with Django (http://127.0.0.1:8000),
 * caches candidate profile in local storage, and logs applications.
 */

try {
  if (typeof importScripts === "function") {
    importScripts("resume_data.js");
  }
} catch (e) {
  try {
    if (typeof importScripts === "function") {
      importScripts("scripts/resume_data.js");
    }
  } catch (e2) {}
}

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

// Initialize default storage on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["backend_url", "auto_fill_enabled", "highlight_fields"], (res) => {
    const defaults = {};
    if (!res.backend_url) defaults.backend_url = DEFAULT_BACKEND_URL;
    if (res.auto_fill_enabled === undefined) defaults.auto_fill_enabled = true;
    if (res.highlight_fields === undefined) defaults.highlight_fields = true;
    
    chrome.storage.local.set(defaults, () => {
      console.log("[JobPilot] Initialized with defaults:", defaults);
      fetchAndCacheProfile();
    });
  });
});

// Detach any lingering debuggers attached to non-job tabs from previous sessions
function detachLingeringDebuggers() {
  try {
    if (chrome.debugger && typeof chrome.debugger.getTargets === "function") {
      chrome.debugger.getTargets((targets) => {
        if (chrome.runtime.lastError || !targets) return;
        targets.forEach((t) => {
          if (t.attached && t.tabId) {
            console.log("[JobPilot] Detaching lingering debugger from tab:", t.tabId);
            chrome.debugger.detach({ tabId: t.tabId }, () => {
              const _ = chrome.runtime.lastError;
            });
          }
        });
      });
    }
  } catch (e) {}
}
detachLingeringDebuggers();

// Sync profile on service worker startup
fetchAndCacheProfile();

/**
 * Fetch candidate profile from Django backend
 */
async function fetchAndCacheProfile() {
  try {
    const data = await chrome.storage.local.get(["backend_url"]);
    const backendUrl = data.backend_url || DEFAULT_BACKEND_URL;
    const response = await fetch(`${backendUrl}/api/profile/me/`, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    const profile = await response.json();
    await chrome.storage.local.set({
      candidate_profile: profile,
      profile_last_synced: new Date().toISOString(),
      backend_status: "CONNECTED"
    });

    console.log("[JobPilot] Profile cached successfully for:", profile.full_name);
    return { success: true, profile };
  } catch (err) {
    console.warn("[JobPilot] Profile sync error:", err.message);
    await chrome.storage.local.set({ backend_status: "DISCONNECTED", sync_error: err.message });
    return { success: false, error: err.message };
  }
}

// Global CDP Event Listener: Intercepts file chooser dialogs across all portals (Cutshort, ATS, SmartApply)
// completely suppressing native OS dialogs and automatically assigning candidate resume PDF!
// Also auto-accepts javascript dialogs (alerts, prompts, beforeunload confirms) to prevent queue stalls!
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (method === "Page.javascriptDialogOpening") {
    console.log("[JobPilot CDP] ⚠️ Javascript dialog opened:", params?.message, "Auto-accepting...");
    chrome.debugger.sendCommand(source, "Page.handleJavaScriptDialog", {
      accept: true,
      promptText: ""
    }, () => {
      const _ = chrome.runtime.lastError;
    });
    return;
  }

  if (method === "Page.fileChooserOpened") {
    console.log("[JobPilot CDP] 📄 Page.fileChooserOpened event received! BackendNodeId:", params?.backendNodeId);
    const backendNodeId = params?.backendNodeId;

    // Resolve resume path dynamically from candidate profile stored in local storage
    let resumeLocalPath = "";
    try {
      const data = await chrome.storage.local.get(["candidate_profile"]);
      const profile = data.candidate_profile;
      if (profile && Array.isArray(profile.resumes) && profile.resumes.length > 0) {
        const primary = profile.resumes.find(r => r.is_primary) || profile.resumes[0];
        if (primary && primary.file_path) {
          resumeLocalPath = primary.file_path;
        }
      }
    } catch (e) {}

    // Fallback if not cached in storage
    if (!resumeLocalPath) {
      resumeLocalPath = "C:\\Users\\TUSHAR GUPTA\\OneDrive\\Desktop\\job_portal\\backend\\media\\resumes\\Tushar_Gupta_CSE_2027_.pdf";
    }

    if (backendNodeId && resumeLocalPath) {
      chrome.debugger.sendCommand(source, "DOM.setFileInputFiles", {
        files: [resumeLocalPath],
        backendNodeId: backendNodeId
      }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn("[JobPilot CDP] DOM.setFileInputFiles warning:", err.message);
        } else {
          console.log("[JobPilot CDP] ✅ Successfully assigned resume PDF to node via CDP:", resumeLocalPath);
        }
      });
    }

    // Modern CDP Page.handleFileChooser fallback
    if (resumeLocalPath) {
      chrome.debugger.sendCommand(source, "Page.handleFileChooser", {
        action: "accept",
        files: [resumeLocalPath]
      }, (res) => {
        const _hErr = chrome.runtime.lastError;
      });
    }

    // Notify all file inputs to fire input & change
    setTimeout(() => {
      chrome.debugger.sendCommand(source, "Runtime.evaluate", {
        expression: `
          (function() {
            const inputs = document.querySelectorAll("input[type='file']");
            inputs.forEach(i => {
              try { i.dispatchEvent(new Event("input", { bubbles: true, composed: true })); } catch (e) {}
              try { i.dispatchEvent(new Event("change", { bubbles: true, composed: true })); } catch (e) {}
            });
          })()
        `
      }, () => {
        const _rErr = chrome.runtime.lastError;
      });
    }, 120);
  }
});

// Arm CDP file-chooser interception ONLY on genuine job-application tabs.
// Required so Cutshort/Indeed resume attach uses DOM.setFileInputFiles instead of the OS picker.
function armTabCDPInterception(tabId) {
  if (!tabId || !chrome.debugger) return;
  chrome.tabs.get(tabId, (tabInfo) => {
    if (chrome.runtime.lastError || !tabInfo) return;
    const tabUrl = (tabInfo.url || "").toLowerCase();
    const isJobUrl = (
      tabUrl.includes("cutshort.io") ||
      tabUrl.includes("indeed.com") ||
      tabUrl.includes("wellfound.com") ||
      tabUrl.includes("linkedin.com") ||
      tabUrl.includes("greenhouse.io") ||
      tabUrl.includes("lever.co") ||
      tabUrl.includes("/job") ||
      tabUrl.includes("/apply")
    );
    const isBlacklisted = (
      tabUrl.includes("zoom.") ||
      tabUrl.includes("edubricks") ||
      tabUrl.includes("youtube.com") ||
      tabUrl.includes("localhost") ||
      tabUrl.includes("127.0.0.1")
    );
    if (!isJobUrl || isBlacklisted) {
      console.log("[JobPilot CDP] Skip debugger on non-job tab:", tabUrl.slice(0, 80));
      return;
    }
    chrome.debugger.attach({ tabId }, "1.3", () => {
      const aErr = chrome.runtime.lastError?.message || "";
      if (aErr && !aErr.includes("already attached")) {
        console.warn("[JobPilot CDP] attach failed:", aErr);
        return;
      }
      chrome.debugger.sendCommand({ tabId }, "Page.enable", {}, () => {
        chrome.debugger.sendCommand({ tabId }, "DOM.enable", {}, () => {
          chrome.debugger.sendCommand(
            { tabId },
            "Page.setInterceptFileChooserDialog",
            { enabled: true },
            () => {
              const err = chrome.runtime.lastError;
              if (err) {
                console.warn("[JobPilot CDP] intercept enable:", err.message);
              } else {
                console.log("[JobPilot CDP] File chooser interception armed on tab", tabId);
              }
            }
          );
        });
      });
    });
  });
}

/**
 * Record an application submission in PostgreSQL backend
 */
async function recordApplicationToBackend(payload) {
  try {
    const data = await chrome.storage.local.get(["backend_url"]);
    const backendUrl = data.backend_url || DEFAULT_BACKEND_URL;
    
    const response = await fetch(`${backendUrl}/api/jobs/record-application/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        url: payload.url || "",
        title: payload.title || "",
        company: payload.company || "",
        status: payload.status || "APPLIED",
        job_id: payload.job_id || null,
        bulk_status: payload.bulk_status || null,
        reason: payload.reason || payload.notes || "",
        notes: payload.notes || "",
        run_id: payload.run_id || currentBulkRunId || null,
        is_easy_apply: payload.is_easy_apply,
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to record application: ${response.statusText}`);
    }

    const result = await response.json();
    console.log("[JobPilot] Application recorded to PostgreSQL:", result);
    return { success: true, result };
  } catch (err) {
    console.warn("[JobPilot] Record application warning:", err.message);
    return { success: false, error: err.message };
  }
}

async function postBulkItemStatus(jobId, status, reason) {
  if (!currentBulkRunId || !jobId) return null;
  try {
    const data = await chrome.storage.local.get(["backend_url"]);
    const backendUrl = data.backend_url || DEFAULT_BACKEND_URL;
    const res = await fetch(`${backendUrl}/api/jobs/bulk-apply/${currentBulkRunId}/item/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ job_id: jobId, status, reason: reason || "" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("[JobPilot Bulk] item status post failed:", err.message);
    return null;
  }
}

async function startBulkRunOnBackend(queue, experienceFilter) {
  try {
    const data = await chrome.storage.local.get(["backend_url"]);
    const backendUrl = data.backend_url || DEFAULT_BACKEND_URL;
    const res = await fetch(`${backendUrl}/api/jobs/bulk-apply/start/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        experience_filter: experienceFilter || "Any",
        jobs: queue.map((j) => ({
          id: j.id,
          title: j.title,
          company: j.company,
          url: j.url,
        })),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("[JobPilot Bulk] start run failed:", err.message);
    return null;
  }
}

async function verifyJobLiveness(jobId) {
  if (!jobId) return { listing_status: "unverified" };
  try {
    const data = await chrome.storage.local.get(["backend_url"]);
    const backendUrl = data.backend_url || DEFAULT_BACKEND_URL;
    const res = await fetch(`${backendUrl}/api/jobs/${jobId}/verify-liveness/`, {
      method: "POST",
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.info("[JobPilot] Liveness check skipped:", err.message);
    return { listing_status: "unverified" };
  }
}

// Bulk Auto-Apply Queue State
let bulkApplyQueue = [];
let bulkCurrentIndex = -1;
let isBulkApplying = false;
let currentBulkTabId = null;
let currentBulkJob = null;
let bulkWatchdogTimer = null;
let advanceTimeout = null;
let currentBulkRunId = null;
let bulkPausedForChallenge = false;

// Track last known mouse position per tab for smooth Bezier trajectory simulation
const tabMousePositions = {};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isBulkApplying || tabId !== currentBulkTabId) return;

  if (changeInfo.status === "complete" && tab && tab.url) {
    const isPortalUrl = /indeed\.com|smartapply|cutshort\.io|wellfound\.com/i.test(tab.url);
    const isChallengeUrl = /challenge|turnstile|recaptcha|validateCaptcha/i.test(tab.url);
    if (bulkPausedForChallenge && isPortalUrl && !isChallengeUrl) {
      console.log("[JobPilot Bulk] Tab navigated to portal page after verification:", tab.url);
      bulkPausedForChallenge = false;
      armTabCDPInterception(tabId);
      if (currentBulkJob) {
        postBulkItemStatus(currentBulkJob.id, "running", "Verification complete — continuing application");
      }
      broadcastBulkProgress({
        status: "PROCESSING",
        job_id: currentBulkJob?.id,
        current: bulkCurrentIndex + 1,
        total: bulkApplyQueue.length,
        run_id: currentBulkRunId,
        title: currentBulkJob?.title,
        company: currentBulkJob?.company,
        message: "Verification complete! Continuing application...",
      });
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { action: "RESUME_AUTOPILOT" }, () => {
          const _ = chrome.runtime.lastError;
        });
      }, 1200);
    }
  }
});

function broadcastBulkProgress(detail) {
  chrome.tabs.query({ url: ["http://localhost/*", "http://127.0.0.1/*"] }, (tabs) => {
    if (tabs && tabs.length > 0) {
      tabs.forEach((t) => {
        chrome.tabs.sendMessage(t.id, {
          action: "BULK_PROGRESS_UPDATE",
          detail: detail
        }, () => {
          if (chrome.runtime.lastError) {}
        });
      });
    }
  });
}

function processNextInBulkQueue() {
  if (!isBulkApplying || bulkPausedForChallenge) return;

  if (bulkCurrentIndex >= bulkApplyQueue.length) {
    isBulkApplying = false;
    broadcastBulkProgress({
      status: "FINISHED",
      total: bulkApplyQueue.length,
      current: bulkApplyQueue.length,
      run_id: currentBulkRunId,
      completed: bulkApplyQueue.length,
    });
    console.log("[JobPilot] Bulk Auto-Apply queue completed successfully!");
    return;
  }

  const job = bulkApplyQueue[bulkCurrentIndex];
  currentBulkJob = job;

  // Skip items already marked terminal by backend preflight
  if (job._preflightStatus && job._preflightStatus !== "queued") {
    console.info(`[JobPilot Bulk] Preflight skip ${job.title}: ${job._preflightStatus}`);
    broadcastBulkProgress({
      status: "APPLICATION_RECORDED",
      job_id: job.id,
      application_status: job._preflightStatus,
      company: job.company,
      title: job.title,
      current: bulkCurrentIndex + 1,
      total: bulkApplyQueue.length,
      run_id: currentBulkRunId,
      reason: job._preflightReason || "",
    });
    advanceBulkQueue(job._preflightStatus);
    return;
  }

  (async () => {
    try {
      await postBulkItemStatus(job.id, "running", "");
      let live = null;
      try {
        live = await verifyJobLiveness(job.id);
      } catch (e) {
        console.warn("[JobPilot Bulk] Liveness check warning:", e);
      }

      if (live && live.listing_status === "expired") {
        console.info(`[JobPilot Bulk] Job expired on re-check: ${job.title}`);
        await postBulkItemStatus(job.id, "skipped_expired", live.reason || "Expired on liveness re-check");
        await recordApplicationToBackend({
          job_id: job.id,
          url: job.url,
          title: job.title,
          company: job.company,
          status: "REJECTED",
          bulk_status: "skipped_expired",
          reason: live.reason || "Expired",
          run_id: currentBulkRunId,
        });
        broadcastBulkProgress({
          status: "APPLICATION_RECORDED",
          job_id: job.id,
          application_status: "skipped_expired",
          company: job.company,
          title: job.title,
          current: bulkCurrentIndex + 1,
          total: bulkApplyQueue.length,
          run_id: currentBulkRunId,
        });
        advanceBulkQueue("skipped_expired");
        return;
      }

      broadcastBulkProgress({
        status: "PROCESSING",
        current: bulkCurrentIndex + 1,
        total: bulkApplyQueue.length,
        run_id: currentBulkRunId,
        job: {
          id: job.id,
          title: job.title,
          company: job.company,
        },
      });

      console.log(`[JobPilot Bulk] Processing [${bulkCurrentIndex + 1}/${bulkApplyQueue.length}]: ${job.company} - ${job.title}`);

      chrome.tabs.create({ url: job.url, active: false }, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          console.error("[JobPilot Bulk] Tab creation failed:", chrome.runtime.lastError);
          postBulkItemStatus(job.id, "failed", "Tab creation failed");
          advanceBulkQueue("TAB_CREATE_FAILED");
          return;
        }

        currentBulkTabId = tab.id;
        // Arm CDP so resume uploads never open the native OS file picker
        const armWhenReady = (attempt) => {
          armTabCDPInterception(tab.id);
          if (attempt < 3) {
            setTimeout(() => armTabCDPInterception(tab.id), 800 * (attempt + 1));
          }
        };
        armWhenReady(0);

        if (bulkWatchdogTimer) clearTimeout(bulkWatchdogTimer);
        bulkWatchdogTimer = setTimeout(() => {
          if (isBulkApplying && currentBulkTabId === tab.id) {
            if (bulkPausedForChallenge) {
              console.log("[JobPilot Bulk Watchdog] Queue is paused for human verification challenge. Suppressing watchdog timeout.");
              return;
            }
            console.info(`[JobPilot Bulk Watchdog] Tab ${tab.id} timed out after 45s. Advancing.`);
            postBulkItemStatus(job.id, "failed", "Watchdog timeout");
            broadcastBulkProgress({
              status: "APPLICATION_RECORDED",
              job_id: job.id,
              application_status: "failed",
              company: job.company,
              title: job.title,
              current: bulkCurrentIndex + 1,
              total: bulkApplyQueue.length,
              run_id: currentBulkRunId,
              reason: "Watchdog timeout",
            });
            advanceBulkQueue("TIMEOUT");
          }
        }, 45000);
      });
    } catch (err) {
      console.error("[JobPilot Bulk] Unhandled error in queue worker:", err);
      try {
        await postBulkItemStatus(job.id, "failed", err?.message || "Internal runner error");
      } catch (e) {}
      advanceBulkQueue("PROCESSING_ERROR");
    }
  })();
}

let isAdvancingQueue = false;

function advanceBulkQueue(reason) {
  if (!isBulkApplying || isAdvancingQueue) return;
  bulkPausedForChallenge = false;
  isAdvancingQueue = true;
  if (advanceTimeout) clearTimeout(advanceTimeout);
  if (bulkWatchdogTimer) clearTimeout(bulkWatchdogTimer);

  console.log(`[JobPilot Bulk] Advancing queue (Reason: ${reason})`);

  if (currentBulkTabId) {
    const tabToClose = currentBulkTabId;
    currentBulkTabId = null;
    try {
      chrome.scripting.executeScript({
        target: { tabId: tabToClose },
        world: "MAIN",
        func: () => {
          try {
            window.onbeforeunload = null;
            window.addEventListener("beforeunload", (e) => {
              e.stopImmediatePropagation();
              delete e.returnValue;
            }, true);
          } catch (e) {}
        }
      }, () => {
        const _ = chrome.runtime.lastError;
        try {
          chrome.tabs.remove(tabToClose, () => {
            const _err = chrome.runtime.lastError;
          });
        } catch (e) {}
      });
    } catch (e) {
      try {
        chrome.tabs.remove(tabToClose, () => {});
      } catch (err) {}
    }
  }

  bulkCurrentIndex++;

  if (bulkCurrentIndex >= bulkApplyQueue.length) {
    isBulkApplying = false;
    isAdvancingQueue = false;
    broadcastBulkProgress({
      status: "FINISHED",
      total: bulkApplyQueue.length,
      current: bulkApplyQueue.length,
      appliedCount: bulkApplyQueue.length,
      completed: bulkApplyQueue.length,
      run_id: currentBulkRunId,
    });
    console.log("[JobPilot Bulk] Finished all jobs in bulk queue!");
    return;
  }

  // Stealth Human Pacing: Cooldown between applications (4s to 8s)
  const cooldownMs = Math.floor(Math.random() * (8000 - 4000 + 1)) + 4000;
  const cooldownSec = Math.round(cooldownMs / 1000);

  broadcastBulkProgress({
    status: "COOLDOWN",
    cooldownSeconds: cooldownSec,
    current: bulkCurrentIndex,
    total: bulkApplyQueue.length,
    job: {
      title: `Pacing Cooldown (${cooldownSec}s)`,
      company: "Stealth Shield"
    },
    message: `🛡️ Pacing Cooldown: Waiting ${cooldownSec}s before opening next job...`
  });

  advanceTimeout = setTimeout(() => {
    isAdvancingQueue = false;
    processNextInBulkQueue();
  }, cooldownMs);
}

// Watch for tab close: If the active apply tab is closed (by portal, extension, or user), ADVANCE queue to next job!
chrome.tabs.onRemoved.addListener((removedTabId) => {
  if (isBulkApplying && removedTabId === currentBulkTabId) {
    console.log(`[JobPilot Bulk] Apply tab ${removedTabId} closed. Proceeding to next job in queue.`);
    currentBulkTabId = null;
    advanceBulkQueue("TAB_CLOSED");
  }
});

// Message Listener for Content Scripts and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "SYNC_PROFILE") {
    fetchAndCacheProfile().then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.action === "ANSWER_QUESTION") {
    (async () => {
      try {
        const data = await chrome.storage.local.get(["backend_url"]);
        const backendUrl = data.backend_url || DEFAULT_BACKEND_URL;
        const payload = message.payload || {
          question: message.question,
          company: message.company,
          title: message.title,
          job_description: message.job_description
        };
        const res = await fetch(`${backendUrl}/api/profile/answer-question/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        sendResponse(json);
      } catch (err) {
        console.warn("[JobPilot Background] Answer question error:", err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep message channel open for async response
  }

  if (message.action === "RESOLVE_FORM_FIELD") {
    (async () => {
      try {
        const data = await chrome.storage.local.get(["backend_url"]);
        const backendUrl = data.backend_url || DEFAULT_BACKEND_URL;
        const payload = message.payload || {};
        const res = await fetch(`${backendUrl}/api/profile/resolve-form-field/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        sendResponse(json);
      } catch (err) {
        console.warn("[JobPilot Background] Resolve form field error:", err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === "RECORD_APPLICATION") {
    if (isBulkApplying && currentBulkJob) {
      if (!message.payload.job_id) message.payload.job_id = currentBulkJob.id;
      if (!message.payload.company) message.payload.company = currentBulkJob.company;
      if (!message.payload.title) message.payload.title = currentBulkJob.title;
      if (!message.payload.run_id) message.payload.run_id = currentBulkRunId;
    }

    // Normalize bulk_status from payload
    const rawStatus = (message.payload.bulk_status || message.payload.status || "").toLowerCase();
    let bulkStatus = message.payload.bulk_status || null;
    if (!bulkStatus) {
      if (rawStatus === "applied" || rawStatus === "auto_applied") bulkStatus = "applied";
      else if (rawStatus === "manual_apply_needed") bulkStatus = "skipped_ineligible";
      else if (rawStatus === "rejected") bulkStatus = "skipped_expired";
    }
    if (bulkStatus) message.payload.bulk_status = bulkStatus;

    const finish = async () => {
      if (bulkStatus && message.payload.job_id) {
        await postBulkItemStatus(
          message.payload.job_id,
          bulkStatus,
          message.payload.reason || message.payload.notes || ""
        );
      }
      const res = await recordApplicationToBackend(message.payload);
      sendResponse(res);

      broadcastBulkProgress({
        status: "APPLICATION_RECORDED",
        job_id: message.payload.job_id,
        application_status: bulkStatus || message.payload.status || "AUTO_APPLIED",
        company: message.payload.company,
        title: message.payload.title,
        current: bulkCurrentIndex + 1,
        total: bulkApplyQueue.length,
        run_id: currentBulkRunId,
        reason: message.payload.reason || message.payload.notes || "",
      });

      const senderTabId = sender.tab ? sender.tab.id : null;
      if (isBulkApplying && (!senderTabId || senderTabId === currentBulkTabId)) {
        if (bulkStatus === "blocked_challenge") {
          bulkPausedForChallenge = true;
          if (bulkWatchdogTimer) {
            clearTimeout(bulkWatchdogTimer);
            bulkWatchdogTimer = null;
          }
          // Bring the challenge tab to foreground so user can solve captcha
          if (senderTabId) {
            chrome.tabs.update(senderTabId, { active: true }, () => {
              const _ = chrome.runtime.lastError;
            });
          }
          broadcastBulkProgress({
            status: "PAUSED_CHALLENGE",
            job_id: message.payload.job_id,
            title: message.payload.title,
            company: message.payload.company,
            current: bulkCurrentIndex + 1,
            total: bulkApplyQueue.length,
            run_id: currentBulkRunId,
            message: "Human verification challenge detected — solve on the active tab to continue queue.",
          });
          return;
        }
        const advanceOn = new Set([
          "applied", "skipped_expired", "skipped_ineligible", "failed",
          "APPLIED", "AUTO_APPLIED", "MANUAL_APPLY_NEEDED", "REJECTED",
        ]);
        if (advanceOn.has(bulkStatus) || advanceOn.has((message.payload.status || "").toUpperCase())) {
          setTimeout(() => advanceBulkQueue(bulkStatus || message.payload.status), 1200);
        }
      }
    };
    finish();
    return true;
  }

  if (message.action === "REPORT_BULK_STATUS") {
    const jobId = message.job_id || currentBulkJob?.id;
    const st = message.status;
    const reason = message.reason || "";
    (async () => {
      await postBulkItemStatus(jobId, st, reason);
      if (st === "blocked_challenge") {
        bulkPausedForChallenge = true;
        if (bulkWatchdogTimer) {
          clearTimeout(bulkWatchdogTimer);
          bulkWatchdogTimer = null;
        }
        const senderTabId = sender?.tab ? sender.tab.id : currentBulkTabId;
        if (senderTabId) {
          chrome.tabs.update(senderTabId, { active: true }, () => {
            const _ = chrome.runtime.lastError;
          });
        }
        broadcastBulkProgress({
          status: "PAUSED_CHALLENGE",
          job_id: jobId,
          application_status: "blocked_challenge",
          title: message.title || currentBulkJob?.title,
          company: message.company || currentBulkJob?.company,
          current: bulkCurrentIndex + 1,
          total: bulkApplyQueue.length,
          run_id: currentBulkRunId,
          reason,
          message: "Human verification required — solve challenge on the active tab. Auto-Pilot will auto-resume once solved.",
        });
        sendResponse({ success: true });
        return;
      }
      broadcastBulkProgress({
        status: st === "running" ? "PROCESSING" : "APPLICATION_RECORDED",
        job_id: jobId,
        application_status: st,
        title: message.title || currentBulkJob?.title,
        company: message.company || currentBulkJob?.company,
        current: bulkCurrentIndex + 1,
        total: bulkApplyQueue.length,
        run_id: currentBulkRunId,
        reason,
      });
      sendResponse({ success: true });
    })();
    return true;
  }

  // Autonomous resumption when content script detects challenge solved
  if (message.action === "RESUME_AFTER_CHALLENGE_SOLVED") {
    console.log("[JobPilot Bulk] Challenge solved autonomously by user. Resuming queue...");
    bulkPausedForChallenge = false;
    if (currentBulkJob) {
      postBulkItemStatus(currentBulkJob.id, "running", "Verification complete — resuming application");
    }
    if (currentBulkTabId) {
      if (bulkWatchdogTimer) clearTimeout(bulkWatchdogTimer);
      bulkWatchdogTimer = setTimeout(() => {
        if (isBulkApplying && currentBulkTabId) {
          advanceBulkQueue("TIMEOUT");
        }
      }, 60000);
    }
    broadcastBulkProgress({
      status: "PROCESSING",
      current: bulkCurrentIndex + 1,
      total: bulkApplyQueue.length,
      run_id: currentBulkRunId,
      job: {
        id: currentBulkJob?.id,
        title: currentBulkJob?.title,
        company: currentBulkJob?.company,
      },
      message: "Challenge resolved! Continuing application...",
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "RESUME_BULK_AFTER_CHALLENGE") {
    console.log("[JobPilot Bulk] User triggered RESUME_BULK_AFTER_CHALLENGE.");
    bulkPausedForChallenge = false;
    if (currentBulkTabId) {
      chrome.tabs.sendMessage(currentBulkTabId, { action: "RESUME_AUTOPILOT" }, () => {
        const _ = chrome.runtime.lastError;
      });
      if (bulkWatchdogTimer) clearTimeout(bulkWatchdogTimer);
      bulkWatchdogTimer = setTimeout(() => {
        if (isBulkApplying && currentBulkTabId) {
          advanceBulkQueue("TIMEOUT");
        }
      }, 45000);
      broadcastBulkProgress({
        status: "PROCESSING",
        current: bulkCurrentIndex + 1,
        total: bulkApplyQueue.length,
        run_id: currentBulkRunId,
        job: {
          id: currentBulkJob?.id,
          title: currentBulkJob?.title,
          company: currentBulkJob?.company,
        },
        message: "Resuming application...",
      });
    } else {
      advanceBulkQueue("CHALLENGE_RESUMED_TAB_CLOSED");
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "SKIP_BULK_CHALLENGE") {
    console.log("[JobPilot Bulk] User requested skipping challenged job.");
    bulkPausedForChallenge = false;
    if (currentBulkJob) {
      postBulkItemStatus(currentBulkJob.id, "skipped_ineligible", "Skipped by candidate after challenge");
      recordApplicationToBackend({
        job_id: currentBulkJob.id,
        url: currentBulkJob.url,
        title: currentBulkJob.title,
        company: currentBulkJob.company,
        status: "MANUAL_APPLY_NEEDED",
        bulk_status: "skipped_ineligible",
        reason: "Skipped by candidate after challenge",
        run_id: currentBulkRunId,
      });
    }
    advanceBulkQueue("USER_SKIPPED_CHALLENGE");
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "START_BULK_APPLY") {
    const queue = message.queue || [];
    if (queue.length === 0) {
      sendResponse({ success: false, error: "Empty queue" });
      return true;
    }
    (async () => {
      bulkPausedForChallenge = false;
      const run = await startBulkRunOnBackend(queue, message.experience_filter || "Any");
      currentBulkRunId = run?.id || null;
      // Merge preflight terminal statuses from backend
      const preflight = {};
      (run?.items || []).forEach((it) => {
        preflight[it.job_id_snapshot] = { status: it.status, reason: it.reason };
      });
      bulkApplyQueue = queue.map((j) => ({
        ...j,
        _preflightStatus: preflight[j.id]?.status || "queued",
        _preflightReason: preflight[j.id]?.reason || "",
      }));
      bulkCurrentIndex = 0;
      isBulkApplying = true;
      isAdvancingQueue = false;
      broadcastBulkProgress({
        status: "STARTED",
        total: bulkApplyQueue.length,
        current: 0,
        run_id: currentBulkRunId,
        items: run?.items || [],
      });
      processNextInBulkQueue();
      sendResponse({ success: true, count: queue.length, run_id: currentBulkRunId });
    })();
    return true;
  }

  if (message.action === "CANCEL_BULK_APPLY") {
    console.log("[JobPilot Bulk] User initiated CANCEL_BULK_APPLY. Halting all queues and timers.");
    isBulkApplying = false;
    isAdvancingQueue = false;
    bulkPausedForChallenge = false;
    bulkApplyQueue = [];
    if (currentBulkRunId) {
      chrome.storage.local.get(["backend_url"], (data) => {
        const backendUrl = data.backend_url || DEFAULT_BACKEND_URL;
        fetch(`${backendUrl}/api/jobs/bulk-apply/${currentBulkRunId}/cancel/`, { method: "POST" }).catch(() => {});
      });
    }
    currentBulkRunId = null;
    if (bulkWatchdogTimer) {
      clearTimeout(bulkWatchdogTimer);
      bulkWatchdogTimer = null;
    }
    if (advanceTimeout) {
      clearTimeout(advanceTimeout);
      advanceTimeout = null;
    }
    if (currentBulkTabId) {
      const tabToClose = currentBulkTabId;
      currentBulkTabId = null;
      try {
        chrome.tabs.remove(tabToClose, () => {});
      } catch (e) {}
    }
    broadcastBulkProgress({
      status: "CANCELLED",
      message: "Bulk Auto-Pilot stopped & queue cleared.",
      run_id: null,
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "GET_PROFILE") {
    chrome.storage.local.get(["candidate_profile", "backend_status", "profile_last_synced"], async (res) => {
      if (res && res.candidate_profile) {
        sendResponse(res);
      } else {
        const syncRes = await fetchAndCacheProfile();
        sendResponse({ candidate_profile: syncRes.profile || null });
      }
    });
    return true;
  }

  // Launch job application tab purely in BACKGROUND without switching tabs or stealing screen
  if (message.action === "LAUNCH_BACKGROUND_APPLY") {
    const jobUrl = message.url;
    chrome.tabs.create({ url: jobUrl, active: false }, (tab) => {
      console.log(`[JobPilot] Opened apply tab ID ${tab.id} in BACKGROUND (active: false): ${jobUrl}`);
      sendResponse({ success: true, tabId: tab.id });
    });
    return true;
  }

  // Close tab after application submission
  if (message.action === "CLOSE_TAB") {
    const tabId = sender.tab ? sender.tab.id : message.tabId;
    if (tabId) {
      setTimeout(() => {
        try {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: "MAIN",
            func: () => {
              try {
                window.onbeforeunload = null;
                window.addEventListener("beforeunload", (e) => {
                  e.stopImmediatePropagation();
                  delete e.returnValue;
                }, true);
              } catch (e) {}
            }
          }, () => {
            const _ = chrome.runtime.lastError;
            try {
              chrome.tabs.remove(tabId, () => {
                const _err = chrome.runtime.lastError;
                console.log(`[JobPilot] Closed apply tab ID ${tabId} after submission.`);
              });
            } catch (e) {}
          });
        } catch (e) {
          try {
            chrome.tabs.remove(tabId, () => {});
          } catch (e2) {}
        }
      }, 1200);
      sendResponse({ success: true });
    }
    return true;
  }


  // Execute click in page's MAIN execution world (bypasses CSP & triggers React fibers directly)
  if (message.action === "MAIN_WORLD_CLICK") {
    const tabId = sender.tab ? sender.tab.id : message.tabId;
    if (!tabId) {
      sendResponse({ success: false, error: "Missing tabId" });
      return true;
    }
    const selector = message.selector || "";
    const textPattern = message.text || "";

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: "MAIN",
      args: [selector, textPattern],
      func: (sel, pattern) => {
        try {
          let target = null;
          if (sel) {
            try { target = document.querySelector(sel); } catch (e) {}
          }
          if (!target && window.location.hostname.includes("indeed")) {
            const rightPane = document.querySelector("#jobsearch-ViewjobPaneWrapper, #viewJobSSRRoot, .jobsearch-RightPane, [data-testid='jobsearch-JobComponent'], .fastviewjob");
            if (rightPane) {
              target = rightPane.querySelector("#indeedApplyButton button, button#indeedApplyButton, [data-testid='indeedApplyButton'], [data-testid='indeed-apply-button'], button");
            }
          }
          if (!target && pattern) {
            const els = Array.from(document.querySelectorAll("button, a, [role='button'], [role='option'], div#indeedApplyButton, div[data-testid*='apply'], [data-testid*='submit'], div[class*='option'], li"));
            target = els.find(e => {
              const t = (e.innerText || e.value || e.getAttribute("aria-label") || "").trim().toLowerCase();
              return t === pattern.toLowerCase() || t.includes(pattern.toLowerCase());
            });
          }
          if (target) {
            // Safety: Never click file inputs or upload dropzones in MAIN world to avoid OS dialogs
            const tag = (target.tagName || "").toLowerCase();
            const type = (target.getAttribute("type") || "").toLowerCase();
            const isUpload = Boolean(
              (tag === "input" && type === "file") ||
              target.closest("input[type='file'], [class*='dropzone'], [class*='upload-area'], label[for*='file'], label[for*='resume'], label[for*='upload']") ||
              target.querySelector("input[type='file']")
            );
            if (isUpload) {
              console.warn("[JobPilot MAIN world] Blocked click on file upload trigger.");
              return false;
            }

            target.focus();
            // Direct React handler invocation (both onClick and onMouseDown for React-Select)
            const propKey = Object.keys(target).find(k => k.startsWith("__reactProps") || k.startsWith("__reactFiber") || k.startsWith("__reactEventHandlers"));
            if (propKey && target[propKey]) {
              const onClickHandler = target[propKey].onClick || (target[propKey].memoizedProps && target[propKey].memoizedProps.onClick);
              const onMouseDownHandler = target[propKey].onMouseDown || (target[propKey].memoizedProps && target[propKey].memoizedProps.onMouseDown);
              if (typeof onMouseDownHandler === "function") {
                try {
                  onMouseDownHandler({
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    isTrusted: true,
                    target: target,
                    currentTarget: target,
                    nativeEvent: new MouseEvent("mousedown", { bubbles: true, cancelable: true })
                  });
                } catch (e) {}
              }
              if (typeof onClickHandler === "function") {
                try {
                  onClickHandler({
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    isTrusted: true,
                    target: target,
                    currentTarget: target,
                    nativeEvent: new MouseEvent("click", { bubbles: true, cancelable: true })
                  });
                } catch (e) {}
              }
            }
            target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            try { target.click(); } catch (e) {}
            return true;
          }
        } catch (err) {
          console.warn("[JobPilot MAIN world click exception]:", err);
        }
        return false;
      }
    }, (results) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        const success = results && results[0] && results[0].result;
        sendResponse({ success: !!success });
      }
    });
    return true;
  }

  // Low-level hardware mouse click using Chrome DevTools Protocol (isTrusted: true) with Bezier trajectory
  if (message.action === "HARDWARE_CLICK") {
    const tabId = sender.tab ? sender.tab.id : message.tabId;
    const x = Math.round(message.x);
    const y = Math.round(message.y);

    if (!tabId || isNaN(x) || isNaN(y)) {
      sendResponse({ success: false, error: "Invalid coordinates or tabId" });
      return true;
    }

    // Dispatch mouse events directly in background WITHOUT switching or focusing the tab!
    const doDispatch = () => {
        // Calculate smooth curved trajectory from last position to target (x, y)
        const startPos = tabMousePositions[tabId] || {
          x: Math.max(20, x - Math.floor(Math.random() * 200 + 80)),
          y: Math.max(20, y - Math.floor(Math.random() * 150 + 60))
        };

        const steps = 3;
        const curvePoints = [];
        const controlX = (startPos.x + x) / 2 + (Math.random() * 30 - 15);
        const controlY = (startPos.y + y) / 2 + (Math.random() * 30 - 15);

        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const bx = Math.round((1 - t) * (1 - t) * startPos.x + 2 * (1 - t) * t * controlX + t * t * x);
          const by = Math.round((1 - t) * (1 - t) * startPos.y + 2 * (1 - t) * t * controlY + t * t * y);
          curvePoints.push({ x: bx, y: by });
        }

        // Dispatch intermediate mouse trajectory
        let pointIdx = 0;
        const dispatchNextMove = () => {
          if (pointIdx < curvePoints.length) {
            const pt = curvePoints[pointIdx++];
            chrome.debugger.sendCommand({ tabId: tabId }, "Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: pt.x,
              y: pt.y
            }, () => {
              const _cmdErr = chrome.runtime.lastError;
              setTimeout(dispatchNextMove, Math.floor(Math.random() * 20 + 15));
            });
          } else {
            // Reached target coordinate. Natural mouse down
            chrome.debugger.sendCommand({ tabId: tabId }, "Input.dispatchMouseEvent", {
              type: "mousePressed",
              x: x,
              y: y,
              button: "left",
              clickCount: 1
            }, () => {
              const _downErr = chrome.runtime.lastError;
              // Human mouse hold duration: 65ms - 115ms
              const clickHoldDuration = Math.floor(Math.random() * (115 - 65 + 1)) + 65;
              setTimeout(() => {
                chrome.debugger.sendCommand({ tabId: tabId }, "Input.dispatchMouseEvent", {
                  type: "mouseReleased",
                  x: x,
                  y: y,
                  button: "left",
                  clickCount: 1
                }, () => {
                  const _upErr = chrome.runtime.lastError;
                  tabMousePositions[tabId] = { x, y };
                  sendResponse({ success: true });
                });
              }, clickHoldDuration);
            });
          }
        };

        dispatchNextMove();
      };

    try {
      chrome.debugger.attach({ tabId: tabId }, "1.3", () => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || "";
          if (msg.includes("already attached")) {
            doDispatch();
            return;
          }
          sendResponse({ success: false, error: msg });
          return;
        }
        doDispatch();
      });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  // Fetch candidate active resume PDF for automated file upload
  if (message.action === "GET_RESUME_FILE") {
    chrome.storage.local.get(["backend_url", "candidate_profile", "cached_resume_base64", "cached_resume_url", "cached_resume_filename"], async (data) => {
      // 1. Resolve active/primary resume from candidate profile
      const backendUrl = data.backend_url || DEFAULT_BACKEND_URL;
      let resumeUrl = `${backendUrl}/media/resumes/Tushar_Gupta_CSE_2027_.pdf`;
      let filename = "Tushar_Gupta_CSE_2027_.pdf";

      const profile = data.candidate_profile;
      if (profile && Array.isArray(profile.resumes) && profile.resumes.length > 0) {
        const primary = profile.resumes.find(r => r.is_primary) || profile.resumes[0];
        if (primary) {
          if (primary.filename) filename = primary.filename;
          if (primary.file_url) {
            resumeUrl = primary.file_url.startsWith("http") ? primary.file_url : `${backendUrl}${primary.file_url}`;
          } else if (primary.file) {
            resumeUrl = primary.file.startsWith("http") ? primary.file : `${backendUrl}${primary.file}`;
          }
        }
      }

      // 2. Check if already cached in local storage for THIS exact resume URL and filename
      if (data.cached_resume_base64 && data.cached_resume_url === resumeUrl && data.cached_resume_filename === filename) {
        sendResponse({
          success: true,
          filename: filename,
          base64: data.cached_resume_base64,
          mimeType: "application/pdf"
        });
        return;
      }

      // 3. Fresh fetch from Django backend
      try {
        const resp = await fetch(resumeUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          const reader = new FileReader();
          reader.onloadend = () => {
            const b64 = reader.result;
            chrome.storage.local.set({
              cached_resume_base64: b64,
              cached_resume_url: resumeUrl,
              cached_resume_filename: filename
            });
            sendResponse({
              success: true,
              filename: filename,
              base64: b64,
              mimeType: "application/pdf"
            });
          };
          reader.readAsDataURL(blob);
          return;
        }
      } catch (err) {
        console.warn("[JobPilot] Resume fetch error:", err.message);
      }

      // 3. Infallible fallback: Use embedded base64 from resume_data.js
      if (typeof CANDIDATE_RESUME_BASE64 !== "undefined" && CANDIDATE_RESUME_BASE64) {
        const fullBase64 = CANDIDATE_RESUME_BASE64.startsWith("data:")
          ? CANDIDATE_RESUME_BASE64
          : `data:application/pdf;base64,${CANDIDATE_RESUME_BASE64}`;
        chrome.storage.local.set({ cached_resume_base64: fullBase64 });
        sendResponse({
          success: true,
          filename: (typeof CANDIDATE_RESUME_FILENAME !== "undefined" ? CANDIDATE_RESUME_FILENAME : filename),
          base64: fullBase64,
          mimeType: "application/pdf"
        });
        return;
      }

      sendResponse({ success: false, error: "Resume file not found" });
    });
    return true;
  }

  // Inject MAIN world resume suppression and upload hook
  if (message.action === "SETUP_MAIN_WORLD_RESUME_HOOK") {
    const tabId = sender?.tab?.id || message.tabId;
    if (!tabId) {
      sendResponse({ success: false, error: "No target tab ID" });
      return true;
    }

    function mainWorldResumeAndDeclarationHook(resumeData) {
      if (window.__jobpilot_main_installed) {
        if (resumeData) window.__jobpilot_resume_data = resumeData;
        return;
      }
      window.__jobpilot_main_installed = true;
      window.__jobpilot_resume_data = resumeData;

      function buildResumeFile() {
        const data = window.__jobpilot_resume_data;
        if (!data || !data.base64) return null;
        try {
          const b64 = data.base64.includes(",") ? data.base64.split(",")[1] : data.base64;
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: data.mimeType || "application/pdf" });
          return new File([blob], data.filename || "Tushar_Gupta_CSE_2027_.pdf", {
            type: data.mimeType || "application/pdf",
            lastModified: Date.now()
          });
        } catch (e) {
          console.error("[JobPilot MAIN] Error building File:", e);
          return null;
        }
      }

      function injectFile(inputEl) {
        const file = buildResumeFile();
        if (!file || !inputEl) return false;
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
          if (desc) {
            try { desc.call(inputEl, dt.files); } catch (e) { inputEl.files = dt.files; }
          } else {
            inputEl.files = dt.files;
          }

          inputEl.dispatchEvent(new Event("input", { bubbles: true, composed: true, cancelable: true }));
          inputEl.dispatchEvent(new Event("change", { bubbles: true, composed: true, cancelable: true }));

          if (typeof inputEl.onchange === "function") {
            try { inputEl.onchange({ target: inputEl, currentTarget: inputEl, bubbles: true }); } catch (e) {}
          }

          const rKey = Object.keys(inputEl).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
          if (rKey && inputEl[rKey] && typeof inputEl[rKey].onChange === "function") {
            try { inputEl[rKey].onChange({ target: inputEl, currentTarget: inputEl, bubbles: true }); } catch (e) {}
          }
          console.log("[JobPilot MAIN] ✅ Injected candidate CV into file input and dispatched change event!");
          return true;
        } catch (e) {
          console.error("[JobPilot MAIN] Error injecting file:", e);
          return false;
        }
      }

      // 1. Monkey-patch HTMLInputElement.prototype.click in MAIN WORLD
      const origClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type === "file") {
          console.log("[JobPilot MAIN] Intercepted file input .click()! Suppressing OS dialog and injecting resume...");
          injectFile(this);
          return;
        }
        return origClick.apply(this, arguments);
      };

      // 2. Observe DOM in MAIN WORLD for dynamically added file inputs
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.tagName === "INPUT" && node.type === "file") {
              console.log("[JobPilot MAIN] Caught dynamically added file input:", node);
              setTimeout(() => injectFile(node), 10);
            }
          }
        }
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

      // 3. Expose global helper in MAIN world to trigger Cutshort's declaration check
      window.__jobpilot_check_declaration = function () {
        const labels = Array.from(document.querySelectorAll("label"));
        const declLabel = labels.find(l => (l.innerText || "").toLowerCase().includes("i hereby declare"));
        if (!declLabel) return false;

        const checkImg = declLabel.querySelector("img[src*='success_icon'], img");
        if (checkImg && window.getComputedStyle(checkImg).opacity === "1") {
          console.log("[JobPilot MAIN] Declaration is ALREADY checked!");
          return true;
        }

        const rKey = Object.keys(declLabel).find(k => k.startsWith("__reactProps") || k.startsWith("__reactFiber"));
        if (rKey) {
          const props = declLabel[rKey]?.memoizedProps || declLabel[rKey];
          if (props?.children?.[0]?.props?.children?.props?.isSelected === true) {
            console.log("[JobPilot MAIN] Declaration is ALREADY checked via React props!");
            return true;
          }
        }

        console.log("[JobPilot MAIN] Clicking Declaration label to check...");
        if (rKey && typeof declLabel[rKey]?.onClick === "function") {
          try { declLabel[rKey].onClick({ preventDefault: () => {}, stopPropagation: () => {} }); } catch (e) { declLabel.click(); }
        } else if (rKey && typeof declLabel[rKey]?.memoizedProps?.onClick === "function") {
          try { declLabel[rKey].memoizedProps.onClick({ preventDefault: () => {}, stopPropagation: () => {} }); } catch (e) { declLabel.click(); }
        } else {
          declLabel.click();
        }
        declLabel.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        return true;
      };

      // 4. Global helper to trigger resume upload in Cutshort
      window.__jobpilot_trigger_cutshort_resume = function () {
        const modal = document.querySelector("div[role='dialog'], [aria-modal='true'], div[class*='modal']") || document.body;
        const uploadText = Array.from(modal.querySelectorAll("span, p, a, button, div")).find(el => {
          const t = (el.innerText || "").trim().toLowerCase();
          return (t === "upload resume" || t.startsWith("upload resume")) && el.children.length <= 1;
        });
        if (!uploadText) return false;

        let p = uploadText;
        let target = uploadText;
        for (let i = 0; i < 5 && p && p !== document.body; i++) {
          const rKey = Object.keys(p).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
          if (rKey && typeof p[rKey]?.onClick === "function") {
            target = p;
            break;
          }
          p = p.parentElement;
        }

        const rKey = Object.keys(target).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
        if (rKey && typeof target[rKey]?.onClick === "function") {
          try { target[rKey].onClick({ bubbles: true, preventDefault: () => {}, stopPropagation: () => {} }); } catch (e) {}
        }
        try { target.click(); } catch (e) {}
        try { uploadText.click(); } catch (e) {}
        return true;
      };
    }

    try {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: "MAIN",
        func: mainWorldResumeAndDeclarationHook,
        args: [message.resumeData]
      }, (results) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn("[JobPilot] executeScript MAIN world warning:", err.message);
          sendResponse({ success: false, error: err.message });
        } else {
          console.log("[JobPilot] Successfully installed MAIN world hook on tab", tabId);
          sendResponse({ success: true });
        }
      });
    } catch (err) {
      console.warn("[JobPilot] executeScript exception:", err.message);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  // Dedicated Cutshort Resume Uploader in MAIN world (Direct S3 integration)
  if (message.action === "TRIGGER_CUTSHORT_RESUME_MAIN") {
    const tabId = sender?.tab?.id || message.tabId;
    if (!tabId) {
      sendResponse({ success: false, error: "No target tab ID" });
      return true;
    }

    function runCutshortDirectUpload(resumePayload) {
      try {
        console.log("[JobPilot Cutshort MAIN] Initiating direct resume injection...");
        if (resumePayload) window.__jobpilot_resume_data = resumePayload;

        const data = window.__jobpilot_resume_data;
        if (!data || !data.base64) {
          console.error("[JobPilot Cutshort MAIN] Missing resume base64 data!");
          return false;
        }

        const b64 = data.base64.includes(",") ? data.base64.split(",")[1] : data.base64;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: data.mimeType || "application/pdf" });
        const candidateFile = new File([blob], data.filename || "Tushar_Gupta_CSE_2027_.pdf", {
          type: data.mimeType || "application/pdf",
          lastModified: Date.now()
        });

        // 1. Monkey patch HTMLInputElement.prototype.click in MAIN world so ANY input[type='file'] gets candidateFile
        const origClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
          if (this.type === "file") {
            console.log("[JobPilot Cutshort MAIN] Intercepted Cutshort file input click! Feeding candidate PDF...");
            try {
              const dt = new DataTransfer();
              dt.items.add(candidateFile);
              try {
                const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
                if (desc) desc.call(this, dt.files);
                else this.files = dt.files;
              } catch (e) {
                this.files = dt.files;
              }

              this.dispatchEvent(new Event("input", { bubbles: true, composed: true, cancelable: true }));
              this.dispatchEvent(new Event("change", { bubbles: true, composed: true, cancelable: true }));

              if (typeof this.onchange === "function") {
                try { this.onchange({ target: this, currentTarget: this, bubbles: true }); } catch (e) {}
              }
              console.log("[JobPilot Cutshort MAIN] ✅ Successfully dispatched change event with resume file!");
            } catch (err) {
              console.error("[JobPilot Cutshort MAIN] Error injecting file into input:", err);
            }
            // DO NOT open native OS file picker!
            return;
          }
          return origClick.apply(this, arguments);
        };

        // 2. Find Cutshort's "Upload resume" element in the active modal
        const modal = document.querySelector("div[role='dialog'], [aria-modal='true'], div[class*='modal']") || document.body;
        const uploadElements = Array.from(modal.querySelectorAll("span, p, a, button, div")).filter(el => {
          const t = (el.innerText || "").trim().toLowerCase();
          return (t === "upload resume" || t.startsWith("upload resume")) && el.children.length <= 1;
        });

        if (uploadElements.length === 0) {
          console.log("[JobPilot Cutshort MAIN] 'Upload resume' element not found in modal.");
          return false;
        }

        const uploadTrigger = uploadElements[0];
        console.log("[JobPilot Cutshort MAIN] Found 'Upload resume' element:", uploadTrigger);

        // 3. Find React onClick handler on ancestors
        let el = uploadTrigger;
        let clickedViaReact = false;
        for (let i = 0; i < 5 && el && el !== document.body; i++) {
          const rKey = Object.keys(el).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers") || k.startsWith("__reactFiber"));
          if (rKey) {
            const props = el[rKey]?.memoizedProps || el[rKey];
            if (typeof props?.onClick === "function") {
              try {
                console.log("[JobPilot Cutshort MAIN] Calling React onClick on ancestor:", el);
                props.onClick({ bubbles: true, preventDefault: () => {}, stopPropagation: () => {} });
                clickedViaReact = true;
                break;
              } catch (e) {
                console.warn("[JobPilot Cutshort MAIN] React onClick error:", e);
              }
            }
          }
          el = el.parentElement;
        }

        if (!clickedViaReact) {
          console.log("[JobPilot Cutshort MAIN] Clicking element directly as fallback...");
          try { uploadTrigger.click(); } catch (e) {}
          try { if (uploadTrigger.parentElement) uploadTrigger.parentElement.click(); } catch (e) {}
        }

        // 4. Also ensure Cutshort's declaration checkbox is checked
        setTimeout(() => {
          try {
            const labels = Array.from(document.querySelectorAll("label"));
            const declLabel = labels.find(l => (l.innerText || "").toLowerCase().includes("i hereby declare"));
            if (declLabel) {
              const checkImg = declLabel.querySelector("img[src*='success_icon'], img");
              const isChecked = checkImg && window.getComputedStyle(checkImg).opacity === "1";
              if (!isChecked) {
                console.log("[JobPilot Cutshort MAIN] Checking declaration checkbox...");
                declLabel.click();
              }
            }
          } catch (e) {}
        }, 600);

        return true;
      } catch (err) {
        console.error("[JobPilot Cutshort MAIN] Direct upload exception:", err);
        return false;
      }
    }

    try {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: "MAIN",
        func: runCutshortDirectUpload,
        args: [message.resumeData]
      }, (results) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn("[JobPilot] TRIGGER_CUTSHORT_RESUME_MAIN error:", err.message);
          sendResponse({ success: false, error: err.message });
        } else {
          console.log("[JobPilot] TRIGGER_CUTSHORT_RESUME_MAIN executed successfully!");
          sendResponse({ success: true, result: results?.[0]?.result });
        }
      });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  // Execute snippet in tab's MAIN world (CSP-safe)
  if (message.action === "EXECUTE_IN_MAIN_WORLD") {
    const tabId = sender?.tab?.id || message.tabId;
    if (!tabId || !message.code) {
      sendResponse({ success: false });
      return true;
    }

    function safeMainWorldRunner(codeStr) {
      try {
        if (codeStr.includes("check_declaration") && typeof window.__jobpilot_check_declaration === "function") {
          return window.__jobpilot_check_declaration();
        }
        if (codeStr.includes("trigger_cutshort_resume") && typeof window.__jobpilot_trigger_cutshort_resume === "function") {
          return window.__jobpilot_trigger_cutshort_resume();
        }
        return new Function(codeStr)();
      } catch (e) {
        console.warn("[JobPilot MAIN] Runner warning:", e.message);
      }
    }

    try {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: "MAIN",
        func: safeMainWorldRunner,
        args: [message.code]
      }, () => {
        const _e = chrome.runtime.lastError;
        sendResponse({ success: true });
      });
    } catch (err) {
      console.warn("[JobPilot] EXECUTE_IN_MAIN_WORLD error:", err.message);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  // Enable CDP file chooser interception on tab
  if (message.action === "TRIGGER_RESUME_UPLOAD_CDP") {
    const handleTab = (targetTabId) => {
      if (!targetTabId) {
        sendResponse({ success: false, error: "No target tab ID" });
        return;
      }

      chrome.tabs.get(targetTabId, (tabInfo) => {
        const tabUrl = (tabInfo?.url || "").toLowerCase();
        const isJobUrl = (
          tabUrl.includes("cutshort.io") ||
          tabUrl.includes("indeed.com") ||
          tabUrl.includes("wellfound.com") ||
          tabUrl.includes("linkedin.com") ||
          tabUrl.includes("greenhouse.io") ||
          tabUrl.includes("lever.co") ||
          tabUrl.includes("myworkdayjobs.com") ||
          tabUrl.includes("workday.com") ||
          tabUrl.includes("smartrecruiters.com") ||
          tabUrl.includes("ashbyhq.com") ||
          tabUrl.includes("bamboohr.com") ||
          tabUrl.includes("workable.com") ||
          tabUrl.includes("/job") ||
          tabUrl.includes("/career") ||
          tabUrl.includes("/apply")
        );
        const isBlacklisted = (
          tabUrl.includes("zoom.us") ||
          tabUrl.includes("zoom.com") ||
          tabUrl.includes("edubricks") ||
          tabUrl.includes("google.") ||
          tabUrl.includes("youtube.com") ||
          tabUrl.includes("localhost") ||
          tabUrl.includes("127.0.0.1")
        );
        if (!isJobUrl || isBlacklisted) {
          console.log("[JobPilot CDP] Blocked debugger attach on non-job tab:", tabUrl);
          sendResponse({ success: false, blocked: true });
          return;
        }

        const enableChooser = () => {
          chrome.debugger.sendCommand({ tabId: targetTabId }, "Page.enable", {}, () => {
            const _pErr = chrome.runtime.lastError;
            chrome.debugger.sendCommand({ tabId: targetTabId }, "DOM.enable", {}, () => {
              const _dErr = chrome.runtime.lastError;
              chrome.debugger.sendCommand({ tabId: targetTabId }, "Page.setInterceptFileChooserDialog", { enabled: true }, () => {
                const cErr = chrome.runtime.lastError;
                if (cErr) {
                  console.warn("[JobPilot CDP] setInterceptFileChooserDialog error:", cErr.message);
                  sendResponse({ success: false, error: cErr.message });
                } else {
                  console.log("[JobPilot CDP] ✅ File chooser interception active on tab", targetTabId);
                  sendResponse({ success: true, enabled: true });
                }
              });
            });
          });
        };

        try {
          chrome.debugger.attach({ tabId: targetTabId }, "1.3", () => {
            const aErr = chrome.runtime.lastError?.message || "";
            if (aErr && !aErr.includes("already attached")) {
              console.warn("[JobPilot CDP] Debugger attach error:", aErr);
              sendResponse({ success: false, error: aErr });
              return;
            }
            enableChooser();
          });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      });
    };

    const tabId = sender?.tab?.id || message.tabId;
    if (tabId) {
      handleTab(tabId);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        handleTab(tabs?.[0]?.id);
      });
    }
    return true;
  }
});

