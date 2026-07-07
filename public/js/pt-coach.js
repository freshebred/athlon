/* pt-coach.js — Max the PT Coach (Persistent Chat Drawer) */

const PTCoach = {
  conversationId: null,
  pendingContext: null,   // context set before drawer opens
  isOpen: false,
  isTyping: false,

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

    this._addUserMessage(text);
    this._showTyping();

    try {
      // Build context for disputes
      let apiContext = null;
      if (this.pendingContext && !this.conversationId) {
        const ctx = this.pendingContext;
        if (ctx.referenceId && ctx.referenceType) {
          // Start formal dispute conversation
          const data = await API.ptCoach.startDispute({
            referenceId: ctx.referenceId,
            referenceType: ctx.referenceType,
            initialMessage: text
          });
          this._hideTyping();
          if (data.uiToolCalls && data.uiToolCalls.length) {
            this._renderToolCalls(data.uiToolCalls);
          }
          this._addBotMessage(data.message);
          this.conversationId = data.conversationId;
          sessionStorage.setItem('athlon_pt_conv', this.conversationId);
          this.pendingContext = null;
          return;
        }

        // General coaching context — normalize type to schema enum
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
      this._addBotMessage(data.message);

      if (data.conversationId && !this.conversationId) {
        this.conversationId = data.conversationId;
        sessionStorage.setItem('athlon_pt_conv', this.conversationId);
      }

      // Handle action results (PT approved/denied something)
      if (data.actionResult) {
        this._handleActionResult(data.actionResult);
      }

    } catch (err) {
      this._hideTyping();
      this._addBotMessage("Sorry, I'm having trouble connecting right now. Try again in a sec.");
      console.error('[PT-COACH]', err.message);
    }
  },

  // ── Action Results ─────────────────────────────────────────────────────────
  _handleActionResult(result) {
    switch (result.action) {
      case 'meal_deleted':
        showToast(`✓ Meal deleted. +${Math.round(result.caloriesRestored || 0)} cal restored.`, 'success', 4000);
        App.refreshCurrentTab();
        break;
      case 'meal_edited':
        showToast(`✓ Meal updated: ${Math.round(result.oldCalories)} → ${Math.round(result.newCalories)} cal`, 'success', 4000);
        App.refreshCurrentTab();
        break;
      case 'workout_adjusted':
        showToast(`✓ Workout updated: +${Math.round(result.newCalories)} cal earned`, 'success', 4000);
        App.refreshCurrentTab();
        break;
      case 'denied':
        // No toast — Max already explained in chat
        break;
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

  _addBotMessage(text) {
    const container = document.getElementById('pt-messages');
    if (!container) return;

    const msg = document.createElement('div');
    msg.className = 'chat-message bot-message';
    msg.innerHTML = `
      <div class="bot-avatar-sm">M</div>
      <div class="chat-bubble bot-bubble">${this._formatBotMessage(text)}</div>
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
    // Convert markdown-lite: **bold**, newlines → <br>
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
