/**
 * JobPilot Copilot - Popup Controller
 */

document.addEventListener("DOMContentLoaded", async () => {
  const connectionBadge = document.getElementById("connectionBadge");
  const connectionText = document.getElementById("connectionText");
  const candidateName = document.getElementById("candidateName");
  const candidateTitle = document.getElementById("candidateTitle");
  const candidateEmail = document.getElementById("candidateEmail");
  const candidatePhone = document.getElementById("candidatePhone");
  const candidateLocation = document.getElementById("candidateLocation");
  const candidateResume = document.getElementById("candidateResume");
  const avatarText = document.getElementById("avatarText");
  const currentDomain = document.getElementById("currentDomain");
  const btnAutoFill = document.getElementById("btnAutoFill");
  const btnSync = document.getElementById("btnSync");
  const actionFeedback = document.getElementById("actionFeedback");

  // 1. Detect Active Tab
  let activeTab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      activeTab = tabs[0];
      const url = new URL(activeTab.url || "about:blank");
      currentDomain.textContent = url.hostname.replace("www.", "") || "Local Page";
    }
  } catch (e) {
    currentDomain.textContent = "Unknown Tab";
  }

  // 2. Load cached profile or sync
  await refreshProfileUI();

  // 3. Auto-Fill Click Handler
  btnAutoFill.addEventListener("click", async () => {
    if (!activeTab || !activeTab.id) {
      showFeedback("Cannot access current tab.", "error");
      return;
    }

    btnAutoFill.disabled = true;
    btnAutoFill.innerHTML = `<span>Filling fields...</span>`;

    try {
      // Send fill trigger to content script
      chrome.tabs.sendMessage(
        activeTab.id,
        { action: "TRIGGER_AUTOFILL" },
        (response) => {
          btnAutoFill.disabled = false;
          btnAutoFill.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            <span>Auto-Fill This Page</span>
          `;

          if (chrome.runtime.lastError) {
            showFeedback("Content script ready on reload or refreshed page.", "error");
            return;
          }

          if (response && response.success) {
            showFeedback(`⚡ Auto-filled ${response.count} fields!`, "success");
          } else {
            showFeedback(response?.message || "No matching form fields detected.", "error");
          }
        }
      );
    } catch (err) {
      btnAutoFill.disabled = false;
      showFeedback(`Error: ${err.message}`, "error");
    }
  });

  // 4. Sync Click Handler
  btnSync.addEventListener("click", async () => {
    btnSync.disabled = true;
    btnSync.textContent = "Syncing...";
    
    chrome.runtime.sendMessage({ action: "SYNC_PROFILE" }, async (response) => {
      btnSync.disabled = false;
      btnSync.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
        Sync with Backend
      `;
      await refreshProfileUI();
      if (response && response.success) {
        showFeedback("Profile synced from JobPilot backend!", "success");
      } else {
        showFeedback("Failed to connect to http://127.0.0.1:8000", "error");
      }
    });
  });

  // Helper: Refresh Profile UI
  async function refreshProfileUI() {
    chrome.storage.local.get(["candidate_profile", "backend_status"], (res) => {
      const p = res.candidate_profile;
      const isConnected = res.backend_status === "CONNECTED";

      if (isConnected) {
        connectionBadge.className = "badge badge-connected";
        connectionText.textContent = "Connected (8000)";
      } else {
        connectionBadge.className = "badge badge-disconnected";
        connectionText.textContent = "Offline (8000)";
      }

      if (p) {
        candidateName.textContent = p.full_name || "Candidate";
        candidateTitle.textContent = p.title || "Software Engineer";
        candidateEmail.textContent = p.email || "-";
        candidatePhone.textContent = p.phone || "-";
        candidateLocation.textContent = p.location || "-";

        const candidateGithub = document.getElementById("candidateGithub");
        const candidateLinkedin = document.getElementById("candidateLinkedin");
        if (candidateGithub) {
          candidateGithub.textContent = (p.github_url || p.verified_answers?.github_url || "https://github.com/TusharGupta4").replace("https://", "");
        }
        if (candidateLinkedin) {
          candidateLinkedin.textContent = (p.linkedin_url || p.verified_answers?.linkedin_url || "https://linkedin.com/in/tushargupta04").replace("https://", "");
        }

        // Initials
        if (p.full_name) {
          const parts = p.full_name.trim().split(/\s+/);
          avatarText.textContent = parts.map(n => n[0].toUpperCase()).slice(0, 2).join("");
        }

        // Active Resume
        if (p.resumes && p.resumes.length > 0) {
          const primaryCv = p.resumes.find(r => r.is_primary) || p.resumes[0];
          candidateResume.textContent = primaryCv.filename || "Attached Resume";
          candidateResume.title = primaryCv.filename;
        } else {
          candidateResume.textContent = "No resume attached";
        }
      }
    });
  }

  // Helper: Show Feedback Message
  function showFeedback(text, type) {
    actionFeedback.textContent = text;
    actionFeedback.className = `feedback-banner ${type}`;
    actionFeedback.classList.remove("hidden");
    setTimeout(() => {
      actionFeedback.classList.add("hidden");
    }, 4500);
  }
});
