// src/services/tokenStore.js
// Simple in-memory token store
const store = {};

module.exports = {
  get:    (portalId) => store[portalId],
  set:    (portalId, tokens) => { store[portalId] = { ...tokens, savedAt: Date.now() }; },
  delete: (portalId) => { delete store[portalId]; },
  getAll: () => ({ ...store })
};
