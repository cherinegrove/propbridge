<!-- ============================================================
     HUBSPOT INSTALL BANNER
     Add this HTML right after the opening <div class="main"> tag
     in src/public/settings.html
     ============================================================ -->

<!-- Not-connected banner — hidden by default, shown via JS -->
<div id="hubspotConnectBanner" style="display:none;background:linear-gradient(135deg,rgba(255,107,53,0.12),rgba(255,179,71,0.08));border:1px solid rgba(255,107,53,0.4);border-radius:12px;padding:20px 24px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap">
  <div style="display:flex;align-items:center;gap:14px">
    <div style="font-size:32px;flex-shrink:0">🔌</div>
    <div>
      <div style="font-weight:600;font-size:15px;margin-bottom:4px">HubSpot not connected</div>
      <div style="color:var(--muted);font-size:13px">Install the SyncStation app to your HubSpot portal to start syncing properties.</div>
    </div>
  </div>
  <a href="/oauth/install" style="background:var(--accent);color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;white-space:nowrap;flex-shrink:0">
    🔗 Connect to HubSpot
  </a>
</div>


<!-- ============================================================
     INSTALL BUTTON near "Add sync rule" button
     Replace the existing btn-add button with this version
     that includes the install button alongside it.
     
     Find this line in settings.html:
       <button class="btn-add" onclick="openModal()">
     
     Replace the entire btn-add button AND add the install button:
     ============================================================ -->

<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
  <button class="btn-add" onclick="openModal()" style="flex:1;min-width:200px">
    <span style="font-size:18px">+</span> Add sync rule
  </button>
  <a href="/oauth/install" id="installHubspotBtn" style="display:none;padding:12px 20px;background:var(--surface);border:2px dashed rgba(255,107,53,0.5);border-radius:var(--radius);color:var(--accent);text-decoration:none;font-size:14px;white-space:nowrap;transition:all 0.2s">
    🔗 Install to HubSpot
  </a>
</div>


<!-- ============================================================
     JAVASCRIPT — Add this inside the <script> tag in settings.html
     Paste it right after the line:  loadNotifications();
     ============================================================ -->
<script>
// Check if HubSpot is connected and show banner/button if not
async function checkHubSpotConnection() {
  try {
    const res  = await fetch('/settings/tier?portalId=' + portalId);
    const data = await res.json();

    // If tier fetch fails or returns no token indicator, check directly
    const tokenRes  = await fetch('/api/portal/connected?portalId=' + portalId);
    const tokenData = await tokenRes.json();

    if (!tokenData.connected) {
      // Show the top banner
      const banner = document.getElementById('hubspotConnectBanner');
      if (banner) banner.style.display = 'flex';

      // Show the install button next to "Add sync rule"
      const btn = document.getElementById('installHubspotBtn');
      if (btn) btn.style.display = 'block';
    }
  } catch (e) {
    // Silently fail — don't block the page if this check errors
  }
}

checkHubSpotConnection();
</script>
