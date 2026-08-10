const STORAGE_KEY = "celebsPackagesStudioDraftsV1";
const ALL_PACKAGES_ID = "__all__";
const PAGE_SIZE = 48;
const RAW_ROOT = "https://raw.githubusercontent.com/LeaSolBok/LeaSolBok.github.io/main/actorquiz/";

const TAB_LABELS = {
  celebrities: "Celebrities",
  characters: "Characters",
  special: "Special",
  posters: "Posters",
  logos: "Logos",
  emojis: "Emoji",
  riddles: "Riddles",
  facts: "Facts",
  other: "Other",
};
const TAB_ORDER = ["celebrities", "characters", "special", "posters", "logos", "emojis", "riddles", "facts", "other"];

const state = {
  data: null,
  packageId: ALL_PACKAGES_ID,
  tab: "all",
  query: "",
  aiOnly: false,
  limit: PAGE_SIZE,
  packageFileData: null,
  drafts: { version: 1, packages: [], additions: [] },
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const cleanText = value => typeof value === "string" ? value.trim() : "";

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2800);
}

function normalizeDrafts(value) {
  const drafts = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    version: 1,
    packages: Array.isArray(drafts.packages) ? drafts.packages.filter(item => item && typeof item === "object").map(packageRow) : [],
    additions: Array.isArray(drafts.additions) ? drafts.additions.filter(item => item && typeof item === "object").map(additionRow) : [],
  };
}

function packageRow(row) {
  return {
    id: cleanText(row.id),
    name: cleanText(row.name) || cleanText(row.id) || "New package",
    englishName: cleanText(row.englishName),
    tab: cleanText(row.tab) || "other",
    count: Array.isArray(row.people) ? row.people.length : 0,
    people: Array.isArray(row.people) ? row.people.filter(item => item && typeof item === "object").map(personRow) : [],
    sourceAvailable: true,
    custom: true,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : 9999,
  };
}

function personRow(row) {
  return {
    id: cleanText(row.id),
    key: cleanText(row.key),
    name: cleanText(row.name) || cleanText(row.key) || "Untitled",
    original: cleanText(row.original),
    gemini: cleanText(row.gemini),
    tmdbId: cleanText(row.tmdbId),
    details: cleanText(row.details),
  };
}

function additionRow(row) {
  return {
    id: cleanText(row.id) || `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    packageId: cleanText(row.packageId),
    key: cleanText(row.key),
    name: cleanText(row.name) || cleanText(row.key) || "Untitled",
    original: cleanText(row.original),
    gemini: cleanText(row.gemini),
    tmdbId: cleanText(row.tmdbId),
    details: cleanText(row.details),
    createdAt: cleanText(row.createdAt),
  };
}

function saveDrafts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.drafts));
}

function loadDrafts() {
  try { state.drafts = normalizeDrafts(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { state.drafts = normalizeDrafts(); }
}

function basePackages() {
  return Array.isArray(state.data?.packages) ? state.data.packages.map(row => ({ ...packageRow(row), custom: false, sourceAvailable: row.sourceAvailable !== false })) : [];
}

function packages() {
  return [...basePackages(), ...state.drafts.packages].filter(item => item.id).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || a.name.localeCompare(b.name, "en"));
}

function getPackage(id = state.packageId) {
  return packages().find(item => item.id === id);
}

function packageCount(packageData) {
  return packageData.people.length + state.drafts.additions.filter(item => item.packageId === packageData.id).length;
}

function allRows() {
  const collection = packages();
  const byId = new Map(collection.map(item => [item.id, item]));
  const rows = collection.flatMap(packageData => packageData.people.map((person, index) => ({
    ...person,
    id: person.id || `base:${packageData.id}:${person.key || index}`,
    packageId: packageData.id,
    packageName: packageData.name,
    packageTab: packageData.tab,
    draft: Boolean(packageData.custom),
    manual: false,
  })));
  state.drafts.additions.forEach(addition => {
    const packageData = byId.get(addition.packageId);
    if (!packageData) return;
    rows.push({ ...addition, packageName: packageData.name, packageTab: packageData.tab, draft: true, manual: true });
  });
  return rows;
}

function visibleRows() {
  const query = state.query.toLocaleLowerCase("en");
  return allRows().filter(row => {
    if (state.packageId !== ALL_PACKAGES_ID && row.packageId !== state.packageId) return false;
    if (state.tab !== "all" && row.packageTab !== state.tab) return false;
    if (state.aiOnly && !row.gemini) return false;
    if (!query) return true;
    return [row.name, row.key, row.packageName, row.details, row.tmdbId].join(" ").toLocaleLowerCase("en").includes(query);
  });
}

function packageTabs() {
  const available = new Set(packages().map(item => item.tab || "other"));
  return [...available].sort((a, b) => {
    const aIndex = TAB_ORDER.indexOf(a), bIndex = TAB_ORDER.indexOf(b);
    return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || a.localeCompare(b, "en");
  });
}

function labelForTab(tab) {
  return TAB_LABELS[tab] || tab || TAB_LABELS.other;
}

function updateStats() {
  const collection = packages();
  const count = collection.reduce((total, item) => total + packageCount(item), 0);
  $("#packageCount").textContent = collection.length.toLocaleString("en-US");
  $("#entryCount").textContent = count.toLocaleString("en-US");
  $("#draftCount").textContent = (state.drafts.packages.length + state.drafts.additions.length).toLocaleString("en-US");
}

function renderTabs() {
  const tabs = [{ id: "all", label: "All" }, ...packageTabs().map(id => ({ id, label: labelForTab(id) }))];
  if (!tabs.some(item => item.id === state.tab)) state.tab = "all";
  $("#tabs").innerHTML = tabs.map(tab => `<button type="button" class="${state.tab === tab.id ? "active" : ""}" data-tab="${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>`).join("");
  $$("#tabs button").forEach(button => button.onclick = () => {
    state.tab = button.dataset.tab;
    const selected = getPackage();
    if (state.packageId !== ALL_PACKAGES_ID && selected?.tab !== state.tab) state.packageId = ALL_PACKAGES_ID;
    state.limit = PAGE_SIZE;
    render();
  });
}

function renderPackages() {
  const visiblePackages = packages().filter(item => state.tab === "all" || item.tab === state.tab);
  if (state.packageId !== ALL_PACKAGES_ID && !visiblePackages.some(item => item.id === state.packageId)) state.packageId = ALL_PACKAGES_ID;
  const total = visiblePackages.reduce((sum, item) => sum + packageCount(item), 0);
  $("#sidePackageCount").textContent = `${visiblePackages.length}`;
  $("#packages").innerHTML = `<button class="all-packages ${state.packageId === ALL_PACKAGES_ID ? "active" : ""}" data-package="${ALL_PACKAGES_ID}"><span class="package-name">All packages</span><small>${total.toLocaleString("en-US")}</small></button>` + visiblePackages.map(item => `<button class="${item.id === state.packageId ? "active" : ""}" data-package="${escapeHtml(item.id)}"><span class="package-name">${item.custom ? '<i class="draft-dot"></i>' : ""}${escapeHtml(item.name)}</span><small>${packageCount(item).toLocaleString("en-US")}</small></button>`).join("");
  $$("#packages button").forEach(button => button.onclick = () => {
    state.packageId = button.dataset.package;
    state.limit = PAGE_SIZE;
    render();
  });
}

function initials(value) {
  const parts = String(value || "?").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(part => part[0]).join("").toLocaleUpperCase("en") || "?";
}

function placeholder(name) {
  return `<div class="placeholder" aria-label="No image for ${escapeHtml(name)}">${escapeHtml(initials(name))}<small>No image available</small></div>`;
}

function imageMarkup(row) {
  if (!row.original) return placeholder(row.name);
  if (!row.gemini) return `<div class="compare" data-fallback-name="${escapeHtml(row.name)}"><img data-card-image src="${escapeHtml(row.original)}" alt="Image of ${escapeHtml(row.name)}" loading="lazy"><div class="labels"><span>Image</span><span></span></div></div>`;
  return `<div class="compare" style="--split:50%" data-fallback-name="${escapeHtml(row.name)}"><img data-card-image src="${escapeHtml(row.original)}" alt="Source image of ${escapeHtml(row.name)}" loading="lazy"><img class="after" data-card-image src="${escapeHtml(row.gemini)}" alt="AI image of ${escapeHtml(row.name)}" loading="lazy"><div class="compare-line"></div><input type="range" min="0" max="100" value="50" aria-label="Compare source and AI images of ${escapeHtml(row.name)}"><div class="labels"><span>Source</span><span>AI</span></div></div>`;
}

function entryCard(row, index) {
  const displayPackage = state.packageId === ALL_PACKAGES_ID ? ` · ${row.packageName}` : "";
  const details = row.details || row.tmdbId ? `${row.details || ""}${row.details && row.tmdbId ? " · " : ""}${row.tmdbId ? `TMDB ${row.tmdbId}` : ""}` : row.key;
  const remove = row.manual ? `<div class="entry-actions"><button class="remove-entry" type="button" data-remove-addition="${escapeHtml(row.id)}">Remove draft</button></div>` : "";
  return `<article class="card ${row.draft ? "draft" : ""}">${row.draft ? '<span class="badge">Draft</span>' : ""}${imageMarkup(row)}<div class="card-info"><b title="${escapeHtml(row.name)}">${index + 1}. ${escapeHtml(row.name)}</b><span title="${escapeHtml(details)}">${escapeHtml(details || "Existing entry")}${escapeHtml(displayPackage)}</span><small>${row.gemini ? "Source + AI image" : row.original ? "One image available" : "No image"}</small>${remove}</div></article>`;
}

function bindCards() {
  $$(".compare input").forEach(input => input.oninput = () => input.closest(".compare").style.setProperty("--split", `${input.value}%`));
  $$("img[data-card-image]").forEach(image => image.addEventListener("error", () => {
    const compare = image.closest(".compare");
    if (!compare || compare.dataset.failed) return;
    compare.dataset.failed = "true";
    compare.innerHTML = placeholder(compare.dataset.fallbackName || "?");
  }, { once: true }));
  $$('[data-remove-addition]').forEach(button => button.onclick = () => {
    const addition = state.drafts.additions.find(item => item.id === button.dataset.removeAddition);
    if (!addition || !confirm(`Remove ${addition.name} from this draft?`)) return;
    state.drafts.additions = state.drafts.additions.filter(item => item.id !== addition.id);
    saveDrafts();
    render();
    toast("Draft removed");
  });
}

function renderContent() {
  const current = state.packageId === ALL_PACKAGES_ID ? null : getPackage();
  const rows = visibleRows();
  const shown = rows.slice(0, state.limit);
  const packageName = current?.name || (state.tab === "all" ? "All packages" : labelForTab(state.tab));
  $("#packageTitle").textContent = packageName;
  $("#packageTag").textContent = current ? `${labelForTab(current.tab)}${current.custom ? " · local package" : " · app data"}` : state.tab === "all" ? "All Quiz: Celebs Game packages, excluding the Israel-only collection" : `All ${labelForTab(state.tab)} packages`;
  $("#resultCount").textContent = `${rows.length.toLocaleString("en-US")} entries`;
  const generatedAt = cleanText(state.data?.generatedAt);
  $("#sourceStatus").textContent = generatedAt ? `Data updated: ${new Intl.DateTimeFormat("en-US").format(new Date(generatedAt))}` : "Drafts are stored in this browser";
  $("#deleteDraftPackage").hidden = !current?.custom;
  $("#entries").innerHTML = shown.length ? shown.map(entryCard).join("") : `<div class="empty"><div><b>No entries found in this view</b><br><span>Try another search, filter, or package.</span></div></div>`;
  $("#moreWrap").hidden = rows.length <= shown.length;
  $("#loadMore").textContent = `Show ${Math.min(PAGE_SIZE, rows.length - shown.length).toLocaleString("en-US")} more entries`;
  bindCards();
}

function render() {
  if (!state.data) return;
  updateStats();
  renderTabs();
  renderPackages();
  $("#aiOnly").classList.toggle("active", state.aiOnly);
  renderContent();
}

function slugify(value) {
  const latin = String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return latin || `package-${Date.now()}`;
}

function imageUrl(folder, file) {
  const filename = cleanText(file);
  if (!filename) return "";
  if (/^https?:\/\//i.test(filename)) return filename;
  const directory = cleanText(folder).replace(/^\/+|\/+$/g, "");
  if (!directory) return "";
  return RAW_ROOT + `${directory}/${filename}`.split("/").map(encodeURIComponent).join("/");
}

function valueName(value, fallback) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const field of ["name", "title", "celebrity", "anime", "movie", "show", "game", "company", "character", "country"]) {
      const candidate = value[field];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      if (candidate && typeof candidate === "object" && cleanText(candidate.name)) return cleanText(candidate.name);
    }
    if (value.celebrity?.name && value.parent?.name) return `${value.celebrity.name} ↔ ${value.parent.name}`;
  }
  return fallback;
}

function valueDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  if (Array.isArray(value.facts) && cleanText(value.facts[0])) return cleanText(value.facts[0]);
  for (const field of ["description", "known_for", "media_type", "emojis"]) if (cleanText(value[field])) return cleanText(value[field]);
  return "";
}

function dataEntries(data) {
  if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.pairs)) return data.pairs.map((value, index) => [`pair-${index + 1}`, value]);
  if (Array.isArray(data)) return data.map((value, index) => [typeof value === "string" ? value : String(index + 1), value]);
  if (data && typeof data === "object") return Object.entries(data).filter(([key]) => !["meta", "metadata"].includes(key));
  return [];
}

function parsePackageData(data, options) {
  const originalFolder = cleanText(options.originalFolder);
  const geminiFolder = cleanText(options.geminiFolder);
  return dataEntries(data).map(([key, value], index) => {
    let originalFile = "", geminiFile = "", tmdbId = "";
    if (Array.isArray(value)) {
      tmdbId = value[0] !== undefined && !["", 0, -1, "0", "-1"].includes(value[0]) ? String(value[0]) : "";
      originalFile = typeof value[2] === "string" ? value[2] : "";
      geminiFile = typeof value[3] === "string" ? value[3] : "";
    } else if (value && typeof value === "object") {
      tmdbId = cleanText(value.tmdb_id) || cleanText(value.tmdbId);
      originalFile = cleanText(value.original) || cleanText(value.originalImage) || cleanText(value.image) || cleanText(value.imageUrl) || cleanText(value.poster);
      geminiFile = cleanText(value.gemini) || cleanText(value.generated) || cleanText(value.toon) || cleanText(value.aiImage);
    }
    const name = valueName(value, String(key));
    const original = imageUrl(originalFolder, originalFile || key);
    const gemini = imageUrl(geminiFolder, geminiFile || key);
    return personRow({ id: `import-${Date.now()}-${index}`, key: String(key), name, original: original || gemini, gemini: original ? gemini : "", tmdbId, details: valueDetails(value) });
  }).filter(row => row.name);
}

function showFileStatus(message, error = false) {
  const element = $("#packageFileStatus");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.hidden = !message;
}

async function readPackageFile(file) {
  if (!file) { state.packageFileData = null; showFileStatus(""); return; }
  try {
    const parsed = JSON.parse(await file.text());
    const count = dataEntries(parsed).length;
    if (!count) throw new Error("No entries were found in the file");
    state.packageFileData = parsed;
    showFileStatus(`“${file.name}” was read successfully · ${count.toLocaleString("en-US")} entries found.`);
  } catch (error) {
    state.packageFileData = null;
    showFileStatus(error instanceof Error ? `Could not read the file: ${error.message}` : "Could not read the file", true);
  }
}

function openPackageDialog() {
  state.packageFileData = null;
  $("#packageForm").reset();
  showFileStatus("");
  $("#packageDialog").showModal();
}

function openEntryDialog() {
  const collection = packages();
  const select = $("#entryPackage");
  select.innerHTML = collection.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  const current = getPackage();
  if (current) select.value = current.id;
  $("#entryForm").reset();
  if (current) select.value = current.id;
  $("#entryDialog").showModal();
}

function deleteCurrentDraftPackage() {
  const current = getPackage();
  if (!current?.custom || !confirm(`Delete the local package “${current.name}” and its manual entries?`)) return;
  state.drafts.packages = state.drafts.packages.filter(item => item.id !== current.id);
  state.drafts.additions = state.drafts.additions.filter(item => item.packageId !== current.id);
  state.packageId = ALL_PACKAGES_ID;
  saveDrafts();
  render();
  toast("Local package deleted");
}

function downloadJson(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

function exportDrafts() {
  downloadJson({ format: "celebs-packages-studio-draft", exportedAt: new Date().toISOString(), ...state.drafts }, `packages-studio-draft-${new Date().toISOString().slice(0, 10)}.json`);
  toast("Draft file downloaded");
}

async function importDraftFile(file) {
  if (!file) return;
  try {
    const imported = normalizeDrafts(JSON.parse(await file.text()));
    const known = new Set(packages().map(item => item.id));
    let packagesAdded = 0, entriesAdded = 0;
    imported.packages.forEach(item => {
      if (item.id && !known.has(item.id)) { state.drafts.packages.push(item); known.add(item.id); packagesAdded++; }
    });
    const existingAdditions = new Set(state.drafts.additions.map(item => `${item.packageId}:${item.name.toLocaleLowerCase("en")}`));
    imported.additions.forEach(item => {
      const fingerprint = `${item.packageId}:${item.name.toLocaleLowerCase("en")}`;
      if (item.packageId && known.has(item.packageId) && item.name && !existingAdditions.has(fingerprint)) {
        state.drafts.additions.push(item); existingAdditions.add(fingerprint); entriesAdded++;
      }
    });
    saveDrafts();
    render();
    toast(`${packagesAdded} packages and ${entriesAdded} entries imported`);
  } catch (error) {
    toast(error instanceof Error ? `Import failed: ${error.message}` : "Import failed");
  }
}

function bindEvents() {
  let searchTimer;
  $("#search").oninput = event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = event.target.value.trim(); state.limit = PAGE_SIZE; render(); }, 140);
  };
  $("#aiOnly").onclick = () => { state.aiOnly = !state.aiOnly; state.limit = PAGE_SIZE; render(); };
  $("#loadMore").onclick = () => { state.limit += PAGE_SIZE; renderContent(); };
  $("#openAddPackage").onclick = openPackageDialog;
  $("#addEntry").onclick = openEntryDialog;
  $("#deleteDraftPackage").onclick = deleteCurrentDraftPackage;
  $("#exportButton").onclick = exportDrafts;
  $("#importButton").onclick = () => $("#importFile").click();
  $("#importFile").onchange = async event => { const file = event.target.files?.[0]; event.target.value = ""; await importDraftFile(file); };
  $("#newPackageFile").onchange = event => readPackageFile(event.target.files?.[0]);
  $$("[data-close]").forEach(button => button.onclick = () => document.getElementById(button.dataset.close).close());

  $("#packageForm").onsubmit = event => {
    event.preventDefault();
    if (!state.packageFileData) { showFileStatus("Choose a valid data.json file before saving.", true); return; }
    const name = cleanText($("#newPackageName").value);
    let id = (cleanText($("#newPackageId").value) || slugify(name)).replace(/\s+/g, "_").toLocaleLowerCase("en");
    if (id === ALL_PACKAGES_ID || !/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
      showFileStatus("Package ID must use lowercase letters, numbers, hyphens, or underscores (and cannot be __all__).", true);
      return;
    }
    if (getPackage(id)) { showFileStatus("A package with this ID already exists. Choose another ID.", true); return; }
    const people = parsePackageData(state.packageFileData, { originalFolder: $("#newOriginalFolder").value, geminiFolder: $("#newGeminiFolder").value });
    if (!people.length) { showFileStatus("We could not create entries from the selected file.", true); return; }
    state.drafts.packages.push(packageRow({ id, name, tab: $("#newPackageTab").value, people, sortOrder: 9999 + state.drafts.packages.length }));
    state.packageId = id;
    state.tab = $("#newPackageTab").value;
    state.limit = PAGE_SIZE;
    saveDrafts();
    $("#packageDialog").close();
    render();
    toast(`“${name}” was added as a draft with ${people.length.toLocaleString("en-US")} entries`);
  };

  $("#entryForm").onsubmit = event => {
    event.preventDefault();
    const name = cleanText($("#entryName").value);
    const packageId = cleanText($("#entryPackage").value);
    if (!name || !getPackage(packageId)) { toast("Choose a package and enter a name"); return; }
    state.drafts.additions.push(additionRow({
      id: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      packageId,
      key: name.toLocaleLowerCase("en"),
      name,
      original: cleanText($("#entryOriginal").value),
      gemini: cleanText($("#entryGemini").value),
      tmdbId: cleanText($("#entryTmdb").value),
      createdAt: new Date().toISOString(),
    }));
    state.packageId = packageId;
    state.limit = PAGE_SIZE;
    saveDrafts();
    $("#entryDialog").close();
    render();
    toast("Entry saved as draft");
  };
}

async function load() {
  loadDrafts();
  try {
    const response = await fetch("data.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    if (!Array.isArray(state.data.packages)) throw new Error("The data file has an invalid structure");
    render();
  } catch (error) {
    $("#entries").innerHTML = `<div class="empty"><div><b>We could not load the packages</b><br><span>${escapeHtml(error instanceof Error ? error.message : "Unknown error")}</span></div></div>`;
    toast("Could not load data.json");
  }
}

bindEvents();
load();
