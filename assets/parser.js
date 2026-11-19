'use strict';

/**
 * 初審表自動辨識：支援 Word(.docx)、PDF（文字檔或掃描檔）、圖片（拍照／掃描）。
 * 讀出文字後依「審核表」上的欄位標籤抓值，勾選框用 ■☑☒✓V 等符號判斷。
 */
const FormParser = (() => {
  const CDN = {
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    cmaps: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  };
  const ON = '■☑☒✓✔✅●◼▣◉√✗✘VvXx';
  const OFF = '□☐○◻口';
  // Word 用 Wingdings 符號插入的勾選框
  const SYM_ON = ['F0FE', 'F0FD', 'F078', 'F0FC', 'F0FB', 'F052', 'F054', 'F051', 'F050'];
  const SYM_OFF = ['F0A8', 'F06F', 'F071', 'F0A3', 'F0A1', 'F030', 'F02A'];

  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { delete loaded[src]; reject(new Error('無法載入辨識元件，請檢查網路連線')); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  /* ---------- 讀出文字 ---------- */

  async function extractText(file, onProgress = () => {}) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.docx')) { onProgress('讀取 Word 檔…'); return extractDocx(file); }
    if (name.endsWith('.doc')) throw new Error('舊版 .doc 格式無法讀取，請在 Word 另存成 .docx 或 PDF 後再上傳');
    if (name.endsWith('.pdf') || file.type === 'application/pdf') return extractPdf(file, onProgress);
    if (file.type.startsWith('image/')) return ocr(file, onProgress);
    throw new Error('不支援的檔案格式，請上傳 Word(.docx)、PDF 或圖片');
  }

  async function extractDocx(file) {
    await loadScript(CDN.jszip);
    const zip = await JSZip.loadAsync(file);
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('無法讀取 Word 檔內容');
    const doc = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
    [...doc.getElementsByTagName('mc:Fallback')].forEach(n => n.parentNode.removeChild(n));
    let out = '';
    for (const el of doc.getElementsByTagName('*')) {
      switch (el.localName) {
        case 'p': out += '\n'; break;
        case 't': if ((el.namespaceURI || '').includes('wordprocessingml')) out += el.textContent; break;
        case 'tab': case 'tc': out += ' '; break;
        case 'br': case 'cr': out += '\n'; break;
        case 'sym': {
          const c = (el.getAttribute('w:char') || '').toUpperCase();
          out += SYM_ON.includes(c) ? '■' : SYM_OFF.includes(c) ? '□' : '';
          break;
        }
        case 'checkBox': { // 舊式表單勾選框
          const kids = [...el.children];
          const chk = kids.find(k => k.localName === 'checked');
          const def = kids.find(k => k.localName === 'default');
          const on = chk ? !['0', 'false'].includes(chk.getAttribute('w:val')) : !!def && def.getAttribute('w:val') === '1';
          out += on ? '■' : '□';
          break;
        }
        default:
      }
    }
    return out;
  }

  async function extractPdf(file, onProgress) {
    onProgress('讀取 PDF…');
    await loadScript(CDN.pdfjs);
    pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer(), cMapUrl: CDN.cmaps, cMapPacked: true }).promise;
    let text = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const lines = new Map();
      content.items.forEach(it => {
        const y = Math.round(it.transform[5] / 3);
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y).push(it);
      });
      [...lines.keys()].sort((a, b) => b - a).forEach(y => {
        text += lines.get(y).sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ') + '\n';
      });
    }
    if (text.replace(/\s/g, '').length > 40) return text;

    // 掃描版 PDF：轉成圖片再做文字辨識
    let ocrText = '';
    for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      ocrText += await ocr(canvas, msg => onProgress(`第 ${p} 頁 ${msg}`)) + '\n';
    }
    return ocrText;
  }

  async function ocr(src, onProgress) {
    onProgress('載入文字辨識引擎（第一次較久）…');
    await loadScript(CDN.tesseract);
    const { data } = await Tesseract.recognize(src, 'chi_tra+eng', {
      logger: m => { if (m.status === 'recognizing text') onProgress(`文字辨識中… ${Math.round(m.progress * 100)}%`); },
    });
    return data.text;
  }

  /* ---------- 解析欄位 ---------- */

  const LABELS = [
    ['name', '姓名'],
    ['gender', '性別'],
    ['marital', '婚姻狀況'],
    ['birthDate', '出生日期'],
    ['phone', '聯絡電話'],
    ['idNo', '身[份分]證(?:號碼|字號)?'],
    ['address', '(?:聯絡|通訊|戶籍)?地址'],
    ['military', '兵役狀況'],
    ['email', 'E?-?Mail|電子(?:郵件|信箱)'],
    ['school', '最高學歷'],
    ['dept', '科系'],
  ];
  const LABEL_RE = new RegExp(LABELS.map(([k, p]) => `(?<${k}>${p})`).join('|'), 'gi');
  const HAS_LABEL = new RegExp(LABEL_RE.source, 'i');

  const ANCHORS = [
    ['q1', /本國籍/], ['q2', /年滿18歲/], ['q3', /高中職以上/], ['q4', /公費補助/],
    ['q5', /私立聯成|認證中心承辦/], ['q6', /未曾申請/], ['q7', /破壞公物/], ['q8', /缺課達/],
    ['q9', /精神官能/], ['q10', /最後審核/],
  ];

  function pick(seg, opts) {
    if (!seg) return '';
    let s = seg;
    const found = [];
    [...opts].sort((a, b) => b.length - a.length).forEach(o => {
      let i;
      while ((i = s.indexOf(o)) !== -1) {
        const prev = s[i - 1] || '';
        found.push({ o, on: ON.includes(prev), box: ON.includes(prev) || OFF.includes(prev) });
        s = s.slice(0, i) + '\u0000'.repeat(o.length) + s.slice(i + o.length);
      }
    });
    const on = [...new Set(found.filter(f => f.on).map(f => f.o))];
    if (on.length === 1) return on[0];
    // 只打了文字（例：「性別：男」）沒有勾選框
    if (!found.some(f => f.box) && found.length === 1) return found[0].o;
    return '';
  }

  function parseDate(seg) {
    if (!seg) return '';
    const m = /(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/.exec(seg) || /(\d{2,3})(\d{2})(\d{2})/.exec(seg);
    if (!m) return '';
    let y = Number(m[1]);
    if (y < 1911) y += 1911;
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1920 || y > new Date().getFullYear()) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const tidy = s => String(s || '').replace(/[_＿…‥.]{2,}|[─—]{2,}/g, '').replace(/^[■□:：\s]+|[■□\s]+$/g, '').trim();

  function parse(raw) {
    const text = String(raw || '').normalize('NFKC').replace(/\r/g, '');
    const lines = text.split('\n').map(l => l.replace(/[ \t]+/g, '')).filter(Boolean);
    const flat = lines.join('\n');
    const segs = {};

    lines.forEach((line, li) => {
      const ms = [...line.matchAll(LABEL_RE)];
      ms.forEach((m, i) => {
        const key = Object.keys(m.groups).find(k => m.groups[k] !== undefined);
        if (segs[key]) return;
        let seg = line.slice(m.index + m[0].length, i + 1 < ms.length ? ms[i + 1].index : line.length);
        if (!tidy(seg) && i === ms.length - 1 && lines[li + 1] && !HAS_LABEL.test(lines[li + 1])) seg = lines[li + 1];
        segs[key] = seg.replace(/^[:：]/, '');
      });
    });

    const v = {};
    const name = tidy(segs.name);
    if (name && name.length <= 20 && /[一-鿿A-Za-z]/.test(name)) v.name = name;
    v.gender = pick(segs.gender, ['男', '女']);
    v.marital = pick(segs.marital, ['已婚', '未婚']);
    v.birthDate = parseDate(segs.birthDate);
    v.military = pick(segs.military, ['未役', '役畢', '免役']);

    const phoneSeg = segs.phone || '';
    const home = /\(H\)([\d\-#()]{6,}?)(?=\(|行動|$)/i.exec(phoneSeg);
    if (home) v.phoneHome = home[1].replace(/\($/, '');
    const mobile = /09\d{2}-?\d{3}-?\d{3}/.exec(phoneSeg) || /09\d{2}-?\d{3}-?\d{3}/.exec(flat);
    if (mobile) v.mobile = mobile[0].replace(/-/g, '');

    const idM = /[A-Z][1289]\d{8}/.exec((segs.idNo || '').toUpperCase()) || /[A-Z][1289]\d{8}/.exec(flat.toUpperCase());
    if (idM) v.idNo = idM[0];
    const addr = tidy(segs.address);
    if (addr.length >= 4) v.address = addr;
    const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(flat);
    if (email) v.email = email[0];
    const school = tidy(String(segs.school || '').replace(/\(?學校\)?.*$/, ''));
    if (school) v.school = school;
    const dept = tidy(segs.dept);
    if (dept && dept.length <= 30) v.dept = dept;

    // 資格審核 1~10 題
    const pos = ANCHORS.map(([id, re]) => { const m = re.exec(flat); return { id, i: m ? m.index : -1 }; });
    const sectionEnd = flat.search(/二\.?填寫|填寫個人基本資料/);
    pos.forEach((p, k) => {
      if (p.i < 0) return;
      const next = pos.slice(k + 1).find(x => x.i > p.i);
      let end = next ? next.i : (sectionEnd > p.i ? sectionEnd : p.i + 150);
      end = Math.min(end, p.i + 250);
      const seg = flat.slice(p.i, end);
      v[p.id] = Number(p.id.slice(1)) >= 8 ? pick(seg, ['同意', '不同意']) : pick(seg, ['是', '否']);
    });

    const ci = flat.search(/確定審核資格/);
    if (ci >= 0) v.confirm = pick(flat.slice(ci, ci + 30), ['是', '不是']);

    const mi = flat.search(/為何會?想申請/);
    if (mi >= 0) {
      const q = flat.indexOf('?', mi);
      const start = q >= 0 && q - mi < 40 ? q + 1 : mi + 12;
      const endRel = flat.slice(start).search(/申請人親簽|三\.?專案類別/);
      const motivation = tidy(flat.slice(start, endRel >= 0 ? start + endRel : start + 500).replace(/\n/g, ''));
      if (motivation.length >= 2) v.motivation = motivation;
    }

    Object.keys(v).forEach(k => { if (!v[k]) delete v[k]; });
    return v;
  }

  return { extractText, parse };
})();
