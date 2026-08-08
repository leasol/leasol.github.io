const STORAGE_KEY = "israelPackageStudioDraftsV1";
const ALL_PACKAGES_ID = "__all__";
const state = { data: null, packageId: null, filter: "all", query: "", selectedWiki: null, generatedImage: null, activeImageRequest: null, backgroundJobsStarted: false, lastGeminiError: "", cardAction: null, highlightCardId: null, drafts: { packages: [], additions: [], removals: [], imageOverrides: {}, geminiOverrides: {}, tmdbOverrides: {}, removedGemini: [], imageJobs: [] } };
let basePersonAliases = new Map();
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2600) }
function saveDrafts() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.drafts)) }
function normalizeDrafts() {
  state.drafts.packages ||= []; state.drafts.additions ||= [];
  state.drafts.removals ||= []; state.drafts.imageOverrides ||= {}; state.drafts.geminiOverrides ||= {}; state.drafts.tmdbOverrides ||= {}; state.drafts.removedGemini ||= []; state.drafts.imageJobs ||= [];
  if (!state.backgroundJobsStarted) state.drafts.imageJobs.forEach(job => { if (job.status === "running") job.status = "queued"; });
}
function cardId(x) { return x.new ? `addition:${x.id}` : `base:${x.packageId}:${x.key}` }
function isRemoved(x) { return state.drafts.removals.includes(cardId(x)) }
function rawBasePersonId(person) {
  const key = String(person.key || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  return key ? `base:${key}` : `base-name:${normalizeName(person.name)}`;
}
function buildBasePersonAliases() {
  const byName = new Map();
  state.data?.packages.forEach(pkg => pkg.people.forEach(person => {
    const name = normalizeName(person.name);
    if (!name) return;
    const identities = byName.get(name) || new Map();
    const personId = rawBasePersonId(person);
    if (!identities.has(personId)) identities.set(personId, new Set());
    identities.get(personId).add(pkg.id);
    byName.set(name, identities);
  }));
  basePersonAliases = new Map();
  byName.forEach(identities => {
    const sharedIdentity = [...identities.entries()].filter(([, packageIds]) => packageIds.size > 1).map(([personId]) => personId);
    const canonicalId = sharedIdentity.length === 1 ? sharedIdentity[0] : null;
    identities.forEach((_, personId) => basePersonAliases.set(personId, canonicalId || personId));
  });
}
function canonicalPersonId(personId) { return basePersonAliases.get(personId) || personId; }
function basePersonId(person) { return canonicalPersonId(rawBasePersonId(person)); }
function legacyAdditionPersonId(person) {
  const name = normalizeName(person.name);
  const baseMatches = new Set();
  state.data?.packages.forEach(pkg => pkg.people.forEach(basePerson => {
    if (name && normalizeName(basePerson.name) === name) baseMatches.add(basePersonId(basePerson));
  }));
  if (baseMatches.size === 1) return [...baseMatches][0];
  const legacyBatch = person.createdAt
    ? `${person.createdAt}|${name}|${person.originalImageUrl || person.imageUrl || ""}`
    : person.id;
  return `legacy:${legacyBatch}`;
}
function personIdFor(person) {
  return person.personId ? canonicalPersonId(person.personId) : person.new ? legacyAdditionPersonId(person) : basePersonId(person);
}
function baseRowsForPerson(personId, packageId, includeRemoved = false) {
  const pkg = state.data?.packages.find(item => item.id === packageId);
  if (!pkg) return [];
  return pkg.people.map(person => ({ ...person, packageId: pkg.id, packageName: pkg.name, new: false, personId: basePersonId(person) }))
    .filter(person => person.personId === personId && (includeRemoved || !isRemoved(person)));
}
function additionRowsForPerson(personId, packageId, includeRemoved = false) {
  return state.drafts.additions
    .filter(person => person.packageId === packageId)
    .map(person => ({ ...person, new: true, personId: personIdFor({ ...person, new: true }) }))
    .filter(person => person.personId === personId && (includeRemoved || !isRemoved(person)));
}
function activeRowsForPerson(personId, packageId) {
  return [...baseRowsForPerson(personId, packageId), ...additionRowsForPerson(personId, packageId)];
}
function membershipIndex() {
  const index = new Map();
  const add = (person, pkg) => {
    const personId = personIdFor(person);
    if (!index.has(personId)) index.set(personId, new Map());
    const packages = index.get(personId);
    if (!packages.has(pkg.id)) packages.set(pkg.id, { id: pkg.id, name: pkg.name, rows: [] });
    packages.get(pkg.id).rows.push(person);
  };
  state.data.packages.forEach(pkg => pkg.people.forEach(person => {
    const row = { ...person, packageId: pkg.id, packageName: pkg.name, new: false, personId: basePersonId(person) };
    if (!isRemoved(row)) add(row, pkg);
  }));
  state.drafts.additions.forEach(person => {
    const pkg = state.data.packages.find(item => item.id === person.packageId);
    const row = { ...person, new: true, personId: personIdFor({ ...person, new: true }) };
    if (pkg && !isRemoved(row)) add(row, pkg);
  });
  return index;
}
function membershipPackages(person, index = membershipIndex()) {
  const packages = index.get(personIdFor(person));
  return packages ? state.data.packages.filter(pkg => packages.has(pkg.id)).map(pkg => packages.get(pkg.id)) : [];
}
function removeAdditionImageJobTargets(ids) {
  if (!ids.size) return;
  state.drafts.imageJobs.forEach(job => {
    if (Array.isArray(job.targets)) job.targets = job.targets.filter(target => target.type !== "addition" || !ids.has(target.id));
  });
  state.drafts.imageJobs = state.drafts.imageJobs.filter(job => !Array.isArray(job.targets) || job.targets.length);
}
function copyImageJobTargets(source, addition) {
  const sourceTarget = source.new ? { type: "addition", id: source.id } : { type: "base", id: cardId(source) };
  let attached = false;
  state.drafts.imageJobs.forEach(job => {
    if (!["queued", "running"].includes(job.status)) return;
    if (!(job.targets || []).some(target => target.type === sourceTarget.type && target.id === sourceTarget.id)) return;
    if (!(job.targets || []).some(target => target.type === "addition" && target.id === addition.id)) job.targets.push({ type: "addition", id: addition.id });
    attached = true;
  });
  if (attached) addition.imageJobId = "pending";
}
function ensureMembership(person, packageId) {
  const personId = personIdFor(person);
  if (activeRowsForPerson(personId, packageId).length) return false;
  const baseRows = baseRowsForPerson(personId, packageId, true);
  if (baseRows.length) {
    const restored = new Set(baseRows.map(cardId));
    state.drafts.removals = state.drafts.removals.filter(id => !restored.has(id));
    return true;
  }
  const additionRows = additionRowsForPerson(personId, packageId, true);
  if (additionRows.length) {
    const restored = new Set(additionRows.map(cardId));
    state.drafts.removals = state.drafts.removals.filter(id => !restored.has(id));
    return true;
  }
  const addition = additionFromCard(person, packageId);
  state.drafts.additions.push(addition);
  copyImageJobTargets(person, addition);
  return true;
}
function removeMembership(person, packageId) {
  const personId = personIdFor(person);
  const baseRows = baseRowsForPerson(personId, packageId);
  if (baseRows.length) state.drafts.removals = [...new Set([...state.drafts.removals, ...baseRows.map(cardId)])];
  const additions = additionRowsForPerson(personId, packageId, true);
  if (additions.length) {
    const ids = new Set(additions.map(item => item.id));
    state.drafts.additions = state.drafts.additions.filter(item => !ids.has(item.id));
    removeAdditionImageJobTargets(ids);
  }
  return baseRows.length + additions.length;
}
function removePhysicalCard(person) {
  if (!person.new) {
    state.drafts.removals = [...new Set([...state.drafts.removals, cardId(person)])];
    return;
  }
  state.drafts.additions = state.drafts.additions.filter(item => item.id !== person.id);
  removeAdditionImageJobTargets(new Set([person.id]));
}
function reconcileMemberships(person, selectedPackageIds) {
  const selected = new Set(selectedPackageIds);
  const current = new Set(membershipPackages(person).map(pkg => pkg.id));
  let added = 0, removed = 0;
  selected.forEach(packageId => { if (!current.has(packageId) && ensureMembership(person, packageId)) added++; });
  current.forEach(packageId => { if (!selected.has(packageId)) removed += Boolean(removeMembership(person, packageId)); });
  return { added, removed };
}
function moveToPackages(person, selectedPackageIds) {
  const destinations = [...new Set(selectedPackageIds)].filter(packageId => packageId !== person.packageId);
  if (!destinations.length) return { added: 0, destinations: 0 };
  let added = 0;
  destinations.forEach(packageId => { if (ensureMembership(person, packageId)) added++; });
  removePhysicalCard(person);
  return { added, destinations: destinations.length };
}
function packageDisplayCount(pkg) {
  const existingCount = pkg.people.filter(person => !isRemoved({ ...person, packageId: pkg.id, new: false })).length;
  const additionsCount = state.data.additions.filter(person => person.packageId === pkg.id && !isRemoved({ ...person, new: true })).length;
  return existingCount + additionsCount;
}
function packageOptions(selected = [], name = "targetPackages") {
  return state.data.packages.map(p => `<label><input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(p.id)}" ${selected.includes(p.id) ? "checked" : ""}><span>${escapeHtml(p.name)}</span></label>`).join("");
}
async function load() {
  const response = await fetch("data.json"); if (!response.ok) throw new Error("קובץ הנתונים אינו זמין");
  const base = await response.json();
  try { state.drafts = JSON.parse(localStorage.getItem(STORAGE_KEY)) || state.drafts } catch { }
  normalizeDrafts();
  state.data = { packages: [...base.packages, ...state.drafts.packages.map(p => ({ ...p, people: [], count: 0, custom: true }))], additions: state.drafts.additions };
  buildBasePersonAliases();
  state.packageId = state.packageId || ALL_PACKAGES_ID;
  $("#packageCount").textContent = state.data.packages.length;
  $("#peopleCount").textContent = base.packages.reduce((n, p) => n + p.count, 0).toLocaleString("he-IL");
  $("#newCount").textContent = state.data.additions.length;
  $("#targetPackages .package-options").innerHTML = packageOptions(state.packageId === ALL_PACKAGES_ID ? [] : [state.packageId]);
  render();
  if (!state.backgroundJobsStarted) { state.backgroundJobsStarted = true; resumeBackgroundImageJobs(); }
}
function current() { return state.packageId === ALL_PACKAGES_ID ? { id: ALL_PACKAGES_ID, name: "כל החבילות", custom: false } : state.data.packages.find(p => p.id === state.packageId) }
function render() {
  const p = current(); if (!p) return;
  const allCount = state.data.packages.reduce((count, pkg) => count + packageDisplayCount(pkg), 0);
  $("#packages").innerHTML = `<button class="all-packages ${p.id === ALL_PACKAGES_ID ? "active" : ""}" data-id="${ALL_PACKAGES_ID}"><span>כל החבילות</span><small>${allCount}</small></button>` + state.data.packages.map(x => `<button class="${x.id === p.id ? "active" : ""}" data-id="${x.id}"><span>${escapeHtml(x.name)}${x.custom ? " · טיוטה" : ""}</span><small>${packageDisplayCount(x)}</small></button>`).join("");
  $("#packageTitle").textContent = p.name; $("#packageTag").textContent = p.id === ALL_PACKAGES_ID ? "חיפוש ותצוגה בכל החבילות" : p.custom ? "חבילה חדשה · טיוטה" : "מתוך ה־manifest";
  const visiblePackages = p.id === ALL_PACKAGES_ID ? state.data.packages : [p];
  const existing = visiblePackages.flatMap(pkg => pkg.people.map(x => ({ ...x, packageId: pkg.id, packageName: pkg.name, new: false, personId: basePersonId(x), hasGemini: Boolean(x.gemini) })));
  const visiblePackageIds = new Set(visiblePackages.map(pkg => pkg.id));
  const added = state.data.additions.filter(a => visiblePackageIds.has(a.packageId)).map(a => ({
    key: a.id,
    id: a.id,
    packageId: a.packageId,
    packageName: state.data.packages.find(pkg => pkg.id === a.packageId)?.name || "",
    name: a.name,
    original: a.originalImageUrl || a.imageUrl,
    gemini: a.originalImageUrl && a.imageUrl !== a.originalImageUrl ? a.imageUrl : null,
    hasGemini: Boolean(a.originalImageUrl && a.imageUrl !== a.originalImageUrl),
    new: true,
    wikipediaUrl: a.wikipediaUrl,
    tmdbId: a.tmdbId || "", imageJobId: a.imageJobId || "", personId: personIdFor({ ...a, new: true })
  }));
  let rows = state.filter === "existing" ? existing : state.filter === "new" ? added : [...added, ...existing];
  rows = rows.filter(x => !isRemoved(x)).map(x => {
    const geminiRemoved = state.drafts.removedGemini.includes(cardId(x));
    const gemini = state.drafts.geminiOverrides[cardId(x)] || (geminiRemoved ? null : x.gemini);
    return { ...x, original: state.drafts.imageOverrides[cardId(x)] || x.original, gemini, tmdbId: state.drafts.tmdbOverrides[cardId(x)] || x.tmdbId || "", hasGemini: Boolean(gemini) };
  });
  if (state.filter === "missingGemini") rows = rows.filter(x => !x.hasGemini);
  if (state.query) rows = rows.filter(x => (x.name + " " + x.key).toLowerCase().includes(state.query.toLowerCase()));
  $("#resultCount").textContent = `${rows.length} אנשים`;
  const memberships = membershipIndex();
  $("#people").innerHTML = rows.length ? rows.map((person, index) => card(person, index + 1, memberships)).join("") : `<div class="empty"><b>לא נמצאו אנשים</b><br>אפשר לשנות את החיפוש או להוסיף אדם חדש לחבילה.</div>`;
  $$("nav button").forEach(b => b.onclick = () => { state.packageId = b.dataset.id; render() });
  $$(".compare input").forEach(input => input.oninput = () => input.parentElement.style.setProperty("--split", input.value + "%"));
  $$(".card-action").forEach(button => button.onclick = () => {
    const person = rows[+button.dataset.index];
    if (button.dataset.action === "tmdb") return openTmdbProfile(person);
    if (button.dataset.action === "generate-ai") return generateCardAiImage(person);
    openCardAction(button.dataset.action, person);
  });
  if (state.highlightCardId) {
    const target = $$(".card").find(card => card.dataset.cardId === state.highlightCardId);
    if (target) requestAnimationFrame(() => { target.classList.add("person-highlight"); target.scrollIntoView({ behavior: "smooth", block: "center" }); state.highlightCardId = null; });
  }
}
function card(x, number, memberships) {
  const originalLabel = x.new ? "Wikipedia" : "מקור";
  const image = !x.hasGemini
    ? `<div class="compare"><img src="${x.original}" alt="התמונה שנבחרה עבור ${escapeHtml(x.name)}" loading="lazy"></div>`
    : `<div class="compare" style="--split:50%"><img src="${x.original}" alt="תמונת המקור של ${escapeHtml(x.name)}" loading="lazy"><img class="after" src="${x.gemini}" alt="תמונת עיבוד AI של ${escapeHtml(x.name)}" loading="lazy"><div class="compare-line"></div><input type="range" min="0" max="100" value="50" aria-label="השוואת לפני ואחרי"><div class="labels"><span>${originalLabel}</span><span>עיבוד AI</span></div></div>`;
  const generatingAi = isCardAiGenerationPending(x);
  const generateAiAction = x.hasGemini ? "" : `<button class="card-action generate-ai" type="button" data-action="generate-ai" data-index="${number - 1}" ${generatingAi ? "disabled" : ""}>${generatingAi ? "יוצר גרסת AI…" : "יצירת גרסת AI"}</button>`;
  const actions = `<div class="card-actions" aria-label="פעולות עבור ${escapeHtml(x.name)}">
    ${generateAiAction}
    <button class="card-action" type="button" data-action="replace" data-index="${number - 1}">החלפת תמונה</button>
    <button class="card-action" type="button" data-action="move" data-index="${number - 1}">העברה לחבילות</button>
    <button class="card-action" type="button" data-action="copy" data-index="${number - 1}">עריכת חבילות</button>
    <button class="card-action remove-person" type="button" data-action="remove" data-index="${number - 1}">הסרת אדם</button>
    <button class="card-action tmdb-profile" type="button" data-action="tmdb" data-index="${number - 1}">צפייה בפרופיל TMDB</button>
  </div>`;
  const packageDetail = state.packageId === ALL_PACKAGES_ID && x.packageName ? ` · ${escapeHtml(x.packageName)}` : "";
  const pending = x.imageJobId || generatingAi ? " · עיבוד AI ברקע" : "";
  const details = x.new ? `נשמר בטיוטת הדפדפן${pending}${packageDetail}${x.tmdbId ? ` · TMDB ${escapeHtml(x.tmdbId)}` : ""}` : `${escapeHtml(x.key)}${packageDetail}`;
  const packages = membershipPackages(x, memberships).map(pkg => escapeHtml(pkg.name)).join(" · ");
  return `<article class="card ${x.new ? "new" : ""}" data-card-id="${escapeHtml(cardId(x))}"><span class="badge">${x.new ? x.imageJobId ? "AI ברקע" : "חדש · טיוטה" : "קיים"}</span>${image}
    <div class="card-info"><b>${number}. ${escapeHtml(x.name)}</b><small class="card-packages">חבילות: ${packages || "—"}</small><span>${details}</span>${actions}</div></article>`
}
function isCardAiGenerationPending(person) {
  const id = person.new ? person.id : cardId(person);
  const type = person.new ? "addition" : "base";
  return state.drafts.imageJobs.some(job => ["queued", "running"].includes(job.status) && (job.targets || []).some(target => target.type === type && target.id === id));
}
function generateCardAiImage(person) {
  if (isCardAiGenerationPending(person)) return;
  const sourceImage = person.original;
  if (!sourceImage) { toast("אין תמונת מקור ליצירת גרסת AI"); return; }
  const request = {
    name: person.name,
    imageUrl: sourceImage,
    fallbackImageUrl: sourceImage,
    promise: generateGemini(sourceImage, person.name, sourceImage)
  };
  const targets = person.new ? [{ type: "addition", id: person.id }] : [{ type: "base", id: cardId(person) }];
  if (person.new) {
    const addition = state.drafts.additions.find(item => item.id === person.id);
    if (addition) addition.imageJobId = "pending";
  }
  queueBackgroundImageJob(request, targets);
  render();
  toast(`יוצר גרסת OpenAI עבור ${person.name}…`);
}
async function findTmdbCandidates(name, alternateName = "") {
  const queries = [...new Set([name, alternateName].map(value => String(value || "").trim()).filter(Boolean))];
  for (const query of queries) {
    for (const language of ["he", "en"]) {
      const searchParams = new URLSearchParams({ action: "wbsearchentities", search: query, language, uselang: language, type: "item", limit: "10", format: "json", origin: "*" });
      const response = await fetch("https://www.wikidata.org/w/api.php?" + searchParams);
      if (!response.ok) throw new Error("חיפוש Wikidata נכשל");
      const ids = ((await response.json()).search || []).map(item => item.id).slice(0, 10);
      if (!ids.length) continue;
      const entityParams = new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props: "claims|labels|descriptions", languages: "he|en", format: "json", origin: "*" });
      const entityResponse = await fetch("https://www.wikidata.org/w/api.php?" + entityParams);
      if (!entityResponse.ok) throw new Error("קריאת Wikidata נכשלה");
      const entities = (await entityResponse.json()).entities || {};
      const candidates = ids.flatMap(id => {
        const entity = entities[id], tmdb = entity?.claims?.P4985?.[0]?.mainsnak?.datavalue?.value;
        if (!tmdb) return [];
        return [{ id: String(tmdb), label: entity.labels?.he?.value || entity.labels?.en?.value || id, description: entity.descriptions?.he?.value || entity.descriptions?.en?.value || "", qid: id }];
      });
      if (candidates.length) return candidates;
    }
  }
  return [];
}
async function lookupTmdbPerson(name) {
  const panel = $("#tmdbLookup"), status = $("#tmdbLookupStatus"), message = $("#tmdbLookupMessage");
  panel.hidden = false; panel.classList.remove("found", "not-found"); status.hidden = false;
  status.querySelector("span").textContent = `מחפש TMDB ID עבור ${name}…`;
  $("#tmdbCandidatesField").hidden = true; $("#tmdbCandidates").innerHTML = ""; $("#tmdbId").value = "";
  message.textContent = "בודק זיהויי אנשים ב־Wikidata";
  try {
    const candidates = await findTmdbCandidates(name);
    if (!candidates.length) throw new Error("לא נמצא TMDB ID");
    $("#tmdbCandidates").innerHTML = candidates.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}${item.description ? ` — ${escapeHtml(item.description)}` : ""} · ${escapeHtml(item.id)}</option>`).join("");
    $("#tmdbCandidatesField").hidden = candidates.length < 2; $("#tmdbId").value = candidates[0].id;
    $("#tmdbCandidates").onchange = event => { $("#tmdbId").value = event.target.value; };
    status.hidden = true; panel.classList.add("found"); message.textContent = `נמצא TMDB Person ID: ${candidates[0].id}`;
  } catch (error) {
    status.hidden = true; panel.classList.add("not-found"); message.textContent = `${error.message}. אפשר להמשיך בלי TMDB ID או להזין אותו ידנית.`;
  }
}
async function openTmdbProfile(person) {
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  const openProfile = id => {
    const url = `https://www.themoviedb.org/person/${encodeURIComponent(id)}`;
    if (tab) tab.location.replace(url); else window.open(url, "_blank", "noopener");
  };
  if (person.tmdbId) { openProfile(person.tmdbId); return; }
  toast(`מחפש פרופיל TMDB עבור ${person.name}…`);
  try {
    const candidates = await findTmdbCandidates(person.name, person.new ? "" : person.key);
    if (!candidates.length) throw new Error("לא נמצא פרופיל TMDB מתאים");
    const tmdbId = candidates[0].id;
    if (person.new) {
      const addition = state.drafts.additions.find(item => item.id === person.id);
      if (addition) addition.tmdbId = tmdbId;
    } else state.drafts.tmdbOverrides[cardId(person)] = tmdbId;
    saveDrafts(); person.tmdbId = tmdbId; render(); openProfile(tmdbId);
    toast(`נמצא ונשמר TMDB ID: ${tmdbId}`);
  } catch (error) {
    if (tab) tab.close();
    toast(error.message || "לא ניתן לפתוח את פרופיל TMDB");
  }
}
async function wikipedia(name) {
  const params = new URLSearchParams({ action: "query", generator: "search", gsrsearch: name, gsrnamespace: "0", gsrlimit: "5", prop: "pageimages|extracts|info", inprop: "url", piprop: "thumbnail|original", pithumbsize: "900", exintro: "1", explaintext: "1", format: "json", origin: "*" });
  const response = await fetch("https://he.wikipedia.org/w/api.php?" + params);
  if (!response.ok) throw new Error("החיפוש בוויקיפדיה אינו זמין כרגע");
  const raw = await response.json();
  return Object.values(raw.query?.pages || {}).sort((a, b) => (a.index || 999) - (b.index || 999)).map(p => ({ title: p.title, description: (p.extract || "").slice(0, 240), pageUrl: p.fullurl, imageUrl: (p.original || p.thumbnail || {}).source })).filter(x => x.imageUrl);
}
async function webImages(name) {
  const local = location.protocol === "http:" && ["localhost", "127.0.0.1"].includes(location.hostname);
  const endpoint = local
    ? "/api/web-search"
    : "https://israel-packages-image-search.adar-bokobza.chatgpt.site/api/web-search";
  const response = await fetch(endpoint + "?name=" + encodeURIComponent(name));
  const raw = await response.text(); let data = {}; try { data = JSON.parse(raw) } catch { }
  if (!response.ok) throw new Error(data.error || `חיפוש האינטרנט נכשל (${response.status})`);
  return data.results || [];
}
async function generateOpenAIInBrowser(imageUrl, key, name = $("#personName").value.trim(), fallbackImageUrl = state.selectedWiki?.thumbnailUrl || "") {
  const endpoint = "https://israel-packages-image-search.adar-bokobza.chatgpt.site/api/openai-image";
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-OpenAI-Key": key }, body: JSON.stringify({ name, imageUrl, fallbackImageUrl }) });
  const raw = await response.text(); let data = {}; try { data = JSON.parse(raw) } catch { }
  if (!response.ok) { const error = new Error((typeof data.error === "string" ? data.error : data.error?.message) || `OpenAI דחה את הבקשה (${response.status})`); error.details = data.details || `HTTP ${response.status} ${response.statusText}\n\n${raw}`; throw error }
  if (!data.imageUrl) throw new Error("OpenAI לא החזיר תמונה");
  return data.imageUrl;
}
async function generateGemini(imageUrl, name = $("#personName").value.trim(), fallbackImageUrl = state.selectedWiki?.thumbnailUrl || "") {
  const browserKey = window.ISRAEL_PACKAGES_CONFIG?.openaiApiKey?.trim();
  if (browserKey && browserKey !== "YOUR_OPENAI_API_KEY") return generateOpenAIInBrowser(imageUrl, browserKey, name, fallbackImageUrl);
  const endpoint = location.protocol === "http:" && ["localhost", "127.0.0.1"].includes(location.hostname) ? "/api/openai-image" : "https://israel-packages-image-search.adar-bokobza.chatgpt.site/api/openai-image";
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, imageUrl, fallbackImageUrl }) });
  const raw = await response.text(); let data = {}; try { data = JSON.parse(raw) } catch { }
  if (!response.ok) { const error = new Error(data.error || "עיבוד התמונה נכשל"); error.details = data.details || `HTTP ${response.status} ${response.statusText}\n\n${raw}`; throw error }
  return data.imageUrl;
}
function startBackgroundImageJob(job, existingPromise = null) {
  if (!job || job.status === "running") return;
  job.status = "running"; delete job.error; saveDrafts();
  (existingPromise || generateGemini(job.imageUrl, job.name, job.fallbackImageUrl)).then(imageUrl => {
    for (const target of job.targets || []) {
      if (target.type === "addition") {
        const addition = state.drafts.additions.find(item => item.id === target.id);
        if (addition) { addition.imageUrl = imageUrl; delete addition.imageJobId; }
      } else if (target.type === "base") {
        state.drafts.geminiOverrides[target.id] = imageUrl;
        state.drafts.removedGemini = state.drafts.removedGemini.filter(id => id !== target.id);
      }
    }
    state.drafts.imageJobs = state.drafts.imageJobs.filter(item => item.id !== job.id);
    saveDrafts();
    if (state.data) { render(); toast("עיבוד ה־AI נוסף לטיוטה"); }
  }).catch(error => {
    job.status = "failed"; job.error = error?.message || String(error); saveDrafts();
    if (state.data) { render(); toast("עיבוד ה־AI נכשל; הטיוטה נשמרה עם תמונת המקור"); }
  });
}
function queueBackgroundImageJob(request, targets) {
  const job = { id: crypto.randomUUID(), name: request.name, imageUrl: request.imageUrl, fallbackImageUrl: request.fallbackImageUrl || "", targets, status: "queued", createdAt: new Date().toISOString() };
  state.drafts.imageJobs.push(job); saveDrafts(); startBackgroundImageJob(job, request.promise);
  return job.id;
}
function resumeBackgroundImageJobs() {
  state.drafts.imageJobs.filter(job => job.status === "queued").forEach(startBackgroundImageJob);
}
$("#search").oninput = e => { state.query = e.target.value; render() };
$$("dialog .close").forEach(button => button.onclick = () => button.closest("dialog").close());
$("#addDialog").addEventListener("close", () => {
  if (state.cardAction?.action === "replace") state.cardAction = null;
  $("#personName").readOnly = false;
  $("#targetPackages").hidden = false;
});
$$(".tabs button").forEach(b => b.onclick = () => { $$(".tabs button").forEach(x => x.classList.remove("active")); $("#showMissingGemini").classList.remove("active"); b.classList.add("active"); state.filter = b.dataset.filter; render() });
$("#showMissingGemini").onclick = () => { state.filter = state.filter === "missingGemini" ? "all" : "missingGemini"; $$(".tabs button").forEach(x => x.classList.toggle("active", state.filter === "all" && x.dataset.filter === "all")); $("#showMissingGemini").classList.toggle("active", state.filter === "missingGemini"); render() };
function clearGeminiError() {
  state.lastGeminiError = ""; $("#geminiErrorPanel").hidden = true; $("#geminiErrorDetails").textContent = "";
}
function showGeminiError(error) {
  const summary = error?.message || String(error);
  const details = error?.details || error?.stack || summary;
  state.lastGeminiError = `OpenAI image generation error\n${new Date().toISOString()}\n\n${summary}\n\n${details}`;
  $("#geminiMessage").textContent = `יצירת התמונה נכשלה: ${summary}`;
  $("#geminiMessage").className = "gemini-message error"; $("#geminiMessage").hidden = false;
  $("#geminiErrorDetails").textContent = state.lastGeminiError; $("#geminiErrorPanel").hidden = false;
}
$("#copyGeminiError").onclick = async () => {
  if (!state.lastGeminiError) return;
  try { await navigator.clipboard.writeText(state.lastGeminiError) }
  catch { const input = document.createElement("textarea"); input.value = state.lastGeminiError; document.body.append(input); input.select(); document.execCommand("copy"); input.remove() }
  $("#copyGeminiError").textContent = "הועתק ✓"; setTimeout(() => $("#copyGeminiError").textContent = "העתקת השגיאה", 1600);
};
function additionFromCard(x, packageId) {
  return {
    id: crypto.randomUUID(), personId: personIdFor(x), packageId, name: x.name,
    imageUrl: x.gemini || x.imageUrl || x.original, originalImageUrl: x.originalImageUrl || x.original || x.imageUrl,
    wikipediaUrl: x.wikipediaUrl || "", tmdbId: x.tmdbId || "", createdAt: new Date().toISOString()
  };
}
function openCardAction(action, person) {
  if (action === "replace") {
    openReplacementSearch(person);
    return;
  }
  state.cardAction = { action, person };
  const labels = { replace: "החלפת תמונה", move: "העברה לחבילות", copy: "עריכת חבילות", remove: "הסרת אדם" };
  $("#cardActionTitle").textContent = labels[action];
  $("#cardActionEyebrow").textContent = person.name;
  const isPackageAction = ["move", "copy"].includes(action);
  $("#destinationPackages").hidden = !isPackageAction;
  if (isPackageAction) {
    const selected = action === "copy" ? membershipPackages(person).map(pkg => pkg.id) : [];
    $("#destinationPackages .package-options").innerHTML = packageOptions(selected, "actionPackages");
    $("#destinationPackagesTitle").textContent = action === "copy" ? "החבילות של האדם" : "חבילות יעד";
    $("#destinationPackagesHint").textContent = action === "copy"
      ? "סמנו את כל החבילות שבהן האדם צריך להופיע. אפשר להוסיף ולהסיר חבילות בפעולה אחת."
      : "בחרו חבילת יעד אחת או יותר. החבילה הנוכחית תוסר מהכרטיס הזה.";
  }
  const descriptions = {
    move: "אפשר להעביר את הכרטיס לחבילה אחת או ליותר. חברויות קיימות אחרות של האדם אינן משתנות.",
    copy: "נהל את כל החבילות של האדם כאן: סימון מוסיף חבילה וביטול סימון מסיר אותה.",
    remove: "האדם יוסר מחבילה זו בטיוטה. אפשר לשחזר באמצעות מחיקת הטיוטות בדפדפן."
  };
  $("#cardActionDescription").textContent = descriptions[action];
  $("#saveCardAction").textContent = action === "remove" ? "הסרה כטיוטה" : action === "copy" ? "עדכון החבילות" : "העברה כטיוטה";
  $("#cardActionDialog").showModal();
}
function resetImageSearchState() {
  $("#existingPeople").hidden = true; $("#existingPeople").innerHTML = "";
  $("#tmdbLookup").hidden = true; $("#tmdbLookup").classList.remove("found", "not-found"); $("#tmdbId").value = "";
  $("#webSearchRefine").hidden = true; $("#webSearchExtra").value = "";
  $("#wikiResults").innerHTML = ""; $("#wikiStatus").hidden = true;
  $("#geminiGenerate").hidden = true; $("#geminiPreview").hidden = true;
  $("#geminiMessage").hidden = true; $("#geminiMessage").textContent = "";
  $("#savePerson").disabled = true; clearGeminiError();
  state.selectedWiki = null; state.generatedImage = null;
}
function openReplacementSearch(person) {
  state.cardAction = { action: "replace", person };
  resetImageSearchState();
  $("#addDialogEyebrow").textContent = "עריכת אדם";
  $("#addDialogTitle").textContent = "החלפת תמונה";
  $("#addDialogDescription").textContent = "חפשו תמונה חדשה בוויקיפדיה או באינטרנט, ואפשר גם ליצור עיבוד OpenAI חדש.";
  $("#personName").value = person.name; $("#personName").readOnly = true;
  $("#targetPackages").hidden = true;
  $("#savePerson").textContent = "שמירת התמונה החדשה";
  $("#addDialog").showModal();
}
function normalizeName(value) { return String(value).toLocaleLowerCase("he").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " "); }
function findExistingPeople(value) {
  const query = normalizeName(value); if (query.length < 3 || !state.data) return [];
  const matches = [];
  state.data.packages.forEach(pkg => {
    if (pkg.id === state.packageId) return;
    pkg.people.forEach(person => {
      const item = { ...person, packageId: pkg.id, new: false };
      if (!isRemoved(item) && normalizeName(person.name).includes(query)) matches.push(existingPersonMatch(item, pkg.name));
    });
    state.drafts.additions.filter(person => person.packageId === pkg.id).forEach(person => {
      const item = { ...person, new: true };
      if (!isRemoved(item) && normalizeName(person.name).includes(query)) matches.push(existingPersonMatch(item, pkg.name));
    });
  });
  return matches.slice(0, 10);
}
function existingPersonMatch(person, packageName) {
  const id = cardId(person);
  const original = state.drafts.imageOverrides[id] || person.originalImageUrl || person.original || person.imageUrl;
  const geminiRemoved = state.drafts.removedGemini.includes(id);
  const gemini = state.drafts.geminiOverrides[id] || (geminiRemoved ? null : person.gemini);
  return { name: person.name, packageName, original, gemini, new: person.new };
}
function showExistingPeople() {
  const matches = findExistingPeople($("#personName").value);
  const panel = $("#existingPeople");
  panel.hidden = !matches.length;
  if (!matches.length) { panel.innerHTML = ""; return; }
  panel.innerHTML = `<b>האדם כבר קיים בחבילה אחרת:</b><span class="existing-people-hint">הכרטיסים הקיימים מוצגים כאן, כך שאין צורך לצאת מהחלון.</span><div class="existing-person-cards">${matches.map(match => {
    const image = match.gemini || match.original;
    return `<article class="existing-person-card"><img src="${escapeHtml(image)}" alt="תמונה של ${escapeHtml(match.name)}" loading="lazy"><div><strong>${escapeHtml(match.name)}</strong><small>${escapeHtml(match.packageName)}</small><span>${match.new ? "חדש · טיוטה" : "קיים"}</span></div></article>`;
  }).join("")}</div>`;
}
let existingPeopleTimer;
$("#personName").oninput = () => { clearTimeout(existingPeopleTimer); existingPeopleTimer = setTimeout(showExistingPeople, 350); };
$("#personName").onchange = showExistingPeople;
$("#personName").onkeydown = async event => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  await runImageSearch("wikipedia");
};
$("#cardActionForm").onsubmit = async e => {
  e.preventDefault();
  const operation = state.cardAction; if (!operation) return;
  const { action, person } = operation;
  let message;
  if (action === "remove") {
    if (!confirm(`להסיר את ${person.name} מחבילה זו?`)) return;
    removePhysicalCard(person);
    message = "האדם הוסר מהחבילה בטיוטה";
  } else if (action === "move") {
    const selected = $$("#destinationPackages input:checked").map(input => input.value);
    const result = moveToPackages(person, selected);
    if (!result.destinations) { toast("יש לבחור לפחות חבילת יעד אחת אחרת"); return; }
    message = result.destinations > 1 ? `האדם הועבר ל־${result.destinations} חבילות בטיוטה` : "האדם הועבר לחבילה בטיוטה";
  } else {
    const selected = $$("#destinationPackages input:checked").map(input => input.value);
    if (!selected.length && !confirm(`להסיר את ${person.name} מכל החבילות?`)) return;
    const result = reconcileMemberships(person, selected);
    message = result.added || result.removed ? "החבילות עודכנו בטיוטה" : "לא בוצע שינוי בחבילות";
  }
  saveDrafts(); $("#cardActionDialog").close(); state.cardAction = null; await load();
  toast(message);
};
$("#openAdd").onclick = () => {
  state.cardAction = null; resetImageSearchState();
  $("#addDialogEyebrow").textContent = "תוספת חדשה"; $("#addDialogTitle").textContent = "את מי מוסיפים?";
  $("#addDialogDescription").textContent = "נחפש תמונה מתאימה בוויקיפדיה לפני השמירה.";
  $("#personName").value = ""; $("#personName").readOnly = false;
  $("#targetPackages").hidden = false; $("#targetPackages .package-options").innerHTML = packageOptions(state.packageId === ALL_PACKAGES_ID ? [] : [state.packageId]);
  $("#savePerson").textContent = "שמירת התוספת כטיוטה"; $("#addDialog").showModal();
};
$("#newPackage").onclick = () => $("#packageDialog").showModal();
$("#wikiSearch").onclick = async () => {
  await runImageSearch("wikipedia");
};
$("#webSearch").onclick = async () => {
  $("#webSearchRefine").hidden = false;
  await runImageSearch("web");
};
$("#webSearchRefineButton").onclick = async () => {
  await runImageSearch("web");
};
$("#webSearchExtra").onkeydown = async event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  await runImageSearch("web");
};
async function runImageSearch(source) {
  const name = $("#personName").value.trim(); if (!name) { toast("יש להזין שם מלא"); return }
  if (state.cardAction?.action !== "replace") lookupTmdbPerson(name);
  const extra = source === "web" ? $("#webSearchExtra").value.trim() : "";
  const searchQuery = extra ? `${name} ${extra}` : name;
  $("#wikiStatus b").textContent=source==="web"?"מחפש תמונות באינטרנט…":"מחפש בוויקיפדיה…";
  $("#wikiStatus span").textContent=source==="web"?`DuckDuckGo: ${searchQuery}`:"בודק ערכים ותמונות זמינות";
  $("#wikiStatus").hidden = false; $("#wikiResults").innerHTML = ""; $("#savePerson").disabled = true; $("#geminiGenerate").hidden = true; $("#geminiPreview").hidden = true; $("#geminiMessage").hidden = true; $("#geminiMessage").textContent = ""; clearGeminiError(); state.selectedWiki = null; state.generatedImage = null;
  try {
    const results = source==="web" ? await webImages(searchQuery) : await wikipedia(name); $("#wikiStatus").hidden = true;
    if (!results.length) { $("#wikiResults").innerHTML = `<div class="empty">לא נמצאה תמונה. נסו שם מלא או איות אחר.</div>`; return }
    $("#wikiResults").innerHTML = results.map((r, i) => `<button type="button" class="wiki-option" data-i="${i}"><img src="${r.thumbnailUrl||r.imageUrl}" alt=""><b>${escapeHtml(r.title)}</b>${r.width&&r.height?`<small>${r.width}×${r.height}</small>`:""}</button>`).join("");
    $$(".wiki-option").forEach(b => b.onclick = () => { $$(".wiki-option").forEach(x => x.classList.remove("selected")); b.classList.add("selected"); state.selectedWiki = results[+b.dataset.i]; state.generatedImage = null; $("#geminiGenerate").hidden = false; $("#geminiPreview").hidden = true; $("#geminiMessage").hidden = true; $("#geminiMessage").textContent = ""; clearGeminiError(); $("#savePerson").disabled = false });
  } catch (e) { $("#wikiStatus").hidden = true; $("#geminiMessage").textContent = e.message; $("#geminiMessage").className = "gemini-message error"; $("#geminiMessage").hidden = false }
}
$("#geminiGenerate").onclick = async () => {
  if (!state.selectedWiki) return;
  $("#geminiMessage").hidden = true; $("#geminiMessage").textContent = ""; clearGeminiError();
  $("#wikiStatus").hidden = false;
  $("#wikiStatus b").textContent = "OpenAI מעבד את התמונה…";
  $("#wikiStatus span").textContent = "יוצר איור קומיקס תוך שמירה על מראה האדם";
  $("#geminiGenerate").disabled = true;
  try {
    state.activeImageRequest = { name: $("#personName").value.trim(), imageUrl: state.selectedWiki.imageUrl, fallbackImageUrl: state.selectedWiki.thumbnailUrl || "", promise: generateGemini(state.selectedWiki.imageUrl) };
    state.generatedImage = await state.activeImageRequest.promise;
    state.activeImageRequest = null;
    $("#geminiPreview").innerHTML = `<span>תוצאת OpenAI</span><img src="${state.generatedImage}" alt="גרסת OpenAI שנוצרה">`;
    $("#geminiPreview").hidden = false;
    $("#geminiMessage").textContent = "גרסת OpenAI נוצרה בהצלחה. לאחר השמירה היא תוצג מול תמונת המקור.";
    $("#geminiMessage").className = "gemini-message success";
    $("#geminiMessage").hidden = false;
  } catch (e) { showGeminiError(e) }
  finally { state.activeImageRequest = null; $("#wikiStatus").hidden = true; $("#wikiStatus b").textContent = "מחפש בוויקיפדיה…"; $("#wikiStatus span").textContent = "בודק ערכים ותמונות זמינות"; $("#geminiGenerate").disabled = false }
};
$("#addForm").onsubmit = async e => {
  e.preventDefault(); if (!state.selectedWiki) return;
  if (state.cardAction?.action === "replace") {
    const person = state.cardAction.person;
    const originalImage = state.selectedWiki.imageUrl;
    const replacementGemini = state.generatedImage;
    if (person.new) {
      const addition = state.drafts.additions.find(item => item.id === person.id);
      if (addition) {
        addition.originalImageUrl = originalImage; addition.imageUrl = replacementGemini || originalImage;
        addition.wikipediaUrl = state.selectedWiki.pageUrl || "";
      }
    } else {
      const id = cardId(person);
      state.drafts.imageOverrides[id] = originalImage;
      if (replacementGemini) {
        state.drafts.geminiOverrides[id] = replacementGemini;
        state.drafts.removedGemini = state.drafts.removedGemini.filter(item => item !== id);
      } else {
        delete state.drafts.geminiOverrides[id];
        state.drafts.removedGemini = [...new Set([...state.drafts.removedGemini, id])];
      }
    }
    if (state.activeImageRequest) {
      const targets = person.new ? [{ type: "addition", id: person.id }] : [{ type: "base", id: cardId(person) }];
      if (person.new) { const addition = state.drafts.additions.find(item => item.id === person.id); if (addition) addition.imageJobId = "pending"; }
      queueBackgroundImageJob(state.activeImageRequest, targets);
    }
    saveDrafts(); state.cardAction = null; $("#addDialog").close(); e.target.reset(); resetImageSearchState();
    $("#personName").readOnly = false; $("#targetPackages").hidden = false; await load(); toast("התמונה הוחלפה בטיוטה"); return;
  }
  const packageIds = $$("#targetPackages input:checked").map(input => input.value);
  if (!packageIds.length) { toast("יש לבחור לפחות חבילה אחת"); return; }
  const createdAt = new Date().toISOString();
  const personId = `draft:${crypto.randomUUID()}`;
  const additions = packageIds.map(packageId => ({ id: crypto.randomUUID(), personId, packageId, name: $("#personName").value.trim(), imageUrl: state.generatedImage || state.selectedWiki.imageUrl, originalImageUrl: state.selectedWiki.imageUrl, wikipediaUrl: state.selectedWiki.pageUrl, tmdbId: $("#tmdbId").value.trim(), createdAt, imageJobId: state.activeImageRequest ? "pending" : "" }));
  state.drafts.additions.push(...additions);
  if (state.activeImageRequest) queueBackgroundImageJob(state.activeImageRequest, additions.map(item => ({ type: "addition", id: item.id })));
  saveDrafts(); $("#addDialog").close(); e.target.reset(); $("#existingPeople").hidden = true; $("#existingPeople").innerHTML = ""; $("#wikiResults").innerHTML = ""; $("#geminiGenerate").hidden = true; $("#geminiPreview").hidden = true; $("#geminiMessage").hidden = true; state.selectedWiki = null; state.generatedImage = null; await load(); toast(packageIds.length > 1 ? `האדם נוסף ל־${packageIds.length} חבילות בטיוטה` : "האדם נוסף ונשמר בטיוטת הדפדפן");
};
$("#packageForm").onsubmit = async e => {
  e.preventDefault(); const name = $("#packageName").value.trim(); const id = "custom_" + Date.now();
  state.drafts.packages.push({ id, name }); saveDrafts(); state.packageId = id; $("#packageDialog").close(); e.target.reset(); await load(); toast("החבילה החדשה נוצרה כטיוטה");
};
$("#exportDraft").onclick = () => {
  const blob = new Blob([JSON.stringify(state.drafts, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `israel-packages-draft-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); toast("קובץ הטיוטה הורד");
};
function importableAddition(item, packageIds, usedMemberships) {
  if (!item || typeof item !== "object") return null;
  const packageId = String(item.packageId || "").trim();
  const name = String(item.name || "").trim();
  const membership = `${packageId}:${normalizeName(name)}`;
  if (!packageIds.has(packageId) || !name || usedMemberships.has(membership)) return null;
  usedMemberships.add(membership);
  const importedPersonId = String(item.personId || "").trim() || legacyAdditionPersonId({ ...item, id: item.id || crypto.randomUUID(), new: true });
  return {
    id: crypto.randomUUID(),
    personId: canonicalPersonId(importedPersonId),
    packageId, name,
    imageUrl: String(item.imageUrl || item.originalImageUrl || ""),
    originalImageUrl: String(item.originalImageUrl || item.imageUrl || ""),
    wikipediaUrl: String(item.wikipediaUrl || ""), tmdbId: String(item.tmdbId || ""),
    createdAt: String(item.createdAt || new Date().toISOString()), imageJobId: ""
  };
}
function mergeImportedDraft(imported) {
  if (!imported || typeof imported !== "object" || Array.isArray(imported)) throw new Error("הקובץ אינו טיוטה תקינה");
  const incomingPackages = Array.isArray(imported.packages) ? imported.packages : [];
  const knownPackages = new Set(state.data.packages.map(pkg => pkg.id));
  let packagesAdded = 0;
  incomingPackages.forEach(pkg => {
    const id = String(pkg?.id || "").trim(), name = String(pkg?.name || "").trim();
    if (id && name && !knownPackages.has(id)) { state.drafts.packages.push({ id, name }); knownPackages.add(id); packagesAdded++; }
  });
  const usedMemberships = new Set();
  state.data.packages.forEach(pkg => pkg.people.forEach(person => usedMemberships.add(`${pkg.id}:${normalizeName(person.name)}`)));
  state.drafts.additions.forEach(person => usedMemberships.add(`${person.packageId}:${normalizeName(person.name)}`));
  let additionsAdded = 0, duplicatesSkipped = 0, invalidSkipped = 0;
  (Array.isArray(imported.additions) ? imported.additions : []).forEach(item => {
    const before = `${String(item?.packageId || "").trim()}:${normalizeName(item?.name)}`;
    const addition = importableAddition(item, knownPackages, usedMemberships);
    if (addition) additionsAdded++;
    else if (before !== ":" && usedMemberships.has(before)) duplicatesSkipped++;
    else invalidSkipped++;
    if (addition) state.drafts.additions.push(addition);
  });
  return { packagesAdded, additionsAdded, duplicatesSkipped, invalidSkipped };
}
$("#importDraft").onclick = () => $("#importDraftFile").click();
$("#importDraftFile").onchange = async event => {
  const file = event.target.files?.[0]; event.target.value = "";
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    const result = mergeImportedDraft(imported);
    saveDrafts(); await load();
    const details = [`${result.additionsAdded} תוספות יובאו`];
    if (result.packagesAdded) details.push(`${result.packagesAdded} חבילות יובאו`);
    if (result.duplicatesSkipped) details.push(`${result.duplicatesSkipped} כפילויות דולגו`);
    if (result.invalidSkipped) details.push(`${result.invalidSkipped} רשומות לא תקינות דולגו`);
    toast(details.join(" · "));
  } catch (error) { toast(error instanceof Error ? error.message : "ייבוא הטיוטה נכשל"); }
};
load().catch(e => { $("#people").innerHTML = `<div class="empty"><b>לא הצלחנו לטעון את החבילות</b><br>${escapeHtml(e.message)}</div>` });
