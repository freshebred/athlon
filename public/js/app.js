/* app.js — Athlon SPA Router */

const App = {
  currentTab: 'home',
  currentUser: null,

  async init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('SW registration failed:', err);
      });
    }

    // Initialize icons
    if (window.lucide) lucide.createIcons();

    // Simulate loading bar completing
    await new Promise(r => setTimeout(r, 1400));

    // Check auth state
    await this.checkAuth();
  },

  async checkAuth() {
    try {
      const { user, balance } = await API.auth.me();
      this.currentUser = user;
      if (!user.onboardingComplete) {
        this.showOnboarding();
      } else {
        this.showMainApp(balance);
      }
    } catch {
      this.showAuth();
    }
  },

  showAuth() {
    this.hideLoadingScreen();
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('onboarding-screen').classList.add('hidden');
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('pt-coach-fab').classList.add('hidden');
    AuthPage.init();
  },

  showOnboarding() {
    this.hideLoadingScreen();
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('onboarding-screen').classList.remove('hidden');
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('pt-coach-fab').classList.add('hidden');
    OnboardingPage.init();
  },

  showMainApp() {
    this.hideLoadingScreen();
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('onboarding-screen').classList.add('hidden');

    const mainApp = document.getElementById('main-app');
    mainApp.classList.remove('hidden');
    document.getElementById('pt-coach-fab').classList.remove('hidden');

    // Apply saved theme
    if (this.currentUser?.theme) {
      document.documentElement.setAttribute('data-theme', this.currentUser.theme);
      this._updateThemeIcon(this.currentUser.theme);
    }

    this.setupNav();
    this.setupHeader();
    PTCoach.init();
    this.navigateTo('home');
    if (window.lucide) lucide.createIcons();
  },

  setupNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.navigateTo(btn.dataset.tab));
    });
  },

  setupHeader() {
    document.getElementById('theme-toggle').addEventListener('click', async () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next    = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      this._updateThemeIcon(next);
      try { await API.user.updateTheme(next); } catch {}
    });

    document.getElementById('notif-btn').addEventListener('click', () => {
      this.navigateTo('profile');
    });
  },

  _updateThemeIcon(theme) {
    const btn  = document.getElementById('theme-toggle');
    const icon = btn?.querySelector('i');
    if (icon) {
      icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
      if (window.lucide) lucide.createIcons({ nodes: [btn] });
    }
  },

  navigateTo(tab) {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    this.currentTab = tab;

    const content = document.getElementById('tab-content');
    content.style.opacity   = '0';
    content.style.transform = 'translateY(10px)';

    setTimeout(() => {
      content.innerHTML = '';
      switch (tab) {
        case 'home':    HomePage.render();    break;
        case 'log':     LogPage.render();     break;
        case 'earn':    EarnPage.render();    break;
        case 'history': HistoryPage.render(); break;
        case 'profile': ProfilePage.render(); break;
      }
      if (window.lucide) lucide.createIcons();
      requestAnimationFrame(() => {
        content.style.transition = 'opacity 200ms ease, transform 200ms ease';
        content.style.opacity   = '1';
        content.style.transform = 'translateY(0)';
      });
    }, 150);
  },

  hideLoadingScreen() {
    const s = document.getElementById('loading-screen');
    s.style.opacity = '0';
    setTimeout(() => s.classList.add('hidden'), 400);
  },

  onLoginSuccess(user) {
    this.currentUser = user;
    if (!user.onboardingComplete) this.showOnboarding();
    else this.showMainApp();
  },

  onOnboardingComplete(user) {
    this.currentUser = user;
    this.showMainApp();
  },

  refreshCurrentTab() {
    this.navigateTo(this.currentTab);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
