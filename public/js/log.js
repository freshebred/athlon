/* log.js — Meal Logging Page (AI-powered ingredient grid with smart measurements) */

const LogPage = {
  state: {
    step: 'entry',
    mealName: '',
    ingredients: [],       // { name, amount, unit, amountGrams, isCommon, category, selected, calories?, protein?, carbs?, fat?, verified? }
    originalIngredients: [],  // snapshot before user edits (for re-verify)
    totalCalories: 0,
    aiVerdict: null,
    editVerdict: null,     // verdict from /verify-edit
    logType: 'ai_name',
    imageBase64: null,
    loading: false,
    _lastAction: null,     // for retry: 'analyzeName'|'analyzeImage'|'lookupUSDA'|'verifyEdit'
    _lastActionArgs: null, // args to pass on retry
    userMadeEdits: false   // track if user changed anything in confirm step
  },
  _isLooking: false,

  // ── Unit system ────────────────────────────────────────────────────────────
  UNITS: {
    g:     { label: 'g',       type: 'weight', step: 5,    min: 0.1, max: 9999 },
    oz:    { label: 'oz',      type: 'weight', step: 0.5,  min: 0.5, max: 200  },
    egg:   { label: 'egg(s)',  type: 'count',  step: 1,    min: 0.5, max: 20   },
    slice: { label: 'slice(s)',type: 'count',  step: 1,    min: 0.5, max: 20   },
    strip: { label: 'strip(s)',type: 'count',  step: 1,    min: 1,   max: 20   },
    clove: { label: 'clove(s)',type: 'count',  step: 1,    min: 1,   max: 20   },
    ml:    { label: 'ml',      type: 'volume', step: 10,   min: 1,   max: 2000 },
    cup:   { label: 'cup(s)',  type: 'volume', step: 0.25, min: 0.25,max: 10   },
    tbsp:  { label: 'tbsp',    type: 'volume', step: 0.5,  min: 0.5, max: 30   },
    tsp:   { label: 'tsp',     type: 'volume', step: 0.25, min: 0.25,max: 10   },
    pinch: { label: 'pinch(es)',type:'count',  step: 1,    min: 1,   max: 10   },
    piece: { label: 'piece(s)',type: 'count',  step: 1,    min: 0.5, max: 20   },
    serving:{ label: 'serving',type: 'count', step: 1,    min: 1,   max: 10   }
  },

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
            <div class="upload-sub">Max 20MB · JPEG, PNG, WEBP</div>
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
            <p class="page-subtitle" id="selected-count-subtitle">${selectedCount} ingredients selected</p>
          </div>
        </div>

        <div class="ingredient-instructions">
          <i data-lucide="info" class="icon-sm"></i>
          Tap to select · tap again to adjust amount &amp; unit · <strong>+ Add</strong> to add custom ingredient
        </div>

        <div class="ingredient-grid" id="ingredient-grid">
          ${this._renderIngredientGrid(grouped)}
        </div>

        <!-- Add custom ingredient -->
        <button class="btn btn-ghost btn-full log-add-ingredient-btn" id="add-ingredient-btn">
          <i data-lucide="plus-circle" class="icon-sm"></i> Add Ingredient
        </button>

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
              const unitLabel = this._formatAmount(ing);
              if (ing.selected) {
                return `
                  <div class="ingredient-chip selected" data-idx="${globalIdx}" data-action="edit">
                    <span class="chip-name">${this._esc(ing.name)}</span>
                    <span class="chip-amount">${unitLabel}</span>
                    <button class="chip-deselect" data-idx="${globalIdx}" data-action="deselect"
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

  _formatAmount(ing) {
    const amount = ing.amount ?? ing.amountGrams ?? 100;
    const unit = ing.unit || 'g';
    const unitDef = this.UNITS[unit];
    const displayUnit = unitDef ? unitDef.label : unit;
    // Format: avoid excessive decimal places
    const formatted = (Number.isInteger(amount) || amount >= 10)
      ? Math.round(amount * 4) / 4  // round to nearest 0.25
      : amount;
    return `${formatted} ${displayUnit}`;
  },

  // ── Step 3: Confirm ────────────────────────────────────────────────────────
  _renderConfirm() {
    const selected = this.state.ingredients.filter(i => i.selected);
    const totalCals    = selected.reduce((s, i) => s + (Number(i.calories) || 0), 0);
    const totalProtein = selected.reduce((s, i) => s + (i.protein  || 0), 0);
    const totalCarbs   = selected.reduce((s, i) => s + (i.carbs    || 0), 0);
    const totalFat     = selected.reduce((s, i) => s + (i.fat      || 0), 0);

    const verdict = this.state.editVerdict || this.state.aiVerdict;
    const isEditVerdict = !!this.state.editVerdict;
    const verdictColor = isEditVerdict
      ? (this.state.editVerdict.verdict === 'approve' ? 'var(--accent)' : 'var(--gold)')
      : (verdict?.confidence === 'high' ? 'var(--accent)'
        : verdict?.confidence === 'medium' ? 'var(--gold)' : 'var(--text-3)');

    const canLog = !isEditVerdict || this.state.editVerdict.canLog !== false;
    const hasFlaggedIngredients = !isEditVerdict &&
      this.state.aiVerdict?.flaggedIngredients?.length > 0;

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
            <i data-lucide="${isEditVerdict && verdict.verdict === 'approve' ? 'check-circle' : 'shield-check'}" class="icon-sm" style="color:${verdictColor};flex-shrink:0;"></i>
            <div style="flex:1;">
              <div class="verdict-title">${isEditVerdict ? 'Edit Review' : `AI Verification (${verdict.confidence || 'low'} confidence)`}</div>
              <div class="verdict-text">${this._esc(verdict.verdict || verdict.message || '')}</div>
              ${!isEditVerdict && verdict.suggestedRange ? `<div class="verdict-warning">Suggested range: ${verdict.suggestedRange.min}–${verdict.suggestedRange.max} kcal</div>` : ''}
            </div>
          </div>
        ` : ''}

        <!-- Flagged ingredients from AI -->
        ${hasFlaggedIngredients ? `
          <div class="flagged-ingredients-section">
            <div class="section-header">
              <span class="section-title" style="color:var(--gold);">
                <i data-lucide="alert-triangle" class="icon-sm" style="color:var(--gold);"></i>
                AI Suggestions
              </span>
            </div>
            ${this.state.aiVerdict.flaggedIngredients.map((fi, idx) => `
              <div class="flagged-ingredient-card" data-fi-idx="${idx}">
                <div class="fi-name">${this._esc(fi.name)}</div>
                <div class="fi-issue">${this._esc(fi.issue)}</div>
                <div class="fi-suggestion">Suggested: ${fi.suggestedAmount !== undefined ? parseFloat(fi.suggestedAmount) : ''}${fi.suggestedAmountUnit || ''} → ~${fi.suggestedCalories ?? '?'} kcal</div>
                <div class="fi-actions" id="fi-actions-${idx}">
                  <button class="btn btn-sm" style="background:var(--accent-dim);color:var(--accent);border-radius:99px;" data-fi-action="apply" data-fi-idx="${idx}">
                    ✓ Apply
                  </button>
                  <button class="btn btn-sm" style="background:var(--surface-3);color:var(--text-2);border-radius:99px;" data-fi-action="custom" data-fi-idx="${idx}">
                    ✎ Custom
                  </button>
                  <button class="btn btn-sm" style="background:transparent;color:var(--text-3);border-radius:99px;" data-fi-action="dismiss" data-fi-idx="${idx}">
                    × Keep Mine
                  </button>
                </div>
                <!-- Custom input (hidden by default) -->
                <div id="fi-custom-${idx}" style="display:none;margin-top:10px;flex-direction:column;gap:8px;">
                  <div style="display:flex;gap:8px;align-items:center;">
                    <input type="number" min="0.01" step="0.01" placeholder="Amount"
                      id="fi-custom-amount-${idx}"
                      style="flex:1;background:var(--surface-2);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;color:var(--text);font-size:14px;"
                    />
                    <select id="fi-custom-unit-${idx}" class="select" style="flex:1;padding:8px 12px;font-size:14px;">
                      <option value="g">grams (g)</option>
                      <option value="ml">ml</option>
                      <option value="tsp">tsp</option>
                      <option value="tbsp">tbsp</option>
                      <option value="cup">cup</option>
                      <option value="egg">egg(s)</option>
                      <option value="clove">clove(s)</option>
                      <option value="slice">slice(s)</option>
                      <option value="oz">oz</option>
                    </select>
                  </div>
                  <div style="display:flex;gap:8px;">
                    <button class="btn btn-sm" style="background:var(--accent);color:#fff;border-radius:99px;flex:1;" data-fi-action="custom-apply" data-fi-idx="${idx}">Apply Custom</button>
                    <button class="btn btn-sm" style="background:var(--surface-3);color:var(--text-2);border-radius:99px;" data-fi-action="custom-cancel" data-fi-idx="${idx}">Cancel</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Edit verdict suggested corrections -->
        ${isEditVerdict && this.state.editVerdict.suggestedCorrections?.length ? `
          <div class="flagged-ingredients-section">
            <div class="section-header">
              <span class="section-title" style="color:var(--gold);">Max's Suggestions</span>
            </div>
            ${this.state.editVerdict.suggestedCorrections.map((sc, idx) => `
              <div class="flagged-ingredient-card" data-ec-idx="${idx}">
                <div class="fi-name">${this._esc(sc.ingredientName)}</div>
                <div class="fi-issue">${this._esc(sc.reason)}</div>
                <div class="fi-suggestion">Suggested: ${sc.suggestedAmount !== undefined ? parseFloat(sc.suggestedAmount) : ''}${sc.suggestedAmountUnit || ''} → ~${sc.suggestedCalories ?? '?'} kcal</div>
                <div class="fi-actions" id="ec-actions-${idx}">
                  <button class="btn btn-sm" style="background:var(--accent-dim);color:var(--accent);border-radius:99px;" data-ec-action="apply" data-ec-idx="${idx}">✓ Apply</button>
                  <button class="btn btn-sm" style="background:var(--surface-3);color:var(--text-2);border-radius:99px;" data-ec-action="custom" data-ec-idx="${idx}">✎ Custom</button>
                  <button class="btn btn-sm" style="background:transparent;color:var(--text-3);border-radius:99px;" data-ec-action="dismiss" data-ec-idx="${idx}">× Dismiss</button>
                </div>
                <div id="ec-custom-${idx}" style="display:none;margin-top:10px;flex-direction:column;gap:8px;">
                  <div style="display:flex;gap:8px;align-items:center;">
                    <input type="number" min="0.01" step="0.01" placeholder="Amount"
                      id="ec-custom-amount-${idx}"
                      style="flex:1;background:var(--surface-2);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;color:var(--text);font-size:14px;"
                    />
                    <select id="ec-custom-unit-${idx}" class="select" style="flex:1;padding:8px 12px;font-size:14px;">
                      <option value="g">grams (g)</option>
                      <option value="ml">ml</option>
                      <option value="tsp">tsp</option>
                      <option value="tbsp">tbsp</option>
                      <option value="cup">cup</option>
                      <option value="egg">egg(s)</option>
                      <option value="clove">clove(s)</option>
                      <option value="slice">slice(s)</option>
                      <option value="oz">oz</option>
                    </select>
                  </div>
                  <div style="display:flex;gap:8px;">
                    <button class="btn btn-sm" style="background:var(--accent);color:#fff;border-radius:99px;flex:1;" data-ec-action="custom-apply" data-ec-idx="${idx}">Apply Custom</button>
                    <button class="btn btn-sm" style="background:var(--surface-3);color:var(--text-2);border-radius:99px;" data-ec-action="custom-cancel" data-ec-idx="${idx}">Cancel</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Ingredient Breakdown -->
        <div class="section-header">
          <span class="section-title">Breakdown</span>
          <span class="section-action" id="edit-ingredients-btn">Edit</span>
        </div>
        <div class="confirm-ingredient-list">
          ${selected.map((ing, listIdx) => `
            <div class="confirm-ingredient-row" data-ing-name="${this._esc(ing.name)}">
              <span class="ci-name">${this._esc(ing.name)}</span>
              <span class="ci-amount" style="cursor:pointer;" title="Tap to edit" data-edit-ing="${listIdx}">${this._formatAmount(ing)}</span>
              <span class="ci-cals ${!ing.verified ? 'unverified' : ''}">${Math.round(ing.calories || 0)} kcal ${!ing.verified ? '~' : ''}</span>
            </div>
          `).join('')}
        </div>

        <!-- Log Button -->
        <div class="log-action-bar" style="display:flex;flex-direction:column;gap:10px;">
          ${canLog && !hasFlaggedIngredients ? `
            <button class="btn btn-primary btn-full" id="confirm-log-btn">
              <i data-lucide="check" class="icon-sm"></i> Log This Meal
            </button>
          ` : `
            <button class="btn btn-${canLog ? 'secondary' : 'primary'} btn-full" id="re-verify-btn">
              <i data-lucide="shield-check" class="icon-sm"></i>
              ${canLog ? 'Check with Max Again' : 'Re-check with Max'}
            </button>
            ${canLog ? `<button class="btn btn-primary btn-full" id="confirm-log-btn">
              <i data-lucide="check" class="icon-sm"></i> Log Anyway
            </button>` : ''}
          `}
          <button class="btn btn-ghost btn-full" id="back-to-ingredients" style="font-size:13px;">
            <i data-lucide="arrow-left" class="icon-sm"></i> Adjust Ingredients
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
      content.querySelector('#lookup-usda-btn')
        ?.addEventListener('click', () => this._lookupUSDA());
    }
    if (this.state.step === 'confirm')     this._bindConfirmEvents(content);
  },

  _bindEntryEvents(content) {
    const tabs  = ['name', 'image', 'manual'];
    const tabEls  = tabs.map(t => content.querySelector(`#tab-${t}`));
    const modeEls = tabs.map(t => content.querySelector(`#mode-${t}`));

    tabEls.forEach((tab, i) => {
      tab?.addEventListener('click', () => {
        tabEls.forEach(t => t?.classList.remove('active'));
        modeEls.forEach(m => m?.classList.add('hidden'));
        tabEls[i].classList.add('active');
        modeEls[i].classList.remove('hidden');
      });
    });

    content.querySelector('#analyze-name-btn')?.addEventListener('click', () => this._analyzeName(content));
    content.querySelector('#meal-name-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._analyzeName(content);
    });

    const dropZone  = content.querySelector('#image-drop-zone');
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

    content.querySelector('#manual-log-btn')?.addEventListener('click', () => this._logManual(content));
  },

  _bindIngredientEvents(content) {
    content.querySelector('#back-to-entry')?.addEventListener('click', () => {
      this.state.step = 'entry';
      this.render();
    });

    content.querySelector('#add-ingredient-btn')?.addEventListener('click', () => {
      this._showAddIngredientModal();
    });

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
    // Back buttons
    content.querySelectorAll('#back-to-ingredients').forEach(btn => {
      btn?.addEventListener('click', () => {
        this.state.step = 'ingredients';
        this.state.editVerdict = null;
        this.render();
      });
    });

    content.querySelector('#edit-ingredients-btn')?.addEventListener('click', () => {
      this.state.step = 'ingredients';
      this.state.editVerdict = null;
      this.render();
    });

    // Log button
    content.querySelector('#confirm-log-btn')?.addEventListener('click', () => this._logMeal());

    // Re-verify button (when canLog is false)
    content.querySelector('#re-verify-btn')?.addEventListener('click', () => this._reVerifyEdits());

    // Ingredient amount edit in confirm list
    content.querySelectorAll('[data-edit-ing]').forEach(el => {
      el.addEventListener('click', () => {
        const listIdx = parseInt(el.dataset.editIng);
        const selected = this.state.ingredients.filter(i => i.selected);
        const ing = selected[listIdx];
        if (!ing) return;
        const globalIdx = this.state.ingredients.indexOf(ing);
        this._showAmountEditor(globalIdx, true);
      });
    });

    // Flagged ingredient actions (AI suggestion from initial verify)
    content.querySelectorAll('[data-fi-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.fiAction;
        const idx    = parseInt(btn.dataset.fiIdx);
        const card   = content.querySelector(`[data-fi-idx="${idx}"]`);

        if (action === 'apply') {
          const fi = this.state.aiVerdict.flaggedIngredients[idx];
          this._applyFlaggedIngredient(fi);

        } else if (action === 'dismiss') {
          this.state.aiVerdict.flaggedIngredients.splice(idx, 1);
          this.render();

        } else if (action === 'custom') {
          // Toggle the inline custom-input form
          const actionsEl = card?.querySelector(`#fi-actions-${idx}`);
          const customEl  = card?.querySelector(`#fi-custom-${idx}`);
          if (actionsEl) actionsEl.style.display = 'none';
          if (customEl)  customEl.style.display  = 'flex';
          // Pre-fill with the AI-suggested amount/unit if available
          const fi = this.state.aiVerdict.flaggedIngredients[idx];
          const amountInput = card?.querySelector(`#fi-custom-amount-${idx}`);
          const unitSelect  = card?.querySelector(`#fi-custom-unit-${idx}`);
          if (amountInput && fi?.suggestedAmount) amountInput.value = fi.suggestedAmount;
          if (unitSelect  && fi?.suggestedAmountUnit) unitSelect.value = fi.suggestedAmountUnit;

        } else if (action === 'custom-cancel') {
          const actionsEl = card?.querySelector(`#fi-actions-${idx}`);
          const customEl  = card?.querySelector(`#fi-custom-${idx}`);
          if (customEl)  customEl.style.display  = 'none';
          if (actionsEl) actionsEl.style.display = 'flex';

        } else if (action === 'custom-apply') {
          const amountInput = card?.querySelector(`#fi-custom-amount-${idx}`);
          const unitSelect  = card?.querySelector(`#fi-custom-unit-${idx}`);
          const customAmount = parseFloat(amountInput?.value);
          const customUnit   = unitSelect?.value || 'g';
          if (!customAmount || customAmount <= 0) {
            showToast('Please enter a valid amount (must be positive)', 'warning');
            return;
          }
          // Build a synthetic fi with user's custom values (no suggested calories — will need USDA re-lookup)
          const fi = this.state.aiVerdict.flaggedIngredients[idx];
          const syntheticFi = {
            ...fi,
            suggestedAmount:     customAmount,
            suggestedAmountUnit: customUnit,
            suggestedCalories:   null  // null triggers re-lookup on next USDA call
          };
          this._applyFlaggedIngredient(syntheticFi);
          showToast('Custom amount applied — calories will update on next lookup', 'info');
        }
      });
    });

    // Edit verdict suggested corrections
    content.querySelectorAll('[data-ec-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.ecAction;
        const idx    = parseInt(btn.dataset.ecIdx);
        const card   = content.querySelector(`[data-ec-idx="${idx}"]`);

        if (action === 'apply') {
          const sc = this.state.editVerdict?.suggestedCorrections?.[idx];
          if (sc) this._applyEditCorrection(sc);

        } else if (action === 'dismiss') {
          this.state.editVerdict.suggestedCorrections.splice(idx, 1);
          this.render();

        } else if (action === 'custom') {
          const actionsEl = card?.querySelector(`#ec-actions-${idx}`);
          const customEl  = card?.querySelector(`#ec-custom-${idx}`);
          if (actionsEl) actionsEl.style.display = 'none';
          if (customEl)  customEl.style.display  = 'flex';
          const sc = this.state.editVerdict?.suggestedCorrections?.[idx];
          const amountInput = card?.querySelector(`#ec-custom-amount-${idx}`);
          const unitSelect  = card?.querySelector(`#ec-custom-unit-${idx}`);
          if (amountInput && sc?.suggestedAmount) amountInput.value = sc.suggestedAmount;
          if (unitSelect  && sc?.suggestedAmountUnit) unitSelect.value = sc.suggestedAmountUnit;

        } else if (action === 'custom-cancel') {
          const actionsEl = card?.querySelector(`#ec-actions-${idx}`);
          const customEl  = card?.querySelector(`#ec-custom-${idx}`);
          if (customEl)  customEl.style.display  = 'none';
          if (actionsEl) actionsEl.style.display = 'flex';

        } else if (action === 'custom-apply') {
          const amountInput = card?.querySelector(`#ec-custom-amount-${idx}`);
          const unitSelect  = card?.querySelector(`#ec-custom-unit-${idx}`);
          const customAmount = parseFloat(amountInput?.value);
          const customUnit   = unitSelect?.value || 'g';
          if (!customAmount || customAmount <= 0) {
            showToast('Please enter a valid positive amount', 'warning');
            return;
          }
          const sc = this.state.editVerdict?.suggestedCorrections?.[idx];
          if (sc) {
            this._applyEditCorrection({
              ...sc,
              suggestedAmount:     customAmount,
              suggestedAmountUnit: customUnit,
              suggestedCalories:   null
            });
            showToast('Custom amount applied', 'info');
          }
        }
      });
    });
  },

  // ── Actions ────────────────────────────────────────────────────────────────

  async _analyzeName(content) {
    const input = content.querySelector('#meal-name-input');
    const name = input?.value?.trim();
    if (!name) { showToast('Please enter a meal name', 'warning'); return; }

    this.state._lastAction = 'analyzeName';
    this.state._lastActionArgs = name;

    const btn = content.querySelector('#analyze-name-btn');
    this._setButtonLoading(btn, 'Analyzing...');

    try {
      const data = await API.meals.analyzeName(name);
      this.state.mealName = data.mealName;
      this.state.ingredients = data.ingredients;
      this.state.originalIngredients = JSON.parse(JSON.stringify(data.ingredients));
      this.state.logType = 'ai_name';
      this.state.step = 'ingredients';
      this.state.userMadeEdits = false;
      this.state.editVerdict = null;
      this.render();
    } catch (err) {
      this._setButtonNormal(btn, `<i data-lucide="sparkles" class="icon-sm"></i> Analyze Ingredients`);
      this._showRetryBanner(content, 'analyze-name-retry', 'Failed to analyze meal', () => this._analyzeName(content));
    }
  },

  async _analyzeImage(content) {
    const file = this.state._imageFile;
    if (!file) { showToast('Please select an image first', 'warning'); return; }

    this.state._lastAction = 'analyzeImage';
    this.state._lastActionArgs = file;

    const btn = content.querySelector('#analyze-image-btn');
    this._setButtonLoading(btn, 'Analyzing image...');

    try {
      const fd = new FormData();
      fd.append('image', file);
      const data = await API.meals.analyzeImage(fd);
      this.state.mealName = data.mealName;
      this.state.ingredients = data.ingredients;
      this.state.originalIngredients = JSON.parse(JSON.stringify(data.ingredients));
      this.state.imageBase64 = data.imageBase64;
      this.state.logType = 'ai_image';
      this.state.step = 'ingredients';
      this.state.userMadeEdits = false;
      this.state.editVerdict = null;
      this.render();
    } catch (err) {
      this._setButtonNormal(btn, `<i data-lucide="eye" class="icon-sm"></i> Analyze Photo`);
      this._showRetryBanner(content, 'analyze-image-retry', 'Failed to analyze image', () => this._analyzeImage(content));
    }
  },

  async _lookupUSDA() {
    if (this._isLooking) return;
    const selected = this.state.ingredients.filter(i => i.selected);
    if (!selected.length) { showToast('Select at least one ingredient', 'warning'); return; }

    this._isLooking = true;
    const content = document.getElementById('tab-content');
    const btn = content.querySelector('#lookup-usda-btn');
    this._setButtonLoading(btn, 'Looking up nutrition...');

    // Snapshot for re-verify
    this.state.originalIngredients = JSON.parse(JSON.stringify(this.state.ingredients));
    this.state.userMadeEdits = false;

    try {
      const lookupPayload = selected.map(i => ({
        name: i.name,
        amount: i.amount,
        unit: i.unit || 'g',
        amountGrams: i.amountGrams
      }));

      const lookupData = await API.meals.usdaLookup(lookupPayload);

      lookupData.ingredients.forEach(looked => {
        const idx = this.state.ingredients.findIndex(i => i.name === looked.name);
        if (idx !== -1) {
          this.state.ingredients[idx] = { ...this.state.ingredients[idx], ...looked };
        }
      });

      const totalCals = this.state.ingredients
        .filter(i => i.selected)
        .reduce((s, i) => s + (Number(i.calories) || 0), 0);

      // Show a brief "Max is reviewing…" text while verify runs
      this._setButtonLoading(btn, 'Max is reviewing your meal...');
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
      const errMsg = err.message || 'Nutrition lookup failed';
      this._setButtonNormal(btn, `<i data-lucide="database" class="icon-sm"></i> Look up Nutrition (${selected.length} selected)`);
      this._showRetryBanner(content, 'usda-retry', errMsg, () => this._lookupUSDA());
    } finally {
      this._isLooking = false;
    }
  },

  async _reVerifyEdits() {
    const content = document.getElementById('tab-content');
    const btn = content.querySelector('#re-verify-btn');
    this._setButtonLoading(btn, 'Asking Max...');

    const selected = this.state.ingredients.filter(i => i.selected);
    const totalCals = selected.reduce((s, i) => s + (Number(i.calories) || 0), 0);

    try {
      const editVerdict = await API.meals.verifyEdit({
        mealName: this.state.mealName,
        originalIngredients: this.state.originalIngredients.filter(o =>
          selected.some(s => s.name === o.name)
        ),
        editedIngredients: selected,
        totalCalories: totalCals
      });
      this.state.editVerdict = editVerdict;
      this.render();
    } catch (err) {
      this._setButtonNormal(btn, `<i data-lucide="shield-check" class="icon-sm"></i> Re-check with Max`);
      this._showRetryBanner(content, 'reverify-retry', 'Max had trouble verifying', () => this._reVerifyEdits());
    }
  },

  async _logMeal() {
    const btn = document.querySelector('#confirm-log-btn');
    if (btn) this._setButtonLoading(btn, 'Logging...');

    const selected = this.state.ingredients.filter(i => i.selected);
    try {
      const result = await API.meals.log({
        name:        this.state.mealName,
        logType:     this.state.logType,
        ingredients: selected,
        imageBase64: this.state.imageBase64 || null,
        aiVerdict:   this.state.editVerdict || this.state.aiVerdict
      });

      showToast(`✓ ${this.state.mealName} logged — ${Math.round(result.meal.totalCalories)} cal`, 'success', 4000);

      this.state = { step: 'entry', mealName: '', ingredients: [], originalIngredients: [], totalCalories: 0, aiVerdict: null, editVerdict: null, logType: 'ai_name', imageBase64: null, loading: false, userMadeEdits: false };

      App.navigateTo('home');

      const bal = result.balance?.currentBalance;
      if (bal !== undefined && bal < 200 && bal > -500) {
        setTimeout(() => PTCoach.openCoaching(), 800);
      }
    } catch (err) {
      if (btn) this._setButtonNormal(btn, `<i data-lucide="check" class="icon-sm"></i> Log This Meal`);
      showToast(err.message || 'Failed to log meal', 'error');
    }
  },

  async _logManual(content) {
    const name    = content.querySelector('#manual-name')?.value?.trim();
    const calories = parseFloat(content.querySelector('#manual-cals')?.value);
    if (!name) { showToast('Enter a meal name', 'warning'); return; }
    if (!calories || isNaN(calories)) { showToast('Enter calories', 'warning'); return; }

    const btn = content.querySelector('#manual-log-btn');
    this._setButtonLoading(btn, 'Logging...');

    try {
      await API.meals.manual({
        name,
        calories,
        protein: parseFloat(content.querySelector('#manual-protein')?.value) || 0,
        carbs:   parseFloat(content.querySelector('#manual-carbs')?.value)   || 0,
        fat:     parseFloat(content.querySelector('#manual-fat')?.value)     || 0
      });
      showToast(`✓ ${name} logged — ${Math.round(calories)} cal`, 'success');
      App.navigateTo('home');
    } catch (err) {
      showToast(err.message || 'Failed to log meal', 'error');
      this._setButtonNormal(btn, `<i data-lucide="check-circle" class="icon-sm"></i> Log Manually`);
    }
  },

  // ── Ingredient Modals ──────────────────────────────────────────────────────

  _showAmountEditor(idx, isConfirmStep = false) {
    const ing = this.state.ingredients[idx];
    if (!ing) return;
    const content = document.getElementById('tab-content');

    const currentUnit  = ing.unit || 'g';
    const currentAmt   = ing.amount ?? ing.amountGrams ?? 100;
    const unitProfile  = this.UNITS[currentUnit] || this.UNITS['g'];

    // Build unit selector options
    const unitOptions = Object.entries(this.UNITS).map(([u, profile]) =>
      `<option value="${u}" ${u === currentUnit ? 'selected' : ''}>${profile.label}</option>`
    ).join('');

    // Build preset buttons based on unit type
    const presets = this._getPresets(currentUnit);
    const presetBtns = presets.map(v =>
      `<button class="preset-btn" data-val="${v}">${v} ${this.UNITS[currentUnit]?.label || currentUnit}</button>`
    ).join('');

    showModal(`
      <div class="modal-handle"></div>
      <div class="modal-title" style="font-size:20px;margin-bottom:4px;">${this._esc(ing.name)}</div>
      <p style="color:var(--text-2);font-size:14px;margin-bottom:24px;">Adjust amount &amp; unit</p>

      <!-- Unit selector -->
      <div style="margin-bottom:16px;">
        <label style="font-size:13px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:8px;">Unit</label>
        <select id="modal-unit-select" class="input select" style="width:100%;">
          ${unitOptions}
        </select>
      </div>

      <!-- Amount input -->
      <div style="margin-bottom:16px;">
        <label style="font-size:13px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:8px;">Amount</label>
        <div style="display:flex;align-items:center;gap:12px;">
          <input type="number" id="modal-amount-input" class="input" style="flex:1;"
                 value="${currentAmt}" min="0.1" step="${unitProfile.step}"
                 placeholder="Amount">
          <span id="modal-unit-label" style="font-size:15px;color:var(--text-2);min-width:60px;">${unitProfile.label}</span>
        </div>
        <div style="font-size:12px;color:var(--text-3);margin-top:6px;" id="modal-validation-msg"></div>
      </div>

      <!-- Presets -->
      <div class="amount-presets" id="modal-presets" style="margin-bottom:24px;">
        ${presetBtns}
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <button class="btn btn-primary" id="modal-apply-amount">Apply</button>
        <button class="btn btn-ghost btn-danger" id="modal-remove-ingredient">
          Remove ingredient
        </button>
      </div>
    `);

    const amtInput    = document.getElementById('modal-amount-input');
    const unitSelect  = document.getElementById('modal-unit-select');
    const unitLabel   = document.getElementById('modal-unit-label');
    const presetsEl   = document.getElementById('modal-presets');
    const validMsg    = document.getElementById('modal-validation-msg');

    const updatePresets = (unit) => {
      const p = this._getPresets(unit);
      const ul = this.UNITS[unit]?.label || unit;
      presetsEl.innerHTML = p.map(v =>
        `<button class="preset-btn" data-val="${v}">${v} ${ul}</button>`
      ).join('');
      presetsEl.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          amtInput.value = btn.dataset.val;
        });
      });
    };

    unitSelect.addEventListener('change', () => {
      const u = unitSelect.value;
      unitLabel.textContent = this.UNITS[u]?.label || u;
      updatePresets(u);
    });

    // Wire initial presets
    presetsEl.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        amtInput.value = btn.dataset.val;
      });
    });

    document.getElementById('modal-apply-amount')?.addEventListener('click', () => {
      const rawVal = parseFloat(amtInput.value);
      const unit   = unitSelect.value;

      if (isNaN(rawVal) || rawVal <= 0) {
        validMsg.textContent = 'Amount must be a positive number';
        validMsg.style.color = 'var(--danger)';
        return;
      }

      const oldAmountGrams = ing.amountGrams || 1;
      const newAmountGrams = this._toGrams(rawVal, unit, ing.name);
      
      const ratio = newAmountGrams / oldAmountGrams;
      if (this.state.ingredients[idx].calories !== undefined) {
        this.state.ingredients[idx].calories = Math.round(this.state.ingredients[idx].calories * ratio * 10) / 10;
        if (this.state.ingredients[idx].protein !== undefined) this.state.ingredients[idx].protein = Math.round(this.state.ingredients[idx].protein * ratio * 10) / 10;
        if (this.state.ingredients[idx].carbs !== undefined) this.state.ingredients[idx].carbs = Math.round(this.state.ingredients[idx].carbs * ratio * 10) / 10;
        if (this.state.ingredients[idx].fat !== undefined) this.state.ingredients[idx].fat = Math.round(this.state.ingredients[idx].fat * ratio * 10) / 10;
      }

      this.state.ingredients[idx].amount = Math.round(rawVal * 1000) / 1000; // up to 3dp
      this.state.ingredients[idx].unit   = unit;
      this.state.ingredients[idx].amountGrams = newAmountGrams;

      // Mark edits made if in confirm step
      if (isConfirmStep) {
        this.state.userMadeEdits = true;
        this.state.editVerdict = null; // clear old edit verdict
      }

      closeModal();
      if (this.state.step === 'ingredients') {
        this._refreshIngredientGrid(content);
      } else {
        this.render(); // full re-render for confirm step
      }
    });

    document.getElementById('modal-remove-ingredient')?.addEventListener('click', () => {
      this.state.ingredients[idx].selected = false;
      closeModal();
      if (isConfirmStep) {
        this.state.userMadeEdits = true;
        this.state.editVerdict = null;
        this.render();
      } else {
        this._refreshIngredientGrid(content);
      }
    });
  },

  _showAddIngredientModal() {
    const unitOptions = Object.entries(this.UNITS).map(([u, profile]) =>
      `<option value="${u}">${profile.label}</option>`
    ).join('');

    showModal(`
      <div class="modal-handle"></div>
      <div class="modal-title" style="font-size:20px;margin-bottom:4px;">Add Ingredient</div>
      <p style="color:var(--text-2);font-size:14px;margin-bottom:24px;">Add a custom ingredient to this meal</p>

      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:13px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:8px;">Ingredient Name</label>
          <input type="text" id="add-ing-name" class="input" placeholder="e.g. Parmesan cheese" autocapitalize="words" style="width:100%;">
        </div>
        <div style="display:flex;gap:12px;">
          <div style="flex:1;">
            <label style="font-size:13px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:8px;">Amount</label>
            <input type="number" id="add-ing-amount" class="input" placeholder="1" min="0.1" step="0.1" value="100">
          </div>
          <div style="flex:1;">
            <label style="font-size:13px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:8px;">Unit</label>
            <select id="add-ing-unit" class="input select" style="width:100%;">
              ${unitOptions}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:13px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;display:block;margin-bottom:8px;">Category</label>
          <select id="add-ing-cat" class="input select" style="width:100%;">
            <option value="protein">Protein</option>
            <option value="carbohydrate">Carbs</option>
            <option value="fat">Fat</option>
            <option value="vegetable">Vegetable</option>
            <option value="dairy">Dairy</option>
            <option value="condiment">Condiment</option>
            <option value="seasoning">Seasoning</option>
            <option value="other" selected>Other</option>
          </select>
        </div>
        <div id="add-ing-validation" style="font-size:12px;color:var(--danger);display:none;"></div>
        <button class="btn btn-primary" id="modal-add-ingredient">
          <i data-lucide="plus" class="icon-sm"></i> Add to List
        </button>
      </div>
    `);
    if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('modal-card')] });

    document.getElementById('modal-add-ingredient')?.addEventListener('click', () => {
      const name   = document.getElementById('add-ing-name')?.value?.trim();
      const amount = parseFloat(document.getElementById('add-ing-amount')?.value);
      const unit   = document.getElementById('add-ing-unit')?.value;
      const cat    = document.getElementById('add-ing-cat')?.value;
      const validEl = document.getElementById('add-ing-validation');

      if (!name) { validEl.textContent = 'Name is required'; validEl.style.display = 'block'; return; }
      if (!amount || isNaN(amount) || amount <= 0) { validEl.textContent = 'Amount must be a positive number'; validEl.style.display = 'block'; return; }

      // Check duplicate
      if (this.state.ingredients.some(i => i.name.toLowerCase() === name.toLowerCase())) {
        validEl.textContent = 'This ingredient is already in the list';
        validEl.style.display = 'block';
        return;
      }

      const amountGrams = this._toGrams(amount, unit, name);

      this.state.ingredients.push({
        name,
        amount,
        unit,
        amountGrams,
        isCommon: true,
        category: cat || 'other',
        selected: true
      });

      closeModal();
      const content = document.getElementById('tab-content');
      this._refreshIngredientGrid(content);
    });
  },

  _applyFlaggedIngredient(fi) {
    const ing = this.state.ingredients.find(i => i.name.toLowerCase() === fi.name.toLowerCase());
    if (!ing) return;
    if (fi.suggestedAmount !== undefined) {
      ing.amount = parseFloat(fi.suggestedAmount) || 0;
      if (fi.suggestedAmountUnit) ing.unit = fi.suggestedAmountUnit;
      ing.amountGrams = this._toGrams(ing.amount, fi.suggestedAmountUnit || ing.unit, ing.name);
    }
    if (fi.suggestedCalories !== undefined) ing.calories = Number(fi.suggestedCalories) || 0;
    this.state.userMadeEdits = true;
    this.state.aiVerdict.flaggedIngredients = this.state.aiVerdict.flaggedIngredients.filter(f => f.name !== fi.name);
    this.state.editVerdict = null;
    this.render();
  },

  _applyEditCorrection(sc) {
    const ing = this.state.ingredients.find(i => i.name.toLowerCase() === (sc.ingredientName || '').toLowerCase());
    if (!ing) return;
    if (sc.suggestedAmount !== undefined) {
      ing.amount = parseFloat(sc.suggestedAmount) || 0;
      if (sc.suggestedAmountUnit) ing.unit = sc.suggestedAmountUnit;
      ing.amountGrams = this._toGrams(ing.amount, sc.suggestedAmountUnit || ing.unit, ing.name);
    }
    if (sc.suggestedCalories !== undefined) ing.calories = Number(sc.suggestedCalories) || 0;
    this.state.editVerdict = null;
    this.state.userMadeEdits = true;
    this.render();
  },

  // ── Grid Refresh ───────────────────────────────────────────────────────────
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
      grid._bound = false;
      grid.innerHTML = this._renderIngredientGrid(grouped);
      grid._bound = false;
      this._bindIngredientEvents(content);
    }

    const selectedCount = this.state.ingredients.filter(i => i.selected).length;
    const subtitle = content.querySelector('#selected-count-subtitle');
    if (subtitle) subtitle.textContent = `${selectedCount} ingredients selected`;

    const lookupBtn = content.querySelector('#lookup-usda-btn');
    if (lookupBtn) {
      lookupBtn.disabled = selectedCount === 0;
      lookupBtn.innerHTML = `<i data-lucide="database" class="icon-sm"></i> Look up Nutrition (${selectedCount} selected)`;
    }

    if (window.lucide) lucide.createIcons({ nodes: [content] });
  },

  // ── Retry Banner ───────────────────────────────────────────────────────────
  _showRetryBanner(container, id, message, retryFn) {
    // Remove old banner if exists
    document.getElementById(id)?.remove();

    const banner = document.createElement('div');
    banner.id = id;
    banner.className = 'retry-banner';
    banner.innerHTML = `
      <i data-lucide="alert-circle" class="icon-sm" style="color:var(--danger);flex-shrink:0;"></i>
      <span style="flex:1;">${this._esc(message)}</span>
      <button class="btn btn-sm retry-btn" style="background:var(--surface-2);border-radius:99px;white-space:nowrap;">
        <i data-lucide="refresh-cw" class="icon-sm"></i> Retry
      </button>
    `;
    banner.querySelector('.retry-btn').addEventListener('click', () => {
      banner.remove();
      retryFn();
    });
    container.appendChild(banner);
    if (window.lucide) lucide.createIcons({ nodes: [banner] });
  },

  // ── Button State Helpers ───────────────────────────────────────────────────
  _setButtonLoading(btn, text) {
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="icon-sm spin"></i> ${text}`;
    if (window.lucide) lucide.createIcons({ nodes: [btn] });
  },

  _setButtonNormal(btn, html) {
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = html;
    if (window.lucide) lucide.createIcons({ nodes: [btn] });
  },

  // ── Unit Conversion ────────────────────────────────────────────────────────
  _toGrams(amount, unit, name) {
    const n = (name || '').toLowerCase();
    switch (unit) {
      case 'egg':   return amount * 50;
      case 'slice': {
        if (n.includes('bread') || n.includes('toast')) return amount * 30;
        if (n.includes('cheese')) return amount * 22;
        return amount * 25;
      }
      case 'strip':  return amount * 15;
      case 'clove':  return amount * 5;
      case 'cup':    return amount * 240;
      case 'ml':     return amount;
      case 'tbsp':   return amount * 15;
      case 'tsp':    return amount * 5;
      case 'pinch':  return amount * 0.5;
      case 'oz':     return amount * 28.35;
      case 'g':
      default:       return amount;
    }
  },

  _getPresets(unit) {
    const presets = {
      g:      [25, 50, 100, 150, 200, 300],
      oz:     [1, 2, 3, 4, 6, 8],
      egg:    [1, 2, 3, 4],
      slice:  [1, 2, 3, 4],
      strip:  [1, 2, 3, 4],
      clove:  [1, 2, 3, 4, 6],
      ml:     [50, 100, 150, 200, 250, 500],
      cup:    [0.25, 0.5, 0.75, 1, 1.5, 2],
      tbsp:   [0.5, 1, 1.5, 2, 3, 4],
      tsp:    [0.25, 0.5, 1, 1.5, 2],
      pinch:  [1, 2, 3],
      piece:  [1, 2, 3, 4, 5],
      serving:[1, 2]
    };
    return presets[unit] || [25, 50, 100, 150, 200];
  },

  // ── Utilities ──────────────────────────────────────────────────────────────
  _esc(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
  }
};
