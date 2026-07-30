const STORAGE_KEY="israelPackageStudioDraftsV1";
const state={data:null,packageId:null,filter:"all",query:"",selectedWiki:null,generatedImage:null,lastGeminiError:"",drafts:{packages:[],additions:[]}};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600)}
function saveDrafts(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state.drafts))}
async function load(){
  const response=await fetch("data.json");if(!response.ok)throw new Error("קובץ הנתונים אינו זמין");
  const base=await response.json();
  try{state.drafts=JSON.parse(localStorage.getItem(STORAGE_KEY))||state.drafts}catch{}
  state.data={packages:[...base.packages,...state.drafts.packages.map(p=>({...p,people:[],count:0,custom:true}))],additions:state.drafts.additions};
  state.packageId=state.packageId||state.data.packages[0]?.id;
  $("#packageCount").textContent=state.data.packages.length;
  $("#peopleCount").textContent=base.packages.reduce((n,p)=>n+p.count,0).toLocaleString("he-IL");
  $("#newCount").textContent=state.data.additions.length;
  $("#targetPackage").innerHTML=state.data.packages.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  render();
}
function current(){return state.data.packages.find(p=>p.id===state.packageId)}
function render(){
  const p=current();if(!p)return;
  $("#packages").innerHTML=state.data.packages.map(x=>`<button class="${x.id===p.id?"active":""}" data-id="${x.id}"><span>${escapeHtml(x.name)}${x.custom?" · טיוטה":""}</span><small>${x.count+state.data.additions.filter(a=>a.packageId===x.id).length}</small></button>`).join("");
  $("#packageTitle").textContent=p.name;$("#packageTag").textContent=p.custom?"חבילה חדשה · טיוטה":"מתוך ה־manifest";
  const existing=p.people.map(x=>({...x,new:false}));
  const added=state.data.additions.filter(a=>a.packageId===p.id).map(a=>({
    key:a.id,
    name:a.name,
    original:a.originalImageUrl||a.imageUrl,
    gemini:a.imageUrl,
    hasGemini:Boolean(a.originalImageUrl&&a.imageUrl!==a.originalImageUrl),
    new:true,
    wikipediaUrl:a.wikipediaUrl
  }));
  let rows=state.filter==="existing"?existing:state.filter==="new"?added:[...added,...existing];
  if(state.query)rows=rows.filter(x=>(x.name+" "+x.key).toLowerCase().includes(state.query.toLowerCase()));
  $("#resultCount").textContent=`${rows.length} אנשים`;
  $("#people").innerHTML=rows.length?rows.map((person,index)=>card(person,index+1)).join(""):`<div class="empty"><b>לא נמצאו אנשים</b><br>אפשר לשנות את החיפוש או להוסיף אדם חדש לחבילה.</div>`;
  $$("nav button").forEach(b=>b.onclick=()=>{state.packageId=b.dataset.id;render()});
  $$(".compare input").forEach(input=>input.oninput=()=>input.parentElement.style.setProperty("--split",input.value+"%"));
  $$(".delete-person").forEach(button=>button.onclick=async()=>{
    const person=state.drafts.additions.find(item=>item.id===button.dataset.id);
    if(!person||!confirm(`למחוק את ${person.name} מהטיוטה?`))return;
    state.drafts.additions=state.drafts.additions.filter(item=>item.id!==button.dataset.id);
    saveDrafts();
    await load();
    toast("האדם נמחק מהטיוטה");
  });
}
function card(x,number){
  const originalLabel=x.new?"Wikipedia":"מקור";
  const image=x.new&&!x.hasGemini
    ? `<div class="compare"><img src="${x.original}" alt="התמונה שנבחרה עבור ${escapeHtml(x.name)}" loading="lazy"></div>`
    : `<div class="compare" style="--split:50%"><img src="${x.original}" alt="תמונת המקור של ${escapeHtml(x.name)}" loading="lazy"><img class="after" src="${x.gemini}" alt="תמונת Gemini של ${escapeHtml(x.name)}" loading="lazy"><div class="compare-line"></div><input type="range" min="0" max="100" value="50" aria-label="השוואת לפני ואחרי"><div class="labels"><span>${originalLabel}</span><span>Gemini</span></div></div>`;
  const remove=x.new?`<button class="delete-person" type="button" data-id="${escapeHtml(x.key)}" aria-label="מחיקת ${escapeHtml(x.name)} מהטיוטה">מחיקה מהטיוטה</button>`:"";
  return `<article class="card ${x.new?"new":""}"><span class="badge">${x.new?"חדש · טיוטה":"קיים"}</span>${image}
    <div class="card-info"><b>${number}. ${escapeHtml(x.name)}</b><span>${x.new?"נשמר בטיוטת הדפדפן":escapeHtml(x.key)}</span>${remove}</div></article>`
}
async function wikipedia(name){
  const params=new URLSearchParams({action:"query",generator:"search",gsrsearch:name,gsrnamespace:"0",gsrlimit:"5",prop:"pageimages|extracts|info",inprop:"url",piprop:"thumbnail|original",pithumbsize:"900",exintro:"1",explaintext:"1",format:"json",origin:"*"});
  const response=await fetch("https://he.wikipedia.org/w/api.php?"+params);
  if(!response.ok)throw new Error("החיפוש בוויקיפדיה אינו זמין כרגע");
  const raw=await response.json();
  return Object.values(raw.query?.pages||{}).sort((a,b)=>(a.index||999)-(b.index||999)).map(p=>({title:p.title,description:(p.extract||"").slice(0,240),pageUrl:p.fullurl,imageUrl:(p.original||p.thumbnail||{}).source})).filter(x=>x.imageUrl);
}
function findGeminiImage(value){
  if(Array.isArray(value)){
    for(const child of value){const found=findGeminiImage(child);if(found)return found}
  }else if(value&&typeof value==="object"){
    if(value.type==="image"&&value.data)return {data:value.data,mimeType:value.mime_type||"image/png"};
    for(const child of Object.values(value)){const found=findGeminiImage(child);if(found)return found}
  }
  return null;
}
async function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(",")[1]);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function generateGeminiInBrowser(imageUrl){
  const key=window.ISRAEL_PACKAGES_CONFIG?.geminiApiKey?.trim();
  if(!key||key==="YOUR_GEMINI_API_KEY")throw new Error("לא הוגדר מפתח Gemini בקובץ config.js");
  const source=await fetch(imageUrl);if(!source.ok)throw new Error("לא ניתן להוריד את תמונת Wikipedia");
  const blob=await source.blob();
  const prompt="Transform the provided image into comic-book-style, cell-shaded graphic novel art with bold, clean outlines and a pure white background. Preserve the person's identity, facial features, expression, pose, proportions, hairstyle, and clothing as faithfully as possible. Stay true to the original image. Do not add, remove, or invent people or objects. Do not add captions, speech bubbles, logos, watermarks, letters, symbols, or text of any kind. NO TEXT WHATSOEVER.";
  const response=await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
    method:"POST",
    headers:{"Content-Type":"application/json","x-goog-api-key":key},
    body:JSON.stringify({model:"gemini-3.1-flash-image",input:[{type:"image",mime_type:blob.type||"image/jpeg",data:await blobToBase64(blob)},{type:"text",text:prompt}],response_format:{type:"image",mime_type:"image/png",image_size:"1K"}})
  });
  const raw=await response.text();
  let result={};try{result=JSON.parse(raw)}catch{}
  if(!response.ok){
    const error=new Error(result.error?.message||`Gemini דחה את הבקשה (${response.status})`);
    error.details=`HTTP ${response.status} ${response.statusText}\n\n${raw||"No response body"}`;
    throw error;
  }
  const image=findGeminiImage(result);if(!image)throw new Error("Gemini לא החזיר תמונה");
  return `data:${image.mimeType};base64,${image.data}`;
}
async function generateGemini(imageUrl){
  const key=window.ISRAEL_PACKAGES_CONFIG?.geminiApiKey?.trim();
  if(key&&key!=="YOUR_GEMINI_API_KEY")return generateGeminiInBrowser(imageUrl);
  if(location.protocol==="http:"&&(location.hostname==="localhost"||location.hostname==="127.0.0.1")){
    const response=await fetch("/api/gemini",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:$("#personName").value.trim(),imageUrl})});
    const raw=await response.text();let data={};try{data=JSON.parse(raw)}catch{}
    if(!response.ok){const error=new Error(data.error||"עיבוד התמונה נכשל");error.details=data.details||`HTTP ${response.status} ${response.statusText}\n\n${raw}`;throw error}
    return data.imageUrl;
  }
  throw new Error("לא הוגדר מפתח Gemini בקובץ config.js");
}
$("#search").oninput=e=>{state.query=e.target.value;render()};
$$("dialog .close").forEach(button=>button.onclick=()=>button.closest("dialog").close());
$$(".tabs button").forEach(b=>b.onclick=()=>{$$(".tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.filter=b.dataset.filter;render()});
function clearGeminiError(){
  state.lastGeminiError="";$("#geminiErrorPanel").hidden=true;$("#geminiErrorDetails").textContent="";
}
function showGeminiError(error){
  const summary=error?.message||String(error);
  const details=error?.details||error?.stack||summary;
  state.lastGeminiError=`Gemini image generation error\n${new Date().toISOString()}\n\n${summary}\n\n${details}`;
  $("#geminiMessage").textContent=`יצירת התמונה נכשלה: ${summary}`;
  $("#geminiMessage").className="gemini-message error";$("#geminiMessage").hidden=false;
  $("#geminiErrorDetails").textContent=state.lastGeminiError;$("#geminiErrorPanel").hidden=false;
}
$("#copyGeminiError").onclick=async()=>{
  if(!state.lastGeminiError)return;
  try{await navigator.clipboard.writeText(state.lastGeminiError)}
  catch{const input=document.createElement("textarea");input.value=state.lastGeminiError;document.body.append(input);input.select();document.execCommand("copy");input.remove()}
  $("#copyGeminiError").textContent="הועתק ✓";setTimeout(()=>$("#copyGeminiError").textContent="העתקת השגיאה",1600);
};
$("#openAdd").onclick=()=>{$("#targetPackage").value=state.packageId;$("#geminiMessage").hidden=true;$("#geminiMessage").textContent="";clearGeminiError();$("#addDialog").showModal()};
$("#newPackage").onclick=()=>$("#packageDialog").showModal();
$("#wikiSearch").onclick=async()=>{
  const name=$("#personName").value.trim();if(!name){toast("יש להזין שם מלא");return}
  $("#wikiStatus").hidden=false;$("#wikiResults").innerHTML="";$("#savePerson").disabled=true;$("#geminiGenerate").hidden=true;$("#geminiPreview").hidden=true;$("#geminiMessage").hidden=true;$("#geminiMessage").textContent="";clearGeminiError();state.selectedWiki=null;state.generatedImage=null;
  try{
    const results=await wikipedia(name);$("#wikiStatus").hidden=true;
    if(!results.length){$("#wikiResults").innerHTML=`<div class="empty">לא נמצאה תמונה. נסו שם מלא או איות אחר.</div>`;return}
    $("#wikiResults").innerHTML=results.map((r,i)=>`<button type="button" class="wiki-option" data-i="${i}"><img src="${r.imageUrl}" alt=""><b>${escapeHtml(r.title)}</b></button>`).join("");
    $$(".wiki-option").forEach(b=>b.onclick=()=>{$$(".wiki-option").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");state.selectedWiki=results[+b.dataset.i];state.generatedImage=null;$("#geminiGenerate").hidden=false;$("#geminiPreview").hidden=true;$("#geminiMessage").hidden=true;$("#geminiMessage").textContent="";clearGeminiError();$("#savePerson").disabled=false});
  }catch(e){$("#wikiStatus").hidden=true;$("#geminiMessage").textContent=e.message;$("#geminiMessage").className="gemini-message error";$("#geminiMessage").hidden=false}
};
$("#geminiGenerate").onclick=async()=>{
  if(!state.selectedWiki)return;
  $("#geminiMessage").hidden=true;$("#geminiMessage").textContent="";clearGeminiError();
  $("#wikiStatus").hidden=false;
  $("#wikiStatus b").textContent="Gemini מעבד את התמונה…";
  $("#wikiStatus span").textContent="יוצר איור קומיקס תוך שמירה על מראה האדם";
  $("#geminiGenerate").disabled=true;$("#savePerson").disabled=true;
  try{
    state.generatedImage=await generateGemini(state.selectedWiki.imageUrl);
    $("#geminiPreview").innerHTML=`<span>תוצאת Gemini</span><img src="${state.generatedImage}" alt="גרסת Gemini שנוצרה">`;
    $("#geminiPreview").hidden=false;
    $("#geminiMessage").textContent="גרסת Gemini נוצרה בהצלחה. לאחר השמירה היא תוצג מול תמונת Wikipedia.";
    $("#geminiMessage").className="gemini-message success";
    $("#geminiMessage").hidden=false;
  }catch(e){showGeminiError(e)}
  finally{$("#wikiStatus").hidden=true;$("#wikiStatus b").textContent="מחפש בוויקיפדיה…";$("#wikiStatus span").textContent="בודק ערכים ותמונות זמינות";$("#geminiGenerate").disabled=false;$("#savePerson").disabled=false}
};
$("#addForm").onsubmit=async e=>{
  e.preventDefault();if(!state.selectedWiki)return;
  state.drafts.additions.push({id:crypto.randomUUID(),packageId:$("#targetPackage").value,name:$("#personName").value.trim(),imageUrl:state.generatedImage||state.selectedWiki.imageUrl,originalImageUrl:state.selectedWiki.imageUrl,wikipediaUrl:state.selectedWiki.pageUrl,createdAt:new Date().toISOString()});
  saveDrafts();$("#addDialog").close();e.target.reset();$("#wikiResults").innerHTML="";$("#geminiGenerate").hidden=true;$("#geminiPreview").hidden=true;$("#geminiMessage").hidden=true;state.selectedWiki=null;state.generatedImage=null;await load();toast("האדם נוסף ונשמר בטיוטת הדפדפן");
};
$("#packageForm").onsubmit=async e=>{
  e.preventDefault();const name=$("#packageName").value.trim();const id="custom_"+Date.now();
  state.drafts.packages.push({id,name});saveDrafts();state.packageId=id;$("#packageDialog").close();e.target.reset();await load();toast("החבילה החדשה נוצרה כטיוטה");
};
$("#exportDraft").onclick=()=>{
  const blob=new Blob([JSON.stringify(state.drafts,null,2)],{type:"application/json"});
  const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`israel-packages-draft-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(link.href);toast("קובץ הטיוטה הורד");
};
load().catch(e=>{$("#people").innerHTML=`<div class="empty"><b>לא הצלחנו לטעון את החבילות</b><br>${escapeHtml(e.message)}</div>`});
