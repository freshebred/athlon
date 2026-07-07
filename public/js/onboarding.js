/* onboarding.js — Athlon Conversational AI Onboarding */

const OnboardingPage = {
  conversationId: null,
  messages: [],
  isTyping: false,
  isComplete: false,

  init() {
    const screen = document.getElementById('onboarding-screen');
    screen.innerHTML = this._renderShell();
    this._bindEvents(screen);
    if (window.lucide) lucide.createIcons({ nodes: [screen] });
    // Start conversation
    setTimeout(() => this._sendMessage(null, true), 500);
  },

  _renderShell() {
    return `
      <div class="onboarding-page">
        <div class="onboarding-header">
          <span class="logo-a">A</span><span style="font-family:var(--font-heading);font-weight:800;">thlon</span>
        </div>
        <div class="onboarding-intro">
          <h2>Meet Max, Your Coach 👋</h2>
          <p>Answer a few quick questions so Max can personalize your calorie bank.</p>
        </div>
        <div class="chat-container" id="ob-chat"></div>
        <div class="onboarding-input-row" id="ob-input-row">
          <textarea id="ob-input" placeholder="Type your answer..." rows="1" style="max-height:100px;"></textarea>
          <button class="send-btn" id="ob-send" aria-label="Send">
            <i data-lucide="send" class="icon-sm"></i>
          </button>
        </div>
      </div>
    `;
  },

  _bindEvents(screen) {
    const input  = screen.querySelector('#ob-input');
    const sendBtn = screen.querySelector('#ob-send');

    const submit = () => {
      const text = input.value.trim();
      if (!text || this.isTyping || this.isComplete) return;
      this._addBubble(text, 'user');
      input.value = '';
      input.style.height = '';
      this._sendMessage(text);
    };

    sendBtn.addEventListener('click', submit);

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  },

  async _sendMessage(userMessage, isFirst = false) {
    this.isTyping = true;
    this._toggleInput(false);
    this._showTyping();

    try {
      const payload = isFirst ? '__start__' : userMessage;
      const data    = await API.onboarding.chat(payload);

      this._hideTyping();

      if (data.conversationId) this.conversationId = data.conversationId;

      // Show AI reply
      if (data.message) {
        this._addBubble(data.message, 'ai');
      }

      // Show quick replies if provided
      if (data.quickReplies?.length) {
        this._showQuickReplies(data.quickReplies);
      }

      // Onboarding complete
      if (data.complete && data.user) {
        this.isComplete = true;
        await new Promise(r => setTimeout(r, 2500));
        App.onOnboardingComplete(data.user);
        return;
      }

      this.isTyping = false;
      this._toggleInput(true);
      const inputEl = document.querySelector('#ob-input');
      if (inputEl) inputEl.focus();

    } catch (err) {
      this._hideTyping();
      this._addBubble("Sorry, I hit a snag. Please try again.", 'ai', true);
      this.isTyping = false;
      this._toggleInput(true);
    }
  },

  _addBubble(text, role, isError = false) {
    const chat = document.getElementById('ob-chat');
    if (!chat) return;

    const wrap = document.createElement('div');
    wrap.className = `chat-bubble ${role === 'user' ? 'user' : ''}`;

    const avatarClass = role === 'user' ? 'user-av' : '';
    const avatarChar  = role === 'user' ? (App.currentUser ? getInitials(App.currentUser.name) : 'U') : 'M';

    wrap.innerHTML = `
      <div class="bubble-avatar ${avatarClass}">${avatarChar}</div>
      <div class="bubble-content" style="${isError ? 'color:var(--danger)' : ''}">${this._escapeHtml(text)}</div>
    `;
    chat.appendChild(wrap);
    this._scrollToBottom();
  },

  _showQuickReplies(replies) {
    const chat = document.getElementById('ob-chat');
    if (!chat) return;

    const wrap = document.createElement('div');
    wrap.className = 'quick-replies';
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:4px 0 4px 46px;';
    wrap.id = 'quick-replies';

    replies.forEach(reply => {
      const btn = document.createElement('button');
      btn.className = 'activity-chip';
      btn.textContent = reply;
      btn.addEventListener('click', () => {
        wrap.remove();
        this._addBubble(reply, 'user');
        this._sendMessage(reply);
      });
      wrap.appendChild(btn);
    });

    chat.appendChild(wrap);
    this._scrollToBottom();
  },

  _showTyping() {
    const chat = document.getElementById('ob-chat');
    if (!chat) return;

    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble';
    wrap.id = 'typing-bubble';
    wrap.innerHTML = `
      <div class="bubble-avatar">M</div>
      <div class="bubble-content" style="padding:0;">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    chat.appendChild(wrap);
    this._scrollToBottom();
  },

  _hideTyping() {
    document.getElementById('typing-bubble')?.remove();
  },

  _toggleInput(enabled) {
    const inputRow = document.getElementById('ob-input-row');
    const input    = document.getElementById('ob-input');
    const sendBtn  = document.getElementById('ob-send');
    if (inputRow) inputRow.style.opacity = enabled ? '1' : '0.5';
    if (input)    input.disabled = !enabled;
    if (sendBtn)  sendBtn.disabled = !enabled;
  },

  _scrollToBottom() {
    const chat = document.getElementById('ob-chat');
    if (chat) {
      setTimeout(() => {
        chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
      }, 60);
    }
  },

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
};
