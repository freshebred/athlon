/* earn.js — Workout Logging Page (Earn calorie credits) */

const EarnPage = {
  state: {
    step: 'entry',      // 'entry' | 'verify' | 'result'
    workout: null,
    imageFile: null,
    imageBase64: null,
    calorieResult: null,
    verifyResult: null,
    loading: false
  },

  render() {
    const content = document.getElementById('tab-content');
    content.innerHTML = this._renderStep();
    this._bindEvents(content);
    if (window.lucide) lucide.createIcons({ nodes: [content] });
  },

  _renderStep() {
    switch (this.state.step) {
      case 'result': return this._renderResult();
      default:       return this._renderEntry();
    }
  },

  // ── Entry Form ─────────────────────────────────────────────────────────────
  _renderEntry() {
    const activities = [
      { id: 'Running', icon: 'footprints', label: 'Running' },
      { id: 'Cycling', icon: 'bike', label: 'Cycling' },
      { id: 'Weightlifting', icon: 'dumbbell', label: 'Weights' },
      { id: 'HIIT', icon: 'zap', label: 'HIIT' },
      { id: 'Swimming', icon: 'waves', label: 'Swimming' },
      { id: 'Yoga', icon: 'flower-2', label: 'Yoga' },
      { id: 'Basketball', icon: 'circle-dot', label: 'Basketball' },
      { id: 'Walking', icon: 'person-walking', label: 'Walking' },
      { id: 'Other', icon: 'activity', label: 'Other' }
    ];

    return `
      <div class="earn-page">
        <div class="page-header">
          <h2 class="page-title">Earn Calories</h2>
          <p class="page-subtitle">Log a workout to earn back your budget</p>
        </div>

        <!-- Earn explainer -->
        <div class="earn-info-card">
          <i data-lucide="trending-up" class="icon-sm" style="color:var(--gold);"></i>
          <span>Every workout earns calories back into your daily budget</span>
        </div>

        <!-- Activity Type -->
        <div class="section-title-sm">Activity Type</div>
        <div class="activity-grid" id="activity-grid">
          ${activities.map(a => `
            <button class="activity-chip ${this.state.workout?.activityType === a.id ? 'selected' : ''}"
                    data-activity="${a.id}" aria-label="${a.label}">
              <i data-lucide="${a.icon}" class="icon-sm"></i>
              <span>${a.label}</span>
            </button>
          `).join('')}
        </div>

        <!-- Duration -->
        <div class="section-title-sm" style="margin-top:20px;">Duration</div>
        <div class="duration-control">
          <button class="dur-btn" id="dur-minus"><i data-lucide="minus" class="icon-sm"></i></button>
          <div class="dur-display">
            <span id="dur-value">${this.state.workout?.duration || 30}</span>
            <span class="dur-unit">min</span>
          </div>
          <button class="dur-btn" id="dur-plus"><i data-lucide="plus" class="icon-sm"></i></button>
        </div>
        <input type="range" id="dur-slider" class="duration-slider"
               min="5" max="180" step="5" value="${this.state.workout?.duration || 30}">

        <!-- Intensity -->
        <div class="section-title-sm" style="margin-top:20px;">Intensity</div>
        <div class="intensity-row">
          ${['low', 'moderate', 'high', 'extreme'].map(lvl => `
            <button class="intensity-btn ${(this.state.workout?.intensity || 'moderate') === lvl ? 'selected' : ''}"
                    data-intensity="${lvl}">
              ${lvl.charAt(0).toUpperCase() + lvl.slice(1)}
            </button>
          `).join('')}
        </div>

        <!-- Optional description -->
        <div class="section-title-sm" style="margin-top:20px;">Description (optional)</div>
        <textarea id="workout-desc" class="textarea" rows="2"
                  placeholder="e.g. 5km run at 6 min/km pace">${this.state.workout?.description || ''}</textarea>

        <!-- Optional image proof -->
        <div class="section-title-sm" style="margin-top:20px;">Proof Photo (optional)</div>
        <div class="image-upload-area compact" id="proof-drop-zone">
          <i data-lucide="camera" class="icon-sm"></i>
          <span>Upload workout screenshot or gym selfie</span>
          <input type="file" id="proof-file" accept="image/*" hidden>
        </div>
        <div id="proof-preview-wrap" class="hidden">
          <img id="proof-preview" class="proof-image-preview" alt="Proof">
          <button class="btn btn-ghost btn-sm" id="clear-proof-btn">
            <i data-lucide="x" class="icon-sm"></i> Remove
          </button>
        </div>

        <!-- Log Workout -->
        <div class="log-action-bar">
          <button class="btn btn-primary btn-full" id="log-workout-btn">
            <i data-lucide="zap" class="icon-sm"></i> Calculate Calories Earned
          </button>
        </div>
      </div>
    `;
  },

  // ── Result ─────────────────────────────────────────────────────────────────
  _renderResult() {
    const cal = this.state.calorieResult;
    const wo  = this.state.workout;
    const rawCal = cal?.rawEstimate || 0;
    const finalCal = cal?.adjustedEstimate || 0;
    const verifyResult = this.state.verifyResult;

    return `
      <div class="earn-page">
        <div class="page-header-row">
          <button class="btn btn-ghost btn-sm" id="back-to-entry">
            <i data-lucide="arrow-left" class="icon-sm"></i>
          </button>
          <h2 class="page-title flex-1">Calories Earned</h2>
        </div>

        <!-- Result Card -->
        <div class="earn-result-card">
          <div class="earn-icon"><i data-lucide="zap" class="icon-lg" style="color:var(--gold);"></i></div>
          <div class="earn-cals">+${Math.round(finalCal)}</div>
          <div class="earn-cals-label">calories earned</div>
          <div class="earn-meta-row">
            <div class="earn-meta-item">
              <span class="em-label">Activity</span>
              <span class="em-value">${wo?.activityType}</span>
            </div>
            <div class="earn-meta-item">
              <span class="em-label">Duration</span>
              <span class="em-value">${wo?.duration} min</span>
            </div>
            <div class="earn-meta-item">
              <span class="em-label">Intensity</span>
              <span class="em-value">${wo?.intensity}</span>
            </div>
          </div>
          <div class="earn-disclaimer">
            <i data-lucide="info" class="icon-xs"></i>
            Estimate reduced by 10% to be conservative (${Math.round(rawCal)} raw → ${Math.round(finalCal)} credited)
          </div>
        </div>

        <!-- Image verification result -->
        ${verifyResult ? `
          <div class="ai-verdict-banner">
            <i data-lucide="${verifyResult.verified ? 'shield-check' : 'shield-alert'}" class="icon-sm"
               style="color:${verifyResult.verified ? 'var(--accent)' : 'var(--gold)'};"></i>
            <div>
              <div class="verdict-title">AI Image Verification</div>
              <div class="verdict-text">${this._esc(verifyResult.verdict || 'Photo checked.')}</div>
            </div>
          </div>
        ` : ''}

        <!-- Actions -->
        <div class="earn-actions">
          <button class="btn btn-primary btn-full" id="confirm-earn-btn">
            <i data-lucide="check" class="icon-sm"></i> Save Workout
          </button>
          <button class="btn btn-ghost btn-full" id="dispute-earn-btn">
            <i data-lucide="message-circle" class="icon-sm"></i> Dispute with Max
          </button>
        </div>
      </div>
    `;
  },

  // ── Event Binding ──────────────────────────────────────────────────────────
  _bindEvents(content) {
    if (this.state.step === 'entry')  this._bindEntryEvents(content);
    if (this.state.step === 'result') this._bindResultEvents(content);
  },

  _bindEntryEvents(content) {
    // Duration controls
    let duration = this.state.workout?.duration || 30;
    const durVal = content.querySelector('#dur-value');
    const durSlider = content.querySelector('#dur-slider');

    const updateDur = (v) => {
      duration = Math.max(5, Math.min(180, v));
      if (durVal) durVal.textContent = duration;
      if (durSlider) durSlider.value = duration;
    };

    content.querySelector('#dur-minus')?.addEventListener('click', () => updateDur(duration - 5));
    content.querySelector('#dur-plus')?.addEventListener('click', () => updateDur(duration + 5));
    durSlider?.addEventListener('input', () => updateDur(parseInt(durSlider.value)));

    // Activity selection
    let selectedActivity = this.state.workout?.activityType || null;
    content.querySelectorAll('.activity-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        content.querySelectorAll('.activity-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedActivity = chip.dataset.activity;
      });
    });

    // Intensity
    let selectedIntensity = this.state.workout?.intensity || 'moderate';
    content.querySelectorAll('.intensity-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        content.querySelectorAll('.intensity-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedIntensity = btn.dataset.intensity;
      });
    });

    // Image proof
    const proofZone = content.querySelector('#proof-drop-zone');
    const proofInput = content.querySelector('#proof-file');
    proofZone?.addEventListener('click', () => proofInput?.click());
    proofInput?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const dataUrl = await fileToBase64(file);
      this.state.imageFile = file;
      this.state.imageBase64 = dataUrl;
      content.querySelector('#proof-preview').src = dataUrl;
      content.querySelector('#proof-preview-wrap')?.classList.remove('hidden');
      proofZone?.classList.add('hidden');
    });
    content.querySelector('#clear-proof-btn')?.addEventListener('click', () => {
      this.state.imageFile = null;
      this.state.imageBase64 = null;
      content.querySelector('#proof-preview-wrap')?.classList.add('hidden');
      proofZone?.classList.remove('hidden');
    });

    // Log button
    content.querySelector('#log-workout-btn')?.addEventListener('click', async () => {
      if (!selectedActivity) { showToast('Select an activity type', 'warning'); return; }

      const desc = content.querySelector('#workout-desc')?.value?.trim() || '';
      this.state.workout = {
        activityType: selectedActivity,
        duration,
        intensity: selectedIntensity,
        description: desc
      };

      const btn = content.querySelector('#log-workout-btn');
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="icon-sm spin"></i> Estimating...`;
      if (window.lucide) lucide.createIcons({ nodes: [btn] });

      try {
        // Verify image if provided
        if (this.state.imageFile) {
          const fd = new FormData();
          fd.append('image', this.state.imageFile);
          fd.append('activityType', selectedActivity);
          this.state.verifyResult = await API.workouts.verifyImage(fd);
        }

        // Estimate calories
        const result = await API.workouts.estimateCalories({
          activityType: selectedActivity,
          duration,
          intensity: selectedIntensity,
          description: desc,
          hasImageProof: !!this.state.imageFile
        });

        this.state.calorieResult = result;
        this.state.step = 'result';
        this.render();
      } catch (err) {
        showToast(err.message || 'Failed to estimate calories', 'error');
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="zap" class="icon-sm"></i> Calculate Calories Earned`;
        if (window.lucide) lucide.createIcons({ nodes: [btn] });
      }
    });
  },

  _bindResultEvents(content) {
    content.querySelector('#back-to-entry')?.addEventListener('click', () => {
      this.state.step = 'entry';
      this.render();
    });

    content.querySelector('#confirm-earn-btn')?.addEventListener('click', async () => {
      const btn = content.querySelector('#confirm-earn-btn');
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="icon-sm spin"></i> Saving...`;
      if (window.lucide) lucide.createIcons({ nodes: [btn] });

      try {
        await API.workouts.log({
          ...this.state.workout,
          rawCaloriesBurnt: this.state.calorieResult?.rawEstimate,
          caloriesBurnt: this.state.calorieResult?.adjustedEstimate,
          imageBase64: this.state.imageBase64 || null,
          aiImageVerdict: this.state.verifyResult?.verdict || null,
          imageVerified: this.state.verifyResult?.verified || false
        });

        const earned = Math.round(this.state.calorieResult?.adjustedEstimate || 0);
        showToast(`💪 +${earned} calories earned! Great work!`, 'success', 5000);

        // Reset state
        this.state = { step: 'entry', workout: null, imageFile: null, imageBase64: null, calorieResult: null, verifyResult: null, loading: false };
        App.navigateTo('home');

        // Auto-open PT Coach for celebration
        setTimeout(() => PTCoach.openCoaching(), 800);
      } catch (err) {
        showToast(err.message || 'Failed to save workout', 'error');
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="check" class="icon-sm"></i> Save Workout`;
        if (window.lucide) lucide.createIcons({ nodes: [btn] });
      }
    });

    content.querySelector('#dispute-earn-btn')?.addEventListener('click', () => {
      // We don't have a DB id yet — log first then dispute
      // For now, log and then open dispute
      PTCoach.openWithContext({
        type: 'general',
        message: `Max, I just finished a ${this.state.workout?.duration}min ${this.state.workout?.activityType} workout at ${this.state.workout?.intensity} intensity. The system calculated ${Math.round(this.state.calorieResult?.caloriesBurnt || 0)} calories. Can you help me dispute that?`
      });
    });
  },

  _esc(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
  }
};
