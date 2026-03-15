require('dotenv').config();
const webhookManager = require('../src/services/webhookManager');
const tokenStore     = require('../src/services/tokenStore');
const { getRules }   = require('../src/routes/settings');

async function main() {
  console.log('Syncing webhook subscriptions...');

  const allTokens = await tokenStore.getAll();
  const portalIds = Object.keys(allTokens);

  if (portalIds.length === 0) {
    console.log('No installed portals found. Please install the app first.');
    process.exit(1);
  }

  const allRules = {};
  for (const portalId of portalIds) {
    const rules = await getRules(portalId);
    allRules[portalId] = rules;
    console.log(`Portal ${portalId}: ${rules.length} rules found`);
    rules.forEach(r => console.log(`  - ${r.name} (${r.enabled ? 'active' : 'disabled'}): ${r.mappings?.length || 0} mappings`));
  }

  await webhookManager.syncSubscriptions(allRules);
  console.log('Done!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
