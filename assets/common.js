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
  AUTO_REVIEW_MINUTES: 10,     // 與 google-apps-script.gs 的 AUTO_REVIEW.minutes 相同，只用來顯示提示文字
  DEMO_ADMIN_PASSWORD: 'admin1234',
  // 通知書印章：留空 = 使用程式畫的仿真印章；要換成圖檔就填路徑，例如 'assets/stamp.png'
  STAMP_IMAGE: '',
  // 核准通知單版面文字（可自行修改）
  NOTICE: {
    brand: '聯成', brandAccent: '電腦',
    subOrg: '聯成電腦認證中心｜桃竹認證中心',
    tagline: 'PROFESSIONAL TRAINING APPROVAL',
    planLine: '2026 原廠技能培訓提昇計畫・產業人才培訓補助',
    projectFull: '2026 原廠技能培訓提昇計畫－產業人才培訓補助乙案',
    badge: '2026 年度專案補助｜數位產業斜槓人才班・本梯次限額 30 名',
    quota: 30,                    // 本梯次名額，印章顯示「第 N / 30 名」
    unit: '桃竹認證中心',       // 專案審核單位
    committee: '聯成電腦認證中心・專案審核委員會',
    plans: [
      { code: 'A', price: 2880, periods: 30, items: ['先修 AI 工具', 'AutoCAD', 'SketchUp'] },
      { code: 'B', price: 3600, periods: 30, items: ['先修 AI 工具・AutoCAD・SketchUp', '室內裝修乙級證照', '5 年錄播課程卡'], tag: '完整進修', featured: true },
    ],
  },
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
      idMasked: maskId(a.data.idNo), mobile: a.data.mobile, checks: noticeChecks(a.data),
      review: r ? {
        result: r.result, rank: r.rank, courseType: r.courseType, installments: r.installments,
        installmentsOther: r.installmentsOther, supervisor: r.supervisor, handler: r.handler,
        noticeNo: r.noticeNo, reviewedAt: r.reviewedAt, score: r.score,
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

// 通知單上的「資格審核明細」：依申請人作答換算（與 google-apps-script.gs 的 noticeChecks 相同）
function noticeChecks(d) {
  d = d || {};
  const all = (...ks) => ks.every(k => d[k] === QUESTIONS.find(q => q.id === k).expect);
  return {
    c1: d.q1 === '是', c2: d.q2 === '是', c3: d.q3 === '是',
    c4: d.q4 === '否', c5: d.q6 === '是', c6: all('q7', 'q8', 'q9', 'q10'),
  };
}

function fmtMobile(m) {
  const s = String(m || '').replace(/\D/g, '');
  return s.length === 10 ? `${s.slice(0, 4)}-${s.slice(4, 7)}-${s.slice(7)}` : (m || '');
}

function rocYmd(iso) {
  const d = iso ? new Date(iso) : new Date();
  return isNaN(d) ? '' : `${d.getFullYear() - 1911} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function renderNotice(app) {
  const N = CONFIG.NOTICE;
  const r = app.review || {};
  const res = r.result;
  const ok = res === 'approved';
  const word = { approved: '核准', waitlist: '候補', rejected: '未通過' }[res] || '審核中';
  const rankTxt = res === 'rejected' ? '' : `${esc(r.rank)} / ${N.quota}`;
  const checks = app.checks;
  const CHECK_LABELS = [
    ['c1', '具本國國籍且具就業能力與意願'], ['c2', '年滿 18 歲以上之中華民國國民'],
    ['c3', '高中職以上畢業'], ['c4', '一年內未參加政府公費補助訓練課程'],
    ['c5', '二年內未曾申請相關原廠補助課程'], ['c6', '同意受訓規範、證書核發及退訓規定'],
  ];
  const chk = (k) => !checks || !(k in checks) ? '<span class="nt-ok">✓ 符合</span>'
    : checks[k] ? '<span class="nt-ok">✓ 符合</span>' : '<span class="nt-no">待確認</span>';
  const step = (en, zh, state, txt) => `
      <div class="nt-step nt-${state}">
        <div class="nt-dot">${state === 'final' ? '★' : state === 'fail' ? '✕' : '✓'}</div>
        <div class="nt-en">${en}</div>
        <div class="nt-zh">${zh}<b>${txt}</b></div>
      </div>`;
  const s3 = res === 'rejected' ? step('APPROVAL', '最終核定', 'fail', '未通過') : step('APPROVAL', '最終核定', 'final', word);
  const money = (n) => 'NT$ ' + Number(n).toLocaleString();
  const plans = ok ? `
    <h3 class="nt-h">核定補助方案</h3>
    <div class="nt-plans">${N.plans.map(p => `
      <div class="nt-plan${p.featured ? ' nt-feat' : ''}">
        ${p.tag ? `<span class="nt-tag">${esc(p.tag)}</span>` : ''}
        <div class="nt-pcode">PLAN ${esc(p.code)}</div>
        <div class="nt-price">${money(p.price)}<small>／期 × ${p.periods} 期</small></div>
        <div class="nt-total">合計 ${money(p.price * p.periods)}</div>
        <ul>${p.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        <div class="nt-pick"><span class="nt-cb"></span>選擇 ${esc(p.code)} 方案</div>
      </div>`).join('')}
    </div>` : '';
  const intro = ok
    ? `經查核申請資格、親簽文件及就業顧問初審評分合格，特此通知審核結果與核定補助方案。`
    : res === 'waitlist'
      ? `經查核申請資格及就業顧問初審評分，列為候補第 ${esc(r.rank)} 名；如有名額釋出，本中心將依候補順序以電話或 Email 通知。`
      : `經查核申請資格，資格不符本專案補助條件，歉難同意，敬請見諒。如有其他課程需求，歡迎洽詢本中心專員。`;
  const notes = ok
    ? `1. 名次及方案以本中心最終審核為準，本中心於開課前保有最後審核之權利。　2. 審核通過後請於 ${CONFIG.REPORT_DAYS} 日內繳交報名費 NT$${CONFIG.REG_FEE.toLocaleString()}（已繳審核手續費 NT$${CONFIG.REVIEW_FEE} 元可抵扣）。　3. 缺課達總時數 1/3（含）以上、退訓或各科考試成績低於 60 分者，不發給原廠認證證書。　4. 請勿惡意取消，如有此情形將列入原廠及企業之黑名單，爾後將影響面試機會。`
    : `1. 本通知以本中心審核結果為準。　2. 聯絡方式如有異動，請主動告知本中心。`;
  return `
  <article class="notice nt" id="noticeDoc">
    <header class="nt-top">
      <div>
        <div class="nt-brand">${esc(N.brand)}<span>${esc(N.brandAccent)}</span></div>
        <div class="nt-sub">${esc(N.subOrg)}</div>
      </div>
      <div class="nt-topr">
        <div class="nt-tagline">${esc(N.tagline)}</div>
        <div class="nt-planline">${esc(N.planLine)}</div>
        <div class="nt-case">案號　<span>${esc(r.noticeNo || app.id)}</span></div>
      </div>
    </header>
    <div class="nt-bar"></div>
    <div class="nt-body">
      <div class="nt-hero">
        <div class="nt-herol">
          <div class="nt-badge">● ${esc(N.badge)}</div>
          <h1>專案培訓補助<br>資格審核結果通知單</h1>
          <p class="nt-intro">茲核定申請人 <u>${esc(app.name)}</u> 參加本中心「${esc(N.projectFull)}」，${intro}</p>
        </div>
        ${res === 'rejected' ? '' : (CONFIG.STAMP_IMAGE ? `<img class="nt-stamp" src="${esc(CONFIG.STAMP_IMAGE)}" alt="印章">` : renderRankStamp(res, r.rank, N.quota))}
      </div>
      <div class="nt-info">
        <div><label>申請人</label><b class="nt-name">${esc(app.name)}</b></div>
        <div><label>身分證號碼</label><b>${esc(app.idMasked || '—')}</b></div>
        <div><label>聯絡手機</label><b>${esc(fmtMobile(app.mobile) || '—')}</b></div>
        <div><label>培訓類組</label><b>${esc(r.courseType || app.category || '—')}</b></div>
      </div>
      <div class="nt-steps">
        ${step('QUALIFICATION', '資格審查', res === 'rejected' ? 'fail' : 'done', res === 'rejected' ? '不符' : '通過')}
        ${step('ASSESSMENT', '顧問初審', res === 'rejected' ? 'off' : 'done', res === 'rejected' ? '—' : '通過')}
        ${s3}
      </div>
      <h3 class="nt-h">資格審核明細</h3>
      <div class="nt-checks">
        ${CHECK_LABELS.map(([k, t]) => `<div><span>${t}</span>${chk(k)}</div>`).join('')}
        <div class="nt-score"><span>學習意願評分（1～10 分）</span><b>${r.score ? esc(r.score) + ' 分' : '—'}</b>${String(r.score) === '10' ? '<small>（滿分）</small>' : ''}</div>
      </div>
      ${plans}
      <div class="nt-sign">
        <div><label>參訓人親簽</label><div class="nt-line"></div></div>
        <div><label>專案審核單位</label><b>${esc(N.unit)}</b>${res === 'rejected' ? '' : `<div class="nt-${ok ? 'pass' : 'wait'}">✓ 審核${word}（${rankTxt}）</div>`}</div>
        <div><label>審核日期</label><b>${esc(rocYmd(r.reviewedAt))}</b></div>
      </div>
      <div class="nt-notes"><b>注意事項</b>　${notes}</div>
    </div>
    <footer class="nt-foot"><span>${esc(N.committee)}</span><span>本通知單經審核單位核定後生效</span></footer>
  </article>`;
}

/* ---------------- 名次印章（SVG，純視覺用） ---------------- */
let stampSeq = 0;
function renderRankStamp(result, rank, quota) {
  const id = 'stk' + (++stampSeq);
  const word = result === 'approved' ? '核准' : '候補';
  const en = result === 'approved' ? 'APPROVED' : 'WAITLIST';
  return `
  <svg class="nt-stamp" viewBox="0 0 200 200" role="img" aria-label="${word}章">
    <defs>
      <filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${stampSeq * 7}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2"/></filter>
      <path id="${id}t" d="M 45,100 A 55,55 0 0 1 155,100"/>
    </defs>
    <g fill="none" stroke="#c8102e" filter="url(#${id})">
      <circle cx="100" cy="100" r="94" stroke-width="3.5"/>
      <circle cx="100" cy="100" r="84" stroke-width="1.4" stroke-dasharray="3 3"/>
      <g fill="#c8102e" stroke="none" font-family="'Noto Sans TC','Microsoft JhengHei',sans-serif" font-weight="900">
        <text font-size="15" letter-spacing="3"><textPath href="#${id}t" startOffset="50%" text-anchor="middle">${en}</textPath></text>
        <text x="100" y="118" font-size="46" text-anchor="middle" letter-spacing="4">${word}</text>
        <text x="100" y="152" text-anchor="middle" font-size="15">第 <tspan font-size="28">${esc(rank)}</tspan> / ${quota} 名</text>
      </g>
    </g>
  </svg>`;
}

/* ---------------- 仿真印章（SVG，純視覺用） ---------------- */
function renderStamp(word, iso) {
  const id = 'stk' + (++stampSeq);
  const d = iso ? new Date(iso) : new Date();
  const date = `${d.getFullYear() - 1911}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
  const org = CONFIG.ORG_NAME;
  return `
  <svg class="notice-stamp-svg" viewBox="0 0 200 200" role="img" aria-label="${esc(org)} ${esc(word)}章">
    <defs>
      <filter id="${id}">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${stampSeq * 7}" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="3"/>
        <feComponentTransfer><feFuncA type="table" tableValues="0 0.75 0.95 0.85"/></feComponentTransfer>
      </filter>
      <path id="${id}t" d="M 38,100 A 62,62 0 0 1 162,100"/>
      <path id="${id}b" d="M 26,100 A 74,74 0 0 0 174,100"/>
    </defs>
    <g fill="none" stroke="#d0141f" filter="url(#${id})">
      <circle cx="100" cy="100" r="93" stroke-width="6"/>
      <circle cx="100" cy="100" r="85" stroke-width="1.6"/>
      <g fill="#d0141f" stroke="none" font-family="'Noto Serif TC','DFKai-SB','BiauKai','PMingLiU',serif" font-weight="900">
        <text font-size="19"><textPath href="#${id}t" startOffset="50%" text-anchor="middle" textLength="176" lengthAdjust="spacing">${esc(org)}</textPath></text>
        <text x="100" y="122" font-size="46" text-anchor="middle" letter-spacing="2">${esc(word)}</text>
        <text font-size="15" font-weight="700"><textPath href="#${id}b" startOffset="50%" text-anchor="middle">★ ${date} ★</textPath></text>
      </g>
    </g>
  </svg>`;
}

/* ---------------- 原版格式審核表（依紙本初審表排版，可列印） ---------------- */
function renderOriginalForm(app) {
  const d = app.data || {};
  const r = app.review || {};
  const box = (on) => `<span class="of-box">${on ? '☑' : '□'}</span>`;
  const opt = (val, label) => `${box(d[val[0]] === val[1])}${label || val[1]}`;
  const ymd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? [Number(m[1]) - 1911, Number(m[2]), Number(m[3])] : ['', '', '']; };
  const [fy, fm, fd] = ymd(d.fillDate);
  const [by, bm, bd] = ymd(d.birthDate);
  const v = (s) => `<span class="of-val">${esc(s || '')}</span>`;
  const qRows = QUESTIONS.map((q, i) => {
    const opts = q.type === 'agree' ? ['同意', '不同意'] : ['是', '否'];
    const bad = q.expect && d[q.id] && d[q.id] !== q.expect;
    return `<tr class="${bad ? 'of-bad' : ''}"><td class="of-n">${i + 1}.</td><td class="of-qt">${esc(q.text)}</td>
      ${opts.map(o => `<td class="of-opt">${box(d[q.id] === o)}${o}</td>`).join('')}</tr>`;
  }).join('');
  const inst = ['6', '12', '18', '24'].map(n => `${box(r.installments === n)}${n} 期`).join('　');
  return `
  <article class="of" id="formDoc">
    <h1 class="of-title">${esc(CONFIG.PROGRAM_NAME)}資格審核表</h1>
    <div class="of-note">☞說明：以下各欄請詳實填寫，經查證如有虛偽不實者，視同放棄並自行負責。<span class="of-id">申請編號：${esc(app.id || '')}｜身分類別：${esc(d.category || '')}</span></div>
    <div class="of-bar"><span>一.資格審核</span><span>■填表日期：${v(fy)} 年 ${v(fm)} 月 ${v(fd)} 日</span></div>
    <table class="of-q">${qRows}</table>
    <img class="of-logos" src="assets/img/partners.png" alt="原廠授權訓練中心">
    <div class="of-bar">二.填寫個人基本資料</div>
    <table class="of-t">
      <tr><td><b>■姓　　名：</b>${v(d.name)}</td><td><b>■性　　別：</b>${opt(['gender', '男'])}　${opt(['gender', '女'])}</td><td><b>■婚姻狀況：</b>${opt(['marital', '已婚'])}　${opt(['marital', '未婚'])}</td></tr>
      <tr><td><b>■出生日期：</b>${v(by)} 年 ${v(bm)} 月 ${v(bd)} 日</td><td colspan="2"><b>■聯絡電話：</b>(H) ${v(d.phoneHome)}　（行動電話）${v(d.mobile)}</td></tr>
      <tr><td><b>■身份證號碼：</b>${v(d.idNo)}</td><td colspan="2"><b>■聯絡地址：</b>${v(d.address)}</td></tr>
      <tr><td><b>■兵役狀況：</b>${opt(['military', '未役'])} ${opt(['military', '役畢'])} ${opt(['military', '免役'])}</td><td colspan="2"><b>■Mail：</b>${v(d.email)}</td></tr>
      <tr><td><b>■最高學歷：</b>${v(d.school)}（學校）</td><td colspan="2"><b>■科　系：</b>${v(d.dept)}</td></tr>
    </table>
    <div class="of-small">＊應繳證件：（一）身份證件　（二）審核費手續費 ${CONFIG.REVIEW_FEE} 元（若審核通過需繳交報名費 ${CONFIG.REG_FEE} 元，可扣抵手續費 ${CONFIG.REVIEW_FEE} 元）</div>
    <div class="of-small">＊您是否以充份了解整個訓練內容、學員權益…等，且已確定審核資格：${opt(['confirm', '是'])}　${opt(['confirm', '不是'])}</div>
    <div class="of-small">＊請培訓申請人勿惡意取消，如有此狀況將列入原廠及企業之黑名單，爾後將影響面試機會。</div>
    <div class="of-red">※此專案是針對就業、外包及考照能力的提升。請問您為何會想申請專案？</div>
    <div class="of-motive">${esc(d.motivation || '').replace(/\n/g, '<br>')}</div>
    <div class="of-sign">申請人親簽：${app.signature ? `<img src="${esc(app.signature)}" alt="簽名">` : '<span class="of-line"></span>'}</div>
    <div class="of-bar">三.專案類別 <b>（中心填寫）</b></div>
    <div class="of-c">●　申請專案課程類別：${v(r.courseType)}</div>
    <div class="of-c">●　分期期數：${inst}　${box(r.installments === '其它')}其它 ${v(r.installments === '其它' ? r.installmentsOther : '')}</div>
    <div class="of-bar">四.審核結果 <b>（原廠建議）</b></div>
    <table class="of-r">
      <tr><td colspan="2" class="of-big">${box(r.result === 'approved')}核准　第 ${v(r.result === 'approved' ? r.rank : '')} 名</td>
          <td class="of-big">${box(r.result === 'waitlist')}待核　候補第 ${v(r.result === 'waitlist' ? r.rank : '')} 名<br>${box(r.result === 'rejected')}資格不符・婉拒</td></tr>
      <tr class="of-h"><td>單位主管</td><td>經辦人</td><td>學習意願評分（1-10 分）</td></tr>
      <tr class="of-s"><td>${esc(r.supervisor || '')}</td><td>${esc(r.handler || '')}</td><td>${esc(r.score || '')}</td></tr>
    </table>
  </article>`;
}

/* ---------------- 頁面內確認框（取代瀏覽器 confirm／alert，避免被瀏覽器擋掉） ---------------- */
function askConfirm(message, { okText = '確定', cancelText = '取消', alertOnly = false } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'dlg';
    wrap.innerHTML = `<div class="dlg-box" role="dialog" aria-modal="true">
      <div class="dlg-msg"></div>
      <div class="dlg-btns">${alertOnly ? '' : `<button type="button" class="btn btn-ghost" data-v="0">${esc(cancelText)}</button>`}
        <button type="button" class="btn" data-v="1">${esc(okText)}</button></div></div>`;
    wrap.querySelector('.dlg-msg').textContent = message;
    const done = v => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    wrap.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-v="1"]').focus();
  });
}

/* ---------------- 列印：只印指定文件，自動縮放成一頁 A4 直式 ---------------- */
function printDoc(selector) {
  const src = document.querySelector(selector);
  if (!src) return;
  let area = document.getElementById('printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  const clone = src.cloneNode(true);
  clone.removeAttribute('id');
  clone.style.zoom = 1;
  area.innerHTML = '';
  area.appendChild(clone);

  // 先在螢幕外量出原尺寸，再算出塞進 A4 可列印範圍（194mm × 281mm）的縮放比例
  const MM = 96 / 25.4;
  const pageW = 194 * MM;
  const pageH = 281 * MM - 4;
  area.style.cssText = 'display:block;position:absolute;left:-10000px;top:0;width:' + pageW + 'px';
  const isForm = clone.classList.contains('of');
  if (isForm) { clone.style.padding = '0'; clone.style.border = '0'; }
  const w = isForm ? clone.offsetWidth : pageW;
  const zoomW = pageW / w;
  clone.style.zoom = zoomW;
  const h = clone.getBoundingClientRect().height;
  clone.style.zoom = Math.min(zoomW, zoomW * pageH / h);
  area.style.cssText = '';

  document.body.classList.add('printing');
  const cleanup = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 50);
}
