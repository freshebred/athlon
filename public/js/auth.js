/* auth.js — Athlon Auth Page */

const AuthPage = {
  mode: 'login', // 'login' | 'register'

  init() {
    const screen = document.getElementById('auth-screen');
    screen.innerHTML = this._render();
    this._bindEvents(screen);
    if (window.lucide) lucide.createIcons({ nodes: [screen] });
  },

  _render() {
    return `
      <div class="auth-page">
        <div class="auth-logo" style="display: flex; flex-direction: column; align-items: center;">
          <img src="/icons/icon.svg" alt="Athlon Logo" style="width: 48px; height: 48px; margin-bottom: 12px; border-radius: 12px;">
          <div><span style="color:var(--accent)">A</span>THLON</div>
        </div>
        <p class="auth-tagline">Your AI-powered calorie bank</p>

        <div class="auth-card">
          <div class="auth-tabs">
            <div class="auth-tab ${this.mode === 'login' ? 'active' : ''}" data-mode="login">Sign In</div>
            <div class="auth-tab ${this.mode === 'register' ? 'active' : ''}" data-mode="register">Create Account</div>
          </div>

          <div class="auth-error" id="auth-error"></div>

          <form class="auth-form" id="auth-form" novalidate>
            ${this.mode === 'register' ? `
            <div class="form-group">
              <label class="form-label" for="auth-name">Full Name</label>
              <input class="form-input" type="text" id="auth-name" name="name"
                     placeholder="Jordan Smith" autocomplete="name" required>
            </div>` : ''}

            <div class="form-group">
              <label class="form-label" for="auth-email">Email Address</label>
              <input class="form-input" type="email" id="auth-email" name="email"
                     placeholder="you@example.com" autocomplete="email" required>
            </div>

            <div class="form-group">
              <label class="form-label" for="auth-password">Password</label>
              <div class="password-input-wrap">
                <input class="form-input" type="password" id="auth-password" name="password"
                       placeholder="${this.mode === 'register' ? 'Min 8 characters' : 'Your password'}"
                       autocomplete="${this.mode === 'login' ? 'current-password' : 'new-password'}" required>
                <span class="password-toggle" id="pw-toggle" aria-label="Toggle password visibility">
                  <i data-lucide="eye" class="icon-sm"></i>
                </span>
              </div>
            </div>

            ${this.mode === 'register' ? `
            <div class="form-group">
              <label class="form-label" for="auth-confirm">Confirm Password</label>
              <div class="password-input-wrap">
                <input class="form-input" type="password" id="auth-confirm" name="confirmPassword"
                       placeholder="Re-enter password" autocomplete="new-password" required>
                <span class="password-toggle" id="pw-toggle-2" aria-label="Toggle password visibility">
                  <i data-lucide="eye" class="icon-sm"></i>
                </span>
              </div>
            </div>` : ''}

            <button class="btn btn-primary btn-full" type="submit" id="auth-submit" style="margin-top:8px;">
              <span id="auth-btn-text">${this.mode === 'login' ? 'Sign In' : 'Create Account'}</span>
              <div class="spinner" id="auth-spinner" style="display:none; border-top-color:#0A0F1E; border-color:rgba(10,15,30,0.3);"></div>
            </button>
          </form>

          ${this.mode === 'login' ? `
          <div class="auth-divider">or continue with</div>
          <p style="text-align:center; font-size:0.8125rem; color:var(--text-2);">
            Don't have an account?
            <a href="#" id="switch-to-register" style="color:var(--accent); font-weight:600;">Sign up free</a>
          </p>` : `
          <p style="text-align:center; font-size:0.8125rem; color:var(--text-2); margin-top:16px;">
            Already have an account?
            <a href="#" id="switch-to-login" style="color:var(--accent); font-weight:600;">Sign in</a>
          </p>`}
        </div>

        <p style="margin-top:24px; font-size:0.75rem; color:var(--text-3); text-align:center; max-width:300px;">
          By continuing, you agree to Athlon's <a href="/tos.html" style="color:var(--accent); text-decoration:underline;">Terms of Service</a> and <a href="/privacy.html" style="color:var(--accent); text-decoration:underline;">Privacy Policy</a>.
        </p>

        <div style="margin-top: 32px; font-size: 0.75rem; color: var(--text-3); text-align: center;">
          Made with ❤️ by <a href="https://portfolio.hgphnm.com" target="_blank" style="color:var(--text-2); font-weight:600; text-decoration:none;">Freshebred</a><br>
          <span style="opacity: 0.8; font-size: 0.7rem;">(and his beloved Gemini)</span>
        </div>
      </div>
    `;
  },

  _bindEvents(screen) {
    // Tab switching
    screen.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.mode = tab.dataset.mode;
        this.init();
      });
    });

    // Switch links
    const switchReg = screen.querySelector('#switch-to-register');
    if (switchReg) switchReg.addEventListener('click', e => { e.preventDefault(); this.mode = 'register'; this.init(); });
    const switchLogin = screen.querySelector('#switch-to-login');
    if (switchLogin) switchLogin.addEventListener('click', e => { e.preventDefault(); this.mode = 'login'; this.init(); });

    // Password toggles
    this._bindPasswordToggle(screen, 'pw-toggle', 'auth-password');
    this._bindPasswordToggle(screen, 'pw-toggle-2', 'auth-confirm');

    // Form submit
    screen.querySelector('#auth-form').addEventListener('submit', e => {
      e.preventDefault();
      this._handleSubmit(screen);
    });
  },

  _bindPasswordToggle(screen, toggleId, inputId) {
    const toggle = screen.querySelector('#' + toggleId);
    const input  = screen.querySelector('#' + inputId);
    if (!toggle || !input) return;

    toggle.addEventListener('click', () => {
      const shown = input.type === 'text';
      input.type  = shown ? 'password' : 'text';
      const icon  = toggle.querySelector('i');
      if (icon) {
        icon.setAttribute('data-lucide', shown ? 'eye' : 'eye-off');
        if (window.lucide) lucide.createIcons({ nodes: [toggle] });
      }
    });
  },

  _showError(screen, message) {
    const el = screen.querySelector('#auth-error');
    el.textContent = message;
    el.classList.add('visible');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  _hideError(screen) {
    const el = screen.querySelector('#auth-error');
    el.classList.remove('visible');
  },

  _setLoading(screen, loading) {
    const btn     = screen.querySelector('#auth-submit');
    const btnText = screen.querySelector('#auth-btn-text');
    const spinner = screen.querySelector('#auth-spinner');
    btn.disabled        = loading;
    btnText.style.display   = loading ? 'none' : '';
    spinner.style.display   = loading ? 'block' : 'none';
  },

  async _handleSubmit(screen) {
    this._hideError(screen);

    const email    = screen.querySelector('#auth-email')?.value.trim();
    const password = screen.querySelector('#auth-password')?.value;
    const name     = screen.querySelector('#auth-name')?.value.trim();
    const confirm  = screen.querySelector('#auth-confirm')?.value;

    // Validation
    if (!email || !email.includes('@')) {
      this._showError(screen, 'Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 6) {
      this._showError(screen, 'Password must be at least 6 characters.');
      return;
    }
    if (this.mode === 'register') {
      if (!name || name.length < 2) {
        this._showError(screen, 'Please enter your full name.');
        return;
      }
      if (password !== confirm) {
        this._showError(screen, 'Passwords do not match.');
        return;
      }
      if (password.length < 8) {
        this._showError(screen, 'Password must be at least 8 characters.');
        return;
      }
    }

    this._setLoading(screen, true);

    try {
      let data;
      if (this.mode === 'login') {
        data = await API.auth.login({ email, password });
      } else {
        data = await API.auth.register({ name, email, password });
      }
      App.onLoginSuccess(data.user);
    } catch (err) {
      this._showError(screen, err.message || 'Something went wrong. Please try again.');
      this._setLoading(screen, false);
    }
  }
};
