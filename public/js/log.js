/* log.js — Meal Logging Page (AI-powered ingredient grid) */

const LogPage = {
  state: {
    step: 'entry',
    mealName: '',
    ingredients: [],
    totalCalories: 0,
    aiVerdict: null,
    logType: 'ai_name',
    imageBase64: null,
    loading: false
  },
  _isLooking: false,  // guard against concurrent USDA/verify requests

  render() {
    const content = document.getElementById('tab-content');
    content.innerHTML = this._renderStep();
    this._bindEvents(content);
    if (window.lucide) lucide.createIcons({ nodes: [content] });
  },

  _renderStep() {
    switch (this.state.step) {
      case 'ingredients': return this._renderIngredients();
      case 'confirm':     return this._renderConfirm();
      default:            return this._renderEntry();
    }
  },

  // ── Step 1: Entry ──────────────────────────────────────────────────────────
  _renderEntry() {
    return `
      <div class="log-page">
        <div class="page-header">
          <h2 class="page-title">Log a Meal</h2>
          <p class="page-subtitle">Type a meal name or snap a photo</p>
        </div>

        <!-- Mode Tabs -->
        <div class="mode-tabs">
          <button class="mode-tab active" id="tab-name" aria-label="Name entry">
            <i data-lucide="pencil" class="icon-sm"></i> Name
          </button>
          <button class="mode-tab" id="tab-image" aria-label="Photo entry">
            <i data-lucide="camera" class="icon-sm"></i> Photo
          </button>
          <button class="mode-tab" id="tab-manual" aria-label="Manual entry">
            <i data-lucide="hash" class="icon-sm"></i> Manual
          </button>
        </div>

        <!-- Name Mode -->
        <div id="mode-name" class="log-mode">
          <div class="input-group">
            <i data-lucide="search" class="input-icon"></i>
            <input type="text" id="meal-name-input" class="input input-icon-left"
                   placeholder="e.g. Chicken Alfredo Pasta"
                   autocomplete="off" autocapitalize="words">
          </div>
          <button class="btn btn-primary btn-full" id="analyze-name-btn">
            <i data-lucide="sparkles" class="icon-sm"></i> Analyze Ingredients
          </button>
        </div>

        <!-- Image Mode -->
        <div id="mode-image" class="log-mode hidden">
          <div class="image-upload-area" id="image-drop-zone">
            <div class="upload-icon"><i data-lucide="image-plus" class="icon-lg"></i></div>
            <div class="upload-text">Tap to take a photo or upload</div>
            <div class="upload-sub">Max 5MB · JPEG, PNG, WEBP</div>
            <input type="file" id="image-file-input" accept="image/*" capture="environment" hidden>
          </div>
          <div id="image-preview-wrap" class="hidden">
            <img id="image-preview" class="meal-image-preview" alt="Preview">
            <button class="btn btn-ghost btn-sm" id="clear-image-btn">
              <i data-lucide="x" class="icon-sm"></i> Remove
            </button>
          </div>
          <button class="btn btn-primary btn-full hidden" id="analyze-image-btn">
            <i data-lucide="eye" class="icon-sm"></i> Analyze Photo
          </button>
        </div>

        <!-- Manual Mode -->
        <div id="mode-manual" class="log-mode hidden">
          <div class="manual-form">
            <div class="input-group">
              <i data-lucide="utensils" class="input-icon"></i>
              <input type="text" id="manual-name" class="input input-icon-left" placeholder="Meal name" autocapitalize="words">
            </div>
            <div class="input-row">
              <div class="input-group flex-1">
                <input type="number" id="manual-cals" class="input" placeholder="Calories" min="0" max="9999">
                <span class="input-unit">kcal</span>
              </div>
            </div>
            <div class="input-row">
              <div class="input-group flex-1">
                <input type="number" id="manual-protein" class="input" placeholder="Protein" min="0">
                <span class="input-unit">g</span>
              </div>
              <div class="input-group flex-1">
                <input type="number" id="manual-carbs" class="input" placeholder="Carbs" min="0">
                <span class="input-unit">g</span>
              </div>
              <div class="input-group flex-1">
                <input type="number" id="manual-fat" class="input" placeholder="Fat" min="0">
                <span class="input-unit">g</span>
              </div>
            </div>
            <button class="btn btn-primary btn-full" id="manual-log-btn">
              <i data-lucide="check-circle" class="icon-sm"></i> Log Manually
            </button>
          </div>
        </div>
      </div>
    `;
  },

  // ── Step 2: Ingredient Grid ────────────────────────────────────────────────
  _renderIngredients() {
    const cats = ['protein', 'carbohydrate', 'fat', 'vegetable', 'dairy', 'condiment', 'seasoning', 'other'];
    const grouped = {};
    cats.forEach(c => grouped[c] = []);
    this.state.ingredients.forEach(ing => {
      const cat = ing.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(ing);
    });

    const selectedCount = this.state.ingredients.filter(i => i.selected).length;

    return `
      <div class="log-page">
        <div class="page-header-row">
          <button class="btn btn-ghost btn-sm" id="back-to-entry">
            <i data-lucide="arrow-left" class="icon-sm"></i>
          </button>
          <div class="flex-1">
            <h2 class="page-title">${this._esc(this.state.mealName)}</h2>
            <p class="page-subtitle">${selectedCount} ingredients selected</p>
          </div>
        </div>

        <div class="ingredient-instructions">
          <i data-lucide="info" class="icon-sm"></i>
          Tap ingredients to select/deselect. Tap again on selected to adjust amount.
        </div>

        <div class="ingredient-grid" id="ingredient-grid">
          ${this._renderIngredientGrid(grouped)}
        </div>

        <div class="log-action-bar">
          <button class="btn btn-primary btn-full" id="lookup-usda-btn" ${selectedCount === 0 ? 'disabled' : ''}>
            <i data-lucide="database" class="icon-sm"></i>
            Look up Nutrition (${selectedCount} selected)
          </button>
        </div>
      </div>
    `;
  },

  _renderIngredientGrid(grouped) {
    const catLabels = {
      protein: 'Protein', carbohydrate: 'Carbs', fat: 'Fats',
      vegetable: 'Vegetables', dairy: 'Dairy', condiment: 'Condiments',
      seasoning: 'Seasonings', other: 'Other'
    };
    return Object.entries(grouped).map(([cat, items]) => {
      if (!items.length) return '';
      return `
        <div class="ingredient-category">
          <div class="category-label">${catLabels[cat] || cat}</div>
          <div class="ingredient-chips">
            ${items.map(ing => {
              const globalIdx = this.state.ingredients.findIndex(i => i.name === ing.name);
              if (ing.selected) {
                return `
                  <div class="ingredient-chip selected" data-idx="${globalIdx}" data-action="edit">
                    <span class="chip-name">${this._esc(ing.name)}</span>
                    <span class="chip-amount">${ing.amountGrams}g</span>
                    <button class="chip-deselect" data-idx="${globalIdx}" data-action="deselect"
                      style="background:none;border:none;color:var(--accent);cursor:pointer;padding:0 0 0 4px;font-size:16px;line-height:1;"
                      aria-label="Remove">×</button>
                  </div>
                `;
              }
              return `
                <div class="ingredient-chip" data-idx="${globalIdx}" data-action="select">
                  <span class="chip-name">${this._esc(ing.name)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  },

  // ── Step 3: Confirm ────────────────────────────────────────────────────────
  _renderConfirm() {
    const selected = this.state.ingredients.filter(i => i.selected);
    const totalCals = selected.reduce((s, i) => s + (i.calories || 0), 0);
    const totalProtein = selected.reduce((s, i) => s + (i.protein || 0), 0);
    const totalCarbs = selected.reduce((s, i) => s + (i.carbs || 0), 0);
    const totalFat = selected.reduce((s, i) => s + (i.fat || 0), 0);

    const verdict = this.state.aiVerdict;
    const verdictColor = verdict?.confidence === 'high' ? 'var(--accent)' :
                         verdict?.confidence === 'medium' ? 'var(--gold)' : 'var(--text-3)';

    return `
      <div class="log-page">
        <div class="page-header-row">
          <button class="btn btn-ghost btn-sm" id="back-to-ingredients">
            <i data-lucide="arrow-left" class="icon-sm"></i>
          </button>
          <div class="flex-1">
            <h2 class="page-title">Confirm Meal</h2>
          </div>
        </div>

        <!-- Calorie Summary -->
        <div class="confirm-summary-card">
          <div class="confirm-meal-name">${this._esc(this.state.mealName)}</div>
          <div class="confirm-calories">${Math.round(totalCals)}</div>
          <div class="confirm-kcal-label">calories</div>
          <div class="confirm-macros">
            <div class="macro-pill"><span>P</span>${totalProtein.toFixed(1)}g</div>
            <div class="macro-pill"><span>C</span>${totalCarbs.toFixed(1)}g</div>
            <div class="macro-pill"><span>F</span>${totalFat.toFixed(1)}g</div>
          </div>
        </div>

        <!-- AI Verdict Banner -->
        ${verdict ? `
          <div class="ai-verdict-banner" style="border-left: 3px solid ${verdictColor};">
            <i data-lucide="shield-check" class="icon-sm" style="color:${verdictColor};"></i>
            <div>
              <div class="verdict-title">AI Verification (${verdict.confidence} confidence)</div>
              <div class="verdict-text">${this._esc(verdict.verdict)}</div>
              ${!verdict.reasonable ? `<div class="verdict-warning">Suggested range: ${verdict.suggestedRange?.min}–${verdict.suggestedRange?.max} kcal</div>` : ''}
            </div>
          </div>
        ` : ''}

        <!-- Ingredient Breakdown -->
        <div class="section-header">
          <span class="section-title">Breakdown</span>
          <span class="section-action" id="edit-ingredients-btn">Edit</span>
        </div>
        <div class="confirm-ingredient-list">
          ${selected.map(ing => `
            <div class="confirm-ingredient-row">
              <span class="ci-name">${this._esc(ing.name)}</span>
              <span class="ci-amount">${ing.amountGrams}g</span>
              <span class="ci-cals ${!ing.verified ? 'unverified' : ''}">${Math.round(ing.calories || 0)} kcal ${!ing.verified ? '~' : ''}</span>
            </div>
          `).join('')}
        </div>

        <!-- Log Button -->
        <div class="log-action-bar">
          <button class="btn btn-primary btn-full" id="confirm-log-btn">
            <i data-lucide="check" class="icon-sm"></i> Log This Meal
          </button>
        </div>
      </div>
    `;
  },

  // ── Event Binding ──────────────────────────────────────────────────────────
  _bindEvents(content) {
    if (this.state.step === 'entry')       this._bindEntryEvents(content);
    if (this.state.step === 'ingredients') {
      this._bindIngredientEvents(content);
      // Bind lookup button ONCE here — not inside _bindIngredientEvents
      // which is called on every chip refresh
      content.querySelector('#lookup-usda-btn')
        ?.addEventListener('click', () => this._lookupUSDA());
    }
    if (this.state.step === 'confirm')     this._bindConfirmEvents(content);
  },

  _bindEntryEvents(content) {
    // Mode tabs
    ['name', 'image', 'manual'].forEach(mode => {
      content.getElementById?.(`tab-${mode}`)?.addEventListener?.('click', () => {
        content.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        content.getElementById(`tab-${mode}`).classList.add('active');
        content.querySelectorAll('.log-mode').forEach(m => m.classList.add('hidden'));
        content.getElementById(`mode-${mode}`).classList.remove('hidden');
      });
    });

    const tabName  = content.querySelector('#tab-name');
    const tabImage = content.querySelector('#tab-image');
    const tabManual = content.querySelector('#tab-manual');
    const modeName  = content.querySelector('#mode-name');
    const modeImage = content.querySelector('#mode-image');
    const modeManual = content.querySelector('#mode-manual');

    tabName?.addEventListener('click', () => {
      [tabName, tabImage, tabManual].forEach(t => t?.classList.remove('active'));
      tabName.classList.add('active');
      [modeName, modeImage, modeManual].forEach(m => m?.classList.add('hidden'));
      modeName?.classList.remove('hidden');
    });
    tabImage?.addEventListener('click', () => {
      [tabName, tabImage, tabManual].forEach(t => t?.classList.remove('active'));
      tabImage.classList.add('active');
      [modeName, modeImage, modeManual].forEach(m => m?.classList.add('hidden'));
      modeImage?.classList.remove('hidden');
    });
    tabManual?.addEventListener('click', () => {
      [tabName, tabImage, tabManual].forEach(t => t?.classList.remove('active'));
      tabManual.classList.add('active');
      [modeName, modeImage, modeManual].forEach(m => m?.classList.add('hidden'));
      modeManual?.classList.remove('hidden');
    });

    // Analyze by name
    content.querySelector('#analyze-name-btn')?.addEventListener('click', () => this._analyzeName(content));
    content.querySelector('#meal-name-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._analyzeName(content);
    });

    // Image upload
    const dropZone = content.querySelector('#image-drop-zone');
    const fileInput = content.querySelector('#image-file-input');
    dropZone?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const dataUrl = await fileToBase64(file);
      content.querySelector('#image-preview').src = dataUrl;
      content.querySelector('#image-preview-wrap')?.classList.remove('hidden');
      dropZone?.classList.add('hidden');
      content.querySelector('#analyze-image-btn')?.classList.remove('hidden');
      this.state._imageFile = file;
    });
    content.querySelector('#clear-image-btn')?.addEventListener('click', () => {
      content.querySelector('#image-preview-wrap')?.classList.add('hidden');
      dropZone?.classList.remove('hidden');
      content.querySelector('#analyze-image-btn')?.classList.add('hidden');
      this.state._imageFile = null;
    });
    content.querySelector('#analyze-image-btn')?.addEventListener('click', () => this._analyzeImage(content));

    // Manual log
    content.querySelector('#manual-log-btn')?.addEventListener('click', () => this._logManual(content));
  },

  _bindIngredientEvents(content) {
    content.querySelector('#back-to-entry')?.addEventListener('click', () => {
      this.state.step = 'entry';
      this.render();
    });

    // Chip delegated listener (grid only) — lookup button bound separately above
    const grid = content.querySelector('#ingredient-grid');
    if (!grid || grid._bound) return;
    grid._bound = true;

    grid.addEventListener('click', e => {
      const deselBtn = e.target.closest('[data-action="deselect"]');
      if (deselBtn) {
        e.stopPropagation();
        const idx = parseInt(deselBtn.dataset.idx);
        if (!isNaN(idx)) {
          this.state.ingredients[idx].selected = false;
          this._refreshIngredientGrid(content);
        }
        return;
      }

      const chip = e.target.closest('.ingredient-chip');
      if (!chip) return;
      const idx = parseInt(chip.dataset.idx);
      const ing = this.state.ingredients[idx];
      if (!ing) return;

      if (chip.dataset.action === 'edit') {
        this._showAmountEditor(idx);
      } else {
        ing.selected = true;
        this._refreshIngredientGrid(content);
      }
    });
  },

  _bindConfirmEvents(content) {
    content.querySelector('#back-to-ingredients')?.addEventListener('click', () => {
      this.state.step = 'ingredients';
      this.render();
    });
    content.querySelector('#edit-ingredients-btn')?.addEventListener('click', () => {
      this.state.step = 'ingredients';
      this.render();
    });
    content.querySelector('#confirm-log-btn')?.addEventListener('click', () => this._logMeal());
  },

  // ── Actions ────────────────────────────────────────────────────────────────
  async _analyzeName(content) {
    const input = content.querySelector('#meal-name-input');
    const name = input?.value?.trim();
    if (!name) { showToast('Please enter a meal name', 'warning'); return; }

    const btn = content.querySelector('#analyze-name-btn');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="icon-sm spin"></i> Analyzing...`;
    if (window.lucide) lucide.createIcons({ nodes: [btn] });

    try {
      const data = await API.meals.analyzeName(name);
      this.state.mealName = data.mealName;
      this.state.ingredients = data.ingredients;
      this.state.logType = 'ai_name';
      this.state.step = 'ingredients';
      this.render();
    } catch (err) {
      showToast(err.message || 'Failed to analyze meal', 'error');
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="sparkles" class="icon-sm"></i> Analyze Ingredients`;
      if (window.lucide) lucide.createIcons({ nodes: [btn] });
    }
  },

  async _analyzeImage(content) {
    const file = this.state._imageFile;
    if (!file) { showToast('Please select an image first', 'warning'); return; }

    const btn = content.querySelector('#analyze-image-btn');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="icon-sm spin"></i> Analyzing image...`;
    if (window.lucide) lucide.createIcons({ nodes: [btn] });

    try {
      const fd = new FormData();
      fd.append('image', file);
      const data = await API.meals.analyzeImage(fd);
      this.state.mealName = data.mealName;
      this.state.ingredients = data.ingredients;
      this.state.imageBase64 = data.imageBase64;
      this.state.logType = 'ai_image';
      this.state.step = 'ingredients';
      this.render();
    } catch (err) {
      showToast(err.message || 'Failed to analyze image', 'error');
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="eye" class="icon-sm"></i> Analyze Photo`;
      if (window.lucide) lucide.createIcons({ nodes: [btn] });
    }
  },

  async _lookupUSDA() {
    if (this._isLooking) return;   // prevent concurrent calls
    const selected = this.state.ingredients.filter(i => i.selected);
    if (!selected.length) { showToast('Select at least one ingredient', 'warning'); return; }

    this._isLooking = true;
    const content = document.getElementById('tab-content');
    const btn = content.querySelector('#lookup-usda-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="icon-sm spin"></i> Looking up nutrition...`;
      if (window.lucide) lucide.createIcons({ nodes: [btn] });
    }

    try {
      const lookupData = await API.meals.usdaLookup(
        selected.map(i => ({ name: i.name, amountGrams: i.amountGrams }))
      );

      lookupData.ingredients.forEach(looked => {
        const idx = this.state.ingredients.findIndex(i => i.name === looked.name);
        if (idx !== -1) {
          this.state.ingredients[idx] = { ...this.state.ingredients[idx], ...looked };
        }
      });

      const totalCals = this.state.ingredients
        .filter(i => i.selected)
        .reduce((s, i) => s + (i.calories || 0), 0);

      try {
        this.state.aiVerdict = await API.meals.verify({
          mealName: this.state.mealName,
          ingredients: this.state.ingredients.filter(i => i.selected),
          totalCalories: totalCals
        });
      } catch { this.state.aiVerdict = null; }

      this.state.step = 'confirm';
      this.render();
    } catch (err) {
      showToast(err.message || 'Nutrition lookup failed', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="database" class="icon-sm"></i> Look up Nutrition (${selected.length} selected)`;
        if (window.lucide) lucide.createIcons({ nodes: [btn] });
      }
    } finally {
      this._isLooking = false;
    }
  },

  async _logMeal() {
    const btn = document.querySelector('#confirm-log-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = `<i data-lucide="loader-2" class="icon-sm spin"></i> Logging...`; }

    const selected = this.state.ingredients.filter(i => i.selected);
    try {
      const result = await API.meals.log({
        name: this.state.mealName,
        logType: this.state.logType,
        ingredients: selected,
        imageBase64: this.state.imageBase64 || null,
        aiVerdict: this.state.aiVerdict
      });

      showToast(`✓ ${this.state.mealName} logged — ${Math.round(result.meal.totalCalories)} cal`, 'success', 4000);

      // Reset state
      this.state = { step: 'entry', mealName: '', ingredients: [], totalCalories: 0, aiVerdict: null, logType: 'ai_name', imageBase64: null, loading: false };

      // Go to home
      App.navigateTo('home');

      // Open PT coach if close to going over
      const bal = result.balance?.currentBalance;
      if (bal !== undefined && bal < 200 && bal > -500) {
        setTimeout(() => PTCoach.openCoaching(), 800);
      }
    } catch (err) {
      showToast(err.message || 'Failed to log meal', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="check" class="icon-sm"></i> Log This Meal`; }
    }
  },

  async _logManual(content) {
    const name    = content.querySelector('#manual-name')?.value?.trim();
    const calories = parseFloat(content.querySelector('#manual-cals')?.value);
    if (!name) { showToast('Enter a meal name', 'warning'); return; }
    if (!calories || isNaN(calories)) { showToast('Enter calories', 'warning'); return; }

    const btn = content.querySelector('#manual-log-btn');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="icon-sm spin"></i> Logging...`;

    try {
      await API.meals.manual({
        name,
        calories,
        protein: parseFloat(content.querySelector('#manual-protein')?.value) || 0,
        carbs:   parseFloat(content.querySelector('#manual-carbs')?.value) || 0,
        fat:     parseFloat(content.querySelector('#manual-fat')?.value) || 0
      });
      showToast(`✓ ${name} logged — ${Math.round(calories)} cal`, 'success');
      App.navigateTo('home');
    } catch (err) {
      showToast(err.message || 'Failed to log meal', 'error');
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="check-circle" class="icon-sm"></i> Log Manually`;
    }
  },

  _showAmountEditor(idx) {
    const ing = this.state.ingredients[idx];
    if (!ing) return;
    const content = document.getElementById('tab-content');

    showModal(`
      <div class="modal-handle"></div>
      <div class="modal-title" style="font-size:20px;margin-bottom:4px;">${this._esc(ing.name)}</div>
      <p style="color:var(--text-2);font-size:14px;margin-bottom:24px;">Adjust the amount</p>

      <div class="amount-slider-wrap" style="margin-bottom:20px;">
        <input type="range" class="amount-slider" min="5" max="600" step="5"
               value="${ing.amountGrams}" id="modal-amount-slider"
               style="flex:1;accent-color:var(--accent);cursor:pointer;">
        <div class="amount-display" id="modal-amount-display">${ing.amountGrams}g</div>
      </div>

      <div class="amount-presets" style="margin-bottom:24px;">
        ${[25, 50, 100, 150, 200, 300].map(v =>
          `<button class="preset-btn" data-val="${v}">${v}g</button>`
        ).join('')}
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <button class="btn-primary" id="modal-apply-amount">Apply Amount</button>
        <button class="btn-secondary btn-danger" id="modal-remove-ingredient">
          Remove ingredient
        </button>
      </div>
    `);

    // Wire up interactions inside the modal
    const slider  = document.getElementById('modal-amount-slider');
    const display = document.getElementById('modal-amount-display');

    slider?.addEventListener('input', () => {
      display.textContent = slider.value + 'g';
    });

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        slider.value = btn.dataset.val;
        display.textContent = btn.dataset.val + 'g';
      });
    });

    document.getElementById('modal-apply-amount')?.addEventListener('click', () => {
      this.state.ingredients[idx].amountGrams = parseInt(slider.value);
      closeModal();
      this._refreshIngredientGrid(content);
    });

    document.getElementById('modal-remove-ingredient')?.addEventListener('click', () => {
      this.state.ingredients[idx].selected = false;
      closeModal();
      this._refreshIngredientGrid(content);
    });
  },

  _refreshIngredientGrid(content) {
    const cats = ['protein', 'carbohydrate', 'fat', 'vegetable', 'dairy', 'condiment', 'seasoning', 'other'];
    const grouped = {};
    cats.forEach(c => grouped[c] = []);
    this.state.ingredients.forEach(ing => {
      const cat = ing.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(ing);
    });

    const grid = content.querySelector('#ingredient-grid');
    if (grid) {
      // Clear the double-bind guard so rebind works after re-render
      grid._bound = false;
      grid.innerHTML = this._renderIngredientGrid(grouped);
      // Re-attach the single delegated listener
      grid._bound = false;
      this._bindIngredientEvents(content);
    }

    const selectedCount = this.state.ingredients.filter(i => i.selected).length;
    const subtitle = content.querySelector('.page-subtitle');
    if (subtitle) subtitle.textContent = `${selectedCount} ingredients selected`;

    const lookupBtn = content.querySelector('#lookup-usda-btn');
    if (lookupBtn) {
      lookupBtn.disabled = selectedCount === 0;
      lookupBtn.innerHTML = `<i data-lucide="database" class="icon-sm"></i> Look up Nutrition (${selectedCount} selected)`;
    }

    if (window.lucide) lucide.createIcons({ nodes: [content] });
  },

  _esc(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
  }
};
