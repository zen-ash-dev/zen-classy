'use strict';
// ═══════════════════════════════════════════════════════════════════════
//  CSE C WORKSPACE — CLIENT APPLICATION  v3.1 PRODUCTION
// ═══════════════════════════════════════════════════════════════════════

// ─── GLOBAL STATE ────────────────────────────────────────────────────
let currentUser  = null;
let appData      = {};
let currentMainView = 'dashboard';
let workspacePath   = { semester: null, subject: null };
let pinnedResources = JSON.parse(localStorage.getItem('pinnedResources') || '[]');
let activeCharts    = {};
let qrScanner       = null;
let qrGeneratorInterval = null;
let attendanceMap = {};

// ─── PERCEIVED PERFORMANCE LOADER ────────────────────────────────────
function showLoading() {
  const loader = document.getElementById('top-loader');
  const bar    = document.getElementById('top-loader-bar');
  if (!loader || !bar) return;
  loader.style.display = 'block';
  bar.style.transition = 'none';
  bar.style.width   = '0%';
  bar.style.opacity = '1';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bar.style.transition = 'width 2.5s cubic-bezier(0.06, 0.8, 0.2, 1)';
      bar.style.width = '82%';
    });
  });
}
function hideLoading() {
  const bar = document.getElementById('top-loader-bar');
  if (!bar) return;
  bar.style.transition = 'width 0.18s ease, opacity 0.4s ease';
  bar.style.width = '100%';
  setTimeout(() => {
    bar.style.opacity = '0';
    setTimeout(() => {
      const loader = document.getElementById('top-loader');
      if (loader) loader.style.display = 'none';
    }, 420);
  }, 200);
}

// ─── DYNAMIC LAZY LOADER ─────────────────────────────────────────────
const _loadedScripts = new Set();
const loadScript = (url) => new Promise((resolve, reject) => {
  if (_loadedScripts.has(url)) return resolve();
  showLoading();
  const s   = document.createElement('script');
  s.src     = url;
  s.onload  = () => { _loadedScripts.add(url); hideLoading(); resolve(); };
  s.onerror = () => { hideLoading(); reject(new Error(`Failed to load ${url}`)); };
  document.head.appendChild(s);
});

// ─── SECURITY: SANITIZERS ────────────────────────────────────────────
const esc = (str) =>
  String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                   .replace(/"/g,'&quot;').replace(/'/g,'&#039;');

const attr = (str) =>
  String(str ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' ').replace(/\r/g,'');

// ─── TOAST NOTIFICATIONS ─────────────────────────────────────────────
function showToast(message, type = 'success') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  c.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity 0.3s, transform 0.3s';
    t.style.opacity = '0';
    t.style.transform = 'translateX(110%)';
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

// ─── GLOBAL ROUTING ───────────────────────────────────────────────────
window.navEcosystem = () => { workspacePath.semester = null; workspacePath.subject = null; renderCanvas(); };
window.navSemester  = (sem) => { workspacePath.semester = sem; workspacePath.subject = null; renderCanvas(); };
window.navSubject   = (sub) => { workspacePath.subject = sub; renderCanvas(); };

// ─── UI HELPERS ──────────────────────────────────────────────────────
function toggleTheme() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  if (currentMainView === 'admin') setTimeout(renderAdminCharts, 120);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('-translate-x-full');
  document.getElementById('mobile-overlay').classList.toggle('hidden');
}

function switchAuthView(id) {
  ['login-view','forgot-view'].forEach(v => document.getElementById(v)?.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}

function togglePassword(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>`;
  } else {
    input.type = 'password';
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
  }
}

function togglePin(type, title, link, subject) {
  const idx = pinnedResources.findIndex(p => p.link === link);
  if (idx > -1) { pinnedResources.splice(idx, 1); showToast('Removed from Quick Pins'); }
  else { pinnedResources.push({ type, title, link, subject }); showToast('Pinned!', 'success'); }
  localStorage.setItem('pinnedResources', JSON.stringify(pinnedResources));
  renderCanvas();
}

function requestPushPermissions() {
  if (!('Notification' in window)) { showToast('Notifications not supported', 'error'); return; }
  Notification.requestPermission().then(p => {
    if (p === 'granted') { showToast('Alerts enabled!'); document.getElementById('notify-btn')?.classList.add('hidden'); }
    else showToast('Permission denied.', 'error');
  });
}
function checkPushPerm() {
  if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied')
    document.getElementById('notify-btn')?.classList.remove('hidden');
}

// ─── SMART LINK INTERCEPTOR ───────────────────────────────────────────
function openQuickPeek(title, url) {
  if (!url) { showToast('Invalid link', 'error'); return; }
  const externalOnly = [
    'drive.google.com/drive/folders',
    'onedrive.live.com', 'sharepoint.com',
    'dropbox.com', 'box.com', 'notion.so',
    'figma.com', 'canva.com'
  ];
  if (externalOnly.some(d => url.includes(d))) {
    showToast('Opening in new tab…');
    setTimeout(() => window.open(url, '_blank'), 400);
    return;
  }
  let embedUrl = url; let canEmbed = false;
  if (url.includes('drive.google.com/file/d/')) {
    embedUrl = url.replace(/\/view.*$/, '/preview'); canEmbed = true;
  } else if (url.includes('docs.google.com')) {
    embedUrl = url.replace(/\/edit.*$/, '/preview'); canEmbed = true;
  } else if (url.match(/youtube\.com\/watch/)) {
    const v = new URL(url).searchParams.get('v');
    embedUrl = `https://www.youtube.com/embed/${v}`; canEmbed = true;
  } else if (url.includes('youtu.be/')) {
    const v = url.split('youtu.be/')[1].split('?')[0];
    embedUrl = `https://www.youtube.com/embed/${v}`; canEmbed = true;
  }
  if (!canEmbed) {
    showToast('Opening secure external link…');
    setTimeout(() => window.open(url, '_blank'), 400);
    return;
  }
  document.getElementById('peek-title').textContent  = title;
  document.getElementById('peek-external').href      = url;
  document.getElementById('peek-loader').classList.remove('hidden');
  document.getElementById('peek-iframe').src         = embedUrl;
  const modal = document.getElementById('quick-peek-modal');
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.classList.remove('opacity-0'));
}
function closeQuickPeek() {
  const modal = document.getElementById('quick-peek-modal');
  modal.classList.add('opacity-0');
  setTimeout(() => { modal.classList.add('hidden'); document.getElementById('peek-iframe').src = ''; }, 320);
}

// ─── SAAS ONBOARDING (NEW) ────────────────────────────────────────────
window.copyPrompt = function() {
  const text = document.getElementById('ai-prompt-text');
  text.select();
  document.execCommand('copy');
  showToast('Prompt Copied! Paste it into Gemini.');
};

document.getElementById('registerTenantForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('regTenantBtn');
  btn.textContent = 'Initializing...'; btn.disabled = true; showLoading();

  const payload = {
    classCode: document.getElementById('regClassCode').value.trim().toUpperCase(),
    sheetId: document.getElementById('regSheetId').value.trim(),
    adminName: document.getElementById('regAdminName').value.trim(),
    adminRoll: document.getElementById('regAdminRoll').value.trim().toUpperCase(),
    adminPassword: document.getElementById('regAdminPass').value
  };

  const res = await apiCall('registerTenant', payload);
  hideLoading();
  
  if (res?.success) {
    showToast('Institute initialized successfully! You may now log in.', 'success');
    switchAuthView('login-view');
    e.target.reset();
  } else {
    showToast(res?.message || 'Failed to connect database.', 'error');
  }
  btn.textContent = 'Initialize'; btn.disabled = false;
});

// ─── MULTI-TENANT AUTH LOGIC (UPDATED) ────────────────────────────────
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn    = document.getElementById('loginBtn');
  const status = document.getElementById('login-status');
  btn.classList.add('hidden'); status.classList.remove('hidden'); showLoading();
  
  // Grab the class code from the UI
  const classCodeVal = document.getElementById('classCode').value.trim().toUpperCase();
  
  const res = await apiCall('login', {
    classCode:  classCodeVal,
    rollNumber: document.getElementById('rollNumber').value.trim().toUpperCase(),
    password:   document.getElementById('password').value
  });
  
  hideLoading();
  if (res?.success) {
    currentUser = res.user;
    localStorage.setItem('session', JSON.stringify(currentUser));
    localStorage.setItem('currentClassCode', classCodeVal);
    if (res.adminToken) localStorage.setItem('adminToken', res.adminToken);
    
    apiCall('logActivity', { rollNumber: currentUser.rollNumber, name: currentUser.name, role: currentUser.role });
    setTimeout(initApp, 300);
  } else {
    showToast(res?.message ?? 'Authentication failed', 'error');
    btn.classList.remove('hidden'); status.classList.add('hidden');
  }
});

function resetForgotFlow() {
  document.getElementById('forgotFormStep1').classList.remove('hidden');
  document.getElementById('forgotFormStep2').classList.add('hidden');
  document.getElementById('resetClassCode').value = '';
  document.getElementById('resetRoll').value = '';
  document.getElementById('resetAnswer').value = '';
  switchAuthView('login-view');
}
document.getElementById('forgotFormStep1')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('getQBtn');
  btn.textContent = 'Searching…'; btn.disabled = true; showLoading();

  const classCodeVal = document.getElementById('resetClassCode').value.trim().toUpperCase();
  const rollVal = document.getElementById('resetRoll').value.trim().toUpperCase();
  
  localStorage.setItem('currentClassCode', classCodeVal);

  const res = await apiCall('getSecurityQuestion', { 
    classCode: classCodeVal,
    rollNumber: rollVal 
  });
  
  hideLoading(); btn.textContent = 'Find Account'; btn.disabled = false;
  
  if (res?.success) {
    document.getElementById('display-sec-q').textContent = res.question;
    document.getElementById('forgotFormStep1').classList.add('hidden');
    document.getElementById('forgotFormStep2').classList.remove('hidden');
  } else {
    showToast(res?.message ?? 'Account not found', 'error');
  }
});
document.getElementById('forgotFormStep2')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('resetBtn');
  btn.textContent = 'Requesting…'; btn.disabled = true; showLoading();
  
  const res = await apiCall('requestReset', {
    rollNumber: document.getElementById('resetRoll').value.trim().toUpperCase(),
    answer:     document.getElementById('resetAnswer').value.trim()
  });
  
  hideLoading(); btn.textContent = 'Request Reset'; btn.disabled = false;
  showToast(res?.message ?? 'Error', res?.success ? 'success' : 'error');
  
  if (res?.success) resetForgotFlow();
});
function logout() { localStorage.clear(); location.reload(); }

// ─── INIT & SYNC ──────────────────────────────────────────────────────
async function initApp() {
  const authEl = document.getElementById('auth-layout');
  const appEl  = document.getElementById('app-layout');
  authEl.classList.add('opacity-0');
  setTimeout(() => { authEl.classList.add('hidden'); appEl.classList.remove('hidden'); }, 500);

  document.getElementById('ui-username').textContent = currentUser.name;
  document.getElementById('ui-role').textContent     = currentUser.role === 'Admin' ? 'Administrator' : 'Student';
  document.getElementById('ui-avatar').textContent   = currentUser.name.charAt(0).toUpperCase();

  if (currentUser.role === 'Admin') {
    document.getElementById('nav-admin')?.classList.remove('hidden');
    document.getElementById('admin-nav-title')?.classList.remove('hidden');
  }

  const cached = localStorage.getItem('appCache');
  if (cached) { appData = JSON.parse(cached); buildAttendanceMap(); checkSystemStatus(); }
  else {
    document.getElementById('workspace-canvas').innerHTML =
      `<div class="animate-pulse space-y-5">
        <div class="h-10 bg-slate-200 dark:bg-white/5 rounded-2xl w-1/3"></div>
        <div class="grid grid-cols-3 gap-6"><div class="h-36 bg-slate-200 dark:bg-white/5 rounded-3xl"></div><div class="h-36 bg-slate-200 dark:bg-white/5 rounded-3xl"></div><div class="h-36 bg-slate-200 dark:bg-white/5 rounded-3xl"></div></div>
        <div class="h-64 bg-slate-200 dark:bg-white/5 rounded-3xl w-full"></div>
      </div>`;
  }
  checkPushPerm(); forceSync();
}

async function forceSync() {
  const icon = document.getElementById('sync-icon');
  icon?.classList.add('animate-spin'); showLoading();
  const res = await apiCall('fetchData');
  icon?.classList.remove('animate-spin'); hideLoading();
  if (res?.success) {
    appData = res;
    const validLinks = [...(appData.notes||[]), ...(appData.excels||[])].map(x => x.link);
    pinnedResources = pinnedResources.filter(p => validLinks.includes(p.link));
    localStorage.setItem('pinnedResources', JSON.stringify(pinnedResources));
    localStorage.setItem('appCache', JSON.stringify(res));
    buildAttendanceMap();
    checkSystemStatus();
  }
}

function buildAttendanceMap() {
  attendanceMap = {};
  (appData.attendance || []).forEach(a => {
    attendanceMap[`${a.date}|${a.hour}`] = a;
  });
}

function checkSystemStatus() {
  if (appData.systemStatus === 'Offline' && currentUser.role === 'Student') {
    document.getElementById('shutdown-screen').classList.remove('hidden');
  } else {
    document.getElementById('shutdown-screen').classList.add('hidden');
    renderCanvas();
  }
}

function switchMainView(view) {
  if (qrScanner)  { qrScanner.clear(); qrScanner = null; }
  if (qrGeneratorInterval) { clearInterval(qrGeneratorInterval); qrGeneratorInterval = null; }
  currentMainView = view;
  workspacePath = { semester: null, subject: null };
  document.getElementById('workspace-scroll').scrollTop = 0;
  if (window.innerWidth < 768) toggleSidebar();

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active-nav','bg-slate-100','dark:bg-white/10','text-slate-900','dark:text-white');
    btn.classList.add('text-slate-500','dark:text-gray-400');
  });
  const activeBtn = event?.currentTarget ?? document.querySelector(`[onclick="switchMainView('${view}')"]`);
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-500','dark:text-gray-400');
    activeBtn.classList.add('active-nav','bg-slate-100','dark:bg-white/10','text-slate-900','dark:text-white');
  }
  renderCanvas();
}

// ═══════════════════════════════════════════════════════════════════════
//  MASTER RENDER ENGINE
// ═══════════════════════════════════════════════════════════════════════
function renderCanvas() {
  const canvas = document.getElementById('workspace-canvas');
  if (!canvas || !appData.students) return;

  const allAnns       = (appData.announcements || []).filter(a => a.title).slice().reverse();
  const totalResources = (appData.notes?.filter(n => n.title?.trim()) || []).length +
                         (appData.excels?.filter(e => e.title?.trim()) || []).length;

  const offlineBanner = (appData.systemStatus === 'Offline' && currentUser.role === 'Admin')
    ? `<div class="flex items-center gap-3 bg-red-500/10 border border-red-500/30 text-red-500 dark:text-red-400 p-4 rounded-2xl mb-8 text-sm font-bold shadow-sm">
        <svg class="w-5 h-5 shrink-0 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        SYSTEM IS CURRENTLY OFFLINE TO STUDENTS
       </div>` : '';

  // ── DASHBOARD ──────────────────────────────────────────────────────
  if (currentMainView === 'dashboard') {
    document.getElementById('breadcrumb').innerHTML = '<span class="text-slate-900 dark:text-white font-black tracking-wide text-lg">Dashboard</span>';
    const firstName = esc(currentUser.name.split(' ')[0]);
    const addAnnBtn = currentUser.role === 'Admin'
      ? `<button onclick="openAnnModal()" class="btn-shine ml-auto bg-slate-900 dark:bg-white text-white dark:text-black text-xs font-bold px-5 py-2.5 rounded-xl shadow-md hover:scale-[0.98] transition-transform flex items-center gap-2 outline-none">+ Notice</button>`
      : '';

    const pinsHtml = pinnedResources.length > 0 ? `
      <div class="mb-12">
        <h2 class="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
          <span class="text-yellow-400">★</span> Quick Pins
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
          ${pinnedResources.map(p => {
            const color = p.type === 'Note' ? 'text-blue-500' : 'text-green-500';
            const bg    = p.type === 'Note' ? 'bg-blue-500/10' : 'bg-green-500/10';
            return `<div onclick="openQuickPeek('${attr(p.title)}','${attr(p.link)}')" class="glass-card p-4 rounded-2xl flex items-center justify-between cursor-pointer anim-fade-up">
              <div class="flex items-center gap-3 overflow-hidden pointer-events-none">
                <div class="w-11 h-11 rounded-xl ${bg} ${color} flex items-center justify-center shrink-0">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                </div>
                <div class="overflow-hidden">
                  <p class="text-sm font-bold text-slate-900 dark:text-white truncate">${esc(p.title)}</p>
                  <p class="text-[10px] text-slate-400 uppercase tracking-wider font-bold mt-0.5">${esc(p.subject)}</p>
                </div>
              </div>
              <button onclick="event.stopPropagation();togglePin('${attr(p.type)}','${attr(p.title)}','${attr(p.link)}','${attr(p.subject)}')" class="text-yellow-400 text-xl hover:scale-110 transition-transform outline-none ml-2">★</button>
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    const noticesHtml = allAnns.length > 0
      ? allAnns.map((a, i) => {
          const isHigh = a.priority === 'High';
          const cardCls = isHigh ? 'card-emergency' : 'border-transparent hover:border-blue-500/20';
          const pBadgeColor = isHigh ? 'border-red-500 text-red-500 bg-red-500/15' : 'border-blue-500/50 text-blue-500 bg-blue-500/10';
          const alertIcon = isHigh ? '🚨 ' : '';
          const expiry = a.validUntil
            ? `<span class="text-[10px] bg-slate-100 dark:bg-black/50 px-2.5 py-1 rounded-lg text-slate-500 font-bold border border-slate-200 dark:border-white/10 mono">Ends ${new Date(a.validUntil).toLocaleDateString()}</span>` : '';
          const adminBtns = currentUser.role === 'Admin'
            ? `<button onclick="openAnnModal('${attr(a.date)}','${attr(a.title)}')" title="Edit" class="p-2 rounded-xl text-blue-400 hover:bg-blue-500/10 transition-colors outline-none"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>
               <button onclick="deleteRecord('Announcements','${attr(a.date)}','${attr(a.title)}')" title="Delete" class="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors outline-none"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>`
            : '';
          return `<div class="glass-card p-6 md:p-8 rounded-3xl ${cardCls} anim-fade-up" style="animation-delay:${i*0.06}s">
            <div class="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
              <div>
                <div class="flex flex-wrap gap-2 mb-3">
                  <span class="text-[10px] font-black uppercase tracking-widest border ${pBadgeColor} px-3 py-1.5 rounded-lg">${alertIcon}${esc(a.priority || 'Normal')}</span>
                  <span class="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 dark:bg-white/5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10">${esc(a.semester)} · ${esc(a.subject)}</span>
                </div>
                <h3 class="text-xl font-bold text-slate-900 dark:text-white">${esc(a.title)}</h3>
              </div>
              <div class="flex items-center gap-1">
                ${adminBtns}
                <div class="flex flex-col items-end gap-1 ml-2">
                  <span class="text-[10px] text-slate-400 mono font-bold">${new Date(a.date).toLocaleDateString()}</span>
                  ${expiry}
                </div>
              </div>
            </div>
            <p class="text-sm text-slate-600 dark:text-gray-300 leading-relaxed">${esc(a.description)}</p>
          </div>`;
        }).join('')
      : `<div class="glass-card p-12 rounded-3xl text-center text-slate-400 font-medium border border-dashed border-slate-200 dark:border-white/10">No active announcements.</div>`;

    canvas.innerHTML = `
      ${offlineBanner}
      <div class="mb-10 anim-fade-up">
        <h1 class="text-4xl md:text-5xl font-black text-slate-900 dark:text-white tracking-tight mb-2">
          Welcome back, <span class="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-500">${firstName}</span> 👋
        </h1>
        <p class="text-slate-400 font-medium text-sm">Here's your academic overview for today.</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-12 stagger">
        <div class="glass-card stat-card-glow-blue p-6 md:p-8 rounded-3xl anim-scale-in">
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Total Students</p>
          <p class="text-5xl font-black text-slate-900 dark:text-white tracking-tight">${appData.students.length}</p>
        </div>
        <div class="glass-card stat-card-glow-purple p-6 md:p-8 rounded-3xl anim-scale-in">
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Total Resources</p>
          <p class="text-5xl font-black text-slate-900 dark:text-white tracking-tight">${totalResources}</p>
        </div>
        <div class="glass-card stat-card-glow-green p-6 md:p-8 rounded-3xl anim-scale-in">
          <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">System Status</p>
          <p class="text-3xl font-black mt-2 flex items-center gap-3 ${appData.systemStatus === 'Offline' ? 'text-red-500' : 'text-emerald-500'}">
            <span class="w-3 h-3 rounded-full bg-current shadow-[0_0_12px_currentColor] animate-pulse"></span>
            ${appData.systemStatus === 'Offline' ? 'Offline' : 'Online'}
          </p>
        </div>
      </div>
      ${pinsHtml}
      <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 class="text-xl font-bold text-slate-900 dark:text-white">Notice Board</h2>
        ${addAnnBtn}
      </div>
      <div class="space-y-4">${noticesHtml}</div>
    `;
  }

  // ── ECOSYSTEM ──────────────────────────────────────────────────────
  else if (currentMainView === 'workspace') {
    let bc = `<button onclick="navEcosystem()" class="hover:text-blue-500 font-black text-lg ${!workspacePath.semester ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-500'} outline-none transition-colors">Ecosystem</button>`;
    if (workspacePath.semester)
      bc += ` <span class="text-slate-300 dark:text-slate-700 mx-2">/</span>
              <button onclick="navSemester('${attr(workspacePath.semester)}')" class="hover:text-blue-500 font-black text-lg ${!workspacePath.subject ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-500'} outline-none transition-colors">${esc(workspacePath.semester)}</button>`;
    if (workspacePath.subject)
      bc += ` <span class="text-slate-300 dark:text-slate-700 mx-2">/</span>
              <span class="text-slate-900 dark:text-white font-black text-lg truncate max-w-[150px] md:max-w-xs">${esc(workspacePath.subject)}</span>`;
    document.getElementById('breadcrumb').innerHTML = `<div class="flex items-center truncate">${bc}</div>`;

    if (!workspacePath.semester) {
      const semesters = [...new Set(
        (appData.modules || []).filter(m => String(m.semester).trim()).map(m => String(m.semester).trim())
      )];
      const addCard = currentUser.role === 'Admin'
        ? `<div onclick="openModuleModal('Semester')" class="eco-folder rounded-3xl h-48 md:h-56 flex flex-col items-center justify-center border-2 border-dashed border-blue-400/40 bg-blue-500/5 hover:bg-blue-500/10 transition-colors cursor-pointer">
            <div class="w-14 h-14 rounded-2xl bg-blue-500 text-white flex items-center justify-center mb-3 shadow-lg eco-folder-icon"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg></div>
            <span class="text-sm font-bold text-blue-500 uppercase tracking-widest">Add Semester</span>
           </div>` : '';

      canvas.innerHTML = `
        ${offlineBanner}
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
          <h1 class="text-4xl font-black text-slate-900 dark:text-white tracking-tight anim-fade-up">Ecosystem</h1>
          <input id="eco-search" type="text" placeholder="Search folders…" class="w-full md:w-72 px-5 py-3.5 bg-white dark:bg-black/50 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-medium shadow-sm">
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 stagger">
          ${addCard}
          ${semesters.map(sem => {
            const delBtn = currentUser.role === 'Admin'
              ? `<button onclick="event.stopPropagation();deleteModule('${attr(sem)}',null)" class="absolute top-3 right-3 p-2 text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15 rounded-xl opacity-0 group-hover:opacity-100 transition-all z-20 outline-none"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>` : '';
            return `<div onclick="navSemester('${attr(sem)}')" class="eco-folder eco-card relative glass-card rounded-3xl h-48 md:h-56 flex flex-col items-center justify-center group overflow-hidden anim-fade-up cursor-pointer border border-transparent hover:border-blue-500/30">
              ${delBtn}
              <svg class="w-16 h-16 mb-3 text-blue-500 eco-folder-icon transition-transform group-hover:scale-110" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
              <span class="text-lg font-black text-slate-900 dark:text-white px-2 text-center">${esc(sem)}</span>
            </div>`;
          }).join('')}
        </div>`;
      document.getElementById('eco-search')?.addEventListener('input', e => {
        const t = e.target.value.toLowerCase();
        document.querySelectorAll('.eco-card').forEach(c => { c.style.display = c.textContent.toLowerCase().includes(t) ? '' : 'none'; });
      });
    }

    else if (!workspacePath.subject) {
      const subjects = [...new Set(
        (appData.modules || [])
          .filter(m => String(m.semester).trim() === workspacePath.semester && String(m.subject).trim() && m.subject !== 'General')
          .map(m => String(m.subject).trim())
      )];
      const addCard = currentUser.role === 'Admin'
        ? `<div onclick="openModuleModal('Subject')" class="eco-folder rounded-3xl h-48 md:h-56 flex flex-col items-center justify-center border-2 border-dashed border-indigo-400/40 bg-indigo-500/5 hover:bg-indigo-500/10 transition-colors cursor-pointer">
            <div class="w-14 h-14 rounded-2xl bg-indigo-500 text-white flex items-center justify-center mb-3 shadow-lg eco-folder-icon"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg></div>
            <span class="text-sm font-bold text-indigo-500 uppercase tracking-widest">Add Subject</span>
           </div>` : '';

      canvas.innerHTML = `
        ${offlineBanner}
        <div class="flex flex-col md:flex-row md:items-center gap-4 mb-10">
          <button onclick="navEcosystem()" class="w-11 h-11 rounded-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-900 dark:text-white shrink-0 hover:scale-105 transition-transform outline-none shadow-sm">←</button>
          <h1 class="text-4xl font-black text-slate-900 dark:text-white tracking-tight flex-1">${esc(workspacePath.semester)}</h1>
          <input id="eco-search" type="text" placeholder="Search subjects…" class="w-full md:w-72 px-5 py-3.5 bg-white dark:bg-black/50 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-medium shadow-sm">
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 stagger">
          ${addCard}
          ${subjects.map(sub => {
            const adminBtns = currentUser.role === 'Admin' ? `
              <button onclick="event.stopPropagation();openRenameModal('Subject','${attr(sub)}')" title="Rename" class="absolute top-3 left-3 p-2 text-slate-300 dark:text-slate-600 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 rounded-xl opacity-0 group-hover:opacity-100 transition-all z-20 outline-none"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>
              <button onclick="event.stopPropagation();deleteModule('${attr(workspacePath.semester)}','${attr(sub)}')" title="Delete" class="absolute top-3 right-3 p-2 text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15 rounded-xl opacity-0 group-hover:opacity-100 transition-all z-20 outline-none"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>` : '';
            return `<div onclick="navSubject('${attr(sub)}')" class="eco-folder eco-card glass-card relative rounded-3xl h-48 md:h-56 flex flex-col items-center justify-center group overflow-hidden anim-fade-up cursor-pointer border border-transparent hover:border-indigo-500/30">
              ${adminBtns}
              <svg class="w-16 h-16 mb-3 text-indigo-500 eco-folder-icon transition-transform group-hover:scale-110" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
              <span class="text-base md:text-lg font-black text-slate-900 dark:text-white px-3 text-center truncate max-w-full">${esc(sub)}</span>
            </div>`;
          }).join('')}
        </div>`;
      document.getElementById('eco-search')?.addEventListener('input', e => {
        const t = e.target.value.toLowerCase();
        document.querySelectorAll('.eco-card').forEach(c => { c.style.display = c.textContent.toLowerCase().includes(t) ? '' : 'none'; });
      });
    }

    else {
      const subjectNotes  = (appData.notes  || []).filter(n => n.title?.trim() && n.subject === workspacePath.subject && n.semester === workspacePath.semester);
      const subjectExcels = (appData.excels || []).filter(e => e.title?.trim() && e.subject === workspacePath.subject && e.semester === workspacePath.semester);

      const makeResourceRow = (item, typeColor, typeBg, typeName) => {
        const isPinned  = pinnedResources.some(p => p.link === item.link);
        const starCls   = isPinned ? 'text-yellow-400' : 'text-slate-300 hover:text-yellow-400';
        const editBtns  = currentUser.role === 'Admin'
          ? `<button onclick="event.stopPropagation();openResourceModal('edit','${typeName}s','${attr(item.title)}','${attr(item.link)}','${attr(item.date)}')" title="Edit" class="p-2 rounded-xl text-slate-400 hover:${typeColor} hover:bg-blue-500/10 transition-colors outline-none"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>
             <button onclick="event.stopPropagation();deleteRecord('${typeName}s','${attr(item.date)}','${attr(item.title)}')" title="Delete" class="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors outline-none"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>`
          : '';
        return `<div onclick="openQuickPeek('${attr(item.title)}','${attr(item.link)}')" class="glass-card p-4 md:p-5 rounded-2xl flex items-center justify-between gap-4 cursor-pointer group hover:border-${typeName==='Note'?'blue':'green'}-500/30 border border-transparent anim-fade-up">
          <div class="flex items-center gap-4 overflow-hidden pointer-events-none">
            <div class="w-11 h-11 rounded-xl ${typeBg} flex items-center justify-center ${typeColor} shrink-0"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg></div>
            <span class="text-sm font-bold text-slate-900 dark:text-white truncate group-hover:underline">${esc(item.title)}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button onclick="event.stopPropagation();togglePin('${typeName}','${attr(item.title)}','${attr(item.link)}','${attr(item.subject)}')" class="${starCls} text-xl transition-transform hover:scale-110 outline-none">★</button>
            ${editBtns}
            <button onclick="event.stopPropagation();openQuickPeek('${attr(item.title)}','${attr(item.link)}')" class="text-xs text-white bg-slate-900 dark:bg-white/20 px-4 py-2 rounded-xl font-bold uppercase tracking-wide hover:scale-95 transition-transform outline-none ml-1">View</button>
          </div>
        </div>`;
      };

      const adminBtn = currentUser.role === 'Admin'
        ? `<button onclick="openResourceModal('create')" class="btn-shine bg-slate-900 dark:bg-white text-white dark:text-black px-5 py-3 rounded-xl font-bold hover:scale-[0.98] transition-transform shadow-lg flex items-center gap-2 outline-none">+ Publish Content</button>` : '';

      canvas.innerHTML = `
        ${offlineBanner}
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
          <div class="flex items-center gap-4 overflow-hidden">
            <button onclick="navSemester('${attr(workspacePath.semester)}')" class="w-11 h-11 rounded-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-900 dark:text-white shrink-0 hover:scale-105 transition-transform outline-none shadow-sm">←</button>
            <h1 class="text-3xl md:text-4xl font-black text-slate-900 dark:text-white truncate">${esc(workspacePath.subject)}</h1>
          </div>
          ${adminBtn}
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-8 md:gap-10">
          <div>
            <h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-blue-500"></span> Documentation</h3>
            <div class="space-y-3">
              ${subjectNotes.length > 0 ? subjectNotes.map(n => makeResourceRow(n, 'text-blue-500', 'bg-blue-500/10', 'Note')).join('') : '<div class="glass-card p-8 rounded-2xl text-center text-slate-400 font-medium border border-dashed border-slate-200 dark:border-white/10">No documents indexed.</div>'}
            </div>
          </div>
          <div>
            <h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-emerald-500"></span> Data Sheets</h3>
            <div class="space-y-3">
              ${subjectExcels.length > 0 ? subjectExcels.map(e => makeResourceRow(e, 'text-emerald-500', 'bg-emerald-500/10', 'Excel')).join('') : '<div class="glass-card p-8 rounded-2xl text-center text-slate-400 font-medium border border-dashed border-slate-200 dark:border-white/10">No datasets indexed.</div>'}
            </div>
          </div>
        </div>`;
    }
  }

  // ── ATTENDANCE ─────────────────────────────────────────────────────
  else if (currentMainView === 'attendance') {
    document.getElementById('breadcrumb').innerHTML = '<span class="text-slate-900 dark:text-white font-black tracking-wide text-lg">Attendance</span>';
    canvas.innerHTML = `
      ${offlineBanner}
      <div class="mb-8"><h1 class="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Attendance Console</h1></div>
      <div class="flex gap-3 mb-8 border-b border-slate-200 dark:border-white/10 pb-4">
        <button id="tab-btn-manual" onclick="renderAttendanceTabs('manual')" class="px-5 py-2.5 rounded-full font-bold text-sm bg-blue-500 text-white shadow-md transition-all outline-none">Manual Logging</button>
        <button id="tab-btn-qr"     onclick="renderAttendanceTabs('qr')"     class="px-5 py-2.5 rounded-full font-bold text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all outline-none">QR Scanning</button>
      </div>
      <div id="attendance-content-area"></div>`;
    renderAttendanceTabs('manual');
  }

  // ── DIRECTORY ──────────────────────────────────────────────────────
  else if (currentMainView === 'directory') {
    document.getElementById('breadcrumb').innerHTML = '<span class="text-slate-900 dark:text-white font-black tracking-wide text-lg">Directory</span>';
    const csvBtn = currentUser.role === 'Admin'
      ? `<button onclick="exportCSV()" class="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500 hover:text-white px-5 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors border border-emerald-500/20 outline-none">↓ Export CSV</button>` : '';

    const rows = appData.students.map((s, i) => {
      let actions = '';
      if (currentUser.role === 'Admin') {
        actions = s.rollNumber !== currentUser.rollNumber
          ? `<button onclick="toggleUserRole('${attr(s.rollNumber)}','${attr(s.role)}')" class="px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-white hover:bg-blue-500 hover:text-white transition-colors mr-1 outline-none">Toggle</button>
             <button onclick="deleteUser('${attr(s.rollNumber)}')" class="px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white transition-colors outline-none">Del</button>`
          : `<span class="text-xs text-slate-400 font-bold px-3 py-1.5">You</span>`;
      }
      return `<tr class="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors eco-card">
        <td class="py-4 px-6 mono text-slate-400 text-xs">${i+1}</td>
        <td class="py-4 px-6 font-bold text-slate-900 dark:text-white">${esc(s.name)}</td>
        <td class="py-4 px-6 mono text-slate-400 text-xs">${esc(s.rollNumber)}</td>
        ${currentUser.role === 'Admin' ? `<td class="py-4 px-6 mono text-slate-400 text-xs">${esc(s.phone)||'—'}</td>` : ''}
        <td class="py-4 px-6 text-slate-500 text-sm">${esc(s.email)}</td>
        <td class="py-4 px-6"><span class="px-3 py-1.5 rounded-lg text-[10px] uppercase font-black tracking-wider ${s.role==='Admin'?'bg-blue-500/10 text-blue-500':'bg-slate-100 dark:bg-white/5 text-slate-400'}">${esc(s.role)}</span></td>
        ${currentUser.role === 'Admin' ? `<td class="py-4 px-6 text-right">${actions}</td>` : ''}
      </tr>`;
    }).join('');

    canvas.innerHTML = `
      ${offlineBanner}
      <div class="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 class="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Class Roster</h1>
        <div class="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
          <input type="text" id="dir-search" placeholder="Search roster…" class="w-full md:w-72 px-5 py-3.5 bg-white dark:bg-black/50 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-medium shadow-sm">
          ${csvBtn}
        </div>
      </div>
      <div class="glass-card rounded-3xl overflow-hidden overflow-x-auto shadow-md">
        <table class="w-full text-left text-sm whitespace-nowrap">
          <thead class="bg-slate-50 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/10 text-slate-400">
            <tr>
              <th class="py-5 px-6 font-bold uppercase tracking-widest text-[10px] w-16">#</th>
              <th class="py-5 px-6 font-bold uppercase tracking-widest text-[10px]">Name</th>
              <th class="py-5 px-6 font-bold uppercase tracking-widest text-[10px]">Roll No</th>
              ${currentUser.role === 'Admin' ? '<th class="py-5 px-6 font-bold uppercase tracking-widest text-[10px]">Phone</th>' : ''}
              <th class="py-5 px-6 font-bold uppercase tracking-widest text-[10px]">Email</th>
              <th class="py-5 px-6 font-bold uppercase tracking-widest text-[10px]">Role</th>
              ${currentUser.role === 'Admin' ? '<th class="py-5 px-6 font-bold uppercase tracking-widest text-[10px] text-right">Actions</th>' : ''}
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-white/[0.04] text-slate-800 dark:text-white" id="dir-table">${rows}</tbody>
        </table>
      </div>`;
    document.getElementById('dir-search')?.addEventListener('input', e => {
      const t = e.target.value.toLowerCase();
      document.querySelectorAll('.eco-card').forEach(r => { r.style.display = r.textContent.toLowerCase().includes(t) ? '' : 'none'; });
    });
  }

  // ── PROFILE ────────────────────────────────────────────────────────
  else if (currentMainView === 'profile') {
    document.getElementById('breadcrumb').innerHTML = '<span class="text-slate-900 dark:text-white font-black tracking-wide text-lg">Settings</span>';
    canvas.innerHTML = `
      ${offlineBanner}
      <div class="max-w-4xl mx-auto">
        <h1 class="text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-10">Your Profile</h1>
        <div class="glass-card p-8 rounded-3xl mb-8 flex flex-col md:flex-row items-center gap-8 shadow-md">
          <div class="w-24 h-24 rounded-3xl bg-gradient-to-tr from-slate-700 to-slate-900 flex items-center justify-center text-5xl font-black text-white shadow-inner">${esc(currentUser.name).charAt(0)}</div>
          <div class="text-center md:text-left">
            <h2 class="text-3xl font-black text-slate-900 dark:text-white">${esc(currentUser.name)}</h2>
            <p class="text-slate-400 mono text-sm mt-1">${esc(currentUser.rollNumber)} ${currentUser.phone && currentUser.phone !== '-' ? `· ${esc(currentUser.phone)}` : ''}</p>
            <span class="inline-block mt-3 px-4 py-2 rounded-xl text-xs uppercase font-black tracking-widest ${currentUser.role === 'Admin' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'bg-slate-100 dark:bg-white/5 text-slate-400 border border-slate-200 dark:border-white/10'}">${esc(currentUser.role)} Access</span>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="glass-card p-8 rounded-3xl">
            <h3 class="text-xl font-black text-slate-900 dark:text-white mb-1">Change Password</h3>
            <p class="text-sm text-slate-400 mb-6">Update your access key.</p>
            <form id="change-pass-form" class="space-y-4">
              <div class="relative flex items-center">
                <input type="password" id="new-profile-pass" placeholder="New Password" required class="w-full pl-5 pr-12 py-4 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-medium shadow-sm">
                <button type="button" onclick="togglePassword('new-profile-pass','eye-profile')" class="absolute right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white focus:outline-none">
                  <svg id="eye-profile" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                </button>
              </div>
              <button type="submit" class="btn-shine w-full bg-slate-900 dark:bg-white text-white dark:text-black font-bold py-4 rounded-xl hover:scale-[0.98] transition-transform shadow-lg outline-none">Update Password</button>
            </form>
          </div>
          <div class="glass-card p-8 rounded-3xl">
            <h3 class="text-xl font-black text-slate-900 dark:text-white mb-1">Account Recovery</h3>
            <p class="text-sm text-slate-400 mb-6">Set a security question.</p>
            <form id="update-sec-form" class="space-y-4">
              <input type="text" id="sec-q" placeholder="Security Question" required class="w-full px-5 py-4 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-medium shadow-sm">
              <input type="text" id="sec-a" placeholder="Secret Answer" required class="w-full px-5 py-4 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-medium shadow-sm">
              <button type="submit" class="btn-shine w-full bg-blue-500 text-white font-bold py-4 rounded-xl hover:bg-blue-600 hover:scale-[0.98] transition-transform shadow-lg shadow-blue-500/25 outline-none">Save Recovery Info</button>
            </form>
          </div>
        </div>
      </div>`;
    document.getElementById('change-pass-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await apiCall('changePassword', { rollNumber: currentUser.rollNumber, newPassword: document.getElementById('new-profile-pass').value });
      showToast(res?.message ?? 'Error', res?.success ? 'success' : 'error');
    });
    document.getElementById('update-sec-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await apiCall('updateSecurity', { rollNumber: currentUser.rollNumber, question: document.getElementById('sec-q').value, answer: document.getElementById('sec-a').value });
      showToast(res?.message ?? 'Error', res?.success ? 'success' : 'error');
    });
  }

  // ── FEEDBACK ───────────────────────────────────────────────────────
  else if (currentMainView === 'feedback') {
    document.getElementById('breadcrumb').innerHTML = '<span class="text-slate-900 dark:text-white font-black tracking-wide text-lg">Feedback</span>';
    if (currentUser.role === 'Student') {
      canvas.innerHTML = `
        ${offlineBanner}
        <div class="max-w-3xl mx-auto">
          <h1 class="text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-2">Have an Idea?</h1>
          <p class="text-slate-400 mb-8 font-medium">Report bugs or request features directly to the developer.</p>
          <div class="glass-card p-8 rounded-3xl border-t-4 border-blue-500 shadow-xl">
            <form id="submit-fb-form" class="space-y-5">
              <textarea id="fb-message" placeholder="Describe your feature idea or bug report here…" required class="w-full bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl px-5 py-4 text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-medium h-44 resize-none"></textarea>
              <button type="submit" id="fbBtn" class="btn-shine w-full bg-blue-500 text-white font-bold py-4 rounded-xl hover:bg-blue-600 hover:scale-[0.98] transition-transform shadow-xl shadow-blue-500/25 outline-none">Submit to Admin</button>
            </form>
          </div>
        </div>`;
      document.getElementById('submit-fb-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('fbBtn'); btn.textContent = 'Sending…'; btn.disabled = true;
        const res = await apiCall('submitFeedback', { name: currentUser.name, rollNumber: currentUser.rollNumber, message: document.getElementById('fb-message').value });
        if (res?.success) { showToast('Feedback sent!'); e.target.reset(); await forceSync(); }
        else showToast('Failed to send', 'error');
        btn.textContent = 'Submit to Admin'; btn.disabled = false;
      });
    } else {
      const fbs = [...(appData.feedbacks || [])].reverse();
      canvas.innerHTML = `
        ${offlineBanner}
        <h1 class="text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-10">Feedback Inbox <span class="ml-2 text-lg bg-blue-500 text-white px-3 py-1 rounded-full">${fbs.length}</span></h1>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 stagger">
          ${fbs.length === 0
            ? `<div class="col-span-full p-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-white/10 rounded-3xl">No feedback yet.</div>`
            : fbs.map((f,i) => `
              <div class="glass-card p-6 rounded-3xl flex flex-col justify-between anim-fade-up" style="animation-delay:${i*0.05}s">
                <div>
                  <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-3">
                      <div class="w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 font-black flex items-center justify-center">${esc(f.name).charAt(0)}</div>
                      <div><p class="text-sm font-bold text-slate-900 dark:text-white">${esc(f.name)}</p><p class="text-[10px] mono text-slate-400">${esc(f.rollNumber)}</p></div>
                    </div>
                    <span class="text-[10px] mono text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-1 rounded-lg">${new Date(f.timestamp).toLocaleDateString()}</span>
                  </div>
                  <p class="text-sm text-slate-600 dark:text-gray-300 leading-relaxed whitespace-pre-wrap mb-5">${esc(f.message)}</p>
                </div>
                <button onclick="resolveFeedback('${attr(f.timestamp)}','${attr(f.rollNumber)}')" class="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 py-2.5 rounded-xl transition-colors w-full outline-none">✓ Mark Resolved</button>
              </div>`).join('')}
        </div>`;
    }
  }

  // ── ADMIN ──────────────────────────────────────────────────────────
  else if (currentMainView === 'admin' && currentUser.role === 'Admin') {
    document.getElementById('breadcrumb').innerHTML = '<span class="text-blue-500 font-black tracking-wide text-lg">Admin Console</span>';
    const isOffline    = appData.systemStatus === 'Offline';
    const pendingResets = (appData.resets || []).filter(r => r.status === 'Pending');
    const recentAct    = [...(appData.logs || [])].reverse().slice(0, 12);

    canvas.innerHTML = `
      ${offlineBanner}
      <h1 class="text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-10 anim-fade-up">System Ops</h1>
      <div class="glass-card p-6 md:p-8 rounded-3xl mb-8 border-t-4 border-blue-500 shadow-md anim-scale-in">
        <h3 class="text-xs font-black text-slate-400 uppercase tracking-widest mb-5">Login Telemetry — Past 24h</h3>
        <div class="relative h-56 w-full"><canvas id="loginChart"></canvas></div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div class="glass-card p-8 rounded-3xl lg:col-span-2 shadow-sm">
          <div class="flex items-center justify-between mb-5">
            <h3 class="text-xl font-black text-slate-900 dark:text-white">Live Activity</h3>
            <button onclick="openLogsModal()" class="btn-shine text-xs bg-slate-900 dark:bg-white text-white dark:text-black px-4 py-2 rounded-xl font-bold shadow-md hover:scale-95 transition-transform outline-none">View & Flush Logs</button>
          </div>
          <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
            ${recentAct.length > 0 ? recentAct.map(l => `
              <div class="flex justify-between items-center p-3.5 bg-slate-50 dark:bg-white/[0.03] rounded-xl border border-transparent hover:border-slate-200 dark:hover:border-white/10 transition-colors">
                <span class="text-sm font-bold text-slate-800 dark:text-gray-200">${esc(l.name)} <span class="mono text-slate-400 font-normal text-xs">(${esc(l.rollNumber)})</span></span>
                <span class="mono text-[11px] text-slate-400 bg-slate-100 dark:bg-black/50 px-2 py-1 rounded-lg">${new Date(l.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
              </div>`).join('') : '<p class="text-sm text-slate-400 p-4">No activity yet.</p>'}
          </div>
        </div>
        <div class="glass-card p-8 rounded-3xl border border-red-500/25 shadow-sm self-start">
          <h3 class="text-xl font-black text-red-500 mb-2">Danger Zone</h3>
          <p class="text-sm text-slate-400 mb-6 font-medium">Block all student access.</p>
          <button onclick="toggleSystemState('${isOffline ? 'Online' : 'Offline'}')" class="btn-shine w-full ${isOffline ? 'bg-emerald-600 shadow-emerald-600/25' : 'bg-red-600 shadow-red-600/25'} shadow-lg text-white py-4 rounded-xl font-bold hover:scale-[0.98] transition-transform outline-none">
            ${isOffline ? '▶ Reactivate System' : '⏹ Shutdown System'}
          </button>
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="glass-card p-8 rounded-3xl shadow-sm">
          <h3 class="text-xl font-black text-slate-900 dark:text-white mb-6">Provision User</h3>
          <form id="cms-student-form" class="space-y-3">
            <input type="text" id="cms-stu-name" placeholder="Full Name" required class="w-full px-5 py-3.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-medium">
            <input type="text" id="cms-stu-roll" placeholder="Roll Number" required class="w-full px-5 py-3.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 mono uppercase text-slate-900 dark:text-white">
            <input type="tel"  id="cms-stu-phone" placeholder="Phone (optional)" class="w-full px-5 py-3.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-medium">
            <input type="email" id="cms-stu-email" placeholder="Email Address" required class="w-full px-5 py-3.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-medium">
            <select id="cms-stu-role" class="w-full px-5 py-3.5 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-700 dark:text-white font-bold">
              <option value="Student">Student</option>
              <option value="Admin">Administrator</option>
            </select>
            <button type="submit" class="btn-shine w-full bg-slate-900 dark:bg-white text-white dark:text-black py-4 rounded-xl font-bold hover:scale-[0.98] transition-transform shadow-lg outline-none">Create Account</button>
          </form>
        </div>
        <div class="glass-card p-8 rounded-3xl shadow-sm">
          <h3 class="text-xl font-black text-slate-900 dark:text-white mb-5 flex items-center justify-between">
            Security Alerts
            <span class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-500 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest">${pendingResets.length} Pending</span>
          </h3>
          <div class="space-y-3 max-h-72 overflow-y-auto pr-1">
            ${pendingResets.length === 0
              ? `<p class="text-sm text-slate-400 p-6 border border-dashed border-slate-200 dark:border-white/10 rounded-2xl text-center">No pending alerts.</p>`
              : pendingResets.map(r => `
                <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl">
                  <span class="mono font-bold text-slate-900 dark:text-white text-sm">${esc(r.rollNumber)}</span>
                  <button onclick="approveReset('${attr(r.rollNumber)}')" class="text-xs bg-slate-900 dark:bg-white text-white dark:text-black px-5 py-2 rounded-lg font-bold hover:scale-[0.98] transition-transform shadow-md outline-none">Authorize</button>
                </div>`).join('')}
          </div>
        </div>
      </div>`;
    setTimeout(renderAdminCharts, 100);

    document.getElementById('cms-student-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const roll = document.getElementById('cms-stu-roll').value.toUpperCase();
      const rowData = [document.getElementById('cms-stu-name').value, roll, document.getElementById('cms-stu-phone').value || '-', document.getElementById('cms-stu-email').value, roll, document.getElementById('cms-stu-role').value, 'Not Set', 'Not Set'];
      const res = await apiCall('addData', { role: currentUser.role, tabName: 'Users', rowData });
      if (res?.success) { showToast('Account created!'); await forceSync(); e.target.reset(); }
      else showToast(res?.message ?? 'Failed', 'error');
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  ATTENDANCE TABS — MANUAL MODE WITH HISTORY + EDIT
// ═══════════════════════════════════════════════════════════════════════
function renderAttendanceTabs(tab) {
  const manBtn = document.getElementById('tab-btn-manual');
  const qrBtn  = document.getElementById('tab-btn-qr');
  if (manBtn) manBtn.className = tab === 'manual' ? 'px-5 py-2.5 rounded-full font-bold text-sm bg-blue-500 text-white shadow-md transition-all outline-none' : 'px-5 py-2.5 rounded-full font-bold text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all outline-none';
  if (qrBtn)  qrBtn.className  = tab === 'qr'     ? 'px-5 py-2.5 rounded-full font-bold text-sm bg-indigo-600 text-white shadow-md transition-all outline-none' : 'px-5 py-2.5 rounded-full font-bold text-sm text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-all outline-none';

  if (qrScanner) { qrScanner.clear(); qrScanner = null; }
  if (qrGeneratorInterval) { clearInterval(qrGeneratorInterval); qrGeneratorInterval = null; }

  const area = document.getElementById('attendance-content-area');
  if (!area) return;

  if (tab === 'manual') {
    const allAtt = [...(appData.attendance || [])].reverse();

    let adminControls = '';
    if (currentUser.role === 'Admin') {
      const studentOptions = (appData.students || []).map(s =>
        `<label class="flex items-center gap-3 p-3 rounded-xl hover:bg-white dark:hover:bg-white/5 cursor-pointer border border-transparent hover:border-slate-200 dark:hover:border-white/10 transition-colors">
          <input type="checkbox" class="att-checkbox" value="${attr(s.rollNumber)}">
          <div class="overflow-hidden">
            <p class="text-sm font-bold text-slate-900 dark:text-white truncate">${esc(s.name)}</p>
            <p class="text-[10px] mono text-slate-400">${esc(s.rollNumber)}</p>
          </div>
        </label>`
      ).join('');

      adminControls = `
        <div class="flex flex-col md:flex-row gap-3 mb-8">
          <button onclick="openAttendanceEditor()" class="btn-shine bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-5 py-3.5 rounded-xl hover:scale-[0.98] transition-transform shadow-lg outline-none">+ Record New Hour</button>
          <button onclick="clearTodaysAttendance()" class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/25 text-red-600 dark:text-red-400 font-bold px-5 py-3.5 rounded-xl hover:bg-red-500 hover:text-white transition-colors outline-none">Clear Today's Logs</button>
        </div>

        <div id="attendance-form" class="glass-card p-6 md:p-8 rounded-3xl mb-10 hidden border-t-4 border-blue-500 shadow-xl">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-black text-slate-900 dark:text-white" id="att-editor-title">Log Attendance</h3>
            <button onclick="closeAttForm()" class="text-slate-400 hover:text-red-500 text-xs font-bold bg-slate-100 dark:bg-white/5 px-3 py-1.5 rounded-lg transition-colors">Cancel</button>
          </div>
          <form id="save-att-form" class="space-y-5">
            <input type="hidden" id="att-edit-date" value="">
            <div class="flex flex-col md:flex-row gap-4">
              <input type="text" id="att-hour" placeholder="Session / Hour Name (e.g. Hour 1)" required class="flex-1 px-5 py-4 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-bold">
              <select id="att-mode" onchange="document.getElementById('att-selection-text').textContent=this.value==='present'?'Mark students as PRESENT':'Mark students as ABSENT'" class="w-full md:w-64 px-5 py-4 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-sm outline-none focus:border-blue-500 text-slate-900 dark:text-white font-bold cursor-pointer">
                <option value="present">Mode: Select Present</option>
                <option value="absent">Mode: Select Absent</option>
              </select>
            </div>
            <div class="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-2xl p-4 max-h-96 overflow-y-auto">
              <div class="flex justify-between items-center mb-4 px-1">
                <span class="text-xs font-black text-slate-500 uppercase tracking-widest" id="att-selection-text">Mark students as PRESENT</span>
                <div class="flex gap-3">
                  <button type="button" onclick="document.querySelectorAll('.att-checkbox').forEach(c=>c.checked=true)" class="text-xs text-blue-500 font-bold hover:underline outline-none">All</button>
                  <button type="button" onclick="document.querySelectorAll('.att-checkbox').forEach(c=>c.checked=false)" class="text-xs text-slate-400 font-bold hover:underline outline-none">None</button>
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" id="att-student-list">${studentOptions}</div>
            </div>
            <button type="submit" id="saveAttBtn" class="btn-shine w-full bg-blue-500 text-white font-bold py-4 rounded-xl hover:bg-blue-600 hover:scale-[0.98] transition-transform shadow-xl shadow-blue-500/25 outline-none">Submit & Generate Codes</button>
          </form>
        </div>`;
    }

    const attCards = allAtt.map((a, i) => {
      const presentCount = a.present ? a.present.split(',').filter(x=>x.trim()).length : 0;
      const absentCount  = a.absent  ? a.absent.split(',').filter(x=>x.trim()).length  : 0;
      const dt = new Date(a.date);
      const isToday = dt.toDateString() === new Date().toDateString();
      const dateBadge = isToday
        ? `<span class="text-[10px] font-black bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2.5 py-1 rounded-lg">TODAY</span>`
        : `<span class="text-[10px] mono font-bold text-slate-400 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-2.5 py-1 rounded-lg">${dt.toLocaleDateString()}</span>`;

      let myStatus = '';
      if (currentUser.role === 'Student') {
        const presentList = a.present ? a.present.split(',').map(x=>x.trim()) : [];
        myStatus = presentList.includes(currentUser.rollNumber)
          ? `<div class="mt-4 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-black p-4 rounded-2xl text-center border border-emerald-200 dark:border-emerald-500/25">✓ PRESENT</div>`
          : `<div class="mt-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-black p-4 rounded-2xl text-center border border-red-200 dark:border-red-500/25">✕ ABSENT</div>`;
      }

      const adminBtns = currentUser.role === 'Admin'
        ? `<div class="flex gap-2 mt-5">
            <button onclick="showAttOutput('${attr(a.present||'')}','${attr(a.absent||'')}')" class="flex-1 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-900 dark:text-white py-2.5 rounded-xl text-xs font-bold transition-colors outline-none">View Codes</button>
            <button onclick="openAttendanceEditor('${attr(a.date)}','${attr(a.hour)}')" class="flex-1 bg-blue-500/10 hover:bg-blue-500 text-blue-500 hover:text-white py-2.5 rounded-xl text-xs font-bold transition-colors outline-none">Edit</button>
            <button onclick="deleteAttendanceSession('${attr(a.date)}','${attr(a.hour)}')" title="Delete Session" class="w-10 flex items-center justify-center bg-red-50 dark:bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-xl transition-colors outline-none shrink-0">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
           </div>` : '';

      return `<div class="glass-card p-6 md:p-7 rounded-3xl flex flex-col anim-fade-up" style="animation-delay:${i*0.04}s">
        <div class="flex items-start justify-between mb-5">
          <h3 class="text-xl font-black text-slate-900 dark:text-white">${esc(a.hour)}</h3>
          ${dateBadge}
        </div>
        <div class="flex gap-8 text-xs font-black text-slate-400 uppercase tracking-widest">
          <div class="flex flex-col gap-1">Present<span class="text-2xl text-slate-900 dark:text-white">${presentCount}</span></div>
          <div class="flex flex-col gap-1">Absent<span class="text-2xl text-slate-900 dark:text-white">${absentCount}</span></div>
        </div>
        ${myStatus}${adminBtns}
      </div>`;
    }).join('');

    area.innerHTML = `
      ${adminControls}
      <h2 class="text-xl font-bold text-slate-900 dark:text-white mb-5">All Sessions</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        ${attCards || `<div class="col-span-full p-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-white/10 rounded-3xl">No attendance sessions logged yet.</div>`}
      </div>`;

    if (currentUser.role === 'Admin') {
      document.getElementById('save-att-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('saveAttBtn');
        btn.textContent = 'Processing…'; btn.disabled = true; showLoading();

        const mode      = document.getElementById('att-mode').value;
        const checkboxes = document.querySelectorAll('.att-checkbox');
        const present = []; const absent = [];
        checkboxes.forEach(c => {
          if (mode === 'present') { (c.checked ? present : absent).push(c.value); }
          else                    { (c.checked ? absent  : present).push(c.value); }
        });

        const editDate = document.getElementById('att-edit-date').value;
        const payload  = {
          role:    currentUser.role,
          hour:    document.getElementById('att-hour').value,
          present: present.join(','),
          absent:  absent.join(','),
        };
        if (editDate) payload.editDate = editDate;

        const res = await apiCall('logAttendance', payload);
        hideLoading();
        if (res?.success) {
          showToast('Logged!', 'success');
          await forceSync();
          showAttOutput(present.join(','), absent.join(','));
        } else showToast('Error saving', 'error');
        btn.textContent = 'Submit & Generate Codes'; btn.disabled = false;
      });
    }
  }

  else if (tab === 'qr') {
    if (currentUser.role === 'Admin') {
      area.innerHTML = `
        <div class="glass-card p-8 rounded-3xl flex flex-col items-center text-center max-w-xl mx-auto border-t-4 border-indigo-600 shadow-xl">
          <h3 class="text-2xl font-black text-slate-900 dark:text-white mb-2">Dynamic QR Projector</h3>
          <p class="text-slate-400 text-sm font-medium mb-8">Code refreshes every 15 seconds. Students scan to register.</p>
          <input id="qr-session-name" type="text" placeholder="Session Name (e.g. Lab 1)" class="w-64 px-5 py-3.5 mb-6 bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl text-center font-bold outline-none focus:border-indigo-500 text-slate-900 dark:text-white">
          <div id="qr-wrapper" class="bg-white p-6 rounded-2xl shadow-inner border border-slate-200 mb-6 hidden"><div id="qrcode"></div></div>
          <button id="startQrBtn" onclick="startQRGenerator()" class="btn-shine bg-indigo-600 text-white font-black px-10 py-4 rounded-xl shadow-lg shadow-indigo-600/25 hover:scale-[0.98] transition-transform outline-none">Start Projection</button>
          <button id="stopQrBtn" onclick="switchMainView('attendance')" class="bg-red-500 text-white font-black px-10 py-4 rounded-xl shadow-lg hidden hover:scale-[0.98] transition-transform outline-none mt-3">Stop Session</button>
        </div>`;
    } else {
      area.innerHTML = `
        <div class="glass-card p-8 rounded-3xl flex flex-col items-center text-center max-w-xl mx-auto border-t-4 border-indigo-600 shadow-xl">
          <h3 class="text-2xl font-black text-slate-900 dark:text-white mb-2">Scan to Register</h3>
          <p class="text-slate-400 text-sm font-medium mb-8">Point camera at the projector screen.</p>
          <div id="qr-reader" class="w-full max-w-sm bg-black rounded-2xl overflow-hidden shadow-inner border border-slate-200 mb-6 min-h-[200px]"></div>
          <button onclick="startStudentScanner()" class="btn-shine bg-indigo-600 text-white font-black px-10 py-4 rounded-xl shadow-lg shadow-indigo-600/25 hover:scale-[0.98] transition-transform w-full outline-none">Open Camera</button>
        </div>`;
    }
  }
}

// ─── ATTENDANCE EDITOR ───────────────────────────────────────────────
window.openAttendanceEditor = function(dateStr = '', hour = '') {
  const form = document.getElementById('attendance-form');
  if (!form) return;
  form.classList.remove('hidden');
  document.getElementById('att-hour').value       = hour;
  document.getElementById('att-edit-date').value  = dateStr;
  document.getElementById('att-editor-title').textContent = dateStr ? 'Edit Attendance Record' : 'Log New Attendance';
  document.getElementById('att-mode').value       = 'present';
  document.getElementById('att-selection-text').textContent = 'Mark students as PRESENT';

  let preSelected = new Set();
  if (dateStr && hour) {
    const record = attendanceMap[`${dateStr}|${hour}`];
    if (record?.present) {
      record.present.split(',').map(r => r.trim()).filter(Boolean).forEach(r => preSelected.add(r));
    }
  }
  document.querySelectorAll('.att-checkbox').forEach(c => {
    c.checked = preSelected.has(c.value.trim());
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.closeAttForm = function() {
  document.getElementById('attendance-form').classList.add('hidden');
};

// ─── ADMIN CHARTS ─────────────────────────────────────────────────────
async function renderAdminCharts() {
  if (!document.getElementById('loginChart')) return;
  await loadScript('https://cdn.jsdelivr.net/npm/chart.js');
  const isDark = document.documentElement.classList.contains('dark');
  const textColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
  const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  const logs = appData.logs || [];
  const now  = new Date();
  const labels = []; const data = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now - i * 3600000);
    labels.push(`${String(d.getHours()).padStart(2,'0')}:00`);
    data.push(logs.filter(l => { const lt = new Date(l.timestamp); return lt.getHours() === d.getHours() && lt.getDate() === d.getDate(); }).length);
  }
  if (activeCharts.login) activeCharts.login.destroy();
  activeCharts.login = new Chart(document.getElementById('loginChart'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Logins', data, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', borderWidth: 2.5, tension: 0.45, fill: true, pointRadius: 3, pointBackgroundColor: '#3b82f6' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }, scales: { x: { ticks: { maxTicksLimit: 8, color: textColor, font: { family: "'JetBrains Mono'" } }, grid: { display: false } }, y: { ticks: { color: textColor, stepSize: 1 }, grid: { color: gridColor } } } }
  });
}

// ─── MODULE MODALS ────────────────────────────────────────────────────
function openModuleModal(type) {
  document.getElementById('mod-type').value = type;
  document.getElementById('mod-modal-title').textContent = type === 'Semester' ? 'Create Semester' : 'Add Subject';
  document.getElementById('mod-input-name').value = '';
  const m = document.getElementById('module-modal');
  m.classList.remove('hidden');
  requestAnimationFrame(() => m.classList.remove('opacity-0'));
}
function closeModuleModal() {
  const m = document.getElementById('module-modal');
  m.classList.add('opacity-0');
  setTimeout(() => m.classList.add('hidden'), 320);
}
document.getElementById('add-module-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn  = document.getElementById('addModuleBtn'); btn.textContent = 'Creating…'; btn.disabled = true; showLoading();
  const type = document.getElementById('mod-type').value;
  const name = document.getElementById('mod-input-name').value.trim();
  const row  = type === 'Semester' ? [name, 'General'] : [workspacePath.semester, name];
  const res  = await apiCall('addData', { role: currentUser.role, tabName: 'Modules', rowData: row });
  hideLoading();
  if (res?.success) { showToast('Folder created!'); closeModuleModal(); e.target.reset(); await forceSync(); }
  else showToast('Failed', 'error');
  btn.textContent = 'Create Folder'; btn.disabled = false;
});

// ─── RENAME MODAL ─────────────────────────────────────────────────────
window.openRenameModal = function(type, currentName) {
  document.getElementById('rename-type').value  = type;
  document.getElementById('rename-old').value   = currentName;
  document.getElementById('rename-new').value   = currentName;
  document.getElementById('rename-modal-title').textContent = `Rename ${type}`;
  const m = document.getElementById('rename-modal');
  m.classList.remove('hidden');
  requestAnimationFrame(() => m.classList.remove('opacity-0'));
  setTimeout(() => document.getElementById('rename-new').focus(), 350);
};
function closeRenameModal() {
  const m = document.getElementById('rename-modal');
  m.classList.add('opacity-0');
  setTimeout(() => m.classList.add('hidden'), 320);
}
document.getElementById('rename-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn      = document.getElementById('renameBtn'); btn.textContent = 'Saving…'; btn.disabled = true; showLoading();
  const oldName  = document.getElementById('rename-old').value;
  const newName  = document.getElementById('rename-new').value.trim();
  const type     = document.getElementById('rename-type').value;
  if (!newName || newName === oldName) { closeRenameModal(); btn.textContent = 'Save Name'; btn.disabled = false; hideLoading(); return; }
  const res = await apiCall('renameModule', { role: currentUser.role, semester: workspacePath.semester, oldSubject: oldName, newSubject: newName, type });
  hideLoading();
  if (res?.success) { showToast('Renamed!'); closeRenameModal(); await forceSync(); workspacePath.subject = null; renderCanvas(); }
  else showToast(res?.message ?? 'Failed', 'error');
  btn.textContent = 'Save Name'; btn.disabled = false;
});

// ─── RESOURCE MODAL ───────────────────────────────────────────────────
function openResourceModal(mode = 'create', type = 'Notes', title = '', link = '', date = '') {
  document.getElementById('res-mode').value = mode;
  if (mode === 'edit') {
    document.getElementById('res-modal-title').textContent = 'Edit Document';
    document.getElementById('res-type').value    = type;
    document.getElementById('res-type').disabled = true;
    document.getElementById('res-title').value   = title;
    document.getElementById('res-link').value    = link;
    document.getElementById('res-orig-type').value  = type;
    document.getElementById('res-orig-title').value = title;
    document.getElementById('res-orig-date').value  = date;
    document.getElementById('addResourceBtn').textContent = 'Save Changes';
  } else {
    document.getElementById('res-modal-title').textContent = 'Publish Content';
    document.getElementById('add-resource-form').reset();
    document.getElementById('res-type').disabled = false;
    document.getElementById('addResourceBtn').textContent = 'Publish to Ecosystem';
  }
  const m = document.getElementById('resource-modal');
  m.classList.remove('hidden');
  requestAnimationFrame(() => m.classList.remove('opacity-0'));
}
function closeModal() {
  const m = document.getElementById('resource-modal');
  m.classList.add('opacity-0');
  setTimeout(() => m.classList.add('hidden'), 320);
}
document.getElementById('add-resource-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('addResourceBtn'); btn.textContent = 'Processing…'; btn.disabled = true; showLoading();
  const isEdit = document.getElementById('res-mode').value === 'edit';
  let res;
  if (isEdit) {
    const row = [workspacePath.semester, document.getElementById('res-title').value, workspacePath.subject, document.getElementById('res-orig-date').value, document.getElementById('res-link').value];
    res = await apiCall('editData', { role: currentUser.role, tabName: document.getElementById('res-orig-type').value, conditions: { 1: document.getElementById('res-orig-title').value, 3: document.getElementById('res-orig-date').value }, newData: row });
  } else {
    res = await apiCall('addData', { role: currentUser.role, tabName: document.getElementById('res-type').value, rowData: [workspacePath.semester, document.getElementById('res-title').value, workspacePath.subject, new Date().toISOString(), document.getElementById('res-link').value] });
  }
  hideLoading();
  if (res?.success) { showToast('Saved!'); closeModal(); await forceSync(); }
  else showToast(res?.message ?? 'Error', 'error');
  btn.textContent = isEdit ? 'Save Changes' : 'Publish to Ecosystem'; btn.disabled = false;
});

// ─── ANNOUNCEMENTS ────────────────────────────────────────────────────
function openAnnModal(dateStr = null, title = null) {
  const form = document.getElementById('global-ann-form');
  if (dateStr && title) {
    const ann = appData.announcements?.find(a => a.date === dateStr && a.title === title);
    document.getElementById('ann-modal-title').textContent = 'Edit Notice';
    document.getElementById('g-ann-mode').value = 'edit';
    document.getElementById('g-ann-original-date').value = ann.date;
    document.getElementById('g-ann-title').value    = ann.title;
    document.getElementById('g-ann-priority').value = ann.priority || 'Normal';
    document.getElementById('g-ann-valid').value    = ann.validUntil ? new Date(ann.validUntil).toISOString().split('T')[0] : '';
    document.getElementById('g-ann-desc').value     = ann.description;
    document.getElementById('postAnnBtn').textContent = 'Save Changes';
  } else {
    document.getElementById('ann-modal-title').textContent = 'New Notice';
    document.getElementById('g-ann-mode').value = 'create';
    form.reset();
    document.getElementById('postAnnBtn').textContent = 'Publish Notice';
  }
  const m = document.getElementById('announcement-modal');
  m.classList.remove('hidden');
  requestAnimationFrame(() => m.classList.remove('opacity-0'));
}
function closeAnnModal() {
  const m = document.getElementById('announcement-modal');
  m.classList.add('opacity-0');
  setTimeout(() => m.classList.add('hidden'), 320);
}
document.getElementById('global-ann-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn  = document.getElementById('postAnnBtn'); btn.textContent = 'Processing…'; btn.disabled = true; showLoading();
  const isEdit  = document.getElementById('g-ann-mode').value === 'edit';
  const rowData = ['Global', document.getElementById('g-ann-title').value, 'Campus Notice',
    isEdit ? document.getElementById('g-ann-original-date').value : new Date().toISOString(),
    document.getElementById('g-ann-desc').value, document.getElementById('g-ann-priority').value,
    document.getElementById('g-ann-valid').value];
  if (document.getElementById('push-notify-check').checked && Notification?.permission === 'granted')
    new Notification(`Notice: ${document.getElementById('g-ann-title').value}`, { body: document.getElementById('g-ann-desc').value });
  const res = await apiCall(isEdit ? 'editData' : 'addData', isEdit
    ? { role: currentUser.role, tabName: 'Announcements', conditions: { 1: document.getElementById('g-ann-title').value, 3: document.getElementById('g-ann-original-date').value }, newData: rowData }
    : { role: currentUser.role, tabName: 'Announcements', rowData });
  hideLoading();
  if (res?.success) { showToast('Published!'); closeAnnModal(); await forceSync(); }
  btn.textContent = 'Publish Notice'; btn.disabled = false;
});

// ─── LOGS MODAL ───────────────────────────────────────────────────────
function openLogsModal() {
  const logs = [...(appData.logs || [])].reverse();
  const c    = document.getElementById('logs-container');
  if (!logs.length) { c.innerHTML = '<div class="p-10 text-center text-slate-400">No logs available.</div>'; }
  else {
    c.innerHTML = `<table class="w-full text-sm whitespace-nowrap">
      <thead class="bg-slate-100 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 sticky top-0">
        <tr>
          <th class="py-4 px-5 font-bold uppercase tracking-widest text-[10px] text-slate-400 text-left">Time</th>
          <th class="py-4 px-5 font-bold uppercase tracking-widest text-[10px] text-slate-400 text-left">Name</th>
          <th class="py-4 px-5 font-bold uppercase tracking-widest text-[10px] text-slate-400 text-left">Roll</th>
          <th class="py-4 px-5 font-bold uppercase tracking-widest text-[10px] text-slate-400 text-left">Role</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100 dark:divide-white/5">
        ${logs.map(l => `<tr class="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
          <td class="py-3 px-5 mono text-xs text-slate-400">${new Date(l.timestamp).toLocaleString()}</td>
          <td class="py-3 px-5 font-bold text-slate-900 dark:text-white">${esc(l.name)}</td>
          <td class="py-3 px-5 mono text-xs text-slate-400">${esc(l.rollNumber)}</td>
          <td class="py-3 px-5"><span class="px-2 py-1 rounded-md text-[9px] uppercase font-black bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-white">${esc(l.role)}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }
  const m = document.getElementById('logs-modal');
  m.classList.remove('hidden');
  requestAnimationFrame(() => m.classList.remove('opacity-0'));
}
function closeLogsModal() {
  const m = document.getElementById('logs-modal');
  m.classList.add('opacity-0');
  setTimeout(() => m.classList.add('hidden'), 320);
}
async function executeLogFlush() {
  if (!confirm('Permanently delete selected logs?')) return;
  const btn = document.getElementById('flushLogsBtn'); btn.textContent = 'Clearing…'; btn.disabled = true; showLoading();
  const res = await apiCall('flushLogs', { role: currentUser.role, timeRange: document.getElementById('log-flush-range').value });
  hideLoading();
  if (res?.success) { showToast(res.message); await forceSync(); openLogsModal(); }
  btn.textContent = 'Clear Data'; btn.disabled = false;
}

// ─── ATTENDANCE OUTPUT ────────────────────────────────────────────────
function showAttOutput(present, absent) {
  const clean = list => (list ? list.split(',').map(r => r.trim()).filter(Boolean).map(r => r.slice(-3)).join(', ') : 'None');
  document.getElementById('att-present-text').value = clean(present);
  document.getElementById('att-absent-text').value  = clean(absent);
  const m = document.getElementById('att-output-modal');
  m.classList.remove('hidden');
  requestAnimationFrame(() => m.classList.remove('opacity-0'));
}
function closeAttOutput() {
  const m = document.getElementById('att-output-modal');
  m.classList.add('opacity-0');
  setTimeout(() => m.classList.add('hidden'), 320);
}
function copyToClip(id) {
  const el = document.getElementById(id);
  el.select();
  document.execCommand('copy');
  showToast('Copied!');
}

// ─── ADMIN ACTIONS ────────────────────────────────────────────────────
async function toggleSystemState(state) {
  if (!confirm(`Set system to ${state}?`)) return;
  const res = await apiCall('toggleSystemStatus', { role: currentUser.role, status: state });
  if (res?.success) await forceSync();
}
async function deleteUser(roll) {
  if (!confirm(`Permanently delete user ${roll}?`)) return;
  const res = await apiCall('deleteData', { role: currentUser.role, tabName: 'Users', conditions: { 1: roll } });
  if (res?.success) await forceSync();
}
async function toggleUserRole(roll, currentRole) {
  const newRole = currentRole === 'Admin' ? 'Student' : 'Admin';
  if (!confirm(`Change privilege to ${newRole}?`)) return;
  const res = await apiCall('updateRole', { role: currentUser.role, targetRoll: roll, newRole });
  if (res?.success) await forceSync();
}
async function deleteModule(semester, subject) {
  if (!confirm('WARNING: This will permanently erase all contents. Continue?')) return;
  const res = await apiCall('deleteModule', { role: currentUser.role, semester, subject });
  if (res?.success) { await forceSync(); navEcosystem(); }
}
async function deleteRecord(tabName, dateStr, title) {
  if (!confirm('Permanently delete this item?')) return;
  const res = await apiCall('deleteData', { role: currentUser.role, tabName, conditions: { 1: title, 3: dateStr } });
  if (res?.success) { showToast('Deleted!'); await forceSync(); }
}
async function resolveFeedback(ts, roll) {
  if (!confirm('Mark as resolved and delete?')) return;
  const res = await apiCall('deleteFeedback', { role: currentUser.role, timestamp: ts, rollNumber: roll });
  if (res?.success) { showToast('Resolved!'); await forceSync(); switchMainView('feedback'); }
}
async function clearTodaysAttendance() {
  if (!confirm('Clear all attendance logged today?')) return;
  showLoading();
  const res = await apiCall('clearAttendance', { role: currentUser.role });
  hideLoading();
  if (res?.success) { showToast(res.message); await forceSync(); }
}
async function approveReset(roll) {
  const res = await apiCall('approveReset', { role: currentUser.role, rollNumber: roll });
  if (res?.success) { showToast('Reset approved!'); await forceSync(); }
}
window.deleteAttendanceSession = async function(dateStr, hour) {
  if (!confirm(`Permanently delete the attendance session "${hour}"?`)) return;
  showLoading();
  const res = await apiCall('deleteAttendanceRecord', { role: currentUser.role, date: dateStr, hour: hour });
  hideLoading();
  if (res?.success) {
    showToast('Session deleted!');
    await forceSync();
  } else {
    showToast(res?.message ?? 'Failed to delete', 'error');
  }
};
function exportCSV() {
  const rows = appData.students.map((s,i) => `${i+1},"${s.name}","${s.rollNumber}","${s.email}"`).join('\n');
  const blob = new Blob([`S.No,Name,Roll Number,Email\n${rows}`], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'Class_Directory.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── QR ENGINE ────────────────────────────────────────────────────────
async function startQRGenerator() {
  const session = document.getElementById('qr-session-name')?.value.trim();
  if (!session) { showToast('Enter a session name first.', 'error'); return; }
  document.getElementById('startQrBtn').classList.add('hidden');
  document.getElementById('qr-session-name').classList.add('hidden');
  document.getElementById('stopQrBtn').classList.remove('hidden');
  document.getElementById('qr-wrapper').classList.remove('hidden');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
  const qrDiv = document.getElementById('qrcode');
  const qr    = new QRCode(qrDiv, { width: 280, height: 280, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H });
  function refresh() { qr.clear(); qr.makeCode(JSON.stringify({ session, time: Date.now(), nonce: Math.random().toString(36).slice(2) })); }
  refresh();
  qrGeneratorInterval = setInterval(refresh, 15000);
  showToast('QR Projection live!');
}

async function startStudentScanner() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    stream.getTracks().forEach(t => t.stop());
  } catch {
    showToast('Camera permission denied.', 'error'); return;
  }
  document.getElementById('qr-reader').innerHTML = '<div class="p-6 text-white text-sm font-bold animate-pulse">Initializing scanner…</div>';
  await loadScript('https://unpkg.com/html5-qrcode');
  document.getElementById('qr-reader').innerHTML = '';
  qrScanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: { width: 240, height: 240 }, rememberLastUsedCamera: true });
  qrScanner.render(async (decoded) => {
    if (qrScanner) qrScanner.clear();
    showToast('Processing…'); showLoading();
    const res = await apiCall('qrAttendance', { qrText: decoded, rollNumber: currentUser.rollNumber });
    hideLoading();
    if (res?.success) { showToast('Attendance registered! ✅'); setTimeout(() => switchMainView('dashboard'), 1500); }
    else { showToast(res?.message ?? 'Error scanning', 'error'); setTimeout(startStudentScanner, 2500); }
  }, () => {});
}

// ─── BOOT ─────────────────────────────────────────────────────────────
if (localStorage.getItem('session')) {
  currentUser = JSON.parse(localStorage.getItem('session'));
  initApp();
} else {
  document.getElementById('auth-layout')?.classList.remove('opacity-0');
}
