// src/services/pollingService.js
const { getClient } = require('./hubspotClient');
const { sync } = require('./syncService');
const pool = require('../db');

// Track last sync time per portal
async function getLastSyncTime(portalId, objectType) {
  try {
    const result = await pool.query(
      'SELECT last_sync_time FROM polling_sync_times WHERE portal_id = $1 AND object_type = $2',
      [portalId, objectType]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0].last_sync_time;
    }
    
    // Default to 24 hours ago if no previous sync
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);
    return yesterday.toISOString();
  } catch (err) {
    console.error(`[Polling] Error getting last sync time:`, err.message);
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);
    return yesterday.toISOString();
  }
}

async function setLastSyncTime(portalId, objectType) {
  const now = new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO polling_sync_times (portal_id, object_type, last_sync_time, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (portal_id, object_type) 
       DO UPDATE SET last_sync_time = $3, updated_at = NOW()`,
      [portalId, objectType, now]
    );
  } catch (err) {
    console.error(`[Polling] Error setting last sync time:`, err.message);
  }
}

// Get all portals that have active sync rules for Leads or Projects
async function getPortalsWithPollingRules() {
  try {
    const result = await pool.query(
      `SELECT DISTINCT portal_id 
       FROM sync_rules 
       WHERE enabled = true 
         AND (source_object IN ('leads', 'projects') 
           OR target_object IN ('leads', 'projects'))`
    );
    return result.rows.map(r => r.portal_id);
  } catch (err) {
    console.error('[Polling] Error getting portals:', err.message);
    return [];
  }
}

// Get sync rules for a specific portal and object type
async function getSyncRulesForPolling(portalId, objectType) {
  try {
    const result = await pool.query(
      `SELECT * FROM sync_rules 
       WHERE portal_id = $1 
         AND enabled = true 
         AND (source_object = $2 OR (target_object = $2 AND direction = 'two_way'))
       ORDER BY created_at`,
      [portalId, objectType]
    );
    
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      sourceObject: row.source_object,
      targetObject: row.target_object,
      direction: row.direction,
      mappings: row.mappings,
      skipIfHasValue: row.skip_if_has_value,
      assocRule: row.assoc_rule,
      assocLabel: row.assoc_label,
      enabled: row.enabled
    }));
  } catch (err) {
    console.error('[Polling] Error getting sync rules:', err.message);
    return [];
  }
}

// Fetch changed records since last sync
async function getChangedRecords(client, objectType, sinceTime) {
  try {
    const response = await client.crm.objects.basicApi.getPage(
      objectType,
      undefined, // limit - use default
      undefined, // after - pagination
      undefined, // properties - get all
      undefined, // propertiesWithHistory
      undefined, // associations
      false // archived
    );
    
    const allRecords = response.results || [];
    
    // Filter to only records modified since last sync
    const changedRecords = allRecords.filter(record => {
      const lastModified = record.properties.hs_lastmodifieddate;
      return lastModified && new Date(lastModified) > new Date(sinceTime);
    });
    
    console.log(`[Polling] Found ${changedRecords.length} changed ${objectType} records (out of ${allRecords.length} total)`);
    return changedRecords;
    
  } catch (err) {
    console.error(`[Polling] Error fetching ${objectType}:`, err.message);
    return [];
  }
}

// Poll and sync a specific object type for a portal
async function pollObjectType(portalId, objectType) {
  console.log(`[Polling] Starting poll for ${objectType} in portal ${portalId}`);
  
  try {
    const client = await getClient(portalId);
    const rules = await getSyncRulesForPolling(portalId, objectType);
    
    if (rules.length === 0) {
      console.log(`[Polling] No active rules for ${objectType} in portal ${portalId}`);
      return { synced: 0, errors: 0 };
    }
    
    const lastSync = await getLastSyncTime(portalId, objectType);
    console.log(`[Polling] Checking ${objectType} modified since ${lastSync}`);
    
    const changedRecords = await getChangedRecords(client, objectType, lastSync);
    
    let syncedCount = 0;
    let errorCount = 0;
    
    // Process each changed record
    for (const record of changedRecords) {
      const recordId = record.id;
      
      // Apply all matching sync rules
      for (const rule of rules) {
        try {
          let sourceObjectType = rule.sourceObject;
          let sourceId = recordId;
          let targetObjectType = rule.targetObject;
          
          // If this is a two-way rule and the record is the target object
          if (rule.direction === 'two_way' && rule.targetObject === objectType) {
            sourceObjectType = rule.targetObject;
            targetObjectType = rule.sourceObject;
          }
          
          const result = await sync(client, {
            sourceObjectType,
            sourceId,
            targetObjectType,
            direction: rule.direction,
            mappings: rule.mappings,
            skipIfHasValue: rule.skipIfHasValue === 'true',
            associationRule: rule.assocRule || 'all',
            associationLabel: rule.assocLabel || ''
          });
          
          if (result.status === 'success') {
            syncedCount += result.updated;
            console.log(`[Polling] Rule "${rule.name}" synced ${result.updated} record(s)`);
          }
          
          if (result.errors && result.errors.length > 0) {
            errorCount += result.errors.length;
          }
          
        } catch (err) {
          console.error(`[Polling] Rule "${rule.name}" failed:`, err.message);
          errorCount++;
        }
      }
    }
    
    // Update last sync time
    await setLastSyncTime(portalId, objectType);
    
    console.log(`[Polling] ${objectType} poll complete: ${syncedCount} synced, ${errorCount} errors`);
    return { synced: syncedCount, errors: errorCount };
    
  } catch (err) {
    console.error(`[Polling] Error polling ${objectType} for portal ${portalId}:`, err.message);
    return { synced: 0, errors: 1 };
  }
}

// Main polling function - runs every 15 minutes
async function runPollingCycle() {
  console.log('[Polling] ========== Starting polling cycle ==========');
  const startTime = Date.now();
  
  try {
    const portals = await getPortalsWithPollingRules();
    console.log(`[Polling] Found ${portals.length} portal(s) with polling rules`);
    
    let totalSynced = 0;
    let totalErrors = 0;
    
    for (const portalId of portals) {
      // Poll Leads
      const leadsResult = await pollObjectType(portalId, 'leads');
      totalSynced += leadsResult.synced;
      totalErrors += leadsResult.errors;
      
      // Poll Projects
      const projectsResult = await pollObjectType(portalId, 'projects');
      totalSynced += projectsResult.synced;
      totalErrors += projectsResult.errors;
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Polling] ========== Cycle complete in ${duration}s: ${totalSynced} synced, ${totalErrors} errors ==========`);
    
  } catch (err) {
    console.error('[Polling] Polling cycle error:', err.message);
  }
}

// Initialize polling sync times table
async function initPollingTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS polling_sync_times (
        portal_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        last_sync_time TIMESTAMP NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (portal_id, object_type)
      )
    `);
    console.log('[Polling] Table ready');
  } catch (err) {
    console.error('[Polling] Table init error:', err.message);
  }
}

module.exports = {
  runPollingCycle,
  initPollingTable
};
