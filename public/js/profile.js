/* profile.js — Profile, Settings & Notifications Page */

const ProfilePage = {
  data: null,

  async render() {
    const content = document.getElementById('tab-content');
    content.innerHTML = this._skeleton();

    try {
      const [profileData, notifSettings] = await Promise.all([
        API.user.profile(),
        API.notifications.settings()
      ]);
      this.data = { profile: profileData.user, notif: notifSettings };
      content.innerHTML = this._renderFull();
      this._bindEvents(content);
      if (window.lucide) lucide.createIcons({ nodes: [content] });
    } catch (err) {
      content.innerHTML = `<div class="empty-state" style="min-height:60vh;">
        <div class="empty-icon"><i data-lucide="user-x" class="icon-lg"></i></div>
        <div class="empty-title">Couldn't load profile</div>
        <button class="btn btn-secondary" id="profile-retry">Retry</button>
      </div>`;
      content.querySelector('#profile-retry')?.addEventListener('click', () => this.render());
      if (window.lucide) lucide.createIcons({ nodes: [content] });
    }
  },

  _skeleton() {
    return `<div style="padding:16px; display:flex; flex-direction:column; gap:12px;">
      <div class="skeleton" style="height:100px; border-radius:16px;"></div>
      <div class="skeleton" style="height:200px; border-radius:12px;"></div>
      <div class="skeleton" style="height:160px; border-radius:12px;"></div>
    </div>`;
  },

  _renderFull() {
    const user  = this.data.profile || {};
    const notif = this.data.notif || {};
    const p     = user.profile || {};

    const initials = getInitials(user.name);
    const tdee = p.tdee || '–';
    const goalLabel = { lose: '🔻 Lose weight', maintain: '⚖️ Maintain', gain: '📈 Gain muscle' }[p.goal] || '–';

    return `
      <div class="profile-page">
        <!-- Header Card -->
        <div class="profile-header-card">
          <div class="profile-avatar">${initials}</div>
          <div class="profile-info">
            <div class="profile-name">${this._esc(user.name || 'User')}</div>
            <div class="profile-email">${this._esc(user.email || '')}</div>
          </div>
          <button class="icon-btn" id="edit-profile-btn" aria-label="Edit profile">
            <i data-lucide="edit-2" class="icon-sm"></i>
          </button>
        </div>

        <!-- Stats Card -->
        <div class="settings-card">
          <div class="settings-card-title">Body Stats</div>
          <div class="stats-grid-2">
            <div class="stat-row">
              <span class="sr-label">TDEE</span>
              <span class="sr-value">${tdee} kcal</span>
            </div>
            <div class="stat-row">
              <span class="sr-label">Goal</span>
              <span class="sr-value">${goalLabel}</span>
            </div>
            <div class="stat-row">
              <span class="sr-label">Weight</span>
              <span class="sr-value">${p.weight ? p.weight + (p.unitSystem === 'imperial' ? ' lbs' : ' kg') : '–'}</span>
            </div>
            <div class="stat-row">
              <span class="sr-label">Height</span>
              <span class="sr-value">${p.height ? p.height + (p.unitSystem === 'imperial' ? ' in' : ' cm') : '–'}</span>
            </div>
            <div class="stat-row">
              <span class="sr-label">Activity</span>
              <span class="sr-value">${p.activityLevel?.replace('_', ' ') || '–'}</span>
            </div>
            <div class="stat-row">
              <span class="sr-label">Units</span>
              <span class="sr-value">${p.unitSystem || 'metric'}</span>
            </div>
          </div>
        </div>

        <!-- Notifications -->
        <div class="settings-card">
          <div class="settings-card-title">Push Notifications</div>
          <div class="settings-row">
            <div class="settings-row-info">
              <span class="settings-row-label">Enable notifications</span>
              <span class="settings-row-desc">Meal & workout reminders</span>
            </div>
            <label class="toggle-switch" aria-label="Toggle notifications">
              <input type="checkbox" id="notif-toggle" ${notif.enabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>

          <div id="notif-times-section" class="${notif.enabled ? '' : 'hidden'}">
            <div class="notif-times-label">Reminder Times</div>
            <div id="notif-times-list">
              ${(notif.times || []).map((t, i) => `
                <div class="notif-time-row">
                  <span class="notif-time-label">${this._esc(t.label || 'Reminder')}</span>
                  <input type="time" class="time-input" id="notif-time-${i}"
                         value="${String(t.hour).padStart(2, '0')}:${String(t.minute || 0).padStart(2, '0')}">
                </div>
              `).join('')}
            </div>
            <button class="btn btn-secondary btn-sm" id="save-notif-btn">
              <i data-lucide="save" class="icon-sm"></i> Save Times
            </button>
            <button class="btn btn-ghost btn-sm" id="test-notif-btn">
              <i data-lucide="bell" class="icon-sm"></i> Send Test
            </button>
          </div>
        </div>

        <!-- Appearance -->
        <div class="settings-card">
          <div class="settings-card-title">Appearance</div>
          <div class="settings-row">
            <div class="settings-row-info">
              <span class="settings-row-label">Theme</span>
              <span class="settings-row-desc">Dark mode preferred</span>
            </div>
            <div class="theme-btns">
              <button class="theme-option-btn ${(user.theme || 'dark') === 'dark' ? 'active' : ''}" data-theme="dark">
                <i data-lucide="moon" class="icon-sm"></i> Dark
              </button>
              <button class="theme-option-btn ${(user.theme || 'dark') === 'light' ? 'active' : ''}" data-theme="light">
                <i data-lucide="sun" class="icon-sm"></i> Light
              </button>
            </div>
          </div>
        </div>

        <!-- Units -->
        <div class="settings-card">
          <div class="settings-card-title">Measurement Units</div>
          <div class="unit-selector">
            <button class="unit-btn ${(p.unitSystem || 'metric') === 'metric' ? 'active' : ''}" data-unit="metric">
              Metric (kg, cm)
            </button>
            <button class="unit-btn ${(p.unitSystem || 'metric') === 'imperial' ? 'active' : ''}" data-unit="imperial">
              Imperial (lbs, in)
            </button>
          </div>
        </div>

        <!-- Danger Zone -->
        <div class="settings-card danger-zone">
          <div class="settings-card-title" style="color:var(--danger);">Account</div>
          <button class="btn btn-ghost btn-full" id="logout-btn">
            <i data-lucide="log-out" class="icon-sm"></i> Sign Out
          </button>
        </div>
      </div>
    `;
  },

  _bindEvents(content) {
    // Edit profile
    content.querySelector('#edit-profile-btn')?.addEventListener('click', () => this._showEditModal());

    // Notification toggle
    const notifToggle = content.querySelector('#notif-toggle');
    notifToggle?.addEventListener('change', async () => {
      const enabled = notifToggle.checked;
      const section = content.querySelector('#notif-times-section');

      if (enabled) {
        section?.classList.remove('hidden');
        await this._enableNotifications();
      } else {
        section?.classList.add('hidden');
        try {
          await API.notifications.unsubscribe();
          showToast('Notifications disabled', 'info');
        } catch {}
      }
    });

    // Save notification times
    content.querySelector('#save-notif-btn')?.addEventListener('click', async () => {
      const times = [];
      const rows = content.querySelectorAll('[id^="notif-time-"]');
      rows.forEach((inp, i) => {
        const [h, m] = inp.value.split(':').map(Number);
        const labels = (this.data?.notif?.times || []);
        times.push({ hour: h, minute: m, label: labels[i]?.label || 'Reminder' });
      });

      try {
        await API.notifications.updateSettings({ times });
        showToast('Notification times saved', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to save', 'error');
      }
    });

    // Test notification
    content.querySelector('#test-notif-btn')?.addEventListener('click', async () => {
      try {
        await API.notifications.sendTest();
        showToast('Test notification sent!', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to send test', 'error');
      }
    });

    // Theme buttons
    content.querySelectorAll('.theme-option-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const theme = btn.dataset.theme;
        document.documentElement.setAttribute('data-theme', theme);
        content.querySelectorAll('.theme-option-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        App._updateThemeIcon(theme);
        try { await API.user.updateTheme(theme); } catch {}
      });
    });

    // Unit selector
    content.querySelectorAll('.unit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const unit = btn.dataset.unit;
        content.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        try {
          await API.user.updateProfile({ unitSystem: unit });
          showToast(`Switched to ${unit} units`, 'success');
        } catch {}
      });
    });

    // Logout
    content.querySelector('#logout-btn')?.addEventListener('click', () => this._logout());
  },

  async _enableNotifications() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      showToast('Push notifications not supported on this device', 'warning');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Notification permission denied', 'warning');
        return;
      }

      const keyData = await API.notifications.vapidKey();
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.vapidPublicKey)
      });

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await API.notifications.subscribe(subscription.toJSON(), tz);
      showToast('Notifications enabled! 🔔', 'success');
    } catch (err) {
      showToast('Failed to enable notifications: ' + (err.message || ''), 'error');
    }
  },

  _showEditModal() {
    const p = this.data?.profile?.profile || {};
    const u = this.data?.profile || {};

    showModal(`
      <div class="modal-title">Edit Profile</div>
      <div class="modal-form">
        <div class="input-group">
          <input type="text" id="edit-name" class="input" placeholder="Full name" value="${this._esc(u.name || '')}">
        </div>
        <div class="input-row">
          <div class="input-group flex-1">
            <input type="number" id="edit-weight" class="input" placeholder="Weight" value="${p.weight || ''}" min="20" max="300">
            <span class="input-unit">${(p.unitSystem || 'metric') === 'imperial' ? 'lbs' : 'kg'}</span>
          </div>
          <div class="input-group flex-1">
            <input type="number" id="edit-height" class="input" placeholder="Height" value="${p.height || ''}" min="50" max="300">
            <span class="input-unit">${(p.unitSystem || 'metric') === 'imperial' ? 'in' : 'cm'}</span>
          </div>
        </div>
        <select id="edit-goal" class="input select">
          <option value="lose" ${p.goal === 'lose' ? 'selected' : ''}>Lose weight (-500 kcal)</option>
          <option value="maintain" ${p.goal === 'maintain' ? 'selected' : ''}>Maintain weight</option>
          <option value="gain" ${p.goal === 'gain' ? 'selected' : ''}>Gain muscle (+300 kcal)</option>
        </select>
        <select id="edit-activity" class="input select">
          <option value="sedentary" ${p.activityLevel === 'sedentary' ? 'selected' : ''}>Sedentary (×1.2)</option>
          <option value="light" ${p.activityLevel === 'light' ? 'selected' : ''}>Lightly active (×1.375)</option>
          <option value="moderate" ${p.activityLevel === 'moderate' ? 'selected' : ''}>Moderately active (×1.55)</option>
          <option value="active" ${p.activityLevel === 'active' ? 'selected' : ''}>Very active (×1.725)</option>
          <option value="very_active" ${p.activityLevel === 'very_active' ? 'selected' : ''}>Extremely active (×1.9)</option>
        </select>
        <div class="modal-actions">
          <button class="btn btn-primary btn-full" id="save-profile-btn">Save Changes</button>
          <button class="btn btn-ghost btn-full" id="cancel-edit-btn">Cancel</button>
        </div>
      </div>
    `);

    document.getElementById('cancel-edit-btn')?.addEventListener('click', closeModal);
    document.getElementById('save-profile-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('save-profile-btn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        const updates = {
          name:          document.getElementById('edit-name')?.value?.trim() || undefined,
          weight:        parseFloat(document.getElementById('edit-weight')?.value) || undefined,
          height:        parseFloat(document.getElementById('edit-height')?.value) || undefined,
          goal:          document.getElementById('edit-goal')?.value || undefined,
          activityLevel: document.getElementById('edit-activity')?.value || undefined
        };
        // Remove undefined
        Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);

        await API.user.updateProfile(updates);
        showToast('Profile updated! TDEE recalculated.', 'success');
        closeModal();
        this.render(); // Refresh
      } catch (err) {
        showToast(err.message || 'Failed to update profile', 'error');
        btn.disabled = false;
        btn.textContent = 'Save Changes';
      }
    });
  },

  async _logout() {
    showModal(`
      <div class="modal-title">Sign Out?</div>
      <p style="color:var(--text-2); margin-bottom:20px;">You'll need to sign in again to use Athlon.</p>
      <div class="modal-actions">
        <button class="btn btn-danger btn-full" id="confirm-logout">Sign Out</button>
        <button class="btn btn-ghost btn-full" id="cancel-logout">Cancel</button>
      </div>
    `);
    document.getElementById('cancel-logout')?.addEventListener('click', closeModal);
    document.getElementById('confirm-logout')?.addEventListener('click', async () => {
      try {
        await API.auth.logout();
      } catch {}
      window.location.reload();
    });
  },

  _esc(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
  }
};
