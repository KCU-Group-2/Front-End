const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user = null, courses = [], resources = [];
let requestRows = [], requestLoadError = '', uploadRequest = null;
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
  return `<main class="main narrow"><div class="breadcrumb"><a href="#courses">Courses</a> / ${esc(code(c))}</div><div class="row between page-heading"><div><h1>${esc(code(c))}</h1><p>${esc(shortDescription(c))}</p></div><a class="btn dark" href="#upload/${route(c.id)}">Upload for this course</a></div><div class="section-title"><h2>Resources</h2><select id="resource-filter" aria-label="Filter resources" style="width:auto"><option>All</option></select></div><div class="search"><input id="resource-search" aria-label="Search resources" placeholder="Search resources" value="${esc(resourceQuery)}"></div><div class="panel list" id="resource-results"></div>${requestBoard()}</main>`;
}

// Course-specific request board. User identities remain anonymous as in the API.
function requestBoard() {
  return `<section class="section request-board" aria-labelledby="requests-heading">
    <div class="section-title"><h2 id="requests-heading">자료 요청 게시판</h2></div>
    <p>필요한 자료를 요청하거나, 다른 학생의 요청에 자료를 올려주세요.</p>
    <form id="request-form" class="panel">
      <label class="field">요청 내용<textarea name="content" required rows="3" placeholder="Midterm 2 practice problems 있으신 분 올려주세요."></textarea></label>
      <p id="request-error" class="error" role="alert"></p>
      <button class="btn dark" type="submit">요청 등록</button>
    </form>
    <div class="request-toolbar"><label>상태 <select id="request-filter"><option value="all">전체</option><option value="open">요청 중</option><option value="fulfilled">해결됨</option></select></label></div>
    <div id="request-results" aria-live="polite"></div>
  </section>`;
}
async function loadRequests(courseId) {
  try {
    requestRows = listData(await api('/courses/' + route(courseId) + '/requests'), 'requests');
    requestLoadError = '';
  } catch (error) { requestRows = []; requestLoadError = error.message; }
}
function showRequests() {
  const node = $('#request-results');
  if (!node) return;
  if (requestLoadError) {
    node.innerHTML = `<p class="error" role="alert">${esc(requestLoadError)}</p><button class="btn" id="retry-requests">다시 불러오기</button>`;
    $('#retry-requests').onclick = () => render();
    return;
  }
  const filter = $('#request-filter').value;
  const rows = requestRows.filter(r => filter === 'all' || (filter === 'fulfilled' ? r.status === 'fulfilled' : r.status !== 'fulfilled'));
  node.innerHTML = rows.map(r => {
    const done = r.status === 'fulfilled';
    const date = new Date(r.created_at);
    return `<article class="panel request-card">
      <div class="row between wrap"><span class="tag ${done ? 'green' : 'amber'}">${done ? '해결됨' : '요청 중'}</span><small>${esc(r.requester || 'Anonymous')}${Number.isNaN(date.getTime()) ? '' : ' · ' + esc(date.toLocaleDateString())}</small></div>
      <p class="request-content">${esc(r.content)}</p>
      ${done ? (r.fulfilled_resource_id != null ? `<a class="btn" href="#resource/${route(r.fulfilled_resource_id)}">업로드된 자료 보기</a>` : '<small>연결된 자료가 없습니다.</small>') : `<a class="btn dark" href="#upload/${route(r.course_id)}/${route(r.id)}">자료 올리기</a>`}
    </article>`;
  }).join('') || '<div class="panel empty">해당하는 요청이 없습니다.</div>';
}
function bindRequests(courseId) {
  showRequests();
  $('#request-filter').onchange = showRequests;
  $('#request-form').onsubmit = async e => {
    e.preventDefault();
    const form = e.currentTarget, button = form.querySelector('button');
    if (button.disabled) return;
    const content = String(new FormData(form).get('content') || '').trim();
    if (!content) { showError('#request-error', new Error('요청 내용을 입력해주세요.')); return; }
    button.disabled = true;
    $('#request-error').textContent = '';
    try {
      await api('/courses/' + route(courseId) + '/requests', jsonRequest('POST', {content}));
      form.reset();
      await loadRequests(courseId);
      if ($('#request-form') === form) showRequests();
      toast('자료 요청이 등록되었습니다.');
    } catch (error) { if ($('#request-form') === form) showError('#request-error', error); }
    finally { button.disabled = false; }
  };
}

// Course Detail page: filters the fetched course resources by title.
// 특정 수업에 등록된 자료들을 list 형식으로 저장한 뒤 인터페이스에 나열함
function showResources(id) {
  const list = resources.filter(r => String(r.course_id) === String(id) && String(r.title || '').toLowerCase().includes(resourceQuery.toLowerCase()));
  $('#resource-results').innerHTML = list.map(resourceRow).join('') || '<div class="empty">No resources to display.</div>';
}

// Resource Detail page: metadata, purchase button, or download link.
function resourcePage(id) {
  const r = resourceBy(id);
  if (!r) return notFound();

  return `
    <main class="main narrow">

      <div class="breadcrumb">
        <a href="#course/${route(r.course_id)}">
          ${esc(code(courseBy(r.course_id)))}
        </a>
      </div>

      <section class="panel">
        <span class="tag">${esc(r.resource_type)}</span>

        <h1 class="section">
          ${esc(r.title)}
        </h1>

        <p>${esc(r.description || '')}</p>

        <p class="muted">
          Uploaded by Anonymous
        </p>

        <div class="row">

          ${
            r.has_pdf
              ? `
                <button
                  class="btn"
                  id="open-pdf-button"
                  type="button"
                >
                  Open PDF
                </button>
              `
              : ''
          }

          <a
            class="btn"
            href="#edit/${route(r.id)}"
          >
            Edit
          </a>

          <button
            class="btn redtext"
            id="delete-button"
          >
            Delete
          </button>

        </div>

        <p id="resource-error" class="error" role="alert"></p>
      </section>


      <div class="chatbot-wrapper">
        <button
          type="button"
          id="chatbot-toggle"
          class="chatbot-toggle"
          aria-label="챗봇 열기"
        >
          <span class="chatbot-face">
            <span class="chatbot-eye"></span>
            <span class="chatbot-eye"></span>
            <span class="chatbot-smile"></span>
          </span>

          <span class="chatbot-badge">Ask Me!</span>
        </button>

      <section
        id="chatbot-window"
        class="chatbot-window"
        hidden
      >
        <div id="chatbot-resize" class="chatbot-resize"></div>

        <div class="chatbot-header">
          <div>
            <strong>Ask Me!</strong>
            <small>해당 자료를 기반으로 답변합니다.</small>
          </div>

          <div class="chatbot-actions">
            <button
              type="button"
              id="chatbot-reset"
              class="chatbot-close chatbot-reset"
              aria-label="대화 초기화"
              title="대화 초기화"
            >
              ↻
            </button>

            <button
              type="button"
              id="chatbot-close"
              class="chatbot-close"
              aria-label="Close chatbot"
            >
              ✕
            </button>
          </div>
        </div> 
        
        <div id="chat-messages" class="chat-messages">
          <div class="chat-message bot-message intro-message">
            이 자료에 대해 궁금한 내용을 질문해보세요!
          </div>
        </div>

        <form id="chat-form" class="chat-form">
          <textarea
            id="chat-input"
            name="question"
            rows="1"
            maxlength="1000"
            placeholder="무엇이 궁금한가요?"
            autocomplete="off"
            required
          ></textarea>

          <button
            class="chat-send"
            type="submit"
            aria-label="Send question"
          >
            ↑
          </button>
        </form>

        <p class="chat-disclaimer">AI 답변은 부정확할 수 있어요 · Enter 전송 / Shift+Enter 줄바꿈</p>

      </section>

    </div>

  </main>
  `;
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

    ${!editing && uploadRequest ? `<aside class="panel request-context"><strong>자료 요청에 답변하기 · ${esc(code(courseBy(uploadRequest.course_id)))}</strong><p class="request-content">${esc(uploadRequest.content)}</p><p>PDF 업로드 후 이 요청이 해결됨으로 표시됩니다.</p><a href="#course/${route(uploadRequest.course_id)}">요청 게시판으로 돌아가기</a></aside>` : ''}
    <section class="panel">
      <form id="resource-form">
        <p class="muted">업로더는 다른 사용자에게 Anonymous로 표시됩니다. 관리자에게는 계정 식별 정보가 보관됩니다.</p>

        <label class="field">
          Course
          <select name="course_id" required>
            <option value="">Select a course</option>
            ${courses.map(c => `
              <option
                value="${esc(c.id)}"
                ${String(c.id) === String(selected) ? 'selected' : ''}
                ${!editing && uploadRequest && String(c.id) !== String(selected) ? 'disabled' : ''}
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
            rows="3"
            placeholder="Optional"
          >${esc(r?.description || '')}</textarea>
        </label>

        <label class="field">
          PDF File

          <input
            type="file"
            id="pdf-file"
            name="pdf_file"
            accept="application/pdf"
            ${editing ? '' : 'required'}
          >
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

  uploadRequest = null;
  if (page === 'course') {
    await refreshResources(id);
    await loadRequests(id);
  }
  if (page === 'upload' && location.hash.slice(1).split('/')[2]) {
    const requestId = decodeURIComponent(location.hash.slice(1).split('/')[2]);
    const rows = listData(await api('/courses/' + route(id) + '/requests'), 'requests');
    uploadRequest = rows.find(r => String(r.id) === requestId && String(r.course_id) === String(id));
    if (!uploadRequest) throw new Error('자료 요청을 찾을 수 없습니다.');
    if (uploadRequest.status === 'fulfilled') throw new Error('이미 해결된 요청입니다. Course 게시판에서 연결된 자료를 확인해주세요.');
  }

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
      bindRequests(id);
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

    const openPdfButton = $('#open-pdf-button');

    if (openPdfButton) {

      openPdfButton.onclick = async () => {

        // popup blocker를 피하려고
        // 클릭 즉시 빈 탭을 먼저 연다.
        const newTab = window.open(
          'about:blank',
          '_blank'
        );

        try {

          const result = await api(
            '/resources/' +
            route(id) +
            '/pdf'
          );

          if (!result.url) {
            throw new Error(
              'The server did not return a PDF URL.'
            );
          }

          if (newTab) {
            newTab.location.href = result.url;
          } else {
            window.location.href = result.url;
          }

        } catch (error) {

          if (newTab) {
            newTab.close();
          }

          showError(
            '#resource-error',
            error
          );
        }
      };
    }

    initChatbot(id);
  } catch (error) {
    if (version !== renderVersion) return;
    $('#app').innerHTML = header(page) + `<main class="main narrow"><p class="error" role="alert">${esc(error.message)}</p><button class="btn" id="retry-button">Retry</button></main>`;
    $('#account-button').onclick = account; $('#retry-button').onclick = render;
  }
}
// ===== PDF Chatbot =====
const CHAT_SUGGESTIONS = [
  '이 자료를 한눈에 요약해줘',
  '핵심 개념을 정리해줘',
  '예상 시험 문제 3개 만들어줘',
  '중요한 용어와 공식을 알려줘'
];
const CHAT_OPEN_KEY = 'studyswap-chat-open';
const CHAT_MAX_SAVED = 40;
const CHAT_TIMEOUT_MS = 60000;
const chatKey = id => 'studyswap-chat-' + id;

function loadChat(id) {
  try {
    const list = JSON.parse(sessionStorage.getItem(chatKey(id)) || '[]');
    return Array.isArray(list) ? list.filter(m => m && typeof m.text === 'string') : [];
  } catch { return []; }
}
function saveChat(id, list) {
  try { sessionStorage.setItem(chatKey(id), JSON.stringify(list.slice(-CHAT_MAX_SAVED))); } catch {}
}

// Small, safe markdown renderer: code blocks, inline code, bold, italic, headings, lists.
// All text is HTML-escaped first, so model output can never inject markup.
function formatChatbotAnswer(text) {
  const blocks = [];
  let s = String(text ?? '').replace(/\r\n/g, '\n');
  s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(code.replace(/\n$/, ''));
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = esc(s);
  const inline = t => t
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const openList = tag => { if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; } };

  for (const line of s.split('\n')) {
    let m;
    if (/^\u0000\d+\u0000$/.test(line.trim())) { closeList(); out.push(line.trim()); }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { openList('ul'); out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { openList('ol'); out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^#{1,4}\s+(.*)/))) { closeList(); out.push(`<h4>${inline(m[1])}</h4>`); }
    else if (!line.trim()) { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre><code>${esc(blocks[Number(i)])}</code></pre>`);
}

function initChatbot(id) {
  const toggle = $('#chatbot-toggle'), win = $('#chatbot-window');
  const closeBtn = $('#chatbot-close'), resetBtn = $('#chatbot-reset'), handle = $('#chatbot-resize');
  const form = $('#chat-form'), input = $('#chat-input'), box = $('#chat-messages');
  if (!toggle || !win || !form || !input || !box) return;
  const sendBtn = form.querySelector('.chat-send');

  let history = loadChat(id);
  let pending = false, controller = null, cancelled = false;

  const scrollDown = () => { box.scrollTop = box.scrollHeight; };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const growInput = () => {
    input.style.height = 'auto';
    input.style.height = clamp(input.scrollHeight, 46, 120) + 'px';
  };
  const setBusy = busyNow => {
    input.disabled = busyNow;
    if (sendBtn) sendBtn.disabled = busyNow;
    if (resetBtn) resetBtn.disabled = false;
  };
  const setOpen = open => {
    win.hidden = !open;
    toggle.style.display = open ? 'none' : 'flex';
    try { sessionStorage.setItem(CHAT_OPEN_KEY, open ? '1' : ''); } catch {}
    if (open) { scrollDown(); if (!pending) input.focus(); }
  };

  // ----- message builders -----
  function addCopyButton(el, text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-copy';
    btn.textContent = '복사';
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '복사됨 ✓';
      } catch { btn.textContent = '복사 실패'; }
      setTimeout(() => { btn.textContent = '복사'; }, 1500);
    };
    el.appendChild(btn);
  }
  function addBubble(role, text) {
    const el = document.createElement('div');
    if (role === 'user') {
      el.className = 'chat-message user-message';
      el.textContent = text;
    } else {
      el.className = 'chat-message bot-message rich';
      el.innerHTML = formatChatbotAnswer(text);
      addCopyButton(el, text);
    }
    box.appendChild(el);
    return el;
  }
  function addTyping() {
    const el = document.createElement('div');
    el.className = 'chat-message bot-message loading-message typing';
    el.setAttribute('aria-label', '답변을 준비하고 있습니다');
    el.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span><span class="typing-text">PDF를 읽고 답변을 준비하고 있어요</span>';
    box.appendChild(el);
    return el;
  }
  function addError(question, message) {
    const el = document.createElement('div');
    el.className = 'chat-message bot-message chat-error-message';
    const p = document.createElement('p');
    p.textContent = message;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'chat-retry';
    retry.textContent = '다시 시도';
    retry.onclick = () => { el.remove(); ask(question, true); };
    el.append(p, retry);
    box.appendChild(el);
    return el;
  }
  function showSuggestions() {
    if (box.querySelector('.chat-suggestions')) return;
    const wrap = document.createElement('div');
    wrap.className = 'chat-suggestions';
    CHAT_SUGGESTIONS.forEach(q => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-suggestion';
      b.textContent = q;
      b.onclick = () => ask(q);
      wrap.appendChild(b);
    });
    box.appendChild(wrap);
  }

  // ----- conversation flow -----
  async function ask(rawQuestion, isRetry = false) {
    const question = String(rawQuestion || '').trim();
    if (!question || pending) return;
    pending = true; cancelled = false;
    setBusy(true);
    box.querySelector('.chat-suggestions')?.remove();

    if (!isRetry) {
      history.push({role: 'user', text: question});
      saveChat(id, history);
      addBubble('user', question);
    }
    const typing = addTyping();
    scrollDown();

    controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    try {
      const result = await api('/resources/' + route(id) + '/ask', {
        ...jsonRequest('POST', {question}),
        signal: controller.signal
      });
      const answer = String(result.answer || '').trim() || '답변을 불러오지 못했습니다.';
      history.push({role: 'bot', text: answer});
      saveChat(id, history);
      if (cancelled || !box.isConnected) return;
      typing.remove();
      addBubble('bot', answer);
    } catch (error) {
      if (cancelled || !box.isConnected) return;
      typing.remove();
      const timedOut = error.name === 'AbortError';
      addError(question, timedOut
        ? '응답 시간이 너무 오래 걸리고 있어요. 잠시 후 다시 시도해주세요.'
        : (error.message || '답변을 불러오는 중 오류가 발생했습니다.'));
      console.error(error);
    } finally {
      clearTimeout(timer);
      controller = null;
      if (!cancelled && box.isConnected) {
        pending = false;
        setBusy(false);
        input.focus();
        scrollDown();
      }
    }
  }

  function resetChat() {
    if (!history.length && !pending) return;
    if (!window.confirm('대화 내용을 모두 지울까요?')) return;
    cancelled = true;
    controller?.abort();
    pending = false;
    history = [];
    saveChat(id, history);
    box.querySelectorAll('.chat-message:not(.intro-message), .chat-suggestions').forEach(n => n.remove());
    setBusy(false);
    showSuggestions();
    input.focus();
  }

  // ----- restore previous conversation -----
  history.forEach(m => addBubble(m.role === 'user' ? 'user' : 'bot', m.text));
  if (!history.length) showSuggestions();

  // ----- events -----
  toggle.onclick = () => setOpen(true);
  closeBtn.onclick = () => setOpen(false);
  if (resetBtn) resetBtn.onclick = resetChat;
  win.onkeydown = e => { if (e.key === 'Escape') setOpen(false); };

  form.onsubmit = e => {
    e.preventDefault();
    const q = input.value;
    if (!q.trim() || pending) return;
    input.value = '';
    growInput();
    ask(q);
  };
  // Enter sends, Shift+Enter inserts a newline. isComposing keeps Korean IME input safe.
  input.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  };
  input.oninput = growInput;

  if (handle) {
    handle.onpointerdown = e => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const sx = e.clientX, sy = e.clientY, sw = win.offsetWidth, sh = win.offsetHeight;
      handle.onpointermove = ev => {
        win.style.width = clamp(sw + sx - ev.clientX, 320, 700) + 'px';
        win.style.height = clamp(sh + sy - ev.clientY, 420, 800) + 'px';
      };
      handle.onpointerup = () => { handle.onpointermove = null; handle.onpointerup = null; };
    };
  }

  // Keep the window open across pages / refreshes within the session.
  let wasOpen = false;
  try { wasOpen = sessionStorage.getItem(CHAT_OPEN_KEY) === '1'; } catch {}
  if (wasOpen) setOpen(true);
}

async function saveResource(event, id) {

  event.preventDefault();

  if (busy) return;


  const form = event.target;

  const data = new FormData(form);
  const respondingTo = id == null ? uploadRequest : null;

  const course = courseBy(
    respondingTo?.course_id ?? data.get('course_id')
  );


  if (
    !course ||
    (!form.dataset.uploadedResourceId && !String(
      data.get('title')
    ).trim())
  ) {

    showError(
      '#form-error',
      {
        message:
          'Select a course and enter a title.'
      }
    );

    return;
  }


  const payload = {

    title:
      String(
        data.get('title')
      ).trim(),

    course:
      code(course),

    resource_type:
      data.get(
        'resource_type'
      ),

    description:
      String(
        data.get('description') || ''
      ).trim(),

    course_id:
      Number(course.id)
  };


  if (respondingTo && String(course.id) !== String(respondingTo.course_id)) {
    showError('#form-error', new Error('요청과 같은 Course에 업로드해주세요.'));
    return;
  }
  busy = true;
  $('#form-error').textContent = '';

  const button =
    form.querySelector(
      'button[type=submit]'
    );

  button.disabled = true;


  try {

    // 새 Resource 생성
    if (id == null && !form.dataset.uploadedResourceId) {

      const pdf =
        data.get('pdf_file');


      if (
        !(pdf instanceof File) ||
        pdf.size === 0
      ) {

        throw new Error(
          'Please select a PDF file.'
        );
      }


      const uploadData =
        new FormData();


      uploadData.append(
        'title',
        payload.title
      );

      uploadData.append(
        'course',
        payload.course
      );

      uploadData.append(
        'resource_type',
        payload.resource_type
      );

      uploadData.append(
        'description',
        payload.description
      );

      uploadData.append(
        'course_id',
        String(payload.course_id)
      );

      uploadData.append(
        'pdf_file',
        pdf
      );


      const uploaded = await api(
        '/resources/upload',
        {
          method: 'POST',
          body: uploadData
        }
      );
      if (respondingTo) {
        const row = listData(uploaded, 'resources')[0];
        if (row?.id == null) throw new Error('업로드 응답에 자료 ID가 없습니다. Course에서 업로드 결과를 확인해주세요.');
        form.dataset.uploadedResourceId = String(row.id);
        // Keep the uploaded ID when fulfillment fails, so retry never reuploads the PDF.
        form.querySelectorAll('input, select, textarea').forEach(el => el.disabled = true);
      }

    }

    // 기존 Resource 수정
    else if (id != null) {

      await api(
        '/resources/' +
        route(id),

        jsonRequest(
          'PUT',
          payload
        )
      );
    }


    if (respondingTo) {
      try {
        await api('/requests/' + route(respondingTo.id) + '/fulfill',
          jsonRequest('PATCH', {resource_id: Number(form.dataset.uploadedResourceId)}));
      } catch (error) {
        button.textContent = '요청 연결 다시 시도';
        throw new Error('자료 업로드는 완료되었습니다. 요청 연결에 실패했습니다: ' + error.message + ' 아래 버튼으로 연결만 다시 시도해주세요.');
      }
    }
    form.reset();


    go(
      'course/' +
      route(course.id)
    );


    toast(
      id == null
        ? (respondingTo ? '자료를 업로드하고 요청을 해결했습니다.' : 'Resource and PDF uploaded successfully.')
        : 'Changes saved.'
    );


  } catch (error) {

    showError(
      '#form-error',
      error
    );

  } finally {

    busy = false;

    button.disabled = false;
  }
}
window.addEventListener('hashchange', render);
// Restore only the real login response; the backend must enforce authorization.
try {
  const saved = JSON.parse(sessionStorage.getItem('studyswap-user') || 'null');
  if (saved?.id && sessionStorage.getItem('studyswap-access-token')) setProfile({user: saved});
} catch {sessionStorage.removeItem('studyswap-user');}
render().catch(console.error);