const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user = null, courses = [], resources = [], points = 0, purchases = new Set();
let currentFile = null, courseQuery = '', resourceQuery = '', typeFilter = 'All', busy = false;
// Shared data helpers used by multiple pages.
const courseBy = id => courses.find(c => String(c.id) === String(id));
const resourceBy = id => resources.find(r => String(r.id) === String(id));
const code = c => c ? (c.code || `${c.subject || ''} ${c.course_number ?? ''}`.trim()) : 'Unknown course';
const route = id => encodeURIComponent(String(id));
const purchased = r => purchases.has(String(r.id));
const owned = r => r.owner_id === user?.id;
const accessible = r => purchased(r) || owned(r);
const pdf = '<span class="pdf" aria-hidden="true">PDF</span>';
// Shared UI notification and navigation helpers.
function toast(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => $('#toast').style.display = 'none', 5000); }
function go(path) { if (location.hash === '#' + path) render(); else location.hash = path; }
// Shared API layer: uses the real backend or the browser-only demo backend.
async function api(path, options = {}) {
  if(CONFIG.mode==='demo') return demoAPI(path,options);
  if (location.protocol === 'file:') throw new Error('Run the backend and open http://127.0.0.1:8000 to use StudySwap.');
  let response;
  const token = sessionStorage.getItem('studyswap-access-token');
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try { response = await fetch(`${CONFIG.apiBase}${path}`, {credentials:'include', ...options, headers}); }
  catch { throw new Error('Cannot reach the server. Check that the backend is running.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && path !== '/signup') {
      sessionStorage.removeItem('studyswap-access-token');
      user = null;
      render();
    }
    const detail = Array.isArray(data.detail) ? data.detail.map(x => x.msg).join(' · ') : data.detail;
    throw new Error(detail || 'The request could not be completed.');
  }
  return data;
}
// Shared data loading after login or after a data-changing action.
async function loadData() {
  const [account, courseData, resourceData] = await Promise.all([api('/me'), api('/courses'), api('/resources')]);
  user = account.user; points = account.points;
  purchases = new Set(account.purchases.map(p => String(p.resource_id)));
  courses = courseData; resources = resourceData;
}
// Shared application header shown on authenticated pages.
function header(page) {
  return `<header class="header"><a class="brand" href="#home"><span class="mark">S</span>StudySwap</a><nav class="nav" aria-label="Main navigation">${[['home','Home'],['courses','Courses'],['upload','Upload'],['assistant','Assistant']].map(([id,label])=>`<a href="#${id}" class="${page===id || id==='courses' && ['course','resource'].includes(page) ? 'active':''}">${label}</a>`).join('')}</nav><div class="account"><span class="points">${points} pts</span><button class="avatar" id="account-button" aria-label="Account menu">${esc(user.name.slice(0,2).toUpperCase())}</button></div></header>${CONFIG.mode==='demo'?'<div class="demo"><span>Frontend demo · Demo courses and points · PDFs saved in this browser</span></div>':''}`;
}
// Login page renderer.
function login() {
  return `
    <main class="login-screen">
      <section class="login-box">
        <h1>StudySwap</h1>

        <form id="login-form" class="panel">
          <label for="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
          >

          <label class="field" for="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
          >

          <p id="login-error" class="error" role="alert"></p>
          <button class="btn dark full" type="submit">
            Log in
          </button>
        </form>

        <form id="signup-form" class="panel">
          <h2>Create account</h2>

          <label for="signup-name">Name</label>
          <input
            id="signup-name"
            name="name"
            type="text"
            required
          >

          <label for="signup-email">Email</label>
          <input
            id="signup-email"
            name="email"
            type="email"
            placeholder="you@wisc.edu"
            required
          >

          <label for="signup-password">Password</label>
          <input
            id="signup-password"
            name="password"
            type="password"
            minlength="8"
            required
          >

          <p id="signup-error" class="error" role="alert"></p>
          <button class="btn full" type="submit">
            Sign up
          </button>
        </form>
      </section>
    </main>
  `;
}
// Home page: displays courses containing purchased resources.
function courseCard(c) {
  return `<a class="panel course-mini" href="#course/${route(c.id)}"><h3>${esc(code(c))}</h3><p class="course-summary">${esc(shortDescription(c))}</p></a>`;
}
// Reusable course card used on the Home page.
function home() {
  const boughtCourses = new Set(resources.filter(purchased).map(r => String(r.course_id)));
  const list = courses.filter(c => boughtCourses.has(String(c.id)));
  return `<main class="main narrow"><div class="page-heading"><h1>My courses</h1><p>Courses with resources you've purchased using points.</p></div><div class="courses-mini">${list.map(courseCard).join('') || '<div class="panel empty" style="grid-column:1/-1"><h2>No purchased courses yet</h2><p>Purchase a resource in Courses to add its course here.</p><a class="btn dark" href="#courses">Browse courses</a></div>'}</div></main>`;
}
// Courses page: search form and results container.
function coursesPage() {
  return `<main class="main narrow"><h1>Find a course</h1><form id="course-search" class="search"><span aria-hidden="true">⌕</span><input name="q" aria-label="Search courses" placeholder="Search by course code or title" value="${esc(courseQuery)}"><button class="btn dark">Search</button></form><p class="muted" id="result-summary"></p><div id="course-results"></div></main>`;
}
// Courses page: filters and renders matching courses.
function showCourses() {
  const words = courseQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const list = courses.filter(c => words.every(w => (code(c)+' '+c.title).toLowerCase().includes(w)));
  $('#result-summary').textContent = `${list.length} courses`;
  $('#course-results').innerHTML = list.map(c => `<a class="panel result course-result" href="#course/${route(c.id)}"><div><h3>${esc(code(c))}</h3><p class="course-summary">${esc(shortDescription(c))}</p></div></a>`).join('') || '<div class="panel empty">No matching courses.</div>';
}
// Reusable resource row used on a Course Detail page.
function resourceRow(r) {
  const label = accessible(r) ? (owned(r) ? 'Your upload' : 'Purchased') : r.has_file ? `${r.price} pts` : 'File unavailable';
  return `<a class="resource" href="#resource/${route(r.id)}">${pdf}<div class="grow"><h3>${esc(r.title)}</h3><small>${esc(r.resource_type)}</small></div><span class="tag ${accessible(r)?'green':''}">${label}</span></a>`;
}
// Course Detail page: resources, filters, and upload link.
function coursePage(id) {
  const c = courseBy(id); if (!c) return notFound();
  return `<main class="main narrow"><div class="breadcrumb"><a href="#courses">Courses</a> / ${esc(code(c))}</div><div class="row between page-heading"><div><h1>${esc(code(c))}</h1><p>${esc(shortDescription(c))}</p></div><a class="btn dark" href="#upload/${route(c.id)}">Upload for this course</a></div><div class="section-title"><h2>Resources</h2><select id="resource-filter" aria-label="Filter resources" style="width:auto"><option>All</option><option>Purchased</option><option>My uploads</option></select></div><div class="search"><input id="resource-search" aria-label="Search resources" placeholder="Search resources" value="${esc(resourceQuery)}"></div><div class="panel list" id="resource-results"></div></main>`;
}
// Course Detail page: filters resources by text and ownership/purchase state.
function showResources(id) {
  const list = resources.filter(r => String(r.course_id) === String(id) && r.title.toLowerCase().includes(resourceQuery.toLowerCase()) && (typeFilter==='All' || typeFilter==='Purchased' && purchased(r) || typeFilter==='My uploads' && owned(r)));
  $('#resource-results').innerHTML = list.map(resourceRow).join('') || '<div class="empty">No resources to display.</div>';
}
// Resource Detail page: metadata, purchase button, or download link.
function resourcePage(id) {
  const r = resourceBy(id); if (!r) return notFound(); const c = courseBy(r.course_id);
  return `<main class="main narrow"><div class="breadcrumb"><a href="#courses">Courses</a> / <a href="#course/${route(r.course_id)}">${esc(code(c))}</a></div><section class="panel"><span class="tag">${esc(r.resource_type)}</span><h1 style="margin-top:22px">${esc(r.title)}</h1><p>${esc(r.description || '')}</p><div class="meta"><span>Course</span><strong>${esc(code(c))}</strong></div>${r.filename?`<div class="meta"><span>File</span><strong style="overflow-wrap:anywhere">${esc(r.filename)}</strong></div>`:''}<div class="section">${!r.has_file?'<p>No PDF has been attached to this resource yet.</p>':accessible(r)?`<span class="tag green">${owned(r)?'Your upload':'Purchased'}</span><p style="margin-top:16px">You can download this PDF without spending more points.</p>${CONFIG.mode==='demo'?'<button class="btn dark" id="download-button">Download PDF</button>':`<a class="btn dark" href="/resources/${route(r.id)}/download" target="_blank" rel="noopener">Download PDF</a>`}`:`<h2>${r.price} points</h2><p>Your balance: ${points} points</p><button id="purchase-button" class="btn dark" ${points<r.price?'disabled':''}>Purchase for ${r.price} points</button>${points<r.price?'<p style="margin-top:16px">Not enough points.</p>':''}`}</div><p id="resource-error" class="error" role="alert"></p></section></main>`;
}
// Upload page: course selection, PDF form, and permissions confirmation.
function uploadPage(id) {
  return `<main class="main narrow"><section class="panel"><h1>Upload a resource</h1><p>Share a PDF you created or have permission to share.</p><form id="upload-form"><div class="form-grid section"><label>Course<select name="course_id" required><option value="">Select a course</option>${courses.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(id)?'selected':''}>${esc(code(c))}</option>`).join('')}</select></label><label>Resource type<select name="resource_type">${['Notes','Study guide','Cheatsheet','Practice','Old exam'].map(t=>`<option>${t}</option>`).join('')}</select></label></div><label class="field">Title<input name="title" required maxlength="150" placeholder="Give your resource a clear title"></label><label class="field">Description (optional)<textarea name="description" rows="3" maxlength="3000" placeholder="What does this resource cover?"></textarea></label><label class="field">PDF file<div class="dropzone" id="dropzone"><input type="file" id="file" accept="application/pdf,.pdf" aria-label="Choose PDF"><p id="file-info" style="margin:14px 0 0">Choose or drop a PDF · Maximum 20 MB${CONFIG.mode==='demo'?' · Saved in this browser':''}</p></div></label><label class="check"><input type="checkbox" name="rights" required>I created this material or have the right to share it.</label><p id="upload-error" class="error" role="alert"></p><button class="btn dark" type="submit" ${courses.length?'':'disabled'}>Upload PDF</button></form></section></main>`;
}
// Upload page: validates and previews the selected PDF.
function selectFile(file) {
  currentFile = null;
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.pdf') || !file.size || file.size > 20*1024*1024) {
    $('#file').value=''; $('#file-info').textContent='Choose or drop a PDF · Maximum 20 MB';
    $('#upload-error').textContent='Choose a nonempty PDF no larger than 20 MB.'; return;
  }
  currentFile=file; $('#upload-error').textContent='';
  $('#file-info').textContent=`${file.name} · ${(file.size/1024/1024).toFixed(2)} MB · Ready to upload`;
}
// Shared fallback page for invalid routes or missing records.
function notFound() { return '<main class="main narrow"><div class="panel empty"><h1>Not found</h1><a href="#courses" class="btn">Back to courses</a></div></main>'; }
// Assistant page placeholder.
function assistant() { return '<main class="main narrow"><section class="panel"><h1>Assistant</h1><p>The AI assistant is not connected yet.</p></section></main>'; }
// Account dialog and logout handler.
function account() {
  $('#dialog-body').innerHTML=`<h2>${esc(user.name)}</h2><p>${esc(user.email)}</p><button id="logout-button" class="btn">Log out</button>`;
  $('#dialog').showModal();
  $('#logout-button').onclick=async e=>{
    e.target.disabled=true;
    try { await api('/logout',{method:'POST'}); sessionStorage.removeItem('studyswap-access-token'); user=null; courses=[]; resources=[]; purchases.clear(); points=0; $('#dialog').close(); go('login'); }
    catch(error){toast(error.message);e.target.disabled=false;}
  };
}
// Shared client-side router and page event binding.
function render() {
  let [page='home',rawId] = location.hash.slice(1).split('/'); let id;
  try { id=decodeURIComponent(rawId || ''); } catch { id=''; }
  if (!user) page='login'; else if (!page || page==='login' || page==='library') page='home';
  const pages={home,courses:coursesPage,course:()=>coursePage(id),resource:()=>resourcePage(id),upload:()=>uploadPage(id),assistant};
  $('#app').innerHTML=page==='login'?login():header(page)+(pages[page] || notFound)();
  document.title='StudySwap';
  $('#account-button')?.addEventListener('click',account);
  $('#download-button')?.addEventListener('click',()=>downloadDemoPDF(id));
  if(page==='login') {
    $('#login-form').onsubmit=async e=>{
      e.preventDefault(); if(busy)return; busy=true;
      const button=e.target.querySelector('button'); button.disabled=true; button.textContent='Logging in…';
      try {
        const form=new FormData(e.target);
        const result=await api('/login',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            email:String(form.get('email')).trim(),
            password:form.get('password')
          })
        });
        if(result.access_token) sessionStorage.setItem('studyswap-access-token',result.access_token);
        await loadData(); go('home');
      } catch(error) {
        if($('#login-error')) $('#login-error').textContent=error.message;
        else toast(error.message);
      } finally {
        busy=false; button.disabled=false;button.textContent='Log in';
      }
    };

    $('#signup-form').onsubmit=async e=>{
      e.preventDefault(); if(busy)return; busy=true;
      const button=e.target.querySelector('button'); button.disabled=true; button.textContent='Creating account…';
      try {
        const form=new FormData(e.target);
        const result=await api('/signup',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            name:String(form.get('name')).trim(),
            email:String(form.get('email')).trim(),
            password:form.get('password')
          })
        });
        e.target.reset();
        $('#signup-error').textContent=result.requires_email_confirmation
          ? 'Account created. Check your email to confirm your account, then log in.'
          : 'Account created successfully. You can now log in.';
      } catch(error) {
        if($('#signup-error')) $('#signup-error').textContent=error.message;
        else toast(error.message);
      } finally {
        busy=false; button.disabled=false;button.textContent='Sign up';
      }
    };
  }
  if(page==='courses') {
    showCourses(); $('#course-search').onsubmit=e=>{e.preventDefault();courseQuery=new FormData(e.target).get('q');showCourses();};
  }
  if(page==='course' && courseBy(id)) {
    $('#resource-filter').value=typeFilter; showResources(id);
    $('#resource-filter').onchange=e=>{typeFilter=e.target.value;showResources(id);};
    $('#resource-search').oninput=e=>{resourceQuery=e.target.value;showResources(id);};
  }
  if(page==='resource') $('#purchase-button')?.addEventListener('click',async e=>{
    const button=e.target; button.disabled=true;button.textContent='Purchasing…';
    try {
      await api(`/resources/${route(id)}/purchase`,{method:'POST'});
      await loadData();render();toast('Purchased. This course is now on Home.');
    } catch(error) { if($('#resource-error')) $('#resource-error').textContent=error.message;else toast(error.message); button.disabled=false;button.textContent='Retry purchase'; }
  });
  if(page==='upload') {
    currentFile=null; $('#file').onchange=e=>selectFile(e.target.files[0]);
    $('#dropzone').ondragover=e=>e.preventDefault();
    $('#dropzone').ondrop=e=>{e.preventDefault();if(!busy)selectFile(e.dataTransfer.files[0]);};
    $('#upload-form').onsubmit=async e=>{
      e.preventDefault();if(busy)return;
      if(!currentFile){$('#upload-error').textContent='Choose a PDF first.';return;}
      busy=true; const button=e.target.querySelector('button[type=submit]');button.disabled=true;button.textContent='Uploading…';
      const data=new FormData(e.target);data.set('file',currentFile);data.set('rights','true');
      try {
        const result=await api('/resources',{method:'POST',body:data});
        // Clear the submitted file before refreshing, so a refresh error cannot trigger resubmission.
        currentFile=null; e.target.reset();
        await loadData(); go('resource/'+route(result.id));toast(CONFIG.mode==='demo'?'PDF saved in this browser. Download it to check the original file.':'PDF uploaded successfully.');
      } catch(error){ if($('#upload-error')) $('#upload-error').textContent=error.message; else toast(error.message); }
      finally {busy=false;button.disabled=false;button.textContent='Upload PDF';}
    };
  }
}
// Frontend-only demonstration. No Python server is required in demo mode.
// When the backend is ready, serve this HTML from FastAPI and set mode to 'api'.
// In API mode, /login calls the route declared in routers/auth.py (not auth.py as a URL).
const params = new URLSearchParams(location.search);
const CONFIG = {
  mode: params.get('mode') === 'api' ? 'api' : 'demo',
  apiBase: params.get('apiBase') || 'http://127.0.0.1:8000'
};
// Demo data and formatting helpers.
const shortDescription = c => { const text=String(c?.description || 'Browse notes and study resources.');return text.length>105?text.slice(0,102)+'…':text; };
const DEMO_USER = {id:'demo-user-1',name:'StudySwap Test User',email:'test@wisc.edu'};
const DEMO_COURSES = [
 {id:1,subject:'STAT',course_number:'340',title:'Data Science Modeling II',description:'Regression, resampling, and model selection.'},
 {id:2,subject:'COMP SCI',course_number:'564',title:'Database Management Systems',description:'SQL, relational databases, and database design.'},
 {id:3,subject:'MATH',course_number:'340',title:'Linear Algebra',description:'Matrices, vector spaces, and eigenvalues.'},
 {id:4,subject:'L I S',course_number:'461',title:'Data and Algorithms: Ethics and Policy',description:'Privacy, fairness, and the use of data.'}
];
function demoPDF(label) {
  // A real, downloadable one-page PDF clearly marked as demonstration content.
  const clean=String(label).replace(/[^a-zA-Z0-9 .-]/g,'');
  const stream=`BT /F1 20 Tf 50 760 Td (StudySwap - DEMO RESOURCE) Tj 0 -40 Td /F1 14 Tf (${clean}) Tj 0 -35 Td (This PDF demonstrates the purchase and download interface.) Tj 0 -25 Td (It is not actual course material.) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text='%PDF-1.4\n', offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(text.length);text+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const start=text.length;text+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new Blob([text],{type:'application/pdf'});
}
let databasePromise;
// Demo persistence layer: IndexedDB database initialization.
function demoDB() {
 if(!databasePromise) databasePromise=new Promise((resolve,reject)=>{
  const request=indexedDB.open('StudySwap-Frontend-Demo-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('data');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(new Error('Browser storage is unavailable. Open this HTML in a normal Chrome window.'));
  request.onblocked=()=>reject(new Error('Close other StudySwap tabs and try again.'));
 });
 return databasePromise;
}
// Demo persistence layer: executes a read/write IndexedDB transaction.
async function demoTransaction(action) {
 const database=await demoDB();
 return new Promise((resolve,reject)=>{
  const transaction=database.transaction('data','readwrite'),store=transaction.objectStore('data');let result,error;
  transaction.oncomplete=()=>resolve(result);
  transaction.onabort=()=>reject(error || new Error('Could not save to browser storage. Check available storage space.'));
  transaction.onerror=()=>{};
  const request=store.get('state');
  request.onsuccess=()=>{
   try {
    let state=request.result;
    if(!state) {
     const names=['Regression summary','SQL joins practice','Matrices review','Privacy discussion notes'];
     state={points:120,purchases:[],nextId:5,courses:DEMO_COURSES,resources:DEMO_COURSES.map((c,i)=>({id:i+1,course_id:c.id,title:names[i],resource_type:'Notes',description:'Demo resource for testing the interface.',owner_id:'sample-uploader',price:20,has_file:true,filename:`demo-${i+1}.pdf`}))};
     state.resources.forEach(r=>store.put(demoPDF(r.title),'file:'+r.id));
    }
    result=action(state,store);store.put(state,'state');
   }catch(e){error=e;transaction.abort();}
  };
 });
}
// Demo authentication state.
function demoLoggedIn() { return sessionStorage.getItem('studyswap-demo-login')==='yes'; }
// Demo API implementation for login, courses, resources, purchase, and upload flows.
async function demoAPI(path,options={}) {
 if(path==='/login') {
  const input=JSON.parse(options.body);
  if(input.email.trim().toLowerCase()!==DEMO_USER.email || input.password!=='studyswap123')throw new Error('Demo login: test@wisc.edu / studyswap123');
  await demoTransaction(()=>null);sessionStorage.setItem('studyswap-demo-login','yes');return {success:true,user:DEMO_USER};
 }
 if(path==='/logout'){sessionStorage.removeItem('studyswap-demo-login');return {success:true};}
 if(!demoLoggedIn())throw new Error('Please log in.');
 if(path==='/resources' && options.method==='POST') {
  const form=options.body,file=form.get('file');
  if(!(file instanceof Blob) || file.size===0 || file.size>20*1024*1024 || !file.name.toLowerCase().endsWith('.pdf'))throw new Error('Choose a PDF no larger than 20 MB.');
  if(await file.slice(0,5).text()!=='%PDF-')throw new Error('The selected file is not a PDF.');
  const buffer=await file.arrayBuffer();
  // Fingerprint is optional on older file:// browsers; the file bytes are always saved.
  const hash=crypto.subtle?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(x=>x.toString(16).padStart(2,'0')).join(''):null;
  return demoTransaction((state,store)=>{
   if(!state.courses.some(c=>String(c.id)===form.get('course_id')))throw new Error('Select a course.');
   if(!String(form.get('title')||'').trim())throw new Error('Enter a title.');
   if(form.get('rights')!=='true')throw new Error('Confirm your permission to share this PDF.');
   if(hash && state.resources.some(r=>r.hash===hash && r.owner_id===DEMO_USER.id))throw new Error('You have already uploaded this PDF.');
   const id=state.nextId++;
   state.resources.push({id,course_id:Number(form.get('course_id')),title:String(form.get('title')).trim(),resource_type:form.get('resource_type'),description:form.get('description')||'',owner_id:DEMO_USER.id,price:20,has_file:true,filename:file.name,size_bytes:file.size,hash});
   store.put(new Blob([buffer],{type:'application/pdf'}),'file:'+id);return {id};
  });
 }
 return demoTransaction(state=>{
  if(path==='/me')return {user:DEMO_USER,points:state.points,purchases:state.purchases};
  if(path==='/courses')return state.courses;
  if(path==='/resources')return state.resources;
  const match=path.match(/^\/resources\/(\d+)\/purchase$/);
  if(match && options.method==='POST') {
   const resource=state.resources.find(r=>r.id===Number(match[1]));
   if(!resource?.has_file)throw new Error('Resource not found.');
   if(resource.owner_id!==DEMO_USER.id && !state.purchases.some(p=>p.resource_id===resource.id)) {
    if(state.points<resource.price)throw new Error('Not enough points.');
    state.points-=resource.price;state.purchases.push({resource_id:resource.id,points_paid:resource.price});
   }
   return {success:true,points:state.points};
  }
  throw new Error('This action is not available in the frontend demo.');
 });
}
// Resource Detail page: downloads a demo PDF from IndexedDB.
async function downloadDemoPDF(id) {
 try {
  const r=resourceBy(id);if(!demoLoggedIn() || !r || !accessible(r))throw new Error('Purchase this resource first.');
  const database=await demoDB();
  const blob=await new Promise((resolve,reject)=>{const tx=database.transaction('data');const req=tx.objectStore('data').get('file:'+r.id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('Could not read the saved PDF.'));});
  if(!blob)throw new Error('This PDF is no longer in browser storage.');
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=r.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(error){toast(error.message);}
}

// Shared application startup and hash-route refresh.
window.addEventListener('hashchange',render);
async function start() {
  render();
  if(location.protocol==='file:' && CONFIG.mode==='api') return;
  try {await loadData();render();}
  catch(error) {user=null;render();if(!/log in|session expired/i.test(error.message)) $('#login-error').textContent=error.message;}
}
start();
