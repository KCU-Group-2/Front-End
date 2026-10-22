const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user = null, courses = [], resources = [];
let courseQuery = '', resourceQuery = '', busy = false;
// Shared data helpers used by multiple pages.
const courseBy = id => courses.find(c => String(c.id) === String(id));
const resourceBy = id => resources.find(r => String(r.id) === String(id));
const code = c => c ? (c.code || `${c.subject || ''} ${c.course_number ?? ''}`.trim()) : 'Unknown course';
const route = id => encodeURIComponent(String(id));
// Shared UI notification and navigation helpers.
function toast(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => $('#toast').style.display = 'none', 5000); }
function go(path) { if (location.hash === '#' + path) render(); else location.hash = path; }
// Shared API layer: real FastAPI requests only.
async function api(path, options = {}) {
  if (location.protocol === 'file:') throw new Error('Open this frontend at http://localhost:3000/studyswap.html.');
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
      sessionStorage.removeItem('studyswap-user');
      user = null;
      render();
    }
    const detail = Array.isArray(data.detail) ? data.detail.map(x => x.msg).join(' · ') : data.detail;
    throw new Error(detail || 'The request could not be completed.');
  }
  return data;
}

/**
 * Data Loading Section **From API
 * 
 */
// API origin is configured in the HTML file.
const CONFIG = { apiBase: (window.STUDYSWAP_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '') };
const shortDescription = c => String(c?.title || '');
function listData(data, key) {
  const list = Array.isArray(data) ? data : data?.[key];
  if (!Array.isArray(list)) throw new Error(`Invalid ${key} response from the server.`);
  return list;
}
function setProfile(data) {
  const profile = data.user || data;
  if (profile.id == null) throw new Error('The server did not return a user ID.');
  user = {...profile, name: profile.name || profile.user_metadata?.name || profile.email || 'Account'};

}
async function refreshResources(courseId) {
  const rows = listData(await api('/courses/' + route(courseId) + '/resources'), 'resources');
  resources = resources.filter(r => String(r.course_id) !== String(courseId)).concat(rows);
}

// Shared application header shown on authenticated pages.
function header(page) {
  const coursesActive = ['courses', 'course', 'resource', 'edit'].includes(page);

  return `
    <header class="header">
      <a class="brand" href="#home">StudySwap</a>

      <nav class="nav">
        <a href="#home" class="${page === 'home' ? 'active' : ''}">Home</a>
        <a href="#courses" class="${coursesActive ? 'active' : ''}">Courses</a>
        <a href="#upload" class="${page === 'upload' ? 'active' : ''}">Upload</a>
      </nav>

      <div class="account">
        <button class="btn" id="account-button">${esc(user.name)}</button>
      </div>
    </header>
  `;
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
        <p>
          Don't have an account?
          <a href="#signup">Create a new account</a>
        </p>
      </section>
    </main>
  `;
}
// Reusable course card.
function courseCard(c) {
  return `<a class="panel course-mini" href="#course/${route(c.id)}"><h3>${esc(code(c))}</h3><p class="course-summary">${esc(shortDescription(c))}</p></a>`;
}

// 회원가입 페이지
function signupPage(){
  return `
    <main class="main narrow signup-page">
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

        <p class="field">
          Already have an account?
          <a href="#login">Log in</a>
        </p>
      </form>
    </main>
  `;
}

// Reusable course card used on the Home page.
function home() {
  const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);

  const recentResources = resources
    .filter(r => new Date(r.created_at).getTime() >= twoDaysAgo)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3);

  return `
    <main class="main home-page">

      <section class="home-hero">
        <div class="home-hero-copy">
          <p class="eyebrow">UW–MADISON 한인 학습 커뮤니티</p>

          <h1>
            Study<span>Swap</span>
          </h1>

          <p class="home-intro">
            StudySwap은 UW–Madison 학생들이 수업 노트, 스터디 가이드,
            기출자료 등 학습 자료를 찾고 공유할 수 있는 플랫폼입니다.
          </p>

          <div class="home-actions">
            <a class="btn dark home-primary" href="#courses">
              강의 찾기
            </a>

            <a class="btn home-secondary" href="#upload">
              자료 업로드
            </a>
          </div>
        </div>

        <div class="home-hero-art">
          <div class="book-stack">
            <div class="book">NOTES</div>
            <div class="book">STUDY GUIDES</div>
            <div class="book">OLD EXAMS</div>
          </div>

          <div class="study-icon">
            <img src="pngegg.png" alt="Bucky Badger">
          </div>
        </div>
      </section>

      <section class="home-feature-grid">

        <a href="#courses" class="home-feature-card">
          <div class="feature-icon">⌕</div>

          <div>
            <h3>강의 둘러보기</h3>
            <p>
              수강 중인 강의를 검색하고 공유된 학습 자료를 확인해보세요.
            </p>
          </div>

        </a>

        <a href="#upload" class="home-feature-card">
          <div class="feature-icon">↑</div>

          <div>
            <h3>자료 업로드하기</h3>
            <p>
              강의 노트, 스터디 가이드, 기출자료 등을 다른 학생들과 공유해보세요.
            </p>
          </div>

        </a>

        <div class="home-feature-card">
          <div class="feature-icon">♡</div>

          <div>
            <h3>함께 공부하기</h3>
            <p>
              유용한 자료를 공유하고 필요한 자료를 찾아 더 효율적으로 공부해보세요.
            </p>
          </div>
        </div>

      </section>

      <section class="home-bottom-grid">

        <div class="panel recent-panel">

          <div class="section-heading">
            <h2>최근 등록된 자료</h2>
            <a href="#courses">전체 보기 →</a>
          </div>

          ${
            recentResources.length
              ? recentResources.map(r => `
                  <a
                    class="recent-resource-row"
                    href="#resource/${route(r.id)}"
                  >
                    <div>
                      <strong>${esc(r.title)}</strong>
                      <p>${esc(r.course || '')}</p>
                    </div>

                    <span class="tag">
                      ${
                        r.resource_type === 'Old exam'
                          ? '기출문제'
                          : r.resource_type === 'Study guide'
                            ? '스터디 가이드'
                            : r.resource_type === 'Notes'
                              ? '강의 노트'
                              : r.resource_type === 'Practice materials'
                                ? '연습 자료'
                                : r.resource_type === 'PPT'
                                  ? 'ppt'
                                  : r.resource_type === 'Syllabus'
                                    ? 'Syllabus'
                                    : r.resource_type === 'Reading material'
                                      ? '읽기자료'
                                      : r.resource_type === 'Lab'
                                        ? 'Lab 자료'
                                         : esc(r.resource_type || '자료')
                      }
                    </span>
                  </a>
                `).join('')
              : `<p class="muted">아직 등록된 자료가 없습니다.</p>`
          }

        </div>

      </section>

    </main>
  `;
}

// Courses page: search form and results container.
function coursesPage() {
  return `
    <main class="main narrow">

      <div class="page-heading">
        <h1>강의 찾기</h1>
        <p class="muted">원하는 강의를 검색하거나 새 강의를 추가해보세요.</p>
      </div>

      <div class="row" style="gap:12px; align-items:stretch;">

        <form
          id="course-search"
          class="search"
          style="flex:1; margin:0;"
        >
          <span aria-hidden="true">⌕</span>

          <input
            name="q"
            aria-label="Search courses"
            placeholder="Search by course code or title"
            value="${esc(courseQuery)}"
          >

          <button class="btn dark" type="submit">
            Search
          </button>
        </form>

        <button
          id="toggle-add-course"
          class="btn"
          type="button"
          style="white-space:nowrap;"
        >
          + 강의 추가
        </button>

      </div>

      <section
        id="add-course-section"
        class="panel section"
        style="display:none; margin-top:16px;"
      >
        <div class="row between">
          <div>
            <h2>새 강의 추가</h2>
            <p class="muted">찾는 강의가 없다면 직접 추가할 수 있습니다.</p>
          </div>
        </div>

        <form id="add-course-form">

          <div class="form-grid section">

            <label>
              Subject
              <input
                name="subject"
                placeholder="STAT"
                required
              >
            </label>

            <label>
              Course number
              <input
                name="course_number"
                placeholder="340"
                required
              >
            </label>

          </div>

          <label class="field">
            Course title
            <input
              name="title"
              placeholder="Data Science Modeling II"
              required
            >
          </label>

          <label class="field">
            Description
            <textarea
              name="description"
              rows="3"
              placeholder="Brief course description"
            ></textarea>
          </label>

          <p
            id="course-create-error"
            class="error"
          ></p>

          <button class="btn dark" type="submit">
            Add course
          </button>

        </form>
      </section>

      <p class="muted" id="result-summary"></p>
      <div id="course-results"></div>

    </main>
  `;
}

// Courses page: filters and renders matching courses.
let searchVersion = 0;
async function showCourses() {
  const version = ++searchVersion;
  const node = $('#course-results'), summary = $('#result-summary');
  summary.textContent = 'Searching…';
  try {
    const list = listData(await api('/courses/search?q=' + encodeURIComponent(courseQuery)), 'courses');
    if (version !== searchVersion || !node.isConnected) return;
    for (const c of list) { const i = courses.findIndex(x => String(x.id) === String(c.id)); if (i < 0) courses.push(c); else courses[i] = c; }
    summary.textContent = `${list.length} courses`;
    node.innerHTML = list.map(c => `<a class="panel result course-result" href="#course/${route(c.id)}"><div><h3>${esc(code(c))}</h3><p>${esc(c.title)}</p></div></a>`).join('') || '<div class="panel empty">No matching courses.</div>';
  } catch (error) { if (version === searchVersion && node.isConnected) { summary.textContent = error.message; node.innerHTML = ''; } }
}

// Reusable resource row used on a Course Detail page.
function resourceRow(r) {
  return `<a class="resource" href="#resource/${route(r.id)}"><div class="grow"><h3>${esc(r.title)}</h3><small>${esc(r.resource_type)}</small></div><span>View →</span></a>`;
}
// Course Detail page: resources, filters, and upload link.
function coursePage(id) {
  const c = courseBy(id); if (!c) return notFound();
  return `<main class="main narrow"><div class="breadcrumb"><a href="#courses">Courses</a> / ${esc(code(c))}</div><div class="row between page-heading"><div><h1>${esc(code(c))}</h1><p>${esc(shortDescription(c))}</p></div><a class="btn dark" href="#upload/${route(c.id)}">Upload for this course</a></div><div class="section-title"><h2>Resources</h2><select id="resource-filter" aria-label="Filter resources" style="width:auto"><option>All</option></select></div><div class="search"><input id="resource-search" aria-label="Search resources" placeholder="Search resources" value="${esc(resourceQuery)}"></div><div class="panel list" id="resource-results"></div></main>`;
}

// Course Detail page: filters the fetched course resources by title.
// 특정 수업에 등록된 자료들을 list 형식으로 저장한 뒤 인터페이스에 나열함
function showResources(id) {
  const list = resources.filter(r => String(r.course_id) === String(id) && String(r.title || '').toLowerCase().includes(resourceQuery.toLowerCase()));
  $('#resource-results').innerHTML = list.map(resourceRow).join('') || '<div class="empty">No resources to display.</div>';
}

// Resource Detail page: metadata, purchase button, or download link.
function resourcePage(id) {
  const r = resourceBy(id); if (!r) return notFound();
  return `<main class="main narrow"><div class="breadcrumb"><a href="#course/${route(r.course_id)}">${esc(code(courseBy(r.course_id)))}</a></div><section class="panel"><span class="tag">${esc(r.resource_type)}</span><h1 class="section">${esc(r.title)}</h1><p>${esc(r.description)}</p><div class="row"><a class="btn" href="#edit/${route(r.id)}">Edit</a><button class="btn redtext" id="delete-button">Delete</button></div><p id="resource-error" class="error" role="alert"></p></section></main>`;
}
function resourceForm(id, editing = false) {
  const r = editing ? resourceBy(id) : null;
  if (editing && !r) return notFound();
  const selected = r?.course_id ?? id;
  const types = [...new Set(['Notes','Study guide','Syllabus','Cheatsheet','Practice exam','Old exam','PPT','Reading material','Lab',...(r?.resource_type ? [r.resource_type] : [])])];
return `
  <main class="main narrow">

    <div class="page-heading">
      <h1>${editing ? 'Edit resource' : '자료 업로드'}</h1>
      <p>${editing ? '학습 자료의 정보를 수정해주세요.' : '공유할 학습 자료의 정보를 입력해주세요.'}</p>
    </div>

    <section class="panel">
      <form id="resource-form">

        <label class="field">
          Course
          <select name="course_id" required>
            <option value="">Select a course</option>
            ${courses.map(c => `
              <option
                value="${esc(c.id)}"
                ${String(c.id) === String(selected) ? 'selected' : ''}
              >
                ${esc(code(c))} — ${esc(c.title)}
              </option>
            `).join('')}
          </select>
        </label>

        <label class="field">
          Type
          <select name="resource_type">
            ${types.map(t => `
              <option ${t === r?.resource_type ? 'selected' : ''}>
                ${esc(t)}
              </option>
            `).join('')}
          </select>
        </label>

        <label class="field">
          Title
          <input
            name="title"
            required
            maxlength="150"
            value="${esc(r?.title || '')}"
          >
        </label>

        <label class="field">
          Description
          <textarea
            name="description"
            rows="4"
          >${esc(r?.description || '')}</textarea>
        </label>

        <p id="form-error" class="error" role="alert"></p>

        <button class="btn dark field" type="submit">
          ${editing ? 'Save changes' : 'Create resource'}
        </button>

      </form>
    </section>

  </main>
`;}
const editPage = id => resourceForm(id, true);
const uploadPage = id => resourceForm(id);
// Shared fallback page for invalid routes or missing records.
function notFound() { return '<main class="main narrow"><div class="panel empty"><h1>Not found</h1><a href="#courses" class="btn">Back to courses</a></div></main>'; }
// Assistant page placeholder.
function assistant() { return '<main class="main narrow"><section class="panel"><h1>Assistant</h1><p>The AI assistant is not connected yet.</p></section></main>'; }
// Account dialog and logout handler.
function account() {
  $('#dialog-body').innerHTML = `<h2>${esc(user.name)}</h2><p>${esc(user.email)}</p><button class="btn" id="logout-button">Log out</button>`;
  $('#dialog').showModal();
  $('#logout-button').onclick = () => {
    sessionStorage.removeItem('studyswap-access-token'); sessionStorage.removeItem('studyswap-user');
    user = null; courses = []; resources = []; $('#dialog').close(); go('login');
  };
}

// Route version prevents an older response from replacing a newer screen.
let renderVersion = 0;
function showError(selector, error) {
  const node = $(selector);
  if (node) node.textContent = error.message; else toast(error.message);
}
function jsonRequest(method, data) {
  return {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)};
}
async function render() {
  const version = ++renderVersion;
  let [page = 'home', rawId = ''] = location.hash.slice(1).split('/');
  let id; try { id = decodeURIComponent(rawId); } catch { id = ''; }
  if (!user && !['login', 'signup'].includes(page)) page = 'login';
  if (user && ['login', 'signup', ''].includes(page)) page = 'home';
  if (['login', 'signup'].includes(page)) {
    $('#app').innerHTML = page === 'login' ? login() : signupPage();
    const form = $(page === 'login' ? '#login-form' : '#signup-form');
    form.onsubmit = async event => {
      event.preventDefault(); if (busy) return;
      busy = true; const button = form.querySelector('button'); button.disabled = true;
      const input = Object.fromEntries(new FormData(form));
      input.email = input.email.trim().toLowerCase();
      if (input.name) input.name = input.name.trim();
      try {
        const result = await api('/' + page, jsonRequest('POST', input));
        if (page === 'signup') {
          form.reset();
          showError('#signup-error', {message: result.requires_email_confirmation ? 'Account created. Confirm your email, then log in.' : 'Account created. You can now log in.'});
        } else {
          if (!result.access_token || !result.user?.id) throw new Error('Invalid login response.');
          sessionStorage.setItem('studyswap-access-token', result.access_token);
          setProfile(result);
          sessionStorage.setItem('studyswap-user', JSON.stringify(result.user));
          go('home');
        }
      } catch (error) { showError('#' + page + '-error', error); }
      finally { busy = false; button.disabled = false; }
    };
    return;
  }
  $('#app').innerHTML = header(page) + '<main class="main narrow"><p>Loading…</p></main>';
  $('#account-button').onclick = account;
  try {
  if (['home', 'courses', 'upload', 'edit', 'course', 'resource'].includes(page)) {
    courses = listData(await api('/courses'), 'courses');
  }

  if (page === 'home') {
    resources = listData(await api('/resources'), 'resources');
  }

  if (page === 'course') await refreshResources(id);

  if (['resource', 'edit'].includes(page)) {
    const rows = listData(
      await api('/resources/' + route(id)),
      'resources'
    );

    resources = resources
      .filter(r => String(r.id) !== String(id))
      .concat(rows);
  }

  if (version !== renderVersion) return;


    const pages = {home, courses: coursesPage, course: () => coursePage(id), resource: () => resourcePage(id), upload: () => uploadPage(id), edit: () => editPage(id)};
    $('#app').innerHTML = header(page) + (pages[page] || notFound)();
    $('#account-button').onclick = account;

    if (page === 'courses') {
      showCourses();

      const toggleAddCourse = $('#toggle-add-course');
      const addCourseSection = $('#add-course-section');

      toggleAddCourse.onclick = () => {
        const isOpen = addCourseSection.style.display === 'block';

        addCourseSection.style.display = isOpen ? 'none' : 'block';

        if (isOpen) {
           toggleAddCourse.textContent = '+ 강의 추가';
           toggleAddCourse.classList.remove('active-add');
        } else {
          toggleAddCourse.textContent = '접기';
          toggleAddCourse.classList.add('active-add');
        }
    };
      
      $('#course-search').onsubmit = e => {
         e.preventDefault();
         courseQuery = new FormData(e.target).get('q');
         showCourses();
      };

      $('#add-course-form').onsubmit = async e => {
        e.preventDefault();

        if (busy) return;
        busy = true;

        const button = e.target.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = 'Adding…';

        try {
          const form = new FormData(e.target);

          const result = await api('/courses', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              subject: String(form.get('subject')).trim(),
              course_number: String(form.get('course_number')).trim(),
              title: String(form.get('title')).trim(),
              description: String(form.get('description') || '').trim()
          })
        });

        const createdCourse = Array.isArray(result) ? result[0] : result;

        courses = await api('/courses');

        toast('Course added successfully.');

        if (createdCourse?.id) {
          go('course/' + route(createdCourse.id));} 
          else {render();}

      } catch(error) {
        $('#course-create-error').textContent = error.message;
      } finally {
        busy = false;
        button.disabled = false;
        button.textContent = 'Add course';   
      }
    };
  }

    
    if (page === 'course' && courseBy(id)) {
      showResources(id);
      $('#resource-search').oninput = e => {resourceQuery = e.target.value; showResources(id);};
    }
    if ($('#resource-form')) $('#resource-form').onsubmit = e => saveResource(e, page === 'edit' ? id : null);
    if ($('#delete-button')) $('#delete-button').onclick = async e => {
      if (busy || !window.confirm('Delete this resource? This cannot be undone.')) return;
      busy = true; const button = e.currentTarget; button.disabled = true;
      const courseId = resourceBy(id).course_id;
      try {
        await api('/resources/' + route(id), {method: 'DELETE'});
        resources = resources.filter(r => String(r.id) !== String(id));
        go('course/' + route(courseId)); toast('Resource deleted.');
      } catch (error) {showError('#resource-error', error);}
      finally {busy = false; button.disabled = false;}
    };
  } catch (error) {
    if (version !== renderVersion) return;
    $('#app').innerHTML = header(page) + `<main class="main narrow"><p class="error" role="alert">${esc(error.message)}</p><button class="btn" id="retry-button">Retry</button></main>`;
    $('#account-button').onclick = account; $('#retry-button').onclick = render;
  }
}
async function saveResource(event, id) {
  event.preventDefault(); if (busy) return;
  const form = event.target, data = new FormData(form);
  const course = courseBy(data.get('course_id'));
  if (!course || !String(data.get('title')).trim()) {showError('#form-error', {message: 'Select a course and enter a title.'}); return;}
  const payload = {title: String(data.get('title')).trim(), course: code(course), resource_type: data.get('resource_type'), description: String(data.get('description') || '').trim(), course_id: Number(course.id)};
  busy = true; const button = form.querySelector('button[type=submit]'); button.disabled = true;
  try {
    await api(id == null ? '/resources' : '/resources/' + route(id), jsonRequest(id == null ? 'POST' : 'PUT', payload));
    // Navigate before the GET refresh: a refresh failure must not resubmit a successful write.
    form.reset(); go('course/' + route(course.id));
    toast(id == null ? 'Resource created.' : 'Changes saved.');
  } catch (error) {showError('#form-error', error);}
  finally {busy = false; button.disabled = false;}
}
window.addEventListener('hashchange', render);
// Restore only the real login response; the backend must enforce authorization.
try {
  const saved = JSON.parse(sessionStorage.getItem('studyswap-user') || 'null');
  if (saved?.id && sessionStorage.getItem('studyswap-access-token')) setProfile({user: saved});
} catch {sessionStorage.removeItem('studyswap-user');}
render().catch(console.error);