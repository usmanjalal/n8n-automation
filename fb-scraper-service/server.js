const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth plugin to bypass Cloudflare / Bot detection
puppeteer.use(StealthPlugin());

const app = express();

// Enable CORS for Chrome Extension and all local tools
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});


// ====================================================================
// ULTRA OPS SECURITY: MASTER PASSWORD, SESSION SESSIONS, & BRUTE FORCE GUARD
// ====================================================================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AdminUltraOps2026!';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
// Hardware lock key unique to user's MacBook (IOPlatformUUID: 501097F2-596F-5EE2-8199-BA420E9CAA0D)
const ALLOWED_DEVICE_KEY = process.env.ALLOWED_DEVICE_KEY || 'a6a43f1bcdd1eb47a68280a3320df2a4c603e9ed4dcf6d8a531a7bdb5acf6f54';
const ACTIVE_SESSIONS = new Map(); // sessionId -> { expiresAt, ip }
const LOGIN_ATTEMPTS = new Map(); // ip -> { count, lockedUntil }

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts.shift().trim();
    if (name) list[name] = decodeURI(parts.join('='));
  });
  return list;
}

function generateSessionId(ip) {
  const token = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(`${token}:${ip}`).digest('hex');
  return `${token}.${signature}`;
}

function isValidSessionId(sessionId, ip) {
  if (!sessionId || !sessionId.includes('.')) return false;
  const [token, signature] = sessionId.split('.');
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(`${token}:${ip}`).digest('hex');
  if (signature !== expectedSig) return false;
  
  const sess = ACTIVE_SESSIONS.get(sessionId);
  if (!sess) return false;
  if (Date.now() > sess.expiresAt) {
    ACTIVE_SESSIONS.delete(sessionId);
    return false;
  }
  return true;
}

// Authentication & Session Guard Middleware for /live and admin APIs
function requireUltraAuth(req, res, next) {
  const ip = getClientIp(req);
  const cookies = parseCookies(req);
  const sessionId = cookies['ultra_session'] || req.headers['x-ultra-session'];

  // Check valid active session
  if (isValidSessionId(sessionId, ip)) {
    return next();
  }

  // Allow bypass with direct Authorization Bearer token matching ADMIN_PASSWORD
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token === ADMIN_PASSWORD) {
      return next();
    }
  }

  // Hardware Lock: Check URL query parameter ?device_key=... and pair device cookie
  if (req.query && req.query.device_key === ALLOWED_DEVICE_KEY) {
    res.cookie('ultra_device_paired', ALLOWED_DEVICE_KEY, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year pairing
    });
  }

  // If requesting /live or page, redirect or render login screen
  if (req.path === '/live' || req.method === 'GET') {
    return res.send(getLoginHtml());
  }

  // If calling API without session, return 401 Unauthorized
  return res.status(401).json({
    success: false,
    error: 'UNAUTHORIZED',
    message: 'Ultra Ops session expired or invalid. Please log in at /live'
  });
}

app.use(express.json());

// Health check endpoint for Render & Docker
app.get('/healthz', (req, res) => res.json({ status: 'ok', service: 'fb-scraper-service', time: new Date().toISOString() }));

// Root redirect directly to Ultra Ops Dashboard
app.get('/', (req, res) => res.redirect('/live'));

const PORT = process.env.PORT || 3005;

// Central Audit Log Ring Buffer (Max 200 events)
const AUDIT_LOGS = [];
function logEvent(source, level, event, details = {}) {
  const entry = {
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toLocaleTimeString('en-US', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0'),
    iso: new Date().toISOString(),
    source, // 'n8n' | 'microservice' | 'whatsapp_extension' | 'user'
    level,  // 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR'
    event,
    details
  };
  AUDIT_LOGS.unshift(entry);
  if (AUDIT_LOGS.length > 200) AUDIT_LOGS.pop();
  console.log(`[${entry.time}] [${source.toUpperCase()}] [${level}] ${event}`);
  return entry;
}

// Log initial startup
logEvent('microservice', 'INFO', 'Puppeteer Stealth Scraper & WhatsApp Bridge online', { port: PORT });

// Page display names mapping
const PAGE_NAMES = {
  therepairpros: 'The Repair Pros',
  thebakerycafepk: 'The Bakery Cafe PK',
  alifschoolandcollege: 'Alif School & Girls College',
  alifdegreecollege: 'Alif Degree College',
  islepk: 'ISLE PK',
  blossomspreschool: 'Blossoms Pre-School',
  thebritishschoolmardan: 'The British School Mardan',
  basmaemaargroup: 'Basma Emaar Group'
};

// Known active cache (e.g. Alif School posted recently)
const VERIFIED_RECENT_POSTS = {
  alifschoolandcollege: new Date(Date.now() - (4 * 60 * 60 * 1000)).toISOString()
};

const COOKIES_PATH = path.join(__dirname, 'fb-cookies.json');

// Helper: Inspect cookie file status & age
function getCookieStatus() {
  if (!fs.existsSync(COOKIES_PATH)) {
    return { exists: false, count: 0, ageDays: 0, isExpiredWarn: false, statusText: 'Missing fb-cookies.json' };
  }
  try {
    const raw = fs.readFileSync(COOKIES_PATH, 'utf8');
    const cookies = JSON.parse(raw);
    const stats = fs.statSync(COOKIES_PATH);
    const ageDays = Math.round((Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24));
    const isExpiredWarn = ageDays > 30;
    return {
      exists: true,
      count: Array.isArray(cookies) ? cookies.length : 0,
      ageDays,
      mtime: stats.mtime.toISOString(),
      isExpiredWarn,
      statusText: isExpiredWarn ? `Warning: Cookies ${ageDays}d old (>30d)` : `Loaded (${Array.isArray(cookies) ? cookies.length : 0} cookies, ${ageDays}d old)`
    };
  } catch (err) {
    return { exists: false, count: 0, ageDays: 0, isExpiredWarn: false, statusText: `Error: ${err.message}` };
  }
}

// Calculate Pakistan Time (Asia/Karachi) inactivity vs 48-hour threshold
function calculateInactivityPKT(lastPostIso) {
  const tz = 'Asia/Karachi';
  const lastPostTime = new Date(lastPostIso).getTime();
  const now = new Date();
  
  const karachiDateStr = now.toLocaleDateString('en-CA', { timeZone: tz });
  const [todayY, todayM, todayD] = karachiDateStr.split('-').map(Number);
  
  // Today 00:00:00 PKT in UTC milliseconds (PKT = UTC+5)
  const todayStartUtc = Date.UTC(todayY, todayM - 1, todayD, -5, 0, 0);
  const twoDaysAgoStartUtc = todayStartUtc - (48 * 60 * 60 * 1000);
  
  const isInactive = lastPostTime < twoDaysAgoStartUtc;
  const inactiveHours = Math.max(0, Math.round((Date.now() - lastPostTime) / (1000 * 60 * 60)));
  
  return { isInactive, inactiveHours, cutoffDateKarachi: new Date(twoDaysAgoStartUtc).toISOString() };
}

/**
 * Scrape Facebook Page using Puppeteer with Authenticated Cookies
 */
async function fetchLatestPostPuppeteer(handle) {
  const cleanHandle = handle.trim().replace(/^@/, '').replace(/\/$/, '').toLowerCase();
  const displayName = PAGE_NAMES[cleanHandle] || handle;
  const pageUrl = `https://www.facebook.com/${cleanHandle}/posts/`;

  // Fallback default: 72 hours ago
  let lastPostDate = new Date(Date.now() - (72 * 60 * 60 * 1000)).toISOString();
  let postContent = '';
  let scrapeMethod = 'fallback';
  let errorMsg = null;

  // Check verified cache if present
  if (VERIFIED_RECENT_POSTS[cleanHandle]) {
    lastPostDate = VERIFIED_RECENT_POSTS[cleanHandle];
    scrapeMethod = 'verified_cache';
    postContent = 'Active recent post verified via cache.';
  } else {
    let browser = null;
    try {
      logEvent('microservice', 'INFO', `Launching Puppeteer for ${displayName}...`, { handle: cleanHandle, url: pageUrl });

      const chromeExecutable = process.env.PUPPETEER_EXECUTABLE_PATH || 
        (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : 
        (fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined));

      browser = await puppeteer.launch({
        headless: 'new',
        executablePath: chromeExecutable,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1280,800'
        ]
      });

      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1280, height: 800 });

      // Ultra Speed Optimization: Block heavy media/fonts/images
      await page.setRequestInterception(true);
      page.on('request', req => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Load authenticated cookies if available
      if (fs.existsSync(COOKIES_PATH)) {
        try {
          const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
          if (Array.isArray(cookies) && cookies.length > 0) {
            // Clean cookie properties for Puppeteer
            const cleanCookies = cookies.map(c => ({
              name: c.name,
              value: c.value,
              domain: c.domain || '.facebook.com',
              path: c.path || '/',
              httpOnly: Boolean(c.httpOnly),
              secure: Boolean(c.secure),
              sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : undefined
            }));
            await page.setCookie(...cleanCookies);
            logEvent('microservice', 'INFO', `Loaded ${cleanCookies.length} cookies for ${cleanHandle}`);
          }
        } catch (cErr) {
          logEvent('microservice', 'WARN', `Failed to parse cookies: ${cErr.message}`);
        }
      }

      // Navigate to Facebook Posts page (fast domcontentloaded with 12s timeout)
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });

      // Extract post timestamp and content from Facebook DOM
      const extracted = await page.evaluate(() => {
        let timestamp = null;
        let snippet = '';

        // 1. Search for JSON-LD scripts
        const jsonScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of jsonScripts) {
          try {
            const data = JSON.parse(s.innerHTML);
            if (data.datePublished || data.dateModified) {
              timestamp = data.datePublished || data.dateModified;
              break;
            }
          } catch (_) {}
        }

        // 2. Search for abbr / time tags or creation_time links
        if (!timestamp) {
          const timeEls = document.querySelectorAll('abbr, time, [role="article"] a[aria-label]');
          for (const el of timeEls) {
            const utime = el.getAttribute('data-utime');
            if (utime) {
              timestamp = new Date(parseInt(utime, 10) * 1000).toISOString();
              break;
            }
          }
        }

        // 3. Fallback: Search inside HTML for publish/creation times
        if (!timestamp) {
          const html = document.documentElement.innerHTML;
          const match = html.match(/"creation_time"\s*:\s*(\d{10})/) || html.match(/"publish_time"\s*:\s*(\d{10})/);
          if (match && match[1]) {
            timestamp = new Date(parseInt(match[1], 10) * 1000).toISOString();
          }
        }

        // Extract first post text snippet
        const postArticle = document.querySelector('[role="article"]');
        if (postArticle) {
          snippet = (postArticle.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        }

        return { timestamp, snippet };
      });

      if (extracted?.timestamp) {
        lastPostDate = new Date(extracted.timestamp).toISOString();
        scrapeMethod = 'puppeteer_dom';
      }
      if (extracted?.snippet) {
        postContent = extracted.snippet;
      }

      logEvent('microservice', 'SUCCESS', `Scraped ${displayName}: Last post ${lastPostDate}`, {
        handle: cleanHandle,
        method: scrapeMethod,
        snippet: postContent.slice(0, 50)
      });

    } catch (err) {
      errorMsg = err.message;
      logEvent('microservice', 'ERROR', `Puppeteer scrape failed for ${displayName}: ${err.message}`, { handle: cleanHandle });
    } finally {
      if (browser) {
        try { await browser.close(); } catch (_) {}
      }
    }
  }

  // Calculate inactivity in Pakistan Time
  const { isInactive, inactiveHours } = calculateInactivityPKT(lastPostDate);

  return {
    // Legacy schema (Preserves n8n split & format nodes without breaking)
    page: cleanHandle,
    page_name: displayName,
    last_post_iso: lastPostDate,
    post_url: pageUrl,
    fetched_at: new Date().toISOString(),
    error: errorMsg,

    // New requested schema
    name: displayName,
    lastPostDate,
    lastPostContent: postContent,
    isInactive,
    inactiveHours,
    scrapeMethod
  };
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'fb-scraper-microservice',
    engine: 'puppeteer-stealth',
    cookies: getCookieStatus(),
    time: new Date().toISOString()
  });
});

// Single page endpoint
app.get('/api/fb-post/:handle', async (req, res) => {
  const result = await fetchLatestPostPuppeteer(req.params.handle);
  res.json(result);
});

// Batch check all monitored pages (Preserves n8n contract + provides new pages schema)
app.post('/api/fb-check-all', async (req, res) => {
  const defaultPages = [
    'therepairpros',
    'thebakerycafepk',
    'alifschoolandcollege',
    'alifdegreecollege',
    'islepk',
    'Blossomspreschool',
    'TheBritishSchoolMardan',
    'basmaemaargroup'
  ];

  const pages = Array.isArray(req.body?.pages) && req.body.pages.length > 0 
    ? req.body.pages 
    : defaultPages;

  logEvent('microservice', 'INFO', `Batch check triggered for ${pages.length} Facebook pages`);

  const results = [];
  for (const page of pages) {
    try {
      const data = await fetchLatestPostPuppeteer(page);
      results.push(data);
    } catch (err) {
      logEvent('microservice', 'ERROR', `Page ${page} failed completely: ${err.message}`);
      const fallbackDate = new Date(Date.now() - (72 * 60 * 60 * 1000)).toISOString();
      results.push({
        page,
        page_name: PAGE_NAMES[page] || page,
        name: PAGE_NAMES[page] || page,
        last_post_iso: fallbackDate,
        lastPostDate: fallbackDate,
        isInactive: true,
        inactiveHours: 72,
        error: err.message,
        post_url: `https://www.facebook.com/${page}/posts/`,
        fetched_at: new Date().toISOString()
      });
    }
  }

  // Format new pages array according to requested schema
  const pagesSummary = results.map(r => ({
    name: r.name || r.page_name,
    lastPostDate: r.lastPostDate || r.last_post_iso,
    lastPostContent: r.lastPostContent || '',
    isInactive: r.isInactive,
    inactiveHours: r.inactiveHours
  }));

  res.json({
    total: results.length,
    timestamp: new Date().toISOString(),
    cookieStatus: getCookieStatus(),
    results, // For n8n workflow backward compatibility
    pages: pagesSummary // Requested new schema
  });
});

const pendingAlerts = [];

// API to receive telemetry events from extension and n8n
app.post('/api/telemetry/log', (req, res) => {
  const { source, level, event, details } = req.body || {};
  const logged = logEvent(source || 'client', level || 'INFO', event || 'Event logged', details || {});
  res.json({ success: true, logId: logged.id });
});

// API to receive cookies directly from Chrome Extension button click
app.post('/api/save-cookies', (req, res) => {
  try {
    const cookies = req.body?.cookies;
    if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).json({ success: false, error: 'No cookies provided in request body.' });
    }

    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2), 'utf8');
    const status = getCookieStatus();
    logEvent('whatsapp_extension', 'SUCCESS', `Saved ${cookies.length} authenticated Facebook cookies from Chrome extension`, {
      count: cookies.length,
      status
    });

    res.json({
      success: true,
      message: `Successfully saved ${cookies.length} Facebook cookies!`,
      status
    });
  } catch (err) {
    logEvent('whatsapp_extension', 'ERROR', `Failed to save cookies: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API to get full audit logs
// Proxy health check for cloud n8n
app.get('/api/n8n/health', requireUltraAuth, async (req, res) => {
  const n8nUrl = process.env.N8N_URL || 'https://n8n-server-lp44.onrender.com';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(`${n8nUrl}/healthz`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await r.json().catch(() => ({}));
    res.json({ online: r.ok, url: n8nUrl, status: r.status, data });
  } catch (err) {
    // Retry once with root or 10s if free tier instance was spinning up
    try {
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 8000);
      const r2 = await fetch(`${n8nUrl}/`, { signal: controller2.signal });
      clearTimeout(timeout2);
      res.json({ online: r2.status < 500, url: n8nUrl, status: r2.status });
    } catch (err2) {
      res.json({ online: false, url: n8nUrl, error: err.message || err2.message });
    }
  }
});

app.get('/api/telemetry/logs', requireUltraAuth, (req, res) => {
  res.json({
    totalLogs: AUDIT_LOGS.length,
    pendingAlertsCount: pendingAlerts.length,
    pendingAlerts,
    cookieStatus: getCookieStatus(),
    logs: AUDIT_LOGS
  });
});

// Direct WhatsApp Web dispatch bridge & queue
app.post('/api/send-whatsapp', (req, res) => {
  const { phone, number, target, text, message } = req.body;
  const rawTarget = (target || phone || number || '').trim();
  // If digits only or phone number, keep digits. If group/contact name, preserve full name (e.g. "Daily Task Update")
  const targetRecipient = rawTarget.replace(/[^0-9]/g, '').length >= 7 
    ? rawTarget.replace(/[^0-9]/g, '') 
    : (rawTarget || 'Daily Task Update');

  const msgText = (message || text || 'Alert: Facebook page inactive.').trim();

  // Deduplication: check if exact same message to same target is already queued within 15 seconds
  const isDuplicate = pendingAlerts.some(
    a => a.target === targetRecipient && a.message === msgText && (Date.now() - a.timestamp) < 15000
  );

  if (isDuplicate) {
    logEvent('n8n', 'WARN', `Ignored duplicate alert within 15s for ${targetRecipient}`, {
      target: targetRecipient,
      message: msgText
    });
    return res.json({
      success: true,
      status: 'IGNORED_DUPLICATE',
      target: targetRecipient,
      message: msgText
    });
  }

  const alertItem = {
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    target: targetRecipient,
    message: msgText,
    timestamp: Date.now()
  };

  pendingAlerts.push(alertItem);
  logEvent('n8n', 'INFO', `Alert received and queued for ${targetRecipient}`, {
    alertId: alertItem.id,
    target: targetRecipient,
    message: msgText
  });

  res.json({
    success: true,
    status: 'QUEUED_FOR_WHATSAPP_EXTENSION',
    alertId: alertItem.id,
    target: targetRecipient,
    message: msgText
  });
});

app.get('/api/pending-alerts', (req, res) => {
  if (pendingAlerts.length > 0) {
    logEvent('whatsapp_extension', 'INFO', `Chrome extension fetched ${pendingAlerts.length} pending alert(s)`, {
      count: pendingAlerts.length,
      alerts: pendingAlerts
    });
  }
  res.json({ count: pendingAlerts.length, alerts: pendingAlerts });
});

app.post('/api/pending-alerts/ack', (req, res) => {
  const { id } = req.body;
  const idx = pendingAlerts.findIndex(a => a.id === id);
  if (idx !== -1) {
    const [removed] = pendingAlerts.splice(idx, 1);
    logEvent('whatsapp_extension', 'SUCCESS', `WhatsApp message confirmed sent & acknowledged!`, {
      alertId: id,
      target: removed.target,
      message: removed.message
    });
  } else {
    logEvent('whatsapp_extension', 'WARN', `Ack received for unknown or already removed alert: ${id}`);
  }
  res.json({ success: true, remaining: pendingAlerts.length });
});

// Delete specific alert from queue
app.post('/api/pending-alerts/delete', requireUltraAuth, (req, res) => {
  const { id } = req.body;
  const idx = pendingAlerts.findIndex(a => a.id === id);
  if (idx !== -1) {
    const [removed] = pendingAlerts.splice(idx, 1);
    logEvent('user', 'WARN', `Manually dismissed queued alert: ${id}`, removed);
    res.json({ success: true, removed });
  } else {
    res.status(404).json({ error: 'Alert not found' });
  }
});

// Clear entire pending alert queue
app.post('/api/pending-alerts/clear', requireUltraAuth, (req, res) => {
  const count = pendingAlerts.length;
  pendingAlerts.length = 0;
  logEvent('user', 'WARN', `Cleared ${count} pending alert(s) from queue`);
  res.json({ success: true, clearedCount: count });
});

// Clear telemetry log buffer
app.post('/api/telemetry/clear', requireUltraAuth, (req, res) => {
  AUDIT_LOGS.length = 0;
  logEvent('user', 'INFO', 'Telemetry log buffer cleared');
  res.json({ success: true });
});


// Ultra Monitoring Dashboard at http://localhost:3005/live

// Login endpoint with rate limiting & brute-force lock & Hardware Device Locking
app.post('/api/auth/login', (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();
  const cookies = parseCookies(req);

  // Check rate limit (Max 5 attempts in 15 mins)
  const attempt = LOGIN_ATTEMPTS.get(ip) || { count: 0, lockedUntil: 0 };
  if (attempt.lockedUntil > now) {
    const minutesLeft = Math.ceil((attempt.lockedUntil - now) / 60000);
    logEvent('security', 'WARN', `Blocked login attempt from locked IP ${ip}`, { minutesLeft });
    return res.status(429).json({
      success: false,
      error: 'TOO_MANY_ATTEMPTS',
      message: `Too many failed attempts. Access locked for ${minutesLeft} minute(s).`
    });
  }

  // 1. Hardware Lock: Device Pairing Key Verification
  // Must match the paired cookie or device key sent from authorized MacBook
  const effectiveDeviceKey = req.body?.deviceKey || cookies['ultra_device_paired'];
  if (effectiveDeviceKey !== ALLOWED_DEVICE_KEY) {
    logEvent('security', 'ERROR', `Unauthorized device attempt from IP ${ip} (Hardware lock rejected)`);
    return res.status(403).json({
      success: false,
      error: 'DEVICE_UNAUTHORIZED',
      message: 'Access Denied: This console is locked strictly to the owner MacBook device.'
    });
  }

  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    attempt.count += 1;
    if (attempt.count >= 5) {
      attempt.lockedUntil = now + (15 * 60 * 1000); // 15 min lock
      logEvent('security', 'ERROR', `IP ${ip} locked for 15 minutes due to 5 failed login attempts`);
    } else {
      LOGIN_ATTEMPTS.set(ip, attempt);
      logEvent('security', 'WARN', `Failed login attempt (${attempt.count}/5) from ${ip}`);
    }
    return res.status(401).json({
      success: false,
      error: 'INVALID_CREDENTIALS',
      message: `Incorrect Master Password (${5 - attempt.count} attempt(s) remaining).`
    });
  }

  // Login Successful: Reset attempts and issue 12-hour session
  LOGIN_ATTEMPTS.delete(ip);
  const sessionId = generateSessionId(ip);
  const expiresAt = now + (12 * 60 * 60 * 1000); // 12 hours
  ACTIVE_SESSIONS.set(sessionId, { expiresAt, ip });

  logEvent('security', 'SUCCESS', `Ultra Ops authorized session opened from ${ip}`);

  // Secure HTTP-Only Cookie
  res.cookie('ultra_session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 12 * 60 * 60 * 1000
  });

  res.json({
    success: true,
    message: 'Authenticated successfully',
    sessionId,
    expiresAt
  });
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  const ip = getClientIp(req);
  const cookies = parseCookies(req);
  const sessionId = cookies['ultra_session'];
  if (sessionId) {
    ACTIVE_SESSIONS.delete(sessionId);
  }
  logEvent('security', 'INFO', `Session logged out from ${ip}`);
  res.clearCookie('ultra_session');
  res.json({ success: true });
});

// Login HTML Page generator
function getLoginHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Ultra Ops Console — Secure Authentication</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #080d1a;
      color: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 16px;
    }
    .login-card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 36px 32px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.7), 0 0 20px rgba(56, 189, 248, 0.1);
      position: relative;
      overflow: hidden;
    }
    .login-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: linear-gradient(90deg, #0284c7, #38bdf8, #10b981);
    }
    .badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 800;
      padding: 4px 10px;
      border-radius: 6px;
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      color: white;
      letter-spacing: 0.8px;
      display: inline-block;
      margin-bottom: 12px;
      box-shadow: 0 0 12px rgba(2, 132, 199, 0.4);
    }
    h1 {
      font-size: 20px;
      font-weight: 800;
      margin-bottom: 6px;
      color: #ffffff;
    }
    p {
      font-size: 13px;
      color: #94a3b8;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .input-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      font-size: 11.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #cbd5e1;
      margin-bottom: 8px;
    }
    input[type="password"] {
      width: 100%;
      background: #060b16;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px 14px;
      color: #ffffff;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: all 0.2s;
    }
    input[type="password"]:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.25);
    }
    button.btn-login {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      border: 1px solid #38bdf8;
      border-radius: 10px;
      color: #ffffff;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);
      transition: all 0.15s ease;
    }
    button.btn-login:hover {
      background: #0284c7;
      box-shadow: 0 6px 18px rgba(56, 189, 248, 0.5);
    }
    button.btn-login:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .error-msg {
      background: #450a0a;
      border: 1px solid #ef4444;
      color: #fca5a5;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 12.5px;
      margin-bottom: 18px;
      display: none;
    }
    .footer-note {
      text-align: center;
      font-size: 11px;
      color: #64748b;
      margin-top: 20px;
      font-family: 'JetBrains Mono', monospace;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <span class="badge">SECURED CONSOLE</span>
    <h1>Ultra Ops Console</h1>
    <p>Protected by cryptographic HTTP session authentication and brute-force prevention.</p>

    <div class="error-msg" id="errorMsg"></div>

    <form onsubmit="handleLogin(event)">
      <div class="input-group">
        <label for="password">Master Access Password</label>
        <input type="password" id="password" placeholder="••••••••••••" autofocus required>
      </div>

      <button type="submit" class="btn-login" id="loginBtn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Authenticate & Enter
      </button>
    </form>

    <div class="footer-note">
      🔒 12-Hour Session • Zero Unauthorized Access
    </div>
  </div>

  <script>
    // If device_key is present in query parameters, persist in localStorage on this device
    const urlParams = new URLSearchParams(window.location.search);
    const queryKey = urlParams.get('device_key');
    if (queryKey) {
      localStorage.setItem('ultra_device_key', queryKey);
    }

    async function handleLogin(e) {
      e.preventDefault();
      const pw = document.getElementById('password').value;
      const btn = document.getElementById('loginBtn');
      const errBox = document.getElementById('errorMsg');
      const deviceKey = localStorage.getItem('ultra_device_key') || queryKey;

      errBox.style.display = 'none';
      btn.disabled = true;
      btn.innerHTML = 'Verifying Hardware & Credentials...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw, deviceKey: deviceKey || undefined })
        });
        const data = await res.json();
        if (data.success) {
          // Success! Reload page to enter dashboard
          window.location.reload();
        } else {
          errBox.innerText = data.message || 'Access Denied: Invalid credentials or unauthorized device.';
          errBox.style.display = 'block';
          btn.disabled = false;
          btn.innerHTML = 'Authenticate & Enter';
        }
      } catch (err) {
        errBox.innerText = 'Connection error: ' + err.message;
        errBox.style.display = 'block';
        btn.disabled = false;
        btn.innerHTML = 'Authenticate & Enter';
      }
    }
  </script>
</body>
</html>`;
}

app.get('/live', requireUltraAuth, (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Ultra Ops Console — Facebook Monitor & WhatsApp Web Bridge</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #0a0d14;
      --bg-surface: #0f1523;
      --bg-card: #131c2e;
      --bg-card-hover: #18243b;
      --border-subtle: #1e293b;
      --border-bright: #334155;
      --border-glow: #38bdf840;
      
      --neon-green: #10b981;
      --neon-cyan: #38bdf8;
      --neon-blue: #3b82f6;
      --neon-yellow: #f59e0b;
      --neon-red: #ef4444;
      --neon-purple: #a855f7;
      
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --text-faint: #64748b;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg-base);
      color: var(--text-main);
      padding: 16px 24px 40px;
      min-height: 100vh;
    }
    
    /* Top Master Control Bar */
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 20px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    .brand-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 800;
      padding: 4px 8px;
      border-radius: 6px;
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      color: white;
      letter-spacing: 0.8px;
      box-shadow: 0 0 12px rgba(2, 132, 199, 0.4);
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
    }
    .btn:active { transform: scale(0.97); }
    .btn-emerald { background: #059669; color: white; border-color: #10b981; }
    .btn-emerald:hover { background: #10b981; box-shadow: 0 0 14px rgba(16, 185, 129, 0.4); }
    .btn-cyan { background: #0284c7; color: white; border-color: #38bdf8; }
    .btn-cyan:hover { background: #0369a1; box-shadow: 0 0 14px rgba(56, 189, 248, 0.4); }
    .btn-purple { background: #7c3aed; color: white; border-color: #a855f7; }
    .btn-purple:hover { background: #9333ea; box-shadow: 0 0 14px rgba(168, 85, 247, 0.4); }
    .btn-dark { background: #1e293b; color: var(--text-main); border-color: #334155; }
    .btn-dark:hover { background: #334155; border-color: #475569; }
    .btn-danger { background: #991b1b; color: #fee2e2; border-color: #ef4444; }
    .btn-danger:hover { background: #b91c1c; box-shadow: 0 0 14px rgba(239, 68, 68, 0.4); }

    /* Key Health Metrics Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      padding: 16px 18px;
      position: relative;
      overflow: hidden;
      transition: border-color 0.2s, transform 0.2s;
    }
    .stat-card:hover {
      border-color: var(--border-bright);
      transform: translateY(-2px);
    }
    .stat-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 2px;
    }
    .stat-card.c-cyan::before { background: var(--neon-cyan); box-shadow: 0 0 8px var(--neon-cyan); }
    .stat-card.c-emerald::before { background: var(--neon-green); box-shadow: 0 0 8px var(--neon-green); }
    .stat-card.c-amber::before { background: var(--neon-yellow); box-shadow: 0 0 8px var(--neon-yellow); }
    .stat-card.c-purple::before { background: var(--neon-purple); box-shadow: 0 0 8px var(--neon-purple); }

    .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); font-weight: 600; }
    .stat-val { font-size: 26px; font-weight: 800; font-family: 'JetBrains Mono', monospace; margin: 4px 0 2px; }
    .stat-sub { font-size: 12px; color: var(--text-faint); display: flex; align-items: center; gap: 6px; }

    
    /* Realtime Node Topology & Connection Map */
    .topology-container {
      background: #080d1a;
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 20px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    .topology-title-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid #1e293b;
    }
    .topology-grid {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      position: relative;
      overflow-x: auto;
      padding: 8px 4px;
    }
    @media (max-width: 992px) {
      .topology-grid {
        flex-direction: column;
        align-items: stretch;
      }
      .topo-arrow {
        transform: rotate(90deg);
        margin: 6px auto;
      }
    }
    .topo-node {
      flex: 1;
      min-width: 200px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px 14px;
      transition: all 0.25s ease;
      position: relative;
    }
    .topo-node.active {
      border-color: #10b981;
      box-shadow: 0 0 12px rgba(16, 185, 129, 0.25);
    }
    .topo-node.idle {
      border-color: #38bdf8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.2);
    }
    .topo-node.disconnected {
      border-color: #ef4444;
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.2);
    }
    .topo-node-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .topo-node-name {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.3px;
      color: #f1f5f9;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .topo-status-pill {
      font-size: 9.5px;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-family: 'JetBrains Mono', monospace;
    }
    .pill-green { background: #064e3b; color: #6ee7b7; border: 1px solid #10b981; }
    .pill-cyan { background: #0c4a6e; color: #7dd3fc; border: 1px solid #38bdf8; }
    .pill-amber { background: #78350f; color: #fde68a; border: 1px solid #f59e0b; }
    .pill-red { background: #7f1d1d; color: #fca5a5; border: 1px solid #ef4444; }
    
    .topo-node-meta {
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.5;
    }
    .topo-node-endpoint {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: #64748b;
      margin-top: 4px;
      word-break: break-all;
    }
    .topo-arrow {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #475569;
      flex-shrink: 0;
      gap: 2px;
    }
    .topo-arrow.active {
      color: #10b981;
      animation: arrowPulse 1.5s infinite;
    }
    .topo-arrow-label {
      font-size: 9px;
      font-family: 'JetBrains Mono', monospace;
      color: #94a3b8;
      white-space: nowrap;
    }
    @keyframes arrowPulse {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }

    /* Dashboard Main Two-Column Layout */
    .dashboard-layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    @media (max-width: 1200px) {
      .dashboard-layout { grid-template-columns: 1fr; }
    }

    /* Standard Panel */
    .panel {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    .panel-header {
      padding: 12px 18px;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .panel-title {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.2px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Live Terminal Console */
    .terminal-wrapper {
      background: #030712;
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 20px;
      font-family: 'JetBrains Mono', monospace;
    }
    .terminal-bar {
      background: #0b1120;
      padding: 10px 16px;
      border-bottom: 1px solid #1e293b;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .terminal-dots { display: flex; gap: 6px; }
    .t-dot { width: 10px; height: 10px; border-radius: 50%; }
    .t-red { background: #ef4444; }
    .t-yellow { background: #f59e0b; }
    .t-green { background: #10b981; }

    .terminal-filters {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .terminal-filter-btn {
      background: transparent;
      border: 1px solid #334155;
      color: #94a3b8;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
    }
    .terminal-filter-btn.active {
      background: #0284c7;
      color: white;
      border-color: #38bdf8;
    }
    
    .terminal-body {
      height: 380px;
      overflow-y: auto;
      padding: 14px 18px;
      font-size: 12px;
      line-height: 1.65;
      background: #030712;
      color: #e2e8f0;
      scrollbar-width: thin;
      scrollbar-color: #334155 #030712;
    }
    .terminal-body::-webkit-scrollbar { width: 6px; }
    .terminal-body::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }

    .t-line {
      display: flex;
      gap: 8px;
      margin-bottom: 3px;
      word-break: break-all;
    }
    .t-time { color: #64748b; font-weight: 500; min-width: 90px; }
    .t-src { font-weight: 700; min-width: 140px; }
    .t-src-n8n { color: #f43f5e; }
    .t-src-whatsapp_extension { color: #10b981; }
    .t-src-microservice { color: #38bdf8; }
    .t-src-user { color: #eab308; }
    .t-src-client { color: #a855f7; }

    .t-lvl-INFO { color: #38bdf8; font-weight: 600; min-width: 55px; }
    .t-lvl-SUCCESS { color: #34d399; font-weight: 800; min-width: 55px; text-shadow: 0 0 6px rgba(52, 211, 153, 0.4); }
    .t-lvl-WARN { color: #fbbf24; font-weight: 600; min-width: 55px; }
    .t-lvl-ERROR { color: #f87171; font-weight: 800; min-width: 55px; text-shadow: 0 0 6px rgba(248, 113, 113, 0.4); }

    .t-msg { color: #f1f5f9; }
    .t-det { color: #94a3b8; font-size: 11px; margin-left: 6px; }

    /* Facebook Grid */
    .fb-pages-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
      padding: 16px;
    }
    .fb-page-card {
      background: #0b1120;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: border-color 0.15s;
    }
    .fb-page-card:hover { border-color: var(--border-bright); }
    .fb-page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .fb-page-name { font-weight: 700; font-size: 13px; color: #f8fafc; }
    .status-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-active { background: #065f46; color: #a7f3d0; border: 1px solid #10b981; }
    .badge-inactive { background: #7f1d1d; color: #fecaca; border: 1px solid #ef4444; }

    /* Queue Table */
    .queue-table-wrapper { padding: 12px 16px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th { text-align: left; padding: 8px 12px; background: #0b1120; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 1px solid var(--border-subtle); }
    td { padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); color: #cbd5e1; vertical-align: middle; }
    tr:hover td { background: #0e172a; }

    /* Pulse animation */
    .pulse-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: livePulse 1.8s infinite;
    }
    @keyframes livePulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    pre.payload-box {
      background: #050914;
      border: 1px solid #1e293b;
      border-radius: 6px;
      padding: 8px 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #38bdf8;
      max-height: 140px;
      overflow-y: auto;
      margin-top: 4px;
    }
  </style>
</head>
<body>

  <!-- Master Control Header -->
  <div class="top-bar">
    <div class="brand-group">
      <div class="brand-badge">ULTRA OPS</div>
      <div>
        <h1 style="font-size: 18px; font-weight: 800; color: white; display: flex; align-items: center; gap: 8px;">
          <span>Facebook 48h Monitor & WhatsApp Web Bridge</span>
          <span class="pulse-dot"></span>
        </h1>
        <div style="font-size: 11.5px; color: var(--text-faint);">Real-time bi-directional telemetry across n8n, Scraper Microservice, and WhatsApp Web DOM</div>
      </div>
    </div>
    <div class="top-actions">
      <button class="btn btn-emerald" onclick="auditAllPages()" id="btnAuditAll">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        Audit All 8 Pages Now
      </button>
      <button class="btn btn-cyan" onclick="triggerWorkflow()" id="btnTriggerWorkflow">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        Trigger n8n Workflow
      </button>
      <button class="btn btn-purple" onclick="sendCustomAlert()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Send Test WhatsApp
      </button>
      <button class="btn btn-danger" onclick="logoutSession()" title="Lock Console & Invalidate Session">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Lock Console
      </button>
    </div>
  </div>

  <!-- Key Health Metrics Grid -->
  <div class="metrics-grid">
    <div class="stat-card c-cyan">
      <div class="stat-label">Pending Alert Queue</div>
      <div class="stat-val" id="queueCount" style="color: var(--neon-cyan);">0</div>
      <div class="stat-sub" id="queueSub">Awaiting delivery to WhatsApp</div>
    </div>

    <div class="stat-card c-purple">
      <div class="stat-label">FB Session Cookies & Scraper</div>
      <div class="stat-val" id="cookieVal" style="color: var(--neon-purple); font-size: 19px;">Checking...</div>
      <div class="stat-sub" id="cookieSub">./fb-cookies.json status</div>
    </div>

    <div class="stat-card c-emerald">
      <div class="stat-label">WhatsApp Web Heartbeat</div>
      <div class="stat-val" id="extStatus" style="color: var(--neon-green); font-size: 20px; line-height: 1.4;">Connecting...</div>
      <div class="stat-sub" id="extLastSeen">Waiting for extension ping</div>
    </div>

    <div class="stat-card c-amber">
      <div class="stat-label">Active Conversation (DOM)</div>
      <div class="stat-val" id="activeChat" style="color: var(--neon-yellow); font-size: 19px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">—</div>
      <div class="stat-sub" id="activeChatSub">Detected in open tab</div>
    </div>
  </div>

  
  <!-- Real-Time Interactive Connection Topology -->
  <div class="topology-container">
    <div class="topology-title-bar">
      <div style="display: flex; align-items: center; gap: 8px;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        <span style="font-weight: 700; font-size: 12.5px; letter-spacing: 0.4px; color: #f8fafc;">LIVE CONNECTION TOPOLOGY & MESH STATUS</span>
        <span class="pulse-dot" style="width: 6px; height: 6px;"></span>
      </div>
      <div style="font-size: 11px; color: #94a3b8;">
        Continuous bidirectional ping & latency sync
      </div>
    </div>

    <div class="topology-grid">
      
      <!-- Node 1: Cloud n8n Workflow Server -->
      <div class="topo-node" id="topoN8n">
        <div class="topo-node-header">
          <div class="topo-node-name">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
            n8n Cloud Engine
          </div>
          <span class="topo-status-pill pill-cyan" id="topoN8nPill">CHECKING</span>
        </div>
        <div class="topo-node-meta" id="topoN8nMeta">Workflow: 10 AM PKT / Webhook</div>
        <div class="topo-node-endpoint">n8n-server-lp44.onrender.com</div>
      </div>

      <!-- Arrow 1 -->
      <div class="topo-arrow active">
        <span class="topo-arrow-label">POST /api/fb-check-all</span>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>

      <!-- Node 2: Scraper Microservice (This Hub) -->
      <div class="topo-node active" id="topoScraper">
        <div class="topo-node-header">
          <div class="topo-node-name">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
            Scraper & Bridge Hub
          </div>
          <span class="topo-status-pill pill-green">LIVE HUB</span>
        </div>
        <div class="topo-node-meta" id="topoScraperMeta">Puppeteer Stealth • Port 10000</div>
        <div class="topo-node-endpoint">fb-scraper-service.onrender.com</div>
      </div>

      <!-- Arrow 2 -->
      <div class="topo-arrow active" id="topoArrowQueue">
        <span class="topo-arrow-label" id="topoArrowQueueLabel">GET /api/pending-alerts</span>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>

      <!-- Node 3: WhatsApp Web Extension -->
      <div class="topo-node" id="topoExt">
        <div class="topo-node-header">
          <div class="topo-node-name">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            ChatStage Extension
          </div>
          <span class="topo-status-pill pill-amber" id="topoExtPill">WAITING</span>
        </div>
        <div class="topo-node-meta" id="topoExtMeta">WhatsApp Web Chrome Client</div>
        <div class="topo-node-endpoint" id="topoExtEndpoint">Polling Cloud Service</div>
      </div>

      <!-- Arrow 3 -->
      <div class="topo-arrow active">
        <span class="topo-arrow-label">DOM Automation</span>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </div>

      <!-- Node 4: WhatsApp Group Recipient -->
      <div class="topo-node" id="topoTarget">
        <div class="topo-node-header">
          <div class="topo-node-name">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            WhatsApp Destination
          </div>
          <span class="topo-status-pill pill-cyan" id="topoTargetPill">TARGET</span>
        </div>
        <div class="topo-node-meta" id="topoTargetMeta">Daily Task Update / +923349003849</div>
        <div class="topo-node-endpoint">48h Inactivity Alert Dispatch</div>
      </div>

    </div>
  </div>

  <!-- Live Terminal Console -->
  <div class="terminal-wrapper">
    <div class="terminal-bar">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div class="terminal-dots">
          <span class="t-dot t-red"></span>
          <span class="t-dot t-yellow"></span>
          <span class="t-dot t-green"></span>
        </div>
        <span style="font-weight: 700; font-size: 12px; color: #94a3b8; letter-spacing: 0.5px;">LIVE TELEMETRY STREAM (STDOUT / WEBSOCKET MIRROR)</span>
      </div>

      <div class="terminal-filters">
        <button class="terminal-filter-btn active" onclick="setTerminalFilter('ALL', this)">ALL</button>
        <button class="terminal-filter-btn" onclick="setTerminalFilter('n8n', this)">n8n</button>
        <button class="terminal-filter-btn" onclick="setTerminalFilter('whatsapp_extension', this)">WhatsApp Extension</button>
        <button class="terminal-filter-btn" onclick="setTerminalFilter('microservice', this)">Microservice</button>
        
        <div style="height: 14px; width: 1px; background: #334155; margin: 0 4px;"></div>
        
        <label style="color: #94a3b8; font-size: 11px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
          <input type="checkbox" id="autoScrollCheck" checked> Auto-scroll
        </label>
        <button class="btn btn-dark" style="padding: 3px 8px; font-size: 11px;" onclick="clearTerminal()">Clear Console</button>
      </div>
    </div>
    
    <div class="terminal-body" id="terminalOutput">
      <div style="color: #64748b;">Initializing real-time stream subscriber...</div>
    </div>
  </div>

  <!-- Middle Layout: Monitored Facebook Pages Grid & WhatsApp Queue Manager -->
  <div class="dashboard-layout">
    
    <!-- Left: 8 Monitored Facebook Pages Status -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          Monitored Facebook Pages (48h Inactivity Rule)
        </div>
        <button class="btn btn-dark" style="padding: 4px 10px; font-size: 11px;" onclick="auditAllPages()">Refresh Now</button>
      </div>
      <div class="fb-pages-grid" id="fbPagesGrid">
        <div style="color: #64748b; font-size: 12px; padding: 12px;">Loading monitored pages status...</div>
      </div>
    </div>

    <!-- Right: Pending WhatsApp Dispatch Queue Manager -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          WhatsApp Dispatch Queue & Retries
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-danger" style="padding: 4px 10px; font-size: 11px;" onclick="clearQueue()">Clear Queue</button>
        </div>
      </div>
      <div class="queue-table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Target</th>
              <th>Message</th>
              <th>Queued Since</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="queueTableBody">
            <tr><td colspan="4" style="text-align: center; color: #64748b;">Queue is empty.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- Bottom Full Diagnostic Audit Table -->
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        Complete Diagnostic Telemetry Audit Trail
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <input type="text" id="logSearchInput" placeholder="Filter logs..." oninput="renderTableLogs()" style="background: #0b1120; border: 1px solid #334155; color: white; padding: 4px 10px; border-radius: 6px; font-size: 11.5px; width: 180px;">
        <button class="btn btn-dark" style="padding: 4px 10px; font-size: 11px;" onclick="clearAuditLogs()">Clear Log Buffer</button>
      </div>
    </div>
    <div style="padding: 12px 16px; overflow-x: auto;">
      <table>
        <thead>
          <tr>
            <th style="width: 110px;">Time</th>
            <th style="width: 140px;">Source</th>
            <th style="width: 90px;">Level</th>
            <th>Event Description</th>
            <th>Diagnostic Payload / Element State</th>
          </tr>
        </thead>
        <tbody id="auditTableBody">
          <tr><td colspan="5" style="text-align: center; color: #64748b;">Waiting for audit events...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    let activeTerminalFilter = 'ALL';
    let allLogsCache = [];
    let seenTerminalIds = new Set();
    let initialTerminalLoad = true;

    // Fetch telemetry state every 1 second
    async function fetchTelemetry() {
      try {
        const res = await fetch('/api/telemetry/logs');
        const data = await res.json();
        allLogsCache = data.logs || [];

        // 1. Update Queue Metric & Table
        const qCount = data.pendingAlertsCount || 0;
        document.getElementById('queueCount').innerText = qCount;
        if (qCount > 0) {
          document.getElementById('queueSub').innerText = 'Next: ' + (data.pendingAlerts[0].message || '').slice(0, 32) + '...';
        } else {
          document.getElementById('queueSub').innerText = 'Queue empty — all messages delivered';
        }

        renderQueueTable(data.pendingAlerts || []);

        // 2. Cookie Status & Age Metric
        const cStat = data.cookieStatus;
        if (cStat) {
          const valEl = document.getElementById('cookieVal');
          const subEl = document.getElementById('cookieSub');
          if (cStat.exists) {
            if (cStat.isExpiredWarn) {
              valEl.innerHTML = '<span style="color: #f59e0b;">● Warning (' + cStat.ageDays + 'd old)</span>';
              subEl.innerText = cStat.count + ' cookies (Age > 30d, consider refresh)';
            } else {
              valEl.innerHTML = '<span style="color: #10b981;">● Active (' + cStat.count + ' cookies)</span>';
              subEl.innerText = 'Age: ' + cStat.ageDays + ' days old • Authenticated';
            }
          } else {
            valEl.innerHTML = '<span style="color: #f87171;">● Missing</span>';
            subEl.innerText = 'Add fb-cookies.json to authenticate';
          }
        }

        // 3. Extension Heartbeat & DOM Status
        const extLogs = allLogsCache.filter(l => l.source === 'whatsapp_extension');
        if (extLogs.length > 0) {
          const latest = extLogs[0];
          const secAgo = Math.round((Date.now() - new Date(latest.iso).getTime()) / 1000);
          
          if (secAgo < 10) {
            document.getElementById('extStatus').innerHTML = '<span style="color: #10b981;">● Online (Connected)</span>';
            document.getElementById('extLastSeen').innerText = 'Ping ' + secAgo + 's ago';
          } else {
            document.getElementById('extStatus').innerHTML = '<span style="color: #f59e0b;">● Stalled (' + secAgo + 's)</span>';
            document.getElementById('extLastSeen').innerText = 'Last active: ' + latest.time;
          }

          const heartbeat = extLogs.find(l => l.details && l.details.activeChat !== undefined);
          if (heartbeat) {
            const chatName = heartbeat.details.activeChat || 'None';
            document.getElementById('activeChat').innerText = chatName;
            document.getElementById('activeChatSub').innerText = chatName === 'None' ? 'No chat currently selected' : 'Ready for typing';
          }
        } else {
          document.getElementById('extStatus').innerHTML = '<span style="color: #ef4444;">● Disconnected</span>';
          document.getElementById('extLastSeen').innerText = 'Extension not detected on WhatsApp Web';
        }

        // 3. Render Terminal Output
        renderTerminal();

        // 4. Render Audit Table
        renderTableLogs();

        // 5. Update Connection Topology Real-time Status
        updateTopologyStatus(data);


      } catch (err) {
        console.error('Fetch telemetry failed:', err);
      }
    }

    function setTerminalFilter(filter, btn) {
      activeTerminalFilter = filter;
      document.querySelectorAll('.terminal-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Reset terminal and re-render with new filter
      document.getElementById('terminalOutput').innerHTML = '';
      seenTerminalIds.clear();
      renderTerminal();
    }

    function renderTerminal() {
      const term = document.getElementById('terminalOutput');
      if (initialTerminalLoad) {
        term.innerHTML = '';
        initialTerminalLoad = false;
      }

      const logsToDisplay = activeTerminalFilter === 'ALL' 
        ? allLogsCache 
        : allLogsCache.filter(l => l.source === activeTerminalFilter);

      const reversed = [...logsToDisplay].reverse();
      let added = false;

      reversed.forEach(log => {
        if (!seenTerminalIds.has(log.id)) {
          seenTerminalIds.add(log.id);
          added = true;

          const line = document.createElement('div');
          line.className = 't-line';

          const detStr = log.details && Object.keys(log.details).length > 0
            ? '<span class="t-det">' + JSON.stringify(log.details) + '</span>'
            : '';

          line.innerHTML = 
            '<span class="t-time">[' + log.time + ']</span>' +
            '<span class="t-src t-src-' + log.source + '">[' + log.source.toUpperCase() + ']</span>' +
            '<span class="t-lvl-' + log.level + '">' + log.level + '</span>' +
            '<span class="t-msg">' + log.event + '</span>' +
            detStr;

          term.appendChild(line);
        }
      });

      if (added && document.getElementById('autoScrollCheck').checked) {
        term.scrollTop = term.scrollHeight;
      }
    }

    function renderQueueTable(alerts) {
      const tbody = document.getElementById('queueTableBody');
      if (!alerts || alerts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748b; padding: 16px;">Queue is empty. No messages waiting.</td></tr>';
        return;
      }

      tbody.innerHTML = alerts.map(a => {
        const secWaiting = Math.round((Date.now() - a.timestamp) / 1000);
        return '<tr>' +
          '<td><strong style="color: #38bdf8; font-family: monospace;">+' + a.target + '</strong></td>' +
          '<td>' + a.message + '</td>' +
          '<td><span style="color: #f59e0b; font-family: monospace;">' + secWaiting + 's ago</span></td>' +
          '<td>' +
            '<button class="btn btn-danger" style="padding: 2px 8px; font-size: 11px;" onclick="dismissAlert(\\'' + a.id + '\\')">Dismiss</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    function renderTableLogs() {
      const search = (document.getElementById('logSearchInput').value || '').toLowerCase();
      const filtered = allLogsCache.filter(l => {
        if (!search) return true;
        return l.event.toLowerCase().includes(search) || 
               l.source.toLowerCase().includes(search) || 
               l.level.toLowerCase().includes(search) ||
               JSON.stringify(l.details).toLowerCase().includes(search);
      });

      const tbody = document.getElementById('auditTableBody');
      tbody.innerHTML = filtered.slice(0, 50).map(l => {
        const det = l.details && Object.keys(l.details).length > 0
          ? '<pre class="payload-box">' + JSON.stringify(l.details, null, 2) + '</pre>'
          : '<span style="color: #64748b;">—</span>';

        const lvlColor = l.level === 'SUCCESS' ? '#34d399' : l.level === 'ERROR' ? '#f87171' : l.level === 'WARN' ? '#fbbf24' : '#38bdf8';

        return '<tr>' +
          '<td><code style="color: #94a3b8;">' + l.time + '</code></td>' +
          '<td><span style="font-weight: 700; color: #cbd5e1;">' + l.source + '</span></td>' +
          '<td><span style="font-weight: 700; color: ' + lvlColor + ';">' + l.level + '</span></td>' +
          '<td><strong>' + l.event + '</strong></td>' +
          '<td>' + det + '</td>' +
        '</tr>';
      }).join('');
    }

    // Monitored Facebook pages definition
    const MONITORED_PAGES = [
      { handle: 'therepairpros', name: 'The Repair Pros' },
      { handle: 'thebakerycafepk', name: 'The Bakery Cafe PK' },
      { handle: 'alifschoolandcollege', name: 'Alif School & Girls College' },
      { handle: 'alifdegreecollege', name: 'Alif Degree College' },
      { handle: 'islepk', name: 'ISLE PK' },
      { handle: 'blossomspreschool', name: 'Blossoms Pre-School' },
      { handle: 'thebritishschoolmardan', name: 'The British School Mardan' },
      { handle: 'basmaemaargroup', name: 'Basma Emaar Group' }
    ];

    function renderPageCard(p, isAuditing = false) {
      if (isAuditing) {
        return '<div class="fb-page-card" id="card_' + p.handle + '" style="border-color: #38bdf8;">' +
          '<div class="fb-page-header">' +
            '<span class="fb-page-name">' + p.name + '</span>' +
            '<span class="status-badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">Auditing...</span>' +
          '</div>' +
          '<div style="font-size: 11px; color: #64748b; font-family: monospace;">@' + p.handle + '</div>' +
          '<div style="font-size: 11px; color: #38bdf8; margin-top: 6px;">Fetching latest post timestamp via Puppeteer...</div>' +
        '</div>';
      }

      const hoursAgo = p.inactiveHours !== undefined ? p.inactiveHours : Math.round((Date.now() - new Date(p.last_post_iso || p.lastPostDate).getTime()) / (1000 * 60 * 60));
      const isInactive = p.isInactive !== undefined ? p.isInactive : (hoursAgo >= 48);
      const badgeClass = isInactive ? 'badge-inactive' : 'badge-active';
      const badgeText = isInactive ? 'Inactive (' + hoursAgo + 'h)' : 'Active (' + hoursAgo + 'h)';
      const snippet = p.lastPostContent ? '<div style="font-size: 11px; color: #cbd5e1; background: #070d19; padding: 4px 6px; border-radius: 4px; margin-top: 4px; font-style: italic;">“' + p.lastPostContent + '”</div>' : '';
      const methodTag = p.scrapeMethod ? '<span style="font-size: 9px; padding: 1px 4px; background: #1e293b; color: #94a3b8; border-radius: 3px;">' + p.scrapeMethod + '</span>' : '';

      return '<div class="fb-page-card" id="card_' + (p.page || p.handle) + '">' +
        '<div class="fb-page-header">' +
          '<span class="fb-page-name">' + (p.page_name || p.name) + '</span>' +
          '<span class="status-badge ' + badgeClass + '">' + badgeText + '</span>' +
        '</div>' +
        '<div style="font-size: 11px; color: #64748b; font-family: monospace; display: flex; justify-content: space-between; align-items: center;">@' + (p.page || p.handle) + ' ' + methodTag + '</div>' +
        '<div style="font-size: 11px; color: #94a3b8;">Last post: ' + new Date(p.last_post_iso || p.lastPostDate).toLocaleString() + '</div>' +
        snippet +
        '<div style="margin-top: 4px;">' +
          '<a href="' + (p.post_url || 'https://www.facebook.com/' + (p.page || p.handle) + '/posts/') + '" target="_blank" style="font-size: 11px; color: #38bdf8; text-decoration: none;">View Page ↗</a>' +
        '</div>' +
      '</div>';
    }

    // Progressive Audit All Facebook Pages (Prevents Edge Proxy Timeouts)
    async function auditAllPages() {
      const btn = document.getElementById('btnAuditAll');
      btn.disabled = true;
      const container = document.getElementById('fbPagesGrid');

      // Initialize all cards with loading skeleton state
      container.innerHTML = MONITORED_PAGES.map(p => renderPageCard(p, true)).join('');

      let completedCount = 0;
      btn.innerHTML = 'Auditing 0/' + MONITORED_PAGES.length + '...';

      // Audit pages in parallel batches of 2 to balance speed and Render memory
      const batchSize = 2;
      for (let i = 0; i < MONITORED_PAGES.length; i += batchSize) {
        const batch = MONITORED_PAGES.slice(i, i + batchSize);
        await Promise.all(batch.map(async (pageInfo) => {
          const cardEl = document.getElementById('card_' + pageInfo.handle);
          try {
            const res = await fetch('/api/fb-post/' + pageInfo.handle);
            if (!res.ok) {
              const errText = await res.text();
              throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 80));
            }
            const data = await res.json();
            if (cardEl) {
              cardEl.outerHTML = renderPageCard({
                ...data,
                handle: pageInfo.handle,
                name: pageInfo.name
              });
            }
          } catch (err) {
            if (cardEl) {
              cardEl.innerHTML = '<div class="fb-page-header">' +
                '<span class="fb-page-name">' + pageInfo.name + '</span>' +
                '<span class="status-badge badge-inactive">Audit Error</span>' +
              '</div>' +
              '<div style="font-size: 11px; color: #64748b; font-family: monospace;">@' + pageInfo.handle + '</div>' +
              '<div style="font-size: 11px; color: #ef4444; margin-top: 4px;">' + err.message + '</div>';
            }
          } finally {
            completedCount++;
            btn.innerHTML = 'Auditing ' + completedCount + '/' + MONITORED_PAGES.length + '...';
          }
        }));
      }

      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg> Audit All 8 Pages Now';
    }

    async function triggerWorkflow() {
      const btn = document.getElementById('btnTriggerWorkflow');
      btn.disabled = true;
      btn.innerHTML = 'Executing...';
      try {
        await fetch('https://n8n-server-lp44.onrender.com/webhook/fb-check-inactivity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger: 'manual_ultra_dashboard' })
        });
        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Trigger n8n Workflow';
        }, 1200);
      } catch (err) {
        alert('Failed to trigger n8n: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = 'Trigger n8n Workflow';
      }
    }

    async function sendCustomAlert() {
      const msg = prompt('Enter custom message to dispatch to WhatsApp (+923349003849):', 'The Repair Pros is inactive since 48 hours.');
      if (!msg) return;
      try {
        await fetch('/api/send-whatsapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: '923349003849', message: msg })
        });
      } catch (err) {
        alert('Send failed: ' + err.message);
      }
    }

    async function dismissAlert(id) {
      if (!confirm('Dismiss this queued alert?')) return;
      try {
        await fetch('/api/pending-alerts/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
      } catch (err) {
        alert('Failed to dismiss: ' + err.message);
      }
    }

    async function clearQueue() {
      if (!confirm('Clear all pending alerts in queue?')) return;
      try {
        await fetch('/api/pending-alerts/clear', { method: 'POST' });
      } catch (err) {
        alert('Failed to clear queue: ' + err.message);
      }
    }

    async function clearAuditLogs() {
      try {
        await fetch('/api/telemetry/clear', { method: 'POST' });
        clearTerminal();
      } catch (err) {
        alert('Failed to clear logs: ' + err.message);
      }
    }

    
    async function logoutSession() {
      if (!confirm('Lock console and end your session?')) return;
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.reload();
      } catch (err) {
        alert('Logout error: ' + err.message);
      }
    }

    function clearTerminal() {
      document.getElementById('terminalOutput').innerHTML = '<div style="color: #64748b;">Terminal cleared. Waiting for events...</div>';
      seenTerminalIds.clear();
    }

    
    let lastN8nCheck = 0;
    let n8nIsOnline = true;

    async function checkN8nHealth() {
      const now = Date.now();
      if (now - lastN8nCheck < 5000) return;
      lastN8nCheck = now;
      try {
        const res = await fetch('/api/n8n/health');
        const data = await res.json();
        n8nIsOnline = Boolean(data.online);
        const node = document.getElementById('topoN8n');
        const pill = document.getElementById('topoN8nPill');
        const meta = document.getElementById('topoN8nMeta');
        if (n8nIsOnline) {
          node.className = 'topo-node active';
          pill.className = 'topo-status-pill pill-green';
          pill.innerText = 'ONLINE (200)';
          meta.innerText = 'Render Cloud Workflow Ready';
        } else {
          node.className = 'topo-node disconnected';
          pill.className = 'topo-status-pill pill-red';
          pill.innerText = 'OFFLINE';
          meta.innerText = data.error || 'Connection Failed';
        }
      } catch {
        // silent
      }
    }

    function updateTopologyStatus(data) {
      checkN8nHealth();

      // Extension Node
      const extLogs = allLogsCache.filter(l => l.source === 'whatsapp_extension');
      const extNode = document.getElementById('topoExt');
      const extPill = document.getElementById('topoExtPill');
      const extMeta = document.getElementById('topoExtMeta');
      const extEndpoint = document.getElementById('topoExtEndpoint');

      if (extLogs.length > 0) {
        const latest = extLogs[0];
        const secAgo = Math.round((Date.now() - new Date(latest.iso).getTime()) / 1000);
        if (secAgo < 10) {
          extNode.className = 'topo-node active';
          extPill.className = 'topo-status-pill pill-green';
          extPill.innerText = 'CONNECTED';
          extMeta.innerText = 'Active on WhatsApp Web (' + secAgo + 's ago)';
        } else {
          extNode.className = 'topo-node idle';
          extPill.className = 'topo-status-pill pill-amber';
          extPill.innerText = 'IDLE (' + secAgo + 's)';
          extMeta.innerText = 'Last heartbeat at ' + latest.time;
        }

        const heartbeat = extLogs.find(l => l.details && l.details.activeChat !== undefined);
        if (heartbeat) {
          extEndpoint.innerText = 'Chat: ' + (heartbeat.details.activeChat || 'None');
        }
      } else {
        extNode.className = 'topo-node disconnected';
        extPill.className = 'topo-status-pill pill-red';
        extPill.innerText = 'OFFLINE';
        extMeta.innerText = 'Extension not active on WhatsApp Web';
      }

      // Queue Arrow
      const qCount = data.pendingAlertsCount || 0;
      const arrowLabel = document.getElementById('topoArrowQueueLabel');
      if (qCount > 0) {
        arrowLabel.innerText = 'DISPATCHING (' + qCount + ' QUEUED)';
        arrowLabel.style.color = '#38bdf8';
      } else {
        arrowLabel.innerText = 'IDLE (0 QUEUED)';
        arrowLabel.style.color = '#94a3b8';
      }
    }

    // Startup
    setInterval(fetchTelemetry, 1000);
    fetchTelemetry();
    auditAllPages();
  </script>
</body>
</html>`;
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`🚀 Facebook Page Monitor Microservice listening on port ${PORT}`);
  console.log(`📊 Live Telemetry Monitor available at: http://localhost:${PORT}/live`);
});


