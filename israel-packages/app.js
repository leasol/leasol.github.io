const STORAGE_KEY = "israelPackageStudioDraftsV1";
const ALL_PACKAGES_ID = "__all__";
const state = { data: null, packageId: null, filter: "all", query: "", selectedWiki: null, generatedImage: null, lastGeminiError: "", cardAction: null, highlightCardId: null, drafts: { packages: [], additions: [], removals: [], imageOverrides: {}, geminiOverrides: {}, tmdbOverrides: {}, removedGemini: [] } };
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2600) }
function saveDrafts() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.drafts)) }
function normalizeDrafts() {
  state.drafts.packages ||= []; state.drafts.additions ||= [];
  state.drafts.removals ||= []; state.drafts.imageOverrides ||= {}; state.drafts.geminiOverrides ||= {}; state.drafts.tmdbOverrides ||= {}; state.drafts.removedGemini ||= [];
}
function cardId(x) { return x.new ? `addition:${x.id}` : `base:${x.packageId}:${x.key}` }
function isRemoved(x) { return state.drafts.removals.includes(cardId(x)) }
function packageDisplayCount(pkg) {
  const existingCount = pkg.people.filter(person => !isRemoved({ ...person, packageId: pkg.id, new: false })).length;
  const additionsCount = state.data.additions.filter(person => person.packageId === pkg.id && !isRemoved({ ...person, new: true })).length;
  return existingCount + additionsCount;
}
function packageOptions(selected = []) {
  return state.data.packages.map(p => `<label><input type="checkbox" name="targetPackages" value="${escapeHtml(p.id)}" ${selected.includes(p.id) ? "checked" : ""}><span>${escapeHtml(p.name)}</span></label>`).join("");
}
async function load() {
  const response = await fetch("data.json"); if (!response.ok) throw new Error("קובץ הנתונים אינו זמין");
  const base = await response.json();
  try { state.drafts = JSON.parse(localStorage.getItem(STORAGE_KEY)) || state.drafts } catch { }
  normalizeDrafts();
  state.data = { packages: [...base.packages, ...state.drafts.packages.map(p => ({ ...p, people: [], count: 0, custom: true }))], additions: state.drafts.additions };
  state.packageId = state.packageId || ALL_PACKAGES_ID;
  $("#packageCount").textContent = state.data.packages.length;
  $("#peopleCount").textContent = base.packages.reduce((n, p) => n + p.count, 0).toLocaleString("he-IL");
  $("#newCount").textContent = state.data.additions.length;
  $("#targetPackages .package-options").innerHTML = packageOptions(state.packageId === ALL_PACKAGES_ID ? [] : [state.packageId]);
  $("#destinationPackage").innerHTML = state.data.packages.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  render();
}
function current() { return state.packageId === ALL_PACKAGES_ID ? { id: ALL_PACKAGES_ID, name: "כל החבילות", custom: false } : state.data.packages.find(p => p.id === state.packageId) }
function render() {
  const p = current(); if (!p) return;
  const allCount = state.data.packages.reduce((count, pkg) => count + packageDisplayCount(pkg), 0);
  $("#packages").innerHTML = `<button class="all-packages ${p.id === ALL_PACKAGES_ID ? "active" : ""}" data-id="${ALL_PACKAGES_ID}"><span>כל החבילות</span><small>${allCount}</small></button>` + state.data.packages.map(x => `<button class="${x.id === p.id ? "active" : ""}" data-id="${x.id}"><span>${escapeHtml(x.name)}${x.custom ? " · טיוטה" : ""}</span><small>${packageDisplayCount(x)}</small></button>`).join("");
  $("#packageTitle").textContent = p.name; $("#packageTag").textContent = p.id === ALL_PACKAGES_ID ? "חיפוש ותצוגה בכל החבילות" : p.custom ? "חבילה חדשה · טיוטה" : "מתוך ה־manifest";
  const visiblePackages = p.id === ALL_PACKAGES_ID ? state.data.packages : [p];
  const existing = visiblePackages.flatMap(pkg => pkg.people.map(x => ({ ...x, packageId: pkg.id, packageName: pkg.name, new: false, hasGemini: Boolean(x.gemini) })));
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
    tmdbId: a.tmdbId || ""
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
  $("#people").innerHTML = rows.length ? rows.map((person, index) => card(person, index + 1)).join("") : `<div class="empty"><b>לא נמצאו אנשים</b><br>אפשר לשנות את החיפוש או להוסיף אדם חדש לחבילה.</div>`;
  $$("nav button").forEach(b => b.onclick = () => { state.packageId = b.dataset.id; render() });
  $$(".compare input").forEach(input => input.oninput = () => input.parentElement.style.setProperty("--split", input.value + "%"));
  $$(".card-action").forEach(button => button.onclick = () => button.dataset.action === "tmdb" ? openTmdbProfile(rows[+button.dataset.index]) : openCardAction(button.dataset.action, rows[+button.dataset.index]));
  if (state.highlightCardId) {
    const target = $$(".card").find(card => card.dataset.cardId === state.highlightCardId);
    if (target) requestAnimationFrame(() => { target.classList.add("person-highlight"); target.scrollIntoView({ behavior: "smooth", block: "center" }); state.highlightCardId = null; });
  }
}
function card(x, number) {
  const originalLabel = x.new ? "Wikipedia" : "מקור";
  const image = !x.hasGemini
    ? `<div class="compare"><img src="${x.original}" alt="התמונה שנבחרה עבור ${escapeHtml(x.name)}" loading="lazy"></div>`
    : `<div class="compare" style="--split:50%"><img src="${x.original}" alt="תמונת המקור של ${escapeHtml(x.name)}" loading="lazy"><img class="after" src="${x.gemini}" alt="תמונת Gemini של ${escapeHtml(x.name)}" loading="lazy"><div class="compare-line"></div><input type="range" min="0" max="100" value="50" aria-label="השוואת לפני ואחרי"><div class="labels"><span>${originalLabel}</span><span>Gemini</span></div></div>`;
  const actions = `<div class="card-actions" aria-label="פעולות עבור ${escapeHtml(x.name)}">
    <button class="card-action" type="button" data-action="replace" data-index="${number - 1}">החלפת תמונה</button>
    <button class="card-action" type="button" data-action="move" data-index="${number - 1}">העברה לחבילה</button>
    <button class="card-action" type="button" data-action="copy" data-index="${number - 1}">העתקה לחבילה</button>
    <button class="card-action remove-person" type="button" data-action="remove" data-index="${number - 1}">הסרת אדם</button>
    <button class="card-action tmdb-profile" type="button" data-action="tmdb" data-index="${number - 1}">צפייה בפרופיל TMDB</button>
  </div>`;
  const packageDetail = state.packageId === ALL_PACKAGES_ID && x.packageName ? ` · ${escapeHtml(x.packageName)}` : "";
  const details = x.new ? `נשמר בטיוטת הדפדפן${packageDetail}${x.tmdbId ? ` · TMDB ${escapeHtml(x.tmdbId)}` : ""}` : `${escapeHtml(x.key)}${packageDetail}`;
  return `<article class="card ${x.new ? "new" : ""}" data-card-id="${escapeHtml(cardId(x))}"><span class="badge">${x.new ? "חדש · טיוטה" : "קיים"}</span>${image}
    <div class="card-info"><b>${number}. ${escapeHtml(x.name)}</b><span>${details}</span>${actions}</div></article>`
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
  const options = local ? {} : {
    headers: { "OAI-Sites-Authorization": "Bearer MohaGTH8g09N7K2_lCN4jFKFFS8fZEwJsJm8eVr1Dao" }
  };
  const response = await fetch(endpoint + "?name=" + encodeURIComponent(name), options);
  const raw = await response.text(); let data = {}; try { data = JSON.parse(raw) } catch { }
  if (!response.ok) throw new Error(data.error || `חיפוש האינטרנט נכשל (${response.status})`);
  return data.results || [];
}
function findGeminiImage(value) {
  if (Array.isArray(value)) {
    for (const child of value) { const found = findGeminiImage(child); if (found) return found }
  } else if (value && typeof value === "object") {
    if (value.type === "image" && value.data) return { data: value.data, mimeType: value.mime_type || "image/png" };
    for (const child of Object.values(value)) { const found = findGeminiImage(child); if (found) return found }
  }
  return null;
}
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function fetchImageBlob(imageUrl) {
  try {
    const direct = await fetch(imageUrl);
    if (direct.ok) return direct.blob();
  } catch { }
  const proxyUrl = "https://israel-packages-image-search.adar-bokobza.chatgpt.site/api/image-proxy?url=" + encodeURIComponent(imageUrl);
  const proxied = await fetch(proxyUrl, {
    headers: { "OAI-Sites-Authorization": "Bearer MohaGTH8g09N7K2_lCN4jFKFFS8fZEwJsJm8eVr1Dao" }
  });
  if (!proxied.ok) {
    const raw = await proxied.text();
    let message = ""; try { message = JSON.parse(raw).error || "" } catch { }
    throw new Error(message || `לא ניתן להוריד את תמונת המקור (${proxied.status})`);
  }
  return proxied.blob();
}
async function generateGeminiInBrowser(imageUrl) {
  const key = window.ISRAEL_PACKAGES_CONFIG?.geminiApiKey?.trim();
  if (!key || key === "YOUR_GEMINI_API_KEY") throw new Error("לא הוגדר מפתח Gemini בקובץ config.js");
  const blob = await fetchImageBlob(imageUrl);
  const prompt = "Transform the provided image into comic-book-style, cell-shaded graphic novel art with bold, clean outlines and a pure white background. Preserve the person's identity, facial features, expression, pose, proportions, hairstyle, and clothing as faithfully as possible. Stay true to the original image. Do not add, remove, or invent people or objects. Do not add captions, speech bubbles, logos, watermarks, letters, symbols, or text of any kind. NO TEXT WHATSOEVER.";
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ model: "gemini-3.1-flash-image", input: [{ type: "image", mime_type: blob.type || "image/jpeg", data: await blobToBase64(blob) }, { type: "text", text: prompt }], response_format: { type: "image", mime_type: "image/jpeg", image_size: "1K" } })
  });
  const raw = await response.text();
  let result = {}; try { result = JSON.parse(raw) } catch { }
  if (!response.ok) {
    const error = new Error(result.error?.message || `Gemini דחה את הבקשה (${response.status})`);
    error.details = `HTTP ${response.status} ${response.statusText}\n\n${raw || "No response body"}`;
    throw error;
  }
  const image = findGeminiImage(result); if (!image) throw new Error("Gemini לא החזיר תמונה");
  return `data:${image.mimeType};base64,${image.data}`;
}
async function generateGemini(imageUrl) {
  const key = window.ISRAEL_PACKAGES_CONFIG?.geminiApiKey?.trim();
  if (key && key !== "YOUR_GEMINI_API_KEY") return generateGeminiInBrowser(imageUrl);
  if (location.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(location.hostname)) {
    throw new Error("לא הוגדר מפתח Gemini בקובץ config.js");
  }
  const response = await fetch("/api/gemini", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: $("#personName").value.trim(), imageUrl }) });
  const raw = await response.text(); let data = {}; try { data = JSON.parse(raw) } catch { }
  if (!response.ok) { const error = new Error(data.error || "עיבוד התמונה נכשל"); error.details = data.details || `HTTP ${response.status} ${response.statusText}\n\n${raw}`; throw error }
  return data.imageUrl;
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
  state.lastGeminiError = `Gemini image generation error\n${new Date().toISOString()}\n\n${summary}\n\n${details}`;
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
    id: crypto.randomUUID(), packageId, name: x.name,
    imageUrl: x.gemini || x.original, originalImageUrl: x.original,
    wikipediaUrl: x.wikipediaUrl || "", tmdbId: x.tmdbId || "", createdAt: new Date().toISOString()
  };
}
function openCardAction(action, person) {
  if (action === "replace") {
    openReplacementSearch(person);
    return;
  }
  state.cardAction = { action, person };
  const labels = { replace: "החלפת תמונה", move: "העברה לחבילה", copy: "העתקה לחבילה", remove: "הסרת אדם" };
  $("#cardActionTitle").textContent = labels[action];
  $("#cardActionEyebrow").textContent = person.name;
  $("#destinationPackageField").hidden = !["move", "copy"].includes(action);
  $("#destinationPackage").value = state.data.packages.find(p => p.id !== person.packageId)?.id || person.packageId;
  const descriptions = {
    move: "האדם יוסר מהחבילה הנוכחית ויופיע בחבילת היעד.",
    copy: "עותק של האדם יתווסף לחבילת היעד, והמקור יישאר כאן.",
    remove: "האדם יוסר מחבילה זו בטיוטה. אפשר לשחזר באמצעות מחיקת הטיוטות בדפדפן."
  };
  $("#cardActionDescription").textContent = descriptions[action];
  $("#saveCardAction").textContent = action === "remove" ? "הסרה כטיוטה" : "שמירה כטיוטה";
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
  $("#addDialogDescription").textContent = "חפשו תמונה חדשה בוויקיפדיה או באינטרנט, ואפשר גם ליצור עיבוד Gemini חדש.";
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
      if (!isRemoved(item) && normalizeName(person.name).includes(query)) matches.push({ packageId: pkg.id, packageName: pkg.name, cardId: cardId(item), name: person.name });
    });
    state.drafts.additions.filter(person => person.packageId === pkg.id).forEach(person => {
      const item = { ...person, new: true };
      if (!isRemoved(item) && normalizeName(person.name).includes(query)) matches.push({ packageId: pkg.id, packageName: pkg.name, cardId: cardId(item), name: person.name });
    });
  });
  return matches.slice(0, 10);
}
function showExistingPeople() {
  const matches = findExistingPeople($("#personName").value);
  const panel = $("#existingPeople");
  panel.hidden = !matches.length;
  if (!matches.length) { panel.innerHTML = ""; return; }
  panel.innerHTML = `<b>האדם כבר קיים בחבילה אחרת — לחצו כדי להציג אותו:</b>${matches.map((match, index) => `<button type="button" class="existing-person-option" data-index="${index}"><span>${escapeHtml(match.name)}</span><small>${escapeHtml(match.packageName)}</small></button>`).join("")}`;
  $$(".existing-person-option").forEach(button => button.onclick = () => {
    const match = matches[+button.dataset.index];
    state.packageId = match.packageId; state.filter = "all"; state.query = ""; state.highlightCardId = match.cardId;
    $("#search").value = ""; $$(".tabs button").forEach(tab => tab.classList.toggle("active", tab.dataset.filter === "all")); $("#showMissingGemini").classList.remove("active");
    $("#addDialog").close(); render(); toast(`נפתח: ${match.name} · ${match.packageName}`);
  });
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
  if (action === "remove") {
    if (!confirm(`להסיר את ${person.name} מחבילה זו?`)) return;
    if (person.new) state.drafts.additions = state.drafts.additions.filter(item => item.id !== person.id);
    else state.drafts.removals = [...new Set([...state.drafts.removals, cardId(person)])];
  } else {
    const destination = $("#destinationPackage").value;
    if (!destination || destination === person.packageId) { toast("יש לבחור חבילה אחרת"); return; }
    if (action === "move" && person.new) {
      const item = state.drafts.additions.find(item => item.id === person.id);
      if (item) item.packageId = destination;
    } else {
      state.drafts.additions.push(additionFromCard(person, destination));
      if (action === "move") state.drafts.removals = [...new Set([...state.drafts.removals, cardId(person)])];
    }
  }
  saveDrafts(); $("#cardActionDialog").close(); state.cardAction = null; await load();
  toast(action === "remove" ? "האדם הוסר בטיוטה" : action === "move" ? "האדם הועבר בטיוטה" : "העתק נוסף בטיוטה");
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
  $("#wikiStatus b").textContent = "Gemini מעבד את התמונה…";
  $("#wikiStatus span").textContent = "יוצר איור קומיקס תוך שמירה על מראה האדם";
  $("#geminiGenerate").disabled = true; $("#savePerson").disabled = true;
  try {
    state.generatedImage = await generateGemini(state.selectedWiki.imageUrl);
    $("#geminiPreview").innerHTML = `<span>תוצאת Gemini</span><img src="${state.generatedImage}" alt="גרסת Gemini שנוצרה">`;
    $("#geminiPreview").hidden = false;
    $("#geminiMessage").textContent = "גרסת Gemini נוצרה בהצלחה. לאחר השמירה היא תוצג מול תמונת Wikipedia.";
    $("#geminiMessage").className = "gemini-message success";
    $("#geminiMessage").hidden = false;
  } catch (e) { showGeminiError(e) }
  finally { $("#wikiStatus").hidden = true; $("#wikiStatus b").textContent = "מחפש בוויקיפדיה…"; $("#wikiStatus span").textContent = "בודק ערכים ותמונות זמינות"; $("#geminiGenerate").disabled = false; $("#savePerson").disabled = false }
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
    saveDrafts(); state.cardAction = null; $("#addDialog").close(); e.target.reset(); resetImageSearchState();
    $("#personName").readOnly = false; $("#targetPackages").hidden = false; await load(); toast("התמונה הוחלפה בטיוטה"); return;
  }
  const packageIds = $$("#targetPackages input:checked").map(input => input.value);
  if (!packageIds.length) { toast("יש לבחור לפחות חבילה אחת"); return; }
  const createdAt = new Date().toISOString();
  packageIds.forEach(packageId => state.drafts.additions.push({ id: crypto.randomUUID(), packageId, name: $("#personName").value.trim(), imageUrl: state.generatedImage || state.selectedWiki.imageUrl, originalImageUrl: state.selectedWiki.imageUrl, wikipediaUrl: state.selectedWiki.pageUrl, tmdbId: $("#tmdbId").value.trim(), createdAt }));
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
load().catch(e => { $("#people").innerHTML = `<div class="empty"><b>לא הצלחנו לטעון את החבילות</b><br>${escapeHtml(e.message)}</div>` });
