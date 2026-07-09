/* api.js — Athlon API Client + Utilities */

const API = {
  async request(method, path, body = null, isFormData = false) {
    const options = {
      method,
      credentials: 'include',
      headers: isFormData ? {} : { 'Content-Type': 'application/json' }
    };
    if (body) options.body = isFormData ? body : JSON.stringify(body);

    let res, data;
    try {
      res = await fetch('/api' + path, options);
      data = await res.json();
    } catch (err) {
      if (!res) throw new Error('Network error — please check your connection');
      throw new Error('Unexpected server response');
    }

    if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
    return data;
  },

  get:      (path)           => API.request('GET', path),
  post:     (path, body)     => API.request('POST', path, body),
  put:      (path, body)     => API.request('PUT', path, body),
  delete:   (path, body)     => API.request('DELETE', path, body),
  postForm: (path, fd)       => API.request('POST', path, fd, true),

  auth: {
    register: d  => API.post('/auth/register', d),
    login:    d  => API.post('/auth/login', d),
    logout:   () => API.post('/auth/logout'),
    me:       () => API.get('/auth/me')
  },

  onboarding: {
    chat: msg => API.post('/onboarding/chat', { message: msg })
  },

  balance: {
    today:   ()       => API.get('/balance/today'),
    history: (d = 30) => API.get('/balance/history?days=' + d)
  },

  meals: {
    analyzeName:  n       => API.post('/meals/analyze-name', { mealName: n }),
    analyzeImage: fd      => API.postForm('/meals/analyze-image', fd),
    usdaLookup:   i       => API.post('/meals/usda-lookup', { ingredients: i }),
    verify:       d       => API.post('/meals/verify', d),
    verifyEdit:   d       => API.post('/meals/verify-edit', d),
    log:          d       => API.post('/meals/log', d),
    manual:       d       => API.post('/meals/manual', d),
    today:        ()      => API.get('/meals/today'),
    history:      (p = 1) => API.get('/meals/history?page=' + p),
    edit:         (id, d) => API.put('/meals/' + id, d),
    delete:       (id, d) => API.delete('/meals/' + id, d)
  },

  workouts: {
    verifyImage:      fd => API.postForm('/workouts/verify-image', fd),
    estimateCalories: d  => API.post('/workouts/estimate-calories', d),
    log:              d  => API.post('/workouts/log', d),
    today:            () => API.get('/workouts/today'),
    history:          (p = 1) => API.get('/workouts/history?page=' + p)
  },

  ptCoach: {
    chat:          (msg, cid, ctx) => API.post('/pt-coach/chat', { message: msg, conversationId: cid, context: ctx }),
    startDispute:  d               => API.post('/pt-coach/start-dispute', d),
    conversations: ()              => API.get('/pt-coach/conversations')
  },

  notifications: {
    vapidKey:       () => API.get('/notifications/vapid-public-key'),
    subscribe:   (sub, tz) => API.post('/notifications/subscribe', { subscription: sub, timezone: tz }),
    unsubscribe:    () => API.post('/notifications/unsubscribe'),
    settings:       () => API.get('/notifications/settings'),
    updateSettings: d  => API.put('/notifications/settings', d),
    sendTest:       () => API.post('/notifications/send-test')
  },

  user: {
    profile:       () => API.get('/user/profile'),
    updateProfile: d  => API.put('/user/profile', d),
    updateTheme:   t  => API.put('/user/theme', { theme: t }),
    stats:         () => API.get('/user/stats')
  },

  version: {
    check: () => fetch('/api/version').then(r => r.json())
  }
};

/* ── Toast ────────────────────────────────────────────────────────────────── */
function showToast(message, type = 'success', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconName = type === 'success' ? 'check-circle'
                 : type === 'error'   ? 'x-circle'
                 : type === 'warning' ? 'alert-triangle'
                 : 'info';

  toast.innerHTML = `<i data-lucide="${iconName}" class="icon-sm"></i><span>${message}</span>`;
  container.appendChild(toast);

  if (window.lucide) lucide.createIcons({ nodes: [toast] });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ── Modal ────────────────────────────────────────────────────────────────── */
function showModal(html, onClose) {
  const overlay = document.getElementById('modal-overlay');
  const card    = document.getElementById('modal-card');
  card.innerHTML = html;
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('show'));
  if (window.lucide) lucide.createIcons({ nodes: [card] });

  overlay.onclick = e => {
    if (e.target === overlay) {
      closeModal();
      onClose?.();
    }
  };
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('show');
  setTimeout(() => overlay.classList.add('hidden'), 250);
}

/* ── Formatters ───────────────────────────────────────────────────────────── */
function formatBalance(amount) {
  const abs = Math.abs(Math.round(amount));
  return (amount < 0 ? '-' : '') + abs.toLocaleString() + ' cal';
}

function formatCalories(amount) {
  return Math.round(amount).toLocaleString() + ' cal';
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  const d         = new Date(dateStr + 'T12:00:00Z');
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString())     return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

/* ── Image to Base64 ──────────────────────────────────────────────────────── */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ── URL Base64 → Uint8Array (for push) ──────────────────────────────────── */
function urlBase64ToUint8Array(base64String) {
  const padding  = '='.repeat((4 - base64String.length % 4) % 4);
  const base64   = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData  = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
