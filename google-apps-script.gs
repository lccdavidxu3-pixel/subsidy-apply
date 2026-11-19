/**
 * 高階原廠補助 資格審核系統（後端）→ Google Sheet + Google Drive
 *
 * 設定步驟：
 * 1. 新建一個 Google 試算表 →「擴充功能 → Apps Script」，把這整份貼上（取代原本的內容）。
 * 2. 左側「專案設定（齒輪）→ 指令碼屬性」新增：
 *      ADMIN_PASSWORD    = 你的後台密碼
 *      GEMINI_API_KEY    = Google Gemini API 金鑰（選填；用 AI 辨識手寫／掃描的初審表，aistudio.google.com/apikey 取得）
 *      ANTHROPIC_API_KEY = 或改用 Claude API 金鑰（兩個都設定時優先用 Gemini）
 * 3. 右上「部署 → 新增部署作業 → 類型：網頁應用程式」
 *      執行身分：我　／　誰可以存取：所有人 → 部署，第一次會要求授權（試算表 + 雲端硬碟）。
 * 4. 複製「網頁應用程式網址」，貼到 assets/common.js 最上面的 CONFIG.API_URL。
 * 之後改了這份程式，要用「管理部署作業 → 編輯 → 版本：新版本」重新部署才會生效。
 *
 * 資料：試算表「補助申請」分頁；簽名檔與上傳的初審表存在雲端硬碟「高階原廠補助_附件」資料夾。
 */

const SHEET_NAME = '補助申請';
const FOLDER_NAME = '高階原廠補助_附件';
const CATEGORIES = ['待業', '職業軍人', '二度就業', '技能升級'];
const RESULTS = ['approved', 'waitlist', 'rejected'];
const STATUS_LABEL = { pending: '審核中', approved: '核准', waitlist: '候補', rejected: '資格不符' };
const HEADERS = [
  '申請編號', '申請時間', '身分類別', '姓名', '身分證號', '手機', 'Email', '狀態', '資格自評',
  '審核時間', '名次', '專案課程類別', '分期期數', '學習意願', '單位主管', '經辦人', '通知書字號',
  '申請資料(JSON)', '審核資料(JSON)', '查詢碼', '簽名檔ID', '初審表檔ID',
];
const COL = {};
HEADERS.forEach((h, i) => { COL[h] = i + 1; });

const QUESTION_EXPECT = { q1: '是', q2: '是', q3: '是', q5: '是', q6: '是', q7: '是', q8: '同意', q9: '同意', q10: '同意' };
const DATA_FIELDS = ['category', 'name', 'gender', 'marital', 'birthDate', 'phoneHome', 'mobile', 'idNo', 'address',
  'military', 'email', 'school', 'dept', 'motivation', 'confirm', 'fillDate', 'fileName',
  'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: '資料格式錯誤' });
  }
  try {
    switch (req.action) {
      case 'submit': return json(submit(req));
      case 'status': return json(status(req));
      case 'extract': return json(extract(req));
      case 'adminList': requireAdmin(req); return json(adminList());
      case 'adminGet': requireAdmin(req); return json(adminGet(req));
      case 'adminReview': requireAdmin(req); return json(adminReview(req));
      default: return json({ ok: false, error: '未知的操作' });
    }
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) });
  }
}

function doGet() {
  return json({ ok: true, message: '高階原廠補助 API 運作中' });
}

/* ---------------- 申請人 ---------------- */

function submit(req) {
  const d = sanitizeData(req.data || {});
  const err = validate(d);
  if (err) throw new Error(err);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet();
    const rows = readRows(sheet);
    let id;
    do { id = newId(); } while (rows.some(r => r.id === id));
    const token = Utilities.getUuid().replace(/-/g, '');
    const folder = getFolder();
    const sigId = saveDataUrl(folder, req.signature, id + '_' + d.name + '_簽名.png', 400000);
    const fileId = req.file ? saveDataUrl(folder, req.file.dataUrl, id + '_' + d.name + '_初審表_' + clean(req.file.name, 80), 12000000) : '';
    const issues = eligibilityIssues(d);

    const row = new Array(HEADERS.length).fill('');
    row[COL['申請編號'] - 1] = id;
    row[COL['申請時間'] - 1] = new Date();
    row[COL['身分類別'] - 1] = d.category;
    row[COL['姓名'] - 1] = cell(d.name);
    row[COL['身分證號'] - 1] = d.idNo;
    row[COL['手機'] - 1] = "'" + d.mobile;
    row[COL['Email'] - 1] = cell(d.email);
    row[COL['狀態'] - 1] = STATUS_LABEL.pending;
    row[COL['資格自評'] - 1] = issues.length ? '⚠ ' + issues.join('、') : '符合';
    row[COL['申請資料(JSON)'] - 1] = JSON.stringify(d);
    row[COL['查詢碼'] - 1] = token;
    row[COL['簽名檔ID'] - 1] = sigId;
    row[COL['初審表檔ID'] - 1] = fileId;
    sheet.appendRow(row);
    return { ok: true, id: id, token: token };
  } finally {
    lock.releaseLock();
  }
}

function status(req) {
  const rec = findById(String(req.id || '').trim().toUpperCase());
  if (!rec) throw new Error('查無此申請編號');
  const byToken = req.token && req.token === rec.token;
  const byIdNo = req.idNo && String(req.idNo).trim().toUpperCase() === rec.data.idNo;
  if (!byToken && !byIdNo) throw new Error('申請編號與身分證號不符');
  return { ok: true, app: publicView(rec) };
}

/* ---------------- AI 辨識初審表（手寫／掃描） ----------------
 * 指令碼屬性有 GEMINI_API_KEY → 用 Google Gemini；否則有 ANTHROPIC_API_KEY → 用 Claude。
 * 要換 Gemini 模型可加屬性 GEMINI_MODEL（預設 gemini-flash-latest，找不到時改用 gemini-2.5-flash）。
 */

const CLAUDE_MODEL = 'claude-opus-5-5';
const GEMINI_DEFAULT_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
const AI_LIMIT_PER_10MIN = 40; // 全站每 10 分鐘最多辨識次數，避免被濫用

const AI_FIELDS = {
  q1: '第1題：是/否', q2: '第2題：是/否', q3: '第3題：是/否', q4: '第4題：是/否', q5: '第5題：是/否',
  q6: '第6題：是/否', q7: '第7題：是/否', q8: '第8題：同意/不同意', q9: '第9題：同意/不同意', q10: '第10題：同意/不同意',
  name: '姓名', gender: '男/女', marital: '已婚/未婚', birthDate: '西元 YYYY-MM-DD',
  phoneHome: '市話(H)', mobile: '行動電話，只留數字', idNo: '身分證號碼', address: '聯絡地址',
  military: '未役/役畢/免役', email: 'Mail', school: '學校名稱', dept: '科系',
  motivation: '申請動機整段文字', confirm: '是/不是',
};

const AI_PROMPT = [
  '這是一份「高階原廠補助資格審核表」，可能是手寫後掃描或拍照。請讀出申請人填寫的內容並依 JSON 格式回傳。',
  '規則：',
  '- q1~q10 對應「一.資格審核」第 1~10 題，看勾選（✓、V、☑、■、塗黑、圈選）在哪個選項；q1~q7 填「是」或「否」，q8~q10 填「同意」或「不同意」；看不出來就填空字串。',
  '- gender 填「男」或「女」；marital 填「已婚」或「未婚」；military 填「未役」「役畢」「免役」其中之一。',
  '- confirm：「已確定審核資格」後面勾選的是「是」或「不是」。',
  '- birthDate 轉成西元 YYYY-MM-DD（民國年 + 1911，例如 84年12月12日 → 1995-12-12）。',
  '- mobile 只留數字（09 開頭 10 碼）；phoneHome 保留原樣（含區碼、- 號）。',
  '- idNo 為 1 個英文字母 + 9 個數字，英文大寫。',
  '- school 只填學校名稱（不要「(學校)」字樣）；dept 為科系。',
  '- motivation 為「為何會想申請專案」下方手寫的整段文字，保留原意、加上標點。',
  '- 只讀申請人填寫的部分；「三.專案類別」「四.審核結果」是中心填寫的，忽略。',
  '- 沒填或完全無法辨識的欄位填空字串，不要猜。',
  '- uncertain：列出你辨識沒把握（字跡潦草、可能讀錯）的欄位名稱（例如 "dept"、"q4"）。',
].join('\n');

function extract(req) {
  const props = PropertiesService.getScriptProperties();
  const geminiKey = props.getProperty('GEMINI_API_KEY');
  const claudeKey = props.getProperty('ANTHROPIC_API_KEY');
  if (!geminiKey && !claudeKey) return { ok: false, error: 'AI 辨識未設定', code: 'NO_AI' };

  const m = /^data:([\w\/+.\-]+);base64,(.+)$/.exec(String((req.file || {}).dataUrl || ''));
  if (!m) throw new Error('檔案格式錯誤');
  const mime = m[1];
  const data = m[2];
  if (data.length > 14000000) throw new Error('檔案太大，請小於 10MB');
  if (mime !== 'application/pdf' && !/^image\/(jpeg|png|gif|webp)$/.test(mime)) throw new Error('AI 辨識只支援 PDF 或圖片');

  // 簡單限流
  const cache = CacheService.getScriptCache();
  const slot = 'ai_' + Math.floor(Date.now() / 600000);
  const used = Number(cache.get(slot) || 0);
  if (used >= AI_LIMIT_PER_10MIN) throw new Error('目前辨識人數較多，請稍後再試或直接手動填寫');
  cache.put(slot, String(used + 1), 900);

  const text = geminiKey
    ? callGemini(geminiKey, props.getProperty('GEMINI_MODEL'), mime, data)
    : callClaude(claudeKey, mime, data);

  let values;
  try { values = JSON.parse(text); } catch (e) { throw new Error('AI 辨識結果格式錯誤，請手動填寫'); }
  const uncertain = Array.isArray(values.uncertain) ? values.uncertain.map(String) : [];
  const out = {};
  Object.keys(AI_FIELDS).forEach(k => { const v = String(values[k] == null ? '' : values[k]).trim(); if (v) out[k] = v; });
  return { ok: true, values: out, uncertain: uncertain };
}

function callGemini(key, model, mime, data) {
  const schemaProps = {};
  Object.keys(AI_FIELDS).forEach(k => { schemaProps[k] = { type: 'STRING', description: AI_FIELDS[k] }; });
  schemaProps.uncertain = { type: 'ARRAY', items: { type: 'STRING' }, description: '辨識沒把握的欄位名稱' };
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: data } }, { text: AI_PROMPT }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: schemaProps, required: Object.keys(schemaProps) },
    },
  });

  const models = model ? [model] : GEMINI_DEFAULT_MODELS;
  let res;
  for (let i = 0; i < models.length; i++) {
    res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models[i]) + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key },
      payload: body,
    });
    if (res.getResponseCode() !== 404) break; // 模型名稱不存在才換下一個
  }

  const code = res.getResponseCode();
  if (code !== 200) {
    console.error('Gemini API ' + code + ': ' + res.getContentText());
    if (code === 400 && /API key/i.test(res.getContentText())) throw new Error('Gemini 金鑰無效，請檢查 GEMINI_API_KEY');
    throw new Error(code === 429 || code === 503 ? 'AI 辨識忙碌中，請稍後再試' : 'AI 辨識失敗（' + code + '）');
  }
  const json = JSON.parse(res.getContentText() || '{}');
  const cand = (json.candidates || [])[0];
  if (!cand || (json.promptFeedback && json.promptFeedback.blockReason)) throw new Error('AI 無法辨識這份檔案，請手動填寫');
  return ((cand.content || {}).parts || []).map(p => p.text || '').join('');
}

function callClaude(key, mime, data) {
  const block = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mime, data: data } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: data } };
  const props = {};
  Object.keys(AI_FIELDS).forEach(k => { props[k] = { type: 'string', description: AI_FIELDS[k] }; });
  props.uncertain = { type: 'array', items: { type: 'string' } };

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false } },
      },
      messages: [{ role: 'user', content: [block, { type: 'text', text: AI_PROMPT }] }],
    }),
  });

  const code = res.getResponseCode();
  const body = JSON.parse(res.getContentText() || '{}');
  if (code !== 200) {
    console.error('Claude API ' + code + ': ' + res.getContentText());
    throw new Error(code === 429 || code === 529 ? 'AI 辨識忙碌中，請稍後再試' : 'AI 辨識失敗（' + code + '）');
  }
  if (body.stop_reason === 'refusal') throw new Error('AI 無法辨識這份檔案，請手動填寫');
  return (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

/* ---------------- 管理後台 ---------------- */

function requireAdmin(req) {
  const pwd = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!pwd) throw new Error('尚未設定管理密碼（指令碼屬性 ADMIN_PASSWORD）');
  if (String(req.password || '') !== pwd) throw new Error('管理密碼錯誤');
}

function adminList() {
  const rows = readRows(getSheet());
  return {
    ok: true,
    apps: rows.reverse().map(r => ({
      id: r.id, createdAt: r.createdAt, category: r.data.category, name: r.data.name,
      mobile: r.data.mobile, email: r.data.email, status: r.status,
      issues: eligibilityIssues(r.data), review: r.review,
    })),
  };
}

function adminGet(req) {
  const rec = findById(req.id);
  if (!rec) throw new Error('查無此申請');
  let signature = '';
  let fileUrl = '';
  try {
    if (rec.sigId) {
      const b = DriveApp.getFileById(rec.sigId).getBlob();
      signature = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    }
  } catch (e) { /* 檔案被刪除就略過 */ }
  try {
    if (rec.fileId) fileUrl = DriveApp.getFileById(rec.fileId).getUrl();
  } catch (e) { /* 略過 */ }
  return {
    ok: true,
    app: {
      id: rec.id, createdAt: rec.createdAt, status: rec.status, data: rec.data, review: rec.review,
      signature: signature, fileUrl: fileUrl, issues: eligibilityIssues(rec.data),
    },
  };
}

function adminReview(req) {
  const r = req.review || {};
  const review = {
    result: String(r.result || ''),
    rank: clean(r.rank, 6),
    courseType: clean(r.courseType, 100),
    installments: clean(r.installments, 10),
    installmentsOther: clean(r.installmentsOther, 30),
    supervisor: clean(r.supervisor, 30),
    handler: clean(r.handler, 30),
    score: clean(r.score, 3),
    note: clean(r.note, 1000),
  };
  if (RESULTS.indexOf(review.result) === -1) throw new Error('請選擇審核結果');
  if (review.result !== 'rejected' && !/^\d+$/.test(review.rank)) throw new Error('請填寫名次');
  if (review.result === 'approved' && !review.courseType) throw new Error('核准前請填寫專案課程類別');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet();
    const rows = readRows(sheet);
    const rec = rows.find(x => x.id === req.id);
    if (!rec) throw new Error('查無此申請');
    const now = new Date();
    review.reviewedAt = now.toISOString();
    review.noticeNo = (rec.review && rec.review.noticeNo) || nextNoticeNo(rows, now);

    const set = (h, v) => sheet.getRange(rec.row, COL[h]).setValue(v);
    set('狀態', STATUS_LABEL[review.result]);
    set('審核時間', now);
    set('名次', review.rank);
    set('專案課程類別', cell(review.courseType));
    set('分期期數', review.installments === '其它' ? cell(review.installmentsOther) : review.installments);
    set('學習意願', review.score);
    set('單位主管', cell(review.supervisor));
    set('經辦人', cell(review.handler));
    set('通知書字號', review.noticeNo);
    set('審核資料(JSON)', JSON.stringify(review));
    rec.review = review;
    rec.status = review.result;
    return { ok: true, app: publicView(rec) };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- 資料存取 ---------------- */

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  const header = sheet.getRange(1, 1, 1, HEADERS.length);
  if (header.getValues()[0].join('|') !== HEADERS.join('|')) {
    header.setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readRows(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const labelToKey = {};
  Object.keys(STATUS_LABEL).forEach(k => { labelToKey[STATUS_LABEL[k]] = k; });
  return values.map((v, i) => {
    const get = h => v[COL[h] - 1];
    let data = {};
    let review = null;
    try { data = JSON.parse(get('申請資料(JSON)') || '{}'); } catch (e) { /* 略過 */ }
    try { review = get('審核資料(JSON)') ? JSON.parse(get('審核資料(JSON)')) : null; } catch (e) { /* 略過 */ }
    const created = get('申請時間');
    return {
      row: i + 2,
      id: String(get('申請編號')),
      createdAt: created instanceof Date ? created.toISOString() : String(created),
      status: labelToKey[get('狀態')] || 'pending',
      data: data, review: review,
      token: String(get('查詢碼')),
      sigId: String(get('簽名檔ID')),
      fileId: String(get('初審表檔ID')),
    };
  }).filter(r => r.id);
}

function findById(id) {
  return readRows(getSheet()).find(r => r.id === id) || null;
}

function publicView(rec) {
  const r = rec.review || {};
  return {
    id: rec.id, createdAt: rec.createdAt, status: rec.status,
    category: rec.data.category, name: rec.data.name,
    review: rec.review ? {
      result: r.result, rank: r.rank, courseType: r.courseType, installments: r.installments,
      installmentsOther: r.installmentsOther, supervisor: r.supervisor, handler: r.handler,
      noticeNo: r.noticeNo, reviewedAt: r.reviewedAt,
    } : null,
  };
}

function getFolder() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function saveDataUrl(folder, dataUrl, name, maxLen) {
  const m = /^data:([\w\/+.\-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m || m[2].length > maxLen) return '';
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
  return folder.createFile(blob).getId();
}

/* ---------------- 驗證與工具 ---------------- */

function sanitizeData(src) {
  const d = {};
  DATA_FIELDS.forEach(k => { d[k] = String(src[k] == null ? '' : src[k]).trim().slice(0, k === 'motivation' ? 2000 : 200); });
  d.idNo = d.idNo.toUpperCase();
  d.mobile = d.mobile.replace(/[^\d]/g, '');
  d.extra = {};
  const extra = src.extra || {};
  Object.keys(extra).slice(0, 10).forEach(k => { d.extra[clean(k, 30)] = String(extra[k] || '').trim().slice(0, 200); });
  return d;
}

function validate(d) {
  if (CATEGORIES.indexOf(d.category) === -1) return '請選擇身分類別';
  for (let i = 1; i <= 10; i++) if (!d['q' + i]) return '資格審核第 ' + i + ' 題尚未作答';
  if (!d.name) return '請填寫姓名';
  if (!checkTwId(d.idNo)) return '身分證號碼格式不正確';
  if (!/^09\d{8}$/.test(d.mobile)) return '行動電話格式不正確';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return 'Email 格式不正確';
  if (!d.birthDate || !d.gender || !d.address || !d.school || !d.dept || !d.motivation) return '基本資料尚未填寫完整';
  return '';
}

function eligibilityIssues(d) {
  const out = [];
  Object.keys(QUESTION_EXPECT).forEach(k => { if (d[k] && d[k] !== QUESTION_EXPECT[k]) out.push('第' + k.slice(1) + '題'); });
  if (d.confirm && d.confirm !== '是') out.push('未確定審核資格');
  return out;
}

function checkTwId(id) {
  if (!/^[A-Z][1289]\d{8}$/.test(id)) return false;
  const n = 'ABCDEFGHJKLMNPQRSTUVXYWZIO'.indexOf(id[0]) + 10;
  let sum = Math.floor(n / 10) + (n % 10) * 9;
  for (let i = 1; i < 9; i++) sum += Number(id[i]) * (9 - i);
  sum += Number(id[9]);
  return sum % 10 === 0;
}

function newId() {
  const date = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMdd');
  return 'HS' + date + '-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

function nextNoticeNo(rows, now) {
  const roc = Number(Utilities.formatDate(now, 'Asia/Taipei', 'yyyy')) - 1911;
  const prefix = roc + '原補字第';
  let max = 0;
  rows.forEach(r => {
    const no = r.review && r.review.noticeNo;
    if (no && no.indexOf(prefix) === 0) max = Math.max(max, Number(no.slice(prefix.length).replace(/\D/g, '')) || 0);
  });
  return prefix + String(max + 1).padStart(4, '0') + '號';
}

function clean(v, maxLen) {
  return String(v == null ? '' : v).trim().slice(0, maxLen || 200);
}

// 擋掉 = + - @ 開頭，避免試算表公式注入
function cell(v) {
  const s = String(v || '');
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
