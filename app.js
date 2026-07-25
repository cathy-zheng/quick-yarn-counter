const STORAGE_KEY = "cozy-yarn-counter-v3";
const LEGACY_KEYS = ["cozy-yarn-counter-v2", "cozy-yarn-counter-v1"];
const DB_NAME = "cozy-yarn-files";
const STORE_NAME = "attachments";

const $ = selector => document.querySelector(selector);
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const today = () => new Date().toISOString().slice(0, 10);
const html = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

let state = loadState();
let undoStack = [];
let previewUrl = null;

function blankYarn() {
  return { name:"", colorway:"", weight:"", fiber:"", toolSize:"", amountUsed:"", gaugeStitches:"", gaugeRows:"", gaugeWidth:"", gaugeNotes:"" };
}

function makeProject(name = "New Yarn Project") {
  return {
    id: uid(), name, count: 0, target: 100, counterType: "Rows", notes: "",
    startDate: today(), lastWorkedDate: "", finishedDate: "",
    workDates: [], sessions: [], timerStartedAt: null, activity: [],
    yarn: blankYarn(), parts: []
  };
}

function migrateProject(project) {
  return {
    ...makeProject(project?.name || "Yarn Project"),
    ...project,
    yarn: { ...blankYarn(), ...(project?.yarn || {}) },
    workDates: Array.isArray(project?.workDates) ? project.workDates : [],
    sessions: Array.isArray(project?.sessions) ? project.sessions : [],
    activity: Array.isArray(project?.activity) ? project.activity : [],
    parts: Array.isArray(project?.parts) ? project.parts : []
  };
}

function loadState() {
  for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved?.projects?.length) {
        const migrated = { activeId: saved.activeId, projects: saved.projects.map(migrateProject) };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch { /* keep trying */ }
  }
  const project = makeProject("My Yarn Project");
  return { activeId: project.id, projects: [project] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function activeProject() {
  return state.projects.find(project => project.id === state.activeId) || state.projects[0];
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 1700);
}

function markWorked(addActivity = false) {
  const project = activeProject();
  const date = today();
  project.lastWorkedDate = date;
  if (!project.workDates.includes(date)) project.workDates.push(date);
  if (addActivity) addActivityEntry("Worked on project today", false);
  saveState();
  renderStats();
}

function addActivityEntry(text, markDate = true) {
  const project = activeProject();
  project.activity.unshift({ id: uid(), at: new Date().toISOString(), text });
  project.activity = project.activity.slice(0, 300);
  if (markDate) markWorked(false);
  saveState();
  renderActivity();
}

function setCounter(nextValue) {
  const project = activeProject();
  undoStack.push({ projectId: project.id, count: project.count });
  if (undoStack.length > 50) undoStack.shift();
  const previous = project.count;
  project.count = Math.max(0, Number(nextValue) || 0);
  saveState();
  renderCounter();
  addActivityEntry(`${project.counterType || "Row"} count ${previous} → ${project.count}`);
  if (project.target > 0 && project.count === project.target) showToast("Target reached! 🎉");
}

function totalTrackedMilliseconds(project) {
  const completed = project.sessions.reduce((sum, session) => sum + Math.max(0, session.end - session.start), 0);
  return completed + (project.timerStartedAt ? Date.now() - project.timerStartedAt : 0);
}

function formatDuration(milliseconds) {
  const minutes = Math.floor(milliseconds / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatLive(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}

function toggleTimer() {
  const project = activeProject();
  if (project.timerStartedAt) {
    const start = project.timerStartedAt;
    const end = Date.now();
    project.sessions.push({ id: uid(), start, end });
    project.timerStartedAt = null;
    addActivityEntry(`Work session: ${formatDuration(end - start)}`);
  } else {
    project.timerStartedAt = Date.now();
    addActivityEntry("Started a work session");
  }
  saveState();
  renderStats();
  renderLiveTimer();
}

function renderCounter() {
  const project = activeProject();
  const target = Math.max(0, Number(project.target) || 0);
  const percent = target ? Math.min(100, Math.round(project.count / target * 100)) : 0;
  $("#counter-value").textContent = project.count;
  $("#counter-label").textContent = `${project.counterType || "Row"} counter`;
  $("#progress-text").textContent = target ? `${project.count} of ${target}` : `${project.count} counted`;
  $("#progress-percent").textContent = target ? `${percent}%` : "No target";
  $("#progress-fill").style.width = `${percent}%`;
}

function renderStats() {
  const project = activeProject();
  const start = project.startDate ? new Date(`${project.startDate}T00:00:00`) : new Date();
  const age = Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
  $("#days-since").textContent = `${age} day${age === 1 ? "" : "s"}`;
  $("#days-worked").textContent = project.workDates.length;
  $("#tracked-time").textContent = formatDuration(totalTrackedMilliseconds(project));
  const timerButton = $("#timer-button");
  timerButton.textContent = project.timerStartedAt ? "Stop work session" : "Start work session";
  timerButton.classList.toggle("running", Boolean(project.timerStartedAt));
}

function renderLiveTimer() {
  const project = activeProject();
  $("#live-timer").textContent = formatLive(project.timerStartedAt ? Date.now() - project.timerStartedAt : 0);
  $("#tracked-time").textContent = formatDuration(totalTrackedMilliseconds(project));
}

function makePart(name = "New part") {
  return { id: uid(), name, count: 0, target: 0, status: "Not started", notes: "", children: [] };
}

function flattenParts(parts, depth = 0, result = []) {
  for (const part of parts) {
    result.push({ part, depth });
    flattenParts(part.children || [], depth + 1, result);
  }
  return result;
}

function removePart(parts, id) {
  const index = parts.findIndex(part => part.id === id);
  if (index >= 0) { parts.splice(index, 1); return true; }
  return parts.some(part => removePart(part.children || [], id));
}

function renderParts() {
  const project = activeProject();
  const host = $("#parts-list");
  host.innerHTML = "";
  const parts = flattenParts(project.parts);
  if (!parts.length) {
    host.innerHTML = '<div class="empty-state">No parts yet.</div>';
    return;
  }

  for (const { part, depth } of parts) {
    const card = document.createElement("div");
    card.className = "part-card";
    card.dataset.depth = String(Math.min(depth, 3));
    card.innerHTML = `
      <div class="part-header">
        <input class="part-name" value="${html(part.name)}" aria-label="Part name">
        <span class="muted">${depth ? "Sub-part" : "Part"}</span>
      </div>
      <div class="part-fields">
        <input class="part-count" type="number" min="0" value="${part.count}" aria-label="Part count">
        <input class="part-target" type="number" min="0" value="${part.target}" aria-label="Part target">
        <select class="part-status" aria-label="Part status">
          <option>Not started</option><option>Working</option><option>Paused</option><option>Finished</option>
        </select>
      </div>
      <div class="part-actions">
        <button class="part-minus">−1</button><button class="part-plus">+1</button>
        <button class="part-child">＋ Sub-part</button><button class="part-notes">Notes</button>
        <button class="part-delete danger-text">Delete</button>
      </div>`;

    card.querySelector(".part-status").value = part.status;
    card.querySelector(".part-name").addEventListener("change", event => {
      part.name = event.target.value;
      saveState();
      addActivityEntry(`Renamed part to ${part.name}`);
    });
    card.querySelector(".part-count").addEventListener("change", event => {
      const old = part.count;
      part.count = Math.max(0, Number(event.target.value) || 0);
      saveState();
      addActivityEntry(`${part.name}: ${old} → ${part.count}`);
    });
    card.querySelector(".part-target").addEventListener("change", event => {
      part.target = Math.max(0, Number(event.target.value) || 0);
      saveState();
    });
    card.querySelector(".part-status").addEventListener("change", event => {
      part.status = event.target.value;
      saveState();
      addActivityEntry(`${part.name} marked ${part.status}`);
    });
    card.querySelector(".part-minus").addEventListener("click", () => {
      part.count = Math.max(0, part.count - 1);
      saveState(); addActivityEntry(`${part.name}: count ${part.count}`); renderParts();
    });
    card.querySelector(".part-plus").addEventListener("click", () => {
      part.count += 1;
      saveState(); addActivityEntry(`${part.name}: count ${part.count}`); renderParts();
    });
    card.querySelector(".part-child").addEventListener("click", () => {
      part.children ||= [];
      part.children.push(makePart("New sub-part"));
      saveState(); renderParts(); addActivityEntry(`Added a sub-part to ${part.name}`);
    });
    card.querySelector(".part-notes").addEventListener("click", () => {
      const notes = prompt(`Notes for ${part.name}`, part.notes || "");
      if (notes !== null) { part.notes = notes; saveState(); addActivityEntry(`Updated notes for ${part.name}`); }
    });
    card.querySelector(".part-delete").addEventListener("click", () => {
      if (confirm(`Delete “${part.name}” and all of its sub-parts?`)) {
        removePart(project.parts, part.id);
        saveState(); renderParts(); addActivityEntry(`Deleted part: ${part.name}`);
      }
    });
    host.appendChild(card);
  }
}

function renderActivity() {
  const host = $("#activity-list");
  host.innerHTML = "";
  const activity = activeProject().activity;
  if (!activity.length) {
    host.innerHTML = '<div class="empty-state">No activity yet.</div>';
    return;
  }
  for (const item of activity.slice(0, 100)) {
    const row = document.createElement("div");
    row.className = "activity-item";
    row.innerHTML = `${html(item.text)}<time>${new Date(item.at).toLocaleString()}</time>`;
    host.appendChild(row);
  }
}

function renderProjectList() {
  const host = $("#project-list");
  host.innerHTML = "";
  for (const project of state.projects) {
    const row = document.createElement("div");
    row.className = `project-row${project.id === state.activeId ? " active" : ""}`;
    row.innerHTML = `
      <strong>${html(project.name || "Untitled project")}</strong>
      <span>${project.count}</span>
      <button class="open-project">${project.id === state.activeId ? "Open" : "View"}</button>
      <button class="delete-project danger-text">×</button>`;
    row.querySelector(".open-project").addEventListener("click", () => {
      state.activeId = project.id;
      undoStack = [];
      saveState(); renderAll();
    });
    row.querySelector(".delete-project").addEventListener("click", async () => {
      if (state.projects.length === 1) return showToast("Keep at least one project");
      if (!confirm(`Delete “${project.name}”?`)) return;
      await deleteAttachmentsForProject(project.id);
      state.projects = state.projects.filter(item => item.id !== project.id);
      if (state.activeId === project.id) state.activeId = state.projects[0].id;
      saveState(); renderAll();
    });
    host.appendChild(row);
  }
}

function bindProjectValues() {
  const project = activeProject();
  const values = {
    "project-name": project.name,
    "counter-target": project.target,
    "counter-type": project.counterType,
    "project-notes": project.notes,
    "start-date": project.startDate,
    "last-worked-date": project.lastWorkedDate,
    "finished-date": project.finishedDate,
    "yarn-name": project.yarn.name,
    "colorway": project.yarn.colorway,
    "yarn-weight": project.yarn.weight,
    "fiber": project.yarn.fiber,
    "tool-size": project.yarn.toolSize,
    "amount-used": project.yarn.amountUsed,
    "gauge-stitches": project.yarn.gaugeStitches,
    "gauge-rows": project.yarn.gaugeRows,
    "gauge-width": project.yarn.gaugeWidth,
    "gauge-notes": project.yarn.gaugeNotes
  };
  for (const [id, value] of Object.entries(values)) $(`#${id}`).value = value ?? "";
}

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getAttachmentsForProject(projectId) {
  return (await dbGetAll()).filter(item => item.projectId === projectId);
}

async function deleteAttachmentsForProject(projectId) {
  const records = await getAttachmentsForProject(projectId);
  await Promise.all(records.map(record => dbDelete(record.id)));
}

function dataUrlToBlob(dataUrl) {
  const [header, payload] = dataUrl.split(",");
  const type = header.match(/data:(.*?);/)?.[1] || "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function attachmentBlob(record) {
  if (record.blob instanceof Blob) return record.blob;
  if (typeof record.data === "string" && record.data.startsWith("data:")) return dataUrlToBlob(record.data);
  return null;
}

async function migrateLegacyAttachment(record) {
  if (record.blob instanceof Blob || !record.data) return record;
  const blob = attachmentBlob(record);
  if (!blob) return record;
  const migrated = { ...record, blob };
  delete migrated.data;
  await dbPut(migrated);
  return migrated;
}

async function addAttachments(fileList) {
  for (const file of fileList) {
    if (!(file.type.startsWith("image/") || file.type === "application/pdf")) continue;
    await dbPut({
      id: uid(), projectId: activeProject().id, name: file.name,
      type: file.type, size: file.size, addedAt: new Date().toISOString(), blob: file
    });
    addActivityEntry(`Added attachment: ${file.name}`);
  }
  await renderAttachments();
  showToast("Files saved");
}

async function renderAttachments() {
  const host = $("#attachment-list");
  host.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    let records = await getAttachmentsForProject(activeProject().id);
    records = await Promise.all(records.map(migrateLegacyAttachment));
    host.innerHTML = "";
    if (!records.length) {
      host.innerHTML = '<div class="empty-state">No files attached.</div>';
      return;
    }
    for (const record of records) {
      const blob = attachmentBlob(record);
      const thumbnailUrl = blob && record.type.startsWith("image/") ? URL.createObjectURL(blob) : null;
      const card = document.createElement("div");
      card.className = "attachment-card";
      card.innerHTML = `
        <div class="attachment-thumb">${thumbnailUrl ? `<img src="${thumbnailUrl}" alt="">` : "📄"}</div>
        <div><div class="attachment-name">${html(record.name)}</div><div class="attachment-meta">${Math.round((record.size || blob?.size || 0) / 1024)} KB · ${new Date(record.addedAt).toLocaleDateString()}</div></div>
        <div class="attachment-actions"><button class="preview-file">Preview</button><button class="delete-file danger-text">Delete</button></div>`;
      card.querySelector(".preview-file").addEventListener("click", () => previewAttachment(record));
      card.querySelector(".delete-file").addEventListener("click", async () => {
        if (!confirm(`Delete “${record.name}”?`)) return;
        await dbDelete(record.id);
        addActivityEntry(`Deleted attachment: ${record.name}`);
        await renderAttachments();
      });
      if (thumbnailUrl) card.querySelector("img").addEventListener("load", () => URL.revokeObjectURL(thumbnailUrl), { once: true });
      host.appendChild(card);
    }
  } catch (error) {
    console.error(error);
    host.innerHTML = '<div class="empty-state">Could not load attachments.</div>';
  }
}

async function previewAttachment(originalRecord) {
  const record = await migrateLegacyAttachment(originalRecord);
  const blob = attachmentBlob(record);
  if (!blob) return showToast("This attachment could not be read");

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  $("#preview-title").textContent = record.name;
  $("#preview-meta").textContent = `${record.type || blob.type} · ${Math.round(blob.size / 1024)} KB`;
  $("#open-original").href = previewUrl;
  $("#download-original").href = previewUrl;
  $("#download-original").download = record.name;

  const body = $("#preview-body");
  body.innerHTML = "";
  if ((record.type || blob.type).startsWith("image/")) {
    const image = new Image();
    image.src = previewUrl;
    image.alt = record.name;
    body.appendChild(image);
  } else if ((record.type || blob.type) === "application/pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = previewUrl;
    iframe.title = record.name;
    body.appendChild(iframe);
    const fallback = document.createElement("div");
    fallback.className = "preview-fallback";
    fallback.textContent = "If the PDF viewer stays blank on your iPhone, tap “Open in Safari” below.";
    body.appendChild(fallback);
    iframe.addEventListener("load", () => fallback.remove(), { once: true });
  }
  $("#preview-dialog").showModal();
}

function closePreview() {
  $("#preview-dialog").close();
  $("#preview-body").innerHTML = "";
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function exportBackup() {
  const records = await dbGetAll();
  const attachments = [];
  for (const record of records) {
    const blob = attachmentBlob(record);
    attachments.push({ ...record, blob: undefined, data: blob ? await blobToDataUrl(blob) : record.data });
  }
  const payload = { version: 3, exportedAt: new Date().toISOString(), state, attachments };
  const file = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cozy-yarn-backup-${today()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function restoreBackup(file) {
  try {
    const backup = JSON.parse(await file.text());
    if (!backup?.state?.projects?.length) throw new Error("Invalid backup");
    if (!confirm("Replace all current projects and attachments with this backup?")) return;

    state = { ...backup.state, projects: backup.state.projects.map(migrateProject) };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const existing = await dbGetAll();
    await Promise.all(existing.map(record => dbDelete(record.id)));
    for (const record of backup.attachments || []) {
      const blob = record.data ? dataUrlToBlob(record.data) : record.blob;
      await dbPut({ ...record, data: undefined, blob });
    }
    renderAll();
    showToast("Backup restored");
  } catch (error) {
    console.error(error);
    alert("Could not restore this backup.");
  }
}

function renderAll() {
  bindProjectValues();
  renderCounter();
  renderStats();
  renderLiveTimer();
  renderParts();
  renderActivity();
  renderProjectList();
  renderAttachments();
}

function wireEvents() {
  $("#increment").addEventListener("click", () => setCounter(activeProject().count + 1));
  $("#decrement").addEventListener("click", () => setCounter(activeProject().count - 1));
  $("#add-five").addEventListener("click", () => setCounter(activeProject().count + 5));
  $("#undo").addEventListener("click", () => {
    const previous = undoStack.pop();
    if (!previous || previous.projectId !== activeProject().id) return showToast("Nothing to undo");
    activeProject().count = previous.count; saveState(); renderCounter();
  });
  $("#reset-counter").addEventListener("click", () => confirm("Reset this counter to zero?") && setCounter(0));
  $("#log-today").addEventListener("click", () => { markWorked(true); showToast("Today logged"); });
  $("#timer-button").addEventListener("click", toggleTimer);

  $("#new-project").addEventListener("click", () => {
    const project = makeProject(`Project ${state.projects.length + 1}`);
    state.projects.push(project); state.activeId = project.id; saveState(); renderAll();
    $("#project-name").focus(); $("#project-name").select();
  });
  $("#add-part").addEventListener("click", () => {
    activeProject().parts.push(makePart(`Part ${activeProject().parts.length + 1}`));
    saveState(); renderParts(); addActivityEntry("Added a project part");
  });
  $("#clear-activity").addEventListener("click", () => {
    if (confirm("Clear this project’s activity history?")) { activeProject().activity = []; saveState(); renderActivity(); }
  });

  $("#add-attachments").addEventListener("click", () => $("#attachment-input").click());
  $("#attachment-input").addEventListener("change", event => {
    addAttachments([...event.target.files]);
    event.target.value = "";
  });
  $("#close-preview").addEventListener("click", closePreview);
  $("#preview-dialog").addEventListener("click", event => {
    if (event.target === $("#preview-dialog")) closePreview();
  });

  $("#export-backup").addEventListener("click", exportBackup);
  $("#restore-backup").addEventListener("click", () => $("#restore-input").click());
  $("#restore-input").addEventListener("change", event => {
    if (event.target.files[0]) restoreBackup(event.target.files[0]);
    event.target.value = "";
  });

  const directFields = {
    "project-name": ["name", value => value],
    "counter-target": ["target", value => Math.max(0, Number(value) || 0)],
    "counter-type": ["counterType", value => value],
    "project-notes": ["notes", value => value],
    "start-date": ["startDate", value => value],
    "last-worked-date": ["lastWorkedDate", value => value],
    "finished-date": ["finishedDate", value => value]
  };
  for (const [id, [field, parse]] of Object.entries(directFields)) {
    $(`#${id}`).addEventListener("change", event => {
      activeProject()[field] = parse(event.target.value);
      saveState(); renderCounter(); renderStats(); renderProjectList();
    });
  }

  const yarnFields = {
    "yarn-name":"name", "colorway":"colorway", "yarn-weight":"weight", "fiber":"fiber",
    "tool-size":"toolSize", "amount-used":"amountUsed", "gauge-stitches":"gaugeStitches",
    "gauge-rows":"gaugeRows", "gauge-width":"gaugeWidth", "gauge-notes":"gaugeNotes"
  };
  for (const [id, field] of Object.entries(yarnFields)) {
    $(`#${id}`).addEventListener("change", event => {
      activeProject().yarn[field] = event.target.value;
      saveState(); markWorked(false);
    });
  }

  document.addEventListener("keydown", event => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
    if (["ArrowUp", "+", " "].includes(event.key)) { event.preventDefault(); setCounter(activeProject().count + 1); }
    if (["ArrowDown", "-"].includes(event.key)) { event.preventDefault(); setCounter(activeProject().count - 1); }
  });
}

wireEvents();
renderAll();
setInterval(renderLiveTimer, 1000);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.warn));
}
