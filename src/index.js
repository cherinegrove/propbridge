// src/index.js
require('dotenv').config();
const express = require('express');
const path    = require('path');
const app     = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/oauth',    require('./routes/oauth'));
app.use('/action',   require('./routes/action'));
app.use('/settings', require('./routes/settings'));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
const BASE  = process.env.APP_BASE_URL || 'http://localhost:' + PORT;

app.listen(PORT, () => {
  console.log(`🚀  HubSpot Sync App running on port ${PORT}`);
  console.log(`    Install URL:  ${BASE}/oauth/install`);
  console.log(`    Settings URL: ${BASE}/settings`);
});
