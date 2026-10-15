/* 4人のこれからの配信（配信予定・配信中）を Holodex から取って、out/upcoming.json に書く

   なぜ Holodex か：
     シートに入るのは、持ち主が登録したものか、取り込み（Apps Script）が拾った公開済みの動画だけ。
     YouTube の待機所（配信予定の枠）は Holodex がすぐ拾うので、「これからの配信」はここから取る。
     4人のチャンネルの予定に加えて、ほかの人の枠でも 4人の名前が入っている（mentions）予定も、1回の問い合わせで返ってくる
     （/users/live。2026-10-15 に確かめた：にじさんじ公式の「MECHATU-A 同時視聴」が出演者つきで返ってきた）。

   使い方:
     node export/upcoming.js --out out                 … Holodex から取る（キーは環境変数 HOLODEX_API_KEY）
     node export/upcoming.js --out out --from <ファイル>  … 手元に控えた Holodex の返事（JSON）から作る（試すとき）

   ⚠️ キーを表示しないこと。URL にも入れない（ヘッダーで渡す）。公開リポジトリなので、実行の記録はだれでも見られる。
   ⚠️ 読めなくても失敗にしないこと（データの公開まで止めない）。前回の一覧から、まだ来ていない予定だけを残す。 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = {};
process.argv.slice(2).forEach((a, i, all) => { if (a.startsWith('--')) args[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true; });
const OUT = args.out || 'out';
const FROM = typeof args.from === 'string' ? args.from : '';
const PAGES_URL = (process.env.PAGES_URL || '').replace(/\/?$/, '/');
const KEY = (process.env.HOLODEX_API_KEY || '').trim();

// 4人のチャンネル（export/build.js の MEMBERS と同じ。並びも同じ）
const MEMBERS = [
  { key: 'sho',     channelId: 'UCgZ0pH7j6c9z-pkOG3PYw1Q' },
  { key: 'kagetsu', channelId: 'UChdY64fJb14Nfnbs8EGdQig' },
  { key: 'rou',     channelId: 'UC6WFKwYptsxVue56Lx218vg' },
  { key: 'rai',     channelId: 'UCz89MGFBrAqwJ5xMr5weSuA' },
];
const KEY_BY_CHANNEL = {};
MEMBERS.forEach(m => { KEY_BY_CHANNEL[m.channelId] = m.key; });

/* 載せる範囲。
   - 先の予定は30日まで。⚠️ フリーチャットの枠は何年も先の日付で置いてあることが多く、そのままだと一覧の頭に居座る
   - 予定の時刻を6時間過ぎても「予定」のままのものは、流れた枠として外す（Holodex では消えるまでしばらく残る） */
const AHEAD_DAYS = 30;
const STALE_HOURS = 6;
const summary = [];

main().catch(e => { summary.push('⚠️ 止まりました（データの公開は続けます）：' + e.message); writeSummary(); });

async function main() {
  const prev = await readPrevious();
  let raw;
  try {
    raw = await fetchHolodex();
  } catch (e) {
    // 読めなかったときは、前回の一覧のうち、まだ来ていない予定だけを残す
    const kept = ((prev && prev.items) || []).filter(v => Date.parse(v.s) > Date.now() - STALE_HOURS * 3600e3);
    summary.push('⚠️ Holodex から読めませんでした（' + e.message + '）。前回の一覧から ' + kept.length + ' 件を残しました');
    return write({ items: kept, error: e.message });
  }
  const items = toItems(raw);
  summary.push('これからの配信：' + items.length + ' 件（Holodex の返事 ' + raw.length + ' 件から）');
  write({ items });
}

async function fetchHolodex() {
  if (FROM) return JSON.parse(fs.readFileSync(FROM, 'utf8'));
  if (!KEY) throw new Error('キー（HOLODEX_API_KEY）がありません。GitHub の Settings → Secrets and variables → Actions に登録してください');
  const url = 'https://holodex.net/api/v2/users/live?channels=' + MEMBERS.map(m => m.channelId).join(',');
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'X-APIKEY': KEY } });
      if (res.ok) {
        const body = await res.json();
        if (!Array.isArray(body)) throw new Error('返事の形が違います');
        return body;
      }
      last = new Error('HTTP ' + res.status);
      if (res.status < 500 && res.status !== 429) break;   // キーの間違い（401・403）などは、何度試しても同じ
    } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw last;
}

/* Holodex の返事 → サイト用の1件。形は README.md の「これからの配信」。 */
function toItems(raw) {
  const now = Date.now();
  const out = [];
  const seen = {};
  raw.forEach(v => {
    if (!v || !v.id || seen[v.id]) return;
    // ⚠️ type が stream 以外（placeholder＝X の告知などから作られた予定、clip＝切り抜き）は載せない。
    //    placeholder の id は YouTube の動画IDではないので、リンクも画像も作れない
    if (v.type !== 'stream') return;
    if (v.status !== 'upcoming' && v.status !== 'live') return;
    if (isFreeChat(v)) return;
    const start = Date.parse(v.start_actual || v.start_scheduled || '');
    if (isNaN(start)) return;
    if (v.status === 'upcoming' && (start > now + AHEAD_DAYS * 86400e3 || start < now - STALE_HOURS * 3600e3)) return;
    seen[v.id] = 1;

    const hostId = v.channel && v.channel.id;
    const members = new Set();
    const others = [];
    if (KEY_BY_CHANNEL[hostId]) members.add(KEY_BY_CHANNEL[hostId]);
    (v.mentions || []).forEach(x => {
      if (KEY_BY_CHANNEL[x.id]) members.add(KEY_BY_CHANNEL[x.id]);
      else if (x.id !== hostId) { const n = cleanChannelName(x.name); if (n && others.indexOf(n) === -1) others.push(n); }
    });
    if (!members.size) return;   // 4人のだれも出ていない（ふつうは無い。念のため）

    const item = { i: v.id, t: String(v.title || '').trim(), s: new Date(start).toISOString() };
    if (v.status === 'live') item.live = 1;
    if (KEY_BY_CHANNEL[hostId]) item.h = KEY_BY_CHANNEL[hostId];
    else item.o = cleanChannelName(v.channel && v.channel.name) || '';
    item.m = MEMBERS.map(m => m.key).filter(k => members.has(k));
    if (others.length) item.c = others;
    out.push(item);
  });
  return out.sort((a, b) => a.s.localeCompare(b.s) || a.i.localeCompare(b.i));
}

// フリーチャット（待機所に置いておく雑談用の枠）。Holodex は FreeChat の話題を付けることが多いが、付いていないものもあるのでタイトルも見る
function isFreeChat(v) {
  return v.topic_id === 'FreeChat' || /フリー\s*チャット|free\s*chat/i.test(String(v.title || ''));
}

// 公開中の upcoming.json（読めなかったときに、前回の一覧を残すため）。無くても止めない（初回は無い）
async function readPrevious() {
  try {
    if (!PAGES_URL || FROM) return null;
    const res = await fetch(PAGES_URL + 'upcoming.json?t=' + Date.now());
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
}

/* out/upcoming.json に書き、meta.json にも載せる（中身が変わったら公開し直すように、contentHash にも混ぜる）。
   ⚠️ 取りに行った時刻は書かない。毎回変わるので、3時間おきに必ず公開し直すことになる（公開の履歴が無駄に増える）。 */
function write(data) {
  const text = JSON.stringify(data);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'upcoming.json'), text);
  const metaFile = path.join(OUT, 'meta.json');
  if (fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
    meta.files['upcoming.json'] = { hash: hash, bytes: Buffer.byteLength(text) };
    meta.contentHash = crypto.createHash('sha1').update(meta.contentHash + hash).digest('hex').slice(0, 12);
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  }
  console.log(summary.join('\n'));
  writeSummary();
}

function writeSummary() {
  if (process.env.GITHUB_STEP_SUMMARY && summary.length) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n### これからの配信（Holodex）\n\n' + summary.map(s => '- ' + s).join('\n') + '\n');
}

// 「叢雲カゲツ / Murakumo Kagetsu【にじさんじ】」→「叢雲カゲツ」（export/build.js と同じ）
function cleanChannelName(name) {
  return String(name || '').split(' / ')[0].replace(/【[^】]*】/g, '').trim();
}
