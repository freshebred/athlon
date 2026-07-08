/* auth.js — Athlon Auth Page */

const AuthPage = {
  mode: 'login', // 'login' | 'register' | 'verify' | 'forgot' | 'reset'
  pendingUserId: null,

  init() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('reset_token') && this.mode !== 'reset') {
      this.mode = 'reset';
    }

    const screen = document.getElementById('auth-screen');
    screen.innerHTML = this._render();
    this._bindEvents(screen);
    if (window.lucide) lucide.createIcons({ nodes: [screen] });
  },

  _render() {
    let title = 'Sign In';
    let subtitle = 'Your AI-powered calorie bank';
    if (this.mode === 'register') title = 'Create Account';
    if (this.mode === 'verify') { title = 'Verify Email'; subtitle = 'Enter the 6-digit code sent to your email'; }
    if (this.mode === 'forgot') { title = 'Forgot Password'; subtitle = 'We will send you a reset link'; }
    if (this.mode === 'reset') { title = 'Reset Password'; subtitle = 'Enter your new password'; }

    return `
      <div class="auth-page">
        <div class="auth-logo" style="display: flex; flex-direction: column; align-items: center;">
          <img src="/icons/icon.svg" alt="Athlon Logo" style="width: 48px; height: 48px; margin-bottom: 12px; border-radius: 12px;">
          <div><span style="color:var(--accent)">A</span>THLON</div>
        </div>
        <p class="auth-tagline">${subtitle}</p>

        <div class="auth-card">
          ${(this.mode === 'login' || this.mode === 'register') ? `
          <div class="auth-tabs">
            <div class="auth-tab ${this.mode === 'login' ? 'active' : ''}" data-mode="login">Sign In</div>
            <div class="auth-tab ${this.mode === 'register' ? 'active' : ''}" data-mode="register">Create Account</div>
          </div>` : ''}

          <div class="auth-error" id="auth-error"></div>

          <form class="auth-form" id="auth-form" novalidate>
            ${this.mode === 'register' ? `
            <div class="form-group">
              <label class="form-label" for="auth-name">Full Name</label>
              <input class="form-input" type="text" id="auth-name" name="name"
                     placeholder="Jordan Smith" autocomplete="name" required>
            </div>` : ''}

            ${(this.mode === 'login' || this.mode === 'register' || this.mode === 'forgot') ? `
            <div class="form-group">
              <label class="form-label" for="auth-email">Email Address</label>
              <input class="form-input" type="email" id="auth-email" name="email"
                     placeholder="you@example.com" autocomplete="email" required>
            </div>` : ''}

            ${(this.mode === 'verify') ? `
            <div class="form-group">
              <label class="form-label" for="auth-code">6-Digit Code</label>
              <input class="form-input" type="text" id="auth-code" name="code"
                     placeholder="123456" required autocomplete="off" style="text-align:center; font-size: 1.5rem; letter-spacing: 4px;">
            </div>` : ''}

            ${(this.mode === 'login' || this.mode === 'register' || this.mode === 'reset') ? `
            <div class="form-group">
              <label class="form-label" for="auth-password">${this.mode === 'reset' ? 'New Password' : 'Password'}</label>
              <div class="password-input-wrap">
                <input class="form-input" type="password" id="auth-password" name="password"
                       placeholder="${(this.mode === 'register' || this.mode === 'reset') ? 'Min 6 characters' : 'Your password'}"
                       autocomplete="${this.mode === 'login' ? 'current-password' : 'new-password'}" required>
                <span class="password-toggle" id="pw-toggle" aria-label="Toggle password visibility">
                  <i data-lucide="eye" class="icon-sm"></i>
                </span>
              </div>
            </div>` : ''}

            ${(this.mode === 'register' || this.mode === 'reset') ? `
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
              <span id="auth-btn-text">
                ${this.mode === 'login' ? 'Sign In' : 
                  this.mode === 'register' ? 'Create Account' : 
                  this.mode === 'verify' ? 'Verify' : 
                  this.mode === 'forgot' ? 'Send Reset Link' : 'Reset Password'}
              </span>
              <div class="spinner" id="auth-spinner" style="display:none; border-top-color:#0A0F1E; border-color:rgba(10,15,30,0.3);"></div>
            </button>
          </form>

          ${this.mode === 'login' ? `
          <div class="auth-divider">or</div>
          <p style="text-align:center; font-size:0.8125rem; color:var(--text-2);">
            <a href="#" id="switch-to-forgot" style="color:var(--accent); font-weight:600;">Forgot Password?</a>
          </p>
          <p style="text-align:center; font-size:0.8125rem; color:var(--text-2); margin-top:12px;">
            Don't have an account?
            <a href="#" id="switch-to-register" style="color:var(--accent); font-weight:600;">Sign up free</a>
          </p>` : ''}
          
          ${this.mode === 'register' ? `
          <div class="auth-divider">or continue with</div>
          <p style="text-align:center; font-size:0.8125rem; color:var(--text-2); margin-top:16px;">
            Already have an account?
            <a href="#" id="switch-to-login" style="color:var(--accent); font-weight:600;">Sign in</a>
          </p>` : ''}

          ${(this.mode === 'verify' || this.mode === 'forgot' || this.mode === 'reset') ? `
          <p style="text-align:center; font-size:0.8125rem; color:var(--text-2); margin-top:16px;">
            <a href="#" id="switch-to-login" style="color:var(--accent); font-weight:600;">Back to Sign In</a>
          </p>` : ''}
        </div>

        <p style="margin-top:24px; font-size:0.75rem; color:var(--text-3); text-align:center; max-width:300px;">
          By continuing, you agree to Athlon's <a href="/tos.html" style="color:var(--accent); text-decoration:underline;">Terms of Service</a> and <a href="/privacy.html" style="color:var(--accent); text-decoration:underline;">Privacy Policy</a>.
        </p>
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
    const switchForgot = screen.querySelector('#switch-to-forgot');
    if (switchForgot) switchForgot.addEventListener('click', e => { e.preventDefault(); this.mode = 'forgot'; this.init(); });

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
    if (btn) btn.disabled = loading;
    if (btnText) btnText.style.display = loading ? 'none' : '';
    if (spinner) spinner.style.display = loading ? 'block' : 'none';
  },

  async _handleSubmit(screen) {
    this._hideError(screen);

    const email    = screen.querySelector('#auth-email')?.value.trim();
    const password = screen.querySelector('#auth-password')?.value;
    const name     = screen.querySelector('#auth-name')?.value.trim();
    const confirm  = screen.querySelector('#auth-confirm')?.value;
    const code     = screen.querySelector('#auth-code')?.value.trim();

    // Validation
    if ((this.mode === 'login' || this.mode === 'register' || this.mode === 'forgot') && (!email || !email.includes('@'))) {
      this._showError(screen, 'Please enter a valid email address.');
      return;
    }
    if ((this.mode === 'login' || this.mode === 'register' || this.mode === 'reset') && (!password || password.length < 6)) {
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
    }
    if (this.mode === 'reset') {
      if (password !== confirm) {
        this._showError(screen, 'Passwords do not match.');
        return;
      }
    }
    if (this.mode === 'verify' && (!code || code.length < 6)) {
      this._showError(screen, 'Please enter the 6-digit code.');
      return;
    }

    this._setLoading(screen, true);

    try {
      let data;
      if (this.mode === 'login') {
        // Since api.js throws on 403, we need to catch it differently if we want the userId.
        // For now, we will handle it in the catch block if it says "verify".
        data = await API.auth.login({ email, password });
        App.onLoginSuccess(data.user);
      } else if (this.mode === 'register') {
        data = await API.auth.register({ name, email, password });
        this.pendingUserId = data.userId;
        this.mode = 'verify';
        this.init();
        showToast('Verification email sent! Check your inbox.');
      } else if (this.mode === 'verify') {
        data = await API.post('/auth/verify', { userId: this.pendingUserId, code, action: 'signup' });
        App.onLoginSuccess(data.user);
      } else if (this.mode === 'forgot') {
        data = await API.post('/auth/forgot-password', { email });
        showToast(data.message);
        this.mode = 'login';
        this.init();
      } else if (this.mode === 'reset') {
        const token = new URLSearchParams(window.location.search).get('reset_token');
        data = await API.post('/auth/verify', { token, action: 'password_reset', newPassword: password });
        showToast('Password reset successfully!');
        window.history.replaceState({}, document.title, "/");
        this.mode = 'login';
        this.init();
      }
    } catch (err) {
      this._showError(screen, err.message || 'Something went wrong. Please try again.');
      this._setLoading(screen, false);
    }
  }
};
