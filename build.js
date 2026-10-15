#!/usr/bin/env node
/**
 * 법무법인 서상 홈페이지 빌드 스크립트
 * - 외부 패키지 없이 Node.js(18 이상)만으로 동작합니다.
 * - content/ 폴더의 마크다운·JSON을 읽어 dist/ 폴더에 정적 사이트를 만듭니다.
 *
 * 사용법
 *   node build.js           → dist/ 생성
 *   node build.js --serve   → 생성 후 http://localhost:4321 에서 미리보기
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const CONTENT = path.join(ROOT, 'content');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');
const PUBLIC = path.join(ROOT, 'public');

/* ───────────────────────── 1. 파일 읽기 ───────────────────────── */

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 아주 작은 YAML 해석기 (프론트매터용: 문자열, 숫자, true/false, 목록, 여러 줄 문자열)
function parseYaml(src) {
  const out = {};
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    let val = m[2].trim();
    if (val === '' ) {
      // 목록 또는 빈 값
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(scalar(lines[j].replace(/^\s*-\s+/, '')));
        j++;
      }
      out[key] = items.length ? items : '';
      i = j;
      continue;
    }
    if (/^[|>][-+]?$/.test(val)) {
      const folded = val[0] === '>';
      const buf = [];
      let j = i + 1;
      while (j < lines.length && (/^\s+\S/.test(lines[j]) || lines[j].trim() === '')) {
        buf.push(lines[j].replace(/^\s{2}/, ''));
        j++;
      }
      while (buf.length && buf[buf.length - 1].trim() === '') buf.pop();
      out[key] = folded ? buf.map(s => s.trim()).join(' ').replace(/\s+/g, ' ').trim() : buf.join('\n');
      i = j;
      continue;
    }
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      out[key] = inner ? inner.split(',').map(s => scalar(s.trim())) : [];
      i++;
      continue;
    }
    out[key] = scalar(val);
    i++;
  }
  return out;
}

function scalar(v) {
  v = String(v).trim();
  if ((v.startsWith('"') && v.endsWith('"'))) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  if ((v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1).replace(/''/g, "'");
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

function readMarkdownFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const data = m ? parseYaml(m[1]) : {};
  const body = (m ? m[2] : raw).trim();
  return { data, body, raw };
}

function readCollection(name) {
  const dir = path.join(CONTENT, name);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const { data, body, raw } = readMarkdownFile(path.join(dir, f));
      const slug = data.slug || f.replace(/\.md$/, '');
      return { slug, data, body, raw, html: md(body) };
    })
    .filter(item => item.data.draft !== true);
}

/* ───────────────────────── 2. 마크다운 → HTML ───────────────────────── */

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(text) {
  let s = esc(text);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
    const ext = /^https?:/.test(u);
    return `<a href="${u}"${ext ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${codes[n]}</code>`);
  return s;
}

function headingId(text) {
  return String(text).trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function md(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isBlockStart = l =>
    /^#{1,6}\s/.test(l) || /^>\s?/.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) ||
    /^(-{3,}|\*{3,})\s*$/.test(l) || /^\|/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      const level = m[1].length;
      out.push(`<h${level} id="${headingId(m[2])}">${inline(m[2])}</h${level}>`);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${md(buf.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const head = row(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(row(lines[i])); i++; }
      out.push('<div class="table-wrap"><table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') +
        '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    const ulRe = /^\s*[-*]\s+/, olRe = /^\s*\d+\.\s+/;
    if (ulRe.test(line) || olRe.test(line)) {
      const ordered = olRe.test(line);
      const re = ordered ? olRe : ulRe;
      const items = [];
      while (i < lines.length && (re.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (re.test(lines[i])) items.push(lines[i].replace(re, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map(it => `<li>${inline(it)}</li>`).join('') + `</${tag}>`);
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { buf.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

function plain(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/* ───────────────────────── 3. 데이터 불러오기 ───────────────────────── */

const site = readJSON(path.join(CONTENT, 'site.json'));
const SITE_URL = site.url.replace(/\/$/, '');
const byOrder = (a, b) => (a.data.order ?? 999) - (b.data.order ?? 999);
const byDateDesc = (a, b) => String(b.data.date).localeCompare(String(a.data.date));

const lawyers = readCollection('lawyers').sort(byOrder);
const practices = readCollection('practice').sort(byOrder);
const columns = readCollection('columns').sort(byDateDesc);
const faqs = readCollection('faq').sort(byOrder);
const pages = Object.fromEntries(readCollection('pages').map(p => [p.slug, p]));

const lawyerBySlug = Object.fromEntries(lawyers.map(l => [l.slug, l]));
const practiceBySlug = Object.fromEntries(practices.map(p => [p.slug, p]));
const asList = v => Array.isArray(v) ? v : (v ? [v] : []);

// 연결 정보 검사 (오타로 깨진 연결을 빌드 단계에서 알려줌)
const warnings = [];
for (const c of columns) {
  if (c.data.author && !lawyerBySlug[c.data.author]) warnings.push(`칼럼 "${c.slug}"의 author "${c.data.author}"에 해당하는 변호사 파일이 없습니다.`);
  if (c.data.category && !practiceBySlug[c.data.category]) warnings.push(`칼럼 "${c.slug}"의 category "${c.data.category}"에 해당하는 업무분야가 없습니다.`);
}
for (const f of faqs) {
  if (f.data.category && f.data.category !== 'guide' && !practiceBySlug[f.data.category]) warnings.push(`FAQ "${f.slug}"의 category "${f.data.category}"에 해당하는 업무분야가 없습니다.`);
}
for (const l of lawyers) {
  for (const a of asList(l.data.areas)) if (!practiceBySlug[a]) warnings.push(`변호사 "${l.slug}"의 areas "${a}"에 해당하는 업무분야가 없습니다.`);
}

/* ───────────────────────── 4. 구조화 데이터(JSON-LD) ───────────────────────── */

const ORG_ID = `${SITE_URL}/#organization`;
const officeId = o => `${SITE_URL}/#office-${o.id}`;
const lawyerUrl = l => `/lawyers/${l.slug}/`;
const lawyerId = l => `${SITE_URL}${lawyerUrl(l)}#person`;

function postalAddress(o) {
  return {
    '@type': 'PostalAddress',
    streetAddress: o.street,
    addressLocality: o.locality,
    addressRegion: o.region,
    postalCode: o.postalCode || undefined,
    addressCountry: 'KR'
  };
}

function orgSchema() {
  return {
    '@type': ['LegalService', 'Organization'],
    '@id': ORG_ID,
    name: site.name,
    alternateName: site.alternateNames,
    url: SITE_URL + '/',
    logo: SITE_URL + site.logo,
    image: SITE_URL + site.ogImage,
    description: site.description,
    telephone: site.phone,
    email: site.email,
    foundingDate: site.foundingDate,
    taxID: site.businessNumber,
    address: postalAddress(site.offices.find(o => o.main) || site.offices[0]),
    areaServed: site.areaServed,
    knowsAbout: practices.map(p => p.data.title),
    department: site.offices.map(o => ({ '@id': officeId(o) })),
    employee: lawyers.map(l => ({ '@id': lawyerId(l) })),
    sameAs: site.sameAs && site.sameAs.length ? site.sameAs : undefined
  };
}

function officeSchema(o) {
  return {
    '@type': 'LegalService',
    '@id': officeId(o),
    name: `${site.name} ${o.name}`,
    parentOrganization: { '@id': ORG_ID },
    url: SITE_URL + '/contact/#' + o.id,
    telephone: o.phone || site.phone,
    address: postalAddress(o),
    geo: o.lat ? { '@type': 'GeoCoordinates', latitude: o.lat, longitude: o.lng } : undefined,
    openingHoursSpecification: [{
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: site.hours.opens, closes: site.hours.closes
    }],
    areaServed: o.areaServed
  };
}

function personSchema(l) {
  const d = l.data;
  return {
    '@type': 'Person',
    '@id': lawyerId(l),
    name: d.name,
    jobTitle: d.title,
    url: SITE_URL + lawyerUrl(l),
    image: d.photo ? SITE_URL + d.photo : undefined,
    worksFor: { '@id': ORG_ID },
    workLocation: (() => { const o = site.offices.find(x => x.id === d.office); return o ? { '@id': officeId(o) } : undefined; })(),
    alumniOf: asList(d.education).map(e => ({ '@type': 'EducationalOrganization', name: e.replace(/^\d{4}\s*/, '').replace(/\s*(졸업|수료).*$/, '') })),
    knowsAbout: asList(d.areas).map(a => practiceBySlug[a]?.data.title).filter(Boolean).concat(asList(d.specialties)),
    hasCredential: asList(d.specialties).map(s => ({
      '@type': 'EducationalOccupationalCredential',
      credentialCategory: '대한변호사협회 등록 전문분야',
      name: `${s} 전문분야 등록`,
      recognizedBy: { '@type': 'Organization', name: '대한변호사협회' }
    })),
    description: d.summary
  };
}

function breadcrumbSchema(crumbs) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE_URL + c.path }))
  };
}

function faqPageSchema(list, url) {
  return {
    '@type': 'FAQPage',
    '@id': SITE_URL + url + '#faq',
    mainEntity: list.map(f => ({
      '@type': 'Question',
      name: f.data.title,
      url: SITE_URL + `/faq/${f.slug}/`,
      acceptedAnswer: { '@type': 'Answer', text: plain((f.data.summary ? f.data.summary + ' ' : '') + f.html) }
    }))
  };
}

function clean(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => (v === undefined || (Array.isArray(v) && v.length === 0)) ? undefined : v));
}

/* ───────────────────────── 5. 공통 레이아웃 ───────────────────────── */

const NAV = [
  { href: '/about/', label: '소개' },
  { href: '/lawyers/', label: '변호사' },
  { href: '/practice/', label: '업무분야' },
  { href: '/columns/', label: '법률칼럼' },
  { href: '/faq/', label: '자주 묻는 질문' },
  { href: '/contact/', label: '오시는 길' }
];

const telHref = 'tel:' + site.phone.replace(/[^0-9+]/g, '');
const fmtDate = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : ''; };

function layout({ title, description, urlPath, body, schemas = [], crumbs, mdAlt, ogType = 'website', noindex = false }) {
  const fullTitle = urlPath === '/' ? `${site.name} | ${site.tagline}` : `${title} | ${site.name}`;
  const canonical = SITE_URL + urlPath;
  const graph = [orgSchema(), ...site.offices.map(officeSchema), {
    '@type': 'WebSite', '@id': SITE_URL + '/#website', url: SITE_URL + '/', name: site.name, inLanguage: 'ko-KR', publisher: { '@id': ORG_ID }
  }, ...schemas];
  if (crumbs) graph.push(breadcrumbSchema(crumbs));
  const ld = JSON.stringify(clean({ '@context': 'https://schema.org', '@graph': graph })).replace(/</g, '\\u003c');

  const navHtml = NAV.map(n => {
    const active = urlPath.startsWith(n.href) ? ' aria-current="page"' : '';
    return `<a href="${n.href}"${active}>${n.label}</a>`;
  }).join('');

  const crumbHtml = crumbs && crumbs.length > 1
    ? `<nav class="crumbs wrap" aria-label="현재 위치"><ol>${crumbs.map((c, i) => i === crumbs.length - 1 ? `<li><span aria-current="page">${esc(c.name)}</span></li>` : `<li><a href="${c.path}">${esc(c.name)}</a></li>`).join('')}</ol></nav>`
    : '';

  const verify = Object.entries(site.verification || {}).filter(([, v]) => v)
    .map(([k, v]) => k === 'naver' ? `<meta name="naver-site-verification" content="${esc(v)}">` : k === 'google' ? `<meta name="google-site-verification" content="${esc(v)}">` : '').join('\n');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
${noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">'}
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE_URL + site.ogImage}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
${verify}
<meta name="theme-color" content="#09215E">
<link rel="icon" href="/images/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/images/favicon-48.png" sizes="48x48" type="image/png">
<link rel="apple-touch-icon" href="/images/apple-touch-icon.png">
${mdAlt ? `<link rel="alternate" type="text/markdown" href="${mdAlt}" title="이 페이지의 마크다운 원문">` : ''}
<link rel="alternate" type="text/plain" href="/llms.txt" title="AI용 사이트 안내">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/styles.css">
<script type="application/ld+json">${ld}</script>
</head>
<body>
<a class="skip" href="#main">본문 바로가기</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/"><img src="${esc(site.logo)}" alt="${esc(site.name)}" width="164" height="32"></a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="site-nav">메뉴</button>
    <nav id="site-nav" class="site-nav" aria-label="주 메뉴">${navHtml}<a class="nav-call" href="${telHref}">${esc(site.phone)}</a></nav>
  </div>
</header>
${crumbHtml}
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <p class="footer-logo"><img src="${esc(site.logoWhite)}" alt="${esc(site.name)}" width="164" height="32" loading="lazy"></p>
      <p>상담 전화 <a href="${telHref}">${esc(site.phone)}</a><br>${esc(site.hours.label)}</p>
      <p>이메일 <a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>
    </div>
    <div>
      <ul class="footer-offices">${site.offices.map(o => `<li><strong>${esc(o.name)}</strong> ${esc(o.address)}</li>`).join('')}</ul>
    </div>
    <div class="footer-legal">
      <p>대표변호사 ${esc(site.ceo)} · 광고책임변호사 ${esc(site.adResponsible)}<br>사업자등록번호 ${esc(site.businessNumber)}</p>
      <p><a href="/privacy/">개인정보처리방침</a> <a href="/disclaimer/">면책공고</a></p>
      <p class="copy">© ${new Date().getFullYear()} ${esc(site.name)}</p>
    </div>
  </div>
</footer>
<div class="callbar" role="navigation" aria-label="빠른 상담">
  <a class="callbar-phone" href="${telHref}">전화 상담</a>
  <a class="callbar-form" href="/contact/#consult">상담 신청</a>
</div>
<script src="/main.js" defer></script>
</body>
</html>`;
}

/* ───────────────────────── 6. 부분 템플릿 ───────────────────────── */

function monogram(l) {
  if (l.data.photo) return `<img class="portrait" src="${esc(l.data.photo)}" alt="${esc(l.data.name)} ${esc(l.data.title)}" loading="lazy" width="240" height="300">`;
  return `<span class="portrait portrait-mono" aria-hidden="true">${esc(String(l.data.name).slice(0, 1))}</span>`;
}

function officeName(id) { return site.offices.find(o => o.id === id)?.name || ''; }

function lawyerCard(l) {
  const d = l.data;
  const spec = asList(d.specialties);
  return `<li class="lawyer-card">
  <a href="${lawyerUrl(l)}">
    ${monogram(l)}
    <span class="lawyer-name">${esc(d.name)}</span>
    <span class="lawyer-role">${esc(d.title)} · ${esc(officeName(d.office))}</span>
    ${spec.length ? `<span class="lawyer-spec">대한변협 등록 전문분야: ${spec.map(esc).join(', ')}</span>` : ''}
  </a>
</li>`;
}

function columnItem(c) {
  const a = lawyerBySlug[c.data.author];
  const p = practiceBySlug[c.data.category];
  return `<li class="column-item">
  <a href="/columns/${c.slug}/">
    <span class="column-meta">${p ? esc(p.data.title) : ''}${a ? ` · ${esc(a.data.name)} ${esc(a.data.title)}` : ''} · <time datetime="${esc(c.data.date)}">${fmtDate(c.data.date)}</time></span>
    <span class="column-title">${esc(c.data.title)}</span>
    <span class="column-summary">${esc(c.data.summary)}</span>
  </a>
</li>`;
}

function faqBlock(f, { link = true } = {}) {
  return `<article class="faq-item" id="${f.slug}">
  <h3>${link ? `<a href="/faq/${f.slug}/">${esc(f.data.title)}</a>` : esc(f.data.title)}</h3>
  ${f.data.summary ? `<p class="faq-short">${inline(f.data.summary)}</p>` : ''}
  <div class="prose">${f.html}</div>
</article>`;
}

function consultBand() {
  return `<section class="consult-band">
  <div class="wrap consult-inner">
    <div>
      <h2>사건 이야기를 들려주세요</h2>
      <p>${esc(site.consultNote)}</p>
    </div>
    <div class="consult-actions">
      <a class="btn btn-honey" href="${telHref}">${esc(site.phone)} 전화하기</a>
      <a class="btn btn-line" href="/contact/#consult">상담 신청서 쓰기</a>
    </div>
  </div>
</section>`;
}

function authorBox(a) {
  if (!a) return '';
  return `<aside class="author-box">
  ${monogram(a)}
  <div>
    <p class="author-label">작성 변호사</p>
    <p class="author-name"><a href="${lawyerUrl(a)}">${esc(a.data.name)} ${esc(a.data.title)}</a></p>
    ${asList(a.data.specialties).length ? `<p class="author-spec">대한변협 등록 전문분야: ${asList(a.data.specialties).map(esc).join(', ')}</p>` : ''}
    <p>${esc(a.data.summary)}</p>
  </div>
</aside>`;
}

const notice = `<p class="notice">이 글은 일반적인 법률 정보를 안내하기 위한 것으로, 개별 사건에 대한 법률 자문이 아닙니다. 사건마다 사실관계와 증거가 달라 결론도 달라질 수 있으니 구체적인 사안은 상담을 통해 확인하시기 바랍니다.</p>`;

/* ───────────────────────── 7. 페이지 생성 ───────────────────────── */

const outputs = []; // { path, html, lastmod }
function emit(urlPath, html, lastmod) {
  outputs.push({ urlPath, html, lastmod });
}

// 홈
(function home() {
  const pOrder = slug => practiceBySlug[slug]?.data.order ?? 999;
  const heroFaqs = faqs.filter(f => f.data.featured).sort((a, b) => pOrder(a.data.category) - pOrder(b.data.category) || (a.data.order ?? 999) - (b.data.order ?? 999)).slice(0, 5);
  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="hero-place">${esc(site.heroPlace)}</p>
      <h1>${esc(site.heroTitle)}</h1>
      <p class="hero-lede">${esc(site.heroLede)}</p>
      <div class="hero-actions">
        <a class="btn btn-honey" href="${telHref}">${esc(site.phone)} 전화 상담</a>
        <a class="btn btn-line" href="/contact/#consult">상담 신청서 쓰기</a>
      </div>
      <p class="hero-hours">${esc(site.hours.label)}</p>
    </div>
    <div class="hero-questions">
      <h2>상담에서 자주 받는 질문</h2>
      <ul>
        ${heroFaqs.map(f => `<li><a href="/faq/${f.slug}/"><span class="q">${esc(f.data.title)}</span><span class="a">${esc(f.data.summary)}</span></a></li>`).join('')}
      </ul>
      <a class="more" href="/faq/">질문 모두 보기</a>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head">
      <h2>업무분야</h2>
      <p>${esc(site.practiceIntro)}</p>
    </div>
    <ul class="practice-list">
      ${practices.map(p => `<li><a href="/practice/${p.slug}/"><span class="practice-title">${esc(p.data.title)}</span><span class="practice-summary">${esc(p.data.summary)}</span></a></li>`).join('')}
    </ul>
  </div>
</section>

<section class="section section-tint">
  <div class="wrap">
    <div class="section-head">
      <h2>서상의 변호사</h2>
      <p>서울 주사무소, 남양주·인천 분사무소의 변호사들이 사건을 함께 검토합니다.</p>
    </div>
    <ul class="lawyer-grid">${lawyers.map(lawyerCard).join('')}</ul>
  </div>
</section>

${site.homeStory ? `<section class="section story">
  <div class="wrap story-grid">
    <figure class="story-photo"><img src="${esc(site.homeStory.image)}" alt="${esc(site.homeStory.imageAlt)}" loading="lazy" width="708" height="550"></figure>
    <div>
      <h2>${esc(site.homeStory.title)}</h2>
      ${site.homeStory.points.map(p => `<h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>`).join('')}
      <a class="more" href="/about/">서상 소개 더 보기</a>
    </div>
  </div>
</section>` : ''}

${columns.length ? `<section class="section">
  <div class="wrap">
    <div class="section-head">
      <h2>최근 법률칼럼</h2>
      <p>변호사가 직접 쓴 사건 유형별 안내입니다.</p>
    </div>
    <ul class="column-list">${columns.slice(0, 4).map(columnItem).join('')}</ul>
    <a class="more" href="/columns/">칼럼 모두 보기</a>
  </div>
</section>` : ''}

<section class="section section-tint">
  <div class="wrap">
    <div class="section-head"><h2>사무소 안내</h2><p>서울 서초, 남양주 다산, 인천 남동 세 곳에서 상담합니다.</p></div>
    ${site.officesMap ? `<figure class="offices-map"><img src="${esc(site.officesMap)}" alt="서울·남양주·인천 사무소 위치를 표시한 지도" loading="lazy" width="708" height="422"></figure>` : ''}
    <ul class="office-list">
      ${site.offices.map(o => `<li class="office">
        <h3>${esc(o.name)}</h3>
        <p>${esc(o.address)}</p>
        ${o.note ? `<p class="office-note">${esc(o.note)}</p>` : ''}
        <p><a href="https://map.naver.com/p/search/${encodeURIComponent(o.address.replace(/\(.*\)/, '').trim())}" target="_blank" rel="noopener">네이버 지도에서 보기</a></p>
      </li>`).join('')}
    </ul>
  </div>
</section>
${consultBand()}`;
  emit('/', layout({ title: site.name, description: site.description, urlPath: '/', body, schemas: [faqPageSchema(heroFaqs, '/')] }));
})();

// 소개
(function about() {
  const p = pages.about;
  if (!p) return;
  const body = `
<article class="wrap page">
  <header class="page-head">
    <h1>${esc(p.data.title)}</h1>
    ${p.data.summary ? `<p class="summary-box"><strong>요약</strong> ${inline(p.data.summary)}</p>` : ''}
  </header>
  ${asList(site.aboutPhotos).length ? `<div class="about-photos">${asList(site.aboutPhotos).map((ph, i) => `<figure class="about-photo about-photo-${i}"><img src="${esc(ph.src)}" alt="${esc(ph.alt)}" loading="${i ? 'lazy' : 'eager'}"></figure>`).join('')}</div>` : ''}
  <div class="prose">${p.html}</div>
  ${site.signature ? `<p class="signature"><img src="${esc(site.signature)}" alt="대표변호사 ${esc(site.ceo)}" width="221" height="48" loading="lazy"></p>` : ''}
  <section class="timeline-wrap">
    <h2>걸어온 길</h2>
    <ol class="timeline">${site.history.map(h => `<li><span class="when">${esc(h.when)}</span><span class="what">${esc(h.what)}</span></li>`).join('')}</ol>
  </section>
</article>
${consultBand()}`;
  emit('/about/', layout({ title: p.data.title, description: p.data.description || p.data.summary, urlPath: '/about/', body,
    crumbs: [{ name: '홈', path: '/' }, { name: p.data.title, path: '/about/' }],
    schemas: [{ '@type': 'AboutPage', '@id': SITE_URL + '/about/#page', url: SITE_URL + '/about/', about: { '@id': ORG_ID } }] }));
})();

// 변호사 목록·상세
(function lawyerPages() {
  const body = `
<div class="wrap page">
  <header class="page-head">
    <h1>변호사 소개</h1>
    <p class="lede">사무소별로 상주하는 변호사가 다르니, 가까운 사무소를 확인하고 연락해 주세요.</p>
  </header>
  ${site.offices.map(o => {
    const list = lawyers.filter(l => l.data.office === o.id);
    if (!list.length) return '';
    return `<section class="office-group"><h2>${esc(o.name)}</h2><ul class="lawyer-grid">${list.map(lawyerCard).join('')}</ul></section>`;
  }).join('')}
</div>
${consultBand()}`;
  emit('/lawyers/', layout({ title: '변호사 소개', description: `${site.name} 구성원 변호사의 학력, 경력, 대한변협 등록 전문분야를 안내합니다.`, urlPath: '/lawyers/', body,
    crumbs: [{ name: '홈', path: '/' }, { name: '변호사', path: '/lawyers/' }],
    schemas: [{ '@type': 'CollectionPage', url: SITE_URL + '/lawyers/', name: '변호사 소개', hasPart: lawyers.map(l => ({ '@id': lawyerId(l) })) }, ...lawyers.map(personSchema)] }));

  for (const l of lawyers) {
    const d = l.data;
    const written = columns.filter(c => c.data.author === l.slug);
    const listBlock = (title, items) => asList(items).length ? `<section class="cv-block"><h2>${title}</h2><ul>${asList(items).map(x => `<li>${inline(x)}</li>`).join('')}</ul></section>` : '';
    const body = `
<article class="wrap page lawyer-page">
  <header class="lawyer-head">
    ${monogram(l)}
    <div>
      <p class="lawyer-office">${esc(officeName(d.office))}</p>
      <h1>${esc(d.name)} <span>${esc(d.title)}</span></h1>
      ${d.quote ? `<p class="lawyer-quote">${esc(d.quote)}</p>` : ''}
      ${asList(d.specialties).length ? `<p class="lawyer-spec">대한변호사협회 등록 전문분야: ${asList(d.specialties).map(esc).join(', ')}</p>` : ''}
      ${asList(d.areas).length ? `<p class="lawyer-areas">담당 업무분야: ${asList(d.areas).map(a => practiceBySlug[a] ? `<a href="/practice/${a}/">${esc(practiceBySlug[a].data.title)}</a>` : '').join(', ')}</p>` : ''}
    </div>
  </header>
  ${d.summary ? `<p class="summary-box"><strong>요약</strong> ${inline(d.summary)}</p>` : ''}
  ${l.html ? `<div class="prose">${l.html}</div>` : ''}
  <div class="cv">
    ${listBlock('학력', d.education)}
    ${listBlock('경력', d.career)}
    ${listBlock('주요 업무', d.work)}
    ${listBlock('주요 자문사', d.clients)}
  </div>
  ${written.length ? `<section class="related"><h2>${esc(d.name)} 변호사가 쓴 칼럼</h2><ul class="column-list">${written.map(columnItem).join('')}</ul></section>` : ''}
</article>
${consultBand()}`;
    emit(lawyerUrl(l), layout({ title: `${d.name} ${d.title}`, description: d.summary || `${site.name} ${d.name} ${d.title}`, urlPath: lawyerUrl(l), body,
      mdAlt: `/lawyers/${l.slug}/index.md`,
      crumbs: [{ name: '홈', path: '/' }, { name: '변호사', path: '/lawyers/' }, { name: d.name, path: lawyerUrl(l) }],
      schemas: [{ '@type': 'ProfilePage', url: SITE_URL + lawyerUrl(l), mainEntity: { '@id': lawyerId(l) }, dateModified: d.updated || undefined }, personSchema(l)] }), d.updated);
  }
})();

// 업무분야 목록·상세
(function practicePages() {
  const body = `
<div class="wrap page">
  <header class="page-head">
    <h1>업무분야</h1>
    <p class="lede">${esc(site.practiceIntro)}</p>
  </header>
  <ul class="practice-list practice-list-wide">
    ${practices.map(p => `<li><a href="/practice/${p.slug}/"><span class="practice-title">${esc(p.data.title)}</span><span class="practice-summary">${esc(p.data.summary)}</span></a></li>`).join('')}
  </ul>
</div>
${consultBand()}`;
  emit('/practice/', layout({ title: '업무분야', description: `${site.name}의 업무분야: ${practices.map(p => p.data.title).join(', ')}`, urlPath: '/practice/', body,
    crumbs: [{ name: '홈', path: '/' }, { name: '업무분야', path: '/practice/' }] }));

  for (const p of practices) {
    const d = p.data;
    const team = lawyers.filter(l => asList(l.data.areas).includes(p.slug));
    const relFaq = faqs.filter(f => f.data.category === p.slug);
    const relCol = columns.filter(c => c.data.category === p.slug);
    const url = `/practice/${p.slug}/`;
    const body = `
<article class="wrap page">
  <header class="page-head">
    <h1>${esc(d.title)}</h1>
    <p class="summary-box"><strong>요약</strong> ${inline(d.summary)}</p>
  </header>
  ${asList(d.cases).length ? `<section class="case-types"><h2>이런 사건을 맡습니다</h2><ul>${asList(d.cases).map(c => `<li>${inline(c)}</li>`).join('')}</ul></section>` : ''}
  <div class="prose">${p.html}</div>
  ${team.length ? `<section class="related"><h2>담당 변호사</h2><ul class="lawyer-grid">${team.map(lawyerCard).join('')}</ul></section>` : ''}
  ${relFaq.length ? `<section class="related"><h2>${esc(d.title)} 자주 묻는 질문</h2>${relFaq.map(f => faqBlock(f)).join('')}</section>` : ''}
  ${relCol.length ? `<section class="related"><h2>관련 칼럼</h2><ul class="column-list">${relCol.map(columnItem).join('')}</ul></section>` : ''}
</article>
${consultBand()}`;
    const schemas = [{
      '@type': 'Service', '@id': SITE_URL + url + '#service', name: d.title, serviceType: d.title, description: d.summary,
      provider: { '@id': ORG_ID }, areaServed: site.areaServed, url: SITE_URL + url,
      hasOfferCatalog: asList(d.cases).length ? { '@type': 'OfferCatalog', name: `${d.title} 업무`, itemListElement: asList(d.cases).map(c => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: c } })) } : undefined
    }];
    if (relFaq.length) schemas.push(faqPageSchema(relFaq, url));
    emit(url, layout({ title: d.title, description: d.description || d.summary, urlPath: url, body, schemas, mdAlt: `${url}index.md`,
      crumbs: [{ name: '홈', path: '/' }, { name: '업무분야', path: '/practice/' }, { name: d.title, path: url }] }), d.updated);
  }
})();

// 칼럼 목록·상세
(function columnPages() {
  const body = `
<div class="wrap page">
  <header class="page-head">
    <h1>법률칼럼</h1>
    <p class="lede">사건을 맡으며 자주 설명드리는 내용을 변호사가 직접 정리했습니다.</p>
  </header>
  ${columns.length ? `<ul class="column-list">${columns.map(columnItem).join('')}</ul>` : '<p>아직 등록된 칼럼이 없습니다. content/columns 폴더에 글을 추가하면 이곳에 나타납니다.</p>'}
</div>
${consultBand()}`;
  emit('/columns/', layout({ title: '법률칼럼', description: `${site.name} 변호사들이 쓴 부동산·형사·이혼·행정 법률칼럼`, urlPath: '/columns/', body,
    crumbs: [{ name: '홈', path: '/' }, { name: '법률칼럼', path: '/columns/' }],
    schemas: [{ '@type': 'Blog', '@id': SITE_URL + '/columns/#blog', name: `${site.name} 법률칼럼`, url: SITE_URL + '/columns/', publisher: { '@id': ORG_ID },
      blogPost: columns.map(c => ({ '@id': SITE_URL + `/columns/${c.slug}/#article` })) }] }));

  for (const c of columns) {
    const d = c.data;
    const a = lawyerBySlug[d.author];
    const p = practiceBySlug[d.category];
    const url = `/columns/${c.slug}/`;
    const relFaq = faqs.filter(f => asList(d.relatedFaq).includes(f.slug));
    const body = `
<article class="wrap page article">
  <header class="page-head">
    ${p ? `<p class="article-cat"><a href="/practice/${p.slug}/">${esc(p.data.title)}</a></p>` : ''}
    <h1>${esc(d.title)}</h1>
    <p class="article-meta">${a ? `<a href="${lawyerUrl(a)}">${esc(a.data.name)} ${esc(a.data.title)}</a> 작성 · ` : ''}<time datetime="${esc(d.date)}">${fmtDate(d.date)}</time>${d.updated && d.updated !== d.date ? ` · <time datetime="${esc(d.updated)}">${fmtDate(d.updated)}</time> 수정` : ''}</p>
  </header>
  <section class="summary-box summary-list">
    <h2>핵심 요약</h2>
    ${asList(d.keyPoints).length ? `<ul>${asList(d.keyPoints).map(k => `<li>${inline(k)}</li>`).join('')}</ul>` : `<p>${inline(d.summary)}</p>`}
  </section>
  <div class="prose">${c.html}</div>
  ${asList(d.laws).length ? `<section class="laws"><h2>근거 법령</h2><ul>${asList(d.laws).map(x => `<li>${inline(x)}</li>`).join('')}</ul></section>` : ''}
  ${notice}
  ${authorBox(a)}
  ${relFaq.length ? `<section class="related"><h2>함께 보면 좋은 질문</h2>${relFaq.map(f => faqBlock(f)).join('')}</section>` : ''}
</article>
${consultBand()}`;
    const article = {
      '@type': 'Article', '@id': SITE_URL + url + '#article', headline: d.title, description: d.summary,
      datePublished: d.date, dateModified: d.updated || d.date, inLanguage: 'ko-KR',
      author: a ? { '@id': lawyerId(a) } : { '@id': ORG_ID }, publisher: { '@id': ORG_ID },
      mainEntityOfPage: SITE_URL + url, articleSection: p?.data.title, keywords: asList(d.keywords).join(', ') || undefined,
      citation: asList(d.laws).length ? asList(d.laws).map(plain) : undefined, image: SITE_URL + site.ogImage
    };
    const schemas = [article];
    if (a) schemas.push(personSchema(a));
    emit(url, layout({ title: d.title, description: d.summary, urlPath: url, body, schemas, ogType: 'article', mdAlt: `${url}index.md`,
      crumbs: [{ name: '홈', path: '/' }, { name: '법률칼럼', path: '/columns/' }, { name: d.title, path: url }] }), d.updated || d.date);
  }
})();

// FAQ 목록·상세
(function faqPages() {
  const groups = practices.map(p => ({ p, list: faqs.filter(f => f.data.category === p.slug) })).filter(g => g.list.length);
  const etc = faqs.filter(f => !practiceBySlug[f.data.category]);
  const body = `
<div class="wrap page">
  <header class="page-head">
    <h1>자주 묻는 질문</h1>
    <p class="lede">상담에서 가장 많이 받는 질문에 짧은 답과 근거를 함께 적었습니다.</p>
    <nav class="faq-jump" aria-label="분야별 질문">${groups.map(g => `<a href="#cat-${g.p.slug}">${esc(g.p.data.title)}</a>`).join('')}${etc.length ? '<a href="#cat-etc">상담 안내</a>' : ''}</nav>
  </header>
  ${groups.map(g => `<section class="faq-group" id="cat-${g.p.slug}"><h2>${esc(g.p.data.title)}</h2>${g.list.map(f => faqBlock(f)).join('')}</section>`).join('')}
  ${etc.length ? `<section class="faq-group" id="cat-etc"><h2>상담 안내</h2>${etc.map(f => faqBlock(f)).join('')}</section>` : ''}
</div>
${consultBand()}`;
  emit('/faq/', layout({ title: '자주 묻는 질문', description: '명도소송, 임대차, 이혼, 형사 조사, 행정처분 등 상담에서 자주 받는 질문과 답변', urlPath: '/faq/', body,
    crumbs: [{ name: '홈', path: '/' }, { name: '자주 묻는 질문', path: '/faq/' }], schemas: [faqPageSchema(faqs, '/faq/')] }));

  for (const f of faqs) {
    const d = f.data;
    const a = lawyerBySlug[d.author];
    const p = practiceBySlug[d.category];
    const url = `/faq/${f.slug}/`;
    const siblings = faqs.filter(x => x.data.category === d.category && x.slug !== f.slug).slice(0, 4);
    const body = `
<article class="wrap page article">
  <header class="page-head">
    ${p ? `<p class="article-cat"><a href="/practice/${p.slug}/">${esc(p.data.title)}</a></p>` : ''}
    <h1>${esc(d.title)}</h1>
    <p class="article-meta">${a ? `<a href="${lawyerUrl(a)}">${esc(a.data.name)} ${esc(a.data.title)}</a> 답변 · ` : ''}<time datetime="${esc(d.updated || d.date)}">${fmtDate(d.updated || d.date)}</time> 기준</p>
  </header>
  ${d.summary ? `<p class="summary-box"><strong>짧은 답</strong> ${inline(d.summary)}</p>` : ''}
  <div class="prose">${f.html}</div>
  ${asList(d.laws).length ? `<section class="laws"><h2>근거 법령</h2><ul>${asList(d.laws).map(x => `<li>${inline(x)}</li>`).join('')}</ul></section>` : ''}
  ${notice}
  ${authorBox(a)}
  ${siblings.length ? `<section class="related"><h2>같은 분야의 다른 질문</h2><ul class="plain-links">${siblings.map(s => `<li><a href="/faq/${s.slug}/">${esc(s.data.title)}</a></li>`).join('')}</ul></section>` : ''}
</article>
${consultBand()}`;
    const schemas = [{
      '@type': 'QAPage', '@id': SITE_URL + url + '#qa', url: SITE_URL + url,
      mainEntity: { '@type': 'Question', name: d.title, text: d.title, answerCount: 1, datePublished: d.date,
        acceptedAnswer: { '@type': 'Answer', text: plain((d.summary ? d.summary + ' ' : '') + f.html), datePublished: d.date, dateModified: d.updated || d.date,
          url: SITE_URL + url, author: a ? { '@id': lawyerId(a) } : { '@id': ORG_ID } } }
    }];
    if (a) schemas.push(personSchema(a));
    emit(url, layout({ title: d.title, description: d.summary || plain(f.html).slice(0, 140), urlPath: url, body, schemas, mdAlt: `${url}index.md`,
      crumbs: [{ name: '홈', path: '/' }, { name: '자주 묻는 질문', path: '/faq/' }, { name: d.title, path: url }] }), d.updated || d.date);
  }
})();

// 상담·오시는 길
(function contact() {
  const form = site.form || {};
  const isNetlify = !form.endpoint;
  const action = form.endpoint || '/contact/thanks/';
  const body = `
<div class="wrap page">
  <header class="page-head">
    <h1>상담 신청 · 오시는 길</h1>
    <p class="lede">전화로 바로 상담하시거나, 아래 신청서를 남겨 주시면 업무시간 안에 변호사가 연락드립니다.</p>
  </header>
  <div class="contact-grid">
    <section class="contact-phone">
      <h2>전화 상담</h2>
      <a class="phone-big" href="${telHref}">${esc(site.phone)}</a>
      <p>${esc(site.hours.label)}</p>
      ${site.naverBooking ? `<p><a class="btn btn-line" href="${esc(site.naverBooking)}" target="_blank" rel="noopener">네이버 예약으로 방문 상담 잡기</a></p>` : ''}
      <p class="small">이메일 <a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>
    </section>
    <section class="contact-form" id="consult">
      <h2>상담 신청서</h2>
      <form name="consult" method="POST" action="${esc(action)}" ${isNetlify ? 'data-netlify="true" netlify-honeypot="bot-field"' : ''}>
        ${isNetlify ? '<input type="hidden" name="form-name" value="consult">' : ''}
        <p class="hp"><label>이 칸은 비워 두세요 <input name="bot-field" tabindex="-1" autocomplete="off"></label></p>
        <div class="field-row">
          <label>이름<input name="name" required autocomplete="name"></label>
          <label>연락처<input name="phone" type="tel" required autocomplete="tel" inputmode="tel" placeholder="010-0000-0000"></label>
        </div>
        <div class="field-row">
          <label>상담 분야
            <select name="area">
              <option value="">선택해 주세요</option>
              ${practices.map(p => `<option>${esc(p.data.title)}</option>`).join('')}
              <option>기타</option>
            </select>
          </label>
          <label>희망 사무소
            <select name="office">${site.offices.map(o => `<option>${esc(o.name)}</option>`).join('')}</select>
          </label>
        </div>
        <label>연락받기 편한 시간<input name="time" placeholder="예: 평일 오후 2시 이후"></label>
        <label>상담 내용<textarea name="message" rows="6" required placeholder="언제, 누구와, 어떤 일이 있었는지 간단히 적어 주세요. 자세한 내용은 상담 때 들으셔도 됩니다."></textarea></label>
        <label class="check"><input type="checkbox" name="agree" required> <span><a href="/privacy/" target="_blank">개인정보 수집·이용</a>에 동의합니다 (상담 목적, 상담 종료 후 파기)</span></label>
        <button class="btn btn-honey" type="submit">상담 신청 보내기</button>
      </form>
    </section>
  </div>
  <section class="offices-detail">
    <h2>사무소 위치</h2>
    <ul class="office-list">
      ${site.offices.map(o => `<li class="office" id="${o.id}">
        ${o.image ? `<img class="office-map" src="${esc(o.image)}" alt="${esc(o.name)} 주변 약도" loading="lazy" width="707" height="422">` : ''}
        <h3>${esc(o.name)}</h3>
        <p>${esc(o.address)}</p>
        ${o.directions ? `<p class="office-note">${esc(o.directions)}</p>` : ''}
        <p><a href="https://map.naver.com/p/search/${encodeURIComponent(o.address.replace(/\(.*\)/, '').trim())}" target="_blank" rel="noopener">네이버 지도</a> · <a href="https://map.kakao.com/?q=${encodeURIComponent(o.address.replace(/\(.*\)/, '').trim())}" target="_blank" rel="noopener">카카오맵</a></p>
      </li>`).join('')}
    </ul>
  </section>
</div>`;
  emit('/contact/', layout({ title: '상담 신청 · 오시는 길', description: `${site.name} 전화 상담 ${site.phone}, 온라인 상담 신청, 서울·남양주·인천 사무소 위치 안내`, urlPath: '/contact/', body,
    crumbs: [{ name: '홈', path: '/' }, { name: '상담 · 오시는 길', path: '/contact/' }],
    schemas: [{ '@type': 'ContactPage', url: SITE_URL + '/contact/', about: { '@id': ORG_ID } }] }));

  const thanks = `
<div class="wrap page thanks">
  <h1>상담 신청이 접수되었습니다</h1>
  <p>업무시간(${esc(site.hours.label)}) 안에 남겨 주신 연락처로 연락드립니다. 급한 일이라면 지금 바로 전화 주세요.</p>
  <p><a class="btn btn-honey" href="${telHref}">${esc(site.phone)} 전화하기</a> <a class="btn btn-line" href="/">홈으로</a></p>
</div>`;
  emit('/contact/thanks/', layout({ title: '상담 신청 접수', description: '상담 신청이 접수되었습니다.', urlPath: '/contact/thanks/', body: thanks, noindex: true }));
})();

// 개인정보처리방침 · 면책공고 등 기타 페이지
for (const key of ['privacy', 'disclaimer']) {
  const p = pages[key];
  if (!p) continue;
  const url = `/${key}/`;
  emit(url, layout({ title: p.data.title, description: p.data.title, urlPath: url,
    body: `<article class="wrap page"><header class="page-head"><h1>${esc(p.data.title)}</h1></header><div class="prose">${p.html}</div></article>`,
    crumbs: [{ name: '홈', path: '/' }, { name: p.data.title, path: url }] }));
}

// 404
emit('/404', layout({ title: '페이지를 찾을 수 없습니다', description: '요청하신 페이지가 없습니다.', urlPath: '/404', noindex: true,
  body: `<div class="wrap page thanks"><h1>찾으시는 페이지가 없습니다</h1><p>주소가 바뀌었거나 삭제된 페이지입니다. 아래에서 다시 찾아보세요.</p><p><a class="btn btn-line" href="/">홈</a> <a class="btn btn-line" href="/faq/">자주 묻는 질문</a> <a class="btn btn-honey" href="${telHref}">${esc(site.phone)}</a></p></div>` }));

/* ───────────────────────── 8. AI·검색엔진용 파일 ───────────────────────── */

function llmsTxt() {
  const L = [];
  L.push(`# ${site.name}`, '');
  L.push(`> ${site.description}`, '');
  L.push(`- 대표 전화: ${site.phone}, 상담 시간 ${site.hours.label}`);
  L.push(`- 이메일: ${site.email}`);
  L.push(`- 대표변호사: ${site.ceo}`);
  for (const o of site.offices) L.push(`- ${o.name}: ${o.address}`);
  L.push(`- 연혁: ${site.history.map(h => `${h.when} ${h.what}`).join(' / ')}`, '');
  L.push('## 업무분야', '');
  for (const p of practices) L.push(`- [${p.data.title}](${SITE_URL}/practice/${p.slug}/index.md): ${p.data.summary}`);
  L.push('', '## 변호사', '');
  for (const l of lawyers) {
    const spec = asList(l.data.specialties);
    L.push(`- [${l.data.name} ${l.data.title}](${SITE_URL}/lawyers/${l.slug}/index.md): ${officeName(l.data.office)}${spec.length ? `, 대한변협 등록 전문분야 ${spec.join('·')}` : ''}. ${l.data.summary || ''}`.trim());
  }
  L.push('', '## 자주 묻는 질문', '');
  for (const f of faqs) L.push(`- [${f.data.title}](${SITE_URL}/faq/${f.slug}/index.md): ${f.data.summary || ''}`);
  if (columns.length) {
    L.push('', '## 법률칼럼', '');
    for (const c of columns) L.push(`- [${c.data.title}](${SITE_URL}/columns/${c.slug}/index.md): ${c.data.summary}`);
  }
  L.push('', '## Optional', '');
  L.push(`- [전체 내용 한 파일로 보기](${SITE_URL}/llms-full.txt)`);
  L.push(`- [상담 신청 · 오시는 길](${SITE_URL}/contact/)`);
  return L.join('\n') + '\n';
}

function itemMarkdown(kind, item) {
  const d = item.data;
  const head = [];
  if (kind === 'lawyer') {
    head.push(`# ${d.name} ${d.title} (${site.name} ${officeName(d.office)})`, '');
    if (d.summary) head.push(`> ${d.summary}`, '');
    if (asList(d.specialties).length) head.push(`- 대한변호사협회 등록 전문분야: ${asList(d.specialties).join(', ')}`);
    if (asList(d.areas).length) head.push(`- 담당 업무분야: ${asList(d.areas).map(a => practiceBySlug[a]?.data.title).filter(Boolean).join(', ')}`);
    head.push(`- 상담 전화: ${site.phone}`, '');
    const sec = (t, arr) => asList(arr).length ? [`## ${t}`, '', ...asList(arr).map(x => `- ${x}`), ''] : [];
    return [...head, item.body, '', ...sec('학력', d.education), ...sec('경력', d.career), ...sec('주요 업무', d.work), ...sec('주요 자문사', d.clients)].join('\n');
  }
  if (kind === 'practice') {
    head.push(`# ${d.title} | ${site.name}`, '', `> ${d.summary}`, '');
    if (asList(d.cases).length) head.push('## 이런 사건을 맡습니다', '', ...asList(d.cases).map(c => `- ${c}`), '');
    const team = lawyers.filter(l => asList(l.data.areas).includes(item.slug));
    const tail = team.length ? ['', '## 담당 변호사', '', ...team.map(l => `- ${l.data.name} ${l.data.title} (${officeName(l.data.office)})`)] : [];
    return [...head, item.body, ...tail, '', `상담 전화 ${site.phone}`].join('\n');
  }
  const a = lawyerBySlug[d.author];
  head.push(`# ${d.title}`, '');
  head.push(`- 작성: ${a ? `${a.data.name} ${a.data.title}` : site.name} (${site.name})`);
  head.push(`- 작성일: ${d.date}${d.updated && d.updated !== d.date ? ` / 수정일: ${d.updated}` : ''}`);
  head.push(`- 출처: ${SITE_URL}/${kind === 'faq' ? 'faq' : 'columns'}/${item.slug}/`, '');
  if (asList(d.keyPoints).length) head.push('## 핵심 요약', '', ...asList(d.keyPoints).map(k => `- ${k}`), '');
  else if (d.summary) head.push(`> ${d.summary}`, '');
  const laws = asList(d.laws).length ? ['', '## 근거 법령', '', ...asList(d.laws).map(x => `- ${x}`)] : [];
  return [...head, item.body, ...laws, '', '이 글은 일반적인 법률 정보이며 개별 사건에 대한 자문이 아닙니다.'].join('\n');
}

function llmsFull() {
  const parts = [llmsTxt(), '\n---\n'];
  if (pages.about) parts.push(`# ${pages.about.data.title}\n\n${pages.about.body}\n\n---\n`);
  for (const p of practices) parts.push(itemMarkdown('practice', p), '\n---\n');
  for (const l of lawyers) parts.push(itemMarkdown('lawyer', l), '\n---\n');
  for (const f of faqs) parts.push(itemMarkdown('faq', f), '\n---\n');
  for (const c of columns) parts.push(itemMarkdown('column', c), '\n---\n');
  return parts.join('\n');
}

function robotsTxt() {
  const bots = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Googlebot', 'Bingbot', 'Yeti', 'Daumoa', 'Applebot', 'Applebot-Extended'];
  return [
    '# 검색엔진과 AI 서비스가 사이트 내용을 읽고 인용할 수 있도록 허용합니다.',
    ...bots.flatMap(b => [`User-agent: ${b}`, 'Allow: /', 'Disallow: /admin/', '']),
    'User-agent: *', 'Allow: /', 'Disallow: /admin/', 'Disallow: /contact/thanks/', '',
    `Sitemap: ${SITE_URL}/sitemap.xml`, ''
  ].join('\n');
}

function sitemapXml() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = outputs.filter(o => o.urlPath !== '/404' && !o.urlPath.includes('thanks'));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(o => `  <url><loc>${SITE_URL}${o.urlPath}</loc><lastmod>${o.lastmod || today}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`;
}

function rssXml() {
  const items = [...columns.map(c => ({ ...c, kind: 'columns' }))].slice(0, 30);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(site.name)} 법률칼럼</title><link>${SITE_URL}/columns/</link><description>${esc(site.description)}</description><language>ko</language>\n` +
    items.map(c => `<item><title>${esc(c.data.title)}</title><link>${SITE_URL}/columns/${c.slug}/</link><guid>${SITE_URL}/columns/${c.slug}/</guid><pubDate>${new Date(c.data.date + 'T09:00:00+09:00').toUTCString()}</pubDate><description>${esc(c.data.summary)}</description></item>`).join('\n') +
    `\n</channel></rss>\n`;
}

/* ───────────────────────── 9. 파일 쓰기 ───────────────────────── */

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const s = path.join(from, f), d = path.join(to, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

function write(rel, content) {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
copyDir(PUBLIC, DIST);
fs.copyFileSync(path.join(SRC, 'styles.css'), path.join(DIST, 'styles.css'));
fs.copyFileSync(path.join(SRC, 'main.js'), path.join(DIST, 'main.js'));

for (const o of outputs) {
  write(o.urlPath === '/404' ? '404.html' : path.join(o.urlPath, 'index.html'), o.html);
}
for (const l of lawyers) write(`lawyers/${l.slug}/index.md`, itemMarkdown('lawyer', l));
for (const p of practices) write(`practice/${p.slug}/index.md`, itemMarkdown('practice', p));
for (const f of faqs) write(`faq/${f.slug}/index.md`, itemMarkdown('faq', f));
for (const c of columns) write(`columns/${c.slug}/index.md`, itemMarkdown('column', c));
write('llms.txt', llmsTxt());
write('llms-full.txt', llmsFull());
write('robots.txt', robotsTxt());
write('sitemap.xml', sitemapXml());
write('rss.xml', rssXml());

console.log(`✔ ${outputs.length}개 페이지를 dist/ 폴더에 만들었습니다. (변호사 ${lawyers.length}, 업무분야 ${practices.length}, 칼럼 ${columns.length}, FAQ ${faqs.length})`);
for (const w of warnings) console.warn('⚠ ' + w);

/* ───────────────────────── 10. 미리보기 서버 ───────────────────────── */

if (process.argv.includes('--serve')) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml', '.yml': 'text/yaml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };
  const port = Number(process.env.PORT) || 4321;
  http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (req.method === 'POST') { res.writeHead(303, { Location: '/contact/thanks/' }); return res.end(); }
    let file = path.join(DIST, p);
    if (p.endsWith('/')) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': types['.html'] }); return res.end(fs.readFileSync(path.join(DIST, '404.html'))); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  }).listen(port, () => console.log(`미리보기: http://localhost:${port}`));
}
