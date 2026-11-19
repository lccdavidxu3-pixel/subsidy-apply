'use strict';

/* =========================================================
 * 設定：部署好 google-apps-script.gs 後，把網址貼到 API_URL。
 * API_URL 留空 = 示範模式（資料只存在這台電腦的瀏覽器，方便測試整個流程）。
 * ========================================================= */
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwbuB9CSGnz9Zp8iEm1nAzy5BwAfpTw499unKhnF7hlsqqFoeWRyGk3FnRHSnSlbXx5/exec',
  ORG_NAME: '聯成電腦國際認證中心',
  PROGRAM_NAME: '高階原廠補助',
  REPORT_DAYS: 7,              // 核准後幾日內需辦理報名
  REG_FEE: 1000,               // 報名費
  REVIEW_FEE: 300,             // 審核手續費
  POLL_SECONDS: 15,            // 「審核申請中」頁面自動檢查間隔
  DEMO_ADMIN_PASSWORD: 'admin1234',
};

const CATEGORIES = [
  {
    key: '待業', icon: '🔍', desc: '目前未就業，正在尋找工作機會',
    extra: [
      { name: 'leaveDate', label: '離職（最後工作）日期', type: 'date' },
      { name: 'lastJob', label: '前一份工作職務', type: 'text', placeholder: '例：行政助理' },
    ],
  },
  {
    key: '職業軍人', icon: '🎖️', desc: '現役或即將退伍之志願役官士兵',
    extra: [
      { name: 'branch', label: '軍種／單位', type: 'text', placeholder: '例：陸軍' },
      { name: 'retireDate', label: '（預計）退伍日期', type: 'date' },
    ],
  },
  {
    key: '二度就業', icon: '🔄', desc: '曾離開職場一段時間，準備重返職場',
    extra: [
      { name: 'leavePeriod', label: '離開職場期間', type: 'text', placeholder: '例：2020/03～2025/08' },
      { name: 'leaveReason', label: '離開職場原因', type: 'text', placeholder: '例：育兒、照顧家人' },
    ],
  },
  {
    key: '技能升級', icon: '📈', desc: '在職者提升專業技能、取得國際認證',
    extra: [
      { name: 'company', label: '目前任職公司', type: 'text' },
      { name: 'jobTitle', label: '職稱', type: 'text' },
    ],
  },
];

const QUESTIONS = [
  { id: 'q1', type: 'yn', expect: '是', text: '您是否為本國籍且具就業能力與意願者' },
  { id: 'q2', type: 'yn', expect: '是', text: '您是否為年滿 18 歲以上之中華民國國民' },
  { id: 'q3', type: 'yn', expect: '是', text: '您是否為高中職以上畢業' },
  { id: 'q4', type: 'yn', expect: null, text: '您曾在一年內參加過政府舉辦之公費補助訓練課程嗎' },
  { id: 'q5', type: 'yn', expect: '是', text: `您已知本案為私立${CONFIG.ORG_NAME}承辦，可認證地點為全台聯成認證中心` },
  { id: 'q6', type: 'yn', expect: '是', text: '本人於二年內並未曾申請過相關原廠補助課程' },
  { id: 'q7', type: 'yn', expect: '是', text: '受訓期間，不得有破壞公物、吃檳榔、衣衫不整、於公開場合抽煙或其他影響上課之行為' },
  { id: 'q8', type: 'agree', expect: '同意', text: '受訓期間缺課達訓練總時數 1/3（含）以上、退訓、訓練成績不合格者（成績不合格指各科考試成績低於 60 分者）不發給原廠認證證書' },
  { id: 'q9', type: 'agree', expect: '同意', text: '雖經錄取或註冊，如經查患有精神官能障礙疾病不適上課者，依規定將予以退訓' },
  { id: 'q10', type: 'agree', expect: '同意', text: '本中心於開課前保有最後審核之權利' },
];

const STATUS = {
  pending: { label: '審核中', cls: 'st-pending' },
  approved: { label: '核准', cls: 'st-approved' },
  waitlist: { label: '候補', cls: 'st-waitlist' },
  rejected: { label: '資格不符', cls: 'st-rejected' },
};

/* ---------------- 小工具 ---------------- */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function rocDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return '';
  return `中華民國 ${d.getFullYear() - 1911} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function rocShort(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${Number(m[1]) - 1911} 年 ${Number(m[2])} 月 ${Number(m[3])} 日` : (ymd || '');
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function checkTwId(id) {
  id = String(id || '').trim().toUpperCase();
  if (!/^[A-Z][1289]\d{8}$/.test(id)) return false;
  const n = 'ABCDEFGHJKLMNPQRSTUVXYWZIO'.indexOf(id[0]) + 10;
  let sum = Math.floor(n / 10) + (n % 10) * 9;
  for (let i = 1; i < 9; i++) sum += Number(id[i]) * (9 - i);
  sum += Number(id[9]);
  return sum % 10 === 0;
}

function maskId(id) {
  id = String(id || '');
  return id.length === 10 ? id.slice(0, 3) + '****' + id.slice(7) : id;
}

function eligibilityIssues(d) {
  const out = [];
  QUESTIONS.forEach((q, i) => { if (q.expect && d[q.id] && d[q.id] !== q.expect) out.push(`第${i + 1}題`); });
  if (d.confirm && d.confirm !== '是') out.push('未確定審核資格');
  return out;
}

function installmentText(r) {
  if (!r || !r.installments) return '';
  return r.installments === '其它' ? (r.installmentsOther || '其它') : `${r.installments} 期`;
}

/* ---------------- API（Apps Script 或示範模式） ---------------- */

const API = {
  get demo() { return !CONFIG.API_URL; },
  async call(action, payload = {}) {
    if (this.demo) {
      await new Promise(r => setTimeout(r, 350));
      return JSON.parse(JSON.stringify(DemoBackend[action](payload)));
    }
    let res;
    try {
      res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, payload)),
      });
    } catch (e) {
      throw new Error('無法連線到伺服器，請稍後再試');
    }
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '發生錯誤');
    return j;
  },
};

// 示範模式：用 localStorage 模擬後端，邏輯與 google-apps-script.gs 相同
const DemoBackend = {
  KEY: 'hs_demo_apps',
  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch (e) { return []; }
  },
  save(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); } catch (e) { throw new Error('瀏覽器儲存空間不足（示範模式）'); }
  },
  admin(p) { if (p.password !== CONFIG.DEMO_ADMIN_PASSWORD) throw new Error('管理密碼錯誤'); },
  publicView(a) {
    const r = a.review;
    return {
      id: a.id, createdAt: a.createdAt, status: a.status, category: a.data.category, name: a.data.name,
      review: r ? {
        result: r.result, rank: r.rank, courseType: r.courseType, installments: r.installments,
        installmentsOther: r.installmentsOther, supervisor: r.supervisor, handler: r.handler,
        noticeNo: r.noticeNo, reviewedAt: r.reviewedAt,
      } : null,
    };
  },
  submit({ data, signature, file }) {
    const errs = validateApplication(data);
    if (errs.length) throw new Error(errs[0].msg);
    const list = this.load();
    const d = new Date();
    let id;
    do {
      id = `HS${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    } while (list.some(a => a.id === id));
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    list.push({
      id, token, createdAt: d.toISOString(), status: 'pending',
      data: Object.assign({}, data, { idNo: data.idNo.toUpperCase() }),
      signature, file: file && file.dataUrl.length < 1500000 ? file : (file ? { name: file.name } : null),
      review: null,
    });
    this.save(list);
    return { ok: true, id, token };
  },
  status({ id, token, idNo }) {
    const a = this.load().find(x => x.id === String(id || '').trim().toUpperCase());
    if (!a) throw new Error('查無此申請編號');
    if (!(token && token === a.token) && !(idNo && String(idNo).trim().toUpperCase() === a.data.idNo)) throw new Error('申請編號與身分證號不符');
    return { ok: true, app: this.publicView(a) };
  },
  adminList(p) {
    this.admin(p);
    return {
      ok: true,
      apps: this.load().reverse().map(a => ({
        id: a.id, createdAt: a.createdAt, category: a.data.category, name: a.data.name, mobile: a.data.mobile,
        email: a.data.email, status: a.status, issues: eligibilityIssues(a.data), review: a.review,
      })),
    };
  },
  adminGet(p) {
    this.admin(p);
    const a = this.load().find(x => x.id === p.id);
    if (!a) throw new Error('查無此申請');
    return {
      ok: true,
      app: {
        id: a.id, createdAt: a.createdAt, status: a.status, data: a.data, review: a.review, signature: a.signature,
        fileUrl: a.file && a.file.dataUrl ? a.file.dataUrl : '', fileName: a.file ? a.file.name : '',
        issues: eligibilityIssues(a.data),
      },
    };
  },
  adminReview(p) {
    this.admin(p);
    const r = p.review || {};
    if (!['approved', 'waitlist', 'rejected'].includes(r.result)) throw new Error('請選擇審核結果');
    if (r.result !== 'rejected' && !/^\d+$/.test(r.rank || '')) throw new Error('請填寫名次');
    if (r.result === 'approved' && !r.courseType) throw new Error('核准前請填寫專案課程類別');
    const list = this.load();
    const a = list.find(x => x.id === p.id);
    if (!a) throw new Error('查無此申請');
    const now = new Date();
    const prefix = `${now.getFullYear() - 1911}原補字第`;
    const max = list.reduce((m, x) => {
      const no = x.review && x.review.noticeNo;
      return no && no.startsWith(prefix) ? Math.max(m, Number(no.slice(prefix.length).replace(/\D/g, '')) || 0) : m;
    }, 0);
    a.review = Object.assign({}, r, {
      reviewedAt: now.toISOString(),
      noticeNo: (a.review && a.review.noticeNo) || `${prefix}${String(max + 1).padStart(4, '0')}號`,
    });
    a.status = r.result;
    this.save(list);
    return { ok: true, app: this.publicView(a) };
  },
};

/* ---------------- 表單驗證 ---------------- */

function validateApplication(d) {
  const errs = [];
  const add = (field, msg) => errs.push({ field, msg });
  if (!CATEGORIES.some(c => c.key === d.category)) add('category', '請選擇身分類別');
  QUESTIONS.forEach((q, i) => { if (!d[q.id]) add(q.id, `資格審核第 ${i + 1} 題尚未作答`); });
  if (!d.name) add('name', '請填寫姓名');
  if (!d.gender) add('gender', '請選擇性別');
  if (!d.birthDate) add('birthDate', '請填寫出生日期');
  if (!/^09\d{8}$/.test(String(d.mobile || '').replace(/\D/g, ''))) add('mobile', '行動電話格式不正確（09 開頭共 10 碼）');
  if (!checkTwId(d.idNo)) add('idNo', '身分證號碼格式不正確');
  if (!d.address) add('address', '請填寫聯絡地址');
  if (d.gender === '男' && !d.military) add('military', '請選擇兵役狀況');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || '')) add('email', 'Email 格式不正確');
  if (!d.school) add('school', '請填寫最高學歷（學校）');
  if (!d.dept) add('dept', '請填寫科系');
  if (!d.motivation || d.motivation.trim().length < 5) add('motivation', '請填寫申請動機（至少 5 個字）');
  if (!d.confirm) add('confirm', '請確認是否已了解訓練內容並確定審核資格');
  return errs;
}

/* ---------------- 審核表（後台檢視用） ---------------- */

function renderApplicationSheet(app) {
  const d = app.data;
  const cat = CATEGORIES.find(c => c.key === d.category);
  const ans = (q) => {
    const v = d[q.id] || '—';
    const bad = q.expect && d[q.id] && d[q.id] !== q.expect;
    return `<span class="ans ${bad ? 'ans-bad' : ''}">${esc(v)}</span>`;
  };
  const extraRows = cat ? cat.extra.map(f => `<tr><th>${esc(f.label)}</th><td colspan="3">${esc((d.extra || {})[f.name] || '—')}</td></tr>`).join('') : '';
  return `
  <div class="sheet">
    <h2 class="sheet-title">${esc(CONFIG.PROGRAM_NAME)}資格審核表</h2>
    <div class="sheet-meta"><span>申請編號：${esc(app.id)}</span><span>身分類別：<b>${esc(d.category)}</b></span><span>填表日期：${esc(rocShort(d.fillDate))}</span></div>
    <h3 class="sheet-h">一、資格審核</h3>
    <ol class="sheet-q">${QUESTIONS.map(q => `<li><span>${esc(q.text)}</span>${ans(q)}</li>`).join('')}</ol>
    <h3 class="sheet-h">二、個人基本資料</h3>
    <table class="sheet-t">
      <tr><th>姓名</th><td>${esc(d.name)}</td><th>性別／婚姻</th><td>${esc(d.gender)}／${esc(d.marital || '—')}</td></tr>
      <tr><th>出生日期</th><td>${esc(rocShort(d.birthDate))}</td><th>聯絡電話</th><td>(H) ${esc(d.phoneHome || '—')}<br>行動 ${esc(d.mobile)}</td></tr>
      <tr><th>身分證號碼</th><td>${esc(d.idNo)}</td><th>聯絡地址</th><td>${esc(d.address)}</td></tr>
      <tr><th>兵役狀況</th><td>${esc(d.military || '—')}</td><th>Mail</th><td>${esc(d.email)}</td></tr>
      <tr><th>最高學歷</th><td>${esc(d.school)}</td><th>科系</th><td>${esc(d.dept)}</td></tr>
      ${extraRows}
    </table>
    <h3 class="sheet-h">申請動機（為何會想申請專案）</h3>
    <p class="sheet-p">${esc(d.motivation).replace(/\n/g, '<br>')}</p>
    <div class="sheet-sign">
      <div>已充分了解訓練內容、學員權益並確定審核資格：<b>${esc(d.confirm)}</b></div>
      <div class="sig-box">申請人親簽：${app.signature ? `<img src="${esc(app.signature)}" alt="簽名">` : '<span class="muted">（無簽名檔）</span>'}</div>
    </div>
  </div>`;
}

/* ---------------- 通知書 ---------------- */

function renderNotice(app) {
  const r = app.review || {};
  const titles = { approved: '核准通知書', waitlist: '候補通知書', rejected: '審核結果通知書' };
  let subject = '';
  let items = [];
  if (r.result === 'approved') {
    subject = `台端申請「${CONFIG.PROGRAM_NAME}」專案（身分類別：${app.category}），經本中心資格審核，<b>核准第 ${esc(r.rank)} 名</b>，特此通知。`;
    items = [
      `專案課程類別：<b>${esc(r.courseType)}</b>`,
      installmentText(r) ? `分期期數：<b>${esc(installmentText(r))}</b>` : '',
      `請於收到本通知書起 ${CONFIG.REPORT_DAYS} 日內，攜帶身分證件正本至本中心辦理報名手續；報名費 ${CONFIG.REG_FEE.toLocaleString()} 元，已繳之審核手續費 ${CONFIG.REVIEW_FEE} 元可扣抵。`,
      '受訓期間缺課達訓練總時數 1/3（含）以上、退訓或訓練成績不合格者，不發給原廠認證證書。',
      '逾期未辦理報名者視同放棄，名額將由候補人員依序遞補。',
    ];
  } else if (r.result === 'waitlist') {
    subject = `台端申請「${CONFIG.PROGRAM_NAME}」專案（身分類別：${app.category}），經本中心資格審核，<b>列為候補第 ${esc(r.rank)} 名</b>。`;
    items = [
      r.courseType ? `申請專案課程類別：${esc(r.courseType)}` : '',
      '如有名額釋出，本中心將依候補順序以電話或 Email 通知，屆時再請辦理報名手續。',
      '候補期間如聯絡方式有異動，請主動告知本中心。',
    ];
  } else {
    subject = `台端申請「${CONFIG.PROGRAM_NAME}」專案（身分類別：${app.category}），經本中心資格審核，<b>資格不符本專案補助條件</b>，歉難同意，敬請見諒。`;
    items = ['感謝您對本中心課程的支持，如有其他課程需求，歡迎洽詢本中心專員。'];
  }
  items = items.filter(Boolean);
  return `
  <article class="notice" id="noticeDoc">
    <header class="notice-head">
      <div class="notice-org">${esc(CONFIG.ORG_NAME)}</div>
      <h1>${esc(CONFIG.PROGRAM_NAME)}資格審核　${titles[r.result] || '通知書'}</h1>
    </header>
    <table class="notice-meta">
      <tr><th>發文日期</th><td>${esc(rocDate(r.reviewedAt))}</td><th>發文字號</th><td>${esc(r.noticeNo || '')}</td></tr>
      <tr><th>受文者</th><td>${esc(app.name)} 君</td><th>申請編號</th><td>${esc(app.id)}</td></tr>
    </table>
    <p class="notice-subject"><span class="lbl">主旨：</span>${subject}</p>
    <div class="notice-body"><span class="lbl">說明：</span><ol>${items.map(i => `<li>${i}</li>`).join('')}</ol></div>
    <footer class="notice-foot">
      <div class="notice-signs">
        <div>單位主管：<span>${esc(r.supervisor || '')}</span></div>
        <div>經辦人：<span>${esc(r.handler || '')}</span></div>
      </div>
      <div class="notice-stamp">${esc(CONFIG.ORG_NAME)}<br>資格審核專用章</div>
    </footer>
  </article>`;
}
