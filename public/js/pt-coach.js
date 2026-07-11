/* pt-coach.js — Max the PT Coach (Persistent Chat Drawer) */

const PTCoach = {
  conversationId: null,
  pendingContext: null,
  isOpen: false,
  isTyping: false,
  _lastMessageText: null,  // for retry on failure
  _lastMessageIsDispute: false,

  // Patterns to detect leaked AI internals client-side
  _leakPatterns: [
    /<tool_call>/i,
    /<\/tool_call>/i,
    /\{"(searchUSDA|getRecentMeals|getRecentWorkouts|logFood|getUserInformation|scheduleCheckIn|cancelCheckIn|getActiveCheckIns|reportUnsupportedCapability)":/,
    /\[TOOL_CALL\]/i,
    /"tool_calls"\s*:/,
    /\btool_call_id\b/
  ],

  _hasLeakedInternals(text) {
    if (!text) return false;
    return this._leakPatterns.some(p => p.test(text));
  },

  init() {
    const fab      = document.getElementById('pt-coach-fab');
    const overlay  = document.getElementById('pt-overlay');
    const drawer   = document.getElementById('pt-drawer');
    const closeBtn = document.getElementById('pt-close');
    const sendBtn  = document.getElementById('pt-send');
    const input    = document.getElementById('pt-input');

    if (!fab) return;

    fab.addEventListener('click', () => this.toggle());
    closeBtn?.addEventListener('click', () => this.close());
    overlay?.addEventListener('click', () => this.close());
    sendBtn?.addEventListener('click', () => this._sendMessage());

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    });

    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // Restore conversation ID from session
    this.conversationId = sessionStorage.getItem('athlon_pt_conv') || null;
  },

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  },

  open() {
    const overlay = document.getElementById('pt-overlay');
    const drawer  = document.getElementById('pt-drawer');

    overlay?.classList.remove('hidden');
    drawer?.classList.remove('hidden');

    requestAnimationFrame(() => {
      overlay?.classList.add('pt-overlay-show');
      drawer?.classList.add('pt-drawer-show');
    });

    this.isOpen = true;
    document.body.style.overflow = 'hidden';

    // If no prior messages, greet the user
    const messages = document.getElementById('pt-messages');
    if (messages && !messages.children.length) {
      this._addBotMessage(this._getGreeting());
    }

    setTimeout(() => {
      document.getElementById('pt-input')?.focus();
      this._scrollToBottom();
    }, 300);
  },

  close() {
    const overlay = document.getElementById('pt-overlay');
    const drawer  = document.getElementById('pt-drawer');

    overlay?.classList.remove('pt-overlay-show');
    drawer?.classList.remove('pt-drawer-show');

    setTimeout(() => {
      overlay?.classList.add('hidden');
      drawer?.classList.add('hidden');
    }, 280);

    this.isOpen = false;
    this.pendingContext = null;
    document.body.style.overflow = '';
  },

  /**
   * Open with a specific context (dispute or coaching nudge)
   * Called from home.js and history.js after user taps "Dispute with Max"
   */
  openWithContext(ctx) {
    this.pendingContext = ctx;
    this.open();

    // Clear conversation for new disputes
    if (ctx.type !== 'general') {
      this.conversationId = null;
      sessionStorage.removeItem('athlon_pt_conv');
      document.getElementById('pt-messages').innerHTML = '';
    }

    // Auto-send the context message after opening
    setTimeout(() => {
      if (ctx.message) {
        this._sendMessage(ctx.message);
      }
    }, 400);
  },

  /**
   * Open in coaching mode (called after workout log)
   */
  openCoaching() {
    this.open();
    // PT will proactively greet from context data
  },

  // ── Message Sending ────────────────────────────────────────────────────────
  async _sendMessage(overrideText) {
    const input = document.getElementById('pt-input');
    const text  = overrideText || input?.value?.trim();
    if (!text || this.isTyping) return;

    if (!overrideText && input) {
      input.value = '';
      input.style.height = 'auto';
    }

    this._lastMessageText = text;
    this._addUserMessage(text);
    this._showTyping();

    try {
      // Build context for disputes
      let apiContext = null;
      if (this.pendingContext && !this.conversationId) {
        const ctx = this.pendingContext;
        if (ctx.referenceId && ctx.referenceType) {
          this._lastMessageIsDispute = true;
          const data = await API.ptCoach.startDispute({
            referenceId: ctx.referenceId,
            referenceType: ctx.referenceType,
            initialMessage: text
          });
          this._hideTyping();
          if (data.uiToolCalls && data.uiToolCalls.length) {
            this._renderToolCalls(data.uiToolCalls);
          }
          const msg = data.message;
          if (this._hasLeakedInternals(msg)) {
            this._handleSeizure();
            return;
          }
          if (data.errorFlags && data.errorFlags.includes("media_unavailable")) {
            this._addBotMessage('<div class="media-error-card" style="margin-left:2rem; padding:8px; border:1px solid #ff4d4d; border-radius:4px; color:#ff4d4d; font-size:12px; margin-bottom:8px;">⚠️ Media unavailable. Max cannot process images at the moment.</div>');
          }
          this._addBotMessage(msg);
          if (data.pendingActions && data.pendingActions.length) {
            this._renderPendingActions(data.pendingActions);
          }
          this.conversationId = data.conversationId;
          sessionStorage.setItem('athlon_pt_conv', this.conversationId);
          this.pendingContext = null;
          this._lastMessageIsDispute = false;
          return;
        }

        const typeMap = {
          'meal_dispute':        'dispute_meal',
          'meal_delete_request': 'dispute_meal',
          'workout_dispute':     'dispute_workout',
          'dispute_meal':        'dispute_meal',
          'dispute_workout':     'dispute_workout',
          'coaching':            'coaching'
        };
        apiContext = { type: typeMap[ctx.type] || 'general' };
        this.pendingContext = null;
      }

      // Regular chat
      const data = await API.ptCoach.chat(text, this.conversationId, apiContext);
      this._hideTyping();
      if (data.uiToolCalls && data.uiToolCalls.length) {
        this._renderToolCalls(data.uiToolCalls);
      }

      const msg = data.message;
      // Client-side check for leaked internals (should have been caught server-side)
      if (this._hasLeakedInternals(msg)) {
        this._handleSeizure();
        return;
      }

      if (data.errorFlags && data.errorFlags.includes("media_unavailable")) {
        this._addBotMessage('<div class="media-error-card" style="margin-left:2rem; padding:8px; border:1px solid #ff4d4d; border-radius:4px; color:#ff4d4d; font-size:12px; margin-bottom:8px;">⚠️ Media unavailable. Max cannot process images at the moment.</div>');
      }

      this._addBotMessage(msg);

      if (data.conversationId && !this.conversationId) {
        this.conversationId = data.conversationId;
        sessionStorage.setItem('athlon_pt_conv', this.conversationId);
      }

      if (data.pendingActions && data.pendingActions.length) {
        this._renderPendingActions(data.pendingActions);
      }

    } catch (err) {
      this._hideTyping();
      // Show retry option on error
      this._addBotMessage(this._buildRetryMessage(err.message));
      console.error('[PT-COACH]', err.message);
    }
  },

  /**
   * Called when leaked internals are detected in a response.
   * Shows the "Max had a seizure" message and auto-retries once.
   */
  async _handleSeizure() {
    this._hideTyping();
    this._addSeizureMessage();
    await new Promise(resolve => setTimeout(resolve, 1500)); // brief pause for UX

    // Auto-retry the last message
    this._showTyping();
    try {
      const data = await API.ptCoach.chat(this._lastMessageText, this.conversationId, null);
      this._hideTyping();
      const msg = data.message;
      // If still leaking after retry, just show cleaned text or fallback
      if (this._hasLeakedInternals(msg)) {
        this._addBotMessage("I seem to be having technical difficulties. Please try asking again.");
      } else {
        this._addBotMessage(msg);
      }
      if (data.conversationId && !this.conversationId) {
        this.conversationId = data.conversationId;
        sessionStorage.setItem('athlon_pt_conv', this.conversationId);
      }
    } catch (retryErr) {
      this._hideTyping();
      this._addBotMessage("Still having issues. Please try again in a moment.");
    }
  },

  /**
   * Build an HTML string for an error message with a Retry button.
   */
  _buildRetryMessage(errMsg) {
    return `Sorry, I'm having trouble connecting right now. <button onclick="PTCoach._retryLastMessage()" style="background:var(--accent-dim);color:var(--accent);border:none;border-radius:99px;padding:4px 14px;font-size:13px;font-weight:600;cursor:pointer;margin-top:6px;display:inline-flex;align-items:center;gap:6px;">↺ Retry</button>`;
  },

  _retryLastMessage() {
    if (this._lastMessageText) {
      // Remove the error message
      const container = document.getElementById('pt-messages');
      const last = container?.lastElementChild;
      if (last) last.remove();
      this._sendMessage(this._lastMessageText);
    }
  },

  // ── Action Results ─────────────────────────────────────────────────────────
  _handleActionResult(result) {
    if (!result) return;
    switch (result.action) {
      case 'meal_deleted':
        showToast(`✓ Meal deleted. +${Math.round(result.caloriesRestored || 0)} cal restored.`, 'success', 4000);
        break;
      case 'meal_edited':
      case 'ingredient_edited':
        showToast(`✓ Meal updated: ${Math.round(result.oldCalories)} → ${Math.round(result.newCalories)} cal`, 'success', 4000);
        break;
      case 'workout_adjusted':
        showToast(`✓ Workout updated: +${Math.round(result.newCalories)} cal earned`, 'success', 4000);
        break;
      case 'food_logged':
        showToast(`✓ Food logged successfully.`, 'success', 4000);
        break;
      case 'workout_logged':
        showToast(`✓ Workout logged successfully.`, 'success', 4000);
        break;
      case 'user_info_updated':
        showToast(`✓ Profile updated successfully.`, 'success', 4000);
        break;
      case 'denied':
        // No toast — Max already explained in chat
        return;
    }
    if (App && typeof App.refreshCurrentTab === 'function') {
      App.refreshCurrentTab();
    }
  },

  _renderPendingActions(actions) {
    const container = document.getElementById('pt-messages');
    if (!container) return;

    actions.forEach(action => {
      const msg = document.createElement('div');
      msg.className = 'chat-message bot-message pending-action-card';
      msg.id = `pending-action-${action.id}`;
      
      let title = "Max wants to modify your data";
      let details = "";

      let isDraft = false;

      if (action.type === 'log_food') {
        title = "Draft Meal Log";
        details = `${action.data.data?.name || 'Unknown'} (${action.data.data?.calories || 0} kcal)`;
        isDraft = true;
      } else if (action.type === 'log_workout') {
        title = "Draft Workout Log";
        details = `${action.data.data?.activityType || 'Unknown'} - ${action.data.data?.duration || 0}m (${action.data.data?.calories || 0} kcal)`;
        isDraft = true;
      } else if (action.type === 'update_user_info') {
        title = "Update Profile";
        details = JSON.stringify(action.data.data || {});
      } else if (action.type === 'request_media') {
        title = "Media Request";
        details = action.data.data?.reason || 'Upload a photo';
      } else {
        title = "Resolve Dispute";
        details = action.type.replace(/_/g, ' ');
      }

      msg.innerHTML = `
        <div style="background: ${isDraft ? 'rgba(0, 200, 83, 0.05)' : 'var(--bg-card)'}; padding: 12px; border-radius: 8px; border: ${isDraft ? '2px dashed var(--accent)' : '1px solid var(--border)'}; margin-left: 2rem; width: 100%;">
          ${isDraft ? '<div style="font-size: 10px; color: var(--accent); font-weight: bold; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px;">📋 Pending Draft</div>' : ''}
          <div style="font-size: 13px; font-weight: bold; color: var(--text-primary); margin-bottom: 4px;">🛠️ ${this._esc(title)}</div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">${this._esc(details)}</div>
          
          ${action.type === 'request_media' 
            ? `<div style="margin-bottom: 8px;"><input type="file" id="media-upload-${action.id}" accept="image/*" style="font-size: 12px;" /></div>`
            : ''
          }
          
          <div style="display: flex; gap: 8px;">
            <button onclick="PTCoach._approveAction('${action.id}', '${action.type}')" style="background: var(--accent); color: #000; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">Approve</button>
            <button onclick="PTCoach._rejectAction('${action.id}')" style="background: transparent; color: var(--text-secondary); border: 1px solid var(--border); padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">Reject</button>
          </div>
        </div>
      `;
      container.appendChild(msg);
      requestAnimationFrame(() => msg.classList.add('message-in'));
    });
    this._scrollToBottom();
  },

  async _approveAction(actionId, type) {
    const card = document.getElementById(`pending-action-${actionId}`);
    if (card) card.style.opacity = '0.5';

    if (type === 'request_media') {
      const fileInput = document.getElementById(`media-upload-${actionId}`);
      if (!fileInput || !fileInput.files[0]) {
        showToast('Please select a file to upload.', 'error');
        if (card) card.style.opacity = '1';
        return;
      }
      // Note: We would implement actual media upload logic here. For now we simulate success.
      // In a real app we'd use FormData and API.postForm.
      showToast('Media uploaded! (Simulated)', 'success');
      if (card) card.innerHTML = `<div style="font-size: 12px; color: var(--accent); margin-left: 2rem;">✅ Media Provided</div>`;
      this._sendMessage('I have uploaded the media.');
      return;
    }
    
    try {
      const res = await API.ptCoach.actionApprove(this.conversationId, actionId);
      if (card) card.innerHTML = `<div style="font-size: 12px; color: var(--accent); margin-left: 2rem;">✅ Action Approved</div>`;
      if (res.result) this._handleActionResult(res.result);
      else {
        showToast('✓ Action Approved', 'success');
        if (App && typeof App.refreshCurrentTab === 'function') App.refreshCurrentTab();
      }
    } catch (e) {
      if (card) card.style.opacity = '1';
      showToast('Failed to approve action: ' + e.message, 'error');
    }
  },

  async _rejectAction(actionId) {
    const card = document.getElementById(`pending-action-${actionId}`);
    if (card) card.style.opacity = '0.5';

    try {
      await API.ptCoach.actionReject(this.conversationId, actionId);
      if (card) card.innerHTML = `<div style="font-size: 12px; color: var(--danger); margin-left: 2rem;">❌ Action Rejected</div>`;
      this._sendMessage('I rejected your proposed action.');
    } catch (e) {
      if (card) card.style.opacity = '1';
      showToast('Failed to reject action', 'error');
    }
  },

  // ── UI Helpers ─────────────────────────────────────────────────────────────
  _addUserMessage(text) {
    const container = document.getElementById('pt-messages');
    if (!container) return;

    const msg = document.createElement('div');
    msg.className = 'chat-message user-message';
    msg.innerHTML = `<div class="chat-bubble user-bubble">${this._esc(text)}</div>`;
    container.appendChild(msg);

    requestAnimationFrame(() => msg.classList.add('message-in'));
    this._scrollToBottom();
  },

  _addBotMessage(html) {
    const container = document.getElementById('pt-messages');
    if (!container) return;

    const msg = document.createElement('div');
    msg.className = 'chat-message bot-message';
    msg.innerHTML = `
      <div class="bot-avatar-sm">M</div>
      <div class="chat-bubble bot-bubble">${this._formatBotMessage(html)}</div>
    `;
    container.appendChild(msg);

    requestAnimationFrame(() => msg.classList.add('message-in'));
    this._scrollToBottom();
  },

  /** Adds the "Max had a seizure" recovery message */
  _addSeizureMessage() {
    const container = document.getElementById('pt-messages');
    if (!container) return;

    const msg = document.createElement('div');
    msg.className = 'chat-message bot-message seizure-message';
    msg.innerHTML = `
      <div class="bot-avatar-sm" style="background:var(--danger-dim);color:var(--danger);">M</div>
      <div class="chat-bubble bot-bubble" style="background:var(--danger-dim);border:1px solid rgba(255,71,87,0.2);">
        <em style="font-size:13px;color:var(--danger);">Max had a seizure trying to respond, we're resuscitating him, one sec...</em>
      </div>
    `;
    container.appendChild(msg);
    requestAnimationFrame(() => msg.classList.add('message-in'));
    this._scrollToBottom();
  },

  _renderToolCalls(calls) {
    const container = document.getElementById('pt-messages');
    if (!container) return;

    calls.forEach(call => {
      let text = 'Working...';
      if (call.name === 'searchUSDA') {
        let args = {}; try { args = JSON.parse(call.args); } catch(e){}
        text = `Max searched USDA for "${args.query || 'ingredient'}"`;
      } else if (call.name === 'getRecentMeals') {
        text = `Max checked your recent meals`;
      } else if (call.name === 'getRecentWorkouts') {
        text = `Max checked your recent workouts`;
      } else if (call.name === 'logFood') {
        let args = {}; try { args = JSON.parse(call.args); } catch(e){}
        text = `Max logged ${args.name} (${args.calories} cals)`;
      } else if (call.name === 'getUserInformation') {
        text = `Max checked your profile information`;
      } else if (call.name === 'scheduleCheckIn') {
        text = `Max scheduled a check-in`;
      } else if (call.name === 'cancelCheckIn') {
        text = `Max cancelled a check-in`;
      } else if (call.name === 'getActiveCheckIns') {
        text = `Max checked your active check-ins`;
      } else if (call.name === 'reportUnsupportedCapability') {
        text = `Max reported an unsupported capability`;
      } else {
        text = `Max used tool: ${call.name}`;
      }

      const msg = document.createElement('div');
      msg.className = 'chat-message bot-message tool-message';
      msg.innerHTML = `
        <div style="font-size: 0.8rem; color: var(--text-tertiary); display: flex; align-items: center; gap: 0.5rem; margin-left: 2rem;">
          <i data-lucide="cpu" class="icon-xs"></i> <span>${this._esc(text)}</span>
        </div>
      `;
      container.appendChild(msg);
      lucide.createIcons({ root: msg });
      requestAnimationFrame(() => msg.classList.add('message-in'));
    });
    this._scrollToBottom();
  },

  _showTyping() {
    this.isTyping = true;
    const container = document.getElementById('pt-messages');
    if (!container) return;

    const typing = document.createElement('div');
    typing.className = 'chat-message bot-message typing-indicator-wrap';
    typing.id = 'typing-indicator';
    typing.innerHTML = `
      <div class="bot-avatar-sm">M</div>
      <div class="chat-bubble bot-bubble typing-indicator">
        <span></span><span></span><span></span>
      </div>
    `;
    container.appendChild(typing);
    this._scrollToBottom();

    const sendBtn = document.getElementById('pt-send');
    if (sendBtn) sendBtn.disabled = true;
  },

  _hideTyping() {
    this.isTyping = false;
    document.getElementById('typing-indicator')?.remove();
    const sendBtn = document.getElementById('pt-send');
    if (sendBtn) sendBtn.disabled = false;
  },

  _scrollToBottom() {
    const container = document.getElementById('pt-messages');
    if (container) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  },

  _getGreeting() {
    const hour = new Date().getHours();
    const user = App.currentUser;
    const name = user?.name?.split(' ')[0] || '';

    const greetings = hour < 12
      ? [`Morning${name ? ', ' + name : ''}! Ready to crush today's goals?`,
         `Good morning! Let's make today count.`]
      : hour < 17
      ? [`Hey${name ? ' ' + name : ''}! How's the day going?`,
         `Afternoon check-in — how are you tracking?`]
      : [`Evening${name ? ', ' + name : ''}! How'd today go?`,
         `Hey, it's Max. How are we looking for today?`];

    return greetings[Math.floor(Math.random() * greetings.length)];
  },

  _formatBotMessage(text) {
    // If the text contains HTML (e.g. retry button), render it directly but still escape user-visible parts
    if (text && text.includes('<button')) {
      // Already HTML — just do basic markdown on the non-HTML parts
      return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    }
    return this._esc(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  },

  _esc(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
  }
};
