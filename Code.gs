/**
 * Ang Probinsyanong Ahente — Consultation Email Automation
 *
 * This script is designed to serve Index.html directly as an Apps Script Web App.
 * Index.html calls submitConsultation() through google.script.run, so no Apps
 * Script URL is required in the HTML.
 *
 * Deployment:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * First-time setup:
 *   1. Set NOTIFY_EMAIL below.
 *   2. Run authorizeMail().
 *   3. Approve the requested mail permissions.
 *   4. Run testEmail() and verify both test messages.
 */

const CONFIG = {
  NOTIFY_EMAIL: 'xhyrhielabiera@gmail.com',
  SENDER_NAME: 'Ang Probinsyanong Ahente',
  SENDER_TITLE: 'Cavite Real Estate Consultation',
  SENDER_PHONE: '+63 966 953 3188',
  SENDER_EMAIL: 'xhyrhielabiera@gmail.com',
  SENDER_FB_URL: '',
  LOGO_URL: '',
  TIME_ZONE: 'Asia/Manila',
  RATE_LIMIT_SECONDS: 20,
  MAX_NAME: 120,
  MAX_EMAIL: 254,
  MAX_MESSAGE: 3000,
  MAX_ANSWER: 500,
  SHEET_ID: '1Q0-GKGzJMYRbnjQBp2q8td-CEtIja8zZxxl9D0AvMXA',
  SHEET_NAME: 'Consultations',
  TRIGGER_HANDLER: 'runConsultationAutomation',
  TRIGGER_HOUR: 8,
  FOLLOWUP_DAYS: [0, 5, 10, 15, 20, 25, 29]
};

/** Serves the landing page from the same Apps Script project. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Ang Probinsyanong Ahente | Cavite Real Estate')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Receives consultation submissions from the Vercel-hosted frontend.
 * The frontend sends URL-encoded `payload` JSON so this endpoint can be
 * called without exposing Apps Script-only google.script.run in Vercel.
 */
function doPost(e) {
  try {
    const raw = e && e.parameter && e.parameter.payload
      ? e.parameter.payload
      : (e && e.postData && e.postData.contents ? e.postData.contents : '{}');
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch (parseError) {
      data = e && e.parameter ? e.parameter : {};
    }
    const result = submitConsultation(data);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error('doPost consultation error: ' + errorMessage_(error));
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        sheetSaved: false,
        ownerNotification: false,
        clientConfirmation: false,
        message: 'Hindi naproseso ang consultation. ' + errorMessage_(error)
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Called by Index.html after the visitor submits the consultation form.
 * It sends the owner notification and the client confirmation only after
 * validation succeeds. The browser shows thank-you only for success:true.
 */
function submitConsultation(formData) {
  const data = formData || {};
  const name = clean_(data.name, CONFIG.MAX_NAME);
  const email = clean_(data.email, CONFIG.MAX_EMAIL).toLowerCase();
  const message = clean_(data.message || '(walang iniwang mensahe)', CONFIG.MAX_MESSAGE);
  const website = clean_(data.website, 80);
  const answers = normalizeAnswers_(data.answers);
  const selectedResource = getSelectedResource_(data.resourceKey);

  if (website) return { success: false, message: 'Request rejected.' };
  if (!name || !isValidEmail_(email)) {
    return { success: false, message: 'Please provide a valid name and email address.' };
  }
  if (!isValidEmail_(CONFIG.NOTIFY_EMAIL)) {
    throw new Error('CONFIG.NOTIFY_EMAIL is not a valid email address.');
  }
  if (isRateLimited_(email)) {
    return { success: false, message: 'Please wait a few seconds before submitting again.' };
  }

  const submittedDate = new Date();
  const submitted = Utilities.formatDate(
    submittedDate,
    Session.getScriptTimeZone() || CONFIG.TIME_ZONE,
    'MMMM d, yyyy h:mm a'
  );
  const submission = {
    fullName: name,
    email: email,
    message: message,
    submitted: submitted,
    submittedDate: submittedDate,
    answers: answers,
    selectedResource: selectedResource,
    isTest: Boolean(data.isTest)
  };
  // Save the lead first. Email failure must never erase a valid consultation lead.
  let sheetResult;
  try {
    sheetResult = logToSheet(submission, { ownerSent: false, clientSent: false });
  } catch (sheetError) {
    console.error('Google Sheets save failed: ' + errorMessage_(sheetError));
    return {
      success: false,
      ownerNotification: false,
      clientConfirmation: false,
      sheetSaved: false,
      message: 'Hindi na-save sa Google Sheets ang consultation. ' + errorMessage_(sheetError)
    };
  }

  const delivery = sendConsultationEmails_(submission);
  const ownerSent = delivery.ownerSent;
  const clientSent = delivery.clientSent;
  try {
    updateConsultationDelivery_(sheetResult, delivery);
  } catch (updateError) {
    console.error('Google Sheets delivery-status update failed: ' + errorMessage_(updateError));
  }

  if (ownerSent && clientSent && sheetResult.saved) {
    return {
      success: true,
      ownerNotification: true,
      clientConfirmation: true,
      sheetSaved: true,
      leadId: sheetResult.leadId,
      sheetUrl: sheetResult.sheetUrl,
      message: 'Consultation emails sent and saved to Google Sheets.'
    };
  }

  return {
    success: false,
    ownerNotification: ownerSent,
    clientConfirmation: clientSent,
    sheetSaved: sheetResult.saved,
    leadId: sheetResult.leadId,
    sheetUrl: sheetResult.sheetUrl,
    message: 'Lead saved to Google Sheets, but email delivery is incomplete. Owner: ' + ownerSent + ', client: ' + clientSent + '. Tingnan ang Apps Script Executions.'
  };
}

/**
 * Run this manually once in the Apps Script editor. Calling MailApp here
 * forces Google authorization before a real client submits the form.
 */
function setupConsultationSheet() {
  const sheet = setupConsultationSheet_();
  const result = {
    ready: true,
    sheetId: sheet.getParent().getId(),
    sheetUrl: sheet.getParent().getUrl(),
    sheetName: sheet.getName(),
    headers: getSheetHeaders_()
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/** Writes one harmless sample row to verify that the configured Sheet is writable. */
function testSheetConnection() {
  const result = logToSheet({
    fullName: 'TEST — Delete this row',
    email: CONFIG.NOTIFY_EMAIL,
    message: 'Sheet connection test only; no email is sent by this function.',
    submittedDate: new Date(),
    answers: [{ q: 'Connection test', a: 'Google Sheets write successful' }],
    isTest: true
  }, { ownerSent: false, clientSent: false });
  Logger.log(JSON.stringify(result));
  return result;
}

function authorizeMail() {
  const quota = MailApp.getRemainingDailyQuota();
  const sheet = setupConsultationSheet_();
  installDailyTrigger_();
  const result = {
    authorized: true,
    remainingDailyRecipients: quota,
    sheetId: sheet.getParent().getId(),
    sheetUrl: sheet.getParent().getUrl(),
    sheetName: sheet.getName(),
    triggerInstalled: true
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * Sends two test messages to NOTIFY_EMAIL: one owner-format message and one
 * client-format confirmation. Run this after authorizeMail().
 */
function testEmail() {
  const testEmailAddress = CONFIG.NOTIFY_EMAIL;
  const result = submitConsultation({
    type: 'consultation',
    name: 'Test Consultation Visitor',
    email: testEmailAddress,
    message: 'This is a test of the consultation email, Google Sheets, and 30-day follow-up automation.',
    answers: [
      { q: 'Test question', a: 'Test answer' }
    ],
    isTest: true
  });
  Logger.log(JSON.stringify(result));
  return result;
}

function normalizeAnswers_(answers) {
  if (!Array.isArray(answers)) return [];
  return answers.slice(0, 20).map(function(item, index) {
    item = item || {};
    return {
      q: clean_(item.q || ('Question ' + (index + 1)), 300),
      a: clean_(item.a || '—', CONFIG.MAX_ANSWER)
    };
  });
}

function isRateLimited_(email) {
  const cache = CacheService.getScriptCache();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email);
  const key = 'consultation:' + Utilities.base64EncodeWebSafe(digest);
  if (cache.get(key)) return true;
  cache.put(key, '1', CONFIG.RATE_LIMIT_SECONDS);
  return false;
}

function buildOwnerText_(name, email, message, submitted, answers) {
  const lines = [
    'NEW CONSULTATION REQUEST',
    '',
    'Full Name: ' + name,
    'Email: ' + email,
    'Submitted: ' + submitted,
    '',
    'Message:',
    message,
    '',
    'Survey Answers:'
  ];
  answers.forEach(function(item, index) {
    lines.push((index + 1) + '. ' + item.q + ': ' + item.a);
  });
  return lines.join('\n');
}

/** Sends both consultation messages using the template structure from EmailTemplate.txt. */
function sendConsultationEmails_(f) {
  let ownerSent = false;
  let clientSent = false;

  try {
    sendConsultationOwnerEmail_(f);
    ownerSent = true;
  } catch (error) {
    console.error('Owner notification failed: ' + errorMessage_(error));
  }

  try {
    sendConsultationClientEmail_(f);
    clientSent = true;
  } catch (error) {
    console.error('Client confirmation failed: ' + errorMessage_(error));
  }

  return { ownerSent: ownerSent, clientSent: clientSent };
}

/** Owner version: the same template card, summary, colors, and closing. */
function sendConsultationOwnerEmail_(f) {
    const html = renderEmailTemplate_(f, 'owner');
  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: CONFIG.SENDER_NAME + ' — New Consultation Request 🎉',
    body: consultationEmailText_(f, 'owner'),
    htmlBody: html,
    replyTo: f.email,
    name: CONFIG.SENDER_NAME
  });
}

/** Client version: confirmation using the same supplied template layout. */
function sendConsultationClientEmail_(f) {
    const html = renderEmailTemplate_(f, 'client');
  MailApp.sendEmail({
    to: f.email,
    subject: CONFIG.SENDER_NAME + ' — Consultation Request Received 🎉',
    body: consultationEmailText_(f, 'client'),
    htmlBody: html,
    replyTo: CONFIG.NOTIFY_EMAIL,
    name: CONFIG.SENDER_NAME
  });
}

function consultationEmailText_(f, mode) {
  if (mode === 'client') {
    return 'Hello ' + f.fullName + ',\n\n' +
      'Thank you for taking interest in our Free Consultation at ' + CONFIG.SENDER_NAME + '.\n\n' +
      'We have received your consultation request and will contact you as soon as possible.\n\n' +
      'If you need to contact us immediately, simply reply to this original email or call ' + CONFIG.SENDER_PHONE + '.\n\n' +
      'Best regards,\n' + CONFIG.SENDER_NAME + '\n' + CONFIG.SENDER_TITLE + '\n' + CONFIG.SENDER_EMAIL + '\n' + CONFIG.SENDER_PHONE;
  }

  const lines = [
    'NEW CONSULTATION REQUEST',
    '',
    'Full Name: ' + f.fullName,
    'Email: ' + f.email,
    'Submitted: ' + f.submitted,
    '',
    'Message:',
    f.message,
    '',
    'Survey Answers:'
  ];
  f.answers.forEach(function(item, index) {
    lines.push((index + 1) + '. ' + item.q + ': ' + item.a);
  });
  return lines.join('\\n');
}

/**
 * Loads EmailTemplate.html from this Apps Script project and replaces its
 * placeholders. The file is intentionally kept separate so the branding can
 * be edited without changing the email delivery logic.
 */
function renderEmailTemplate_(f, mode) {
  let template = HtmlService.createHtmlOutputFromFile('EmailTemplate').getContent();
  const c = emailConfig_();
  const isClient = mode === 'client';
  let summaryRows = '';

  if (isClient) {
    const rowStyle = 'margin:0 0 9px;padding:10px 12px;background:#f8faff;border:1px solid #e3eaf6;border-radius:9px;font-family:\'Trebuchet MS\',Arial,sans-serif;font-size:13px;line-height:1.5;color:#42536f;';
    const labelStyle = 'color:' + c.primaryColor + ';font-weight:900;letter-spacing:.02em;';
    summaryRows = '<li style="' + rowStyle + '"><strong style="' + labelStyle + '">Request Type:</strong> Free Consultation</li>' +
      '<li style="' + rowStyle + '"><strong style="' + labelStyle + '">Submitted:</strong> ' + escapeHtml_(f.submitted) + '</li>';
  } else {
    const rowStyle = 'margin:0 0 9px;padding:10px 12px;background:#f8faff;border:1px solid #e3eaf6;border-radius:9px;font-family:\'Trebuchet MS\',Arial,sans-serif;font-size:13px;line-height:1.5;color:#42536f;';
    const labelStyle = 'color:' + c.primaryColor + ';font-weight:900;letter-spacing:.02em;';
    summaryRows = '<li style="' + rowStyle + '"><strong style="' + labelStyle + '">Full Name:</strong> ' + escapeHtml_(f.fullName) + '</li>' +
      '<li style="' + rowStyle + '"><strong style="' + labelStyle + '">Email:</strong> <a href="mailto:' + escapeHtml_(f.email) + '" style="color:' + c.accentColor + ';text-decoration:underline;font-weight:700;">' + escapeHtml_(f.email) + '</a></li>' +
      '<li style="' + rowStyle + '"><strong style="' + labelStyle + '">Submitted:</strong> ' + escapeHtml_(f.submitted) + '</li>';
  }

  let surveySection = '';
  if (!isClient) {
    let items = '';
    f.answers.forEach(function(item, index) {
      const markerColor = index % 2 === 0 ? '#d21f34' : '#1a4fc4';
      items += '<tr>' +
        '<td width="34" valign="top" style="width:34px;padding:0 8px 10px 0;vertical-align:top;">' +
          '<div style="width:24px;height:24px;line-height:24px;text-align:center;border-radius:50%;background:' + markerColor + ';color:#ffffff;font-size:12px;font-weight:800;">' + (index + 1) + '</div>' +
        '</td>' +
        '<td valign="top" style="padding:0 0 10px;vertical-align:top;">' +
          '<div style="padding:11px 13px;background:#f8faff;border:1px solid #dfe7f8;border-radius:10px;">' +
            '<div style="font-size:10px;line-height:1.35;font-weight:800;letter-spacing:.055em;text-transform:uppercase;color:#7b89a5;">' + escapeHtml_(item.q) + '</div>' +
            '<div style="margin-top:4px;font-size:14px;line-height:1.45;font-weight:800;color:#061b45;">' + escapeHtml_(item.a) + '</div>' +
          '</div>' +
        '</td>' +
      '</tr>';
    });
    surveySection = '<div style="margin-top:24px;padding:18px 16px 16px;background:#f4f7fd;border:1px solid #cddaf2;border-radius:14px;">' +
      '<div style="height:3px;margin:-18px -16px 16px;background:linear-gradient(90deg,#1a4fc4 0%,#1a4fc4 36%,#ffffff 36%,#ffffff 64%,#d21f34 64%,#d21f34 100%);border-radius:14px 14px 0 0;"></div>' +
      '<div style="margin:0 0 14px;font-size:13px;line-height:1.4;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#061b45;"><span style="display:inline-block;width:7px;height:7px;margin:0 7px 2px 0;border-radius:50%;background:#d21f34;"></span>Survey Answers</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">' + (items || '<tr><td style="font-size:13px;color:#4b5a78;">No survey answers supplied.</td></tr>') + '</table>' +
      '</div>';
  }

  const messageSection = !isClient ?
    '<div style="margin-top:14px;padding:14px 15px;background:#fff6f6;border:1px solid #f2d4d8;border-left:5px solid #d9272e;border-radius:9px;font-family:\'Trebuchet MS\',Arial,sans-serif;">' +
    '<p style="font-size:11px;line-height:1.4;letter-spacing:.1em;text-transform:uppercase;color:#123b8f;font-weight:900;margin:0 0 7px;">Message</p>' +
    '<p style="font-size:14px;line-height:1.7;color:#26344b;margin:0;font-weight:600;">' + nl2br_(f.message) + '</p></div>' : '';

  const resourceSection = isClient && f.selectedResource ?
    '<div style="margin-top:24px;padding:18px 16px 20px;background:#f4f7fd;border:1px solid #cddaf2;border-radius:14px;">' +
    '<div style="height:3px;margin:-18px -16px 16px;background:linear-gradient(90deg,#1a4fc4 0 50%,#d21f34 50%);border-radius:14px 14px 0 0;"></div>' +
    '<div style="font-size:13px;line-height:1.4;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#061b45;">Your Selected Free Resource</div>' +
    '<div style="margin-top:8px;font-size:18px;font-weight:900;color:#061b45;">' + escapeHtml_(f.selectedResource.title) + '</div>' +
    '<p style="font-size:14px;line-height:1.6;color:#42536f;margin:8px 0 15px;">Maaari mong tingnan online o i-download ang buong guide.</p>' +
    '<a href="' + escapeHtml_(f.selectedResource.viewUrl) + '" style="display:inline-block;margin-right:8px;padding:11px 16px;border-radius:999px;background:#1a4fc4;color:#fff;text-decoration:none;font-size:12px;font-weight:900;">VIEW FULL GUIDE</a>' +
    '<a href="' + escapeHtml_(f.selectedResource.downloadUrl) + '" style="display:inline-block;padding:11px 16px;border-radius:999px;background:#d21f34;color:#fff;text-decoration:none;font-size:12px;font-weight:900;">DOWNLOAD PDF</a>' +
    '</div>' : '';

  const values = {
    EMAIL_SUBJECT: isClient ? CONFIG.SENDER_NAME + ' — Consultation Request Received' : CONFIG.SENDER_NAME + ' — New Consultation Request',
    GREETING: isClient ? 'Hello ' + escapeHtml_(f.fullName) + ',' : 'Hello,',
    INTRO: isClient ? 'Thank you for taking interest in our <strong>Free Consultation</strong> at ' + escapeHtml_(CONFIG.SENDER_NAME) + '.' : 'A new consultation request was submitted through the website.',
    HIGHLIGHT: isClient ? 'We have received your consultation request and will contact you as soon as possible.' : 'Please review the submission summary below and reply to the client when ready.',
    SUMMARY_ROWS: summaryRows,
    SURVEY_SECTION: surveySection,
    RESOURCE_SECTION: resourceSection,
    MESSAGE_SECTION: messageSection,
    CLOSING: isClient ? '<p style="font-size:16px;color:#333;margin-top:25px;">If you need to contact us immediately, <b>simply reply to this original email to proceed to the next steps.</b></p><p style="font-size:16px;color:#333;">Thank you, and we look forward to hearing from you soon.</p>' : '<p style="font-size:16px;color:#333;margin-top:25px;">Please follow up with the client using the email address above.</p>',
    SENDER_NAME: escapeHtml_(CONFIG.SENDER_NAME),
    SENDER_TITLE: escapeHtml_(CONFIG.SENDER_TITLE),
    SENDER_EMAIL: escapeHtml_(CONFIG.SENDER_EMAIL),
    SENDER_PHONE: escapeHtml_(CONFIG.SENDER_PHONE)
  };

  Object.keys(values).forEach(function(key) {
    template = template.split('{{' + key + '}}').join(values[key]);
  });
  return template;
}

function emailConfig_() {
  return {
    primaryColor: '#061b45',
    accentColor: '#1a4fc4',
    logoUrl: CONFIG.LOGO_URL,
    senderFbUrl: CONFIG.SENDER_FB_URL
  };
}

function clean_(value, max) {
  return String(value == null ? '' : value).replace(/[<>]/g, '').trim().slice(0, max);
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function nl2br_(value) {
  return escapeHtml_(value).replace(/\n/g, '<br>');
}

function escapeHtml_(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
  });
}

function errorMessage_(error) {
  return error && error.message ? String(error.message) : String(error);
}

/* ==================== GOOGLE SHEETS CRM + 30-DAY FOLLOW-UP ==================== */

function getSheetId_() {
  const props = PropertiesService.getScriptProperties();
  const configured = CONFIG.SHEET_ID;
  if (configured && configured.indexOf('PASTE_') !== 0) {
    props.setProperty('CONSULTATION_SHEET_ID', configured);
    return configured;
  }
  let id = props.getProperty('CONSULTATION_SHEET_ID');
  if (id) return id;
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    id = active.getId();
  } else {
    id = SpreadsheetApp.create('Ang Probinsyanong Ahente — Consultation CRM').getId();
  }
  props.setProperty('CONSULTATION_SHEET_ID', id);
  return id;
}

function getSheetHeaders_() {
  const headers = [
    'Lead ID', 'Submitted At', 'Full Name', 'Email', 'Message', 'Survey Answers', 'Selected Free Resource',
    'Owner Email Sent', 'Client Email Sent'
  ];
  for (let i = 1; i <= 7; i++) {
    headers.push('Day ' + i + ' Date', 'Day ' + i + ' Stage', 'Day ' + i + ' Status', 'Day ' + i + ' Sent At');
  }
  headers.push('Current Stage', 'Current Status', 'Next Follow-up Date', 'Last Email Sent At', 'Last Error', 'Test Record');
  return headers;
}

function setupConsultationSheet_() {
  const book = SpreadsheetApp.openById(getSheetId_());
  let sheet = book.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = book.insertSheet(CONFIG.SHEET_NAME);
  const headers = getSheetHeaders_();
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  let needsHeader = sheet.getLastRow() === 0 || current.every(function(v) { return v === ''; });
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (current.join('|') !== headers.join('|')) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  formatConsultationSheet_(sheet, headers);
  return sheet;
}

function formatConsultationSheet_(sheet, headers) {
  const lastColumn = headers.length;
  sheet.getRange(1, 1, 1, lastColumn)
    .setBackground('#061b45')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sheet.setRowHeight(1, 38);
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), lastColumn)
    .setVerticalAlignment('top')
    .setWrap(true);
  [2, 8, 9].forEach(function(col) {
    sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('mmm d, yyyy h:mm AM/PM');
  });
  for (let stage = 1; stage <= 7; stage++) {
    const dateCol = headers.indexOf('Day ' + stage + ' Date') + 1;
    const sentCol = headers.indexOf('Day ' + stage + ' Sent At') + 1;
    if (dateCol > 0) sheet.getRange(2, dateCol, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('mmm d, yyyy');
    if (sentCol > 0) sheet.getRange(2, sentCol, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('mmm d, yyyy h:mm AM/PM');
  }
  sheet.autoResizeColumns(1, lastColumn);
  sheet.setColumnWidth(5, 260);
  sheet.setColumnWidth(6, 320);
  sheet.setColumnWidth(headers.indexOf('Selected Free Resource') + 1, 240);
  sheet.setColumnWidth(headers.indexOf('Last Error') + 1, 240);
}



/** Approved free resources. These links are sent only to the consulting client. */
function getSelectedResource_(key) {
  const resources = {
    homebuyer: {
      key: 'homebuyer',
      title: 'Free Homebuyer Guide',
      viewUrl: 'https://drive.google.com/file/d/1S71YCogCtiUG4UUxfxEPfU8GtnHvsWBz/view?usp=sharing',
      downloadUrl: 'https://drive.google.com/uc?export=download&id=1S71YCogCtiUG4UUxfxEPfU8GtnHvsWBz'
    },
    questions: {
      key: 'questions',
      title: 'Questions to Ask Before Buying a House',
      viewUrl: 'https://drive.google.com/file/d/1ybpcZq8OfWueWcPYnTnpM4MyTl3E7k8G/view?usp=sharing',
      downloadUrl: 'https://drive.google.com/uc?export=download&id=1ybpcZq8OfWueWcPYnTnpM4MyTl3E7k8G'
    }
  };
  return resources[String(key || '').toLowerCase()] || null;
}

/**
 * Public entry point for writing one consultation lead to Google Sheets.
 * Can be run manually with a sample object, or called by submitConsultation().
 * It does not send email; it only creates the lead row and follow-up dates.
 */
function logToSheet(formData, deliveryStatus) {
  const data = formData || {};
  const f = {
    fullName: clean_(data.fullName || data.name, CONFIG.MAX_NAME),
    email: clean_(data.email, CONFIG.MAX_EMAIL).toLowerCase(),
    message: clean_(data.message || '(walang iniwang mensahe)', CONFIG.MAX_MESSAGE),
    submitted: data.submitted || '',
    submittedDate: data.submittedDate instanceof Date ? data.submittedDate : new Date(),
    answers: normalizeAnswers_(data.answers),
    selectedResource: data.selectedResource || null,
    isTest: Boolean(data.isTest)
  };
  if (!f.fullName || !isValidEmail_(f.email)) {
    throw new Error('logToSheet requires a valid name and email.');
  }
  const result = recordConsultationInSheet_(f, deliveryStatus || { ownerSent: false, clientSent: false });
  Logger.log('Consultation logged: ' + JSON.stringify(result));
  return result;
}

function recordConsultationInSheet_(f, delivery) {
  const sheet = setupConsultationSheet_();
  const headers = getSheetHeaders_();
  const submittedDate = f.submittedDate || new Date();
  const leadId = 'CONS-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
  const answerText = (f.answers || []).map(function(item, index) {
    return (index + 1) + '. ' + item.q + ': ' + item.a;
  }).join('\n');
  const row = new Array(headers.length).fill('');
  row[headers.indexOf('Lead ID')] = leadId;
  row[headers.indexOf('Submitted At')] = submittedDate;
  row[headers.indexOf('Full Name')] = f.fullName;
  row[headers.indexOf('Email')] = f.email;
  row[headers.indexOf('Message')] = f.message;
  row[headers.indexOf('Survey Answers')] = answerText;
  row[headers.indexOf('Selected Free Resource')] = f.selectedResource ? f.selectedResource.title : '';
  row[headers.indexOf('Owner Email Sent')] = delivery.ownerSent ? 'Yes' : 'No';
  row[headers.indexOf('Client Email Sent')] = delivery.clientSent ? 'Yes' : 'No';
  for (let stage = 1; stage <= 7; stage++) {
    const date = new Date(submittedDate.getTime() + CONFIG.FOLLOWUP_DAYS[stage - 1] * 24 * 60 * 60 * 1000);
    row[headers.indexOf('Day ' + stage + ' Date')] = date;
    row[headers.indexOf('Day ' + stage + ' Stage')] = stage;
    row[headers.indexOf('Day ' + stage + ' Status')] = stage === 1 ? 'Progressing' : 'Pending';
    row[headers.indexOf('Day ' + stage + ' Sent At')] = stage === 1 && delivery.clientSent ? new Date() : '';
  }
  row[headers.indexOf('Current Stage')] = 1;
  row[headers.indexOf('Current Status')] = 'Progressing';
  row[headers.indexOf('Next Follow-up Date')] = new Date(submittedDate.getTime() + CONFIG.FOLLOWUP_DAYS[1] * 24 * 60 * 60 * 1000);
  row[headers.indexOf('Last Email Sent At')] = delivery.clientSent ? new Date() : '';
  row[headers.indexOf('Test Record')] = f.isTest ? 'Yes' : 'No';
  sheet.appendRow(row);
  const rowNumber = sheet.getLastRow();
  formatConsultationSheet_(sheet, headers);
  return { saved: true, leadId: leadId, rowNumber: rowNumber, sheetUrl: sheet.getParent().getUrl(), sheetName: sheet.getName() };
}

function updateConsultationDelivery_(result, delivery) {
  if (!result || !result.saved || !result.rowNumber) return;
  const sheet = SpreadsheetApp.openById(getSheetId_()).getSheetByName(CONFIG.SHEET_NAME);
  const headers = getSheetHeaders_();
  sheet.getRange(result.rowNumber, headers.indexOf('Owner Email Sent') + 1).setValue(delivery.ownerSent ? 'Yes' : 'No');
  sheet.getRange(result.rowNumber, headers.indexOf('Client Email Sent') + 1).setValue(delivery.clientSent ? 'Yes' : 'No');
  sheet.getRange(result.rowNumber, headers.indexOf('Day 1 Sent At') + 1).setValue(delivery.clientSent ? new Date() : '');
  sheet.getRange(result.rowNumber, headers.indexOf('Last Email Sent At') + 1).setValue(delivery.clientSent ? new Date() : '');
  if (delivery.ownerSent && delivery.clientSent) {
    sheet.getRange(result.rowNumber, headers.indexOf('Last Error') + 1).setValue('');
  } else {
    sheet.getRange(result.rowNumber, headers.indexOf('Last Error') + 1).setValue('Initial email delivery incomplete. Check Apps Script Executions.');
  }
}

function installDailyTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === CONFIG.TRIGGER_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(CONFIG.TRIGGER_HANDLER).timeBased().everyDays(1).atHour(CONFIG.TRIGGER_HOUR).create();
}

/** Run automatically once per day. Sends only the next due stage per lead. */
function runConsultationAutomation() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { processed: 0, skipped: 'Another run is active.' };
  try {
    const sheet = setupConsultationSheet_();
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return { processed: 0, message: 'No consultation leads.' };
    const headers = values[0];
    const now = new Date();
    let processed = 0;
    values.slice(1).forEach(function(row, offset) {
      const rowNumber = offset + 2;
      const status = String(row[headers.indexOf('Current Status')] || '');
      if (!row[headers.indexOf('Email')] || status === 'Completed') return;
      const due = findNextDueStage_(row, headers, now);
      if (!due) return;
      try {
        sendFollowupEmail_(row, headers, due.stage);
        markStageSent_(sheet, rowNumber, headers, due.stage, now);
        processed++;
      } catch (error) {
        sheet.getRange(rowNumber, headers.indexOf('Last Error') + 1).setValue(errorMessage_(error));
      }
    });
    return { processed: processed };
  } finally {
    lock.releaseLock();
  }
}

function findNextDueStage_(row, headers, now) {
  for (let stage = 2; stage <= 7; stage++) {
    const dueDate = row[headers.indexOf('Day ' + stage + ' Date')];
    const sentAt = row[headers.indexOf('Day ' + stage + ' Sent At')];
    if (dueDate instanceof Date && dueDate <= now && !sentAt) return { stage: stage, dueDate: dueDate };
  }
  return null;
}

function markStageSent_(sheet, rowNumber, headers, stage, sentAt) {
  const status = stage === 7 ? 'Completed' : 'Progressing';
  sheet.getRange(rowNumber, headers.indexOf('Day ' + stage + ' Status') + 1).setValue(status);
  sheet.getRange(rowNumber, headers.indexOf('Day ' + stage + ' Sent At') + 1).setValue(sentAt);
  sheet.getRange(rowNumber, headers.indexOf('Current Stage') + 1).setValue(stage);
  sheet.getRange(rowNumber, headers.indexOf('Current Status') + 1).setValue(status);
  sheet.getRange(rowNumber, headers.indexOf('Last Email Sent At') + 1).setValue(sentAt);
  const nextStage = stage + 1;
  sheet.getRange(rowNumber, headers.indexOf('Next Follow-up Date') + 1).setValue(nextStage <= 7 ? sheet.getRange(rowNumber, headers.indexOf('Day ' + nextStage + ' Date') + 1).getValue() : '');
  sheet.getRange(rowNumber, headers.indexOf('Last Error') + 1).setValue('');
}

function sendFollowupEmail_(row, headers, stage) {
  const name = String(row[headers.indexOf('Full Name')] || 'there');
  const email = String(row[headers.indexOf('Email')] || '');
  const subject = CONFIG.SENDER_NAME + ' — Consultation Follow-up | Stage ' + stage;
  const completed = stage === 7;
  const text = 'Hello ' + name + ',\n\n' +
    (completed ? 'Your 30-day consultation follow-up sequence is now complete. Thank you for trusting ' + CONFIG.SENDER_NAME + '.' : 'This is your Stage ' + stage + ' follow-up for your Free Consultation. We are continuing to assist you with your property goals.') + '\n\n' +
    'If you need assistance, simply reply to this email or call ' + CONFIG.SENDER_PHONE + '.\n\nBest regards,\n' + CONFIG.SENDER_NAME + '\n' + CONFIG.SENDER_TITLE + '\n' + CONFIG.SENDER_PHONE;
  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: text,
    htmlBody: followupEmailHtml_(name, stage, completed),
    replyTo: CONFIG.NOTIFY_EMAIL,
    name: CONFIG.SENDER_NAME
  });
}

function followupEmailHtml_(name, stage, completed) {
  const accent = completed ? '#d21f34' : '#1a4fc4';
  const status = completed ? 'COMPLETED' : 'PROGRESSING';
  const title = completed ? 'Your Consultation Journey Is Complete' : 'Your Consultation Follow-up';
  return '<div style="margin:0;background:#f4f7fd;padding:28px 14px;font-family:Arial,Helvetica,sans-serif;color:#17233d;">' +
    '<div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #dfe7f8;border-radius:18px;overflow:hidden;box-shadow:0 12px 28px rgba(6,27,69,.12);">' +
    '<div style="height:7px;background:linear-gradient(90deg,#1a4fc4 0 50%,#d21f34 50%);"></div>' +
    '<div style="padding:28px 30px 12px;background:#061b45;color:#fff;"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#fff;">Ang <span style="color:#2e63e0;">Probinsyanong</span> <span style="color:#d21f34;">Ahente</span></div><h1 style="margin:18px 0 0;font-size:28px;line-height:1.15;">' + title + '</h1></div>' +
    '<div style="padding:28px 30px;"><p style="font-size:17px;margin:0 0 14px;">Hello ' + escapeHtml_(name) + ',</p><p style="font-size:15px;line-height:1.7;margin:0 0 18px;">Thank you for staying connected with us. Your consultation follow-up is currently being handled by our team.</p>' +
    '<div style="padding:17px 18px;background:#f8faff;border-left:5px solid ' + accent + ';border-radius:0 12px 12px 0;"><div style="font-size:11px;letter-spacing:.1em;font-weight:900;color:#71809b;text-transform:uppercase;">FOLLOW-UP STATUS</div><div style="margin-top:7px;font-size:22px;font-weight:900;color:#061b45;">Stage ' + stage + ' — ' + status + '</div></div>' +
    '<p style="font-size:14px;line-height:1.7;margin:22px 0 0;">If you need assistance, reply to this email or call <strong>' + escapeHtml_(CONFIG.SENDER_PHONE) + '</strong>.</p></div>' +
    '<div style="padding:20px 30px;background:#061b45;color:#fff;font-size:13px;line-height:1.6;"><div style="font-weight:900;">Pangarap Mong Bahay, Gawin Natin Tunay!</div><div style="margin-top:6px;color:#c9d5f4;">' + escapeHtml_(CONFIG.SENDER_NAME) + ' · ' + escapeHtml_(CONFIG.SENDER_TITLE) + '</div></div></div></div>';
}

