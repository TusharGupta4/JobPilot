/**
 * JobPilot Copilot - Content Script
 * Semantic In-Browser Form Field Matcher & Floating Copilot UI
 */

(function () {
  // Prevent duplicate execution
  if (window.__jobpilot_copilot_injected) return;
  window.__jobpilot_copilot_injected = true;

  // Disarm native beforeunload prompts that freeze Chrome background tab removal
  try {
    window.onbeforeunload = null;
    window.addEventListener("beforeunload", (e) => {
      e.stopImmediatePropagation();
      delete e.returnValue;
    }, true);
  } catch (e) {}

  console.log("[JobPilot Copilot] Injected into:", window.location.hostname);

  let candidateProfile = null;
  let cachedResumeFile = null;
  let isFetchingResume = false;
  let startAutoPilotFn = null;

  function isExtensionAlive() {
    try {
      return Boolean(typeof chrome !== "undefined" && chrome?.runtime && chrome?.runtime?.id);
    } catch (e) {
      return false;
    }
  }

  function safeSendMessage(msg, cb) {
    if (!isExtensionAlive()) {
      if (cb) cb({ success: false, error: "EXTENSION_DISCONNECTED" });
      return;
    }
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime?.lastError) {
          if (cb) cb({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (cb) cb(res || { success: true });
      });
    } catch (err) {
      if (cb) cb({ success: false, error: err.message });
    }
  }

  function safeStorageGet(keys, cb) {
    if (!isExtensionAlive()) {
      if (cb) cb({});
      return;
    }
    try {
      chrome.storage.local.get(keys, (res) => {
        if (chrome.runtime?.lastError) {
          if (cb) cb({});
          return;
        }
        if (cb) cb(res || {});
      });
    } catch (err) {
      if (cb) cb({});
    }
  }

  const isDashboard = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  // 1. Dashboard Event Bridge (ONLY when on localhost:3000 / 127.0.0.1:3000)
  if (isDashboard) {
    window.addEventListener("JOBPILOT_DISPATCH_APPLY", (e) => {
      if (!e.detail || !e.detail.url) return;

      if (!isExtensionAlive()) {
        console.warn("[JobPilot Copilot] Extension context invalidated or reloaded. Dispatching REFRESH_NEEDED.");
        window.dispatchEvent(new CustomEvent("JOBPILOT_EXTENSION_NEEDS_REFRESH"));
        return;
      }

      console.log("[JobPilot] Dispatching background apply for:", e.detail.company, e.detail.url);

      safeSendMessage({
        action: "LAUNCH_BACKGROUND_APPLY",
        url: e.detail.url,
        jobId: e.detail.jobId,
        company: e.detail.company,
        title: e.detail.title
      }, (res) => {
        if (res && res.success) {
          console.log("[JobPilot] Background tab created successfully (ID: " + res.tabId + ")");
          window.dispatchEvent(new CustomEvent("JOBPILOT_APPLY_DISPATCHED", { detail: { success: true, tabId: res.tabId } }));
        } else {
          console.warn("[JobPilot] Background tab launch failed:", res?.error);
          window.dispatchEvent(new CustomEvent("JOBPILOT_EXTENSION_NEEDS_REFRESH"));
        }
      });
    });

    window.addEventListener("JOBPILOT_BULK_APPLY", (e) => {
      if (!e.detail || !e.detail.queue || !e.detail.queue.length) return;

      if (!isExtensionAlive()) {
        window.dispatchEvent(new CustomEvent("JOBPILOT_EXTENSION_NEEDS_REFRESH"));
        return;
      }

      console.log("[JobPilot] Starting Bulk Auto-Apply for", e.detail.queue.length, "jobs.");
      safeSendMessage({
        action: "START_BULK_APPLY",
        queue: e.detail.queue,
        experience_filter: e.detail.experience_filter || "Any",
      }, (res) => {
        if (res && res.success) {
          window.dispatchEvent(new CustomEvent("JOBPILOT_BULK_STARTED", {
            detail: { count: res.count, run_id: res.run_id },
          }));
        } else {
          console.warn("[JobPilot] START_BULK_APPLY failed:", res?.error);
          window.dispatchEvent(new CustomEvent("JOBPILOT_EXTENSION_NEEDS_REFRESH"));
        }
      });
    });

    window.addEventListener("JOBPILOT_CANCEL_BULK_APPLY", () => {
      if (!isExtensionAlive()) return;
      console.log("[JobPilot] Cancelling Bulk Auto-Apply.");
      safeSendMessage({ action: "CANCEL_BULK_APPLY" });
    });

    window.addEventListener("JOBPILOT_RESUME_CHALLENGE", () => {
      if (!isExtensionAlive()) return;
      console.log("[JobPilot] Resuming bulk queue after challenge resolution.");
      safeSendMessage({ action: "RESUME_BULK_AFTER_CHALLENGE" });
    });

    window.addEventListener("JOBPILOT_SKIP_CHALLENGE", () => {
      if (!isExtensionAlive()) return;
      console.log("[JobPilot] User requested skipping challenged job.");
      safeSendMessage({ action: "SKIP_BULK_CHALLENGE" });
    });

    // Dashboard does not run copilot widget, autofill, or debugger
    return;
  }

  // 2. Strict Non-Job Page Guard: Completely halt execution on personal / non-job websites (Zoom, Edubricks, YouTube, Google, etc.)
  if (!isActualJobApplicationPage()) {
    console.log("[JobPilot Copilot] Non-job domain detected. Inactive on:", window.location.hostname);
    return;
  }

  // 3. Genuine Job Application Page Initialization
  safeStorageGet(["candidate_profile"], (res) => {
    if (res && res.candidate_profile) {
      candidateProfile = res.candidate_profile;
      initCopilotWidget();
    } else {
      safeSendMessage({ action: "GET_PROFILE" }, (bgRes) => {
        if (bgRes && bgRes.candidate_profile) {
          candidateProfile = bgRes.candidate_profile;
        }
        initCopilotWidget();
      });
    }
  });

  // Pre-load candidate resume file and arm MAIN world hooks immediately upon loading job application page
  preloadResumeFile();

  let cachedResumeBase64 = null;

  async function preloadResumeFile() {
    if (cachedResumeFile || isFetchingResume) return cachedResumeFile;
    isFetchingResume = true;
    try {
      const res = await new Promise((resolve) => {
        safeSendMessage({ action: "GET_RESUME_FILE" }, resolve);
        setTimeout(() => resolve(null), 3500);
      });
      if (res && res.success && res.base64) {
        cachedResumeBase64 = res.base64;
        const base64Data = res.base64.includes(",") ? res.base64.split(",")[1] : res.base64;
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: res.mimeType || "application/pdf" });
        cachedResumeFile = new File([blob], res.filename || "Tushar_Gupta_CSE_2027_.pdf", { type: res.mimeType || "application/pdf" });
        console.log("[JobPilot] Preloaded candidate CV file successfully:", cachedResumeFile.name);

        // Arm background script to execute MAIN world hook via chrome.scripting.executeScript
        await new Promise((r) => {
          safeSendMessage({
            action: "SETUP_MAIN_WORLD_RESUME_HOOK",
            resumeData: {
              base64: res.base64,
              filename: res.filename || "Tushar_Gupta_CSE_2027_.pdf",
              mimeType: res.mimeType || "application/pdf"
            }
          }, r);
          setTimeout(r, 600);
        });

        // Also broadcast custom event for any in-page bridge
        window.dispatchEvent(new CustomEvent("JOBPILOT_SET_RESUME_BLOB", {
          detail: {
            base64: res.base64,
            filename: res.filename || "Tushar_Gupta_CSE_2027_.pdf",
            mimeType: res.mimeType || "application/pdf"
          }
        }));
      }
    } catch (e) {
      console.warn("[JobPilot] Failed to preload resume file:", e);
    } finally {
      isFetchingResume = false;
    }
    return cachedResumeFile;
  }

  // Intercept HTMLInputElement.prototype.click to prevent native OS file picker dialog from opening
  // and automatically feed candidate CV file to any dynamically created file input (Cutshort, Next.js, ATS)
  if (!window.__jobpilot_file_click_hooked) {
    window.__jobpilot_file_click_hooked = true;
    const origInputClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === "file") {
        console.log("[JobPilot] Intercepted file input .click()! Suppressing native OS dialog...");
        if (cachedResumeFile) {
          try {
            const dt = new DataTransfer();
            dt.items.add(cachedResumeFile);
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
            if (nativeSetter) {
              try { nativeSetter.call(this, dt.files); } catch (e) { this.files = dt.files; }
            } else {
              this.files = dt.files;
            }
            this.dispatchEvent(new Event("input", { bubbles: true, composed: true, cancelable: true }));
            this.dispatchEvent(new Event("change", { bubbles: true, composed: true, cancelable: true }));
            console.log("[JobPilot] ✅ Synthesized resume file into file input without opening OS file picker!");
          } catch (err) {
            console.warn("[JobPilot] Error synthesizing files into clicked file input:", err);
          }
        }
        // Suppress native dialog: DO NOT invoke origInputClick on file inputs!
        return;
      }
      return origInputClick.apply(this, arguments);
    };
  }

  // 3. Listen for messages from background & popup
  if (isExtensionAlive()) {
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "TRIGGER_AUTOFILL") {
          const result = executeSemanticAutofill();
          sendResponse(result);
          return true;
        }

        if (message.action === "BULK_PROGRESS_UPDATE") {
          window.dispatchEvent(new CustomEvent("JOBPILOT_BULK_PROGRESS", { detail: message.detail }));
          sendResponse({ received: true });
          return true;
        }

        if (message.action === "RESUME_AUTOPILOT") {
          console.log("[JobPilot Copilot] 🔄 RESUME_AUTOPILOT message received from background.");
          if (typeof startAutoPilotFn === "function") {
            startAutoPilotFn();
          } else if (typeof initCopilotWidget === "function") {
            initCopilotWidget();
          }
          sendResponse({ received: true });
          return true;
        }
      });
    } catch (err) {
      console.warn("[JobPilot Copilot] Message listener registration warning:", err);
    }
  }

  /**
   * Extracts precise company name and job role from page / modal / portal header
   */
  function getJobDetails() {
    let company = "";
    let role = "";

    // 1. Look for Wellfound Modal headers: e.g. "APPLY TO \n Company \n Software Engineer"
    const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="dialog"]') || document.body;
    const allText = modal?.innerText || "";
    const match = allText.match(/APPLY TO\s*\n\s*([^\n]+)(?:\s*\n\s*([^\n$]+))?/i);
    if (match) {
      company = match[1]?.trim() || "";
      role = match[2]?.trim() || "";
    }

    // 2. Cutshort Modal headers: e.g. "You are applying for Tech Intern - Frontend ... at Springer Capital"
    if (!company) {
      const cutshortMatch = allText.match(/applying for\s+([^\n]+?)\s+at\s+([^\n]+)/i);
      if (cutshortMatch) {
        role = cutshortMatch[1]?.trim() || "";
        company = cutshortMatch[2]?.trim() || "";
      }
    }

    // 3. Indeed Split View & ViewJob headers
    if (window.location.hostname.includes("indeed")) {
      const indeedPane = document.querySelector(
        "#jobsearch-ViewjobPaneWrapper, #viewJobSSRRoot, .jobsearch-RightPane, [data-testid='jobsearch-JobComponent'], .fastviewjob"
      );
      if (indeedPane) {
        const compEl = indeedPane.querySelector(
          "[data-testid='inlineHeader-companyName'], [class*='companyName'], [data-company-name='true'], .jobsearch-CompanyInfoContainer a"
        );
        if (compEl) company = compEl.innerText.trim();

        const roleEl = indeedPane.querySelector(
          "h1, [data-testid='simpler-jobTitle'], [class*='jobsearch-JobInfoHeader-title']"
        );
        if (roleEl) role = roleEl.innerText.trim();
      }
    }

    // 4. Main page headers
    if (!company) {
      const compEl = document.querySelector(
        "[class*='companyName'], [class*='company-name'], [data-test='JobListingCompanyName'], h2 a, .jobsearch-CompanyInfoContainer"
      );
      if (compEl) company = compEl.innerText.trim();
    }

    if (!role) {
      const roleEl = document.querySelector("h1, [class*='jobTitle'], [class*='job-title']");
      if (roleEl) role = roleEl.innerText.trim();
    }

    // 5. Fallback to document title / URL
    if (!company) {
      const parts = document.title.split(/[-–|]/).map(s => s.trim());
      if (parts.length >= 2) {
        company = parts[0].includes("at ") ? parts[0].split("at ")[1] : parts[0];
        role = parts[0].includes("at ") ? parts[0].split("at ")[0] : parts[1];
      } else {
        company = parts[0] || "Target Company";
      }
    }

    // Clean up strings (strip newlines, leading/trailing whitespace)
    company = (company || "").replace(/[\n\r]+/g, " ").trim();
    role = (role || "").replace(/[\n\r]+/g, " ").trim();

    return {
      company: company || "Company",
      role: role || "Software Engineer",
      title: role || "Software Engineer"
    };
  }

  /**
   * Universal Toast Notification helper - safe to call from any function or scope
   */
  function showToast(msg, className = "jp-toast-info") {
    console.log("[JobPilot Toast]", msg);
    try {
      let toast = document.querySelector("#jpToast");
      if (!toast && document.body) {
        toast = document.createElement("div");
        toast.id = "jpToast";
        toast.className = `jp-toast ${className}`;
        toast.style.position = "fixed";
        toast.style.bottom = "24px";
        toast.style.right = "24px";
        toast.style.zIndex = "999999";
        toast.style.padding = "10px 16px";
        toast.style.borderRadius = "8px";
        toast.style.fontSize = "13px";
        toast.style.fontWeight = "500";
        toast.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
        document.body.appendChild(toast);
      }
      if (toast) {
        toast.textContent = msg;
        toast.className = `jp-toast ${className}`;
        toast.style.display = "block";
        if (window.__jpToastTimer) clearTimeout(window.__jpToastTimer);
        window.__jpToastTimer = setTimeout(() => {
          try {
            if (toast) toast.style.display = "none";
          } catch (e) {}
        }, 4000);
      }
    } catch (e) {}
  }

  /**
   * Dispatches framework-safe input events so React, Vue, and Angular register the change
   */
  function setNativeInputValue(element, value) {
    if (!element || value === undefined || value === null) return false;

    try {
      element.focus();
      const isTextArea = element.tagName.toLowerCase() === "textarea";
      const prototype = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

      // Reset React value tracker so React's internal duplicate detection triggers onChange
      try {
        const tracker = element._valueTracker;
        if (tracker) tracker.setValue("");
      } catch (e) {}

      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new Event("focus", { bubbles: true }));
      element.dispatchEvent(new Event("input", { bubbles: true }));
      try {
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      } catch (ie) {}
      element.dispatchEvent(new Event("change", { bubbles: true }));

      // Invoke React's synthetic onChange if attached via React Props
      try {
        const rKey = Object.keys(element).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
        if (rKey && element[rKey]?.onChange) {
          element[rKey].onChange({ target: element, currentTarget: element, bubbles: true });
        }
      } catch (e) {}

      element.dispatchEvent(new Event("blur", { bubbles: true }));

      element.classList.add("jobpilot-filled-highlight");
      return true;
    } catch (err) {
      console.warn("[JobPilot] Error setting value on element:", err);
      return false;
    }
  }

  /**
   * Stealth Human Typing Simulator: Types text character-by-character with
   * natural jitter, keystroke events (keydown, keypress, input, keyup), and micro-pauses.
   * Completely defeats biometric bot detection (Datadog, Cloudflare, Akamai).
   */
  async function typeNativeInputValue(element, value, isFast = false) {
    if (!element || value === undefined || value === null) return false;
    try {
      element.focus();
      try { element.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}

      // Clear existing value safely
      const isTextArea = element.tagName.toLowerCase() === "textarea";
      const prototype = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

      // Reset React value tracker so React's internal duplicate detection triggers onChange
      try {
        const tracker = element._valueTracker;
        if (tracker) tracker.setValue("");
      } catch (e) {}

      if (descriptor && descriptor.set) {
        descriptor.set.call(element, "");
      } else {
        element.value = "";
      }
      element.dispatchEvent(new Event("focus", { bubbles: true }));

      const strVal = String(value);
      let currentVal = "";

      for (let i = 0; i < strVal.length; i++) {
        const char = strVal[i];
        currentVal += char;

        if (descriptor && descriptor.set) {
          descriptor.set.call(element, currentVal);
        } else {
          element.value = currentVal;
        }

        // Dispatch full keyboard event telemetry for biometric sensors
        const charCode = char.charCodeAt(0);
        const eventInit = {
          key: char,
          code: `Key${char.toUpperCase()}`,
          keyCode: charCode,
          which: charCode,
          bubbles: true,
          cancelable: true,
          composed: true
        };

        element.dispatchEvent(new KeyboardEvent("keydown", eventInit));
        element.dispatchEvent(new KeyboardEvent("keypress", eventInit));
        try {
          element.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            cancelable: false,
            composed: true,
            inputType: "insertText",
            data: char
          }));
        } catch (ie) {
          element.dispatchEvent(new Event("input", { bubbles: true }));
        }
        element.dispatchEvent(new KeyboardEvent("keyup", eventInit));

        // Realistic typing jitter: 45ms to 95ms per keystroke (approx 55-75 WPM)
        if (!isFast) {
          let delay = Math.floor(Math.random() * (95 - 45 + 1)) + 45;
          // Natural cognitive pauses on word boundaries or email symbols
          if (char === " " || char === "@" || char === "." || char === "-" || char === "_") {
            delay += Math.floor(Math.random() * (160 - 80 + 1)) + 80;
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      element.dispatchEvent(new Event("change", { bubbles: true }));

      // Invoke React's synthetic onChange if attached via React Props
      try {
        const rKey = Object.keys(element).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
        if (rKey && element[rKey]?.onChange) {
          element[rKey].onChange({ target: element, currentTarget: element, bubbles: true });
        }
      } catch (e) {}

      element.dispatchEvent(new Event("blur", { bubbles: true }));
      element.classList.add("jobpilot-filled-highlight");
      return true;
    } catch (err) {
      console.warn("[JobPilot Stealth] Error in human typing, falling back to direct input:", err);
      return setNativeInputValue(element, value);
    }
  }

  let hasCompletedPageWarmup = false;

  /**
   * Page Reading Warmup Simulator:
   * Simulates a real human user scanning the job posting (scrolling down to read role details,
   * pausing, scrolling back to CTA) before clicking Apply.
   */
  /**
   * Page Reading Warmup Simulator:
   * Simulates a real human user scanning the job posting before clicking Apply.
   */
  async function simulateHumanWarmupAndRead() {
    if (hasCompletedPageWarmup) return true;
    console.log("[JobPilot Stealth] 🛡️ Running human reading & page warmup simulation...");

    // Smooth subtle cognitive dwell time (600ms - 950ms)
    const initialWait = Math.floor(Math.random() * (950 - 600 + 1)) + 600;
    await new Promise((r) => setTimeout(r, initialWait));

    try {
      window.scrollBy({ top: 180, behavior: "smooth" });
    } catch (e) {
      window.scrollBy(0, 180);
    }
    await new Promise((r) => setTimeout(r, 450));

    try {
      window.scrollBy({ top: -180, behavior: "smooth" });
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 300));

    hasCompletedPageWarmup = true;
    console.log("[JobPilot Stealth] 🛡️ Human reading warmup complete.");
    return true;
  }

  /**
   * Safely triggers React synthetic event handlers on the element (onClick, onMouseDown)
   * without creating inline <script> tags (100% CSP compliant)
   */
  function invokeMainWorldClick(element) {
    if (!element) return;
    try {
      element.focus();
      const propKey = Object.keys(element).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers") || k.startsWith("__reactFiber"));
      if (propKey && element[propKey]) {
        // 1. onMouseDown (Crucial for React-Select option selection)
        const onDown = element[propKey].onMouseDown || (element[propKey].memoizedProps && element[propKey].memoizedProps.onMouseDown);
        if (typeof onDown === "function") {
          try {
            onDown({
              preventDefault: () => {},
              stopPropagation: () => {},
              isTrusted: true,
              target: element,
              currentTarget: element,
              nativeEvent: new MouseEvent("mousedown", { bubbles: true, cancelable: true })
            });
          } catch (e) {}
        }

        // 2. onClick (Buttons, links, action triggers)
        const handler = element[propKey].onClick || (element[propKey].memoizedProps && element[propKey].memoizedProps.onClick);
        if (typeof handler === "function") {
          try {
            handler({
              preventDefault: () => {},
              stopPropagation: () => {},
              isTrusted: true,
              target: element,
              currentTarget: element,
              nativeEvent: new MouseEvent("click", { bubbles: true, cancelable: true })
            });
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  /**
   * Simulates full mouse click sequence to reliably trigger React/Next.js onClick handlers
   */
  function simulateUserClick(element) {
    if (!element) return false;

    // CRITICAL SAFETY CHECK: NEVER simulate click on file inputs or upload trigger buttons!
    // A click on an <input type="file"> or <label for="file"> causes the browser to open the native Windows File Dialog.
    try {
      const tag = (element.tagName || "").toLowerCase();
      const type = (element.getAttribute("type") || "").toLowerCase();
      const text = (element.innerText || element.value || element.getAttribute("aria-label") || "").toLowerCase();
      const isFileInput = tag === "input" && type === "file";
      const isUploadTrigger = Boolean(
        isFileInput ||
        element.closest("input[type='file'], [class*='dropzone'], [class*='upload-area'], label[for*='file'], label[for*='resume'], label[for*='upload']") ||
        element.querySelector("input[type='file']") ||
        (tag === "label" && (element.getAttribute("for") || "").toLowerCase().includes("resume")) ||
        (text.includes("browse") && (text.includes("file") || text.includes("resume") || text.includes("upload")))
      );
      if (isUploadTrigger) {
        console.warn("[JobPilot] Blocked simulateUserClick on file upload element to prevent native OS file dialog.");
        return false;
      }
    } catch (e) {}

    try {
      try { element.scrollIntoView({ behavior: "instant", block: "center" }); } catch (e) {}
      try { element.focus(); } catch (e) {}

      const rect = element.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const eventOpts = { bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, button: 0, buttons: 1 };

      // 1. Send hardware-level click to background script (CDP Input.dispatchMouseEvent isTrusted: true)
      if (rect.width > 0 && rect.height > 0) {
        safeSendMessage({
          action: "HARDWARE_CLICK",
          x: clientX,
          y: clientY
        });
      }

      // 2. Send MAIN_WORLD_CLICK to background script (executes in page's React context via chrome.scripting)
      let elSel = "";
      if (element.id) elSel = `#${element.id}`;
      else if (element.getAttribute("data-testid")) elSel = `[data-testid="${element.getAttribute("data-testid")}"]`;
      const btnText = (element.innerText || element.value || element.getAttribute("aria-label") || "").trim();
      safeSendMessage({
        action: "MAIN_WORLD_CLICK",
        selector: elSel,
        text: btnText
      });

      // 3. Directly trigger React synthetic handler in page world
      invokeMainWorldClick(element);

      // 4. Dispatch native Pointer & Mouse events
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
        try {
          if (type.startsWith("pointer") && typeof PointerEvent !== "undefined") {
            element.dispatchEvent(new PointerEvent(type, eventOpts));
          } else {
            element.dispatchEvent(new MouseEvent(type, eventOpts));
          }
        } catch (e) {
          element.dispatchEvent(new MouseEvent(type, eventOpts));
        }
      });

      try { element.click(); } catch (e) {}
      return true;
    } catch (err) {
      console.warn("[JobPilot] Error simulating user click:", err);
      try { element.click(); } catch (e) {}
      return true;
    }
  }

  /**
   * Helper to retrieve context strings for an input (id, name, placeholder, label)
   */
  function getFieldContext(input) {
    const parts = [
      input.getAttribute("name") || "",
      input.getAttribute("id") || "",
      input.getAttribute("placeholder") || "",
      input.getAttribute("aria-label") || "",
      input.getAttribute("autocomplete") || "",
      input.getAttribute("value") || "",
      input.className || ""
    ];

    // Check associated <label>
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) parts.push(label.innerText || "");
    }

    // Check parent label or wrapper
    const parentLabel = input.closest("label");
    if (parentLabel) parts.push(parentLabel.innerText || "");

    // Check next sibling (CRUCIAL for modern React checkboxes and radio buttons)
    if (input.nextElementSibling) {
      parts.push(input.nextElementSibling.innerText || "");
    }

    // Check preceding sibling or header text
    if (input.previousElementSibling) {
      parts.push(input.previousElementSibling.innerText || "");
    }
    const parent = input.parentElement;
    if (parent) {
      parts.push(parent.innerText || "");
      if (parent.previousElementSibling) {
        parts.push(parent.previousElementSibling.innerText || "");
      }
      if (parent.nextElementSibling) {
        parts.push(parent.nextElementSibling.innerText || "");
      }
    }

    const parentGroup = input.closest(".form-group, .form-field, fieldset, div[class*='field'], div[class*='group'], div[class*='question'], div[class*='card'], div");
    if (parentGroup) {
      const headerText = parentGroup.querySelector("label, span, p, h2, h3, h4, legend, div");
      if (headerText) parts.push(headerText.innerText || "");
    }

    return parts.join(" ").toLowerCase();
  }

  /**
   * Helper to set checkbox state safely for React / Controlled components without double-toggling
   */
  function setCheckboxState(chkEl, shouldBeChecked = true) {
    if (!chkEl) return;

    if (chkEl.checked !== shouldBeChecked) {
      const parent = chkEl.closest("label") || chkEl.parentElement || chkEl;
      try { parent.click(); } catch (e) {}
      try { chkEl.click(); } catch (e) {}
    }

    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
    if (desc && desc.set) {
      try { desc.set.call(chkEl, shouldBeChecked); } catch (e) { chkEl.checked = shouldBeChecked; }
    } else {
      chkEl.checked = shouldBeChecked;
    }

    if (chkEl._valueTracker) {
      chkEl._valueTracker.setValue(!shouldBeChecked);
    }

    chkEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    chkEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    const reactKey = Object.keys(chkEl).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
    if (reactKey && chkEl[reactKey] && typeof chkEl[reactKey].onChange === "function") {
      try { chkEl[reactKey].onChange({ target: chkEl, currentTarget: chkEl, bubbles: true }); } catch (e) {}
    }
  }

  /**
   * Helper to set radio button state safely for React / Controlled components
   */
  function setRadioState(radioEl) {
    if (!radioEl) return;

    const parent = radioEl.closest("label") || radioEl.parentElement || radioEl;
    try { parent.click(); } catch (e) {}
    try { radioEl.click(); } catch (e) {}

    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
    if (desc && desc.set) {
      try { desc.set.call(radioEl, true); } catch (e) { radioEl.checked = true; }
    } else {
      radioEl.checked = true;
    }

    if (radioEl._valueTracker) {
      radioEl._valueTracker.setValue(false);
    }

    radioEl.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    radioEl.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    const reactKey = Object.keys(radioEl).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
    if (reactKey && radioEl[reactKey] && typeof radioEl[reactKey].onChange === "function") {
      try { radioEl[reactKey].onChange({ target: radioEl, currentTarget: radioEl, bubbles: true }); } catch (e) {}
    }
  }

  /**
   * Dedicated Modal Specific Questions Resolver (Cutshort, Indeed, Wellfound, ATS)
   * Handles Employment status ("Not working currently"), Declaration ("I hereby declare..."), Salary & Office preferences
   */
  function resolveModalSpecificQuestions(modalRoot) {
    const searchRoot = modalRoot || document;

    // 1. Employment Status: Select "Not working currently" (Candidate is Fresher / Student)
    const allEls = Array.from(searchRoot.querySelectorAll("label, [role='radio'], div, span, p, input[type='radio']"));
    const notWorkingEls = allEls.filter(el => {
      const t = (el.innerText || el.value || "").trim().toLowerCase();
      return (t === "not working currently" || t.startsWith("not working currently") || t === "not_working") && t.length < 40 && el.offsetWidth > 0;
    });

    for (const opt of notWorkingEls) {
      const clickable = opt.closest("label") || opt.closest("div[class*='radio'], div[class*='item'], div.flex") || opt;
      const radio = clickable.querySelector("input[type='radio']") || opt.querySelector("input[type='radio']") || (opt.tagName.toLowerCase() === "input" ? opt : null);

      try { clickable.click(); } catch (e) {}
      try { opt.click(); } catch (e) {}
      simulateUserClick(clickable);

      if (radio) {
        setRadioState(radio);
      }
      console.log("[JobPilot Cutshort] Resolved Employment Status -> 'Not working currently'");
    }

    // Direct input[type='radio'] search for employment status
    const allRadios = Array.from(searchRoot.querySelectorAll("input[type='radio']"));
    for (const r of allRadios) {
      const rText = (r.value + " " + (r.closest("label")?.innerText || "") + " " + (r.parentElement?.innerText || "")).toLowerCase();
      if (rText.includes("not working") || rText.includes("not_working") || rText.includes("unemployed") || rText.includes("fresher")) {
        try { r.closest("label")?.click(); } catch (e) {}
        try { r.click(); } catch (e) {}
        setRadioState(r);
        console.log("[JobPilot Cutshort] Directly selected employment radio:", r);
      }
    }

    // 2. Declaration Checkbox: "I hereby declare that the information furnished in my resume and talent card are true..."
    const declLabel = Array.from(searchRoot.querySelectorAll("label")).find(el => {
      const t = (el.innerText || "").toLowerCase();
      return t.includes("i hereby declare") || (t.includes("declare") && t.includes("talent card"));
    }) || Array.from(searchRoot.querySelectorAll("div, p")).filter(el => {
      const t = (el.innerText || "").toLowerCase();
      return (t.includes("i hereby declare") || (t.includes("declare") && t.includes("talent card"))) && el.offsetWidth > 0;
    }).pop();

    if (declLabel) {
      const checkImg = declLabel.querySelector("img[src*='success_icon'], img");
      let isChecked = false;
      if (checkImg) {
        const op = window.getComputedStyle(checkImg).opacity;
        if (op === "1") isChecked = true;
      }
      
      const rKey = Object.keys(declLabel).find(k => k.startsWith("__reactProps") || k.startsWith("__reactFiber"));
      if (rKey) {
        const props = declLabel[rKey]?.memoizedProps || declLabel[rKey];
        if (props?.children?.[0]?.props?.children?.props?.isSelected === true) {
          isChecked = true;
        }
      }

      if (declLabel.getAttribute("aria-checked") === "true" || declLabel.classList.contains("checked")) {
        isChecked = true;
      }

      if (!isChecked) {
        if (!window.__jobpilot_last_decl_time || Date.now() - window.__jobpilot_last_decl_time > 2000) {
          window.__jobpilot_last_decl_time = Date.now();
          console.log("[JobPilot Cutshort] Declaration checkbox is UNCHECKED. Clicking label once...");
          
          safeSendMessage({
            action: "EXECUTE_IN_MAIN_WORLD",
            code: "window.__jobpilot_check_declaration && window.__jobpilot_check_declaration()"
          });

          if (rKey && typeof declLabel[rKey]?.onClick === "function") {
            try { declLabel[rKey].onClick({ preventDefault: () => {}, stopPropagation: () => {} }); } catch (e) { declLabel.click(); }
          } else if (rKey && typeof declLabel[rKey]?.memoizedProps?.onClick === "function") {
            try { declLabel[rKey].memoizedProps.onClick({ preventDefault: () => {}, stopPropagation: () => {} }); } catch (e) { declLabel.click(); }
          } else {
            declLabel.click();
          }
          declLabel.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          console.log("[JobPilot Cutshort] Resolved Declaration Checkbox -> Checked");
        }
      } else {
        console.log("[JobPilot Cutshort] Declaration Checkbox already checked! Preserving state.");
      }
    }

    // 3. Salary Preference Checkbox: "Show current salary and minimum expected salary to employers"
    const salaryShowContainers = Array.from(searchRoot.querySelectorAll("label, div, span, input[type='checkbox']")).filter(el => {
      const t = (el.innerText || el.closest("label")?.innerText || "").toLowerCase();
      return t.includes("show current salary and minimum expected salary") && el.offsetWidth > 0;
    });
    for (const container of salaryShowContainers) {
      const chk = container.tagName.toLowerCase() === "input" ? container : container.querySelector("input[type='checkbox']");
      if (chk && !chk.checked) {
        try { chk.click(); } catch (e) {}
        setCheckboxState(chk, true);
      }
    }

    // 3b. Cutshort Salary Values: Current salary (0 Lacs) and Expected salary (6 Lacs)
    let curSalInput = searchRoot.querySelector("input[name='currentSalary']");
    let expSalInput = searchRoot.querySelector("input[name='desiredSalary']");

    // Fallback: look for inputs in sections matching "current or last drawn salary" and "minimum expected salary"
    if (!curSalInput || !expSalInput) {
      const allTextInputs = Array.from(searchRoot.querySelectorAll("input:not([type='checkbox']):not([type='radio']):not([type='hidden'])")).filter(i => i.offsetWidth > 0);
      for (const inp of allTextInputs) {
        const name = (inp.name || inp.id || "").toLowerCase();
        let parentText = "";
        let p = inp.parentElement;
        for (let i = 0; i < 4 && p && p !== document.body; i++) {
          parentText += " " + (p.innerText || "");
          p = p.parentElement;
        }
        parentText = parentText.toLowerCase();

        if (!curSalInput && (name.includes("current") || parentText.includes("current or last drawn salary") || parentText.includes("last drawn"))) {
          curSalInput = inp;
        }
        if (!expSalInput && (name.includes("desired") || name.includes("expected") || parentText.includes("minimum expected salary") || parentText.includes("expected salary"))) {
          expSalInput = inp;
        }
      }
    }

    // Fallback 2: Look inside the Salary preference container for any 2 non-checkbox inputs
    if (!curSalInput || !expSalInput) {
      const salarySection = Array.from(searchRoot.querySelectorAll("div, section, fieldset")).find(el => {
        const t = (el.innerText || "").toLowerCase();
        return (t.includes("salary preference") || (t.includes("last drawn") && t.includes("expected salary"))) && 
               el.querySelectorAll("input:not([type='checkbox']):not([type='radio'])").length >= 2;
      });
      if (salarySection) {
        const sInputs = Array.from(salarySection.querySelectorAll("input:not([type='checkbox']):not([type='radio'])")).filter(i => i.type !== "hidden" && i.offsetWidth > 0);
        if (sInputs.length >= 2) {
          curSalInput = curSalInput || sInputs[0];
          expSalInput = expSalInput || sInputs[1];
        }
      }
    }

    const setReactSalaryValue = (inp, val) => {
      if (!inp) return;
      inp.focus();
      const strVal = String(val);
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (desc && desc.set) {
        desc.set.call(inp, strVal);
      } else {
        inp.value = strVal;
      }
      if (inp._valueTracker) {
        inp._valueTracker.setValue("" + Math.random());
      }
      inp.dispatchEvent(new Event("focus", { bubbles: true }));
      inp.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      try {
        inp.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: strVal }));
      } catch (e) {}
      inp.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

      const reactKey = Object.keys(inp).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
      if (reactKey && inp[reactKey] && typeof inp[reactKey].onChange === "function") {
        try {
          inp[reactKey].onChange({ target: inp, currentTarget: inp, bubbles: true });
        } catch (e) {}
      }
      inp.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
    };

    // Fill Current Salary (0 Lacs for fresher/student)
    if (curSalInput) {
      console.log("[JobPilot Cutshort] Setting Current salary -> 0 Lacs on", curSalInput);
      setReactSalaryValue(curSalInput, "0");
    }

    // Fill Expected Salary (6 Lacs)
    if (expSalInput) {
      const expLacs = candidateProfile?.preferences?.min_salary ? String(Math.round(candidateProfile.preferences.min_salary / 100000)) : "6";
      console.log("[JobPilot Cutshort] Setting Expected salary ->", expLacs, "Lacs on", expSalInput);
      setReactSalaryValue(expSalInput, expLacs);
    }

    // 5. Clean up any stuck uncommitted text in multi-select location inputs & Cutshort tag adder (Screenshot 3)
    const isCutshort = window.location.hostname.includes("cutshort");
    const allSearchInputs = Array.from(searchRoot.querySelectorAll("input"));
    for (const locInp of allSearchInputs) {
      if (locInp.type === "checkbox" || locInp.type === "radio" || locInp.type === "hidden" || locInp.disabled) continue;

      const placeholder = (locInp.placeholder || "").toLowerCase();
      const name = (locInp.name || locInp.id || "").toLowerCase();
      const val = (locInp.value || "").trim().toLowerCase();

      // STRICT CHECK: Only touch inputs that are explicitly city/location/tag inputs!
      // NEVER touch number inputs (like Work experience = 0) or company inputs!
      const isLocationTagInput = (
        placeholder.includes("city") || 
        placeholder.includes("location") || 
        placeholder.includes("start typing a city") ||
        name.includes("city") ||
        name.includes("location") ||
        val === "india" ||
        val === "in"
      );

      if (!isLocationTagInput) continue;

      if (locInp.value) {
        console.log("[JobPilot Cutshort] Clearing stuck uncommitted input text in location tag box:", locInp.value);
        locInp.value = "";
        locInp.dispatchEvent(new Event("input", { bubbles: true }));
        locInp.dispatchEvent(new Event("change", { bubbles: true }));
        try { locInp.blur(); } catch (e) {}
      }
    }

    // 6. Dismiss any open Cutshort dropdown popover (e.g. Indianapolis, Indapur, India)
    if (isCutshort) {
      const openDropdowns = Array.from(document.querySelectorAll("div, ul")).filter(d => {
        if (d.offsetWidth <= 0 || d.offsetHeight <= 0) return false;
        const t = (d.innerText || "").toLowerCase();
        return (t.includes("indianapolis") || t.includes("indapur") || t.includes("india")) &&
               (d.classList.contains("z-50") || d.classList.contains("shadow") || d.classList.contains("absolute") || d.getAttribute("role") === "listbox");
      });
      for (const d of openDropdowns) {
        try { d.style.display = "none"; } catch (e) {}
      }
    }
  }

  /**
   * Resolves Yes/No and choice questions dynamically across Indeed SmartApply and portal forms.
   * Understands question intent and selects appropriate responses matching candidate profile.
   */
  async function resolveChoiceQuestions(scopeRoot) {
    const root = scopeRoot || document;

    // 1. Group-based choice resolution (Fieldsets, Radiogroups, Question containers)
    const questionGroups = Array.from(root.querySelectorAll(
      "fieldset, [role='radiogroup'], [data-testid*='question'], [data-testid*='Question'], div[class*='question'], div[class*='Question'], div[class*='form-group'], div[class*='ia-Questions-item']"
    ));

    for (const group of questionGroups) {
      if (group.offsetWidth === 0 || group.offsetHeight === 0) continue;

      const questionText = (
        group.querySelector("legend, label, h2, h3, h4, [class*='label'], [class*='header'], [class*='title'], [data-testid*='question-label']")?.innerText ||
        group.innerText || ""
      ).trim().toLowerCase();

      if (!questionText || questionText.length < 5) continue;

      // Find all options in this group (Yes, No, etc.)
      const optionEls = Array.from(group.querySelectorAll(
        "label, input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox'], div[class*='option'], div[class*='choice'], div[class*='Card'], div[class*='card'], button[role='radio']"
      )).filter(el => {
        const t = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().toLowerCase();
        return (t === "yes" || t === "no" || t.startsWith("yes") || t.startsWith("no")) && el.offsetWidth > 0;
      });

      if (optionEls.length === 0) continue;

      // Check if already answered in this group
      const hasAnswered = optionEls.some(opt => {
        if (opt.checked) return true;
        if (opt.getAttribute("aria-checked") === "true") return true;
        const inp = opt.querySelector("input[type='radio'], input[type='checkbox']");
        if (inp && inp.checked) return true;
        const cl = (opt.className || "").toLowerCase();
        return cl.includes("checked") || cl.includes("selected") || cl.includes("active");
      });

      if (hasAnswered) continue;

      // Determine correct answer based on question semantics
      let targetAnswer = "yes"; // Default positive for skills, learning, interview, relocation

      const isDisqualifier = (
        questionText.includes("visa sponsorship") ||
        questionText.includes("require sponsorship") ||
        questionText.includes("need sponsorship") ||
        questionText.includes("criminal") ||
        questionText.includes("felony") ||
        questionText.includes("convicted") ||
        questionText.includes("non-compete") ||
        questionText.includes("terminated for cause")
      );

      if (isDisqualifier) {
        targetAnswer = "no";
      }

      // Find the option matching target answer
      const chosen = optionEls.find(opt => {
        const t = (opt.innerText || opt.value || opt.getAttribute("aria-label") || "").trim().toLowerCase();
        return t === targetAnswer || t.startsWith(targetAnswer);
      });

      if (chosen) {
        console.log(`[JobPilot ChoiceEngine] Question: "${questionText.slice(0, 50)}..." -> Selected [${targetAnswer.toUpperCase()}]`);
        const clickable = chosen.closest("label") || chosen;
        try { clickable.focus(); } catch (e) {}
        simulateUserClick(clickable);
        try { clickable.click(); } catch (e) {}
        invokeMainWorldClick(clickable);
        const input = clickable.querySelector("input") || (clickable.getAttribute("for") ? document.getElementById(clickable.getAttribute("for")) : null) || (chosen.tagName.toLowerCase() === "input" ? chosen : null) || clickable.parentElement?.querySelector("input");
        if (input) {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        for (const el of [clickable, input].filter(Boolean)) {
          try {
            const rKey = Object.keys(el).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
            if (rKey && el[rKey]) {
              if (typeof el[rKey].onClick === "function") el[rKey].onClick({ target: el, currentTarget: el, bubbles: true });
              if (typeof el[rKey].onChange === "function") el[rKey].onChange({ target: el, currentTarget: el, bubbles: true });
            }
          } catch (e) {}
        }
        await new Promise(r => setTimeout(r, 120));
      }
    }

    // 2. Loose Yes / No options fallback (e.g. standalone custom card buttons without fieldset wrapper)
    const standaloneOptions = Array.from(root.querySelectorAll(
      "label, div[role='checkbox'], div[role='radio'], button[role='radio'], button[role='checkbox'], div[class*='Card'], div[class*='card']"
    )).filter(el => {
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
      const t = (el.innerText || "").trim().toLowerCase();
      return (t === "yes" || t === "no") && !el.closest("header, nav, footer");
    });

    for (let i = 0; i < standaloneOptions.length; i += 2) {
      const optA = standaloneOptions[i];
      const optB = standaloneOptions[i + 1];
      if (!optA || !optB) break;

      const tA = (optA.innerText || "").trim().toLowerCase();
      const tB = (optB.innerText || "").trim().toLowerCase();
      const isYesNoPair = (tA === "yes" && tB === "no") || (tA === "no" && tB === "yes");
      if (!isYesNoPair) continue;

      const yesOpt = tA === "yes" ? optA : optB;
      const noOpt = tA === "no" ? optA : optB;

      // Check if either is already checked
      const yesChecked = yesOpt.getAttribute("aria-checked") === "true" || yesOpt.classList.contains("checked") || Boolean(yesOpt.querySelector("input:checked"));
      const noChecked = noOpt.getAttribute("aria-checked") === "true" || noOpt.classList.contains("checked") || Boolean(noOpt.querySelector("input:checked"));
      if (yesChecked || noChecked) continue;

      // Extract preceding text/heading
      const container = yesOpt.closest("div[class*='container'], div[class*='item'], div[class*='section'], div") || yesOpt.parentElement;
      const ctxText = (container?.innerText || "").toLowerCase();

      let targetChoice = yesOpt;
      if (
        ctxText.includes("sponsorship") ||
        ctxText.includes("criminal") ||
        ctxText.includes("convicted") ||
        ctxText.includes("non-compete")
      ) {
        targetChoice = noOpt;
      }

      console.log(`[JobPilot ChoiceEngine] Standalone Yes/No resolved -> [${targetChoice === yesOpt ? "YES" : "NO"}]`);
      try { targetChoice.focus(); } catch (e) {}
      simulateUserClick(targetChoice);
      try { targetChoice.click(); } catch (e) {}
      invokeMainWorldClick(targetChoice);
      const input = targetChoice.querySelector("input") || (targetChoice.getAttribute("for") ? document.getElementById(targetChoice.getAttribute("for")) : null) || targetChoice.parentElement?.querySelector("input");
      if (input) {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      for (const el of [targetChoice, input].filter(Boolean)) {
        try {
          const rKey = Object.keys(el).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
          if (rKey && el[rKey]) {
            if (typeof el[rKey].onClick === "function") el[rKey].onClick({ target: el, currentTarget: el, bubbles: true });
            if (typeof el[rKey].onChange === "function") el[rKey].onChange({ target: el, currentTarget: el, bubbles: true });
          }
        } catch (e) {}
      }
      await new Promise(r => setTimeout(r, 120));
    }
  }

  async function ensureCandidateProfile() {
    if (candidateProfile) return candidateProfile;
    return new Promise((resolve) => {
      safeStorageGet(["candidate_profile"], (res) => {
        if (res && res.candidate_profile) {
          candidateProfile = res.candidate_profile;
          resolve(candidateProfile);
        } else {
          safeSendMessage({ action: "GET_PROFILE" }, (bgRes) => {
            if (bgRes && bgRes.candidate_profile) {
              candidateProfile = bgRes.candidate_profile;
            }
            resolve(candidateProfile);
          });
        }
      });
    });
  }

  /**
   * Extracts the screening question text or founder prompt for an input/textarea
   */
  function getQuestionPromptForElement(el) {
    if (!el) return "";

    // 0. Explicit label[for="id"] association
    if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl && (lbl.innerText || "").trim().length > 5) {
        return lbl.innerText.trim();
      }
    }

    // 1. Scan preceding siblings for heading or question prompt
    let prev = el.previousElementSibling;
    while (prev) {
      const text = (prev.innerText || "").trim();
      if (text.length > 8 && !text.includes("Is your profile up to date")) {
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        const qLine = lines.find(l => l.includes("?") || /interest|why|experience|role|stand out|note|comfortable|prompt|basic understanding/i.test(l)) || lines[lines.length - 1];
        if (qLine && qLine.length > 6) return qLine;
      }
      prev = prev.previousElementSibling;
    }

    // 2. Scan parent container for headings/labels/paragraphs
    const parent = el.closest(".form-group, .form-field, fieldset, div[class*='question'], div[class*='field'], div[class*='ia-Questions-item'], div, section, form");
    if (parent) {
      const headings = Array.from(parent.querySelectorAll("h1, h2, h3, h4, h5, h6, label, p, legend, [class*='label'], [class*='title'], [data-testid*='question-label']"));
      for (const h of headings) {
        const t = (h.innerText || "").trim();
        if (t.length > 8 && !t.includes("Is your profile up to date") && (t.includes("?") || /interest|why|experience|role|stand out|note|comfortable|prompt|basic understanding/i.test(t))) {
          return t;
        }
      }
    }

    // 3. Fallback placeholder or attribute
    const placeholder = el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
    if (placeholder.length > 8) return placeholder;

    // 4. Default for Cutshort / Wellfound / ATS founder notes
    if (window.location.hostname.includes("cutshort")) {
      const modalText = (el.closest("div[role='dialog'], [role='dialog'], [aria-modal='true'], div")?.innerText || document.body.innerText || "");
      const toMatch = modalText.match(/To\s*\n\s*([^\n\r]+)/i);
      const recipientName = toMatch ? toMatch[1].trim() : "";
      return `Write a brief, professional note to hiring manager ${recipientName || ""} expressing enthusiasm for this role and explaining why my software development, AI, and backend skills make me a strong fit.`;
    }

    if (window.location.hostname.includes("wellfound")) {
      return "What interests you about working for this company and how can you stand out as a candidate?";
    }

    return "Why are you interested in this role and what relevant skills and experience make you a strong candidate?";
  }

  /**
   * Main Semantic Autofill Function (Enhanced with Stealth Human Typing)
   */
  async function executeSemanticAutofill(scope, useHumanTyping = true) {
    if (!candidateProfile) {
      await ensureCandidateProfile();
    }
    if (!candidateProfile) {
      return { success: false, message: "Candidate profile not loaded yet. Click Sync in popup." };
    }

    // Strictly prevent running autofill on Indeed job view pages before application modal/iframe is open
    if (window.location.hostname.includes("indeed") && !window.location.hostname.includes("smartapply")) {
      const isAppPage = window.location.pathname.includes("/apply") ||
                        window.location.pathname.includes("/ia/") ||
                        Boolean(document.querySelector(".ia-BasePage, #indeedApplyModal, [data-testid*='ia-'], [data-testid='application-modal']"));
      if (!isAppPage && !scope) {
        console.log("[JobPilot Stealth] On Indeed job view page without application modal. Skipping autofill.");
        return { success: false, message: "On Indeed viewjob page; waiting for Apply modal to open." };
      }
    }

    const p = candidateProfile;
    const fullName = p.full_name || "Tushar Gupta";
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0] || "Tushar";
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
    const email = p.email || "basutushar1234@gmail.com";
    const phone = p.phone || "+91-7439973146";
    const city = p.verified_answers?.city || p.city || "Kolkata";
    const state = p.verified_answers?.state || p.state || "West Bengal";
    const address = p.verified_answers?.address || p.address || "Hindmotor";
    const postalCode = p.verified_answers?.postal_code || p.postal_code || "712233";
    const location = city ? `${city}, ${state}` : (p.location || "India");
    const title = p.title || "Full Stack & AI Developer | Python, Django, React & ML";

    // Detect social links from verified answers, profile, or bio
    let linkedinUrl = p.verified_answers?.linkedin_url || p.linkedin_url || "";
    let githubUrl = p.verified_answers?.github_url || p.github_url || "";
    if (!linkedinUrl && p.bio && p.bio.includes("linkedin.com")) {
      const m = p.bio.match(/https?:\/\/[^\s]*linkedin\.com\/[^\s]*/i);
      if (m) linkedinUrl = m[0];
    }
    if (!githubUrl && p.bio && p.bio.includes("github.com")) {
      const m = p.bio.match(/https?:\/\/[^\s]*github\.com\/[^\s]*/i);
      if (m) githubUrl = m[0];
    }
    if (!linkedinUrl) linkedinUrl = "https://linkedin.com/in/tushargupta04";
    if (!githubUrl) githubUrl = "https://github.com/TusharGupta4";
    const portfolioUrl = p.verified_answers?.portfolio_url || p.portfolio_url || githubUrl;

    const edu = (p.education && p.education.length > 0) ? p.education[0] : {};
    const collegeName = edu.institution || "MCKV Institute of Engineering";
    const degreeName = edu.degree || "Bachelor of Technology in Computer Science and Engineering";
    const gradYear = String(edu.end_year || "2027");
    const startYear = String(edu.start_year || "2023");
    const cgpaScore = edu.grade ? String(edu.grade).replace(/[^0-9.]/g, "") || "8.47" : "8.47";
    const skillsList = (p.skills && p.skills.length > 0) ? p.skills.join(", ") : "Python, Django, React, FastAPI, PostgreSQL, REST APIs, Git, GitHub";

    let filledCount = 0;
    const root = scope || document;

    // A. Resolve Portal & Modal specific questions (Cutshort, ATS, Indeed)
    try {
      resolveModalSpecificQuestions(root);
    } catch (e) {
      console.warn("[JobPilot] resolveModalSpecificQuestions warning:", e);
    }

    const allInputs = Array.from(root.querySelectorAll("input, textarea, select"));

    // Autocomplete dropdown resolver: clicks matching item in dropdown (Cutshort, ATS location/company)
    const resolveAutocompleteSelection = async (inputEl, expectedText) => {
      await new Promise((r) => setTimeout(r, 350));
      const options = Array.from(document.querySelectorAll(
        "[role='option'], [role='listbox'] > *, div[class*='option'], div[class*='suggestion'], div[class*='item'], li[class*='item'], div[class*='menu'] > div, div[class*='dropdown'] > div, div[class*='Select-menu'] > *, ul > li, div[class*='popover'] div, div[class*='autocomplete'] div, div[class*='results'] div, div[class*='list'] div, div[class*='z-50'] div, div[class*='shadow'] div"
      )).filter(opt => {
        if (opt.offsetWidth <= 0 || opt.offsetHeight <= 0) return false;
        if (opt.contains(inputEl) || opt === inputEl) return false;
        const text = (opt.innerText || "").trim().toLowerCase();
        return text.length > 0 && text.length < 60;
      });

      const targetLower = (expectedText || "").toLowerCase().trim();
      let matchedOpt = options.find(opt => (opt.innerText || "").trim().toLowerCase() === targetLower);
      if (!matchedOpt && options.length > 0) {
        matchedOpt = options.find(opt => (opt.innerText || "").trim().toLowerCase().startsWith(targetLower)) || options[0];
      }
      if (matchedOpt) {
        console.log("[JobPilot] Autocomplete option found:", matchedOpt.innerText.trim(), "- selecting!");
        try { matchedOpt.focus?.(); } catch (e) {}
        try { matchedOpt.click(); } catch (e) {}
        simulateUserClick(matchedOpt);
        await new Promise((r) => setTimeout(r, 200));
        return true;
      }
      // Fallback: Dispatch Enter key to commit selection
      inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      return false;
    };

    const fillField = async (inputEl, textVal, isAutocomplete = false) => {
      // Safety 1: On Cutshort, only skip location / city tag inputs (never touch location if tag already exists)
      if (window.location.hostname.includes("cutshort")) {
        const inputCtx = getFieldContext(inputEl);
        const placeholder = (inputEl.placeholder || "").toLowerCase();
        const inputName = (inputEl.name || inputEl.id || "").toLowerCase();
        const isLocationField = (
          placeholder.includes("city") ||
          placeholder.includes("location") ||
          inputName.includes("location") ||
          inputName.includes("city") ||
          inputCtx.includes("start typing a city") ||
          (inputCtx.includes("choose from the dropdown") && inputCtx.includes("city"))
        );
        if (isLocationField) {
          console.log("[JobPilot Cutshort] Skipping location tag input on Cutshort.");
          if (inputEl.value) {
            inputEl.value = "";
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            inputEl.dispatchEvent(new Event("change", { bubbles: true }));
            try { inputEl.blur(); } catch (e) {}
          }
          return;
        }
      }

      // Safety 2: Multi-select tag container with existing pills / tags (checking 10 levels up)
      let curr = inputEl.parentElement;
      for (let i = 0; i < 10 && curr && curr !== document.body; i++) {
        const text = (curr.innerText || "").toLowerCase();
        if (text.includes("×") || text.includes("x") || text.includes("kolkata") || text.includes("india")) {
          const pills = Array.from(curr.querySelectorAll("span, div, button, [class*='tag'], [class*='pill'], [class*='chip'], [class*='badge']")).filter(pEl => {
            const t = (pEl.innerText || "").trim().toLowerCase();
            return (t.endsWith(" x") || t.endsWith(" ×") || t.includes("×") || (pEl.querySelector("svg") && t.length > 2 && t.length < 35));
          });
          if (pills && pills.length > 0) {
            console.log("[JobPilot] Input is inside multi-select container with existing pills/tags. Skipping fill.");
            return;
          }
        }
        curr = curr.parentElement;
      }

      if (!inputEl.value && textVal) {
        const ok = useHumanTyping ? await typeNativeInputValue(inputEl, textVal) : setNativeInputValue(inputEl, textVal);
        if (ok) {
          filledCount++;
          if (useHumanTyping) {
            await new Promise((r) => setTimeout(r, Math.floor(Math.random() * (240 - 120 + 1)) + 120));
          }
          if (isAutocomplete || (inputEl.getAttribute("role") || "").includes("combobox") || inputEl.getAttribute("aria-autocomplete") || (inputEl.getAttribute("placeholder") || "").toLowerCase().includes("dropdown")) {
            await resolveAutocompleteSelection(inputEl, textVal);
          }
        }
      }
    };

    for (const el of allInputs) {
      // 1. Strictly block any search bar or header/nav input (do NOT block comboboxes inside application modals!)
      const id = (el.id || "").toLowerCase();
      const name = (el.getAttribute("name") || "").toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase();
      const type = (el.getAttribute("type") || "text").toLowerCase();
      const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();

      if (
        id.includes("jobsearch") ||
        id === "text-input-where" ||
        id === "text-input-what" ||
        name === "q" ||
        name === "l" ||
        name === "query" ||
        role === "searchbox" ||
        type === "search" ||
        type === "hidden" ||
        type === "submit" ||
        type === "button" ||
        type === "reset" ||
        type === "image" ||
        (placeholder.includes("search") && !placeholder.includes("company")) ||
        placeholder.includes("city, state") ||
        el.disabled ||
        el.readOnly ||
        el.closest("header, nav, [role='search'], form#jobsearch, form[action*='jobs'], form[action*='search'], .jobsearch-SearchBox, [data-gnav-element-name='SearchForm'], .icl-TextInput-control")
      ) {
        continue;
      }

      const container = el.closest("div, form");
      const containerText = (container ? container.innerText : "").toLowerCase();
      if (containerText.includes("job alert") || containerText.includes("get job alerts") || containerText.includes("be the first to see new")) continue;

      const ctx = getFieldContext(el);
      if (ctx.includes("search") || ctx.includes("company name or job title") || ctx.includes("job alert")) continue;

      // -------------------------------------------------------------
      // 1. RADIO BUTTONS (Employment Status, Authorization, Relocation)
      // -------------------------------------------------------------
      if (type === "radio") {
        // Employment Status (Cutshort, Indeed, Naukri) - Candidate is student / fresher
        if (
          ctx.includes("employment status") ||
          ctx.includes("working currently") ||
          ctx.includes("current status") ||
          ctx.includes("not working") ||
          ctx.includes("notice period") ||
          ctx.includes("resigned") ||
          name.includes("employment") ||
          name.includes("working") ||
          name.includes("status")
        ) {
          const isNotWorkingOption =
            ctx.includes("not working currently") ||
            ctx.includes("not working") ||
            ctx.includes("fresher") ||
            ctx.includes("student") ||
            el.value.toLowerCase().includes("not_working") ||
            el.value.toLowerCase().includes("not working") ||
            el.closest("label")?.innerText?.toLowerCase().includes("not working") ||
            el.parentElement?.innerText?.toLowerCase().includes("not working");
          if (isNotWorkingOption) {
            setRadioState(el);
            filledCount++;
            console.log("[JobPilot] Selected 'Not working currently' radio option");
            if (useHumanTyping) await new Promise((r) => setTimeout(r, 90));
          }
        }

        // Work Authorization
        if (ctx.includes("authorized") || ctx.includes("eligible to work") || ctx.includes("legal right") || ctx.includes("work authorization")) {
          if (ctx.includes("yes") || el.value.toLowerCase() === "yes" || el.value === "true" || el.value === "1") {
            setRadioState(el);
            filledCount++;
            if (useHumanTyping) await new Promise((r) => setTimeout(r, 90));
          }
        }

        // Visa Sponsorship
        if (ctx.includes("sponsorship") || ctx.includes("require visa") || ctx.includes("visa sponsor")) {
          if (ctx.includes("no") || el.value.toLowerCase() === "no" || el.value === "false" || el.value === "0") {
            setRadioState(el);
            filledCount++;
            if (useHumanTyping) await new Promise((r) => setTimeout(r, 90));
          }
        }

        // Relocation & Immediate Joining
        if (ctx.includes("relocate") || ctx.includes("relocation") || ctx.includes("immediate joiner") || ctx.includes("immediate") || ctx.includes("available")) {
          const openReloc = p.verified_answers?.open_to_relocation;
          const targetAnswer = (openReloc === false || String(openReloc).toLowerCase() === "no") ? "no" : "yes";
          const isRelocateOption = ctx.includes("can relocate") || ctx.includes("i can relocate") || ctx.includes("relocate to") || ctx.includes("willing");
          const shouldCheck = isRelocateOption || ctx.includes(targetAnswer) || el.value.toLowerCase() === targetAnswer || el.value === (targetAnswer === "yes" ? "true" : "false");
          if (shouldCheck) {
            setRadioState(el);
            filledCount++;
            if (useHumanTyping) await new Promise((r) => setTimeout(r, 90));
          }
        }

        // Degree / Education
        if (ctx.includes("education") || ctx.includes("degree") || ctx.includes("bachelor") || ctx.includes("b.tech") || ctx.includes("graduate")) {
          if (ctx.includes("bachelor") || ctx.includes("b.tech") || ctx.includes("graduate") || ctx.includes("yes")) {
            setRadioState(el);
            filledCount++;
            if (useHumanTyping) await new Promise((r) => setTimeout(r, 90));
          }
        }

        continue;
      }

      // -------------------------------------------------------------
      // 2. CHECKBOXES (Declaration, Consent, Salary Visibility, Office)
      // -------------------------------------------------------------
      if (type === "checkbox") {
        // Declaration / Terms / Talent card / Truthfulness (Screenshot 1)
        if (
          ctx.includes("declare") ||
          ctx.includes("declaration") ||
          ctx.includes("talent card") ||
          ctx.includes("information furnished") ||
          ctx.includes("true, complete") ||
          ctx.includes("best of my knowledge") ||
          ctx.includes("terms") ||
          ctx.includes("agree") ||
          ctx.includes("confirm") ||
          ctx.includes("certify") ||
          ctx.includes("acknowledge") ||
          ctx.includes("consent")
        ) {
          setCheckboxState(el, true);
          filledCount++;
          console.log("[JobPilot] Checked declaration/consent checkbox:", ctx.slice(0, 60));
          if (useHumanTyping) await new Promise((r) => setTimeout(r, 90));
        }

        // Show Salary Preference to Employers (Screenshot 1)
        if (ctx.includes("show current salary") || ctx.includes("minimum expected salary to employers") || ctx.includes("better connections")) {
          setCheckboxState(el, true);
          filledCount++;
          if (useHumanTyping) await new Promise((r) => setTimeout(r, 90));
        }

        // Work from Office / Remote Preference (Screenshot 2)
        if (ctx.includes("work from office") || ctx.includes("remote") || ctx.includes("hybrid")) {
          setCheckboxState(el, true);
          filledCount++;
          if (useHumanTyping) await new Promise((r) => setTimeout(r, 90));
        }

        continue;
      }

      // 3. Email
      if (type === "email" || ctx.includes("email") || ctx.includes("e-mail")) {
        await fillField(el, email);
        continue;
      }

      // 2. Phone / Mobile
      if (type === "tel" || ctx.includes("phone") || ctx.includes("mobile") || ctx.includes("contact number")) {
        await fillField(el, phone);
        continue;
      }

      // 3. First Name
      if (
        (ctx.includes("first") && ctx.includes("name")) ||
        ctx.includes("given-name") ||
        ctx.includes("fname") ||
        ctx.includes("firstname")
      ) {
        await fillField(el, firstName);
        continue;
      }

      // 4. Last Name / Surname
      if (
        (ctx.includes("last") && ctx.includes("name")) ||
        ctx.includes("family-name") ||
        ctx.includes("lname") ||
        ctx.includes("lastname") ||
        ctx.includes("surname")
      ) {
        await fillField(el, lastName);
        continue;
      }

      // 5. Full Name
      if (ctx.includes("full name") || ctx.includes("your name") || (ctx.includes("name") && !ctx.includes("company") && !ctx.includes("user"))) {
        await fillField(el, fullName);
        continue;
      }

      // 6a. Postal Code / Zip / Pincode
      if (
        ctx.includes("postal") ||
        ctx.includes("pincode") ||
        ctx.includes("pin code") ||
        ctx.includes("zip") ||
        (el.name && (el.name.toLowerCase().includes("postal") || el.name.toLowerCase().includes("zip") || el.name.toLowerCase().includes("pincode"))) ||
        (el.id && (el.id.toLowerCase().includes("postal") || el.id.toLowerCase().includes("zip") || el.id.toLowerCase().includes("pincode")))
      ) {
        await fillField(el, postalCode);
        continue;
      }

      // 6b. State / Province / Region
      if (
        (ctx.includes("state") && !ctx.includes("statement")) ||
        ctx.includes("province") ||
        ctx.includes("region") ||
        (el.name && el.name.toLowerCase().includes("state")) ||
        (el.id && el.id.toLowerCase().includes("state"))
      ) {
        await fillField(el, state);
        continue;
      }

      // 6c. City / Town
      if (
        (ctx.includes("city") && !ctx.includes("capacity")) ||
        ctx.includes("town") ||
        (el.name && el.name.toLowerCase().includes("city")) ||
        (el.id && el.id.toLowerCase().includes("city"))
      ) {
        await fillField(el, city);
        continue;
      }

      // 6d. Street Address / Address line 1
      if (
        ctx.includes("street") ||
        (ctx.includes("address") && !ctx.includes("email")) ||
        (el.name && el.name.toLowerCase().includes("address")) ||
        (el.id && el.id.toLowerCase().includes("address"))
      ) {
        await fillField(el, address);
        continue;
      }

      // 6e. General Location / Office Preference fallback
      if (ctx.includes("location") || ctx.includes("office preference")) {
        // Multi-select location tag container check (Cutshort, ATS)
        const isCutshort = window.location.hostname.includes("cutshort");
        const hasExistingTags = (() => {
          let p = el.parentElement;
          for (let i = 0; i < 10 && p && p !== document.body; i++) {
            const text = (p.innerText || "").toLowerCase();
            if (text.includes("×") || text.includes("x") || text.includes("kolkata") || text.includes("mumbai") || text.includes("india")) {
              const tags = Array.from(p.querySelectorAll("button, span, div, [class*='tag'], [class*='pill'], [class*='chip'], [class*='badge']")).filter(tEl => {
                const t = (tEl.innerText || "").trim().toLowerCase();
                return (t.endsWith(" x") || t.endsWith(" ×") || t.includes("×") || (tEl.querySelector("svg") && t.length > 2 && t.length < 35));
              });
              if (tags.length > 0) return true;
            }
            p = p.parentElement;
          }
          return false;
        })();

        // On Cutshort: NEVER type into location input because candidate profile locations are already populated!
        if (isCutshort || hasExistingTags) {
          console.log("[JobPilot Cutshort] Multi-select location tags already present or Cutshort portal. Skipping location input.");
          if (el.value) {
            el.value = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            try { el.blur(); } catch (e) {}
          }
          continue;
        }

        await fillField(el, location, true);
        continue;
      }

      // 7. LinkedIn Profile
      if (ctx.includes("linkedin") || ctx.includes("linked in") || ctx.includes("linked-in")) {
        await fillField(el, linkedinUrl);
        continue;
      }

      // 8. GitHub Profile / Repository / Code samples
      if (
        ctx.includes("github") ||
        ctx.includes("git hub") ||
        ctx.includes("git profile") ||
        ctx.includes("git repo") ||
        ctx.includes("git link") ||
        ctx.includes("git url") ||
        ctx.includes("repository") ||
        ctx.includes("repo url") ||
        ctx.includes("code sample") ||
        ctx.includes("coding profile") ||
        ctx.includes("project link") ||
        ctx.includes("projects link") ||
        ctx.includes("project url") ||
        ctx.includes("source code") ||
        (ctx.includes("git") && ctx.includes("link")) ||
        (ctx.includes("coding") && ctx.includes("link"))
      ) {
        await fillField(el, githubUrl);
        continue;
      }

      // 9. Website / Portfolio URL / Personal link
      if (
        ctx.includes("website") ||
        ctx.includes("portfolio") ||
        ctx.includes("personal site") ||
        ctx.includes("personal website") ||
        ctx.includes("blog") ||
        ctx.includes("online profile") ||
        ctx.includes("homepage") ||
        ctx.includes("web site")
      ) {
        await fillField(el, portfolioUrl);
        continue;
      }

      // 10. College / University / School / Institute
      if (ctx.includes("college") || ctx.includes("university") || ctx.includes("school") || ctx.includes("institution") || ctx.includes("institute")) {
        await fillField(el, collegeName);
        continue;
      }

      // 11. Degree / Major / Branch / Course / Discipline / Specialization
      if (ctx.includes("degree") || ctx.includes("major") || ctx.includes("field of study") || ctx.includes("branch") || ctx.includes("course") || ctx.includes("discipline") || ctx.includes("specialization")) {
        await fillField(el, degreeName);
        continue;
      }

      // 11b. Graduation Year / Passing Year / Year of Passing / Batch
      if (
        ctx.includes("graduation year") ||
        ctx.includes("grad year") ||
        ctx.includes("passing year") ||
        ctx.includes("year of passing") ||
        ctx.includes("completion year") ||
        ctx.includes("passout year") ||
        ctx.includes("batch") ||
        (ctx.includes("year") && (ctx.includes("grad") || ctx.includes("completion") || ctx.includes("education")))
      ) {
        await fillField(el, gradYear);
        continue;
      }

      // 11c. CGPA / GPA / Grade / Percentage / Marks
      if (
        ctx.includes("cgpa") ||
        ctx.includes("gpa") ||
        ctx.includes("percentage") ||
        ctx.includes("marks") ||
        (ctx.includes("grade") && !ctx.includes("upgrade"))
      ) {
        await fillField(el, cgpaScore);
        continue;
      }

      // 11d. Skills / Technologies / Tech Stack
      if (
        ctx.includes("skills") ||
        ctx.includes("technologies") ||
        ctx.includes("tech stack") ||
        ctx.includes("key skills") ||
        ctx.includes("primary skills")
      ) {
        await fillField(el, skillsList);
        continue;
      }

      // 12. Current Company / Employer (Cutshort & ATS)
      if (
        ctx.includes("current company") ||
        ctx.includes("current employer") ||
        ctx.includes("previous company") ||
        ctx.includes("typing a company") ||
        ctx.includes("choose from the dropdown")
      ) {
        // On Cutshort, if candidate is Fresher / Student or "Not working currently", LEAVE BLANK!
        if (window.location.hostname.includes("cutshort")) {
          const hasExp = candidateProfile && candidateProfile.experience && candidateProfile.experience.length > 0 && candidateProfile.experience[0].company;
          if (!hasExp) {
            console.log("[JobPilot Cutshort] Candidate is Fresher / Student: leaving Current company blank on Cutshort.");
            if (el.value) {
              el.value = "";
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            try { el.blur(); } catch (e) {}
            continue;
          }
        }

        const compVal = (candidateProfile && candidateProfile.experience && candidateProfile.experience.length > 0 && candidateProfile.experience[0].company)
          ? candidateProfile.experience[0].company
          : "Fresher / Student";
        await fillField(el, compVal, true);
        continue;
      }

      // 13. Job Title / Role
      if (ctx.includes("job title") || ctx.includes("current role") || ctx.includes("headline")) {
        await fillField(el, title);
        continue;
      }

      // 13. Years of Experience
      if (ctx.includes("experience") && (ctx.includes("years") || ctx.includes("total") || ctx.includes("yoe"))) {
        const rawYoe = p.verified_answers?.years_of_experience || "1";
        const numMatch = String(rawYoe).match(/\d+/);
        const yoeVal = type === "number" ? (numMatch ? numMatch[0] : "1") : String(rawYoe);
        await fillField(el, yoeVal);
        continue;
      }

      // 14. Notice Period (Text / Number input)
      if (ctx.includes("notice period") || ctx.includes("notice days") || (ctx.includes("notice") && (ctx.includes("days") || ctx.includes("month") || ctx.includes("duration")))) {
        const configuredNotice = p.verified_answers?.notice_period || (p.preferences?.notice_period_days ? `${p.preferences.notice_period_days} days` : "Immediate (15 days)");
        const numMatch = String(configuredNotice).match(/\d+/);
        const noticeVal = type === "number" ? (numMatch ? numMatch[0] : (p.preferences?.notice_period_days ? String(p.preferences.notice_period_days) : "15")) : configuredNotice;
        await fillField(el, noticeVal);
        continue;
      }

      // 15. Current CTC / Salary
      if ((ctx.includes("current") || ctx.includes("present") || ctx.includes("last drawn")) && (ctx.includes("ctc") || ctx.includes("salary") || ctx.includes("compensation") || ctx.includes("package") || ctx.includes("remuneration") || ctx.includes("lacs"))) {
        const isLacs = ctx.includes("lacs") || ctx.includes("lpa");
        let curVal = "0";
        if (!isLacs && type !== "number") {
          curVal = p.verified_answers?.current_ctc || ((p && p.experience && p.experience.length > 0) ? "4 LPA" : "Fresher / Not Applicable");
        }
        await fillField(el, curVal);
        continue;
      }

      // 16. Expected CTC / Salary
      if ((ctx.includes("expected") || ctx.includes("desired") || ctx.includes("minimum expected")) && (ctx.includes("ctc") || ctx.includes("salary") || ctx.includes("compensation") || ctx.includes("package") || ctx.includes("remuneration") || ctx.includes("lacs"))) {
        const isLacs = ctx.includes("lacs") || ctx.includes("lpa");
        const expLacs = p.preferences?.min_salary ? String(Math.round(p.preferences.min_salary / 100000)) : "6";
        let expVal = isLacs ? expLacs : (p.verified_answers?.expected_ctc || "6 LPA (Negotiable)");
        if (type === "number") {
          expVal = expLacs;
        }
        await fillField(el, expVal);
        continue;
      }

      // 17. Intelligent LLM Screening Questions & Textareas (Cutshort, Indeed, Wellfound, ATS)
      if (
        (el.tagName.toLowerCase() === "textarea" || type === "textarea") ||
        (el.tagName.toLowerCase() === "input" && (
          ctx.includes("why should we hire you") ||
          ctx.includes("why do you want") ||
          ctx.includes("why are you interested") ||
          ctx.includes("cover letter") ||
          ctx.includes("tell us about yourself") ||
          ctx.includes("describe your experience") ||
          ctx.includes("note to founder") ||
          ctx.includes("pitch")
        ))
      ) {
        if (!el.value) {
          // Extract specific question prompt
          let questionPrompt = getQuestionPromptForElement(el);
          if (!questionPrompt) {
            questionPrompt = el.getAttribute("placeholder") || el.getAttribute("aria-label") || ctx;
          }
          questionPrompt = questionPrompt.replace(/\s+/g, " ").trim();

          // Extract job & company context accurately using getJobDetails()
          const { company: compDetails, role: roleDetails, title: titleDetails } = getJobDetails();
          let companyName = compDetails || "";
          let jobTitle = roleDetails || titleDetails || "";
          try {
            if (!jobTitle) {
              const h1 = document.querySelector("h1");
              if (h1) jobTitle = h1.innerText.trim();
            }
            if (!companyName) {
              const compEl = document.querySelector("[data-company-name], .company-name, .jobsearch-InlineCompanyRating, a[href*='/cmp/'], .topcard__org-name-link");
              if (compEl) companyName = compEl.innerText.trim();
            }
          } catch (e) {}

          let jdText = "";
          try {
            const jdEl = document.querySelector("#jobDescriptionText, .job-description, [data-test='JobOverview'], div[class*='description'], article, main");
            if (jdEl) jdText = jdEl.innerText.slice(0, 3000);
            if (!jdText && document.body) jdText = document.body.innerText.slice(0, 3000);
          } catch (e) {}

          showToast(`🤖 AI analyzing JD & generating tailored answer for ${companyName || "company"}...`, "jp-toast-info");

          let answerText = "";
          try {
            answerText = await new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: "ANSWER_QUESTION",
                payload: {
                  question: questionPrompt,
                  company: companyName,
                  title: jobTitle,
                  job_description: jdText
                }
              }, (res) => {
                if (chrome.runtime.lastError || !res || !res.success || !res.answer) {
                  resolve(null);
                } else {
                  resolve(res.answer);
                }
              });
              setTimeout(() => resolve(null), 14000); // 14s for deep Gemini LLM analysis
            });
          } catch (e) {
            console.warn("[JobPilot] LLM answer fetch warning:", e);
          }

          if (!answerText) {
            const topSkills = (p && p.skills && p.skills.length > 0) ? p.skills.slice(0, 4).join(", ") : "Python, Django, FastAPI, React, and scalable backend architecture";
            answerText = `I am very excited about the ${jobTitle || "Software Engineer"} opportunity at ${companyName || "your team"}. With strong hands-on experience in ${topSkills}, I build clean, reliable systems with high ownership and adapt rapidly to technical challenges. I look forward to contributing directly to your team!`;
          }

          const typed = await typeNativeInputValue(el, answerText, true);
          if (typed) filledCount++;
          continue;
        }
      }

      // 19. Dropdown Selects (Notice period, authorization, experience ranges, with dynamic LLM fallback)
      if (el.tagName.toLowerCase() === "select") {
        let matched = false;
        if (ctx.includes("notice")) {
          const option = Array.from(el.options).find(opt => /immediate|15|30|1 month/i.test(opt.text));
          if (option) {
            el.value = option.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            filledCount++;
            matched = true;
            if (useHumanTyping) await new Promise((r) => setTimeout(r, 120));
          }
        }
        if (!matched && (ctx.includes("authorized") || ctx.includes("sponsorship"))) {
          const targetText = ctx.includes("sponsorship") ? "no" : "yes";
          const option = Array.from(el.options).find(opt => new RegExp(`^${targetText}`, "i").test(opt.text.trim()));
          if (option) {
            el.value = option.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            filledCount++;
            matched = true;
            if (useHumanTyping) await new Promise((r) => setTimeout(r, 120));
          }
        }
        if (!matched && ctx.includes("experience") && (ctx.includes("year") || ctx.includes("level"))) {
          const option = Array.from(el.options).find(opt => /0-1|1-2|fresher|entry/i.test(opt.text));
          if (option) {
            el.value = option.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            filledCount++;
            matched = true;
            if (useHumanTyping) await new Promise((r) => setTimeout(r, 120));
          }
        }

        // Dynamic LLM Fallback for unhandled select dropdowns
        if (!matched && !el.value) {
          const opts = Array.from(el.options)
            .map(opt => ({ text: opt.text.trim(), value: opt.value }))
            .filter(opt => opt.text && !opt.text.toLowerCase().includes("select") && !opt.text.toLowerCase().includes("choose"));
          
          if (opts.length > 0) {
            try {
              const res = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                  action: "RESOLVE_FORM_FIELD",
                  payload: {
                    field_name: el.name || el.id || "",
                    label: ctx.slice(0, 150),
                    field_type: "select",
                    options: opts.map(o => o.text),
                    company: "",
                    job_title: ""
                  }
                }, resolve);
                setTimeout(() => resolve(null), 2500);
              });
              if (res && res.success && res.decision) {
                const dec = String(res.decision).toLowerCase();
                const bestOpt = opts.find(o => o.text.toLowerCase() === dec || o.text.toLowerCase().includes(dec));
                if (bestOpt) {
                  el.value = bestOpt.value;
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                  filledCount++;
                  console.log(`[JobPilot Dynamic LLM] Resolved select dropdown "${ctx.slice(0, 40)}" -> "${bestOpt.text}"`);
                }
              }
            } catch (err) {}
          }
        }
      }
    }

    console.log(`[JobPilot Stealth] Semantic autofill complete. Filled ${filledCount} fields with human telemetry.`);
    return {
      success: true,
      count: filledCount,
      message: filledCount > 0 ? `Auto-filled ${filledCount} fields with human typing!` : "No matching blank fields found on this step."
    };
  }

  /**
   * Validates that the current page is an actual job application/view page
   * and NOT a navigation hub, search page, or company review directory.
   */
  function isActualJobApplicationPage() {
    const path = window.location.pathname.toLowerCase();
    const host = window.location.hostname.toLowerCase();
    const search = window.location.search.toLowerCase();

    // 1. Explicit blacklist for non-job domains
    if (
      host.includes("zoom.us") ||
      host.includes("zoom.com") ||
      host.includes("edubricks") ||
      host.includes("google.") ||
      host.includes("youtube.com") ||
      host.includes("facebook.com") ||
      host.includes("instagram.com") ||
      host.includes("twitter.com") ||
      host.includes("x.com") ||
      host.includes("github.com") ||
      host.includes("gitlab.com") ||
      host.includes("netflix.com") ||
      host.includes("amazon.") ||
      host.includes("microsoft.com") ||
      host.includes("stackoverflow.com") ||
      host.includes("reddit.com")
    ) {
      return false;
    }

    // Check if URL indicates a specific job via query parameter (Cutshort, Indeed, etc.)
    const hasJobParam = search.includes("jobid") ||
                        search.includes("job_id") ||
                        search.includes("jk=") ||
                        search.includes("vjk=");

    // Explicitly exclude non-job directories across all portals UNLESS viewing a specific job in an in-portal viewer
    if (
      path.includes("/companies") ||
      path.includes("/cmp/") ||
      path.includes("/salaries") ||
      path.includes("/career-advice") ||
      path.includes("/reviews") ||
      path.includes("/messages") ||
      path.includes("/settings") ||
      (path.includes("/profile") && !path.includes("/all_jobs") && !hasJobParam) ||
      (path.includes("/preferences") && !hasJobParam) ||
      (path.includes("/saved") && !hasJobParam)
    ) {
      return false;
    }

    // Dashboard check
    if (host.includes("localhost") || host.includes("127.0.0.1")) {
      return true;
    }

    // Indeed: must be /viewjob, /rc/clk, /apply, smartapply, or contain jk=/vjk=
    if (host.includes("indeed")) {
      return (
        path.includes("/viewjob") ||
        path.includes("/rc/clk") ||
        path.includes("/apply") ||
        host.includes("smartapply") ||
        search.includes("jk=") ||
        search.includes("vjk=") ||
        (path.includes("/jobs") && (search.includes("vjk=") || search.includes("jk=")))
      );
    }

    // Wellfound: genuine job postings only (e.g. /jobs/12345 or /company/.../jobs/...)
    // Strictly exclude user application hubs (/jobs/applications, /jobs/saved, /jobs/messages)
    if (host.includes("wellfound")) {
      if (
        path.includes("/applications") ||
        path.includes("/applied") ||
        path.includes("/saved") ||
        path.includes("/messages") ||
        path.includes("/preferences") ||
        path.includes("/track") ||
        path.includes("/matches") ||
        path === "/jobs" ||
        path === "/jobs/"
      ) {
        return false;
      }
      return path.includes("/jobs/") || path.includes("/l/");
    }

    // LinkedIn: must be /jobs/view/ or /jobs/apply
    if (host.includes("linkedin")) {
      return path.includes("/jobs/view") || path.includes("/jobs/apply");
    }

    // Cutshort: genuine job postings and candidate in-app job viewer (/profile/all_jobs?jobid=...)
    if (host.includes("cutshort")) {
      if (path.includes("/messages") || path === "/jobs" || path === "/jobs/") {
        return false;
      }
      if (path.includes("/profile") && !path.includes("/all_jobs") && !hasJobParam) {
        return false;
      }
      return (
        path.includes("/job/") ||
        path.includes("/profile/all_jobs") ||
        hasJobParam ||
        Boolean(document.querySelector("[data-test*='apply'], [class*='ApplyButton'], [role='dialog'], [aria-modal='true']"))
      );
    }

    // ATS boards (Greenhouse, Lever, Workday, Ashby, SmartRecruiters, etc.)
    const isATS = (
      host.includes("greenhouse.io") ||
      host.includes("lever.co") ||
      host.includes("myworkdayjobs.com") ||
      host.includes("workday.com") ||
      host.includes("ashbyhq.com") ||
      host.includes("smartrecruiters.com") ||
      host.includes("bamboohr.com") ||
      host.includes("workable.com") ||
      host.includes("recruitee.com") ||
      host.includes("jobvite.com") ||
      host.includes("icims.com") ||
      host.includes("breezy.hr") ||
      host.includes("taleo.net")
    );
    if (isATS) return true;

    // Direct company careers portal with application form
    const isCareersPath = (
      path.includes("/careers/") ||
      path.includes("/career/") ||
      path.includes("/jobs/") ||
      path.includes("/apply")
    );
    const hasJobForm = Boolean(document.querySelector("form input[type='file'], [class*='apply'], [id*='apply']"));
    return isCareersPath && hasJobForm;
  }

  /**
   * Injects the floating JobPilot Copilot widget and runs AutoPilot
   */
  function initCopilotWidget() {
    // Only execute on genuine job application pages
    if (!isActualJobApplicationPage()) {
      console.log("[JobPilot] Skipping non-job page:", window.location.pathname);
      return;
    }

    const isIframe = window !== window.top;
    let pill = null;
    let card = null;
    let btnClose = null;
    let btnFill = null;
    let btnApplied = null;
    let toast = null;

    // Only render the floating UI on top-level pages, NOT inside embedded iframes
    if (!isIframe && !document.getElementById("jobpilot-copilot-root")) {
      const root = document.createElement("div");
      root.id = "jobpilot-copilot-root";

      const name = candidateProfile?.full_name || "Tushar Gupta";
      const initials = name.split(/\s+/).map(n => n[0]).slice(0, 2).join("").toUpperCase();

      root.innerHTML = `
        <!-- Collapsed Pill View -->
        <div class="jp-floating-pill" id="jpPill">
          <div class="jp-pill-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
          </div>
          <span class="jp-pill-title">JobPilot Copilot</span>
          <span class="jp-pill-badge">Ready</span>
        </div>

        <!-- Expanded Card View -->
        <div class="jp-copilot-card" id="jpCard" style="display: none;">
          <div class="jp-card-header">
            <div class="jp-card-brand">
              <div class="jp-pill-icon">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                </svg>
              </div>
              <div>
                <div class="jp-card-title">JobPilot Copilot</div>
                <div class="jp-card-subtitle">Cloudflare-Immune Auto-Fill</div>
              </div>
            </div>
            <button class="jp-btn-close" id="jpBtnClose" title="Minimize">✕</button>
          </div>

          <div class="jp-card-body">
            <div class="jp-candidate-pill">
              <div class="jp-candidate-avatar">${initials}</div>
              <div class="jp-candidate-meta">
                <div class="jp-candidate-name">${name}</div>
                <div class="jp-candidate-role">${candidateProfile?.title || "Software Engineer"}</div>
              </div>
            </div>

            <button class="jp-action-btn jp-btn-fill" id="jpBtnFill">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
              Auto-Fill Form (1-Click)
            </button>

            <button class="jp-action-btn jp-btn-applied" id="jpBtnApplied">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              Mark as Applied in Dashboard
            </button>

            <div id="jpToast" class="jp-toast jp-toast-info" style="display: none;"></div>
          </div>
        </div>
      `;

      document.body.appendChild(root);

      pill = root.querySelector("#jpPill");
      card = root.querySelector("#jpCard");
      btnClose = root.querySelector("#jpBtnClose");
      btnFill = root.querySelector("#jpBtnFill");
      btnApplied = root.querySelector("#jpBtnApplied");
      toast = root.querySelector("#jpToast");

      pill.addEventListener("click", () => {
        pill.style.display = "none";
        card.style.display = "block";
      });

      btnClose.addEventListener("click", () => {
        card.style.display = "none";
        pill.style.display = "flex";
      });

      btnFill.addEventListener("click", () => {
        startAutoPilot();
      });

      btnApplied.addEventListener("click", () => {
        btnApplied.textContent = "Syncing with Dashboard...";
        safeSendMessage({
          action: "RECORD_APPLICATION",
          payload: {
            url: window.location.href,
            title: document.title,
            status: "APPLIED"
          }
        }, (res) => {
          btnApplied.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Marked as Applied!
          `;
          showToast("Recorded in JobPilot PostgreSQL Dashboard ✅", "jp-toast-success");
        });
      });
    }

    // =========================================================================
    // SAFETY NET: PREVENT ACCIDENTAL NAVIGATION TO COMPANY REVIEWS / SALARY HUBS
    // =========================================================================
    window.addEventListener("click", (e) => {
      const target = e.target.closest("a");
      if (target) {
        const href = (target.getAttribute("href") || "").toLowerCase();
        if (
          href.includes("/companies") ||
          href.includes("/cmp") ||
          href.includes("/reviews") ||
          href.includes("/salaries") ||
          href.includes("/career-advice")
        ) {
          if (isAutoPilotRunning) {
            console.warn("[JobPilot] 🛡️ Intercepted & Blocked accidental navigation to:", href);
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    }, true); // Capture phase ensures we intercept before navigation occurs!

    // =========================================================================
    // AI QUESTION ANSWERING FOR CUSTOM SCREENING & FOUNDER NOTES
    // =========================================================================
    let isAnsweringQuestions = false;



    async function answerCustomQuestions(scope) {
      if (isAnsweringQuestions) return false;
      isAnsweringQuestions = true;

      try {
        const rootContainer = scope || document;
        const textareas = Array.from(rootContainer.querySelectorAll("textarea, input[type='text']")).filter(el => {
          if (el.value && el.value.trim().length > 10) return false;
          if (el.offsetWidth === 0 || el.offsetHeight === 0 || el.disabled || el.readOnly) return false;

          const type = (el.getAttribute("type") || "text").toLowerCase();
          if (["hidden", "submit", "button", "reset", "image", "search"].includes(type)) return false;
          if (el.closest("header, nav, footer, aside, [role='banner'], [role='search'], form[action*='search']")) return false;

          // STRICT GUARD: Exclude comboboxes, select menus, and location/relocation/city/country inputs!
          const roleAttr = (el.getAttribute("role") || "").toLowerCase();
          const ariaAuto = (el.getAttribute("aria-autocomplete") || "").toLowerCase();
          if (roleAttr === "combobox" || ariaAuto.length > 0 || el.closest("[role='combobox'], [class*='select'], [class*='Select'], [class*='combobox'], [class*='dropdown']")) {
            return false;
          }

          const ctx = getFieldContext(el).toLowerCase();
          const fieldMeta = `${el.name || ""} ${el.id || ""} ${el.className || ""} ${el.placeholder || ""} ${el.getAttribute("aria-label") || ""} ${ctx}`.toLowerCase();
          const excludedKeywords = ["location", "relocate", "relocation", "city", "country", "state", "address", "zip", "postal", "timezone", "salary", "notice", "phone", "email", "name", "github", "linkedin", "portfolio", "website", "url"];
          if (excludedKeywords.some(k => fieldMeta.includes(k))) return false;

          if (ctx.includes("search") || ctx.includes("company name or job title")) return false;

          // Always target textareas or descriptive custom question inputs
          if (el.tagName.toLowerCase() === "textarea") return true;
          return ctx.includes("?") || ctx.includes("why") || ctx.includes("describe") || ctx.includes("experience with") || ctx.includes("tell us about");
        });

        if (textareas.length === 0) return false;

        const { company, role } = getJobDetails();

        for (const el of textareas) {
          const questionPrompt = getQuestionPromptForElement(el);
          console.log("[JobPilot] 🤖 Generating AI answer for:", questionPrompt, "Company:", company, "Role:", role);
          showToast(`🤖 Consulting AI note for ${company}...`, "jp-toast-info");

          try {
            let jdSnippet = "";
            try {
              const jdEl = document.querySelector("#jobDescriptionText, .job-description, [data-test='JobOverview'], div[class*='description'], article, main");
              if (jdEl) jdSnippet = jdEl.innerText.slice(0, 3000);
              if (!jdSnippet && document.body) jdSnippet = document.body.innerText.slice(0, 3000);
            } catch (e) {}

            const res = await new Promise((resolve) => {
              safeSendMessage({
                action: "ANSWER_QUESTION",
                payload: {
                  question: questionPrompt,
                  company: company,
                  title: role,
                  job_description: jdSnippet
                }
              }, resolve);
              setTimeout(() => resolve(null), 14000); // 14s timeout for Gemini LLM synthesis
            });

            let answerText = (res && res.success && res.answer) ? res.answer : "";
            if (!answerText) {
              const p = candidateProfile || {};
              const skills = (p.skills && p.skills.length > 0) ? p.skills.slice(0, 4).join(", ") : "Python, Django, FastAPI, React, and backend architecture";
              if (window.location.hostname.includes("cutshort")) {
                const modalText = (el.closest("div[role='dialog'], [role='dialog'], [aria-modal='true'], div")?.innerText || document.body.innerText || "");
                const toMatch = modalText.match(/To\s*\n\s*([^\n\r]+)/i);
                const recName = toMatch ? toMatch[1].trim() : "";
                const salutation = recName ? `Hi ${recName.split(" ")[0]}, ` : "";
                answerText = `${salutation}I am genuinely excited about the ${role || "Engineer"} opportunity at ${company || "Springer Capital"}. With strong hands-on experience in ${skills}, I specialize in building reliable, scalable systems and solving technical challenges with high ownership. I would love to bring this dedication to your team!`;
              } else {
                answerText = `I am genuinely excited about the opportunity to contribute to ${company || "your team"} as a ${role || "Software Engineer"}. With strong practical experience in ${skills}, I focus on writing clean, scalable code and solving technical challenges with high ownership. I look forward to bringing this dedication to your engineering team.`;
              }
            }

            await typeNativeInputValue(el, answerText, true);
            console.log("[JobPilot] ✅ Filled AI answer into field!");
            showToast(`✅ Tailored AI note added for ${company}!`, "jp-toast-success");
          } catch (err) {
            console.warn("[JobPilot] AI answer request warning:", err);
          }
        }
        return true;
      } finally {
        isAnsweringQuestions = false;
      }
    }

    /**
     * Cutshort Dedicated "Send a message" Modal Handler (Step 2 of application)
     * Automatically generates tailored note via Gemini LLM, fills textarea, and clicks Send.
     */
    async function handleCutshortMessageModal(scope) {
      if (!window.location.hostname.includes("cutshort")) return false;
      const root = scope || document;
      const modalText = (root.innerText || "").toLowerCase();

      const isMessageModal = (
        modalText.includes("you are applying for") &&
        (modalText.includes("type your message") || modalText.includes("to ")) &&
        modalText.includes("send") &&
        modalText.includes("cancel")
      );
      if (!isMessageModal) return false;

      console.log("[JobPilot Cutshort] 💬 Handling Cutshort Send Message modal...");
      const { company, role } = getJobDetails();

      // 1. Locate message textarea
      const textarea = root.querySelector("textarea") || document.querySelector("div[role='dialog'] textarea, textarea");
      if (!textarea) return false;

      // 2. Generate and fill personalized note if not already filled
      if (!textarea.value || textarea.value.trim().length < 15) {
        showToast(`🤖 Generating tailored note for ${company}...`, "jp-toast-info");
        const toMatch = root.innerText.match(/To\s*\n\s*([^\n\r]+)/i);
        const recipientName = toMatch ? toMatch[1].trim() : "";

        let jdSnippet = "";
        try {
          const jdEl = document.querySelector("#jobDescriptionText, .job-description, [data-test='JobOverview'], div[class*='description'], article, main");
          if (jdEl) jdSnippet = jdEl.innerText.slice(0, 3000);
          if (!jdSnippet && document.body) jdSnippet = document.body.innerText.slice(0, 3000);
        } catch (e) {}

        const questionPrompt = `Write a brief, professional note to hiring manager ${recipientName || ""} expressing enthusiasm for the ${role || "Engineer"} role at ${company || "Springer Capital"} and explaining why my software development, AI, and backend skills make me a strong fit.`;

        let noteText = "";
        try {
          const res = await new Promise((resolve) => {
            safeSendMessage({
              action: "ANSWER_QUESTION",
              payload: {
                question: questionPrompt,
                company: company,
                title: role,
                job_description: jdSnippet
              }
            }, resolve);
            setTimeout(() => resolve(null), 14000);
          });
          if (res && res.success && res.answer) {
            noteText = res.answer;
          }
        } catch (e) {}

        if (!noteText) {
          const salutation = recipientName ? `Hi ${recipientName.split(" ")[0]}, ` : "";
          const skills = (candidateProfile?.skills && candidateProfile.skills.length > 0)
            ? candidateProfile.skills.slice(0, 4).join(", ")
            : "Python, Django, FastAPI, React, and backend architecture";
          noteText = `${salutation}I am genuinely excited about the ${role || "Engineer"} opportunity at ${company || "Springer Capital"}. With strong hands-on experience in ${skills}, I specialize in building reliable, scalable systems and solving technical challenges with high ownership. I would love to bring this dedication to your team!`;
        }

        await typeNativeInputValue(textarea, noteText, true);
        console.log("[JobPilot Cutshort] ✅ Message filled into textarea.");
        await new Promise(r => setTimeout(r, 400));
      }

      // 3. Find and click the "Send" button
      const sendBtn = Array.from(root.querySelectorAll("button, [role='button'], div[role='button']")).find(b => {
        const t = (b.innerText || b.value || "").trim().toLowerCase();
        return (t === "send" || t === "send message" || t.includes("send message")) && !t.includes("cancel") && b.offsetWidth > 0 && !b.disabled;
      });

      if (sendBtn) {
        console.log("[JobPilot Cutshort] 🚀 Clicking 'Send' button to complete Cutshort application...");
        showToast(`🚀 Sending message & completing application to ${company}!`, "jp-toast-success");

        simulateUserClick(sendBtn);
        try { sendBtn.click(); } catch (e) {}
        invokeMainWorldClick(sendBtn);
        try {
          const rKey = Object.keys(sendBtn).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
          if (rKey && sendBtn[rKey]?.onClick) {
            sendBtn[rKey].onClick({ target: sendBtn, currentTarget: sendBtn, bubbles: true });
          }
        } catch (e) {}

        // Post-submission verification: Wait 2.2s to inspect modal reaction before recording APPLIED
        setTimeout(() => {
          const bodyText = (document.body?.innerText || "").toLowerCase();
          const modalStillOpen = root && document.contains(root) && root.offsetWidth > 0 && root.offsetHeight > 0;
          const errorEl = modalStillOpen ? root.querySelector("[class*='error'], [class*='Error'], [role='alert'], [aria-invalid='true']") : null;
          const modalText = modalStillOpen ? (root.innerText || "").toLowerCase() : "";
          const hasError = modalStillOpen && (errorEl !== null || modalText.includes("is required") || modalText.includes("please enter") || modalText.includes("mandatory"));

          if (hasError) {
            console.warn(`[JobPilot Cutshort] Message submission blocked by portal validation or required fields.`);
            safeSendMessage({
              action: "RECORD_APPLICATION",
              payload: {
                url: window.location.href,
                title: document.title,
                company: company,
                status: "MANUAL_APPLY_NEEDED",
                bulk_status: "failed",
                reason: "Application incomplete: Required fields pending on portal",
                is_easy_apply: false,
              }
            });
            stopAutoPilot(`⚠️ Application incomplete: Required fields pending on ${company}`);
            setTimeout(() => {
              safeSendMessage({ action: "CLOSE_TAB" });
            }, 2200);
          } else {
            // Record application success
            safeSendMessage({
              action: "RECORD_APPLICATION",
              payload: {
                url: window.location.href,
                title: document.title,
                company: company,
                status: "APPLIED",
                bulk_status: "applied",
                reason: "Cutshort message sent & application submitted",
              }
            });
            stopAutoPilot(`🎉 Application to ${company} Submitted Successfully! Recorded in Dashboard ✅`);
            setTimeout(() => {
              safeSendMessage({ action: "CLOSE_TAB" });
            }, 2200);
          }
        }, 2200);
        return true;
      }

      return false;
    }

    /**
     * Wellfound Location Preferences Resolver:
     * When Wellfound prompts: "This job does not support the locations on your profile. Update your location preferences"
     * Follows exact sequence requested:
     * 1. Always select "I can relocate to...".
     * 2. Click the dropdown that appears below it.
     * 3. Select the first available location from the dropdown.
     * 4. Ensure the founder/recruiter note is populated in textarea.
     * 5. Validates form state and clicks Send application.
     */
    async function handleWellfoundRelocation(scope) {
      if (!window.location.hostname.includes("wellfound")) return false;
      const root = scope || document;
      const text = (root.innerText || document.body?.innerText || "").toLowerCase();
      
      const hasRelocatePrompt = text.includes("update your location preferences") ||
                                text.includes("this job does not support the locations") ||
                                text.includes("support the locations or timezones") ||
                                text.includes("due to timezone or relocation") ||
                                text.includes("location preferences") ||
                                text.includes("i can relocate");

      if (!hasRelocatePrompt) return false;

      console.log("[JobPilot Wellfound] 📍 Handling Wellfound location preference interstitial...");
      showToast("📍 Auto-Pilot: Resolving location preference & note...", "jp-toast-info");

      // 1. Find and select the "I can relocate to..." radio option
      const relocateCandidates = Array.from(document.querySelectorAll("label, [role='radio'], div, span, p")).filter(el => {
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
        const t = (el.innerText || "").trim().toLowerCase();
        return (t.includes("i can relocate") || t.includes("relocate to")) && !t.includes("currently in") && t.length < 90;
      });

      for (const el of relocateCandidates) {
        const nestedRadio = el.querySelector("input[type='radio']") || (el.tagName.toLowerCase() === "input" && el.type === "radio" ? el : null);
        if (nestedRadio) {
          const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked");
          if (descriptor && descriptor.set) {
            descriptor.set.call(nestedRadio, true);
          } else {
            nestedRadio.checked = true;
          }
          nestedRadio.dispatchEvent(new Event("change", { bubbles: true }));
          nestedRadio.dispatchEvent(new Event("input", { bubbles: true }));
        }

        simulateUserClick(el);
        try { el.click(); } catch (e) {}
        console.log("[JobPilot Wellfound] ✅ Clicked 'I can relocate to...' option.");
        break;
      }

      await new Promise(r => setTimeout(r, 400));

      // 2. Click the dropdown that appears below it
      const yellowBox = Array.from(document.querySelectorAll("div, fieldset, section")).find(el => {
        const t = (el.innerText || "").toLowerCase();
        return (t.includes("location preferences") || t.includes("i can relocate to")) && el.offsetWidth > 100 && el.offsetHeight < 450;
      });
      const searchContainer = yellowBox || root;

      const dropdownTrigger = searchContainer.querySelector(
        "[class*='select__control'], [class*='Select-control'], [role='combobox'], div[tabindex='0']"
      ) || Array.from(searchContainer.querySelectorAll("div, button, span")).find(el => {
        const t = (el.innerText || "").trim();
        return (t === "-" || t.startsWith("-") || t.endsWith("▼") || t.endsWith("v")) && el.offsetWidth > 35 && el.offsetHeight > 18;
      });

      const locInput = searchContainer.querySelector("input[type='text'], input:not([type='radio'])") || dropdownTrigger?.querySelector("input");

      if (dropdownTrigger) {
        console.log("[JobPilot Wellfound] Clicking location dropdown trigger...");
        simulateUserClick(dropdownTrigger);
        try { dropdownTrigger.click(); } catch (e) {}
        if (locInput) {
          try { locInput.focus(); } catch (e) {}
        }
        await new Promise(r => setTimeout(r, 400));
      }

      // 3. Select the first available location from the dropdown
      const findAvailableOptions = () => {
        return Array.from(document.querySelectorAll(
          "[role='option'], [class*='option'], [class*='select__option'], [class*='Select-option'], [class*='menu'] div, [role='listbox'] div, [id*='react-select'] div, li"
        )).filter(el => {
          if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
          if (el.offsetHeight > 80 || el.offsetWidth > 950) return false;
          const t = (el.innerText || "").trim();
          if (!t || t === "-" || t.length > 60) return false;
          const tLower = t.toLowerCase();
          if (
            tLower.includes("update your location") ||
            tLower.includes("preferences") ||
            tLower.includes("currently in") ||
            tLower.includes("can relocate") ||
            tLower.includes("write a note") ||
            tLower.includes("send application") ||
            tLower.includes("cancel") ||
            tLower.includes("is your profile")
          ) {
            return false;
          }
          return true;
        });
      };

      let options = findAvailableOptions();

      // If menu didn't open yet, try pressing ArrowDown on the input
      if (options.length === 0 && locInput) {
        locInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 350));
        options = findAvailableOptions();
      }

      if (options.length > 0) {
        // Look for matching target city from job overview pane (e.g. Gurugram, Perungudi, Ahmedabad)
        const modalText = root.innerText || document.body?.innerText || "";
        const locMatch = modalText.match(/Location\s*\n\s*([A-Za-z\s]+)/i);
        const targetCity = locMatch ? locMatch[1].trim().toLowerCase() : "";

        let chosenOption = options[0];
        if (targetCity) {
          const cityOption = options.find(o => o.innerText.toLowerCase().includes(targetCity));
          if (cityOption) chosenOption = cityOption;
        }

        const selectedCityName = chosenOption.innerText.trim();
        console.log(`[JobPilot Wellfound] ✅ Selecting location option: "${selectedCityName}"`);
        showToast(`📍 Selected location: ${selectedCityName}`, "jp-toast-success");

        // React-Select uses onMouseDown for option selection
        invokeMainWorldClick(chosenOption);
        simulateUserClick(chosenOption);
        try { chosenOption.click(); } catch (e) {}

        // Keyboard Enter on input to commit selection
        if (locInput) {
          locInput.focus();
          locInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true, cancelable: true }));
          locInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        }

        await new Promise(r => setTimeout(r, 400));
      }

      // 4. Ensure custom recruiter note textarea is filled with tailored AI response
      const noteArea = root.querySelector("textarea") || document.querySelector("textarea");
      if (noteArea && (!noteArea.value || noteArea.value.trim().length < 15)) {
        const { company, role } = getJobDetails();
        showToast(`🤖 AI tailoring motivation note for ${company || "company"}...`, "jp-toast-info");

        let jdSnippet = "";
        try {
          const jdEl = document.querySelector("#jobDescriptionText, .job-description, [data-test='JobOverview'], div[class*='description'], article, main");
          if (jdEl) jdSnippet = jdEl.innerText.slice(0, 3000);
          if (!jdSnippet && document.body) jdSnippet = document.body.innerText.slice(0, 3000);
        } catch (e) {}

        let noteContent = "";
        try {
          const res = await new Promise((resolve) => {
            safeSendMessage({
              action: "ANSWER_QUESTION",
              payload: {
                question: "What interests you about working for this company?",
                company: company,
                title: role,
                job_description: jdSnippet
              }
            }, resolve);
            setTimeout(() => resolve(null), 14000);
          });
          if (res && res.success && res.answer) {
            noteContent = res.answer;
          }
        } catch (e) {}

        if (!noteContent) {
          const candidateSkills = (candidateProfile?.skills && candidateProfile.skills.length > 0)
            ? candidateProfile.skills.slice(0, 4).join(", ")
            : "Python, AI/ML, backend engineering, and distributed systems";
          noteContent = `I am very excited about the ${role || "Engineer"} role at ${company || "your team"}. With strong hands-on experience in ${candidateSkills}, I build reliable, production-grade applications with high ownership. I look forward to contributing directly to your team's success!`;
        }

        await typeNativeInputValue(noteArea, noteContent, true);
        console.log("[JobPilot Wellfound] ✅ Populated tailored recruiter note in textarea.");
      }

      await new Promise(r => setTimeout(r, 450));

      // 5. Submit: Poll for Send Application button to be enabled (up to 2 seconds)
      const { company } = getJobDetails();
      for (let attempt = 0; attempt < 5; attempt++) {
        const sendAppBtn = Array.from(root.querySelectorAll("button, [role='button'], input[type='submit']")).find(b => {
          const t = (b.innerText || b.value || "").trim().toLowerCase();
          return (t === "send application" || t.includes("send application")) && b.offsetWidth > 0 && !b.disabled;
        });

        if (sendAppBtn) {
          console.log("[JobPilot Wellfound] 🚀 'Send application' button is enabled! Submitting immediately...");
          showToast("🚀 Submitting Wellfound application...", "jp-toast-success");
          simulateUserClick(sendAppBtn);
          try { sendAppBtn.click(); } catch (e) {}
          invokeMainWorldClick(sendAppBtn);

          safeSendMessage({
            action: "RECORD_APPLICATION",
            payload: {
              url: window.location.href,
              title: document.title,
              company: company,
              status: "APPLIED",
              bulk_status: "applied",
              reason: "Wellfound application submitted successfully"
            }
          });

          stopAutoPilot(`🎉 Wellfound application to ${company} submitted! Recorded in Dashboard ✅`);
          setTimeout(() => {
            safeSendMessage({ action: "CLOSE_TAB" });
          }, 2000);
          return true;
        }

        await new Promise(r => setTimeout(r, 350));
      }

      return true;
    }

    let isUploadingResume = false;
    /**
     * Automated Resume File Uploader: Attaches authentic candidate PDF CV (Tushar_Gupta_CSE_2027_.pdf)
     * to application file inputs and dropzones without opening native OS file dialogs (Cutshort, ATS portals, SmartApply)
     */
    async function handleResumeUpload(container) {
      if (isUploadingResume) return false;
      const root = container || document;

      // 1. Check if candidate's resume is already attached in this modal
      // NEVER check document.body or candidate name here, because our toast or user name contains "tushar_gupta"!
      const modalResumeText = (root.innerText || "").toLowerCase();
      if (
        modalResumeText.includes("resume uploaded successfully") ||
        modalResumeText.includes("remove resume") ||
        (modalResumeText.includes(".pdf") && !modalResumeText.includes("upload resume"))
      ) {
        console.log("[JobPilot] Resume is already attached in modal. Skipping re-upload.");
        return false;
      }

      // 1b. Cutshort Specific Resume Uploader: triggers Cutshort's official S3 upload without native OS dialog
      if (window.location.hostname.includes("cutshort")) {
        const rootText = (root.innerText || "").toLowerCase();
        const hasAttachedResume = (
          (rootText.includes(".pdf") && !rootText.includes("upload resume")) ||
          (rootText.includes("change") && rootText.includes("resume")) ||
          rootText.includes("remove resume") ||
          rootText.includes("resume uploaded successfully")
        );

        if (hasAttachedResume) {
          console.log("[JobPilot Cutshort] Resume already attached. Skipping re-upload.");
          return false;
        }

        const uploadCandidates = Array.from(root.querySelectorAll("a, button, span, p, div, label")).filter(el => {
          const t = (el.innerText || "").trim().toLowerCase();
          return (t === "upload resume" || t.startsWith("upload resume")) && el.offsetWidth > 0;
        });
        uploadCandidates.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
        const uploadTrigger = uploadCandidates[0];

        if (uploadTrigger || rootText.includes("upload your resume") || rootText.includes("upload resume")) {
          console.info("[JobPilot Cutshort] Attaching resume via CDP/DOM (no OS file picker click)...");
          isUploadingResume = true;
          showToast("📄 Auto-Pilot: Attaching resume programmatically...", "jp-toast-info");

          const resumeFile = await preloadResumeFile();

          // Prefer chrome.debugger DOM.setFileInputFiles — never click "Upload resume" (opens OS picker)
          await new Promise((resolve) => {
            safeSendMessage({ action: "TRIGGER_RESUME_UPLOAD_CDP" }, resolve);
            setTimeout(resolve, 1200);
          });

          await new Promise((resolve) => {
            safeSendMessage({
              action: "TRIGGER_CUTSHORT_RESUME_MAIN",
              resumeData: {
                base64: cachedResumeBase64 || null,
                filename: resumeFile?.name || "Tushar_Gupta_CSE_2027_.pdf",
                mimeType: resumeFile?.type || "application/pdf"
              }
            }, (res) => {
              console.info("[JobPilot Cutshort] MAIN resume inject:", res?.success ? "ok" : res);
              resolve(res);
            });
            setTimeout(resolve, 1500);
          });

          // Inject into any hidden file inputs already in the modal (both Cutshort flows)
          const fileInputs = Array.from(root.querySelectorAll("input[type='file']"));
          if (resumeFile && fileInputs.length) {
            for (const inp of fileInputs) {
              try {
                const dt = new DataTransfer();
                dt.items.add(resumeFile);
                inp.files = dt.files;
                inp.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                inp.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
              } catch (e) {}
            }
          }

          await new Promise(r => setTimeout(r, 2200));
          resolveModalSpecificQuestions(root);

          isUploadingResume = false;
          const afterText = (root.innerText || "").toLowerCase();
          const attached = afterText.includes(".pdf") || afterText.includes("remove resume") || afterText.includes("change");
          console.info(`[JobPilot Cutshort] Resume attach ${attached ? "confirmed" : "attempted"} (no OS picker).`);
          return attached;
        }
      }

      // 2. Check if portal provides an option to select an existing saved/profile resume (e.g. Indeed, Cutshort, ATS)
      const existingResumeRadio = Array.from(root.querySelectorAll("input[type='radio'], [role='radio'], label")).find(el => {
        const t = (el.innerText || el.getAttribute("aria-label") || el.value || "").toLowerCase();
        return (
          (t.includes("saved resume") || t.includes("profile resume") || t.includes("existing resume") || t.includes("use resume on file")) &&
          !t.includes("upload new")
        );
      });
      if (existingResumeRadio) {
        if (existingResumeRadio.tagName.toLowerCase() === "input") {
          if (!existingResumeRadio.checked) setRadioState(existingResumeRadio);
        } else {
          const r = existingResumeRadio.querySelector("input[type='radio']");
          if (r && !r.checked) setRadioState(r);
          else simulateUserClick(existingResumeRadio);
        }
        console.log("[JobPilot] Selected existing profile resume on portal.");
        return true;
      }

      // 3. Find file inputs inside modal or document
      let fileInputs = Array.from((root || document).querySelectorAll("input[type='file']"));
      if (fileInputs.length === 0) {
        // Also check iframes
        const iframes = Array.from(document.querySelectorAll("iframe"));
        for (const f of iframes) {
          try {
            if (f.contentDocument) {
              fileInputs.push(...Array.from(f.contentDocument.querySelectorAll("input[type='file']")));
            }
          } catch (e) {}
        }
      }
      if (fileInputs.length === 0) {
        fileInputs = Array.from(document.querySelectorAll("input[type='file']"));
      }

      // 4. Find the "Upload resume" trigger button/link
      const uploadTrigger = Array.from((root || document).querySelectorAll("a, button, span, label, p, div")).find(el => {
        const t = (el.innerText || "").trim().toLowerCase();
        return (t === "upload resume" || t.startsWith("upload resume")) && el.children.length <= 2;
      });
      if (uploadTrigger) {
        const nearbyInputs = Array.from((uploadTrigger.parentElement || uploadTrigger).querySelectorAll("input[type='file']"));
        for (const ni of nearbyInputs) {
          if (!fileInputs.includes(ni)) fileInputs.push(ni);
        }
        const forAttr = uploadTrigger.getAttribute("for");
        if (forAttr) {
          const linkedInput = document.getElementById(forAttr);
          if (linkedInput && linkedInput.type === "file" && !fileInputs.includes(linkedInput)) {
            fileInputs.push(linkedInput);
          }
        }
      }

      // Check for dropzone area or upload prompt specifically for resume
      const dropTargets = Array.from((root || document).querySelectorAll(
        "[class*='dropzone'], [class*='drop-zone'], [class*='upload-area'], [data-test*='upload'], div[class*='upload'], div[class*='border-dashed']"
      )).filter(el => {
        const t = (el.innerText || "").toLowerCase();
        return (
          t.includes("drag and drop your resume") ||
          t.includes("upload your resume") ||
          t.includes("upload resume") ||
          t.includes("drop your resume") ||
          (t.includes("drag & drop") && t.includes("resume")) ||
          (t.includes("browse") && t.includes("resume"))
        );
      });

      if (uploadTrigger && !dropTargets.includes(uploadTrigger)) {
        dropTargets.push(uploadTrigger);
        if (uploadTrigger.parentElement && !dropTargets.includes(uploadTrigger.parentElement)) {
          dropTargets.push(uploadTrigger.parentElement);
        }
      }

      const hasResumePrompt = (
        modalResumeText.includes("upload your resume") ||
        modalResumeText.includes("upload resume") ||
        modalResumeText.includes("drag and drop your resume") ||
        modalResumeText.includes("attach your resume") ||
        modalResumeText.includes("attach resume")
      );

      // If no file input and no resume upload prompt, do NOT proceed with resume upload on this step
      if (fileInputs.length === 0 && dropTargets.length === 0 && !hasResumePrompt) {
        return false;
      }

      // If file input already has a file attached, do not re-upload
      if (fileInputs.some(inp => inp.files && inp.files.length > 0)) {
        return false;
      }

      isUploadingResume = true;
      showToast("📄 Auto-Pilot: Attaching candidate CV (Tushar_Gupta_CSE_2027_.pdf)...", "jp-toast-info");
      console.log("[JobPilot] Initiating automated resume upload for candidate without native dialog...");

      try {
        const res = await new Promise((resolve) => {
          safeSendMessage({ action: "GET_RESUME_FILE" }, resolve);
        });

        if (!res || !res.success || !res.base64) {
          console.warn("[JobPilot] Resume file not available from backend:", res?.error);
          return false;
        }

        // Convert base64 Data URL to Blob
        const base64Data = res.base64.includes(",") ? res.base64.split(",")[1] : res.base64;
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: res.mimeType || "application/pdf" });
        const file = new File([blob], res.filename || "Tushar_Gupta_CSE_2027_.pdf", { type: res.mimeType || "application/pdf" });

        const dt = new DataTransfer();
        dt.items.add(file);

        let attachedCount = 0;

        // A. Inject into all detected file inputs (including hidden inputs used by react-dropzone)
        for (const targetInput of fileInputs) {
          try {
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
            if (nativeSetter) {
              try { nativeSetter.call(targetInput, dt.files); } catch(e) { targetInput.files = dt.files; }
            } else {
              targetInput.files = dt.files;
            }
            targetInput.dispatchEvent(new Event("input", { bubbles: true, composed: true, cancelable: true }));
            targetInput.dispatchEvent(new Event("change", { bubbles: true, composed: true, cancelable: true }));

            const reactKey = Object.keys(targetInput).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
            if (reactKey && targetInput[reactKey] && typeof targetInput[reactKey].onChange === "function") {
              try {
                targetInput[reactKey].onChange({ target: targetInput, currentTarget: targetInput, bubbles: true });
              } catch (re) {}
            }
            attachedCount++;
          } catch (inpErr) {
            console.warn("[JobPilot] Error attaching to file input:", inpErr);
          }
        }

        // B. Dispatch synthetic Drag & Drop events on all dropzones
        for (const dtEl of dropTargets) {
          try {
            const dropOpts = { bubbles: true, cancelable: true, dataTransfer: dt };
            dtEl.dispatchEvent(new DragEvent("dragenter", dropOpts));
            dtEl.dispatchEvent(new DragEvent("dragover", dropOpts));
            dtEl.dispatchEvent(new DragEvent("drop", dropOpts));
            attachedCount++;
          } catch (de) {}
        }

        // CRITICAL: NEVER CALL simulateUserClick() OR .click() ON UPLOAD BUTTONS!
        // Calling .click() is what causes the browser to open the Windows File Explorer dialog.
        if (attachedCount > 0) {
          console.log("[JobPilot] ✅ Attached resume (Tushar_Gupta_CSE_2027_.pdf) successfully without opening native dialog!");
          showToast("📄 Attached Tushar_Gupta_CSE_2027_.pdf successfully!", "jp-toast-success");
          return true;
        }

        return false;
      } catch (err) {
        console.warn("[JobPilot] Error uploading resume:", err);
        return false;
      } finally {
        setTimeout(() => { isUploadingResume = false; }, 2500);
      }
    }

    // =========================================================================
    // FULL AUTONOMOUS STEALTH AUTO-PILOT ENGINE
    // =========================================================================
    let isAutoPilotRunning = false;
    let autoPilotTimeout = null;
    let isStepProcessing = false;
    let currentStep = 0;
    const MAX_STEPS = 25;
    let applyStepCount = 0;
    let lastClickedApplyEl = null;
    let lastClickedApplyText = "";
    let lastStepUrl = window.location.href;
    let hasTriggeredPrimaryApply = false;
    let disabledSubmitAttempts = 0;
    let consecutiveNoProgressAttempts = 0;
    let missingApplyBtnAttempts = 0;

    /**
     * Detects if the job portal has blocked or restricted the application
     * (e.g. experience mismatch, external careers page requirement, location/timezone restrictions, closed positions, or eligibility criteria)
     */
    function checkApplicationBlockReason(scope, isPreApply = false) {
      let searchScope = scope;
      if (window.location.hostname.includes("indeed")) {
        const indeedPane = document.querySelector(
          "#jobsearch-ViewjobPaneWrapper, #viewJobSSRRoot, .jobsearch-RightPane, [data-testid='jobsearch-JobComponent'], .fastviewjob"
        );
        if (indeedPane) {
          searchScope = indeedPane;
        }
      } else if (window.location.hostname.includes("cutshort")) {
        const cutshortPane = document.querySelector(
          "[class*='job-details'], [class*='jobDetails'], [class*='JobDetails'], [class*='rightPane'], [class*='right_pane'], [data-test*='job-details'], main"
        );
        if (cutshortPane) {
          searchScope = cutshortPane;
        }
      }
      searchScope = searchScope || document.body || document;
      const targetText = (searchScope?.innerText || "").toLowerCase();
      const bodyText = targetText;
      const textToCheck = targetText;

      const p = candidateProfile || {};
      const rawYoe = p.verified_answers?.years_of_experience || "0";
      const userYears = parseInt((String(rawYoe).match(/\d+/) || ["0"])[0], 10);

      // Direct external career portal directive (e.g. "**Please apply directly through our careers page**")
      if (
        textToCheck.includes("apply directly through our careers page") ||
        textToCheck.includes("apply directly on our careers page") ||
        textToCheck.includes("apply directly via our careers page") ||
        textToCheck.includes("apply directly through company careers") ||
        textToCheck.includes("apply directly on company website")
      ) {
        return "Employer requires direct application through their external careers page";
      }

      // Experience mismatch detection (e.g. "outside the years of experience preferred for this role (4+ years in Engineering role)")
      if (
        bodyText.includes("outside the years of experience preferred") ||
        bodyText.includes("outside the years of experience") ||
        (bodyText.includes("experience preferred for this role") && (bodyText.includes("4+ years") || bodyText.includes("5+ years") || bodyText.includes("6+ years") || bodyText.includes("7+ years") || bodyText.includes("8+ years"))) ||
        (bodyText.includes("experience:") && (bodyText.includes("4+ years") || bodyText.includes("5+ years") || bodyText.includes("6+ years") || bodyText.includes("7+ years") || bodyText.includes("8+ years")) && userYears < 4)
      ) {
        return "Experience mismatch (Job requires 4+ years of experience, outside candidate preferred range)";
      }

      // If portal provides an interactive relocation preference ("I can relocate to..."), let handleWellfoundRelocation handle it
      const isRelocationPrompt = (
        (bodyText.includes("i can relocate") || bodyText.includes("update your location preferences") || bodyText.includes("support the locations")) &&
        !bodyText.includes("outside the years of experience")
      );
      if (isRelocationPrompt) {
        return null;
      }

      // 1. Explicit location / timezone / relocation constraint signatures
      if (
        bodyText.includes("not accepting applications from your current location") ||
        bodyText.includes("due to timezone or relocation constraints") ||
        bodyText.includes("not accepting applications from your country") ||
        bodyText.includes("not accepting applications from your location") ||
        bodyText.includes("not hiring in your region") ||
        bodyText.includes("not hiring in your location") ||
        bodyText.includes("location constraints") ||
        bodyText.includes("relocation constraints") ||
        bodyText.includes("relocation not allowed") ||
        bodyText.includes("relocation is not allowed") ||
        bodyText.includes("not eligible to apply based on your location") ||
        bodyText.includes("outside of the approved hiring locations")
      ) {
        return "Company is not accepting applications from your current location (timezone/relocation constraint)";
      }

      // 2. Job closed / expired signatures
      if (
        bodyText.includes("no longer accepting applications") ||
        bodyText.includes("this job is closed") ||
        bodyText.includes("applications are closed") ||
        bodyText.includes("applications have closed") ||
        bodyText.includes("this job has expired") ||
        bodyText.includes("this posting is no longer available") ||
        bodyText.includes("this position has been filled") ||
        bodyText.includes("hiring for this role has been paused")
      ) {
        return "This position is no longer accepting applications (closed/expired)";
      }

      // 3. Minimum qualification / sponsorship block signatures
      if (
        bodyText.includes("you do not meet the minimum requirements") ||
        bodyText.includes("you do not meet the minimum qualifications") ||
        bodyText.includes("sponsorship is not available for this role") ||
        bodyText.includes("cannot sponsor")
      ) {
        return "Candidate qualifications or visa sponsorship requirements not met";
      }

      // 4. Alert / Error containers with warning text
      const alertEl = searchScope.querySelector(
        "[role='alert'], [class*='alert'], [class*='error-message'], [class*='warning-message']"
      );
      if (alertEl) {
        const alertText = (alertEl.innerText || "").trim();
        const alertLower = alertText.toLowerCase();
        // Ignore non-blocking informational banners (like Cutshort's "Profile matcher is OFF" or "Showing active jobs")
        if (alertLower.includes("profile matcher") || alertLower.includes("viewing all jobs") || alertLower.includes("turn it on")) {
          return null;
        }
        if (
          alertText.length > 8 &&
          (alertLower.includes("not accepting") ||
           alertLower.includes("not hiring in your") ||
           alertLower.includes("location constraint") ||
           alertLower.includes("relocation constraint") ||
           alertLower.includes("relocation not allowed") ||
           alertLower.includes("cannot apply from your location") ||
           alertLower.includes("ineligible based on your location") ||
           alertLower.includes("cannot apply") ||
           alertLower.includes("closed"))
        ) {
          return alertText.split("\n")[0];
        }
      }

      return null;
    }

    function isBotChallengePage() {
      const pageTitle = (document.title || "").toLowerCase().trim();
      const bodyText = (document.body?.innerText || "").toLowerCase();

      // 1. Title triggers
      const titleChallenge = (
        pageTitle.includes("just a moment") ||
        pageTitle.includes("attention required") ||
        pageTitle.includes("security check") ||
        pageTitle.includes("access to this page has been denied") ||
        pageTitle.includes("verify that you are human") ||
        pageTitle.includes("verify you are human") ||
        pageTitle.includes("additional verification") ||
        pageTitle.includes("human verification") ||
        pageTitle.includes("are you a human") ||
        pageTitle.includes("cloudflare") ||
        pageTitle.includes("perimeterx") ||
        pageTitle.includes("datadome")
      );
      if (titleChallenge) return true;

      // 2. Text triggers on page
      const textChallenge = (
        bodyText.includes("access to this page has been denied") ||
        bodyText.includes("verify that you are human") ||
        bodyText.includes("verify you are human") ||
        bodyText.includes("verifying you are human") ||
        bodyText.includes("checking your browser") ||
        bodyText.includes("enable javascript and cookies") ||
        bodyText.includes("we need to make sure you're not a robot") ||
        bodyText.includes("security check") ||
        bodyText.includes("additional verification required") ||
        bodyText.includes("please solve the challenge below") ||
        bodyText.includes("to continue, please confirm that you're human") ||
        bodyText.includes("please verify you are a human") ||
        bodyText.includes("our systems have detected unusual traffic") ||
        bodyText.includes("press & hold") ||
        bodyText.includes("press and hold") ||
        bodyText.includes("confirm you are human")
      );
      if (textChallenge) return true;

      // 3. Known CAPTCHA / bot challenge DOM elements and iframes
      const challengeEl = Boolean(
        document.querySelector(
          "#turnstile-wrapper, iframe[src*='cloudflare'], iframe[src*='turnstile'], iframe[src*='challenge'], iframe[title*='challenge'], iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .cf-turnstile, #challenge-form, #challenge-running, div#px-captcha, div[id*='px-captcha'], div[id*='captcha'], div[class*='captcha'], [data-testid*='captcha']"
        )
      );
      if (challengeEl) {
        const el = document.querySelector(
          "#turnstile-wrapper, iframe[src*='cloudflare'], iframe[src*='turnstile'], iframe[src*='challenge'], iframe[title*='challenge'], iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .cf-turnstile, #challenge-form, #challenge-running, div#px-captcha, div[id*='px-captcha']"
        );
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return true;
      }

      return false;
    }

    function scheduleNextStep(customDelayMs) {
      if (!isAutoPilotRunning) return;
      if (autoPilotTimeout) clearTimeout(autoPilotTimeout);

      // Natural randomized step pacing: 2200ms to 4200ms
      const delay = (customDelayMs !== undefined && customDelayMs !== null)
        ? customDelayMs
        : (Math.floor(Math.random() * (4200 - 2200 + 1)) + 2200);

      autoPilotTimeout = setTimeout(() => {
        runAutoPilotStep();
      }, delay);
    }

    async function runAutoPilotStep() {
      if (!isAutoPilotRunning || isStepProcessing) return;
      isStepProcessing = true;

      try {
        currentStep++;
        if (currentStep > MAX_STEPS) {
          const { company, title } = getJobDetails();
          console.info(`[JobPilot] Maximum step threshold (${MAX_STEPS}) reached on ${company}. Auto-skipping to avoid stall.`);
          safeSendMessage({
            action: "RECORD_APPLICATION",
            payload: {
              url: window.location.href,
              title: title || document.title,
              company: company,
              status: "MANUAL_APPLY_NEEDED",
              bulk_status: "failed",
              reason: "Step limit exceeded",
              is_easy_apply: false
            }
          });
          stopAutoPilot("Auto-pilot reached maximum step limit. Advancing...");
          setTimeout(() => {
            safeSendMessage({ action: "CLOSE_TAB" });
          }, 1200);
          return;
        }

        // Track URL transitions (e.g. redirected from job post to in-portal viewer /profile/all_jobs?jobid=...)
        if (window.location.href !== lastStepUrl) {
          console.log(`[JobPilot Stealth] 📍 URL change detected: ${lastStepUrl} -> ${window.location.href}`);
          lastStepUrl = window.location.href;
          consecutiveNoProgressAttempts = 0;
          disabledSubmitAttempts = 0;
          missingApplyBtnAttempts = 0;
        }

        // 0. Check if page has redirected to Application Success / Tracker hub (e.g. Wellfound /jobs/applications, Indeed /applied)
        const currentPath = window.location.pathname.toLowerCase();
        const currentHost = window.location.hostname.toLowerCase();
        const pageBodyText = (document.body?.innerText || "").toLowerCase();
        const pageTitle = (document.title || "").toLowerCase().trim();

        const isSuccessLanding = (
          (currentHost.includes("wellfound") && (currentPath.includes("/applications") || currentPath.includes("/applied"))) ||
          ((currentHost.includes("indeed") || currentHost.includes("smartapply")) && (window.location.search.includes("ia=applied") || currentPath.includes("/applied") || currentPath.includes("/post-apply") || pageBodyText.includes("your application has been submitted"))) ||
          (currentHost.includes("cutshort") && (currentPath.includes("/applied") || pageBodyText.includes("application sent") || pageBodyText.includes("applied successfully"))) ||
          pageBodyText.includes("application submitted successfully") ||
          pageBodyText.includes("your application was submitted") ||
          pageBodyText.includes("your application was sent")
        );

        if (isSuccessLanding) {
          const { company, title } = getJobDetails();
          showToast(`🎉 Application Confirmed in Portal! Recorded as APPLIED ✅`, "jp-toast-success");
          console.info(`[JobPilot] Application confirmed on ${company || currentHost}. Marking applied.`);
          safeSendMessage({
            action: "RECORD_APPLICATION",
            payload: {
              url: window.location.href,
              title: title || document.title,
              company: company,
              status: "APPLIED",
              bulk_status: "applied",
              reason: "Portal confirmed application success",
            }
          });
          stopAutoPilot("🎉 Application Confirmed in Portal! Recorded in Dashboard ✅");
          setTimeout(() => {
            safeSendMessage({ action: "CLOSE_TAB" });
          }, 2000);
          return;
        }

        // 0b. Cloudflare / Indeed human-verification — DO NOT bypass and DO NOT close tab. Pause bulk & hand to user.
        if (isBotChallengePage()) {
          const { company, title } = getJobDetails();
          console.info("[JobPilot] 🛡️ Bot challenge / human verification detected — pausing Auto-Pilot for manual verification (tab kept open).");
          showToast("🛡️ Human verification required! Complete challenge on this tab. Auto-Pilot will auto-resume once verified.", "jp-toast-warning");
          safeSendMessage({
            action: "REPORT_BULK_STATUS",
            status: "blocked_challenge",
            reason: "Human verification required (Indeed/Cloudflare challenge)",
            title: title || document.title,
            company: company,
          });
          stopAutoPilot("Paused: Human verification challenge — please verify on tab");

          // Active polling monitor: when user completes challenge, automatically resume application on this tab!
          if (!window.__jobpilot_challenge_poll_active) {
            window.__jobpilot_challenge_poll_active = true;
            const pollInterval = setInterval(() => {
              if (!isExtensionAlive()) {
                clearInterval(pollInterval);
                window.__jobpilot_challenge_poll_active = false;
                return;
              }
              if (!isBotChallengePage()) {
                clearInterval(pollInterval);
                window.__jobpilot_challenge_poll_active = false;
                console.log("[JobPilot Stealth] 🎉 Challenge resolved! Resuming application on current job...");
                showToast("✅ Verification complete! Continuing application...", "jp-toast-success");
                safeSendMessage({ action: "RESUME_AFTER_CHALLENGE_SOLVED", url: window.location.href });
                setTimeout(() => {
                  isAutoPilotRunning = false;
                  startAutoPilot();
                }, 1400);
              }
            }, 1000);
          }
          // Tab stays open for user
          return;
        }

        // 0c. Immediate detection of removed / 404 / expired job posts ("Not Found" / "Expired on Indeed")
        let activeJobPaneText = pageBodyText;
        if (currentHost.includes("indeed")) {
          const indeedPane = document.querySelector("#jobsearch-ViewjobPaneWrapper, #viewJobSSRRoot, .jobsearch-RightPane, [data-testid='jobsearch-JobComponent'], .fastviewjob");
          if (indeedPane) {
            activeJobPaneText = (indeedPane.innerText || "").toLowerCase();
          }
        }

        const isJobNotFound = (
          pageTitle === "not found" ||
          pageTitle.includes("404") ||
          pageTitle.includes("page not found") ||
          activeJobPaneText.includes("this job has expired") ||
          activeJobPaneText.includes("job has expired on indeed") ||
          activeJobPaneText.includes("this job is closed") ||
          activeJobPaneText.includes("no longer accepting applications") ||
          activeJobPaneText.includes("employer is not accepting applications") ||
          activeJobPaneText.includes("is not actively hiring") ||
          activeJobPaneText.includes("reviewing applications") ||
          activeJobPaneText.includes("this job has been removed") ||
          activeJobPaneText.includes("the job you are looking for is no longer available") ||
          activeJobPaneText.includes("job not found") ||
          activeJobPaneText.includes("this position has been filled") ||
          activeJobPaneText.includes("hiring for this role has been paused") ||
          activeJobPaneText.includes("this posting is no longer available") ||
          activeJobPaneText.includes("applications are closed") ||
          activeJobPaneText.includes("applications have been closed") ||
          activeJobPaneText.includes("this role is no longer open") ||
          activeJobPaneText.includes("this listing is closed") ||
          activeJobPaneText.includes("no longer accepting applicants") ||
          activeJobPaneText.includes("position closed") ||
          activeJobPaneText.includes("not currently accepting applications") ||
          activeJobPaneText.includes("not accepting applications")
        );

        if (isJobNotFound) {
          const { company, title } = getJobDetails();
          console.info(`[JobPilot] Skipped expired/closed job for ${company || "Job"}.`);
          showToast(`⚠️ Skipped: Job has expired or is no longer accepting applications`, "jp-toast-warning");
          safeSendMessage({
            action: "RECORD_APPLICATION",
            payload: {
              url: window.location.href,
              title: title || document.title,
              company: company,
              status: "REJECTED",
              bulk_status: "skipped_expired",
              reason: "Job expired or closed on portal",
              notes: "Job expired or closed on portal",
              is_easy_apply: false
            }
          });
          stopAutoPilot("Job post expired or closed on portal");
          setTimeout(() => {
            safeSendMessage({ action: "CLOSE_TAB" });
          }, 1200);
          return;
        }

        // 0d. Check if job is already marked as Applied on portal (Wellfound, Cutshort, Indeed, etc.)
        const indeedAppliedBadge = currentHost.includes("indeed") && (
          document.querySelector("[data-testid='applied-badge'], .ia-applied-banner, [class*='applied-badge'], [class*='appliedMessage'], [aria-label*='Applied']") ||
          Array.from(document.querySelectorAll("#jobsearch-ViewjobPaneWrapper [class*='applied'], #viewJobSSRRoot [class*='applied']")).find(el => el.offsetWidth > 0 && !el.closest("header, nav, aside"))
        );

        const appliedBtn = indeedAppliedBadge || Array.from(document.querySelectorAll("button, a, div[role='button'], span, div")).find(el => {
          if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
          const href = (el.getAttribute("href") || "").toLowerCase();
          if (href.includes("/applied") || href.includes("/applications") || href.includes("/messages") || href.includes("/profile") || href.includes("/dashboard")) return false;
          if (el.closest("header, nav, footer, aside, [role='banner'], [role='search'], [role='navigation']")) return false;

          const rawText = (el.innerText || "").trim().toLowerCase();
          const cleanText = rawText.replace(/^[✓✔\s\-_•]+/, "").trim();
          const isAppliedText = (
            cleanText === "applied" ||
            cleanText === "already applied" ||
            cleanText.startsWith("applied ") ||
            cleanText.startsWith("applied on") ||
            cleanText.includes("you applied") ||
            cleanText.includes("already applied to this job") ||
            cleanText === "application sent" ||
            cleanText === "applied successfully" ||
            cleanText === "application submitted"
          );
          if (!isAppliedText) return false;
          if (el.innerText.length > 40) return false;
          return true;
        });

        if (appliedBtn) {
          const { company, role } = getJobDetails();
          console.log(`[JobPilot] ✅ Detected position already APPLIED on portal: ${company} - ${role}`);
          showToast("✅ Already applied to this position on portal!", "jp-toast-success");
          safeSendMessage({
            action: "RECORD_APPLICATION",
            payload: {
              url: window.location.href,
              title: role || document.title,
              company: company,
              status: "APPLIED",
              bulk_status: "applied",
              reason: "Already applied on portal",
            }
          });
          stopAutoPilot("Already marked as APPLIED in Dashboard ✅");
          setTimeout(() => {
            safeSendMessage({ action: "CLOSE_TAB" });
          }, 1200);
          return;
        }

        // 0e. Check for Cutshort candidate login gate
        if (currentHost.includes("cutshort")) {
          const isLoginPrompt = Array.from(document.querySelectorAll("div[role='dialog'], [role='dialog'], [aria-modal='true'], div[class*='modal'], form")).some(el => {
            if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
            if (el === document.body || el === document.documentElement || el.id === "__next" || el.id === "root") return false;
            const t = (el.innerText || "").toLowerCase();
            return (
              (t.includes("candidate login") || t.includes("log in to cutshort") || t.includes("sign in to apply") || t.includes("sign up to apply")) &&
              (t.includes("email") || t.includes("continue with google") || t.includes("linkedin") || t.includes("password"))
            );
          });

          if (isLoginPrompt) {
            console.warn("[JobPilot Cutshort] ⚠️ Cutshort is prompting for candidate login.");
            showToast("🔑 Cutshort: Please log in to your Cutshort account! JobPilot will resume once logged in...", "jp-toast-warning");
            scheduleNextStep(5000);
            return;
          }
        }

        // 0. Dismiss Cutshort / Portal exit-intent feedback survey popup if it appears
        const exitSurveyModal = Array.from(document.querySelectorAll("div[role='dialog'], [role='dialog'], [aria-modal='true'], div[class*='modal']")).find(m => {
          if (m === document.body || m === document.documentElement || m.id === "__next" || m.id === "root") return false;
          const t = (m.innerText || "").toLowerCase();
          return t.includes("before you leave") && t.includes("why you did not apply");
        });
        if (exitSurveyModal) {
          const closeBtn = Array.from(exitSurveyModal.querySelectorAll("button, [aria-label*='close'], span")).find(b => {
            const text = (b.innerText || "").trim().toLowerCase();
            return text === "x" || text === "✕" || text === "close" || b.getAttribute("aria-label")?.includes("close");
          });
          if (closeBtn) {
            console.log("[JobPilot Cutshort] Dismissing 'Before you leave' exit survey modal.");
            simulateUserClick(closeBtn);
          }
        }

        // 1. Detect if an active application modal or form is genuinely open
        function findActiveApplicationModal() {
          // If running inside an application iframe (e.g. Indeed Apply or ATS portal)
          if (window.self !== window.top) {
            if (document.querySelector("input, textarea, select, button, form")) {
              return document.body || document.documentElement;
            }
          }

          // Check for Cutshort application & verification modals specifically (both Step 1 and Step 2)
          const cutshortModal = Array.from(document.querySelectorAll(
            "div[role='dialog'], [role='dialog'], [aria-modal='true'], div[class*='modal'], div[class*='Modal'], [class*='drawer'], [class*='Drawer'], [class*='dialog'], [class*='Dialog'], [class*='SideSheet'], [class*='sidesheet'], div[class*='popup'], div[class*='Popup'], div[class*='overlay'], div[class*='Overlay']"
          )).find(m => {
            if (m === document.body || m === document.documentElement || m.id === "__next" || m.id === "root") return false;
            // A real modal cannot contain the page's top-level navigation
            if (m.querySelector("nav, header, [class*='navbar'], [class*='Navbar']")) return false;
            if (m.offsetWidth < 200 || m.offsetHeight < 150) return false;

            // Must contain actual interactive form controls or submit/action buttons
            const hasFormControls = Boolean(m.querySelector(
              "input:not([type='hidden']), textarea, select, [type='file'], [class*='upload'], [class*='dropzone'], button[type='submit'], [data-test*='submit'], button"
            ));
            if (!hasFormControls) return false;

            const t = (m.innerText || "").toLowerCase();
            return (
              t.includes("you are applying for") ||
              t.includes("type your message") ||
              (t.includes("to ") && t.includes("upload another resume")) ||
              (t.includes("to ") && t.includes("send") && t.includes("cancel")) ||
              t.includes("please verify your data before applying") ||
              t.includes("verify your data before applying") ||
              t.includes("upload your resume to apply") ||
              t.includes("drag and drop your resume here") ||
              (t.includes("upload your resume") && t.includes("you are applying for")) ||
              (t.includes("work experience") && t.includes("office preference")) ||
              t.includes("salary preference") ||
              t.includes("employment status") ||
              t.includes("your specialization") ||
              (t.includes("work remotely") && t.includes("save and continue")) ||
              t.includes("please upload your latest resume") ||
              t.includes("why are you interested") ||
              t.includes("quick application") ||
              (t.includes("send message") && t.includes("apply")) ||
              t.includes("submit application") ||
              (t.includes("apply to") && (t.includes("submit") || t.includes("send message")))
            );
          });
          if (cutshortModal) return cutshortModal;

          // Direct heading fallback for verification modal (Cutshort and similar ATS)
          const verifyHeading = Array.from(document.querySelectorAll("h1, h2, h3, h4, div, span, p")).find(el => {
            const t = (el.innerText || "").trim().toLowerCase();
            return t === "please verify your data before applying" || t === "verify your data before applying";
          });
          if (verifyHeading) {
            const modalBox = verifyHeading.closest("div[role='dialog'], [role='dialog'], [aria-modal='true'], div[class*='modal'], div[class*='Modal'], div[class*='popup'], div[class*='overlay'], div") || verifyHeading.parentElement?.parentElement;
            if (modalBox && modalBox !== document.body && modalBox.id !== "__next") {
              return modalBox;
            }
          }

          // Check for Indeed SmartApply full-page wizard or direct apply URL
          if (window.location.hostname.includes("smartapply") || window.location.pathname.includes("/apply") || window.location.pathname.includes("/ia/")) {
            const smartContainer = document.querySelector(
              "main, form, [data-testid*='ia-'], .ia-BasePage, #indeedapply-modal, [class*='ia-'], [data-testid*='questions']"
            ) || document.body;
            if (smartContainer) return smartContainer;
          }

          // Check for Indeed Apply iframe or modal dialog in top window
          const indeedIframe = document.querySelector("iframe[name*='indeedapply'], iframe[title*='Indeed Apply'], iframe[id*='indeedapply'], iframe[src*='smartapply'], iframe[src*='indeed.com']");
          if (indeedIframe && indeedIframe.offsetWidth > 100 && indeedIframe.offsetHeight > 100) {
            return indeedIframe;
          }

          // Check for Wellfound / Indeed / ATS modals (strictly ignore cookie banners, GDPR, feedback)
          const modalCandidates = Array.from(document.querySelectorAll(
            '.ia-BasePage, div[role="dialog"], [role="dialog"], [aria-modal="true"], [data-testid*="modal"], [data-testid*="application"], div[class*="styles_modal"], div[class*="ApplicationModal"]'
          ));
          
          for (const m of modalCandidates) {
            if (m === document.body || m === document.documentElement || m.id === "__next" || m.id === "root") continue;
            if (m.getAttribute("aria-hidden") === "true") continue;
            const idAndClass = ((m.id || "") + " " + (m.className || "")).toLowerCase();
            const text = (m.innerText || "").toLowerCase();
            if (
              idAndClass.includes("cookie") ||
              idAndClass.includes("consent") ||
              idAndClass.includes("onetrust") ||
              idAndClass.includes("gdpr") ||
              idAndClass.includes("feedback") ||
              idAndClass.includes("survey") ||
              idAndClass.includes("privacy") ||
              text.includes("we use cookies") ||
              text.includes("cookie settings") ||
              text.includes("accept all cookies")
            ) {
              continue;
            }

            // Must contain actual candidate inputs or submit buttons
            if (m.offsetWidth > 200 && m.offsetHeight > 150) {
              const hasInputs = m.querySelector("input, textarea, select, [data-testid*='submit'], button[type='submit'], [class*='upload'], [class*='dropzone']");
              const hasAppText = text.includes("review your application") || text.includes("submit your application") || text.includes("send application") || text.includes("upload your resume");
              if (hasInputs || hasAppText) {
                return m;
              }
            }
          }

          // Fallback: If a textarea exists on the page (like Wellfound's custom note), find its container
          const textarea = document.querySelector("textarea");
          if (textarea && textarea.offsetWidth > 0) {
            const modalParent = textarea.closest("div[role='dialog'], [role='dialog'], [aria-modal='true'], div[class*='modal'], [class*='drawer'], form");
            if (modalParent && modalParent !== document.body && modalParent.id !== "__next") {
              return modalParent;
            }
          }

          return null;
        }

        const activeModal = findActiveApplicationModal();

        // 1b. Immediate Ineligibility / Location Restriction Detection
        if (activeModal) {
          // If on Wellfound, resolve relocation preference ("I can relocate to...") immediately
          if (window.location.hostname.includes("wellfound")) {
            await handleWellfoundRelocation(activeModal);
          }

          const modalBlockReason = checkApplicationBlockReason(activeModal);
          if (modalBlockReason) {
            const { company, title } = getJobDetails();
            console.info(`[JobPilot] Application restriction in modal for ${company}: ${modalBlockReason}`);
            showToast(`⚠️ Skipped: ${company} (${modalBlockReason})`, "jp-toast-warning");

            safeSendMessage({
              action: "RECORD_APPLICATION",
              payload: {
                url: window.location.href,
                title: title || document.title,
                company: company,
                status: "MANUAL_APPLY_NEEDED",
                bulk_status: /experience/i.test(modalBlockReason) ? "skipped_ineligible" : (/expired|closed/i.test(modalBlockReason) ? "skipped_expired" : "skipped_ineligible"),
                reason: modalBlockReason,
                is_easy_apply: false
              }
            });

            console.info(`[JobPilot] Modal skip: ${modalBlockReason}`);
            stopAutoPilot(`Skipped: ${modalBlockReason}`);
            setTimeout(() => {
              safeSendMessage({ action: "CLOSE_TAB" });
            }, 2000);
            return;
          }
        }

        // 2. Look for primary Apply CTA on the job post
        function findPrimaryApplyCTA() {
          // A. Indeed Apply button (Direct ID / classes)
          if (window.location.hostname.includes("indeed")) {
            const detailsPane = document.querySelector(
              "#jobsearch-ViewjobPaneWrapper, #viewJobSSRRoot, .jobsearch-RightPane, [data-testid='jobsearch-JobComponent'], .fastviewjob, [class*='jobsearch-RightPane'], [class*='ViewjobPane'], [class*='JobComponent'], main"
            ) || document;

            // 1. Prioritize Direct Indeed Apply button selectors inside details pane
            const selectors = [
              "#indeedApplyButton button",
              "button#indeedApplyButton",
              "#indeedApplyButton a",
              "#indeedApplyButton",
              "[data-testid='indeedApplyButton']",
              "[data-testid='indeed-apply-button']",
              ".jobsearch-IndeedApplyButton-button",
              "button.jobsearch-IndeedApplyButton--button",
              "button[data-indeed-apply-button='true']",
              "[data-indeed-apply-button='true']",
              "button[id*='indeedApply']",
              "[data-gnav-element-name='job-apply-button']"
            ];

            for (const sel of selectors) {
              const el = detailsPane.querySelector(sel) || document.querySelector(sel);
              if (el && el.offsetWidth > 0) {
                const btn = (el.tagName.toLowerCase() === "button" || el.tagName.toLowerCase() === "a")
                  ? el
                  : (el.querySelector("button, a") || el);
                if (btn && !btn.disabled) {
                  console.log("[JobPilot Indeed] ✅ Found primary Indeed Apply button via selector:", sel);
                  return btn;
                }
              }
            }

            // 2. Direct text match for "Apply now" / "Easily apply" inside details pane
            const paneButtons = Array.from(detailsPane.querySelectorAll("button, a, [role='button'], a.icl-Button"));
            const applyNowBtn = paneButtons.find(b => {
              const href = (b.getAttribute("href") || "").toLowerCase();
              if (href.includes("/companies") || href.includes("/reviews") || href.includes("/salaries") || href.includes("/preferences")) return false;
              const t = (b.innerText || b.getAttribute("aria-label") || b.value || "").trim().toLowerCase();
              if (t.includes("filter") || t.includes("sort") || t.includes("guide") || t.includes("salary") || t.includes("company")) return false;
              return (
                t === "apply now" ||
                t === "easily apply" ||
                t === "apply with resume" ||
                t.startsWith("apply now") ||
                t.startsWith("easily apply") ||
                t.startsWith("apply with")
              ) && b.offsetWidth > 0 && !b.disabled;
            });
            if (applyNowBtn) {
              console.log("[JobPilot Indeed] ✅ Found primary Apply button via text:", applyNowBtn.innerText);
              return applyNowBtn;
            }

            // 3. ONLY if NO Easy Apply / Apply now button exists in details pane, check if this is an external apply job
            const externalMatch = paneButtons.find(b => {
              const t = (b.innerText || b.getAttribute("aria-label") || b.value || "").trim().toLowerCase();
              return (
                t === "apply on company site" ||
                t === "apply on employer site" ||
                t === "apply on company website"
              ) && b.offsetWidth > 0;
            });

            if (externalMatch) {
              console.log("[JobPilot Indeed] ℹ️ Detected external company portal apply CTA:", externalMatch.innerText);
              return { isExternal: true, element: externalMatch };
            }
          }

          // B. Wellfound Apply button
          if (window.location.hostname.includes("wellfound")) {
            const wellBtn = document.querySelector(
              "[data-test='JobOverviewApplyButton'], [data-test='JobListingApplyButton'], button[class*='applyButton'], a[class*='applyButton']"
            );
            if (wellBtn && wellBtn.offsetWidth > 0 && !wellBtn.disabled) return wellBtn;

            const buttons = Array.from(document.querySelectorAll("button, a[role='button']"));
            const match = buttons.find(b => {
              const href = (b.getAttribute("href") || "").toLowerCase();
              if (href.includes("/applied") || href.includes("/messages") || href.includes("/profile")) return false;
              const t = (b.innerText || "").trim().toLowerCase();
              return (t === "apply" || t === "apply now" || t === "apply to role") && b.offsetWidth > 0 && !b.disabled;
            });
            if (match) return match;
          }

          // C. Cutshort Apply button (Handles initial "Apply to this job" and intermediate "Apply now")
          if (window.location.hostname.includes("cutshort")) {
            const allElements = Array.from(document.querySelectorAll("button, a, [role='button'], div[class*='btn'], div[class*='Button'], span[class*='btn']"));
            const match = allElements.find(b => {
              const href = (b.getAttribute("href") || "").toLowerCase();
              if (href.includes("/companies") || href.includes("/messages") || href.includes("/hiring")) return false;
              if (href.includes("/profile") && !href.includes("/all_jobs") && !href.includes("jobid")) return false;

              const t = (b.innerText || b.getAttribute("aria-label") || "").trim().toLowerCase();
              if (t.includes("not interested") || t.includes("save for later") || t.includes("saved") || t.includes("share") || t.includes("report")) return false;

              const isApply = (
                t === "apply to this job" ||
                t === "apply now" ||
                t === "apply" ||
                t === "quick apply" ||
                t === "easy apply" ||
                t === "apply to role" ||
                t.startsWith("apply to this job") ||
                t.startsWith("apply now") ||
                t.startsWith("apply to")
              );

              return isApply && b.offsetWidth > 0 && !b.disabled;
            });
            if (match) return match;
          }

          // D. Generic Fallback
          const allButtons = Array.from(document.querySelectorAll("button, a, [role='button'], a.icl-Button, div[role='button']"));
          return allButtons.find(b => {
            const href = (b.getAttribute("href") || "").toLowerCase();
            if (href.includes("/companies") || href.includes("/reviews") || href.includes("/salaries") || href.includes("/applied") || href.includes("/messages")) return false;
            if (href.includes("/profile") && !href.includes("/all_jobs") && !href.includes("jobid")) return false;
            const t = (b.innerText || b.value || b.getAttribute("aria-label") || "").trim().toLowerCase();
            if (t.includes("not interested") || t.includes("save") || t.includes("filter") || t.includes("sort") || t.includes("guide") || t.includes("salary") || t.includes("company")) return false;
            return (
              t === "apply to this job" ||
              t === "apply now" ||
              t === "apply" ||
              t === "easily apply" ||
              t === "easy apply" ||
              t === "apply with resume" ||
              t.startsWith("apply to") ||
              t.startsWith("apply now")
            ) && b.offsetWidth > 0 && !b.disabled;
          }) || null;
        }

        const primaryApplyBtn = findPrimaryApplyCTA();

        // 3. STATE 1: If NO application form/modal is open yet, check for Primary or Intermediate Apply CTA!
        if (!activeModal && primaryApplyBtn) {
          const btnEl = primaryApplyBtn.element || primaryApplyBtn;
          const btnText = (btnEl.innerText || btnEl.value || "").trim().toLowerCase();

          // If the button is explicitly "Apply on company site":
          if (primaryApplyBtn.isExternal) {
            const { company } = getJobDetails();
            showToast(`ℹ️ Manual Apply Required: ${company} requires applying on their external company website.`, "jp-toast-info");
            safeSendMessage({
              action: "RECORD_APPLICATION",
              payload: {
                url: window.location.href,
                title: document.title,
                company: company,
                status: "MANUAL_APPLY_NEEDED",
                bulk_status: "skipped_ineligible",
                reason: "External company portal application required",
                is_easy_apply: false
              }
            });
            console.info("[JobPilot] External careers page — skipped for bulk.");
            stopAutoPilot("External company portal application required (Manual Apply)");
            setTimeout(() => {
              safeSendMessage({ action: "CLOSE_TAB" });
            }, 2500);
            return;
          }

          // Pre-apply eligibility check (experience requirement mismatch or direct careers page apply directive)
          let eligibilityScope = document.body;
          if (window.location.hostname.includes("indeed")) {
            eligibilityScope = document.querySelector("#jobsearch-ViewjobPaneWrapper, #viewJobSSRRoot, .jobsearch-RightPane, [data-testid='jobsearch-JobComponent'], .fastviewjob") || document.body;
          } else if (window.location.hostname.includes("cutshort")) {
            eligibilityScope = document.querySelector("[class*='job-details'], [class*='jobDetails'], [class*='JobDetails'], [class*='rightPane'], [class*='right_pane'], [data-test*='job-details'], main") || document.body;
          }
          const preApplyBlock = checkApplicationBlockReason(eligibilityScope, true);
          if (preApplyBlock) {
            const { company, title } = getJobDetails();
            const isExp = /experience mismatch/i.test(preApplyBlock);
            console.info(`[JobPilot] Pre-apply skip for ${company}: ${preApplyBlock}`);
            showToast(`⚠️ Skipped: ${company} (${preApplyBlock})`, "jp-toast-warning");

            safeSendMessage({
              action: "RECORD_APPLICATION",
              payload: {
                url: window.location.href,
                title: title || document.title,
                company: company,
                status: "MANUAL_APPLY_NEEDED",
                bulk_status: isExp || /expired|closed/i.test(preApplyBlock) ? (isExp ? "skipped_ineligible" : "skipped_expired") : "skipped_ineligible",
                reason: preApplyBlock,
                is_easy_apply: false
              }
            });

            stopAutoPilot(`Skipped: ${preApplyBlock}`);
            setTimeout(() => {
              safeSendMessage({ action: "CLOSE_TAB" });
            }, 2500);
            return;
          }

          const { company, title } = getJobDetails();

          // Eligibility sync only — NEVER mark applied here
          safeSendMessage({
            action: "REPORT_BULK_STATUS",
            job_id: null,
            status: "running",
            title: title || document.title,
            company: company,
            reason: "Direct apply page confirmed",
          });

          consecutiveNoProgressAttempts = 0;
          disabledSubmitAttempts = 0;

          // Intelligently detect if this is an additional Apply Now step (e.g. redirected intermediate page)
          const isNewApplyStep = (
            applyStepCount === 0 ||
            window.location.href !== lastStepUrl ||
            btnEl !== lastClickedApplyEl ||
            btnText !== lastClickedApplyText
          );

          if (isNewApplyStep && applyStepCount < 3) {
            const isInitialClick = (applyStepCount === 0);
            applyStepCount++;
            hasTriggeredPrimaryApply = true;
            lastClickedApplyEl = btnEl;
            lastClickedApplyText = btnText;
            lastStepUrl = window.location.href;

            if (isInitialClick) {
              // Initial step: Run natural human reading and scroll warmup first!
              await simulateHumanWarmupAndRead();
              if (!isAutoPilotRunning) return;

              showToast(`⚡ Auto-Pilot: Clicking '${btnText || "Apply"}' button...`, "jp-toast-info");
              console.log("[JobPilot Stealth] Step 1 Apply CTA found. Clicking:", btnEl);
            } else {
              // Intermediate step: Natural human micro-pause without re-running long scroll warmup
              await new Promise(r => setTimeout(r, Math.floor(Math.random() * (1200 - 600 + 1)) + 600));
              if (!isAutoPilotRunning) return;

              showToast(`⚡ Auto-Pilot: Additional Apply step detected ('${btnText}'). Clicking to open form...`, "jp-toast-info");
              console.log("[JobPilot Stealth] Step 2 Additional Apply CTA found. Clicking:", btnEl);
            }

            try { btnEl.focus(); } catch (e) {}
            simulateUserClick(btnEl);
            try { btnEl.click(); } catch (e) {}
            invokeMainWorldClick(btnEl);

            const childBtn = btnEl.querySelector("button, a, span");
            if (childBtn && childBtn !== btnEl) {
              try { childBtn.focus(); } catch (e) {}
              simulateUserClick(childBtn);
              try { childBtn.click(); } catch (e) {}
              invokeMainWorldClick(childBtn);
            }
            const parentBtn = btnEl.closest("#indeedApplyButton, [data-testid='indeedApplyButton'], button, a");
            if (parentBtn && parentBtn !== btnEl) {
              try { parentBtn.click(); } catch (e) {}
              invokeMainWorldClick(parentBtn);
            }

            // Also dispatch MAIN_WORLD_CLICK directly to background for rock-solid React click invocation
            if (window.location.hostname.includes("indeed")) {
              safeSendMessage({
                action: "MAIN_WORLD_CLICK",
                selector: "#indeedApplyButton button, button#indeedApplyButton, [data-testid='indeedApplyButton'], [data-testid='indeed-apply-button'], button",
                text: "Apply"
              });
            }

            if (btnEl.tagName.toLowerCase() === "a" && btnEl.href && !btnEl.href.startsWith("javascript")) {
              setTimeout(() => {
                if (window.location.href !== btnEl.href && !findActiveApplicationModal()) {
                  window.location.href = btnEl.href;
                }
              }, 1200);
            }
          } else {
            // Already triggered on this step. If modal/iframe still hasn't opened:
            const iframe = document.querySelector("iframe[name*='indeedapply'], iframe[title*='Indeed Apply'], iframe[id*='indeedapply'], iframe[src*='indeed.com']");
            if (iframe) {
              iframe.style.display = "block";
              iframe.style.visibility = "visible";
              try { iframe.focus(); } catch (e) {}
            } else {
              try { btnEl.focus(); } catch (e) {}
              simulateUserClick(btnEl);
              try { btnEl.click(); } catch (e) {}
              invokeMainWorldClick(btnEl);
            }
          }
          // Schedule next step with randomized human cadence
          missingApplyBtnAttempts = 0;
          scheduleNextStep(Math.floor(Math.random() * (3600 - 2400 + 1)) + 2400);
          return;
        }

        // 3b. If NO active modal AND NO primary Apply CTA exists on this job page
        if (!activeModal && !primaryApplyBtn) {
          // If a challenge is active, NEVER treat as missing button and NEVER close tab!
          if (isBotChallengePage()) {
            console.log("[JobPilot] Bot challenge / verification active on page. Awaiting resolution...");
            return;
          }

          missingApplyBtnAttempts++;
          if (missingApplyBtnAttempts < 2) {
            console.log(`[JobPilot] Waiting for portal page hydration / Apply CTA to render (attempt ${missingApplyBtnAttempts}/2)...`);
            scheduleNextStep(1800);
            return;
          }

          // Hydration window passed, but still no Apply CTA or active application modal
          const { company, title } = getJobDetails();
          console.info(`[JobPilot] No Apply CTA or active modal on ${company}. Position is inactive, closed, or external.`);
          showToast(`⚠️ Skipped: Position not accepting applications (${company})`, "jp-toast-warning");

          safeSendMessage({
            action: "RECORD_APPLICATION",
            payload: {
              url: window.location.href,
              title: title || document.title,
              company: company,
              status: "REJECTED",
              bulk_status: "skipped_expired",
              reason: "No Apply button available on portal (job closed or inactive)",
              is_easy_apply: false
            }
          });

          stopAutoPilot("Position closed or no apply button available");
          setTimeout(() => {
            safeSendMessage({ action: "CLOSE_TAB" });
          }, 1200);
          return;
        }

        missingApplyBtnAttempts = 0;

        // 4. STATE 2: Inside application form / modal!
        try {
          resolveModalSpecificQuestions(activeModal);
          await resolveChoiceQuestions(activeModal);
        } catch (e) {}

        // A. Handle Cutshort Send Message Modal (Step 2)
        if (window.location.hostname.includes("cutshort")) {
          const handledMsg = await handleCutshortMessageModal(activeModal);
          if (handledMsg) return;
        }

        // B. Handle Wellfound Location Preferences ("I can relocate to...")
        if (window.location.hostname.includes("wellfound")) {
          const handledReloc = await handleWellfoundRelocation(activeModal);
          if (handledReloc) return;
        }

        // B. Autofill candidate details with Stealth Human Typing!
        const autofillResult = await executeSemanticAutofill(activeModal, true);
        if (autofillResult) {
          consecutiveNoProgressAttempts = 0;
        }

        // B2. Re-run choice resolution after autofill in case dynamic questions appeared
        try {
          await resolveChoiceQuestions(activeModal);
        } catch (e) {}

        // B. Handle Resume Upload (Cutshort, ATS portals, SmartApply)
        const uploadedResume = await handleResumeUpload(activeModal);
        if (uploadedResume) {
          consecutiveNoProgressAttempts = 0;
          scheduleNextStep(Math.floor(Math.random() * (3200 - 2000 + 1)) + 2000);
          return;
        }

        // C. Answer custom technical questions / founder notes
        const answeredQuestion = await answerCustomQuestions(activeModal);
        if (answeredQuestion) {
          consecutiveNoProgressAttempts = 0;
          scheduleNextStep(Math.floor(Math.random() * (3000 - 1800 + 1)) + 1800);
          return;
        }

        // D. Check for submission button
        try {
          resolveModalSpecificQuestions(activeModal);
        } catch (e) {}

        const searchScope = activeModal || document;
        let submitBtn = Array.from(searchScope.querySelectorAll(
          "button, input[type='submit'], [data-testid*='submit'], [role='button'], div[class*='btn'], div[class*='Button']"
        )).find(b => {
          const href = (b.getAttribute("href") || "").toLowerCase();
          if (href.includes("/companies") || href.includes("/reviews") || href.includes("/salaries")) return false;
          const t = (b.innerText || b.value || b.getAttribute("aria-label") || "").trim().toLowerCase();
          if (t === "apply to this job" || t.startsWith("apply to this job")) return false;
          return (
            t === "send application" ||
            t === "submit your application" ||
            t === "submit application" ||
            t === "confirm and apply" ||
            (window.location.hostname.includes("smartapply") && t === "apply") ||
            (window.location.hostname.includes("cutshort") && (
              t === "send" ||
              t === "send message" ||
              t.includes("submit application") ||
              t.includes("send message & apply") ||
              t.includes("send message and apply") ||
              t === "apply to role" ||
              (activeModal && (t === "submit" || t === "apply" || t === "send" || t.includes("send message")))
            )) ||
            (activeModal && (t === "send" || t === "send message" || t === "send application"))
          ) && b.offsetWidth > 0 && b.offsetHeight > 0 && !b.disabled;
        });

        // Cutshort specific global fallback: Look for dialog "Send" button across entire document
        if (!submitBtn && window.location.hostname.includes("cutshort")) {
          submitBtn = Array.from(document.querySelectorAll("button, [role='button'], div[role='button']")).find(b => {
            const t = (b.innerText || b.value || "").trim().toLowerCase();
            return (t === "send" || t === "send message" || t.includes("send message & apply") || t.includes("send message and apply")) && b.offsetWidth > 0 && !b.disabled;
          }) || null;
        }

        if (submitBtn) {
          const { company } = getJobDetails();
          showToast(`⚡ Auto-Pilot: Final review before submission to ${company}...`, "jp-toast-info");

          // Natural human final review pause before submitting (1.8s - 3.2s)
          const submitPause = Math.floor(Math.random() * (3200 - 1800 + 1)) + 1800;
          setTimeout(() => {
            showToast(`🚀 Submitting application to ${company}!`, "jp-toast-success");
            submitBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
            simulateUserClick(submitBtn);
            try { submitBtn.click(); } catch (e) {}
            invokeMainWorldClick(submitBtn);
            submitBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
            try {
              const rKey = Object.keys(submitBtn).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
              if (rKey && submitBtn[rKey]?.onClick) {
                submitBtn[rKey].onClick({ target: submitBtn, currentTarget: submitBtn, bubbles: true });
              }
            } catch (e) {}
            const innerSubmit = submitBtn.querySelector("button, a, span");
            if (innerSubmit && innerSubmit !== submitBtn) {
              try { innerSubmit.click(); } catch (e) {}
              simulateUserClick(innerSubmit);
              invokeMainWorldClick(innerSubmit);
            }
            // Post-submission verification: Wait 2.8s to inspect portal reaction before recording APPLIED
            setTimeout(() => {
              const bodyText = (document.body?.innerText || "").toLowerCase();
              const currPath = window.location.pathname.toLowerCase();
              const currHost = window.location.hostname.toLowerCase();

              // 1. Explicit success signals
              const hasSuccessSignal = (
                bodyText.includes("application submitted") ||
                bodyText.includes("application sent") ||
                bodyText.includes("applied successfully") ||
                bodyText.includes("your application has been submitted") ||
                bodyText.includes("you applied") ||
                bodyText.includes("your application was sent") ||
                (currHost.includes("indeed") && (window.location.search.includes("ia=applied") || currPath.includes("/applied"))) ||
                (currHost.includes("wellfound") && currPath.includes("/applications")) ||
                (currHost.includes("cutshort") && (currPath.includes("/applied") || bodyText.includes("messages")))
              );

              // 2. Check if modal closed or is gone from DOM
              const modalStillPresent = activeModal && document.contains(activeModal) && activeModal.offsetWidth > 0 && activeModal.offsetHeight > 0;

              // 3. Check for validation errors or incomplete required fields
              const errorEl = modalStillPresent ? activeModal.querySelector("[class*='error'], [class*='Error'], [role='alert'], [aria-invalid='true'], .text-red-500, .text-danger") : null;
              const modalText = modalStillPresent ? (activeModal.innerText || "").toLowerCase() : "";
              const hasFormValidationErrors = modalStillPresent && (
                modalText.includes("is required") ||
                modalText.includes("please answer") ||
                modalText.includes("please enter") ||
                modalText.includes("mandatory") ||
                errorEl !== null
              );

              if (hasSuccessSignal || (!modalStillPresent && !hasFormValidationErrors)) {
                // Genuine submission confirmed!
                safeSendMessage({
                  action: "RECORD_APPLICATION",
                  payload: {
                    url: window.location.href,
                    title: document.title,
                    company: company,
                    status: "APPLIED",
                    bulk_status: "applied",
                    reason: "Submit confirmed by portal UI",
                  }
                });
                stopAutoPilot(`🎉 Application to ${company} Submitted Successfully! Recorded in Dashboard ✅`);
                setTimeout(() => {
                  safeSendMessage({ action: "CLOSE_TAB" });
                }, 2200);
              } else if (hasFormValidationErrors) {
                // Submission blocked by portal form validation or required fields
                console.warn(`[JobPilot] Application to ${company} incomplete: portal form validation or required fields pending.`);
                safeSendMessage({
                  action: "RECORD_APPLICATION",
                  payload: {
                    url: window.location.href,
                    title: document.title,
                    company: company,
                    status: "MANUAL_APPLY_NEEDED",
                    bulk_status: "failed",
                    reason: "Application incomplete: Required fields or validation pending on portal",
                    is_easy_apply: false
                  }
                });
                stopAutoPilot(`⚠️ Application to ${company} incomplete: Required fields pending`);
                setTimeout(() => {
                  safeSendMessage({ action: "CLOSE_TAB" });
                }, 2500);
              } else {
                console.log(`[JobPilot] Submit clicked; modal still active. Allowing autopilot step cycle to continue.`);
              }
            }, 2800);
          }, submitPause);
          return;
        }

        // E. Check for "Continue" / "Next" / "Save and continue" button in multi-step wizard
        const nextBtn = Array.from((searchScope || document).querySelectorAll(
          "button, input[type='submit'], [role='button'], a, div[class*='btn'], div[class*='Button'], .ia-continueButton, [data-testid*='continue'], [data-testid*='Continue']"
        )).find(b => {
          const href = (b.getAttribute("href") || "").toLowerCase();
          if (href.includes("/companies") || href.includes("/reviews") || href.includes("/salaries")) return false;
          const t = (b.innerText || b.value || b.getAttribute("aria-label") || "").trim().toLowerCase();
          if (t.includes("company") || t.includes("reviews") || t.includes("guide") || t.includes("follow") || t.includes("cancel") || t.includes("back") || t.includes("previous")) return false;
          // Ignore bookmark buttons like "save job", but allow wizard buttons like "save and continue"
          if (t.includes("save") && !t.includes("continue") && !t.includes("next")) return false;
          return (
            t === "continue" ||
            t === "next" ||
            t === "review your application" ||
            t === "review application" ||
            t === "save and continue" ||
            t === "save & continue" ||
            t.startsWith("continue") ||
            t.startsWith("next") ||
            b.classList.contains("ia-continueButton") ||
            (b.getAttribute("data-testid") || "").toLowerCase().includes("continue")
          ) && b.offsetWidth > 0 && b.offsetHeight > 0 && !b.disabled;
        }) || (activeModal ? Array.from(document.querySelectorAll(
          "button, input[type='submit'], [role='button'], div[class*='btn'], div[class*='Button']"
        )).find(b => {
          const t = (b.innerText || b.value || "").trim().toLowerCase();
          return (t === "continue" || t.startsWith("continue") || t === "save and continue" || t === "save & continue" || t.startsWith("save and continue")) && b.offsetWidth > 0 && !b.disabled;
        }) : null);

        if (nextBtn) {
          try {
            resolveModalSpecificQuestions(activeModal);
            await resolveChoiceQuestions(activeModal);
          } catch (e) {}

          // For Cutshort: if resume has not been uploaded yet, trigger upload before clicking Save and continue
          if (window.location.hostname.includes("cutshort")) {
            try {
              const modalText = (activeModal?.innerText || "").toLowerCase();
              if (modalText.includes("upload resume") && !modalText.includes(".pdf")) {
                console.log("[JobPilot Cutshort] Resume not yet attached before advancing. Uploading now...");
                await handleResumeUpload(activeModal);
                await new Promise(r => setTimeout(r, 1200));
              }
              resolveModalSpecificQuestions(activeModal);
            } catch (e) {}
          }

          // Remove focus from any active input so form validation or focus traps don't block wizard button
          if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA")) {
            try { document.activeElement.blur(); } catch (e) {}
          }

          consecutiveNoProgressAttempts = 0;
          disabledSubmitAttempts = 0;
          showToast("⚡ Auto-Pilot: Step completed. Advancing to next step...", "jp-toast-info");

          // Natural human step pause (600ms - 1000ms)
          await new Promise(r => setTimeout(r, Math.floor(Math.random() * (1000 - 600 + 1)) + 600));

          if (document.activeElement && (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA")) {
            try { document.activeElement.blur(); } catch (e) {}
          }
          try { nextBtn.focus(); } catch (e) {}
          simulateUserClick(nextBtn);
          try { nextBtn.click(); } catch (e) {}
          invokeMainWorldClick(nextBtn);
          try {
            const rKey = Object.keys(nextBtn).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEventHandlers"));
            if (rKey && nextBtn[rKey]?.onClick) {
              nextBtn[rKey].onClick({ target: nextBtn, currentTarget: nextBtn, bubbles: true });
            }
          } catch (e) {}
          const innerNext = nextBtn.querySelector("button, a, span");
          if (innerNext && innerNext !== nextBtn) {
            try { innerNext.click(); } catch (e) {}
            simulateUserClick(innerNext);
            invokeMainWorldClick(innerNext);
          }
          scheduleNextStep(Math.floor(Math.random() * (3200 - 2200 + 1)) + 2200);
          return;
        }

        // F. Auto-Skip if portal is permanently blocking submission (e.g. location/timezone restriction or disabled submit)
        const disabledSubmitBtn = Array.from(searchScope.querySelectorAll("button, input[type='submit'], [data-testid*='submit']")).find(b => {
          const href = (b.getAttribute("href") || "").toLowerCase();
          if (href.includes("/companies") || href.includes("/reviews") || href.includes("/salaries")) return false;
          const t = (b.innerText || b.value || b.getAttribute("aria-label") || "").trim().toLowerCase();
          return (
            t === "send application" ||
            t === "submit your application" ||
            t === "submit application" ||
            t === "confirm and apply" ||
            (window.location.hostname.includes("smartapply") && t === "apply") ||
            (window.location.hostname.includes("wellfound") && t.includes("application")) ||
            (window.location.hostname.includes("cutshort") && (
              t === "send" ||
              t === "send message" ||
              t === "submit" ||
              t === "apply" ||
              t.includes("submit application")
            ))
          ) && b.offsetWidth > 0 && b.offsetHeight > 0 && b.disabled;
        });

        if (disabledSubmitBtn) {
          disabledSubmitAttempts++;
          const reason = checkApplicationBlockReason(searchScope) || "Application submit button is disabled by the portal";
          const scopeText = (searchScope.innerText || document.body?.innerText || "").toLowerCase();
          const isResolvingReloc = scopeText.includes("update your location preferences") ||
                                   scopeText.includes("i can relocate");
          const maxDisabledAttempts = isResolvingReloc ? 6 : 4;

          if (disabledSubmitAttempts >= maxDisabledAttempts || (reason.includes("timezone") && !isResolvingReloc)) {
            const { company, title } = getJobDetails();
            console.info(`[JobPilot] Cannot submit on ${company}: ${reason}. Skipping...`);
            showToast(`⚠️ Skipped ${company}: ${reason}`, "jp-toast-warning");

            safeSendMessage({
              action: "RECORD_APPLICATION",
              payload: {
                url: window.location.href,
                title: title || document.title,
                company: company,
                status: "MANUAL_APPLY_NEEDED",
                bulk_status: /experience/i.test(reason) ? "skipped_ineligible" : "failed",
                reason: reason,
                is_easy_apply: false
              }
            });

            console.info(`[JobPilot] Submit blocked: ${reason}`);
            stopAutoPilot(`Skipped: ${reason}`);
            setTimeout(() => {
              safeSendMessage({ action: "CLOSE_TAB" });
            }, 1200);
            return;
          }
        }

        // G. Global stuck prevention: If no progress on the same step for 4 ticks, auto-skip
        consecutiveNoProgressAttempts++;
        if (consecutiveNoProgressAttempts >= 4) {
          const currentPath = window.location.pathname.toLowerCase();
          const currentHost = window.location.hostname.toLowerCase();
          const pageBodyText = (document.body?.innerText || "").toLowerCase();

          // Check if button or text transitioned to applied after click
          const hasAppliedConfirmation = (
            (currentHost.includes("wellfound") && (currentPath.includes("/applications") || currentPath.includes("/applied"))) ||
            (currentHost.includes("indeed") && (window.location.search.includes("ia=applied") || currentPath.includes("/applied"))) ||
            (currentHost.includes("cutshort") && (pageBodyText.includes("application sent") || pageBodyText.includes("applied successfully"))) ||
            pageBodyText.includes("application submitted") ||
            pageBodyText.includes("your application was submitted") ||
            pageBodyText.includes("applied successfully") ||
            (hasTriggeredPrimaryApply && Array.from(document.querySelectorAll("button, [role='button'], div, span")).some(b => {
              const t = (b.innerText || "").trim().toLowerCase();
              return t === "applied" || t === "application sent" || t === "already applied";
            }))
          );

          if (hasAppliedConfirmation) {
            safeSendMessage({
              action: "RECORD_APPLICATION",
              payload: {
                url: window.location.href,
                status: "APPLIED",
                bulk_status: "applied",
                reason: "Late success confirmation detected",
              }
            });
            stopAutoPilot("🎉 Application Confirmed in Portal! Recorded in Dashboard ✅");
            setTimeout(() => {
              safeSendMessage({ action: "CLOSE_TAB" });
            }, 2000);
            return;
          }

          const { company, title } = getJobDetails();
          console.info(`[JobPilot] Stalled on ${company} with no actionable elements. Skipping...`);
          showToast(`⚠️ Skipped: Unable to complete application on ${company}`, "jp-toast-warning");

          safeSendMessage({
            action: "RECORD_APPLICATION",
            payload: {
              url: window.location.href,
              title: title || document.title,
              company: company,
              status: "MANUAL_APPLY_NEEDED",
              bulk_status: "failed",
              reason: "Stalled step auto-recovery",
              is_easy_apply: false
            }
          });

          console.info("[JobPilot] Stalled step — skipping to next job.");
          stopAutoPilot("Skipped: Stalled step auto-recovery");
          setTimeout(() => {
            safeSendMessage({ action: "CLOSE_TAB" });
          }, 2000);
          return;
        }

        // If no button clicked, schedule next poll step
        scheduleNextStep();
      } catch (err) {
        console.warn("[JobPilot Stealth AutoPilot step warning]:", err);
        scheduleNextStep(3200);
      } finally {
        isStepProcessing = false;
      }
    }

    function startAutoPilot() {
      startAutoPilotFn = startAutoPilot;
      if (isAutoPilotRunning) return;
      isAutoPilotRunning = true;
      console.log("[JobPilot Stealth] 🚀 Full Stealth Auto-Pilot Mode Started on:", window.location.href);

      showToast("🚀 Stealth Auto-Pilot Active (Human Shield Enabled)", "jp-toast-info");
      if (pill) {
        const badge = pill.querySelector(".jp-pill-badge");
        if (badge) {
          badge.textContent = "Auto-Pilot ON";
          badge.style.backgroundColor = "rgba(99, 102, 241, 0.4)";
          badge.style.color = "#c7d2fe";
        }
      }

      currentStep = 0;
      applyStepCount = 0;
      lastClickedApplyEl = null;
      lastClickedApplyText = "";
      lastStepUrl = window.location.href;
      hasTriggeredPrimaryApply = false;
      disabledSubmitAttempts = 0;
      consecutiveNoProgressAttempts = 0;
      // Start initial step
      scheduleNextStep(800);
    }

    function stopAutoPilot(msg) {
      isAutoPilotRunning = false;
      if (autoPilotTimeout) clearTimeout(autoPilotTimeout);
      if (msg) showToast(msg, "jp-toast-success");
      if (pill) {
        const badge = pill.querySelector(".jp-pill-badge");
        if (badge) {
          badge.textContent = "Ready";
          badge.style.backgroundColor = "rgba(16, 185, 129, 0.2)";
          badge.style.color = "#34d399";
        }
      }
    }

    // Auto-Trigger AutoPilot if on a job site with auto_pilot_enabled
    safeStorageGet(["auto_pilot_enabled"], (res) => {
      const enabled = res && res.auto_pilot_enabled !== false; // Default true!
      const isJobUrl = /indeed|wellfound|linkedin|cutshort|smartapply/i.test(window.location.hostname);
      if (enabled && isJobUrl) {
        // Automatically start after a gentle human delay (2.2s - 3.5s) to let portal hydrate
        const initialDelay = Math.floor(Math.random() * (3500 - 2200 + 1)) + 2200;
        setTimeout(() => {
          startAutoPilot();
        }, initialDelay);
      }
    });
  }
})();
