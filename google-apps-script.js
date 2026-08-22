// ================================================================
// AGRI-PROCUREMENT & LEDGER PWA - Google Apps Script (Version 1)
// ================================================================
// WHAT CHANGED FROM v8:
//  - The system-assigned "Slip No" (e.g. AGRI-2026-000001) has been
//    completely removed. It is no longer generated, stored, read, or
//    returned by this script. "Weighment Slip No" is now the ONLY
//    identifier for a procurement record.
// WHAT CHANGED FROM v7:
//  - Procurement (Direct/Contract) no longer collects an Advance.
//    Only Total Amount is calculated at entry time; the record's
//    "Balance (₹)" column is now the record's Outstanding Balance
//    (= Total, since no advance is taken at entry). The physical
//    "Advance (₹)" sheet column is KEPT for backward compatibility
//    (so existing spreadsheets are never re-shaped/re-ordered) but is
//    always written as 0 going forward.
//  - ALL payments are now recorded ONLY via "Record Payment" (Farmers
//    section). The Payments sheet gains 5 new columns: Payment Method,
//    Paid To, Mobile Number, Reference Number, Remarks. Every payment
//    is stored exactly as entered.
//  - New mandatory "Weighment Slip No" column on procurement records.
//  - Land Owner Name is stored ONLY as an informational column. It is
//    NEVER combined with the farmer name to form a new identity —
//    every balance/payment/report groups strictly by Farmer Name.
//  - Manual Expense date is now whatever the user picks in the app
//    (time remains automatic); the field was already generic on the
//    backend, this is really a front-end change.
//  - Direct / Contract DISPLAY LABELS are swapped everywhere they are
//    shown to a person (app UI text, the "Type" value written into
//    Sheets, CSV/report exports, Monthly Summary headers). The
//    UNDERLYING type key (rec.type = 'contract' | 'direct'), rate
//    logic, sheet targets ("Contract Cane" / "Direct Farmer"), and all
//    IDs/synchronization are 100% unchanged — only the human-readable
//    word is swapped.
//  - Cash Book's automatic "Procurement Payment" entries are now
//    created from actual farmer payments (savePayment) instead of the
//    old procurement Advance field (which no longer exists).
// ================================================================
// SETUP STEPS (do this FRESH — delete old deployment):
// 1. Open Google Sheet → Extensions → Apps Script
// 2. Delete ALL old code → paste this entire file → Save (Ctrl+S)
// 3. Deploy → New deployment → Gear icon → Web app
// 4. Execute as: Me | Who has access: Anyone
// 5. Click Deploy → Authorize → Advanced → Go to app → Allow
// 6. Copy the new /exec URL → paste in app Settings → Webhook
// ================================================================

var RECORD_HEADERS = [
  'ID','Weighment Slip No','Type','Date','Farmer Name',
  'Land Owner Name',
  'Village','Mobile','Vehicle',
  'Gross Wt (Kg)','Tare Wt (Kg)','Deduction %',
  'Cane Wt (Kg)','Ded Amt (Kg)','Net Cane (Kg)','Net Ton',
  'Cane Rate','Harvest Rate','Transport Rate',
  'Cane Amt (₹)','Harvest Amt (₹)','Transport Amt (₹)',
  'Total (₹)','Advance (₹)','Balance (₹)','Updated At'
];
var FARMER_HEADERS   = ['ID','Name','Village','Mobile','Current Outstanding Balance (₹)'];
var SETTINGS_HEADERS = ['Key','Value'];
var PAYMENT_HEADERS  = [
  'ID','Farmer','Amount (₹)','Balance Before (₹)','Remaining Balance (₹)','Date','Time',
  'Payment Method','Paid To','Mobile Number','Reference Number','Remarks','Updated At'
];
var CASHBOOK_HEADERS = ['ID','Date','Time','Transaction Type','Item Name','Amount (₹)','Paid To / Farmer','Remarks','Procurement ID','Updated At'];
var DEFAULT_SETTINGS = { cr: 2900, dr: 3500, hr: 350, tr: 250 };

// ── ENTRY POINTS ────────────────────────────────────────────────
function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var req = parseRequest(e);
    var action = req.action;
    var payload = req.payload || {};

    var result;
    switch (action) {
      case 'getAll':        result = { success: true }; break;
      case 'saveRecord':    saveRecord(ss, payload);     result = { success: true }; break;
      case 'deleteRecord':  deleteRecord(ss, payload);   result = { success: true }; break;
      case 'saveFarmer':    saveFarmer(ss, payload);     result = { success: true }; break;
      case 'deleteFarmer':  deleteFarmer(ss, payload);   result = { success: true }; break;
      case 'savePayment':   savePayment(ss, payload);    result = { success: true }; break;
      case 'saveExpense':   saveExpense(ss, payload);    result = { success: true }; break;
      case 'deleteExpense': deleteExpense(ss, payload);  result = { success: true }; break;
      case 'saveSettings':  saveSettings(ss, payload);   result = { success: true }; break;
      case 'legacyAppend':  legacyAppend(ss, payload);    result = { success: true }; break;
      case 'ping':          return jsonOut({ status: 'Agri-Procurement Script v1 running OK', success: true });
      default:              return jsonOut({ success: false, error: 'Unknown action: ' + action });
    }

    // Always return a fresh full snapshot so every device re-syncs
    // to the exact same data after ANY change.
    var snapshot = buildSnapshot(ss);
    result.records  = snapshot.records;
    result.farmers  = snapshot.farmers;
    result.payments = snapshot.payments;
    result.cashbook = snapshot.cashbook;
    result.settings = snapshot.settings;
    return jsonOut(result);

  } catch (err) {
    return jsonOut({ success: false, error: err.toString() });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function parseRequest(e) {
  // POST (preferred): JSON body {action, payload} sent as text/plain
  if (e && e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      if (body && body.action) return body;
    } catch (x) {}
  }
  // GET fallback: ?action=xxx&payload=<url-encoded-json>  (for quick testing)
  var p = (e && e.parameter) || {};
  var payload = {};
  if (p.payload) { try { payload = JSON.parse(p.payload); } catch (x) {} }
  return { action: p.action || (p.weighSlipNo ? 'legacyAppend' : 'ping'), payload: (p.payload ? payload : p) };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── SHEET HELPERS ───────────────────────────────────────────────
function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  ensureHeaders(sheet, headers);
  return sheet;
}

// Writes headers if missing, and self-migrates old sheets that don't
// have the new "ID" column yet by inserting one and back-filling IDs.
function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    writeHeaderRow(sheet, headers);
    return;
  }
  var firstHeader = sheet.getRange(1, 1, 1, 1).getValue();
  if (firstHeader === headers[0]) {
    fixBilingualHeaderText(sheet, headers);
    migrateMissingColumns(sheet, headers);
    return; // already correct base schema
  }

  if (firstHeader !== 'ID' && headers[0] === 'ID' && firstHeader !== '') {
    // Old schema without ID column -> insert ID column at the front
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1).setValue('ID');
    var lastRow = sheet.getLastRow();
    for (var r = 2; r <= lastRow; r++) {
      var idCell = sheet.getRange(r, 1);
      if (!idCell.getValue()) idCell.setValue('legacy-' + r + '-' + Date.now());
    }
    styleHeader(sheet, headers.length);
  } else if (firstHeader === '') {
    writeHeaderRow(sheet, headers);
  }
  migrateMissingColumns(sheet, headers);
}

// Old sheets may still have a header cell written as "English / ಕನ್ನಡ"
// (e.g. "Land Owner Name / ಜಮೀನಿನ ಮಾಲೀಕರ ಹೆಸರು") from earlier versions.
// This rewrites any such cell to plain English-only text — matched by
// the part before " / " — WITHOUT touching column position, data, or
// any other header, so no formulas/columns are re-shaped.
function fixBilingualHeaderText(sheet, headers) {
  var lastCol = Math.min(sheet.getLastColumn(), headers.length);
  if (lastCol < 1) return;
  var existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var changed = false;
  for (var i = 0; i < existing.length; i++) {
    var cell = String(existing[i] || '');
    if (cell.indexOf(' / ') === -1) continue;
    var englishPart = cell.split(' / ')[0].trim();
    // Only rewrite if this cell's English portion matches a known header
    // (so we never touch a coincidental " / " in unrelated data).
    if (headers.indexOf(englishPart) !== -1 && cell !== englishPart) {
      sheet.getRange(1, i + 1).setValue(englishPart);
      changed = true;
    }
  }
  if (changed) styleHeader(sheet, lastCol);
}

// Self-migrates an existing sheet (e.g. an older Records sheet missing
// the Weighment Slip No column, or an older Payments sheet missing the
// new payment-method columns) by inserting any missing header at its
// correct position and back-filling existing rows with '-'.
function migrateMissingColumns(sheet, headers) {
  for (var i = 0; i < headers.length; i++) {
    var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (existing.indexOf(headers[i]) === -1) {
      var insertAt = Math.min(i + 1, sheet.getLastColumn() + 1);
      sheet.insertColumnBefore(insertAt);
      sheet.getRange(1, insertAt).setValue(headers[i]);
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        var fill = [];
        for (var r = 2; r <= lastRow; r++) fill.push(['-']);
        sheet.getRange(2, insertAt, lastRow - 1, 1).setValues(fill);
      }
      styleHeader(sheet, sheet.getLastColumn());
    }
  }
}

function writeHeaderRow(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleHeader(sheet, headers.length);
  sheet.setFrozenRows(1);
}

function styleHeader(sheet, numCols) {
  var r = sheet.getRange(1, 1, 1, numCols);
  r.setBackground('#7B3F00');
  r.setFontColor('#FFFFFF');
  r.setFontWeight('bold');
  try { sheet.autoResizeColumns(1, numCols); } catch (x) {}
}

function findRowById(sheet, id) {
  if (sheet.getLastRow() < 2) return -1;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // 1-indexed row
  }
  return -1;
}

// ── Date-only normalization ────────────────────────────────────
// Dates are always stored and transmitted as plain 'yyyy-MM-dd'
// calendar-day strings — never as JS Date objects and never via
// toISOString()/UTC conversion. If a Sheet cell was auto-formatted as
// a Date by Google Sheets (this can happen even though the app always
// WRITES a plain string), reading it back with getValue() returns a
// JS Date object. If that object were sent to the client as-is, it
// would be JSON-serialized via Date.prototype.toJSON(), which calls
// toISOString() and shifts the calendar day by the UTC offset (e.g.
// showing "2026-07-05T18:30:00.000Z" instead of the intended
// 2026-07-06). normDate() converts any such Date object back into the
// exact calendar-day string using the spreadsheet's own timezone, so
// the date displayed always exactly matches the date stored in the
// Sheet. Plain strings (the normal case) are returned unchanged.
function normDate(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
  }
  return v || '';
}

function sheetToObjects(sheet, headers, mapRow) {
  if (sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0]) continue; // skip blank rows
    out.push(mapRow(rows[i]));
  }
  return out;
}

// Swaps the DISPLAYED word only. The underlying rec.type key
// ('contract'|'direct') that drives rate logic, sheet targeting and
// synchronization never changes — only the human-readable label does.
function displayType(type) {
  return type === 'contract' ? 'Direct' : 'Contract';
}
function typeFromDisplay(label) {
  return label === 'Direct' ? 'contract' : 'direct';
}

// ── RECORDS ─────────────────────────────────────────────────────
function recordRow(rec) {
  return [
    rec.id,
    rec.weighSlipNo || '-',
    displayType(rec.type),
    rec.date || '',
    rec.farmerBase || rec.farmer || '',
    rec.landOwner || '-',
    rec.village || '',
    rec.mobile || '',
    rec.vehicle || '',
    Number(rec.gross) || 0,
    Number(rec.tare) || 0,
    Number(rec.deduction) || 0,
    Number(rec.caneWt) || 0,
    Number(rec.dedAmt) || 0,
    Number(rec.netCane) || 0,
    Number(rec.netTon) || 0,
    Number(rec.caneRate) || 0,
    Number(rec.harvestRate) || 0,
    Number(rec.transportRate) || 0,
    Number(rec.caneAmt) || 0,
    Number(rec.harAmt) || 0,
    Number(rec.traAmt) || 0,
    Number(rec.total) || 0,
    0, // Advance (₹) — kept for backward-compatible sheet shape; always 0 now
    Number(rec.total) || 0, // Balance (₹) = Outstanding Balance = Total (no advance taken at entry)
    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy HH:mm:ss')
  ];
}

function rowToRecord(row) {
  // Farmer identity is ALWAYS the farmer's own name — Land Owner Name is
  // stored purely as an informational column and is never combined into
  // a separate identity. Balances/payments/reports all group by this
  // plain farmer name.
  var farmerBase = row[4];
  var landOwner  = row[5];
  return {
    id: row[0],
    weighSlipNo: row[1] && row[1] !== '-' ? row[1] : '',
    type: typeFromDisplay(row[2]),
    date: normDate(row[3]),
    farmerBase: farmerBase,
    landOwner: landOwner || '-',
    farmer: farmerBase,
    village: row[6],
    mobile: row[7],
    vehicle: row[8],
    gross: Number(row[9]) || 0,
    tare: Number(row[10]) || 0,
    deduction: Number(row[11]) || 0,
    caneWt: Number(row[12]) || 0,
    dedAmt: Number(row[13]) || 0,
    netCane: Number(row[14]) || 0,
    netTon: Number(row[15]) || 0,
    caneRate: Number(row[16]) || 0,
    harvestRate: Number(row[17]) || 0,
    transportRate: Number(row[18]) || 0,
    caneAmt: Number(row[19]) || 0,
    harAmt: Number(row[20]) || 0,
    traAmt: Number(row[21]) || 0,
    total: Number(row[22]) || 0,
    advance: 0,
    balance: Number(row[24]) || 0, // Outstanding Balance for this procurement entry
    updatedAt: row[25],
    synced: true
  };
}

function saveRecord(ss, rec) {
  if (!rec || !(rec.farmerBase || rec.farmer)) throw new Error('Record missing farmer name');
  if (!rec.id) rec.id = 'r' + Date.now() + Math.floor(Math.random() * 1000);
  if (!rec.farmerBase) rec.farmerBase = rec.farmer; // backward compatible

  // Farmer identity = Farmer Name ONLY. Land Owner Name (if any) is kept
  // solely as an informational column — never grouped into balances.
  rec.farmer = rec.farmerBase;

  // No Advance is ever taken at procurement time. Only Total Amount and
  // Outstanding Balance (= Total) are calculated here.
  rec.advance = 0;
  rec.balance = Number(rec.total) || 0;

  var all = getOrCreateSheet(ss, 'All Records', RECORD_HEADERS);
  // Route by the CURRENTLY selected procurement mode as the user sees it
  // (displayType(rec.type)), not the raw internal key — the internal key
  // and its displayed label are intentionally swapped (see displayType()
  // above), so routing off the raw key alone sent every record to the
  // sheet opposite of what the user had selected. This is evaluated
  // fresh from rec.type on every call — never cached/reused across
  // requests — so it always reflects the mode active when Save was
  // pressed for THIS record.
  var typeSheet = getOrCreateSheet(ss, displayType(rec.type) === 'Direct' ? 'Direct Farmer' : 'Contract Cane', RECORD_HEADERS);
  var row = recordRow(rec);

  upsertRow(all, rec.id, row);
  upsertRow(typeSheet, rec.id, row);

  // keep farmer list in sync automatically (same behaviour as autoFarm() in the app)
  autoAddFarmer(ss, rec.farmer, rec.village, rec.mobile);

  rebuildMonthlySummary(ss);
  return rec;
}

function upsertRow(sheet, id, row) {
  var r = findRowById(sheet, id);
  if (r === -1) sheet.appendRow(row);
  else sheet.getRange(r, 1, 1, row.length).setValues([row]);
}

function deleteRecord(ss, payload) {
  var id = payload.id;
  if (!id) throw new Error('Missing id');
  ['All Records', 'Contract Cane', 'Direct Farmer'].forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var r = findRowById(sheet, id);
    if (r !== -1) sheet.deleteRow(r);
  });
  rebuildMonthlySummary(ss);
}

// ── FARMERS ─────────────────────────────────────────────────────
function saveFarmer(ss, f) {
  if (!f || !f.name) throw new Error('Farmer missing name');
  if (!f.id) f.id = 'f' + Date.now() + Math.floor(Math.random() * 1000);
  var sheet = getOrCreateSheet(ss, 'Farmers', FARMER_HEADERS);

  // de-dupe by name (case-insensitive), same rule the app used before
  var existing = sheetToObjects(sheet, FARMER_HEADERS, function (row) {
    return { id: row[0], name: row[1], village: row[2], mobile: row[3] };
  });
  var dup = existing.find(function (x) { return x.name.toLowerCase() === f.name.toLowerCase() && x.id !== f.id; });
  if (dup) { f.id = dup.id; } // merge into the existing farmer record

  upsertRow(sheet, f.id, [f.id, f.name, f.village || '', f.mobile || '', 0]);
  return f;
}

function autoAddFarmer(ss, name, village, mobile) {
  if (!name) return;
  var sheet = getOrCreateSheet(ss, 'Farmers', FARMER_HEADERS);
  var existing = sheetToObjects(sheet, FARMER_HEADERS, function (row) { return row[1]; });
  var already = existing.some(function (n) { return String(n).toLowerCase() === name.toLowerCase(); });
  if (!already) {
    var id = 'f' + Date.now() + Math.floor(Math.random() * 1000);
    sheet.appendRow([id, name, village || '', mobile || '', 0]);
  }
}

// Recomputes every farmer's "Current Outstanding Balance" from scratch and
// rewrites the Farmers sheet body — one row per unique Farmer Name.
// (Land Owner Name is never part of this identity — see rowToRecord.)
// Outstanding balance = Σ(Total) across that farmer's procurement
// records, minus Σ(Amount) across every payment recorded against them.
// This is called at the end of buildSnapshot() — i.e. after EVERY action
// (new/edited/deleted procurement entry or a payment recorded later) —
// so the Farmers sheet, the Farmers page and every procurement record's
// outstanding balance always reflect the same synchronized number.
// It also de-duplicates: if two rows ever exist for the same farmer name
// (case-insensitive), they're merged into a single row.
function rebuildFarmersSheet(ss) {
  var recSheet = ss.getSheetByName('All Records');
  var records = recSheet ? sheetToObjects(recSheet, RECORD_HEADERS, rowToRecord) : [];
  var paySheet = ss.getSheetByName('Payments');
  var payments = paySheet ? sheetToObjects(paySheet, PAYMENT_HEADERS, rowToPayment) : [];

  var farmSheet = getOrCreateSheet(ss, 'Farmers', FARMER_HEADERS);
  var existing = sheetToObjects(farmSheet, FARMER_HEADERS, function (row) {
    return { id: row[0], name: row[1], village: row[2], mobile: row[3] };
  });

  // Balance totals keyed by lowercase Farmer Name (case-insensitive identity).
  var totals = {};
  function bucket(name) {
    var key = String(name).toLowerCase();
    if (!totals[key]) totals[key] = { name: name, bal: 0 };
    return totals[key];
  }
  records.forEach(function (r) {
    if (!r.farmer) return;
    bucket(r.farmer).bal += (Number(r.total) || 0);
  });
  payments.forEach(function (p) {
    if (!p.farmer) return;
    bucket(p.farmer).bal -= Number(p.amount) || 0;
  });

  // Merge existing farmer profile rows, de-duping by lowercase name so the
  // sheet ends up with exactly one row per unique farmer identity.
  var merged = {};
  var order = [];
  existing.forEach(function (f) {
    if (!f.name) return;
    var key = String(f.name).toLowerCase();
    if (!merged[key]) {
      merged[key] = { id: f.id, name: f.name, village: f.village, mobile: f.mobile };
      order.push(key);
    }
    // else: duplicate row for the same farmer identity -> dropped on rewrite
  });
  // Any farmer identity seen in records/payments but with no profile row yet
  // (e.g. auto-added mid-request) gets one created here.
  Object.keys(totals).forEach(function (key) {
    if (!merged[key]) {
      merged[key] = {
        id: 'f' + Date.now() + Math.floor(Math.random() * 1000) + order.length,
        name: totals[key].name, village: '', mobile: ''
      };
      order.push(key);
    }
  });

  var rows = order.map(function (key) {
    var f = merged[key];
    var bal = totals[key] ? totals[key].bal : 0;
    return [f.id, f.name, f.village || '', f.mobile || '', Math.round(bal * 100) / 100];
  });

  if (farmSheet.getLastRow() > 1) farmSheet.deleteRows(2, farmSheet.getLastRow() - 1);
  if (rows.length) farmSheet.getRange(2, 1, rows.length, FARMER_HEADERS.length).setValues(rows);
}

// Deletes ONLY the farmer profile row. Procurement records, payment
// history and receipts for that farmer name are never touched.
function deleteFarmer(ss, payload) {
  var id = payload.id;
  if (!id) throw new Error('Missing id');
  var sheet = ss.getSheetByName('Farmers');
  if (!sheet) return;
  var r = findRowById(sheet, id);
  if (r !== -1) sheet.deleteRow(r);
}

// ── PAYMENTS ────────────────────────────────────────────────────
// A payment is recorded exactly as entered, with a Payment Method of
// Cash, UPI, or Online Transfer, each with its own required fields.
// Reference Number accepts letters, numbers and symbols (stored as-is).
function paymentRow(p) {
  return [
    p.id, p.farmer || '', Number(p.amount) || 0,
    Number(p.balanceBefore) || 0, Number(p.remaining) || 0,
    p.date || '', p.time || '',
    p.method || '', p.paidTo || '', p.mobile || '', p.refNo || '', p.remarks || '',
    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy HH:mm:ss')
  ];
}
function rowToPayment(row) {
  return {
    id: row[0], farmer: row[1], amount: Number(row[2]) || 0,
    balanceBefore: Number(row[3]) || 0, remaining: Number(row[4]) || 0,
    date: normDate(row[5]), time: row[6],
    method: row[7], paidTo: row[8], mobile: row[9], refNo: row[10], remarks: row[11],
    updatedAt: row[12], synced: true
  };
}
function savePayment(ss, p) {
  if (!p || !p.farmer) throw new Error('Payment missing farmer');
  if (!p.amount || Number(p.amount) <= 0) throw new Error('Payment missing amount');
  if (!p.date) throw new Error('Payment missing date');
  if (!p.method) throw new Error('Payment missing payment method');
  if ((p.method === 'Cash' || p.method === 'UPI' || p.method === 'Online Transfer') && !p.paidTo) {
    throw new Error('Payment missing Paid To / Account name');
  }
  if (p.method === 'UPI' && !p.mobile) throw new Error('UPI payment missing mobile number');
  if (!p.id) p.id = 'p' + Date.now() + Math.floor(Math.random() * 1000);
  var sheet = getOrCreateSheet(ss, 'Payments', PAYMENT_HEADERS);
  upsertRow(sheet, p.id, paymentRow(p));

  // Mirror every payment into the Cash Book as a "Procurement Payment"
  // transaction, so Cash Book / Reports stay synchronized automatically.
  upsertPaymentCashbookEntry(ss, p);
  return p;
}

// ── CASH BOOK ───────────────────────────────────────────────────
function cashbookRow(c) {
  return [
    c.id, c.date || '', c.time || '',
    c.txType === 'manual' ? 'Manual Expense' : 'Procurement Payment',
    c.item || '', Number(c.amount) || 0, c.paidTo || c.farmer || '',
    c.remarks || '', c.procId || '',
    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy HH:mm:ss')
  ];
}
function rowToCashbook(row) {
  return {
    id: row[0], date: normDate(row[1]), time: row[2],
    txType: row[3] === 'Manual Expense' ? 'manual' : 'procurement',
    item: row[4], amount: Number(row[5]) || 0,
    paidTo: row[6], farmer: row[6], remarks: row[7], procId: row[8],
    updatedAt: row[9], synced: true
  };
}
function saveExpense(ss, e) {
  if (!e || !e.item || !e.amount) throw new Error('Expense missing item/amount');
  if (!e.id) e.id = 'CB' + Date.now() + Math.floor(Math.random() * 1000);
  e.txType = 'manual';
  var sheet = getOrCreateSheet(ss, 'Cash Book', CASHBOOK_HEADERS);
  upsertRow(sheet, e.id, cashbookRow(e));
  return e;
}
function deleteExpense(ss, payload) {
  var id = payload.id;
  if (!id) throw new Error('Missing id');
  var sheet = ss.getSheetByName('Cash Book');
  if (!sheet) return;
  var r = findRowById(sheet, id);
  // Only allow deleting Manual Expenses (never an auto Payment row).
  if (r !== -1) {
    var type = sheet.getRange(r, 4).getValue();
    if (type === 'Manual Expense') sheet.deleteRow(r);
  }
}

// Creates/updates the automatic "Procurement Payment" Cash Book row
// linked to a farmer payment via the payment's own ID (reusing the
// "Procurement ID" link column as a generic transaction-link column so
// the existing Cash Book sheet shape never has to change).
function upsertPaymentCashbookEntry(ss, p) {
  var sheet = getOrCreateSheet(ss, 'Cash Book', CASHBOOK_HEADERS);
  var existingRow = findRowByProcId(sheet, p.id);
  var itemDesc = 'Payment to ' + p.farmer + ' (' + (p.method || '') + ')';
  var entry = {
    id: existingRow !== -1 ? sheet.getRange(existingRow, 1).getValue() : ('CB' + Date.now() + Math.floor(Math.random() * 1000)),
    date: p.date, time: p.time || Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm:ss'),
    txType: 'procurement', item: itemDesc,
    amount: p.amount, paidTo: p.paidTo || p.farmer, farmer: p.farmer,
    remarks: p.remarks || '', procId: p.id
  };
  upsertRow(sheet, entry.id, cashbookRow(entry));
}
function findRowByProcId(sheet, procId) {
  if (sheet.getLastRow() < 2) return -1;
  var ids = sheet.getRange(2, 9, sheet.getLastRow() - 1, 1).getValues(); // Procurement ID / link column
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(procId)) return i + 2;
  }
  return -1;
}

// ── SETTINGS ────────────────────────────────────────────────────
function readSettings(ss) {
  var sheet = getOrCreateSheet(ss, 'Settings', SETTINGS_HEADERS);
  var rows = sheetToObjects(sheet, SETTINGS_HEADERS, function (row) { return { key: row[0], value: row[1] }; });
  var out = {};
  for (var k in DEFAULT_SETTINGS) out[k] = DEFAULT_SETTINGS[k];
  rows.forEach(function (r) { out[r.key] = r.value; });
  // make sure every default key physically exists as a row (first run)
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    if (!rows.some(function (r) { return r.key === k; })) {
      sheet.appendRow([k, DEFAULT_SETTINGS[k]]);
    }
  });
  return out;
}

function writeSettingValue(ss, key, value) {
  var sheet = getOrCreateSheet(ss, 'Settings', SETTINGS_HEADERS);
  var rows = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 0), 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === key) { sheet.getRange(i + 2, 2).setValue(value); return; }
  }
  sheet.appendRow([key, value]);
}

function saveSettings(ss, payload) {
  ['cr', 'dr', 'hr', 'tr'].forEach(function (k) {
    if (payload[k] !== undefined && payload[k] !== null && payload[k] !== '') {
      writeSettingValue(ss, k, Number(payload[k]));
    }
  });
}

// Applies a dropdown (data validation) on the "Farmer Name" column of the
// Direct Farmer and Contract Cane sheets, sourced live from the Farmers
// sheet's Name column — so the list always auto-updates as farmers are
// added/removed. allowInvalid stays true so it never blocks a save or
// flags existing rows; it only offers a pick-list in the UI. Does not
// touch any formula, column, or other sheet structure.
function applyFarmerNameValidation(ss) {
  var farmSheet = ss.getSheetByName('Farmers');
  if (!farmSheet) return;
  var farmerRowCount = Math.max(farmSheet.getMaxRows() - 1, 1);
  var namesRange = farmSheet.getRange(2, 2, farmerRowCount, 1); // Name column
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(namesRange, true)
    .setAllowInvalid(true)
    .build();

  var farmerCol = RECORD_HEADERS.indexOf('Farmer Name') + 1;
  ['Direct Farmer', 'Contract Cane'].forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    var rowCount = Math.max(sheet.getMaxRows() - 1, 1);
    sheet.getRange(2, farmerCol, rowCount, 1).setDataValidation(rule);
  });
}

// Turns on Google Sheets' native header filter (the little ▾ arrow on
// EVERY column header, exactly like Excel's AutoFilter in the reference
// screenshot) so the user can click the Farmer Name header and check/
// uncheck names to see only that farmer's rows. This is a VIEW filter on
// the header row — separate from the per-row data-entry dropdown above,
// which still helps prevent typos when typing a new row.
// Existing filter criteria (e.g. a farmer already checked/unchecked) are
// preserved across saves; only the filtered RANGE is extended to include
// newly added rows. Wrapped so a filter-API hiccup can never break a save.
function applyHeaderFilters(ss) {
  try {
    ['Direct Farmer', 'Contract Cane'].forEach(function (sheetName) {
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) return;
      var lastRow = Math.max(sheet.getLastRow(), 2);
      var lastCol = Math.max(sheet.getLastColumn(), 1);

      var existing = sheet.getFilter();
      if (existing) {
        var range = existing.getRange();
        // Range already covers all current rows/cols — nothing to do,
        // and re-creating it would just discard the user's current
        // filter selection for no reason.
        if (range.getLastRow() >= lastRow && range.getNumColumns() >= lastCol) return;

        // Otherwise, preserve whatever column filter criteria are set,
        // remove, and recreate over the larger range.
        var savedCriteria = {};
        for (var c = range.getColumn(); c < range.getColumn() + range.getNumColumns(); c++) {
          var fc = existing.getColumnFilterCriteria(c);
          if (fc) savedCriteria[c] = fc;
        }
        existing.remove();
        var newFilter = sheet.getRange(1, 1, lastRow, lastCol).createFilter();
        Object.keys(savedCriteria).forEach(function (colStr) {
          newFilter.setColumnFilterCriteria(Number(colStr), savedCriteria[colStr]);
        });
      } else {
        sheet.getRange(1, 1, lastRow, lastCol).createFilter();
      }
    });
  } catch (err) {
    // Never let a filter issue block saving/syncing data.
  }
}

// ── SNAPSHOT (used after every action so all devices refresh identically) ──
function buildSnapshot(ss) {
  var recSheet = getOrCreateSheet(ss, 'All Records', RECORD_HEADERS);
  var records = sheetToObjects(recSheet, RECORD_HEADERS, rowToRecord);
  // newest first, matching the app's previous "unshift" ordering
  records.sort(function (a, b) { return (String(b.id) > String(a.id)) ? 1 : -1; });

  // Always resync the Farmers sheet's outstanding balances (and de-dupe any
  // repeat rows) from the current Records + Payments data before reading it,
  // so every snapshot — after every action — reflects the latest numbers.
  rebuildFarmersSheet(ss);
  applyFarmerNameValidation(ss);
  applyHeaderFilters(ss);
  var farmSheet = getOrCreateSheet(ss, 'Farmers', FARMER_HEADERS);
  var farmers = sheetToObjects(farmSheet, FARMER_HEADERS, function (row) {
    return { id: row[0], name: row[1], village: row[2], mobile: row[3], balance: Number(row[4]) || 0 };
  });

  var paySheet = getOrCreateSheet(ss, 'Payments', PAYMENT_HEADERS);
  var payments = sheetToObjects(paySheet, PAYMENT_HEADERS, rowToPayment);
  var paymentsChrono = payments.slice().sort(function (a, b) { return (String(a.id) > String(b.id)) ? 1 : -1; });
  paymentsChrono.forEach(function (p, idx) { p.payId = 'PAY-2026-' + String(idx + 1).padStart(6, '0'); });
  payments.sort(function (a, b) { return (String(b.id) > String(a.id)) ? 1 : -1; });

  var cbSheet = getOrCreateSheet(ss, 'Cash Book', CASHBOOK_HEADERS);
  var cashbook = sheetToObjects(cbSheet, CASHBOOK_HEADERS, rowToCashbook);
  cashbook.sort(function (a, b) { return (String(b.date) + String(b.time)).localeCompare(String(a.date) + String(a.time)); });

  var settings = readSettings(ss);
  return {
    records: records,
    farmers: farmers,
    payments: payments,
    cashbook: cashbook,
    settings: { cr: Number(settings.cr), dr: Number(settings.dr), hr: Number(settings.hr), tr: Number(settings.tr) }
  };
}

// ── MONTHLY SUMMARY (rebuilt fully each time so edits/deletes stay correct) ──
// NOTE: only the two column HEADER WORDS are swapped ("Direct"/"Contract")
// to match the app-wide display-label swap. The underlying counts
// (m.contract / m.direct, keyed off the real rec.type) are unchanged.
function rebuildMonthlySummary(ss) {
  var ms = ss.getSheetByName('Monthly Summary');
  if (!ms) ms = ss.insertSheet('Monthly Summary');
  ms.clear();
  var headers = ['Month', 'Entries', 'Total Cane (Ton)', 'Total Amt (₹)', 'Direct', 'Contract'];
  ms.appendRow(headers);
  styleHeader(ms, headers.length);
  ms.setFrozenRows(1);

  var recSheet = ss.getSheetByName('All Records');
  var records = recSheet ? sheetToObjects(recSheet, RECORD_HEADERS, rowToRecord) : [];
  var byMonth = {};
  records.forEach(function (r) {
    if (!r.date) return;
    var d = new Date(r.date);
    if (isNaN(d.getTime())) return;
    var mk = Utilities.formatDate(d, 'Asia/Kolkata', 'MMM yyyy');
    if (!byMonth[mk]) byMonth[mk] = { entries: 0, ton: 0, amt: 0, contract: 0, direct: 0, order: d };
    var m = byMonth[mk];
    m.entries++; m.ton += r.netTon || 0; m.amt += r.total || 0;
    if (r.type === 'contract') m.contract++; else m.direct++;
  });
  var keys = Object.keys(byMonth).sort(function (a, b) { return byMonth[a].order - byMonth[b].order; });
  keys.forEach(function (mk) {
    var m = byMonth[mk];
    ms.appendRow([mk, m.entries, m.ton, m.amt, m.contract, m.direct]);
  });
}

// ── LEGACY (kept only so very old app builds pinging the old GET
//    format don't hard-crash; not used by the current app) ───────
function legacyAppend(ss, p) {
  var rec = {
    id: 'legacy' + Date.now(), weighSlipNo: p.weighSlipNo || '-', type: p.type, date: p.date,
    farmerBase: p.farmer, landOwner: '-', farmer: p.farmer, village: p.village, mobile: p.mobile, vehicle: p.vehicle,
    gross: p.gross, tare: p.tare, deduction: p.deduction, caneWt: p.caneWt,
    dedAmt: p.dedAmt, netCane: p.netCane, netTon: p.netTon, caneRate: p.caneRate,
    harvestRate: p.harvestRate, transportRate: p.transportRate, caneAmt: p.caneAmt,
    harAmt: p.harAmt, traAmt: p.traAmt, total: p.total
  };
  saveRecord(ss, rec);
}
