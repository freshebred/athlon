/* home.js — Athlon Dashboard */

const HomePage = {
  data: null,

  async render() {
    const content = document.getElementById('tab-content');
    content.innerHTML = this._skeleton();

    try {
      const [balanceData, mealsData, workoutsData] = await Promise.all([
        API.balance.today(),
        API.meals.today(),
        API.workouts.today()
      ]);
      this.data = {
        balance:  balanceData.balance,
        meals:    balanceData.meals    || mealsData?.meals    || [],
        workouts: balanceData.workouts || workoutsData?.workouts || []
      };
      content.innerHTML = this._render();
      this._bind(content);
      if (window.lucide) lucide.createIcons({ nodes: [content] });
    } catch (err) {
      content.innerHTML = this._error();
      content.querySelector('#home-retry')?.addEventListener('click', () => this.render());
    }
  },

  _skeleton() {
    return `
      <div class="home-page">
        <!-- Balance skeleton -->
        <div class="balance-hero">
          <div class="skeleton skeleton-line short" style="height:13px;width:120px;margin-bottom:16px;"></div>
          <div class="skeleton skeleton-line" style="height:72px;width:65%;margin-bottom:20px;border-radius:8px;"></div>
          <div class="balance-stats-row">
            ${[1,2,3].map(() => `<div class="skeleton" style="height:50px;border-radius:var(--radius-sm);"></div>`).join('')}
          </div>
        </div>
        <!-- List skeletons -->
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${[1,2,3].map(() => `
            <div class="skeleton-card">
              <div class="skeleton skeleton-avatar"></div>
              <div class="skeleton-lines">
                <div class="skeleton skeleton-line medium"></div>
                <div class="skeleton skeleton-line short"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  _render() {
    const { balance, meals, workouts } = this.data;
    const bal      = balance?.currentBalance ?? 0;
    const tdee     = balance?.openingBalance  ?? balance?.tdee ?? 2000;
    const consumed = balance?.caloriesConsumed ?? 0;
    const earned   = balance?.caloriesBurnt   ?? 0;
    const carryover = balance?.carryover ?? 0;
    const isPos    = bal >= 0;
    const pct      = Math.min(100, Math.round((consumed / Math.max(tdee, 1)) * 100));
    const ringColor = pct > 100 ? 'var(--danger)' : pct > 85 ? 'var(--gold)' : 'var(--accent)';
    const circumference = 2 * Math.PI * 38;
    const offset        = circumference - (pct / 100) * circumference;

    return `
      <div class="home-page">

        ${carryover < 0 ? `
        <div class="carryover-banner">
          <i data-lucide="alert-triangle" class="icon-sm carryover-icon"></i>
          <div class="carryover-text">
            <strong>${formatCalories(Math.abs(carryover))} cal debt</strong> carried from yesterday. Stay focused today.
          </div>
        </div>` : ''}

        <!-- Balance Hero -->
        <div class="balance-hero">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
            <div style="flex:1;min-width:0;">
              <div class="balance-label">Today's Balance</div>
              <div class="balance-amount ${isPos ? 'positive' : 'negative'}" id="balance-amount">
                <span class="balance-currency">$</span>${formatCalories(Math.abs(bal))}
              </div>
              <div class="balance-kcal">${isPos ? 'Under budget — keep it up' : 'Over budget today — refocus'}</div>
            </div>
            <!-- Progress Ring -->
            <div style="flex-shrink:0;position:relative;">
              <svg width="88" height="88" viewBox="0 0 88 88" style="transform:rotate(-90deg);">
                <circle cx="44" cy="44" r="38" fill="none" stroke="var(--surface-3)" stroke-width="6"/>
                <circle cx="44" cy="44" r="38" fill="none"
                        stroke="${ringColor}" stroke-width="6"
                        stroke-dasharray="${circumference}"
                        stroke-dashoffset="${offset}"
                        stroke-linecap="round"
                        style="transition:stroke-dashoffset 0.6s ease;"/>
              </svg>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;">
                <span style="font-family:var(--font-heading);font-size:18px;font-weight:800;color:${ringColor};line-height:1;">${pct}%</span>
                <span style="font-size:10px;color:var(--text-3);letter-spacing:0.06em;text-transform:uppercase;">used</span>
              </div>
            </div>
          </div>

          <!-- Progress bar -->
          <div class="balance-progress-wrap">
            <div class="balance-progress-bar">
              <div class="balance-progress-fill ${pct > 100 ? 'danger' : ''}" style="width:${pct}%"></div>
            </div>
          </div>

          <!-- Stats row -->
          <div class="balance-stats-row">
            <div class="balance-stat">
              <span class="bs-value" style="color:var(--danger);">${Math.round(consumed)}</span>
              <span class="bs-label">Consumed</span>
            </div>
            <div class="balance-stat">
              <span class="bs-value" style="color:var(--gold);">${Math.round(earned)}</span>
              <span class="bs-label">Earned</span>
            </div>
            <div class="balance-stat">
              <span class="bs-value">${Math.round(tdee)}</span>
              <span class="bs-label">Budget</span>
            </div>
          </div>
        </div>

        <!-- Today's Meals -->
        <div class="today-section">
          <div class="section-header">
            <span class="section-title">Today's Meals</span>
            <button class="btn-ghost btn-sm" id="add-meal-btn" style="color:var(--accent);padding:8px 12px;">
              <i data-lucide="plus" class="icon-xs"></i> Add
            </button>
          </div>
          <div class="today-items" id="meals-list">
            ${meals?.length
              ? meals.filter(m => !m.isDeleted).map(m => this._mealCard(m)).join('')
              : `<div class="empty-state">
                   <i data-lucide="utensils" class="icon-lg empty-icon"></i>
                   <div class="empty-title">No meals yet</div>
                   <div class="empty-desc">Tap Add to log your first meal today</div>
                 </div>`
            }
          </div>
        </div>

        <!-- Today's Workouts -->
        <div class="today-section">
          <div class="section-header">
            <span class="section-title">Today's Workouts</span>
            <button class="btn-ghost btn-sm" id="add-workout-btn" style="color:var(--gold);padding:8px 12px;">
              <i data-lucide="plus" class="icon-xs"></i> Add
            </button>
          </div>
          <div class="today-items" id="workouts-list">
            ${workouts?.length
              ? workouts.map(w => this._workoutCard(w)).join('')
              : `<div class="empty-state">
                   <i data-lucide="dumbbell" class="icon-lg empty-icon"></i>
                   <div class="empty-title">No workouts yet</div>
                   <div class="empty-desc">Earn calories back by logging a workout</div>
                 </div>`
            }
          </div>
        </div>

      </div>
    `;
  },

  _mealCard(m) {
    const cals = Math.round(m.totalCalories || 0);
    const time  = formatTime(m.loggedAt);
    const ingCount = m.ingredients?.length || 0;
    return `
      <div class="item-card meal-item" data-id="${m._id || m.id}" data-name="${esc(m.name)}" data-cals="${cals}">
        <div class="item-icon-wrap">
          <i data-lucide="utensils" class="icon-sm"></i>
        </div>
        <div class="item-body">
          <div class="item-name">${esc(m.name)}</div>
          <div class="item-meta">${time} · ${ingCount} ingredient${ingCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="item-amount negative">-${cals}</div>
      </div>
    `;
  },

  _workoutCard(w) {
    const cals = Math.round(w.finalCaloriesBurnt ?? w.caloriesBurnt ?? 0);
    return `
      <div class="item-card workout-item" data-id="${w._id || w.id}" data-name="${esc(w.activityType || 'Workout')}">
        <div class="item-icon-wrap workout">
          <i data-lucide="dumbbell" class="icon-sm"></i>
        </div>
        <div class="item-body">
          <div class="item-name">${esc(w.activityType || 'Workout')}</div>
          <div class="item-meta">${formatTime(w.loggedAt)} · ${w.duration || 0} min · ${w.intensity || 'moderate'}</div>
        </div>
        <div class="item-amount earned">+${cals}</div>
      </div>
    `;
  },

  _error() {
    return `
      <div class="home-page">
        <div class="empty-state" style="min-height:60vh;">
          <i data-lucide="wifi-off" class="icon-xl empty-icon"></i>
          <div class="empty-title">Couldn't load dashboard</div>
          <div class="empty-desc">Check your connection and try again</div>
          <button class="btn-secondary" id="home-retry" style="max-width:200px;">Retry</button>
        </div>
      </div>
    `;
  },

  _bind(content) {
    content.querySelector('#add-meal-btn')?.addEventListener('click', () => App.navigateTo('log'));
    content.querySelector('#add-workout-btn')?.addEventListener('click', () => App.navigateTo('earn'));

    content.querySelectorAll('.meal-item').forEach(card => {
      card.addEventListener('click', () => this._mealOptions(card));
    });
    content.querySelectorAll('.workout-item').forEach(card => {
      card.addEventListener('click', () => this._workoutOptions(card));
    });
  },

  _mealOptions(card) {
    const { id, name, cals } = card.dataset;
    const meal = this.data.meals.find(m => (m._id || m.id) === id);
    const ingredientsHtml = meal && meal.ingredients && meal.ingredients.length > 0 
      ? `<div class="ingredients-list" style="margin: 12px 0; max-height: 150px; overflow-y: auto; text-align: left; background: var(--bg-card); padding: 8px; border-radius: 8px;">` + 
        meal.ingredients.map(ing => `
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px; padding-bottom:4px; border-bottom:1px solid var(--border);">
            <span style="color:var(--text-1);">${esc(ing.name)} ${ing.amount ? `(${ing.amount}${ing.unit || 'g'})` : ''}</span>
            <span style="color:var(--text-2);">${Math.round(ing.calories)} kcal</span>
          </div>
        `).join('') + `</div>`
      : `<p style="color:var(--text-2);font-size:13px;margin:12px 0;">No ingredients logged</p>`;

    showModal(`
      <div class="modal-handle"></div>
      <div class="modal-title">${name}</div>
      <p style="color:var(--text-2);font-size:15px;margin-bottom:4px;">${cals} calories</p>
      ${ingredientsHtml}
      <div class="modal-actions">
        <button class="btn-secondary" id="modal-dispute">
          <i data-lucide="message-circle" class="icon-sm"></i> Dispute with Max
        </button>
        <button class="btn-secondary btn-danger" id="modal-delete">
          <i data-lucide="trash-2" class="icon-sm"></i> Request Deletion
        </button>
        <button class="btn-ghost" id="modal-cancel" style="justify-content:center;">Cancel</button>
      </div>
    `);
    document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('modal-dispute')?.addEventListener('click', () => {
      closeModal();
      PTCoach.openWithContext({
        type: 'dispute_meal',
        referenceId: id,
        referenceType: 'MealLog',
        message: `I'd like to dispute the calorie count for ${name} (${cals} cal). Can you help me?`
      });
    });
    document.getElementById('modal-delete')?.addEventListener('click', () => {
      closeModal();
      PTCoach.openWithContext({
        type: 'dispute_meal',
        referenceId: id,
        referenceType: 'MealLog',
        message: `I need to delete the meal "${name}" from today. Can you approve that?`
      });
    });
  },

  _workoutOptions(card) {
    const { id, name } = card.dataset;
    showModal(`
      <div class="modal-handle"></div>
      <div class="modal-title">${name}</div>
      <div class="modal-actions">
        <button class="btn-secondary" id="modal-wk-dispute">
          <i data-lucide="message-circle" class="icon-sm"></i> Dispute Calories with Max
        </button>
        <button class="btn-ghost" id="modal-wk-cancel" style="justify-content:center;">Cancel</button>
      </div>
    `);
    document.getElementById('modal-wk-cancel')?.addEventListener('click', closeModal);
    document.getElementById('modal-wk-dispute')?.addEventListener('click', () => {
      closeModal();
      PTCoach.openWithContext({
        type: 'dispute_workout',
        referenceId: id,
        referenceType: 'WorkoutLog',
        message: `I want to dispute the calorie estimate for my ${name} workout.`
      });
    });
  }
};

/* ── Shared helpers ──────────────────────────────────────── */
function formatCalories(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

function showModal(html) {
  const overlay = document.getElementById('modal-overlay');
  const card    = document.getElementById('modal-card');
  if (!overlay || !card) return;
  card.innerHTML = html;
  overlay.classList.remove('hidden');
  if (window.lucide) lucide.createIcons({ nodes: [card] });
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
}

function closeModal() {
  document.getElementById('modal-overlay')?.classList.add('hidden');
}

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'info' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i data-lucide="${icons[type] || 'info'}" style="width:18px;height:18px;flex-shrink:0;"></i><span>${message}</span>`;
  container.appendChild(toast);
  if (window.lucide) lucide.createIcons({ nodes: [toast] });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
