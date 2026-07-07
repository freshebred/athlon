#!/usr/bin/env node
/**
 * Lightweight Cron Trigger Script
 * 
 * Just sends a request to the running Node server to do the actual cron work,
 * ensuring all environment variables, DB connections, and modules are already loaded.
 */
async function trigger() {
  try {
    const targetUrl = process.argv[2] || process.env.APP_URL || 'https://athlon.hgphnm.com';
    
    if (targetUrl.includes('YOUR_DOMAIN')) {
      console.error('\n❌ Error: No domain specified.');
      console.error('Because cPanel Passenger does not use local ports, you must provide your public URL.');
      console.error('Usage: node cron-notify.js https://your-actual-domain.com\n');
      process.exit(1);
    }

    const res = await fetch(`${targetUrl.replace(/\/$/, '')}/api/notifications/cron`, {
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
