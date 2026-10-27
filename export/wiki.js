/* 非公式 Wiki の「動画一覧」を読んで、動画の一覧（out/wiki/items.json）を作る

   なぜここでやるか：
     Google のサーバー（Apps Script）から Wiki を読むと、Cloudflare に断られる（HTTP 403。ブラウザのふりをしても同じ。
     2026-10-15 に確かめた。ショウケースの updateAll も同じ理由で読めなくなっている）。
     そこで GitHub Actions（だめなら手元のパソコン）で読み、データ置き場に置く。Apps Script はこの一覧を読んで差分を作る。

   使い方:
     node export/wiki.js --out out            … 前回から6日以上たっていれば読み直し、out/wiki/items.json に書く
     node export/wiki.js --out out --force    … 日数にかかわらず読み直す
     node export/wiki.js --out out --from <フォルダ>  … 手元に控えた HTML から読む（試すとき。kagetsu-list.html / kagetsu-2023.html …）

   ⚠️ 続けて読むと断られる（429）。ページの間を8秒空け、毎回は読まずに週1回にする（3時間おきの書き出しのたびに読まない）。
   ⚠️ 読めなくても失敗にしないこと（データの公開まで止めない）。読めなかったページは前回の中身を使い、読めなかったことを書いておく。 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = {};
process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith('--')) args[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true; });
const OUT = args.out || 'out';
const FROM = typeof args.from === 'string' ? args.from : '';
const FORCE = !!args.force || process.env.WIKI_FORCE === 'true';
const PAGES_URL = (process.env.PAGES_URL || '').replace(/\/?$/, '/');

const WIKI_BASE = 'https://wikiwiki.jp/nijisanji/';
/* 取り込みと同じ7人（ショウはショウケースの Wiki の点検があるので入れない）。並びは MECHATU-NE と同じ。
   Oriens の4人は 2026-10-28 に足した（「赤城ウェン/動画一覧」などが、ほかの人と同じ形であることを確かめた）。
   1人5ページほど（一覧＋年ごと）なので、8秒ずつ空けると全部で5分ほどかかる（週1回なので問題ない） */
const MEMBERS = [
  { key: 'wen',     name: '赤城ウェン' },
  { key: 'rito',    name: '宇佐美リト' },
  { key: 'ittetsu', name: '佐伯イッテツ' },
  { key: 'mana',    name: '緋八マナ' },
  { key: 'rai',     name: '伊波ライ' },
  { key: 'rou',     name: '小柳ロウ' },
  { key: 'kagetsu', name: '叢雲カゲツ' },
];
const FIRST_YEAR = 2023;
const WAIT_MS = 8000;
const REFRESH_DAYS = 6;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const summary = [];

main().catch(e => { console.error('Wiki の読み込みで止まりました（データの公開は続けます）：' + e.message); writeSummary(); });

async function main() {
  const prev = await readPrevious();
  const age = prev && prev.readAt ? (Date.now() - Date.parse(prev.readAt)) / 86400000 : Infinity;
  if (prev && age < REFRESH_DAYS && !FORCE && !FROM) {
    summary.push('Wiki は ' + age.toFixed(1) + ' 日前に読んだので、今回は読みません（週1回）');
    return write(prev);
  }

  const thisYear = Number(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 4));
  const pages = {};
  let first = true, okCount = 0, blocked = '';
  for (const m of MEMBERS) {
    const list = [{ path: m.name + '/動画一覧', file: m.key + '-list.html', year: 0 }];
    for (let y = FIRST_YEAR; y <= thisYear; y++) list.push({ path: m.name + '/動画一覧/' + y, file: m.key + '-' + y + '.html', year: y });
    for (const p of list) {
      const before = prev && prev.pages && prev.pages[p.path];
      if (blocked) { pages[p.path] = Object.assign({}, before || { items: [] }, { status: '試していません（' + blocked + '）' }); continue; }
      if (!first && !FROM) await sleep(WAIT_MS);
      first = false;
      const got = await fetchPage(p);
      if (got.html !== null) {
        pages[p.path] = { member: m.key, status: got.html ? 'ok' : 'ページなし', readAt: new Date().toISOString(), items: parse(got.html, p.year) };
        okCount++;
      } else {
        // 読めなかったページは、前回の中身を残す
        pages[p.path] = Object.assign({ member: m.key, items: [] }, before || {}, { status: got.error });
        if (/403/.test(got.error)) blocked = got.error;   // 止められているなら、残りは試さない
      }
    }
  }
  const items = Object.values(pages).reduce((n, p) => n + (p.items || []).length, 0);
  summary.push('Wiki：' + okCount + ' ページ読めた／' + Object.keys(pages).length + ' ページ中（動画のリンク ' + items + ' 件）' + (blocked ? '。⚠️ ' + blocked + ' で止められています' : ''));
  write({ readAt: okCount ? new Date().toISOString() : (prev && prev.readAt) || '', checkedAt: new Date().toISOString(), blocked: blocked, pages: pages });
}

async function fetchPage(p) {
  if (FROM) {
    const f = path.join(FROM, p.file);
    return fs.existsSync(f) ? { html: fs.readFileSync(f, 'utf8') } : { html: '' };
  }
  const url = WIKI_BASE + p.path.split('/').map(encodeURIComponent).join('/');
  let error = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.8' } });
      if (res.ok) return { html: await res.text() };
      if (res.status === 404) return { html: '' };
      error = 'HTTP ' + res.status + (res.headers.get('server') ? '（' + res.headers.get('server') + '）' : '');
      if (res.status !== 429 && res.status < 500) break;
      await sleep(60000);   // 断られたら1分待ってやり直す
    } catch (e) { error = e.message.slice(0, 80); }
  }
  return { html: null, error: error };
}

/* ページの本文（最初の見出し〜「サイト内検索」の前）を順に読み、見出しと日付を追いながら YouTube のリンクを集める。
   ⚠️ 本文の始まりは h3 か h4 で探すこと。ロウ・ライの年ごとのページは h4（「2025年」）から始まり、
      h3 だけで探すと横の欄の見出しを始まりと取り違えて、1件も拾えない（2026-10-15 に起きた）。
   ⚠️ リンクの文字は、タグを取り除いてから使う。閉じタグの前にアイコンの span が入る（ショウケースで起きた）。 */
function parse(html, pageYear) {
  if (!html) return [];
  const start = html.search(/<h[34][^>]*>/);
  const end = html.indexOf('サイト内検索');
  const body = html.slice(Math.max(0, start), end > start ? end : undefined);
  const items = [];
  let h3 = '', h4 = '';
  const re = /<h([34])[^>]*>([\s\S]*?)<\/h\1>|<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) {
      const t = decode(m[2].replace(/<[^>]+>/g, '')).trim();
      if (m[1] === '3') { h3 = t; h4 = ''; } else h4 = t;
      continue;
    }
    const id = videoId(decode(m[3]));
    if (!id) continue;
    const before = decode(body.slice(Math.max(0, m.index - 300), m.index).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const dm = before.match(/(\d{1,2})\/(\d{1,2})[^\/]*$/);
    const yh = (h4.match(/(\d{4})年/) || [])[1] || (pageYear ? String(pageYear) : '');
    const md = dm ? dm[1].padStart(2, '0') + '/' + dm[2].padStart(2, '0') : '';
    items.push({ i: id, t: decode(m[4].replace(/<[^>]+>/g, '')).trim(), s: h4 || h3, d: md ? (yh ? yh + '/' : '') + md : '' });
  }
  return items;
}

async function readPrevious() {
  try {
    if (args.prev) return JSON.parse(fs.readFileSync(path.join(args.prev, 'wiki/items.json'), 'utf8'));
    if (!PAGES_URL || FROM) return null;
    const res = await fetch(PAGES_URL + 'wiki/items.json?t=' + Date.now());
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
}

/* out/wiki/items.json に書き、meta.json にも載せる（中身が変わったら公開し直すように、contentHash にも混ぜる）。
   ⚠️ checkedAt（読みに行った時刻）は印に混ぜない。毎回変わるので、いつも「変わった」になる。 */
function write(data) {
  fs.mkdirSync(path.join(OUT, 'wiki'), { recursive: true });
  const text = JSON.stringify(data);
  fs.writeFileSync(path.join(OUT, 'wiki/items.json'), text);
  const metaFile = path.join(OUT, 'meta.json');
  if (fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const hash = crypto.createHash('sha1').update(JSON.stringify(data.pages || {}) + (data.blocked || '')).digest('hex').slice(0, 10);
    meta.files['wiki/items.json'] = { hash: hash, bytes: Buffer.byteLength(text) };
    meta.contentHash = crypto.createHash('sha1').update(meta.contentHash + hash).digest('hex').slice(0, 12);
    meta.wiki = { readAt: data.readAt || '', blocked: data.blocked || '' };
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  }
  console.log(summary.join('\n') || 'Wiki の一覧を書きました');
  writeSummary();
}

function writeSummary() {
  if (process.env.GITHUB_STEP_SUMMARY && summary.length) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n### 非公式 Wiki\n\n' + summary.map(s => '- ' + s).join('\n') + '\n');
}

function videoId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

function decode(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
