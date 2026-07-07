#!/usr/bin/env node
/**
 * Lightweight Cron Trigger Script
 * 
 * Just sends a request to the running Node server to do the actual cron work,
 * ensuring all environment variables, DB connections, and modules are already loaded.
 */
async function trigger() {
  try {
    // Determine port from .env if possible, otherwise default to 3000
    const fs = require('fs');
    const path = require('path');
    let port = 3000;
    try {
      const envPath = path.join(__dirname, '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const portMatch = envContent.match(/^PORT=(\d+)/m);
        if (portMatch) port = parseInt(portMatch[1], 10);
      }
    } catch (e) {}

    const res = await fetch(`http://localhost:${port}/api/notifications/cron`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'athlete' })
    });
    
    if (!res.ok) {
      throw new Error(`Server responded with ${res.status}: ${await res.text()}`);
    }
    
    const data = await res.json();
    console.log('[CRON]', data);
  } catch (err) {
    console.error('[CRON] Failed to trigger:', err.message);
  }
}
trigger();
