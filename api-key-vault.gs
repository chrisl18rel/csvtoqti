// api-key-vault.gs
// Companion Google Apps Script for Batch Genie (index.html)
// Uses PropertiesService — no Google Sheet required.
//
// v7.1 SECURITY UPDATE — WHAT CHANGED:
//   • The API key is NEVER returned without the correct password. The old
//     doGet(?action=get) endpoint handed the key to anyone who had the URL,
//     and the URL is public in the GitHub repo.
//   • All actions now use POST with a JSON body, so the password no longer
//     travels in a URL query string (URLs get written to server logs).
//   • doGet() no longer returns anything sensitive.
//
// SETUP:
// 1. Paste this code over the old code -> Save
// 2. Run saveKeyManually() once to store your NEW Anthropic API key
//    (rotate the old key — it was publicly retrievable)
// 3. Run savePassword() once if you want to change the settings password
// 4. Deploy -> Manage deployments -> Edit (pencil) -> Version: New version -> Deploy
//      Execute as:      Me
//      Who has access:  Anyone
// 5. The Web App URL is already hardcoded in index.html — it does not change
//    when you deploy a new version of an existing deployment.

var PROP_KEY      = 'anthropic_api_key';
var PROP_PASSWORD = 'settings_password';
var PROP_MODEL    = 'active_model';

// ── Run once to store your API key ──────────────────────────────────────────
function saveKeyManually() {
  var key = 'PASTE_YOUR_KEY_HERE';  // replace with your sk-ant-... key, then run
  PropertiesService.getScriptProperties().setProperty(PROP_KEY, key);
  Logger.log('API key saved.');
}

// ── Run once to set your settings password ──────────────────────────────────
function savePassword() {
  var password = 'PASTE_YOUR_PASSWORD_HERE';  // replace with your chosen password, then run
  PropertiesService.getScriptProperties().setProperty(PROP_PASSWORD, password);
  Logger.log('Password saved.');
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Length-safe comparison that doesn't short-circuit on the first differing
// character, so response time doesn't leak how much of the password matched.
function pwMatches(supplied, actual) {
  if (!supplied || !actual || supplied.length !== actual.length) return false;
  var diff = 0;
  for (var i = 0; i < actual.length; i++) {
    diff |= supplied.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}

// ── POST endpoint — every action requires the password ──────────────────────
function doPost(e) {
  var props = PropertiesService.getScriptProperties();

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ success: false, error: 'Bad request body' });
  }

  var action = body.action || '';
  var pw     = String(body.pw || '');
  var actual = props.getProperty(PROP_PASSWORD) || '';

  if (!actual) {
    return jsonOut({ success: false, error: 'Vault not configured — run savePassword() in the Apps Script editor.' });
  }

  if (!pwMatches(pw, actual)) {
    Utilities.sleep(500);  // slow down brute-force attempts
    return jsonOut({ success: false, error: 'Incorrect password' });
  }

  if (action === 'get') {
    return jsonOut({
      success: true,
      key:   props.getProperty(PROP_KEY) || '',
      model: props.getProperty(PROP_MODEL) || ''
    });
  }

  if (action === 'checkPassword') {
    return jsonOut({ success: true, valid: true });
  }

  if (action === 'saveModel') {
    if (body.model) props.setProperty(PROP_MODEL, String(body.model));
    return jsonOut({ success: true });
  }

  return jsonOut({ success: false, error: 'Unknown action' });
}

// ── GET endpoint — intentionally returns nothing sensitive ──────────────────
function doGet(e) {
  return jsonOut({
    success: false,
    error: 'This vault requires an authenticated POST. Update to Batch Genie v7.1 or later.'
  });
}
