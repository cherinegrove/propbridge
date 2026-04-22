// =====================================================
// SYNCSTATION MAIN SERVER
// =====================================================

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const pool = require('./src/services/database');
const authRoutes = require('./src/routes/authRoutes');
const { requireAuth } = require('./src/middleware/requireAuth');
const adminAuthRoutes = require('./src/routes/admin-auth');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Required for Railway reverse proxy — must be before session
app.set('trust proxy', 1);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
    secret: process.env.SESSION_SECRET || 'syncstation-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(express.static('src/public'));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ── ADMIN ROUTES ──────────────────────────────────────────────────────────────

app.use('/admin/auth', adminAuthRoutes);
app.use('/admin/api', adminRoutes);

// ── CLIENT AUTH ROUTES ────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/users', authRoutes);

// ── PAGE ROUTES ───────────────────────────────────────────────────────────────

// FIX: was incorrectly serving account.html — must serve settings.html
app.get('/settings', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'settings.html'));
});

// Account/billing page
app.get('/account', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'account.html'));
});

// Admin dashboard — auth handled client-side via /admin/auth/me
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'admin.html'));
});

// Client-facing redirects
app.get('/login',           (req, res) => res.redirect('/login.html'));
app.get('/register',        (req, res) => res.redirect('/register.html'));
app.get('/forgot-password', (req, res) => res.redirect('/forgot-password.html'));
app.get('/reset-password',  (req, res) => res.redirect('/reset-password.html'));
app.get('/user-management', (req, res) => res.redirect('/user-management.html'));

// Email verification
app.get('/verify-email', (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(400).send('Verification token is required');

    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>Email Verification - SyncStation</title>
    <style>
        body { font-family: sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:linear-gradient(135deg,#667eea,#764ba2); }
        .box { background:white; padding:40px; border-radius:12px; text-align:center; max-width:400px; }
        h1 { color:#2563eb; }
        .spinner { border:4px solid #f3f3f3; border-top:4px solid #2563eb; border-radius:50%; width:40px; height:40px; animation:spin 1s linear infinite; margin:20px auto; }
        @keyframes spin { to { transform:rotate(360deg); } }
        a { display:inline-block; margin-top:20px; padding:12px 30px; background:#2563eb; color:white; text-decoration:none; border-radius:8px; font-weight:600; }
        p { color:#6b7280; }
    </style>
</head>
<body>
    <div class="box">
        <h1>SyncStation</h1>
        <div class="spinner"></div>
        <p>Verifying your email...</p>
    </div>
    <script>
        fetch('/api/auth/verify-email/${token}')
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    document.querySelector('.box').innerHTML =
                        '<div style="font-size:64px;color:#10b981">✅</div>' +
                        '<h1>Email Verified!</h1>' +
                        '<p>Your email has been verified. You can now log in.</p>' +
                        '<a href="/login">Go to Login</a>';
                } else {
                    throw new Error(data.error || 'Verification failed');
                }
            })
            .catch(err => {
                document.querySelector('.box').innerHTML =
                    '<div style="font-size:64px;color:#ef4444">❌</div>' +
                    '<h1>Verification Failed</h1>' +
                    '<p>' + err.message + '</p>' +
                    '<a href="/login">Go to Login</a>';
            });
    </script>
</body>
</html>`);
});

// ── EXISTING SYNCSTATION API ROUTES ──────────────────────────────────────────

app.post('/webhooks/receive', (req, res) => {
    console.log('Webhook received:', req.body);
    res.status(200).send('OK');
});

app.get('/api/account/tier', async (req, res) => {
    try {
        const portalId = req.query.portal_id;
        if (!portalId) return res.status(400).json({ error: 'portal_id is required' });
        const result = await pool.query('SELECT tier FROM portals WHERE portal_id = $1', [portalId]);
        if (!result.rows.length) return res.status(404).json({ error: 'Portal not found' });
        res.json({ tier: result.rows[0].tier });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── HEALTH & ROOT ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), app: 'SyncStation' });
});

app.get('/', (req, res) => res.redirect('/login'));

// ── ERROR HANDLING ────────────────────────────────────────────────────────────

app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.path });
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ── START ─────────────────────────────────────────────────────────────────────

async function startServer() {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0].now);
    } catch (err) {
        console.error('⚠️  Database connection error:', err.message);
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 SyncStation running on port ${PORT}`);
        console.log(`🔐 Login:       https://portal.syncstation.app/login`);
        console.log(`⚙️  Settings:    https://portal.syncstation.app/settings`);
        console.log(`🔧 Admin Login: https://portal.syncstation.app/admin/auth/login\n`);
    });
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));

startServer();
module.exports = app;
