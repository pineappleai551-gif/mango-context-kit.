"use strict";
(() => {
  const STORAGE_KEY = "mango-context-kit-v1";
  const FIELD_IDS = [
    "projectName",
    "projectGoal",
    "projectContext",
    "projectDecisions",
    "projectConstraints",
    "projectCompleted",
    "projectQuestions",
    "projectNextSteps"
  ];
  const CONTENT_FIELDS = [
    { id: "projectGoal", label: "The Goal", prompt: "What outcome are we pursuing?" },
    { id: "projectContext", label: "Background & Context", prompt: "What should the next assistant understand?" },
    { id: "projectDecisions", label: "Decisions Made", prompt: "What has already been decided?" },
    { id: "projectConstraints", label: "Constraints & Resources", prompt: "What limits or resources matter?" },
    { id: "projectCompleted", label: "Work Completed", prompt: "What has already been done?" },
    { id: "projectQuestions", label: "Open Questions & Risks", prompt: "What remains unresolved?" },
    { id: "projectNextSteps", label: "Next Steps", prompt: "What should happen next?" }
  ];
  const $ = (id) => document.getElementById(id);
  const elements = {
    newProjectBtn: $("newProjectBtn"),
    projectList: $("projectList"),
    breadcrumbProject: $("breadcrumbProject"),
    projectForm: $("projectForm"),
    projectName: $("projectName"),
    toneSelect: $("toneSelect"),
    generateBtn: $("generateBtn"),
    outputSection: $("outputSection"),
    handoffOutput: $("handoffOutput"),
    copyBtn: $("copyBtn"),
    downloadBtn: $("downloadBtn"),
    toast: $("toast"),
    deleteDialog: $("deleteDialog"),
    confirmDeleteBtn: $("confirmDeleteBtn")
  };
  let projects = [];
  let activeProjectId = null;
  let pendingDeleteId = null;
  let toastTimeout = null;
  let storageAvailable = true;
  let lastSavedSnapshot = "";
  let backupInput = null;
  let clarityNumber = null;
  let clarityFill = null;
  let clarityDetail = null;
  let fieldNumber = null;
  let fieldDetail = null;
  let autosaveText = null;
  let briefIsStale = false;

  function makeId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "project-" + Date.now() + "-" +
      Math.random().toString(36).slice(2, 10);
  }

  function makeProject(name = "Untitled project") {
    const project = {
      id: makeId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    FIELD_IDS.forEach((id) => {
      project[id] = id === "projectName" ? name : "";
    });
    return project;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      elements.toast.hidden = true;
    }, 3600);
  }

  function getActiveProject() {
    return projects.find((project) => project.id === activeProjectId) || null;
  }

  function readFields() {
    const values = {};
    FIELD_IDS.forEach((id) => {
      values[id] = $(id).value;
    });
    return values;
  }

  function writeFields(project) {
    FIELD_IDS.forEach((id) => {
      $(id).value = project[id] || "";
    });
    elements.breadcrumbProject.textContent =
      project.projectName.trim() || "Untitled project";
    briefIsStale = true;
  }

  function serializeState() {
    return JSON.stringify({
      version: 1,
      activeProjectId,
      projects
    });
  }

  function setAutosaveStatus(message, state = "saved") {
    if (!autosaveText) return;
    autosaveText.textContent = message;
    const dot = autosaveText.parentElement?.querySelector(".status-dot");
    if (dot) {
      dot.style.background =
        state === "error" ? "#f29b8e" :
        state === "saving" ? "#ffbd59" : "";
    }
  }

  function saveProjects() {
    if (!storageAvailable) {
      setAutosaveStatus("Export a backup", "error");
      return false;
    }
    const snapshot = serializeState();
    try {
      localStorage.setItem(STORAGE_KEY, snapshot);
      lastSavedSnapshot = snapshot;
      setAutosaveStatus("Saved locally");
      return true;
    } catch (error) {
      storageAvailable = false;
      setAutosaveStatus("Storage unavailable", "error");
      renderProjectList();
      showToast(
        "Browser storage is unavailable or full. Export a workspace backup to protect your notes."
      );
      return false;
    }
  }

  function readSavedProjects() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (
        !data ||
        data.version !== 1 ||
        !Array.isArray(data.projects)
      ) {
        throw new Error("Unsupported saved data");
      }
      const validProjects = data.projects
        .filter((project) =>
          project &&
          typeof project.id === "string" &&
          FIELD_IDS.every((id) => typeof project[id] === "string")
        )
        .map((project) => ({
          ...makeProject(),
          ...project
        }));
      return {
        projects: validProjects,
        activeProjectId: data.activeProjectId
      };
    } catch (error) {
      showToast(
        "Saved workspace data could not be read. Import a valid backup if you have one."
      );
      return null;
    }
  }

  function countWords(text) {
    const trimmed = (text || "").trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  function getFilledFields(project) {
    return CONTENT_FIELDS.filter((field) =>
      (project[field.id] || "").trim().length > 0
    );
  }

  function getClarity(project) {
    if (!project) return 0;
    const filled = getFilledFields(project).length;
    const hasName = Boolean(project.projectName.trim());
    return Math.round(((filled + Number(hasName)) / 8) * 100);
  }

  function ensureInsights() {
    if ($("projectInsights")) return;
    const dashboard = document.createElement("section");
    dashboard.id = "projectInsights";
    dashboard.className = "project-insights";
    dashboard.setAttribute("aria-label", "Live project overview");
    dashboard.innerHTML = `
      <div class="insight-card insight-card-primary">
        <span class="insight-label">Project clarity</span>
        <strong class="insight-number" id="clarityNumber">0%</strong>
        <span class="insight-detail" id="clarityDetail">Start filling in your project.</span>
        <div class="progress-track" role="progressbar"
          aria-label="Project clarity" aria-valuemin="0"
          aria-valuemax="100" aria-valuenow="0" id="clarityTrack">
          <div class="progress-fill" id="clarityFill"></div>
        </div>
      </div>
      <div class="insight-card">
        <span class="insight-label">Context sections</span>
        <strong class="insight-number" id="fieldNumber">0/7</strong>
        <span class="insight-detail" id="fieldDetail">Sections with content</span>
      </div>
      <div class="insight-card">
        <span class="insight-label">Context captured</span>
        <strong class="insight-number" id="wordNumber">0</strong>
        <span class="insight-detail">Words across your notes</span>
      </div>
    `;
    const welcome = document.querySelector(".welcome-section");
    welcome.insertAdjacentElement("afterend", dashboard);
    clarityNumber = $("clarityNumber");
    clarityFill = $("clarityFill");
    clarityDetail = $("clarityDetail");
    fieldNumber = $("fieldNumber");
    fieldDetail = $("fieldDetail");
  }

  function ensureBackupControls() {
    if ($("backupActions")) return;
    const bottom = document.querySelector(".sidebar-bottom");
    if (!bottom) return;
    const actions = document.createElement("div");
    actions.className = "backup-actions";
    actions.id = "backupActions";
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "button button-secondary";
    exportButton.textContent = "↓ Backup";
    exportButton.title = "Export all projects as a JSON backup";
    exportButton.addEventListener("click", exportWorkspace);
    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "button button-secondary";
    importButton.textContent = "↑ Restore";
    importButton.title = "Restore projects from a JSON backup";
    importButton.addEventListener("click", () => backupInput.click());
    actions.append(exportButton, importButton);
    const status = bottom.querySelector(".local-status");
    if (status) status.insertAdjacentElement("afterend", actions);
    else bottom.prepend(actions);
    backupInput = document.createElement("input");
    backupInput.type = "file";
    backupInput.accept = ".json,application/json";
    backupInput.hidden = true;
    backupInput.setAttribute("aria-label", "Choose a workspace backup");
    backupInput.addEventListener("change", importWorkspace);
    bottom.appendChild(backupInput);
  }

  function updateInsights() {
    const project = getActiveProject();
    if (!project || !clarityNumber) return;
    const filled = getFilledFields(project);
    const score = getClarity(project);
    const words = CONTENT_FIELDS.reduce(
      (total, field) => total + countWords(project[field.id]),
      0
    );
    clarityNumber.textContent = score + "%";
    clarityFill.style.width = score + "%";
    const track = $("clarityTrack");
    track.setAttribute("aria-valuenow", String(score));
    clarityDetail.textContent =
      score === 100 ? "All core context fields are filled." :
      score >= 70 ? "Strong foundation. Close the remaining gaps." :
      score >= 35 ? "Good start. Add more useful project detail." :
      "Capture the essentials to make your handoff useful.";
    fieldNumber.textContent = filled.length + "/7";
    fieldDetail.textContent = filled.length === 7
      ? "Every context section has content"
      : (7 - filled.length) + " sections still need attention";
    $("wordNumber").textContent = words.toLocaleString();
    const sectionHeading = document.querySelector(".section-heading h2");
    if (sectionHeading) {
      sectionHeading.textContent = project.projectName.trim()
        ? "Build the context for " + project.projectName.trim() + "."
        : "Let's get the context down.";
    }
  }

  function renderProjectList() {
    elements.projectList.replaceChildren();
    if (projects.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-projects";
      empty.textContent = "Your projects will appear here.";
      elements.projectList.appendChild(empty);
      return;
    }
    projects.forEach((project) => {
      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "project-item" +
        (project.id === activeProjectId ? " active" : "");
      selectButton.setAttribute(
        "aria-current",
        project.id === activeProjectId ? "page" : "false"
      );
      const icon = document.createElement("span");
      icon.className = "project-item-icon";
      icon.textContent = "◈";
      const name = document.createElement("span");
      name.className = "project-item-name";
      name.textContent = project.projectName.trim() || "Untitled project";
      name.title = name.textContent;
      selectButton.append(icon, name);
      selectButton.addEventListener("click", () => {
        switchProject(project.id);
      });
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "project-item-delete";
      deleteButton.textContent = "×";
      deleteButton.title = "Delete " +
        (project.projectName.trim() || "Untitled project");
      deleteButton.setAttribute("aria-label", deleteButton.title);
      deleteButton.addEventListener("click", () => {
        collectFormIntoProject();
        pendingDeleteId = project.id;
        if (typeof elements.deleteDialog.showModal === "function") {
          elements.deleteDialog.showModal();
        } else if (window.confirm("Delete this project?")) {
          deleteProject(pendingDeleteId);
        }
      });
      const row = document.createElement("div");
      row.className = "project-row";
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "3px";
      selectButton.style.flex = "1";
      selectButton.style.minWidth = "0";
      row.append(selectButton, deleteButton);
      elements.projectList.appendChild(row);
    });
  }

  function collectFormIntoProject() {
    const project = getActiveProject();
    if (!project) return;
    const values = readFields();
    FIELD_IDS.forEach((id) => {
      project[id] = values[id];
    });
    project.updatedAt = new Date().toISOString();
    const snapshot = serializeState();
    if (snapshot !== lastSavedSnapshot) {
      setAutosaveStatus("Saving…", "saving");
      saveProjects();
    }
    elements.breadcrumbProject.textContent =
      project.projectName.trim() || "Untitled project";
    renderProjectList();
    updateInsights();
  }

  function switchProject(id) {
    collectFormIntoProject();
    const project = projects.find((item) => item.id === id);
    if (!project) return;
    activeProjectId = id;
    writeFields(project);
    elements.outputSection.hidden = true;
    elements.handoffOutput.value = "";
    briefIsStale = true;
    saveProjects();
    renderProjectList();
    updateInsights();
  }

  function createProject() {
    collectFormIntoProject();
    const project = makeProject("Untitled project");
    projects.unshift(project);
    activeProjectId = project.id;
    writeFields(project);
    elements.outputSection.hidden = true;
    elements.handoffOutput.value = "";
    saveProjects();
    renderProjectList();
    updateInsights();
    elements.projectName.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast("Fresh project created. Let's build something useful.");
  }

  function deleteProject(id) {
    const index = projects.findIndex((project) => project.id === id);
    if (index === -1) return;
    projects = projects.filter((project) => project.id !== id);
    if (activeProjectId === id) {
      const nextProject = projects[0] || null;
      if (!nextProject) {
        const replacement = makeProject();
        projects = [replacement];
        activeProjectId = replacement.id;
        writeFields(replacement);
      } else {
        activeProjectId = nextProject.id;
        writeFields(nextProject);
      }
      elements.outputSection.hidden = true;
      elements.handoffOutput.value = "";
    }
    saveProjects();
    renderProjectList();
    updateInsights();
    showToast("Project deleted.");
  }

  function cleanHeading(value) {
    return (value || "")
      .replace(/\r/g, "")
      .replace(/\n/g, " ")
      .trim();
  }

  function suggestNextSteps(project) {
    const text = [
      project.projectGoal,
      project.projectContext,
      project.projectQuestions,
      project.projectCompleted
    ].join(" ").toLowerCase();
    const suggestions = [];
    if (text.includes("reputation") || text.includes("credibility")) {
      suggestions.push(
        "Choose one narrow AI area to become known for, rather than trying to cover the entire field.",
        "Build and publish a small, working project that demonstrates your skills. Include a public demo, source code, and a clear explanation of the problem it solves.",
        "Write a short build log: the problem, your approach, what failed, what worked, and what you learned.",
        "Contribute thoughtfully to relevant open-source projects or technical discussions. Prioritize useful contributions over self-promotion."
      );
    } else if (
      text.includes("customer") ||
      text.includes("business") ||
      text.includes("startup") ||
      text.includes("revenue")
    ) {
      suggestions.push(
        "Identify a specific target user and one costly or frustrating problem they experience.",
        "Speak to potential users before investing heavily in a solution.",
        "Build the smallest testable version and gather feedback before expanding the scope.",
        "Define one measurable signal of progress, such as repeat usage, time saved, or willingness to pay."
      );
    } else {
      suggestions.push(
        "Define a clear, measurable outcome for the next milestone.",
        "Identify the single biggest unknown or risk that could block progress.",
        "Choose one small experiment or deliverable that tests that assumption.",
        "Record the result, lessons learned, and the next decision in this project."
      );
    }
    if (/\$?\s*700|budget|low.cost|limited funds/.test(text)) {
      suggestions.push(
        "Protect the available budget: start with free tools, track expenses, and spend only when an experiment justifies it."
      );
    }
    return suggestions;
  }

  function buildHandoffMarkdown(project, tone = "millennial") {
    const isGenZ = tone === "genz";
    const projectName = cleanHeading(project.projectName) || "Untitled project";
    const filled = getFilledFields(project);
    const score = getClarity(project);
    const created = project.createdAt
      ? new Date(project.createdAt).toLocaleDateString()
      : "Not recorded";
    const updated = project.updatedAt
      ? new Date(project.updatedAt).toLocaleDateString()
      : "Not recorded";
    const labels = isGenZ
      ? {
          title: "# THE PROJECT HANDOFF",
          snapshot: "## 01 · The quick download",
          context: "## 02 · The full lore",
          gaps: "## 03 · Gaps to sort out",
          next: "## 04 · Next moves",
          rules: "## 05 · Ground rules for the next assistant",
          first: "## 06 · First response",
          goal: "The mission 🎯",
          situation: "Where things stand",
          progress: "What we've shipped",
          missing: "_Not added yet — ask about this if it affects the next move._",
          completeness: "Context captured",
          intro: "Here's the handoff so the next assistant can pick up where things left off. Keep the goal in focus, respect the decisions below, and don't make stuff up.",
          gapsFull: "All seven context sections have something in them. Give the details a quick reality check before acting.",
          gapsEmpty: "These sections are still empty or may need more detail:",
          recordedNext: "The next steps below come from the project notes. Keep the user's priorities intact; suggestions are optional, not decisions.",
          suggestedNext: "No next steps were added yet. Here are a few starter ideas based on the notes — check with the user before treating them as a plan.",
          firstResponse: "Give a quick recap of the project, call out the biggest open question, then suggest one realistic next move based on the notes.",
          disclaimer: "_Made locally from the notes entered here — this wasn't researched or written by an AI model. Suggestions are starting points, not verified facts or guaranteed outcomes._"
        }
      : {
          title: "# PROJECT HANDOFF BRIEF",
          snapshot: "## 01 · Executive summary",
          context: "## 02 · Project context",
          gaps: "## 03 · Information gaps",
          next: "## 04 · Suggested next steps",
          rules: "## 05 · Instructions for the next assistant",
          first: "## 06 · Requested first response",
          goal: "Project objective",
          situation: "Current situation",
          progress: "Work completed",
          missing: "_Not provided yet — clarify this with the user if it affects the next decision._",
          completeness: "Context completeness",
          intro: "This brief summarizes the current project context, prior decisions, constraints, outstanding questions, and next steps to support a consistent continuation of work.",
          gapsFull: "All seven context sections contain information. Review the details for specificity and accuracy before acting.",
          gapsEmpty: "The following sections are empty or may need additional detail:",
          recordedNext: "The user's recorded next steps are listed below. Preserve their priorities. The additional ideas are optional recommendations, not decisions already made.",
          suggestedNext: "No next steps were recorded. The following are proposed starting points based on the supplied information; confirm them with the user before treating them as commitments.",
          firstResponse: "Briefly summarize your understanding of the project. Identify the most important unresolved question, then propose one practical next action grounded in the supplied context.",
          disclaimer: "_This brief was generated locally from user-entered notes. It was not researched or written by an AI model. Suggested next steps are general prompts for discussion, not verified facts or guaranteed outcomes._"
        };
    const sectionLabels = isGenZ
      ? {
          projectGoal: "The mission 🎯",
          projectContext: "The lore 📚",
          projectDecisions: "What's locked in 🔒",
          projectConstraints: "The limits — keep it real 🚧",
          projectCompleted: "What we've shipped 🚀",
          projectQuestions: "Open loops 🤔",
          projectNextSteps: "Next moves 🔥"
        }
      : Object.fromEntries(CONTENT_FIELDS.map((field) => [field.id, field.label]));
    const parts = [
      labels.title,
      "",
      "**Project:** " + projectName,
      "**Prepared with:** Mango Context Kit · Mango Ships",
      "**" + labels.completeness + ":** " + score + "%",
      "**Created:** " + created,
      "**Last updated:** " + updated,
      "",
      labels.intro,
      "",
      "---",
      "",
      labels.snapshot,
      "",
      "**" + labels.goal + ":** " + (project.projectGoal.trim() || (isGenZ
        ? "Not defined yet. Let's get clear on the outcome."
        : "Not defined yet. Ask the user to clarify the desired outcome.")),
      "",
      "**" + labels.situation + ":** " + (project.projectContext.trim() || (isGenZ
        ? "Not enough context yet. Don't fill in the blanks with guesses."
        : "Insufficient background has been provided. Do not invent missing facts.")),
      "",
      "**" + labels.progress + ":** " + (project.projectCompleted.trim() || (isGenZ
        ? "No completed work has been logged yet."
        : "No completed work has been documented yet.")),
      "",
      labels.context,
      ""
    ];
    CONTENT_FIELDS.forEach((field, index) => {
      const value = (project[field.id] || "").trim();
      parts.push("### " + String(index + 1).padStart(2, "0") + " · " + sectionLabels[field.id]);
      parts.push("");
      parts.push(value || labels.missing);
      parts.push("");
    });
    parts.push(
      labels.gaps,
      "",
      filled.length === CONTENT_FIELDS.length ? labels.gapsFull : labels.gapsEmpty
    );
    CONTENT_FIELDS
      .filter((field) => !(project[field.id] || "").trim())
      .forEach((field) => {
        parts.push("- **" + sectionLabels[field.id] + ":** " + field.prompt);
      });
    parts.push(
      "",
      labels.next,
      "",
      project.projectNextSteps.trim() ? labels.recordedNext : labels.suggestedNext
    );
    suggestNextSteps(project).forEach((step, index) => {
      parts.push((index + 1) + ". " + (isGenZ
        ? step
            .replace("Define a clear, measurable outcome", "Pick a clear, measurable win")
            .replace("Identify the single biggest unknown or risk", "Spot the biggest unknown or risk")
            .replace("Choose one small experiment or deliverable", "Run one small experiment or ship one useful thing")
            .replace("Record the result, lessons learned", "Log the result and what you learned")
        : step));
    });
    const operatingRules = isGenZ
      ? [
          "1. Treat the project notes as the source of truth — don't invent lore.",
          "2. Label facts, assumptions, guesses, and recommendations clearly.",
          "3. Don't claim work, results, credentials, or research that hasn't actually happened.",
          "4. Respect the budget, constraints, and decisions already locked in.",
          "5. Ask a focused question if missing info could change the recommendation.",
          "6. Prefer useful deliverables and small tests over vague hype.",
          "7. Explain trade-offs, costs, and what success would look like.",
          "8. After doing substantial work, recap what changed and name the next move."
        ]
      : [
          "1. Treat the user's recorded information as the source of truth.",
          "2. Clearly distinguish known facts, assumptions, hypotheses, and recommendations.",
          "3. Do not claim progress, credentials, results, or research that has not been demonstrated.",
          "4. Respect the project's stated budget, constraints, and prior decisions.",
          "5. Ask focused questions when missing information could materially change the recommendation.",
          "6. Prefer concrete deliverables, small experiments, and measurable outcomes over vague motivation.",
          "7. When suggesting a plan, explain the rationale, trade-offs, cost, and success criteria.",
          "8. At the end of substantial work, summarize what changed and recommend the next action."
        ];
    parts.push("", labels.rules, "", ...operatingRules, "", labels.first, "", labels.firstResponse, "", "---", "", labels.disclaimer, "");
    return parts.join("\n");
  }

 
async function generateMarkdown() {
  // Prevent duplicate generation.
  if (elements.generateBtn.disabled) return;

  collectFormIntoProject();

  const project = getActiveProject();

  if (!project) {
    showToast("Create a project before generating a handoff.");
    return;
  }

  if (
    !project.projectName.trim() &&
    !CONTENT_FIELDS.some((field) => project[field.id].trim())
  ) {
    showToast("Add a project name and at least one useful detail first.");
    elements.projectName.focus();
    return;
  }

  const loader = $("generationLoader");
  const button = elements.generateBtn;
  const originalButtonHTML = button.innerHTML;

  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Preparing handoff...";
  elements.outputSection.hidden = true;

  if (loader) {
    loader.hidden = false;
    loader.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  try {
    // A fresh random duration each time: 3.2 to 4.8 seconds.
    const waitTime = 3200 + Math.floor(Math.random() * 1601);

    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // Build the brief using the selected tone.
    elements.handoffOutput.value = buildHandoffMarkdown(
      project,
      elements.toneSelect?.value || "millennial"
    );

    elements.outputSection.hidden = false;
    briefIsStale = false;

    elements.outputSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    showToast("Your handoff brief is ready. Review it before sharing.");
  } catch (error) {
    console.error("Handoff generation failed:", error);
    showToast("Something went wrong. Please try generating the brief again.");
  } finally {
    if (loader) loader.hidden = true;

    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = originalButtonHTML;
  }
}


  async function copyBrief() {
    const text = elements.handoffOutput.value;
    if (!text.trim()) {
      showToast("Generate a handoff brief first.");
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        elements.handoffOutput.focus();
        elements.handoffOutput.select();
        const copied = document.execCommand("copy");
        if (!copied) throw new Error("Copy failed");
        elements.handoffOutput.setSelectionRange(0, 0);
      }
      showToast(
        "Brief copied. Paste it into your next AI chat. Review it first if your notes are sensitive."
      );
    } catch (error) {
      elements.handoffOutput.focus();
      elements.handoffOutput.select();
      showToast(
        "Automatic copy failed. The text is selected — press Ctrl+C."
      );
    }
  }

  function safeFileName(value) {
    return (value || "mango-context-kit")
      .trim()
      .replace(/[<>:"/\\\|?*\u0000-\u001F]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 70) || "mango-context-kit";
  }

  function downloadText(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadBrief() {
    const text = elements.handoffOutput.value;
    if (!text.trim()) {
      showToast("Generate a handoff brief first.");
      return;
    }
    try {
      const project = getActiveProject();
      downloadText(
        safeFileName(project?.projectName) + "-handoff.md",
        text,
        "text/markdown;charset=utf-8"
      );
      showToast("Markdown brief exported. Keep it as a backup.");
    } catch (error) {
      showToast("Export failed. Try copying the brief instead.");
    }
  }

  function exportWorkspace() {
    collectFormIntoProject();
    const backup = {
      app: "Mango Context Kit",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      activeProjectId,
      projects
    };
    try {
      downloadText(
        "mango-context-kit-backup-" +
          new Date().toISOString().slice(0, 10) + ".json",
        JSON.stringify(backup, null, 2),
        "application/json;charset=utf-8"
      );
      showToast("Workspace backup exported. Keep the JSON file somewhere safe.");
    } catch (error) {
      showToast("Backup export failed. Try exporting the handoff brief instead.");
    }
  }

  async function importWorkspace(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("This backup is larger than 5 MB.");
      }
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.projects)) {
        throw new Error("This file is not a valid Mango Context Kit backup.");
      }
      const imported = data.projects
        .filter((project) =>
          project &&
          typeof project.id === "string" &&
          FIELD_IDS.every((id) => typeof project[id] === "string")
        )
        .map((project) => ({
          ...makeProject(),
          ...project
        }));
      if (imported.length === 0) {
        throw new Error("No valid projects were found in this backup.");
      }
      const confirmed = window.confirm(
        "Restore " + imported.length + " project(s)?\n\n" +
        "This replaces the projects currently stored in this browser. " +
        "Export a backup of your current workspace first if you need it."
      );
      if (!confirmed) return;
      projects = imported;
      activeProjectId = imported.some(
        (project) => project.id === data.activeProjectId
      ) ? data.activeProjectId : imported[0].id;
      const active = getActiveProject();
      writeFields(active);
      elements.outputSection.hidden = true;
      elements.handoffOutput.value = "";
      storageAvailable = true;
      lastSavedSnapshot = "";
      saveProjects();
      renderProjectList();
      updateInsights();
      showToast("Backup restored. Check your projects and verify the imported content.");
    } catch (error) {
      showToast(error.message || "Could not import this backup.");
    } finally {
      event.target.value = "";
    }
  }

  function initialize() {
    ensureInsights();
    ensureBackupControls();
    const saved = readSavedProjects();
    if (saved) {
      projects = saved.projects;
      activeProjectId = saved.activeProjectId;
    }
    if (!projects.length) {
      const starter = makeProject();
      projects = [starter];
      activeProjectId = starter.id;
    }
    if (!projects.some((project) => project.id === activeProjectId)) {
      activeProjectId = projects[0].id;
    }
    writeFields(getActiveProject());
    renderProjectList();
    updateInsights();
    const statusContainer = document.querySelector(".autosave-label");
    if (statusContainer) {
      autosaveText = document.createElement("span");
      autosaveText.textContent = "Saved locally";
      statusContainer.appendChild(autosaveText);
    }
    try {
      lastSavedSnapshot = localStorage.getItem(STORAGE_KEY) || "";
    } catch (error) {
      storageAvailable = false;
      setAutosaveStatus("Storage unavailable", "error");
      showToast("Browser storage is unavailable. Export your notes regularly.");
    }
    elements.projectForm.addEventListener("input", () => {
      collectFormIntoProject();
      if (!elements.outputSection.hidden) {
        briefIsStale = true;
        showToast("Your notes changed. Regenerate the brief before copying it.");
        elements.outputSection.hidden = true;
      }
    });
    elements.newProjectBtn.addEventListener("click", createProject);
    elements.generateBtn.addEventListener("click", generateMarkdown);
    elements.toneSelect?.addEventListener("change", () => {
      if (!elements.outputSection.hidden) {
        elements.outputSection.hidden = true;
        elements.handoffOutput.value = "";
        briefIsStale = true;
        showToast("Tone changed. Generate the brief again to use the new style.");
      }
    });
    elements.copyBtn.addEventListener("click", copyBrief);
    elements.downloadBtn.addEventListener("click", downloadBrief);
    elements.confirmDeleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      if (pendingDeleteId) {
        deleteProject(pendingDeleteId);
      }
      pendingDeleteId = null;
      elements.deleteDialog.close();
    });
    elements.deleteDialog.addEventListener("close", () => {
      pendingDeleteId = null;
    });
    if (saved && storageAvailable) {
      saveProjects();
    } else if (!saved && storageAvailable) {
      saveProjects();
    }
  }

  initialize();
})();