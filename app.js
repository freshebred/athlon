/**
 * app.js
 * Pure Express application — no DB connection, no listen().
 * Used by tests (via supertest) and by server.js for production.
 */

const express      = require('express');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const rateLimit    = require('express-rate-limit');

// ── Cache-bust token: git commit hash (falls back to timestamp) ──────────────
let DEPLOY_VERSION = 'athlon-local';
try {
  const { execSync } = require('child_process');
  DEPLOY_VERSION = 'athlon-' + execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
} catch {
  DEPLOY_VERSION = 'athlon-' + Date.now();
}

const app = express();

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

// Rate limiting — disabled during tests to avoid flakiness
if (process.env.NODE_ENV !== 'test') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use('/api/', limiter);

  const aiLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
  app.use('/api/ai/', aiLimiter);
  app.use('/api/meals/', aiLimiter);
}

// ── Static Files ─────────────────────────────────────────────────────────────
// Serve sw.js with no-cache so browsers always refetch it,
// and inject the deploy version so the SW busts its own cache on every deploy.
const SW_SOURCE = path.join(__dirname, 'public', 'sw.js');
app.get('/sw.js', (req, res) => {
  try {
    let sw = fs.readFileSync(SW_SOURCE, 'utf8');
    // Replace the hardcoded cache name with the deploy-stamped one
    sw = sw.replace(/const CACHE_NAME = '[^']*'/, `const CACHE_NAME = '${DEPLOY_VERSION}'`);
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(sw);
  } catch (err) {
    console.error('[SW] Failed to serve sw.js:', err.message);
    res.status(500).send('// Service worker unavailable');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ─────────────────────────────────────────────────────────────
// Build version — always available, no auth required
app.get('/api/version', (req, res) => {
  const pkg = (() => { try { return require('./package.json'); } catch { return {}; } })();
  res.json({
    version:    DEPLOY_VERSION,
    hash:       DEPLOY_VERSION.replace('athlon-', ''),
    appVersion: pkg.version || '1.0.0',
    deployedAt: new Date().toISOString()
  });
});

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/user',          require('./routes/user'));
app.use('/api/onboarding',    require('./routes/onboarding'));
app.use('/api/meals',         require('./routes/meals'));
app.use('/api/workouts',      require('./routes/workouts'));
app.use('/api/balance',       require('./routes/balance'));
app.use('/api/pt-coach',      require('./routes/ptCoach'));
app.use('/api/notifications', require('./routes/notifications'));

// ── Catch-all: serve SPA ─────────────────────────────────────────────────────
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

module.exports = app;
