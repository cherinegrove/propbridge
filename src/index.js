// ADD TO src/index.js

// At the top with other requires:
const { runPollingCycle, initPollingTable } = require('./services/pollingService');

// After the existing startup code, add this:

// Initialize polling table
(async () => {
  await initPollingTable();
})();

// Run polling every 15 minutes for Leads and Projects
const POLLING_INTERVAL = 15 * 60 * 1000; // 15 minutes in milliseconds

console.log(`[Polling] Scheduler starting - will poll every 15 minutes`);

// Run first poll after 2 minutes (give app time to fully start)
setTimeout(() => {
  runPollingCycle();
}, 2 * 60 * 1000);

// Then run every 15 minutes
setInterval(() => {
  runPollingCycle();
}, POLLING_INTERVAL);
