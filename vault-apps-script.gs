// vault-apps-script.gs
//
// Batch Genie key vault — Google Apps Script (v7.1 SECURITY UPDATE)
//
// WHAT CHANGED vs the old vault:
//   • The API key is NEVER returned without the correct password. The old
//     ?action=get GET endpoint gave the key to anyone who had the URL.
//   • All actions now use POST with a JSON body — the password no longer
//     travels in a URL query string (URLs get logged; POST bodies don't).
//
// SETUP (one time):
//   1. In the Apps Script editor, open Project Settings → Script Properties
//      and confirm/add these two properties:
//         ANTHROPIC_API_KEY  = your NEW Anthropic API key (rotate the old one —
//                              it was publicly exposed and must be treated as
//                              compromised)
//         SETTINGS_PASSWORD  = the password you'll type into the ⚙ settings
//                              modal on the site
//      (Or run saveKeyManually() below after filling in the values.)
//   2. Deploy → Manage deployments → Edit → New version → Deploy.
//      Keep "Execute as: Me" and "Who has access: Anyone".
//   3. The web page (index.html) already points at this deployment URL.

var PROP_KEY   = 'ANTHROPIC_API_KEY';
var PROP_PW    = 'SETTINGS_PASSWORD';
var PROP_MODEL = 'ACTIVE_MODEL';

// One-time helper: fill in the values, run it from the editor, then blank
// the values back out so they are not stored in the code.
function saveKeyManually() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_KEY, 'PASTE-NEW-API-KEY-HERE');
  props.setProperty(PROP_PW,  'PASTE-SETTINGS-PASSWORD-HERE');
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Constant-ish time comparison to avoid trivial timing attacks
function pwMatches(supplied, actual) {
  if (!supplied || !actual || supplied.length !== actual.length) return false;
  var diff = 0;
  for (var i = 0; i < actual.length; i++) {
    diff |= supplied.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}

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
  var actual = props.getProperty(PROP_PW) || '';

  if (!actual) {
    return jsonOut({ success: false, error: 'Vault not configured — set SETTINGS_PASSWORD in Script Properties.' });
  }
  if (!pwMatches(pw, actual)) {
    // Small delay to slow down brute-force attempts
    Utilities.sleep(500);
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

// Legacy GET endpoint — intentionally returns nothing sensitive anymore.
function doGet(e) {
  return jsonOut({
    success: false,
    error: 'This vault requires an authenticated POST. Update to Batch Genie v7.1 or later.'
  });
}
