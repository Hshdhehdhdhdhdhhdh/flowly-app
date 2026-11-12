// Flowly backend — Express + JSON file store
// Auth: bcrypt-hashed passwords, JWT in an httpOnly cookie.
require('./env');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE = 'flowly_token';

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET not set — using a development secret. Set it in .env before deploying.');
}

app.disable('x-powered-by');
// Render (and most hosts) sit behind a proxy: trust it so req.ip and HTTPS are detected correctly
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
// Everything is in one page file next to this script; only that file is served
const PAGE = path.join(__dirname, 'index.html');

// ---------- helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, plan: u.plan, createdAt: u.createdAt });

function setAuthCookie(res, user) {
  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    const user = db.get('users').find((u) => u.id === sub);
    if (!user) return res.status(401).json({ error: 'Account not found. Sign in again.' });
    req.user = user;
    next();
  } catch {
    res.clearCookie(COOKIE);
    return res.status(401).json({ error: 'Your session expired. Sign in again.' });
  }
}

// Simple in-memory rate limit for auth routes (10 tries / 10 min per IP)
const attempts = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, start: now };
  if (now - rec.start > 10 * 60 * 1000) { rec.count = 0; rec.start = now; }
  rec.count += 1;
  attempts.set(key, rec);
  if (rec.count > 10) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
  next();
}

// ---------- auth ----------
app.post('/api/auth/register', rateLimit, async (req, res) => {
  const name = clean(req.body.name, 80);
  const email = clean(req.body.email, 120).toLowerCase();
  const password = String(req.body.password ?? '');
  const errors = {};
  if (name.length < 2) errors.name = 'Enter your full name.';
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    errors.password = 'Use 8+ characters with at least one letter and one number.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Check the highlighted fields.', fields: errors });

  if (db.get('users').some((u) => u.email === email))
    return res.status(409).json({ error: 'An account with this email already exists.', fields: { email: 'Already registered — sign in instead.' } });

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    plan: 'Starter',
    createdAt: new Date().toISOString(),
  };
  db.update('users', (list) => [...list, user]);
  // Seed a starter workflow so the workspace isn't empty
  const starter = ['Invite your team', 'Connect your first app', 'Build an approval flow'].map((title, i) => ({
    id: crypto.randomUUID(), userId: user.id, title, status: i === 0 ? 'doing' : 'todo', createdAt: new Date().toISOString(),
  }));
  db.update('tasks', (list) => [...list, ...starter]);
  setAuthCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/auth/login', rateLimit, async (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const password = String(req.body.password ?? '');
  if (!EMAIL_RE.test(email) || !password)
    return res.status(400).json({ error: 'Enter your email and password.' });
  const user = db.get('users').find((u) => u.email === email);
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
  setAuthCookie(res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

// Returns { user: null } (not an error) when nobody is signed in, so the page can check quietly
app.get('/api/auth/me', (req, res) => {
  const token = req.cookies[COOKIE];
  if (!token) return res.json({ user: null });
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    const user = db.get('users').find((u) => u.id === sub);
    if (!user) { res.clearCookie(COOKIE); return res.json({ user: null }); }
    res.json({ user: publicUser(user) });
  } catch {
    res.clearCookie(COOKIE);
    res.json({ user: null });
  }
});

// ---------- workspace tasks (protected) ----------
const STATUSES = ['todo', 'doing', 'done'];

app.get('/api/tasks', requireAuth, (req, res) => {
  res.json({ tasks: db.get('tasks').filter((t) => t.userId === req.user.id) });
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const title = clean(req.body.title, 140);
  if (!title) return res.status(400).json({ error: 'Give the task a name.' });
  const task = { id: crypto.randomUUID(), userId: req.user.id, title, status: 'todo', createdAt: new Date().toISOString() };
  db.update('tasks', (list) => [...list, task]);
  res.status(201).json({ task });
});

app.patch('/api/tasks/:id', requireAuth, (req, res) => {
  let updated = null;
  db.update('tasks', (list) => list.map((t) => {
    if (t.id !== req.params.id || t.userId !== req.user.id) return t;
    updated = { ...t };
    if (req.body.title !== undefined) updated.title = clean(req.body.title, 140) || t.title;
    if (STATUSES.includes(req.body.status)) updated.status = req.body.status;
    return updated;
  }));
  if (!updated) return res.status(404).json({ error: 'Task not found.' });
  res.json({ task: updated });
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  let found = false;
  db.update('tasks', (list) => list.filter((t) => {
    const match = t.id === req.params.id && t.userId === req.user.id;
    if (match) found = true;
    return !match;
  }));
  if (!found) return res.status(404).json({ error: 'Task not found.' });
  res.json({ ok: true });
});

// ---------- demo / contact form (public) ----------
app.post('/api/demo', (req, res) => {
  const name = clean(req.body.name, 80);
  const email = clean(req.body.email, 120).toLowerCase();
  const company = clean(req.body.company, 120);
  const teamSize = clean(req.body.teamSize, 20);
  const message = clean(req.body.message, 1000);
  const errors = {};
  if (name.length < 2) errors.name = 'Enter your name.';
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid work email.';
  if (!company) errors.company = 'Enter your company name.';
  if (!teamSize) errors.teamSize = 'Choose your team size.';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Check the highlighted fields.', fields: errors });
  const request = { id: crypto.randomUUID(), name, email, company, teamSize, message, createdAt: new Date().toISOString() };
  db.update('demoRequests', (list) => [...list, request]);
  res.status(201).json({ ok: true, id: request.id });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Unknown API routes → JSON 404; everything else → landing page
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((req, res) => res.sendFile(PAGE));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

app.listen(PORT, () => console.log(`Flowly running at http://localhost:${PORT}`));
