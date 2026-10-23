/* Dytica サイトのデータを書き出す

   3か所を読んで、点検し、サイト用の小さいファイルにまとめて out/ に置く。
   - Dytica のシート（カゲツ・ロウ・ライの動画と他枠）
   - ショウケースのシート（ショウの動画）
   - MECHATU-NE ARCHIVE（楽曲）
   - ディスコグラフィ（ショウケースのシートの「ディスコグラフィ」と、Dytica のシートの「ディスコグラフィ」）
   - 記事（ショウケースのシートの「記事」と、Dytica のシートの「記事」）
   GitHub Actions が3時間おき（と、シートが変わったとき）に動かし、out/ を GitHub Pages で配る。

   点検の決まり（決めたこと.md の5章）：
   - シートが読めない・見出しが無い・件数が前回より大きく減った → 止める（公開せず、前のデータのまま）
   - 1行だけの問題（公開日が化けているなど）→ その行だけ外して公開し、report.json と実行の Summary で知らせる
     （スマホでの打ち間違い1つで、サイト全体の更新が止まらないように）

   使い方:
     node export/build.js                  … 読んで out/ に書く
     node export/build.js --from <フォルダ>  … 手元のファイルから読む（試すとき。dytica.csv / showcase.csv / songs.json、
                                             あれば showcaseDisco.csv / dyticaDisco.csv / showcaseArticles.csv / dyticaArticles.csv）
     node export/build.js --out <フォルダ>   … 書き出し先を変える
     node export/build.js --prev <フォルダ>  … 前回の公開の代わりに、手元の前回の out/ と比べる（試すとき）
   環境変数 PAGES_URL … 公開中のデータの場所。前回の件数・点検と比べるのと、他枠の持ち主の名前の控えを読むのに使う
   環境変数 HOLODEX_API_KEY … ショウの配信の開始時刻を Holodex から補うのに使う（無ければ前回の控えだけで補う）。⚠️ 表示しないこと
   環境変数 HOLODEX_FULL … true なら Holodex の控えを全部取り直す（ふだんは週1回） */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = {};
process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith('--')) args[a.slice(2)] = all[i + 1]; });
const OUT = args.out || 'out';
const FROM = args.from || '';
const PAGES_URL = (process.env.PAGES_URL || '').replace(/\/?$/, '/');

/* ⚠️ シートは「CSV 書き出し＋シートの番号（gid）」で読むこと。
      gviz で読むと、Google が列の型を推測して、型の合わない値を黙って消す。非表示の行も落ちる
      （ショウケースの sheets-loader.jsx で起きた）。 */
const SOURCES = {
  dytica:   { label: 'Dytica のシート（動画）',       id: '1Zh1XKg8B_j59gdfsCI9GVmPhKPFHjGb086dmbGjl5LY', gid: '1072447368' },
  showcase: { label: 'ショウケースのシート（動画情報）', id: '1S9GmmMs6Rt3hMra3RW8Ijveh61dJg7-iCwFubJPyzJU', gid: '772496731' },
  songs:    { label: 'MECHATU-NE ARCHIVE（楽曲）',     url: 'https://mechatu-ne-archive.netlify.app/music_data.json' },
  /* ディスコグラフィ。ショウのぶんはショウケースのシートから読む（動画と同じ。決めたこと.md の2章）。
     ほかの3人のぶんは Dytica のシートの「ディスコグラフィ」タブ（列は同じ＋「参加」）。
     ⚠️ タブを作り直したら gid も変わる（シートの URL の #gid= のあとの数字）。空なら読まない */
  showcaseDisco: { label: 'ショウケースのシート（ディスコグラフィ）', id: '1S9GmmMs6Rt3hMra3RW8Ijveh61dJg7-iCwFubJPyzJU', gid: '83070678' },
  /* 記事（雑誌・ウェブの記事・特集）。ディスコグラフィと同じく、ショウのぶんはショウケースの「記事」、ほかは Dytica のシートの「記事」タブ（列は同じ＋「参加」）。
     ⚠️ タブを作り直したら gid も変わる（シートの URL の #gid= のあとの数字）。空なら読まない */
  showcaseArticles: { label: 'ショウケースのシート（記事）', id: '1S9GmmMs6Rt3hMra3RW8Ijveh61dJg7-iCwFubJPyzJU', gid: '1541969232' },
  dyticaArticles:   { label: 'Dytica のシート（記事）',     id: '1Zh1XKg8B_j59gdfsCI9GVmPhKPFHjGb086dmbGjl5LY', gid: '1275787904' },   // 2026-10-19 に持ち主が作ったタブ
  dyticaDisco:   { label: 'Dytica のシート（ディスコグラフィ）',     id: '1Zh1XKg8B_j59gdfsCI9GVmPhKPFHjGb086dmbGjl5LY', gid: '1783567461' },   // 2026-10-15 に持ち主が作ったタブ
};

/* 4人。key はファイル名と URL に使う。色は決めたこと.md の7章。
   ⚠️ 元の色（mark）をそのまま文字に使わないこと。ライの黄緑は白地でコントラスト1.14でほぼ見えない。
      文字には textLight（明るい表示）／ textDark（暗い表示）を使う。印の上の文字は onMark。 */
const MEMBERS = [
  { key: 'sho',     short: 'ショウ', name: '星導ショウ', channelId: 'UCgZ0pH7j6c9z-pkOG3PYw1Q', mark: '#A58CDC', textLight: '#7F68B0', textDark: '#A58CDC', onMark: '#1A1A22' },
  { key: 'kagetsu', short: 'カゲツ', name: '叢雲カゲツ', channelId: 'UChdY64fJb14Nfnbs8EGdQig', mark: '#6EB487', textLight: '#42815A', textDark: '#6EB487', onMark: '#1A1A22' },
  { key: 'rou',     short: 'ロウ',   name: '小柳ロウ',   channelId: 'UC6WFKwYptsxVue56Lx218vg', mark: '#5A5FAA', textLight: '#5A5FAA', textDark: '#7278C6', onMark: '#FFFFFF' },
  { key: 'rai',     short: 'ライ',   name: '伊波ライ',   channelId: 'UCz89MGFBrAqwJ5xMr5weSuA', mark: '#DCFF50', textLight: '#667D00', textDark: '#DCFF50', onMark: '#1A1A22' },
];
const KEY_BY_SHORT = {}, KEY_BY_NAME = {};
MEMBERS.forEach(m => { KEY_BY_SHORT[m.short] = m.key; KEY_BY_NAME[nameKey(m.name)] = m.key; });

// 件数が前回の9割を切ったら止める（Google の不調で途中までしか読めなかったときに、サイトの中身が消えないように）
const MIN_RATIO = 0.9;

/* errors：止める理由／rows：外した行・直したい項目（持ち主が直すもの）／warnings：気になること／notes：知らせるだけ（直さなくてよい） */
const report = { errors: [], rows: [], warnings: [], notes: [] };
const fatal = (msg) => { report.errors.push(msg); };
const rowIssue = (source, row, msg, id) => { report.rows.push({ source, row, id: id || '', message: msg }); };
const warn = (msg) => { report.warnings.push(msg); };
const note = (msg) => { report.notes.push(msg); };

main().catch(e => {
  fatal('書き出しの途中で止まりました：' + e.message);
  finish(null);
});

async function main() {
  const previous = await readPrevious();

  // ── 読む ──
  const dyticaRows = await readSheet('dytica');
  const showcaseRows = await readSheet('showcase');
  const songsData = await readJson('songs');
  if (report.errors.length) return finish(null);

  const dy = parseDytica(dyticaRows);
  const sc = parseShowcase(showcaseRows);
  if (report.errors.length) return finish(null);
  const discography = await buildDiscography(previous);
  const articles = await buildArticles(previous);

  // ── まとめる ──
  const songs = buildSongs(songsData);
  const songIds = new Set(songs.map(s => s.i));
  const videos = mergeVideos(dy, sc, songIds);
  await fillGuestHosts(videos, previous);
  // ⚠️ 同じ企画のまとめ（開始時刻と長さで重なりを見る）より前に補うこと
  await fillShoStarts(videos, previous);
  const groups = groupSameCollab(videos);

  // ── 件数が大きく減っていないか ──
  const counts = { videos: videos.length, songs: songs.length, discography: discography.length, articles: articles.length };
  if (previous.meta && previous.meta.counts) {
    // ⚠️ ディスコグラフィ・記事は件数で止めない（20件ほどしかなく、2件消しただけで9割を切る）
    ['videos', 'songs'].forEach(k => {
      const before = previous.meta.counts[k] || 0;
      if (before && counts[k] < before * MIN_RATIO) {
        fatal(k + ' の件数が前回の ' + before + ' 件から ' + counts[k] + ' 件に減りました（9割を切ったので公開しません）。' +
          'シートが途中までしか読めなかったか、行が大きく消えた可能性があります');
      }
    });
  }
  if (report.errors.length) return finish(null);

  finish({ videos, songs, groups, counts, discography, articles });
}

// ───────────────────────── 読む ─────────────────────────

async function readSheet(key) {
  const src = SOURCES[key];
  try {
    const text = FROM
      ? fs.readFileSync(path.join(FROM, key + '.csv'), 'utf8')
      : await fetchText('https://docs.google.com/spreadsheets/d/' + src.id + '/export?format=csv&gid=' + src.gid);
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('行がありません');
    return rows;
  } catch (e) {
    fatal(src.label + ' が読めませんでした（' + e.message + '）');
    return [];
  }
}

/* 止めずに読む（ディスコグラフィのような、無くてもサイトが成り立つもの用）。読めなければ null */
async function readSheetSoft(key) {
  const src = SOURCES[key];
  if (FROM) {
    const f = path.join(FROM, key + '.csv');
    return fs.existsSync(f) ? parseCSV(fs.readFileSync(f, 'utf8')) : null;
  }
  if (!src.gid) return null;
  try {
    const rows = parseCSV(await fetchText('https://docs.google.com/spreadsheets/d/' + src.id + '/export?format=csv&gid=' + src.gid));
    return rows.length ? rows : null;
  } catch (e) {
    warn(src.label + ' が読めませんでした（' + e.message + '）。前回の公開のものを使いました');
    return null;
  }
}

async function readJson(key) {
  const src = SOURCES[key];
  try {
    return FROM ? JSON.parse(fs.readFileSync(path.join(FROM, key + '.json'), 'utf8')) : JSON.parse(await fetchText(src.url));
  } catch (e) {
    fatal(src.label + ' が読めませんでした（' + e.message + '）');
    return null;
  }
}

// 公開中の meta.json（前回の件数）・report.json（前回の点検）・他枠の持ち主の名前の控え。無くても止めない（初回は無い）
async function readPrevious() {
  const prev = { meta: null, report: null, hosts: {}, discography: null, articles: null, holodex: null };
  readPrevious.last = prev;
  if (args.prev) {   // 試すとき：前回の公開の代わりに、手元のフォルダ（前回の out/）を読む
    const read = f => { try { return JSON.parse(fs.readFileSync(path.join(args.prev, f), 'utf8')); } catch (e) { return null; } };
    prev.meta = read('meta.json'); prev.report = read('report.json'); prev.hosts = read('cache/hosts.json') || {}; prev.discography = read('discography.json'); prev.articles = read('articles.json'); prev.holodex = read('cache/holodex-sho.json');
    return prev;
  }
  if (!PAGES_URL || FROM) return prev;
  try { prev.meta = JSON.parse(await fetchText(PAGES_URL + 'meta.json?t=' + Date.now())); } catch (e) {}
  try { prev.report = JSON.parse(await fetchText(PAGES_URL + 'report.json?t=' + Date.now())); } catch (e) {}
  try { prev.hosts = JSON.parse(await fetchText(PAGES_URL + 'cache/hosts.json?t=' + Date.now())); } catch (e) {}
  try { prev.discography = JSON.parse(await fetchText(PAGES_URL + 'discography.json?t=' + Date.now())); } catch (e) {}
  try { prev.articles = JSON.parse(await fetchText(PAGES_URL + 'articles.json?t=' + Date.now())); } catch (e) {}
  try { prev.holodex = JSON.parse(await fetchText(PAGES_URL + 'cache/holodex-sho.json?t=' + Date.now())); } catch (e) {}
  readPrevious.last = prev;
  return prev;
}

async function fetchText(url) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) return await res.text();
      last = new Error('HTTP ' + res.status);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw last;
}

/* CSV を行の配列にする（引用符の中のカンマ・改行・"" に対応）。
   ⚠️ 1行ずつ split しないこと。概要欄などのセルに改行が入っていると、行がずれる。 */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* 見出し → 列番号。⚠️ ぴったり同じ文字で探す。部分一致にしないこと（「時間」と「再生時間」を取り違える）。 */
function headerIndex(rows, required, label) {
  const header = rows[0].map(h => String(h).trim());
  const col = {};
  const missing = [];
  required.forEach(h => { const i = header.indexOf(h); if (i < 0) missing.push(h); col[h] = i; });
  if (missing.length) fatal(label + ' に見出しが見つかりません：' + missing.join('、') + '（見出しの文字が変わっていないか確かめてください）');
  return col;
}

// ───────────────────────── 1行ずつ読み替える ─────────────────────────

/* Dytica のシートの1行 → 動画。確認が × の行は載せない。
   ⚠️ 外すのは、動画IDか公開日が読めない行だけ。ほかの列の問題は、その項目だけ捨てて知らせる。 */
function parseDytica(rows) {
  const label = SOURCES.dytica.label;
  const col = headerIndex(rows, ['動画URL', '動画タイトル', '公開日', '開始時刻', '再生時間', '枠', '出演', 'コラボ相手',
    'カテゴリ', '種別', '3D', '歌唱', '確認'], label);
  if (report.errors.length) return [];
  const out = [];
  const seen = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = h => String(r[col[h]] == null ? '' : r[col[h]]).trim();
    if (!r.some(x => String(x).trim())) continue;
    const rowNo = i + 1;
    const id = videoId(get('動画URL'));
    if (!id) { rowIssue('dytica', rowNo, '動画URL が読めないので、この行は載せていません'); continue; }
    const mark = get('確認');
    if (isCross(mark)) continue;
    if (mark && !isCircle(mark)) rowIssue('dytica', rowNo, '確認の印「' + mark + '」が分かりません（○ か × にしてください）。載せる扱いにしました', id);
    if (seen[id]) { rowIssue('dytica', rowNo, '同じ動画が ' + seen[id] + ' 行目にもあります。こちらは載せていません', id); continue; }
    seen[id] = rowNo;

    const date = normDate(get('公開日'));
    if (!date) { rowIssue('dytica', rowNo, '公開日「' + get('公開日') + '」が読めないので、この行は載せていません（2026/05/04 の形で、文字として入れてください）', id); continue; }

    const v = { i: id, t: get('動画タイトル'), d: date, src: 'dytica', row: rowNo, ok: isCircle(mark) };
    const time = get('開始時刻');
    if (time) { if (/^\d{1,2}:\d{2}$/.test(time)) v.s = time.padStart(5, '0'); else rowIssue('dytica', rowNo, '開始時刻「' + time + '」が読めないので、空として扱いました', id); }
    const len = get('再生時間');
    if (len) { const sec = hmsToSeconds(len); if (sec) v.l = sec; else rowIssue('dytica', rowNo, '再生時間「' + len + '」が読めないので、空として扱いました（0:37:46 の形で）', id); }

    const host = get('枠');
    if (KEY_BY_SHORT[host]) v.h = KEY_BY_SHORT[host]; else if (host) v.o = host;

    const members = [];
    splitList(get('出演')).forEach(n => {
      const k = KEY_BY_SHORT[n] || KEY_BY_NAME[nameKey(n)];
      if (k) { if (members.indexOf(k) === -1) members.push(k); }
      else rowIssue('dytica', rowNo, '出演の「' + n + '」が4人の誰か分かりません（ショウ・カゲツ・ロウ・ライ のどれか）。外しました', id);
    });
    if (v.h && members.indexOf(v.h) === -1) members.push(v.h);
    v.m = sortMembers(members);
    const collabs = splitList(get('コラボ相手')).filter(n => !KEY_BY_NAME[nameKey(n)]);
    if (collabs.length) v.c = collabs;

    const cat = get('カテゴリ'); if (cat) v.g = cat;
    v.k = kindOf(get('種別'), 'dytica', rowNo, id);
    if (isCircle(get('3D'))) v.d3 = 1;
    if (isCircle(get('歌唱'))) v.sg = 1;
    out.push(v);
  }
  return out;
}

/* ショウケースの1行 → 動画。枠は「他チャンネル」が空ならショウ、○なら他枠（持ち主の名前はあとで埋める）。
   出演は「ショウ＋コラボ相手のうち Dytica の人」。 */
function parseShowcase(rows) {
  const label = SOURCES.showcase.label;
  const col = headerIndex(rows, ['動画URL', '動画タイトル', '公開日', '他チャンネル', 'カテゴリ', '種別', '3D', '歌唱',
    '再生時間', 'コラボ相手'], label);
  if (report.errors.length) return [];
  const out = [];
  const seen = {};
  let notYouTube = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = h => String(r[col[h]] == null ? '' : r[col[h]]).trim();
    const rowNo = i + 1;
    const url = get('動画URL');
    if (!url) continue;   // ショウケースは、先に番号だけ入れた空の行がある
    const id = videoId(url);
    // YouTube 以外の動画は、ショウケースが意図して入れているもの。直す対象ではないので、数だけ知らせる
    if (!id) { notYouTube++; continue; }
    if (seen[id]) continue;   // 同じ動画が2行あるのはショウケース側の点検の役目。ここでは先の行を使う
    seen[id] = rowNo;
    const date = normDate(get('公開日'));
    if (!date) { rowIssue('showcase', rowNo, '公開日「' + get('公開日') + '」が読めないので、載せていません', id); continue; }

    const v = { i: id, t: get('動画タイトル'), d: date, src: 'showcase', row: rowNo };
    const sec = hmsToSeconds(get('再生時間')); if (sec) v.l = sec;
    if (!get('他チャンネル')) v.h = 'sho';
    const members = ['sho'];
    const collabs = [];
    splitList(get('コラボ相手')).forEach(n => {
      const k = KEY_BY_NAME[nameKey(n)];
      if (k) { if (members.indexOf(k) === -1) members.push(k); }
      else collabs.push(n);
    });
    v.m = sortMembers(members);
    if (collabs.length) v.c = collabs;
    const cat = get('カテゴリ'); if (cat) v.g = cat;
    v.k = kindOf(get('種別'), 'showcase', rowNo, id);
    if (isCircle(get('3D'))) v.d3 = 1;
    if (isCircle(get('歌唱'))) v.sg = 1;
    out.push(v);
  }
  if (notYouTube) note('ショウケースの YouTube 以外の動画 ' + notYouTube + ' 件は載せていません');
  return out;
}

// ───────────────────────── まとめる ─────────────────────────

/* 同じ動画が両方にあるとき（ショウがカゲツの枠に出た、など）は1件にまとめる。
   枠・開始時刻・種別は Dytica のシートを使い、出演とコラボ相手は合わせる。
   カテゴリは、Dytica のシートで確認済み（○）ならそちら、まだならショウケース（手で入れた値）を使う。
   Dytica のシートの確認していないカテゴリは自動の提案なので、手で入れた値より当てにならない
   （初回の書き出しで食い違った2件は、どちらも提案のほうが外れていた）。
   確認済みどうしで食い違ったら知らせる（入れるなら食い違いを点検で見張る、という引き継ぎ書の決まり）。
   楽曲（MECHATU-NE に載っているもの）は動画から外す。 */
function mergeVideos(dy, sc, songIds) {
  const byId = {};
  dy.forEach(v => { byId[v.i] = v; });
  sc.forEach(s => {
    const v = byId[s.i];
    if (!v) { byId[s.i] = s; return; }
    v.src = 'both';
    v.m = sortMembers(Array.from(new Set(v.m.concat(s.m))));
    const c = mergeNames(v.c || [], s.c || []);
    if (c.length) v.c = c;
    if (!v.l && s.l) v.l = s.l;
    if (v.g && s.g && v.g !== s.g && v.ok) {
      warn('カテゴリが食い違っています：' + s.i + '（Dytica のシート ' + v.row + ' 行目「' + v.g + '」／ショウケース ' + s.row + ' 行目「' + s.g + '」）。確認済みの Dytica のシートのほうを使いました');
    }
    if (s.g && (!v.g || !v.ok)) v.g = s.g;
    if (s.d3) v.d3 = 1;
    if (s.sg) v.sg = 1;
  });
  // Dytica のシートで × にした動画は、ショウケースにあっても載せない（持ち主が「載せない」と決めたもの）
  // （× の行は parseDytica で落としているので、ここでは確認の印を持つ行をもう一度見る必要はない）
  const list = Object.values(byId).filter(v => {
    if (!songIds.has(v.i)) return true;
    if (v.src !== 'showcase') warn('楽曲（MECHATU-NE に載っている曲）が動画のシートにあります：' + v.i + '「' + v.t.slice(0, 30) + '」。動画からは外しました（確認に × を付けてください）');
    return false;
  });
  list.sort((a, b) => (b.d + (b.s || '')).localeCompare(a.d + (a.s || '')) || a.i.localeCompare(b.i));
  return list;
}

/* ショウケースの他枠の行には、枠の持ち主の列が無い。YouTube の oEmbed（キー不要）でチャンネル名を引いて埋める。
   引いた名前は cache/hosts.json に控えて、次回からは問い合わせない（公開中のデータから読む）。
   ⚠️ 引けなくても止めない（枠の名前が空になるだけ）。件数は知らせる。 */
async function fillGuestHosts(videos, previous) {
  const cache = Object.assign({}, previous.hosts || {});
  if (FROM && fs.existsSync(path.join(FROM, 'hosts.json'))) Object.assign(cache, JSON.parse(fs.readFileSync(path.join(FROM, 'hosts.json'), 'utf8')));
  const need = videos.filter(v => !v.h && !v.o);
  const ask = need.filter(v => !(v.i in cache));
  let failed = 0;
  if (!FROM) {
    for (let k = 0; k < ask.length; k += 5) {
      await Promise.all(ask.slice(k, k + 5).map(async v => {
        try {
          const j = JSON.parse(await fetchText('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + v.i)));
          cache[v.i] = cleanChannelName(j.author_name);
        } catch (e) { failed++; }
      }));
    }
  }
  need.forEach(v => { if (cache[v.i]) v.o = cache[v.i]; });
  if (failed) warn('他枠の持ち主の名前が引けなかった動画：' + failed + '件（非公開・削除の可能性。次回また試します）');
  fillGuestHosts.cache = cache;
}

/* ショウの配信の開始時刻（と、無ければ長さ）を Holodex から補う。
   ショウのぶんはショウケースのシートから読むが、ショウケースには開始時刻の列が無い（2026-10-16 に持ち主が気づいた。
   ショウが出ている配信1,308本のうち1,016本に時刻が無かった）。ほかの3人のぶんは、取り込みが開始時刻を入れている。
   - ショウのチャンネルの動画（/videos）と、ほかの人の枠への出演（/collabs）を取る。include=live_info を付けること（付けないと start_actual が無い）
   - 取った時刻は cache/holodex-sho.json に控え、次からは新しい2ページ（100本）ずつだけ取る。週1回は全部取り直す（約50回の問い合わせ）
   - ⚠️ シートの日付と Holodex の開始日（日本時間）が違うものには入れない。日付ごと食い違っている可能性があるため（知らせるだけ）
     手元の控えで確かめた数：時刻の無い1,016本のうち Holodex にあるもの1,006本、日付が合うもの1,001本、違うもの4本
   - ⚠️ Holodex が読めなくても止めない。前回の控えだけで補う */
const HOLODEX_BASE = 'https://holodex.net/api/v2';
const HOLODEX_REFRESH_DAYS = 7;
async function fillShoStarts(videos, previous) {
  const prevCache = (previous && previous.holodex) || {};
  const cache = { fullAt: prevCache.fullAt || '', items: Object.assign({}, prevCache.items || {}) };   // 動画ID → [開始の秒（世界時）, 長さの秒]
  const key = (process.env.HOLODEX_API_KEY || '').trim();
  if (key) {
    const full = !cache.fullAt || Date.now() - Date.parse(cache.fullAt) > HOLODEX_REFRESH_DAYS * 86400e3 || process.env.HOLODEX_FULL === 'true';
    try {
      for (const kind of ['videos', 'collabs']) {
        const list = await holodexPages('/channels/' + MEMBERS[0].channelId + '/' + kind, full ? 80 : 2, key);
        list.forEach(h => {
          const t = Date.parse(h.start_actual || '');
          if (!isNaN(t)) cache.items[h.id] = [Math.round(t / 1000), h.duration || 0];
        });
      }
      if (full) cache.fullAt = new Date().toISOString();
    } catch (e) {
      note('Holodex が読めなかったので、前回の控えだけでショウの配信の開始時刻を補いました（' + e.message + '）');
    }
  } else if (!FROM) {
    note('Holodex のキーが無いので、前回の控えだけでショウの配信の開始時刻を補いました');
  }
  let filled = 0;
  const mismatch = [];
  videos.forEach(v => {
    if (v.s || v.k !== 'L' || v.m.indexOf('sho') === -1) return;
    const h = cache.items[v.i];
    if (!h || !h[0]) return;
    const jst = new Date(h[0] * 1000 + 9 * 3600e3).toISOString();
    if (jst.slice(0, 10) !== v.d) { mismatch.push(v.i + '（シート ' + v.d + '／Holodex ' + jst.slice(0, 10) + ' ' + jst.slice(11, 16) + '）'); return; }
    v.s = jst.slice(11, 16);
    if (!v.l && h[1]) v.l = h[1];
    filled++;
  });
  if (mismatch.length) note('ショウの配信のうち、シートの日付と Holodex の開始日が違うため、開始時刻を入れなかったもの ' + mismatch.length + ' 本：' + mismatch.join('、'));
  console.log('ショウの配信の開始時刻を Holodex から補いました：' + filled + ' 本（控え ' + Object.keys(cache.items).length + ' 本）');
  fillShoStarts.cache = cache;
}

/* Holodex の一覧を、新しい順に maxPages ページ（1ページ50件）まで取る。
   ⚠️ キーはヘッダーで渡す（URL に入れない。公開リポジトリなので、実行の記録はだれでも見られる） */
async function holodexPages(apiPath, maxPages, key) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const url = HOLODEX_BASE + apiPath + '?limit=50&offset=' + page * 50 + '&include=live_info&paginated=1';
    let body, last;
    for (let attempt = 0; attempt < 3 && !body; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'X-APIKEY': key } });
        if (res.ok) body = await res.json();
        else { last = new Error('HTTP ' + res.status); if (res.status < 500 && res.status !== 429) break; }
      } catch (e) { last = e; }
      if (!body) await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
    }
    if (!body) throw last;
    const items = Array.isArray(body) ? body : (body.items || []);
    out.push(...items);
    if (items.length < 50 || (body.total && (page + 1) * 50 >= Number(body.total))) break;
    await new Promise(r => setTimeout(r, 300));   // 続けて問い合わせすぎないように
  }
  return out;
}

/* 4人がそれぞれの枠で同じコラボを配信したとき、同じ企画として印（p＝代表の動画ID）を付ける。
   一覧で4回並ばないよう、画面側で1件にまとめるのに使う（引き継ぎ書の「人数ぶん増えると一覧が埋まる」）。
   決まり：どちらも Dytica の誰かの枠の配信で、枠の持ち主が違い、お互いの出演に相手の枠の持ち主が入っていて、
   開始時刻があれば10分以上重なる（無ければ同じ日）。ショウケースの行には開始時刻が無いので、同じ日で見る。 */
function groupSameCollab(videos) {
  const cand = videos.filter(v => v.h && v.k === 'L' && v.m.length >= 2);
  const parent = {};
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  cand.forEach(v => { parent[v.i] = v.i; });
  const byDate = {};
  cand.forEach(v => { (byDate[v.d] = byDate[v.d] || []).push(v); });
  const span = v => { const t = Date.parse(v.d + 'T' + v.s + ':00+09:00'); return [t, t + (v.l || 0) * 1000]; };
  Object.values(byDate).forEach(list => {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const x = list[a], y = list[b];
      if (x.h === y.h || x.m.indexOf(y.h) === -1 || y.m.indexOf(x.h) === -1) continue;
      if (x.s && y.s && x.l && y.l) {
        const [p, q] = span(x), [r, s] = span(y);
        if (Math.min(q, s) - Math.max(p, r) < 10 * 60 * 1000) continue;
      }
      parent[find(x.i)] = find(y.i);
    }
  });
  const members = {};
  cand.forEach(v => { (members[find(v.i)] = members[find(v.i)] || []).push(v); });
  let count = 0;
  Object.values(members).forEach(list => {
    if (list.length < 2) return;
    count++;
    // 代表は、枠の持ち主が4人の並び順でいちばん前の動画
    list.sort((a, b) => memberOrder(a.h) - memberOrder(b.h));
    list.forEach(v => { v.p = list[0].i; });
  });
  return count;
}

/* MECHATU-NE の楽曲のうち、4人の誰かが歌っているもの（歌ってみた・オリジナル）。
   ⚠️ 歌枠・ライブは入れない（それらは配信なので動画のほうに入る）。
   ⚠️ 公開日は「2026-09-03T15:00:00.000Z」のように日本時間の0時が世界時で届くので、日本時間に直して日付にする。 */
function buildSongs(data) {
  const rows = (data && data['検索用']) || [];
  if (!rows.length) { fatal(SOURCES.songs.label + ' に「検索用」の一覧がありません（中身の形が変わっていないか確かめてください）'); return []; }
  const byId = {};
  rows.forEach(r => {
    const kind = String(r['種類'] || '');
    if (!/歌ってみた|オリジナル/.test(kind)) return;
    const id = videoId(r['URL']);
    if (!id) return;
    const who = sortMembers(Array.from(new Set(splitList(r['参加メンバー']).map(n => KEY_BY_NAME[nameKey(n)]).filter(Boolean))));
    if (!who.length) return;
    if (byId[id]) return;
    const t = Date.parse(r['公開日']);
    const s = { i: id, t: String(r['曲名'] || r['枠名'] || '').trim(), m: who, k: /オリジナル/.test(kind) ? 'original' : 'cover' };
    if (!isNaN(t)) s.d = new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
    if (r['原曲']) s.o = String(r['原曲']).trim();
    if (r['歌唱']) s.v = String(r['歌唱']).trim();
    if (r['購入']) s.b = String(r['購入']).trim();
    byId[id] = s;
  });
  return Object.values(byId).sort((a, b) => String(b.d || '').localeCompare(String(a.d || '')));
}

/* ディスコグラフィ（CD・Blu-ray・デジタル配信の作品）。
   ショウケースのシートの行は、ショウが参加した作品。Dytica のシートの行は「参加」に書いた人の作品。
   同じ作品が両方にあるとき（MECHATU-A の作品など）は、販売ページの URL で見分けて1件にし、参加した人を合わせる。
   1つの作品の版違い（通常盤・初回限定盤・デジタルなど）は、シートでは別の行のまま。画面で1枚のカードにまとめる。
   ⚠️ 読めなかったときは止めず、前回の公開のものを使う（ディスコグラフィが読めないだけで、動画の更新まで止めないため） */
async function buildDiscography(previous) {
  const scRows = await readSheetSoft('showcaseDisco');
  const dyRows = await readSheetSoft('dyticaDisco');
  if (!SOURCES.dyticaDisco.gid && !FROM) note('Dytica のシートの「ディスコグラフィ」タブは、まだ読んでいません（タブを作ったら export/build.js に gid を入れる）');
  if (!scRows && !dyRows) return (previous && previous.discography) || [];
  const byKey = {};
  const order = [];
  const add = (item) => {
    const key = normUrl(item.b) || [item.t, item.k, item.d || item.y].join('|');
    const had = byKey[key];
    if (!had) { byKey[key] = item; order.push(key); return; }
    had.m = sortMembers(Array.from(new Set(had.m.concat(item.m))));
    ['v', 'n', 'd', 'y'].forEach(f => { if (!had[f] && item[f]) had[f] = item[f]; });
  };
  if (scRows) parseDisco(scRows, 'showcaseDisco').forEach(add);
  if (dyRows) parseDisco(dyRows, 'dyticaDisco').forEach(add);
  return order.map(k => byKey[k]).sort((a, b) => String(b.d || b.y).localeCompare(String(a.d || a.y)) || a.t.localeCompare(b.t));
}

/* ディスコグラフィのシートの1行 → 作品。見出しはぴったり同じ文字で探す（ショウケースの見出しに合わせた）。
   ⚠️ 見出しが無いときも止めない（その表だけ読まずに知らせる） */
function parseDisco(rows, key) {
  const label = SOURCES[key].label;
  const header = rows[0].map(h => String(h).trim());
  const need = ['リリース日', 'タイトル', '種別', '販売ページ', '関連動画'].concat(key === 'dyticaDisco' ? ['参加'] : []);
  const missing = need.filter(h => header.indexOf(h) === -1);
  if (missing.length) { warn(label + ' に見出しが見つかりません：' + missing.join('、') + '。この表は読んでいません'); return []; }
  const col = h => header.indexOf(h);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = h => (col(h) < 0 ? '' : String(r[col(h)] == null ? '' : r[col(h)]).trim());
    const title = get('タイトル');
    if (!title) continue;
    const rowNo = i + 1;
    const item = { t: title, k: get('種別') || 'その他' };
    const date = normDate(get('リリース日'));
    if (date) item.d = date;
    else {
      const y = (get('年').match(/^\d{4}$/) || [])[0];
      if (get('リリース日')) rowIssue(key, rowNo, 'リリース日「' + get('リリース日') + '」が読めません（2026/07/22 の形で、文字として入れてください）' + (y ? '。年だけで載せました' : '。この行は載せていません'));
      if (!y) { if (!get('リリース日')) rowIssue(key, rowNo, 'リリース日も年も空なので、この行は載せていません'); continue; }
      item.y = y;
    }
    const shop = get('販売ページ'); if (/^https?:\/\//.test(shop)) item.b = shop;
    const vid = videoId(get('関連動画')); if (vid) item.v = vid;
    const memo = get('備考'); if (memo) item.n = memo;
    if (key === 'showcaseDisco') item.m = ['sho'];
    else {
      const ms = [];
      splitList(get('参加')).forEach(n => {
        const k = KEY_BY_SHORT[n] || KEY_BY_NAME[nameKey(n)];
        if (k) { if (ms.indexOf(k) === -1) ms.push(k); }
        else rowIssue(key, rowNo, '参加の「' + n + '」が4人の誰か分かりません（ショウ・カゲツ・ロウ・ライ のどれか）。外しました');
      });
      if (!ms.length) { rowIssue(key, rowNo, '参加が空なので、この行は載せていません'); continue; }
      item.m = sortMembers(ms);
    }
    out.push(item);
  }
  return out;
}

/* 記事（雑誌・ウェブの記事・特集）。ショウケースのシートの行はショウが出ている記事、Dytica のシートの行は「参加」に書いた人の記事。
   同じ記事が両方にあるとき（Dytica・MECHATU-A の記事など）は、URL で見分けて1件にし、出ている人を合わせる。
   ⚠️ 読めなくても止めず、前回の公開のものを使う（ディスコグラフィと同じ） */
async function buildArticles(previous) {
  const scRows = await readSheetSoft('showcaseArticles');
  const dyRows = await readSheetSoft('dyticaArticles');
  if (!SOURCES.dyticaArticles.gid && !FROM) note('Dytica のシートの「記事」タブは、まだ読んでいません（タブを作ったら export/build.js に gid を入れる）');
  if (!scRows && !dyRows) return (previous && previous.articles) || [];
  const byKey = {};
  const order = [];
  const add = (item) => {
    const key = articleKey(item.u) || item.t;
    const had = byKey[key];
    if (!had) { byKey[key] = item; order.push(key); return; }
    had.m = sortMembers(Array.from(new Set(had.m.concat(item.m))));
    ['d', 'g'].forEach(f => { if (!had[f] && item[f]) had[f] = item[f]; });
  };
  if (scRows) parseArticles(scRows, 'showcaseArticles').forEach(add);
  if (dyRows) parseArticles(dyRows, 'dyticaArticles').forEach(add);
  return order.map(k => byKey[k]).sort((a, b) => String(b.d || '').localeCompare(String(a.d || '')) || a.t.localeCompare(b.t));
}

/* 記事のシートの1行 → 記事。見出しはショウケースに合わせた（「ＵＲＬ」は全角）。
   ⚠️ 見出しが無いときも止めない（その表だけ読まずに知らせる） */
function parseArticles(rows, key) {
  const label = SOURCES[key].label;
  const header = rows[0].map(h => String(h).trim());
  const need = ['日付', '記事タイトル', 'ＵＲＬ', 'カテゴリ'].concat(key === 'dyticaArticles' ? ['参加'] : []);
  const missing = need.filter(h => header.indexOf(h) === -1);
  if (missing.length) { warn(label + ' に見出しが見つかりません：' + missing.join('、') + '。この表は読んでいません'); return []; }
  const col = h => header.indexOf(h);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = h => (col(h) < 0 ? '' : String(r[col(h)] == null ? '' : r[col(h)]).trim());
    const title = get('記事タイトル');
    if (!title) continue;
    const rowNo = i + 1;
    const url = get('ＵＲＬ');
    if (!/^https?:\/\//.test(url)) { rowIssue(key, rowNo, 'ＵＲＬ が読めないので、この行は載せていません'); continue; }
    const item = { t: title, u: url };
    const date = normDate(get('日付'));
    if (date) item.d = date;
    else if (get('日付')) rowIssue(key, rowNo, '日付「' + get('日付') + '」が読めません（2026/09/18 の形で、文字として入れてください）。日付なしで載せました');
    const cat = get('カテゴリ'); if (cat) item.g = cat;
    if (key === 'showcaseArticles') item.m = ['sho'];
    else {
      const ms = [];
      splitList(get('参加')).forEach(n => {
        const k = KEY_BY_SHORT[n] || KEY_BY_NAME[nameKey(n)];
        if (k) { if (ms.indexOf(k) === -1) ms.push(k); }
        else rowIssue(key, rowNo, '参加の「' + n + '」が4人の誰か分かりません（ショウ・カゲツ・ロウ・ライ のどれか）。外しました');
      });
      if (!ms.length) { rowIssue(key, rowNo, '参加が空なので、この行は載せていません'); continue; }
      item.m = sortMembers(ms);
    }
    out.push(item);
  }
  return out;
}

/* 記事の URL を比べるときの形。
   ⚠️ ? のあとを丸ごと捨てないこと。animatetimes.com は ?id= で記事を見分けるので、別の記事が1つにまとまってしまう（試したときに起きた）。
      捨てるのは、記事を見分けるのに使わない付け足し（?rtw・utm_…・si など）だけ */
function articleKey(u) {
  try {
    const url = new URL(String(u || '').trim());
    [...url.searchParams.keys()].forEach(k => { if (/^(utm_.*|si|rtw|ref|x_share|lang|s)$/i.test(k)) url.searchParams.delete(k); });
    url.searchParams.sort();
    return url.host.toLowerCase() + url.pathname.replace(/\/$/, '') + (url.search || '');
  } catch (e) { return ''; }
}

// 販売ページの URL を比べるときの形（?lang=ja や末尾の / の違いを同じにする）
function normUrl(u) {
  const m = String(u || '').trim().match(/^https?:\/\/([^\/?#]+)([^?#]*)/i);
  return m ? m[1].toLowerCase() + m[2].replace(/\/$/, '') : '';
}

// ───────────────────────── 書き出す ─────────────────────────

/* out/ に書く。止めたとき（data が null）は report.json だけ書いて、失敗で終える（GitHub からメールが届く）。
   ⚠️ 止めたときは公開用のファイルを書かないこと。前のデータのまま公開が続くようにするため。 */
function finish(data) {
  fs.mkdirSync(OUT, { recursive: true });
  const now = new Date().toISOString();
  const status = { generatedAt: now, ok: !report.errors.length, errors: report.errors, rows: report.rows, warnings: report.warnings, notes: report.notes };

  /* 前回の点検に無かった問題の数。GitHub からのメールは、これが1件以上のときだけにする。
     ⚠️ 直したい項目があるたびに失敗させないこと。直すまで3時間おきにメールが届いてしまう。 */
  const prevReport = (readPrevious.last && readPrevious.last.report) || { rows: [], warnings: [] };
  const sig = x => typeof x === 'string' ? x : x.source + '|' + x.id + '|' + x.message;
  const before = new Set((prevReport.rows || []).concat(prevReport.warnings || []).map(sig));
  const newIssues = report.rows.concat(report.warnings).filter(x => !before.has(sig(x))).length;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'new_issues=' + newIssues + '\n');
  if (!data) {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(status, null, 1));
    summary(status, null);
    console.error('止めました：\n- ' + report.errors.join('\n- '));
    process.exitCode = 1;
    return;
  }
  const clean = v => { const o = Object.assign({}, v); delete o.src; delete o.row; delete o.ok; return o; };
  const files = {};
  const write = (name, value) => {
    const text = JSON.stringify(value);
    fs.mkdirSync(path.dirname(path.join(OUT, name)), { recursive: true });
    fs.writeFileSync(path.join(OUT, name), text);
    files[name] = { hash: crypto.createHash('sha1').update(text).digest('hex').slice(0, 10), bytes: Buffer.byteLength(text) };
  };
  const vids = data.videos.map(clean);
  write('videos/all.json', vids);
  MEMBERS.forEach(m => write('videos/' + m.key + '.json', vids.filter(v => v.m.indexOf(m.key) !== -1)));
  write('videos/dytica.json', vids.filter(v => v.m.length >= 2));
  write('videos/latest.json', vids.slice(0, 60));
  write('songs.json', data.songs);
  write('discography.json', data.discography);
  write('articles.json', data.articles);
  write('cache/hosts.json', fillGuestHosts.cache || {});
  write('cache/holodex-sho.json', fillShoStarts.cache || { fullAt: '', items: {} });

  const meta = {
    generatedAt: now,
    counts: data.counts,
    sameCollabGroups: data.groups,
    members: MEMBERS.map(m => ({ key: m.key, short: m.short, name: m.name, mark: m.mark, textLight: m.textLight, textDark: m.textDark, onMark: m.onMark })),
    files: files,
  };
  /* 中身が前回と同じかを見分ける印。同じなら公開しなくてよい。
     generatedAt は含めない（毎回変わるので、いつも「変わった」になる）。
     点検の結果は含める（直したい項目だけが変わったときも、report.json を公開し直すため）。 */
  meta.contentHash = crypto.createHash('sha1')
    .update(JSON.stringify(files) + JSON.stringify([report.rows, report.warnings, report.notes]))
    .digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(status, null, 1));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  summary(status, meta);
  console.log('書き出しました：動画 ' + data.counts.videos + ' 件・楽曲 ' + data.counts.songs + ' 件・ディスコグラフィ ' + data.counts.discography + ' 件・記事 ' + data.counts.articles + ' 件・同じ企画のまとまり ' + data.groups + ' 組' +
    '｜外した行・直したい項目 ' + report.rows.length + ' 件｜気になること ' + report.warnings.length + ' 件');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'content_hash=' + meta.contentHash + '\n');
}

// 実行のページの「Summary」に出す（GitHub Actions のときだけ）
function summary(status, meta) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = ['## データの書き出し', ''];
  if (!status.ok) lines.push('### ⛔ 止めました（公開していません。前のデータのままです）', '', ...status.errors.map(e => '- ' + e), '');
  if (meta) {
    lines.push('| | 件数 | 大きさ |', '|---|---|---|');
    Object.keys(meta.files).forEach(f => lines.push('| ' + f + ' | | ' + Math.round(meta.files[f].bytes / 1024) + 'KB |'));
    lines.push('', '動画 ' + meta.counts.videos + ' 件・楽曲 ' + meta.counts.songs + ' 件・ディスコグラフィ ' + meta.counts.discography + ' 件・記事 ' + meta.counts.articles + ' 件・同じ企画のまとまり ' + meta.sameCollabGroups + ' 組', '');
  }
  if (status.rows.length) {
    lines.push('### 外した行・直したい項目（' + status.rows.length + ' 件）', '', '| シート | 行 | 内容 |', '|---|---|---|');
    const SHEET = { dytica: 'Dytica', showcase: 'ショウケース', dyticaDisco: 'Dytica（ディスコグラフィ）', showcaseDisco: 'ショウケース（ディスコグラフィ）', dyticaArticles: 'Dytica（記事）', showcaseArticles: 'ショウケース（記事）' };
    status.rows.slice(0, 200).forEach(r => lines.push('| ' + (SHEET[r.source] || r.source) + ' | ' + r.row + ' | ' + r.message + ' |'));
    lines.push('');
  }
  if (status.warnings.length) lines.push('### 気になること（' + status.warnings.length + ' 件）', '', ...status.warnings.slice(0, 200).map(w => '- ' + w), '');
  if (status.notes.length) lines.push('### お知らせ', '', ...status.notes.map(w => '- ' + w), '');
  fs.appendFileSync(file, lines.join('\n') + '\n');
}

// ───────────────────────── 小さな道具 ─────────────────────────

function videoId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

// 「2026/5/4」「2026/05/04」→「2026-05-04」。読めなければ空（「1899/12/30」のような化けも空にする）
function normDate(s) {
  const m = String(s || '').match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m || +m[1] < 2019) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) return '';   // 2026/02/30 など
  return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
}

function hmsToSeconds(s) {
  const m = String(s || '').match(/^(\d+):(\d{2}):(\d{2})$/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

// 種別：空欄＝配信（L）、Shorts（S）、動画（V）。ショウケースと同じ言葉
function kindOf(s, source, row, id) {
  if (!s) return 'L';
  if (/^shorts$/i.test(s)) return 'S';
  if (s === '動画') return 'V';
  rowIssue(source, row, '種別「' + s + '」が分かりません（空欄・Shorts・動画 のどれか）。配信として扱いました', id);
  return 'L';
}

/* 名前の並び（出演・コラボ相手）を分ける。区切りはカンマ（半角・全角）と読点。
   ⚠️ 「・」は区切りにしないこと。「ジョー・力一」のように名前そのものに入っている（ショウケースと同じ決まり）。 */
function splitList(s) {
  return String(s || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean);
}

// 名前を比べるときの形。「ミン スゥーハ」と「ミン・スゥーハ」のような書き方の違いを同じにする
function nameKey(s) {
  return String(s || '').normalize('NFKC').replace(/[\s・･·]/g, '');
}

function mergeNames(a, b) {
  const out = a.slice();
  const keys = new Set(a.map(nameKey));
  b.forEach(n => { if (!keys.has(nameKey(n))) { out.push(n); keys.add(nameKey(n)); } });
  return out;
}

function memberOrder(key) { return MEMBERS.findIndex(m => m.key === key); }
function sortMembers(keys) { return keys.slice().sort((a, b) => memberOrder(a) - memberOrder(b)); }
function isCircle(s) { return /^[○〇◯oO]$/.test(String(s || '').trim()); }
function isCross(s) { return /^[×✕✖xX]$/.test(String(s || '').trim()); }

// 「叢雲カゲツ / Murakumo Kagetsu【にじさんじ】」→「叢雲カゲツ」
function cleanChannelName(name) {
  return String(name || '').split(' / ')[0].replace(/【[^】]*】/g, '').trim();
}
