const STORAGE_KEY="israelPackageStudioDraftsV1";
const state={data:null,packageId:null,filter:"all",query:"",selectedWiki:null,drafts:{packages:[],additions:[]}};
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
  const added=state.data.additions.filter(a=>a.packageId===p.id).map(a=>({key:a.id,name:a.name,original:a.imageUrl,gemini:a.imageUrl,new:true,wikipediaUrl:a.wikipediaUrl}));
  let rows=state.filter==="existing"?existing:state.filter==="new"?added:[...added,...existing];
  if(state.query)rows=rows.filter(x=>(x.name+" "+x.key).toLowerCase().includes(state.query.toLowerCase()));
  $("#resultCount").textContent=`${rows.length} אנשים`;
  $("#people").innerHTML=rows.length?rows.map(card).join(""):`<div class="empty"><b>לא נמצאו אנשים</b><br>אפשר לשנות את החיפוש או להוסיף אדם חדש לחבילה.</div>`;
  $$("nav button").forEach(b=>b.onclick=()=>{state.packageId=b.dataset.id;render()});
  $$(".compare input").forEach(input=>input.oninput=()=>input.parentElement.style.setProperty("--split",input.value+"%"));
}
function card(x){
  return `<article class="card ${x.new?"new":""}"><span class="badge">${x.new?"חדש · טיוטה":"קיים"}</span><div class="compare" style="--split:50%">
    <img src="${x.original}" alt="תמונת המקור של ${escapeHtml(x.name)}" loading="lazy"><img class="after" src="${x.gemini}" alt="תמונת Gemini של ${escapeHtml(x.name)}" loading="lazy">
    <div class="compare-line"></div><input type="range" min="0" max="100" value="50" aria-label="השוואת לפני ואחרי"><div class="labels"><span>מקור</span><span>Gemini</span></div></div>
    <div class="card-info"><b>${escapeHtml(x.name)}</b><span>${x.new?"נשמר בטיוטת הדפדפן":escapeHtml(x.key)}</span></div></article>`
}
async function wikipedia(name){
  const params=new URLSearchParams({action:"query",generator:"search",gsrsearch:name,gsrnamespace:"0",gsrlimit:"5",prop:"pageimages|extracts|info",inprop:"url",piprop:"thumbnail|original",pithumbsize:"900",exintro:"1",explaintext:"1",format:"json",origin:"*"});
  const response=await fetch("https://he.wikipedia.org/w/api.php?"+params);
  if(!response.ok)throw new Error("החיפוש בוויקיפדיה אינו זמין כרגע");
  const raw=await response.json();
  return Object.values(raw.query?.pages||{}).sort((a,b)=>(a.index||999)-(b.index||999)).map(p=>({title:p.title,description:(p.extract||"").slice(0,240),pageUrl:p.fullurl,imageUrl:(p.original||p.thumbnail||{}).source})).filter(x=>x.imageUrl);
}
$("#search").oninput=e=>{state.query=e.target.value;render()};
$$(".tabs button").forEach(b=>b.onclick=()=>{$$(".tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.filter=b.dataset.filter;render()});
$("#openAdd").onclick=()=>{$("#targetPackage").value=state.packageId;$("#addDialog").showModal()};
$("#newPackage").onclick=()=>$("#packageDialog").showModal();
$("#wikiSearch").onclick=async()=>{
  const name=$("#personName").value.trim();if(!name){toast("יש להזין שם מלא");return}
  $("#wikiStatus").hidden=false;$("#wikiResults").innerHTML="";$("#savePerson").disabled=true;state.selectedWiki=null;
  try{
    const results=await wikipedia(name);$("#wikiStatus").hidden=true;
    if(!results.length){$("#wikiResults").innerHTML=`<div class="empty">לא נמצאה תמונה. נסו שם מלא או איות אחר.</div>`;return}
    $("#wikiResults").innerHTML=results.map((r,i)=>`<button type="button" class="wiki-option" data-i="${i}"><img src="${r.imageUrl}" alt=""><b>${escapeHtml(r.title)}</b></button>`).join("");
    $$(".wiki-option").forEach(b=>b.onclick=()=>{$$(".wiki-option").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");state.selectedWiki=results[+b.dataset.i];$("#savePerson").disabled=false});
  }catch(e){$("#wikiStatus").hidden=true;toast(e.message)}
};
$("#addForm").onsubmit=async e=>{
  e.preventDefault();if(!state.selectedWiki)return;
  state.drafts.additions.push({id:crypto.randomUUID(),packageId:$("#targetPackage").value,name:$("#personName").value.trim(),imageUrl:state.selectedWiki.imageUrl,wikipediaUrl:state.selectedWiki.pageUrl,createdAt:new Date().toISOString()});
  saveDrafts();$("#addDialog").close();e.target.reset();$("#wikiResults").innerHTML="";state.selectedWiki=null;await load();toast("האדם נוסף ונשמר בטיוטת הדפדפן");
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
