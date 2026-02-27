// src/services/syncService.js
// Core property sync logic

async function sync(client, {
  sourceObjectType,
  sourceId,
  targetObjectType,
  direction,
  mappings,
  skipIfHasValue,
  associationRule,
  associationLabel
}) {
  // 1. Get source record properties
  const srcPropNames = mappings.map(m => m.source);
  const sourceRecord = await client.crm[sourceObjectType]?.basicApi?.getById(sourceId, srcPropNames)
    || await client.crm.objects.basicApi.getById(sourceObjectType, sourceId, srcPropNames);

  const sourceProps = sourceRecord.properties || {};

  // 2. Get associated target records
  const assocResponse = await client.crm.associations.v4.basicApi.getPage(
    sourceObjectType, sourceId, targetObjectType
  );

  let targets = assocResponse?.results || [];

  // 3. Apply association rule
  if (associationRule === "first") {
    targets = targets.slice(0, 1);
  } else if (associationRule === "recent") {
    targets = targets.slice(-1);
  } else if (associationRule === "labeled" && associationLabel) {
    targets = targets.filter(t =>
      t.associationTypes?.some(a =>
        a.label?.toLowerCase() === associationLabel.toLowerCase()
      )
    );
  }
  // "all" — use all targets as-is

  if (targets.length === 0) {
    return { status: "no_targets", updated: 0, targets: [] };
  }

  // 4. Sync properties to each target
  const results = [];
  let updatedCount = 0;

  for (const target of targets) {
    const targetId = target.toObjectId || target.id;

    try {
      // Get target properties if needed for bidirectional or skip check
      let targetProps = {};
      if (direction === "two_way" || skipIfHasValue) {
        const tgtPropNames = mappings.map(m => m.target);
        const targetRecord = await client.crm.objects.basicApi.getById(
          targetObjectType, targetId, tgtPropNames
        );
        targetProps = targetRecord.properties || {};
      }

      // Build properties to update
      const propsToUpdate = {};

      for (const mapping of mappings) {
        const srcVal = sourceProps[mapping.source];
        const tgtVal = targetProps[mapping.target];

        if (direction === "two_way") {
          // Most recent wins — compare updatedAt or just use source if no target value
          if (!tgtVal || srcVal) {
            propsToUpdate[mapping.target] = srcVal || "";
          }
        } else {
          // One-way: source → target
          if (skipIfHasValue && tgtVal) {
            continue; // skip this property
          }
          propsToUpdate[mapping.target] = srcVal || "";
        }
      }

      if (Object.keys(propsToUpdate).length > 0) {
        await client.crm.objects.basicApi.update(targetObjectType, targetId, {
          properties: propsToUpdate
        });
        updatedCount++;
        results.push({ id: targetId, status: "updated", properties: Object.keys(propsToUpdate) });
      } else {
        results.push({ id: targetId, status: "skipped" });
      }
    } catch (err) {
      console.error("[Sync] Failed for target", targetId, err.message);
      results.push({ id: targetId, status: "error", error: err.message });
    }
  }

  return {
    status:  updatedCount > 0 ? "success" : "no_updates",
    updated: updatedCount,
    targets: results
  };
}

module.exports = { sync };
