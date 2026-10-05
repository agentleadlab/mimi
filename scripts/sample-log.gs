/**
 * Mimi → "Sample Log" tab.
 *
 * Paste this into your Ad_Sample_Library sheet (Extensions → Apps Script),
 * set SECRET below, then Deploy → New deployment → Web app
 * (Execute as: Me, Who has access: Anyone). Give the web app URL and the
 * secret to Mimi as SAMPLES_LOG_URL and SAMPLES_LOG_SECRET.
 */

// Any long random text. Must match SAMPLES_LOG_SECRET in Railway.
const SECRET = "PASTE-YOUR-SECRET-HERE";

const TAB = "Sample Log";
const HEADERS = [
  "Link ID",
  "Requested",
  "Sample",
  "Lead Type",
  "Client",
  "Requested By",
  "Status",
  "First Watched",
  "Watch Count",
  "Viewing Ends",
];

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: "bad json" });
  }
  if (data.secret !== SECRET) return reply({ ok: false, error: "unauthorized" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = logSheet();
    if (data.event === "created") {
      sheet.appendRow([
        data.id,
        new Date(data.createdAt),
        data.sample,
        data.leadType,
        data.client || "",
        data.requestedBy || "",
        "Sent",
        "",
        0,
        "",
      ]);
    } else if (data.event === "opened") {
      const row = findRow(sheet, data.id);
      if (row) {
        sheet.getRange(row, 7, 1, 4).setValues([[
          "Watched",
          new Date(data.firstOpenedAt),
          data.opens,
          new Date(data.endsAt),
        ]]);
      }
    }
    return reply({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function logSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TAB);
  if (!sheet) {
    sheet = ss.insertSheet(TAB);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#1f3a5f").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    sheet.getRange("B:B").setNumberFormat("mmm d, yyyy h:mm am/pm");
    sheet.getRange("H:H").setNumberFormat("mmm d, yyyy h:mm am/pm");
    sheet.getRange("J:J").setNumberFormat("mmm d, yyyy h:mm am/pm");
  }
  return sheet;
}

function findRow(sheet, id) {
  const match = sheet.getRange("A:A").createTextFinder(id).matchEntireCell(true).findNext();
  return match ? match.getRow() : null;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to create the tab and check everything works. */
function setup() {
  logSheet();
}
