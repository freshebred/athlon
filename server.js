require('dotenv').config();
const mongoose = require('mongoose');
const app      = require('./app');

const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.DB_URI)
  .then(() => {
    console.log('[DB] Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`[SERVER] Athlon running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('[DB] Connection error:', err.message);
    process.exit(1);
  });

module.exports = app;
