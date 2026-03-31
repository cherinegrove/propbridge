# WEBHOOK HANDLER UPDATE

When calling the `sync()` function from webhooks.js, you need to pass the original rule's source and target objects so the sync service can reverse the mappings when needed.

## What to Change in webhooks.js

Find where you call the `sync()` function and add these two parameters:

```javascript
const result = await sync(client, {
  sourceObjectType: rule.sourceObject,
  sourceId: objectId,
  targetObjectType: rule.targetObject,
  direction: rule.direction,
  mappings: rule.mappings,
  skipIfHasValue: rule.skipIfHasValue === 'true',
  associationRule: rule.assocRule || 'all',
  associationLabel: rule.assocLabel || '',
  onWrite,
  // ADD THESE TWO LINES:
  ruleSourceObject: rule.sourceObject,  // ← NEW: Pass original rule source
  ruleTargetObject: rule.targetObject   // ← NEW: Pass original rule target
});
```

## Why This Works

When a Contact changes and the rule is defined as `leads → contacts`:
- `sourceObjectType` = contacts (what actually changed)
- `targetObjectType` = leads (what we're syncing to)
- `ruleSourceObject` = leads (rule's original source)
- `ruleTargetObject` = contacts (rule's original target)

The sync service detects it's syncing in reverse and flips the mappings:
- Rule mapping: `hs_lead_name` → `firstname`
- Effective mapping (reversed): `firstname` → `hs_lead_name` ✅
