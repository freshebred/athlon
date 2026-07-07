/**
 * app.js
 * Pure Express application — no DB connection, no listen().
 * Used by tests (via supertest) and by server.js for production.
 */

const express      = require('express');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const path         = require('path');
const rateLimit    = require('express-rate-limit');

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
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ───────────────────────────────────────────────────────────────
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
