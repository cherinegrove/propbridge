// =====================================================
// PROPBRIDGE MAIN SERVER
// With User Authentication & Management
// =====================================================

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

// Database connection
const pool = require('./src/services/database');

// Routes
const authRoutes = require('./src/routes/authRoutes');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Parse cookies
app.use(cookieParser());

// Serve static files from public directory
app.use(express.static('public'));

// CORS (if needed for development)
if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        next();
    });
}

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ==================== AUTHENTICATION ROUTES ====================

// User authentication and management
app.use('/api/auth', authRoutes);
app.use('/api/users', authRoutes);

// ==================== YOUR EXISTING PROPBRIDGE ROUTES ====================
// Add your existing routes here:

// Example: HubSpot OAuth callback
// app.get('/oauth/callback', async (req, res) => {
//     // Your existing OAuth code
// });

// Example: Settings page
// app.get('/settings', async (req, res) => {
//     // Your existing settings code
// });

// Example: Sync rules API
// app.get('/api/sync-rules/:portalId', async (req, res) => {
//     // Your existing sync rules code
// });

// Example: Admin portal
// app.get('/admin', async (req, res) => {
//     // Your existing admin code
// });

// ==================== FRONTEND ROUTES ====================

// Login page (public)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Registration page (public)
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Forgot password page (public)
app.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'forgot-password.html'));
});

// Reset password page (public)
app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

// User management page (protected - add auth middleware later)
app.get('/user-management', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user-management.html'));
});

// ==================== HEALTH CHECK ====================

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ==================== DATABASE CONNECTION TEST ====================

// Test database connection on startup
async function testDatabaseConnection() {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', result.rows[0].now);
    } catch (error) {
        console.error('❌ Database connection error:', error);
        process.exit(1);
    }
}

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not Found',
        path: req.path,
        message: 'The requested resource does not exist'
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// ==================== START SERVER ====================

async function startServer() {
    try {
        // Test database connection
        await testDatabaseConnection();
        
        // Start listening
        app.listen(PORT, '0.0.0.0', () => {
            console.log('');
            console.log('🚀 PropBridge Server Started!');
            console.log('================================');
            console.log(`📡 Server: http://localhost:${PORT}`);
            console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔐 Login: http://localhost:${PORT}/login`);
            console.log(`👥 User Mgmt: http://localhost:${PORT}/user-management`);
            console.log('================================');
            console.log('');
        });
        
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, closing server...');
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
