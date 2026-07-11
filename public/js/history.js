/* history.js — History & Trends Page */

const HistoryPage = {
  data: null,

  async render() {
    const content = document.getElementById('tab-content');
    content.innerHTML = this._skeleton();

    try {
      const [mealsData, workoutsData, balanceHistory] = await Promise.all([
        API.meals.history(),
        API.workouts.history(),
        API.balance.history(14)
      ]);
      this.data = { meals: mealsData, workouts: workoutsData, balance: balanceHistory };
      content.innerHTML = this._renderFull();
      this._bindEvents(content);
      if (window.lucide) lucide.createIcons({ nodes: [content] });
    } catch (err) {
      content.innerHTML = `
        <div class="empty-state" style="min-height:60vh;">
          <div class="empty-icon"><i data-lucide="wifi-off" class="icon-lg"></i></div>
          <div class="empty-title">Couldn't load history</div>
          <div class="empty-desc">Check your connection and try again</div>
          <button class="btn btn-secondary" id="history-retry">Retry</button>
        </div>`;
      content.querySelector('#history-retry')?.addEventListener('click', () => this.render());
      if (window.lucide) lucide.createIcons({ nodes: [content] });
    }
  },

  _skeleton() {
    return `
      <div style="padding:16px; display:flex; flex-direction:column; gap:12px;">
        <div class="skeleton" style="height:28px; width:120px; border-radius:6px;"></div>
        <div class="skeleton" style="height:120px; border-radius:12px;"></div>
        ${[1,2,3,4].map(() => `
          <div class="skeleton-card">
            <div class="skeleton skeleton-avatar"></div>
            <div class="skeleton-lines">
              <div class="skeleton skeleton-line medium"></div>
              <div class="skeleton skeleton-line short"></div>
            </div>
          </div>
        `).join('')}
      </div>`;
  },

  _renderFull() {
    const meals = this.data?.meals?.meals || [];
    const workouts = this.data?.workouts?.workouts || this.data?.workouts || [];
    const balances = this.data?.balance?.balances || [];

    // Build per-day groups combining meals + workouts
    const dayMap = {};
    meals.forEach(m => {
      if (!dayMap[m.localDate]) dayMap[m.localDate] = { meals: [], workouts: [], balance: null };
      dayMap[m.localDate].meals.push(m);
    });
    workouts.forEach(w => {
      if (!dayMap[w.localDate]) dayMap[w.localDate] = { meals: [], workouts: [], balance: null };
      dayMap[w.localDate].workouts.push(w);
    });
    balances.forEach(b => {
      if (!dayMap[b.localDate]) dayMap[b.localDate] = { meals: [], workouts: [], balance: null };
      dayMap[b.localDate].balance = b;
    });

    const sortedDays = Object.keys(dayMap).sort((a, b) => b.localeCompare(a));

    if (!sortedDays.length) {
      return `
        <div class="empty-state" style="min-height:70vh;">
          <div class="empty-icon"><i data-lucide="clock" class="icon-lg"></i></div>
          <div class="empty-title">No history yet</div>
          <div class="empty-desc">Start logging meals and workouts to see your history here</div>
        </div>`;
    }

    return `
      <div class="history-page">
        <div class="page-header">
          <h2 class="page-title">History</h2>
          <p class="page-subtitle">${sortedDays.length} days tracked</p>
        </div>

        <!-- 14-day balance mini-chart -->
        ${this._renderBalanceChart(balances)}

        <!-- Daily Groups -->
        <div class="history-list" id="history-list">
          ${sortedDays.map(date => this._renderDayGroup(date, dayMap[date])).join('')}
        </div>
      </div>
    `;
  },

  _renderBalanceChart(balances) {
    if (!balances.length) return '';

    const last14 = balances.slice(-14);
    const maxAbs = Math.max(...last14.map(b => Math.abs(b.currentBalance)), 1);
    const barW = Math.floor(100 / last14.length);

    return `
      <div class="balance-chart-card">
        <div class="chart-header">
          <span class="chart-title">14-Day Balance</span>
          <span class="chart-legend">
            <span style="color:var(--accent);">■</span> Positive &nbsp;
            <span style="color:var(--danger);">■</span> Deficit
          </span>
        </div>
        <div class="mini-chart">
          ${last14.map(b => {
            const height = Math.round((Math.abs(b.currentBalance) / maxAbs) * 60);
            const color = b.currentBalance >= 0 ? 'var(--accent)' : 'var(--danger)';
            return `
              <div class="chart-bar-wrap" title="${b.localDate}: ${Math.round(b.currentBalance)} cal">
                <div class="chart-bar" style="height:${height}px; background:${color};"></div>
                <div class="chart-bar-label">${b.localDate.slice(5)}</div>
              </div>`;
          }).join('')}
        </div>
      </div>
    `;
  },

  _renderDayGroup(date, dayData) {
    const { meals, workouts, balance } = dayData;
    const totalConsumed = meals.reduce((s, m) => s + (m.totalCalories || 0), 0);
    const totalEarned   = workouts.reduce((s, w) => s + (w.finalCaloriesBurnt ?? w.caloriesBurnt ?? 0), 0);
    const netBalance    = balance?.currentBalance;
    const isPositive    = netBalance >= 0;

    return `
      <div class="history-day-group">
        <div class="history-day-header">
          <div class="history-day-date">${formatDate(date)}</div>
          <div class="history-day-balance ${netBalance !== undefined ? (isPositive ? 'positive' : 'negative') : ''}">
            ${netBalance !== undefined ? `${isPositive ? '+' : ''}${Math.round(netBalance)} cal` : ''}
          </div>
        </div>

        <div class="history-day-stats">
          <span class="hds-item"><i data-lucide="utensils" class="icon-xs"></i> ${Math.round(totalConsumed)} eaten</span>
          ${totalEarned ? `<span class="hds-item" style="color:var(--gold);"><i data-lucide="zap" class="icon-xs"></i> ${Math.round(totalEarned)} earned</span>` : ''}
        </div>

        <!-- Meals -->
        ${meals.map(m => `
          <div class="history-item meal-history-item" data-id="${m._id || m.id}" data-name="${this._esc(m.name)}" data-cals="${Math.round(m.totalCalories || 0)}">
            <div class="item-icon-wrap">
              <i data-lucide="utensils" class="icon-sm"></i>
            </div>
            <div class="item-body">
              <div class="item-name">${this._esc(m.name)}</div>
              <div class="item-meta">${formatTime(m.loggedAt)} · ${m.ingredients?.length || 0} ingredients · ${m.logType}</div>
            </div>
            <div class="item-amount negative">-${Math.round(m.totalCalories || 0)}</div>
            <button class="item-menu-btn" data-id="${m._id || m.id}" data-type="meal" aria-label="Options">
              <i data-lucide="more-vertical" class="icon-sm"></i>
            </button>
          </div>
        `).join('')}

        <!-- Workouts -->
        ${workouts.map(w => `
          <div class="history-item workout-history-item" data-id="${w._id || w.id}" data-name="${this._esc(w.activityType)}">
            <div class="item-icon-wrap workout">
              <i data-lucide="dumbbell" class="icon-sm"></i>
            </div>
            <div class="item-body">
              <div class="item-name">${this._esc(w.activityType)}</div>
              <div class="item-meta">${formatTime(w.loggedAt)} · ${w.duration}min · ${w.intensity}</div>
            </div>
            <div class="item-amount earned">+${Math.round(w.finalCaloriesBurnt ?? w.caloriesBurnt ?? 0)}</div>
            <button class="item-menu-btn" data-id="${w._id || w.id}" data-type="workout" aria-label="Options">
              <i data-lucide="more-vertical" class="icon-sm"></i>
            </button>
          </div>
        `).join('')}
      </div>
    `;
  },

  _bindEvents(content) {
    // Meal options
    content.querySelectorAll('.meal-history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const id = item.dataset.id;
        const name = item.dataset.name;
        const cals = item.dataset.cals;
        this._showMealOptions(id, name, cals);
      });
    });

    content.querySelectorAll('.item-menu-btn[data-type="meal"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const item = btn.closest('.history-item');
        const name = item.dataset.name;
        const cals = item.dataset.cals;
        this._showMealOptions(id, name, cals);
      });
    });

    // Workout options
    content.querySelectorAll('.item-menu-btn[data-type="workout"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const item = btn.closest('.history-item');
        const name = item.dataset.name;
        this._showWorkoutOptions(id, name);
      });
    });
  },

  _showMealOptions(id, name, cals) {
    const meal = (this.data?.meals?.meals || []).find(m => (m._id || m.id) === id);
    const ingredientsHtml = meal && meal.ingredients && meal.ingredients.length > 0 
      ? `<div class="ingredients-list" style="margin: 12px 0; max-height: 150px; overflow-y: auto; text-align: left; background: var(--bg-card); padding: 8px; border-radius: 8px;">` + 
        meal.ingredients.map(ing => `
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px; padding-bottom:4px; border-bottom:1px solid var(--border);">
            <span style="color:var(--text-1);">${this._esc(ing.name)} ${ing.amount ? `(${ing.amount}${ing.unit || 'g'})` : ''}</span>
            <span style="color:var(--text-2);">${Math.round(ing.calories)} kcal</span>
          </div>
        `).join('') + `</div>`
      : `<p style="color:var(--text-2);font-size:13px;margin:12px 0;">No ingredients logged</p>`;

    showModal(`
      <div class="modal-title">${this._esc(name)}</div>
      <p style="color:var(--text-2); font-size:0.875rem; margin-bottom:16px;">${cals} calories</p>
      ${ingredientsHtml}
      <div class="modal-actions">
        <button class="btn btn-secondary btn-full" id="history-dispute">
          <i data-lucide="message-circle" class="icon-sm"></i> Dispute with Max
        </button>
        <button class="btn btn-danger btn-full" id="history-delete">
          <i data-lucide="trash-2" class="icon-sm"></i> Request Deletion
        </button>
        <button class="btn btn-ghost btn-full" id="history-cancel">Cancel</button>
      </div>
    `);

    document.getElementById('history-cancel')?.addEventListener('click', closeModal);
    document.getElementById('history-dispute')?.addEventListener('click', () => {
      closeModal();
      PTCoach.openWithContext({
        type: 'dispute_meal',
        referenceId: id,
        referenceType: 'MealLog',
        message: `I want to dispute the calorie count for "${name}" (${cals} cal). Can you review it?`
      });
    });
    document.getElementById('history-delete')?.addEventListener('click', () => {
      closeModal();
      PTCoach.openWithContext({
        type: 'dispute_meal',
        referenceId: id,
        referenceType: 'MealLog',
        message: `I need to delete the meal "${name}" from my log. Can you approve that?`
      });
    });
  },

  _showWorkoutOptions(id, name) {
    showModal(`
      <div class="modal-title">${this._esc(name)}</div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-full" id="history-wk-dispute">
          <i data-lucide="message-circle" class="icon-sm"></i> Dispute Calories with Max
        </button>
        <button class="btn btn-ghost btn-full" id="history-wk-cancel">Cancel</button>
      </div>
    `);
    document.getElementById('history-wk-cancel')?.addEventListener('click', closeModal);
    document.getElementById('history-wk-dispute')?.addEventListener('click', () => {
      closeModal();
      PTCoach.openWithContext({
        type: 'dispute_workout',
        referenceId: id,
        referenceType: 'WorkoutLog',
        message: `I want to dispute the calorie burn estimate for my ${name} workout. Can you help?`
      });
    });
  },

  _esc(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
  }
};
