/* MECHATU-A（Oriens・Dytica の8人）のサイトのデータを書き出す（2026-10-28 に Dytica の4人から広げた）

   3か所を読んで、点検し、サイト用の小さいファイルにまとめて out/ に置く。
   - Dytica のシート（ショウ以外の7人の動画と他枠・にじさんじ公式切り抜きチャンネルの動画）
   - ショウケースのシート（ショウの動画と、「切り抜き」タブのショウの切り抜き）
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
                                             あれば showcaseDisco.csv / dyticaDisco.csv / showcaseArticles.csv / dyticaArticles.csv / showcaseClips.csv）
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
  /* ⚠️ MECHATU-NE は 2026-10-25 に独自ドメインへ移った。古い netlify.app は更新が止まっていて（新しい曲が載らない）、2026-11-30 に閉じる */
  songs:    { label: 'MECHATU-NE ARCHIVE（楽曲）',     url: 'https://mechatu-ne-archive.com/music_data.json' },
  /* ディスコグラフィ。ショウのぶんはショウケースのシートから読む（動画と同じ。決めたこと.md の2章）。
     ほかの3人のぶんは Dytica のシートの「ディスコグラフィ」タブ（列は同じ＋「参加」）。
     ⚠️ タブを作り直したら gid も変わる（シートの URL の #gid= のあとの数字）。空なら読まない */
  showcaseDisco: { label: 'ショウケースのシート（ディスコグラフィ）', id: '1S9GmmMs6Rt3hMra3RW8Ijveh61dJg7-iCwFubJPyzJU', gid: '83070678' },
  /* 記事（雑誌・ウェブの記事・特集）。ディスコグラフィと同じく、ショウのぶんはショウケースの「記事」、ほかは Dytica のシートの「記事」タブ（列は同じ＋「参加」）。
     ⚠️ タブを作り直したら gid も変わる（シートの URL の #gid= のあとの数字）。空なら読まない */
  showcaseArticles: { label: 'ショウケースのシート（記事）', id: '1S9GmmMs6Rt3hMra3RW8Ijveh61dJg7-iCwFubJPyzJU', gid: '1541969232' },
  dyticaArticles:   { label: 'Dytica のシート（記事）',     id: '1Zh1XKg8B_j59gdfsCI9GVmPhKPFHjGb086dmbGjl5LY', gid: '1275787904' },   // 2026-10-19 に持ち主が作ったタブ
  dyticaDisco:   { label: 'Dytica のシート（ディスコグラフィ）',     id: '1Zh1XKg8B_j59gdfsCI9GVmPhKPFHjGb086dmbGjl5LY', gid: '1783567461' },   // 2026-10-15 に持ち主が作ったタブ
  /* ショウの切り抜き（公式やほかのライバーのチャンネルの切り抜き）。ショウのぶんはショウケースが正（動画と同じ）。
     列は ID・再生リスト名・公開日・動画タイトル・動画URL・チャンネル（2026-10-28 に134本）。読めなくても止めない */
  showcaseClips: { label: 'ショウケースのシート（切り抜き）', id: '1S9GmmMs6Rt3hMra3RW8Ijveh61dJg7-iCwFubJPyzJU', gid: '1764814068' },
  /* ライブ（2026-10-30、持ち主の希望）。「ライブ」は1行＝1公演、「ライブ詳細」は1行＝1項目（セットリスト・関連動画など）。
     ショウが出ている公演はショウケースのシートが正。ほかのメンバーだけの公演は、Dytica のシートの同じ列のタブ（2026-10-30 に持ち主が作った）に入れる。
     ⚠️ タブを作り直したら gid も変わる（シートの URL の #gid= のあとの数字）。空なら読まない */
  showcaseLive:       { label: 'ショウケースのシート（ライブ）',     id: '1S9GmmMs6Rt3hMra3RW8Ijveh61dJg7-iCwFubJPyzJU', gid: '2144212156' },
  showcaseLiveDetail: { label: 'ショウケースのシート（ライブ詳細）', id: '1S9GmmMs6Rt3hMra3RW8Ijveh61dJg7-iCwFubJPyzJU', gid: '1186405315' },
  dyticaLive:         { label: 'Dytica のシート（ライブ）',         id: '1Zh1XKg8B_j59gdfsCI9GVmPhKPFHjGb086dmbGjl5LY', gid: '328718153' },    // 2026-10-30 に持ち主が作ったタブ
  /* ボイス（2026-10-30）。ショウのぶんはショウケースの「ボイス」、ほかの人は Dytica のシートの「ボイス」タブ（列は同じ＋「参加」。持ち主がこれから作る）。
     ⚠️ タブを作り直したら gid も変わる。空なら読まない */
  showcaseVoice: { label: 'ショウケースのシート（ボイス）', id: '1S9GmmMs6Rt3hMra3RW8Ijveh61dJg7-iCwFubJPyzJU', gid: '62138518' },
  dyticaVoice:   { label: 'Dytica のシート（ボイス）',     id: '1Zh1XKg8B_j59gdfsCI9GVmPhKPFHjGb086dmbGjl5LY', gid: '' },
  dyticaLiveDetail:   { label: 'Dytica のシート（ライブ詳細）',     id: '1Zh1XKg8B_j59gdfsCI9GVmPhKPFHjGb086dmbGjl5LY', gid: '1595699072' },   // 同上
};

/* 4人。key はファイル名と URL に使う。色は決めたこと.md の7章。
   ⚠️ 元の色（mark）をそのまま文字に使わないこと。ライの黄緑は白地でコントラスト1.14でほぼ見えない。
      文字には textLight（明るい表示）／ textDark（暗い表示）を使う。印の上の文字は onMark。 */
/* MECHATU-A の8人（2026-10-28 に Dytica の4人から広げた。持ち主の判断）。
   並びは MECHATU-NE ARCHIVE と同じ（Oriens → Dytica、ユニットの中も MECHATU-NE の順）。データの m もこの順に並べる。
   色（mark）は非公式 Wiki の MECHATU-A のページの「カラーコード」（MECHATU-NE とも同じ）。
   文字の色（textLight／textDark）は、明るい表示・暗い表示の地の色に対して 4.5:1 以上になるよう、元の色に黒を混ぜたり明るくしたりして作った。
   2026-10-29 に、サイトの地の色を MECHATU-NE と同じ紙の色（明るい表示 #f4f2ee・暗い表示 #0d1014、カード #fffefb・#171a21）に変えたので、
   その地でも 4.6:1 以上になるよう、明るい表示の6人（赤城・宇佐美・緋八・伊波・星導・叢雲）を3〜7% 濃くし、暗い表示の小柳を4% 明るくした（色合いは同じ）
   チャンネルID は にじチェッカーのライバー一覧（radar/index.json）で確かめた。 */
const UNITS = [
  { id: 'oriens', name: 'Oriens', members: ['wen', 'rito', 'ittetsu', 'mana'] },
  { id: 'dytica', name: 'Dytica', members: ['rai', 'rou', 'sho', 'kagetsu'] },
];
const MEMBERS = [
  { key: 'wen',     short: 'ウェン',   name: '赤城ウェン',   unit: 'oriens', channelId: 'UC1vawzfbCnRpHT9SJ5pHlHw', mark: '#FF8C9B', textLight: '#9F5761', textDark: '#FF8C9B', onMark: '#1A1A22' },
  { key: 'rito',    short: 'リト',     name: '宇佐美リト',   unit: 'oriens', channelId: 'UCambvP8yxNDot4FzQc9cgiw', mark: '#FAC31E', textLight: '#866910', textDark: '#FAC31E', onMark: '#1A1A22' },
  { key: 'ittetsu', short: 'イッテツ', name: '佐伯イッテツ', unit: 'oriens', channelId: 'UCy8P3o5XlMpJGQY4WugzdNA', mark: '#8C4664', textLight: '#8C4664', textDark: '#BB7895', onMark: '#FFFFFF' },
  { key: 'mana',    short: 'マナ',     name: '緋八マナ',     unit: 'oriens', channelId: 'UCqXxS-9x9Ha_UiH6hG4kh5Q', mark: '#64C8F0', textLight: '#3A748C', textDark: '#64C8F0', onMark: '#1A1A22' },
  { key: 'rai',     short: 'ライ',     name: '伊波ライ',     unit: 'dytica', channelId: 'UCz89MGFBrAqwJ5xMr5weSuA', mark: '#DCFF50', textLight: '#5F7400', textDark: '#DCFF50', onMark: '#1A1A22' },
  { key: 'rou',     short: 'ロウ',     name: '小柳ロウ',     unit: 'dytica', channelId: 'UC6WFKwYptsxVue56Lx218vg', mark: '#5A5FAA', textLight: '#5A5FAA', textDark: '#787DC8', onMark: '#FFFFFF' },
  { key: 'sho',     short: 'ショウ',   name: '星導ショウ',   unit: 'dytica', channelId: 'UCgZ0pH7j6c9z-pkOG3PYw1Q', mark: '#A58CDC', textLight: '#7762A5', textDark: '#A58CDC', onMark: '#1A1A22' },
  { key: 'kagetsu', short: 'カゲツ',   name: '叢雲カゲツ',   unit: 'dytica', channelId: 'UChdY64fJb14Nfnbs8EGdQig', mark: '#6EB487', textLight: '#3E7955', textDark: '#6EB487', onMark: '#1A1A22' },
];
const SHO = 'sho';   // ショウのぶんはショウケースから読む（開始時刻を Holodex で補うのもショウだけ）
/* ユニットのチャンネル（Oriens）の枠の名前をそろえる。取り込みは「Oriens」と書くが、
   ユニットのチャンネルを取り込む前に他枠として入った行は「Oriensオリエンス」（Holodex のチャンネル名）になっているため */
/* ⚠️ Cellmates を入れないこと。Cellmates は星導ショウが入っているグループのチャンネルだが、8人のほかの人はいない
   （データの28本で確かめた。出演は全部ショウだけ）。ほかのチャンネルと同じ決まりでクリップを見分ける。
   毎週の企画の動画はアーカイブ、合間の「手描き切り抜き」の Shorts はクリップ（2026-10-28、持ち主の判断。はじめはここに入れてクリップにしていなかった） */
const UNIT_HOSTS = { [nameKey('Oriens')]: 'Oriens', [nameKey('Oriensオリエンス')]: 'Oriens' };
/* 切り抜きのチャンネル。ここの動画は、タイトルにかかわらずクリップにする（2026-10-28、持ち主の判断）。
   ⚠️ 取り込み（apps-script/import-videos.js の CLIP_CHANNELS）が枠に書く名前と同じ文字にすること。ショウケースの「切り抜き」タブのチャンネルの列も同じ文字 */
const CLIP_HOSTS = new Set(['にじさんじ公式切り抜きチャンネル']);
/* クリップと見なすタイトルの言葉。ショウケースの「切り抜き」タブで確かめた（2026-10-28、持ち主の判断）。
   本人と Oriens 以外のチャンネルの98本のうち、「切り抜き」があるもの55本、公式切り抜きの【漫画】18本・【今週のにじさんじハイライト】10本。
   残りの15本は、ほかのライバー・Cellmates のチャンネルの Shorts など（Cellmates の2本と、ショウのぶんは「切り抜き」タブから拾える）。タイトルがふつうの動画と同じ書き方なので、言葉では見分けられない。
   ⚠️ 「まとめ」は入れないこと。ショウケースでは「切り抜き」と一緒にしか出てこない一方、こちらのデータでは
      #にじクイ のクイズ動画（公式の企画。クリップにしないと持ち主が決めた）や、ほかの人の「〇日目まとめ」に当たった */
const CLIP_TITLE = /切り?抜き|【漫画】|にじさんじハイライト/;
/* ほかのライバーのチャンネルの Shorts でも、クリップにしない題名の言葉（2026-10-29）。踊ってみた・歌ってみたの Shorts は、
   切り抜きではなくその人の作品のため（夕陽リリさんと伊波の踊ってみた、#OBF のダンス、戌亥とこさんと宇佐美の cover など）。
   2026-10-29 のデータで、ほかのライバーの Shorts 121本のうち29本が当たり、92本がクリップになった。
   ⚠️ 企画の Shorts（森中花咲さんの「究極の二択」など）は言葉では見分けられない。持ち主がシートのクリップの列で × を打つ */
const NOT_CLIP_TITLE = /踊ってみた|ダンス|dance|歌ってみた|cover|music ?video|#OBF/i;
// にじさんじ公式チャンネル。ここの Shorts は自動ではクリップにしない（上の決まりの例外）
const OFFICIAL_HOSTS = new Set(['にじさんじ']);
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
  const scClips = parseShowcaseClips(await readSheetSoft('showcaseClips'));
  const discography = await buildDiscography(previous);
  const articles = await buildArticles(previous);
  const lives = await buildLives(previous);
  const voices = await buildVoices(previous);

  // ── まとめる ──
  const songs = buildSongs(songsData);
  const songIds = new Set(songs.map(s => s.i));
  const videos = await dropGoneVideos(mergeVideos(dy, sc.concat(scClips), songIds), previous);
  await fillGuestHosts(videos, previous);
  // ⚠️ 同じ企画のまとめ（開始時刻と長さで重なりを見る）より前に補うこと
  await fillShoStarts(videos, previous);
  videos.forEach(v => { if (v.o && UNIT_HOSTS[nameKey(v.o)]) v.o = UNIT_HOSTS[nameKey(v.o)]; });
  // ⚠️ クリップを決める前にすること（ほかのライバーの Shorts はクリップにする決まりのため）
  await recheckShorts(videos, previous);
  /* クリップ（cl: 1）。Dytica のシートの「クリップ」の列に ○ があればクリップ、× があればクリップにしない（持ち主の判断がいちばん先。2026-10-29）。
     空・? のときは自動で決める：本人のチャンネル以外で投稿された、配信ではない動画（動画・Shorts）のうち、次のどれかに当たるもの。
     - 切り抜きのチャンネル（にじさんじ公式切り抜きチャンネル。CLIP_HOSTS）の動画
     - ショウケースの「切り抜き」タブにある動画（持ち主が切り抜きとして入れたもの）
     - タイトルに CLIP_TITLE の言葉（「切り抜き」など）があるもの
     - ほかのライバーのチャンネルの Shorts（2026-10-29、持ち主の判断）。題名に何も付いていない切り抜きが多いため
       （叶さんの「ジャイロOFFの生き様」など）。ただし題名に NOT_CLIP_TITLE の言葉（踊ってみた・歌ってみたなど）があるものは除く。
       ⚠️ にじさんじ公式チャンネル（OFFICIAL_HOSTS）の Shorts は入れないこと。告知や企画が多い（2026-10-29 に105本）。
          クリップにしたいものは、持ち主がシートで ○ を打つ
     ⚠️ ほかのチャンネルの動画は、タイトルで絞ること（2026-10-28 持ち主の判断）。絞らないと、公式の告知の Shorts や企画の動画
     （例：#にじクイ のクイズ動画）までクリップになった（絞る前は390本、そのうち公式のにじさんじが150本）
     サイトではアーカイブ・新着・カレンダーから分けて、「クリップ」のページに出す（2026-10-28、持ち主の判断）。
     ⚠️ ほかの人の枠の「配信」はクリップにしないこと（本人が出ている配信＝他枠で、アーカイブに載せるもの）。
     ⚠️ Oriens のユニットのチャンネルの動画はクリップにしない（8人のうち4人のチャンネルのため）。ショウケースの「切り抜き」タブにあっても同じ */
  const unitNames = new Set(Object.values(UNIT_HOSTS));
  videos.forEach(v => {
    const auto = !v.h && !unitNames.has(v.o) && v.k !== 'L' && (CLIP_HOSTS.has(v.o) || v.scClip || CLIP_TITLE.test(v.t) ||
      (v.k === 'S' && !OFFICIAL_HOSTS.has(v.o) && !NOT_CLIP_TITLE.test(v.t)));
    if (v.clipMark === 1 || (v.clipMark !== 0 && auto)) v.cl = 1;
    delete v.scClip; delete v.clipMark;
  });
  const unsure = videos.filter(v => v.clipUnsure).length;
  if (unsure) note('クリップにするか、まだ選んでいない行（クリップの列が「?」）：' + unsure + ' 行。自動で決めて出しています');
  videos.forEach(v => { delete v.clipUnsure; });
  const groups = groupSameCollab(videos);
  // ⚠️ 同じ企画のまとめ（p）のあとにすること
  const stats = buildStats(videos);
  // ⚠️ 同じ企画のまとめ（p）のあと、markSameGames（ゲーム名 gt を消す）より前にすること
  const played = buildPlayedGames(videos);
  // ⚠️ 同じ企画のまとめ（p）のあとにすること。別視点は1回と数える
  const sameGames = markSameGames(videos);
  // 日本語のゲーム名（同じゲームの配信と、みんなで遊んだゲームのぶん。meta.json の gameNames）
  const gameNames = {};
  new Set(sameGames.concat(played.list.map(x => x.g))).forEach(g => {
    const ja = GAME_NAMES_FIXED[g] || gameNameFromTitles(played.streams[g] || []);
    if (ja) gameNames[g] = ja;
  });
  console.log('ゲームの日本語の名前：' + Object.keys(gameNames).length + ' 種類（同じゲームの配信 ' + sameGames.length + '・みんなで遊んだゲーム ' + played.list.length + ' のうち）');
  await markSameThumbs(videos, songs, previous);

  // ── 件数が大きく減っていないか ──
  const counts = { videos: videos.length, clips: videos.filter(v => v.cl).length, songs: songs.length, discography: discography.length, articles: articles.length, lives: lives.length, voices: voices.length };
  if (previous.meta && previous.meta.counts) {
    // ⚠️ ディスコグラフィ・記事・ライブ・ボイスは件数で止めない（20件ほどしかなく、2件消しただけで9割を切る）
    ['videos', 'songs'].forEach(k => {
      const before = previous.meta.counts[k] || 0;
      if (before && counts[k] < before * MIN_RATIO) {
        fatal(k + ' の件数が前回の ' + before + ' 件から ' + counts[k] + ' 件に減りました（9割を切ったので公開しません）。' +
          'シートが途中までしか読めなかったか、行が大きく消えた可能性があります');
      }
    });
  }
  if (report.errors.length) return finish(null);

  finish({ videos, songs, groups, counts, discography, articles, lives, voices, stats, played: played.list, gameNames });
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
  const prev = { meta: null, report: null, hosts: {}, discography: null, articles: null, lives: null, voices: null, holodex: null, gone: null, shorts: null, thumbs: null };
  readPrevious.last = prev;
  if (args.prev) {   // 試すとき：前回の公開の代わりに、手元のフォルダ（前回の out/）を読む
    const read = f => { try { return JSON.parse(fs.readFileSync(path.join(args.prev, f), 'utf8')); } catch (e) { return null; } };
    prev.meta = read('meta.json'); prev.report = read('report.json'); prev.hosts = read('cache/hosts.json') || {}; prev.discography = read('discography.json'); prev.articles = read('articles.json'); prev.lives = read('lives.json'); prev.voices = read('voices.json'); prev.holodex = read('cache/holodex-sho.json'); prev.gone = read('cache/gone.json'); prev.shorts = read('cache/shorts.json'); prev.thumbs = read('cache/thumbs.json');
    return prev;
  }
  if (!PAGES_URL || FROM) return prev;
  try { prev.meta = JSON.parse(await fetchText(PAGES_URL + 'meta.json?t=' + Date.now())); } catch (e) {}
  try { prev.report = JSON.parse(await fetchText(PAGES_URL + 'report.json?t=' + Date.now())); } catch (e) {}
  try { prev.hosts = JSON.parse(await fetchText(PAGES_URL + 'cache/hosts.json?t=' + Date.now())); } catch (e) {}
  try { prev.discography = JSON.parse(await fetchText(PAGES_URL + 'discography.json?t=' + Date.now())); } catch (e) {}
  try { prev.articles = JSON.parse(await fetchText(PAGES_URL + 'articles.json?t=' + Date.now())); } catch (e) {}
  try { prev.lives = JSON.parse(await fetchText(PAGES_URL + 'lives.json?t=' + Date.now())); } catch (e) {}
  try { prev.voices = JSON.parse(await fetchText(PAGES_URL + 'voices.json?t=' + Date.now())); } catch (e) {}
  try { prev.holodex = JSON.parse(await fetchText(PAGES_URL + 'cache/holodex-sho.json?t=' + Date.now())); } catch (e) {}
  try { prev.gone = JSON.parse(await fetchText(PAGES_URL + 'cache/gone.json?t=' + Date.now())); } catch (e) {}
  try { prev.shorts = JSON.parse(await fetchText(PAGES_URL + 'cache/shorts.json?t=' + Date.now())); } catch (e) {}
  try { prev.thumbs = JSON.parse(await fetchText(PAGES_URL + 'cache/thumbs.json?t=' + Date.now())); } catch (e) {}
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
  /* 「クリップ」の列（2026-10-29 に足した）。⚠️ 無くても止めないこと（Apps Script の setupVideoSheet で足すまでは無い） */
  col['クリップ'] = rows[0].map(h => String(h).trim()).indexOf('クリップ');
  // 「ゲーム」の列（Holodex のゲーム名。取り込みが入れる）。同じゲームの配信を見つけるのに使う。⚠️ 無くても止めないこと
  col['ゲーム'] = rows[0].map(h => String(h).trim()).indexOf('ゲーム');
  const out = [];
  const seen = {};
  parseDytica.crossed = new Set();   // × の動画（ショウケースから入ってこないよう、mergeVideos で使う）
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = h => String(r[col[h]] == null ? '' : r[col[h]]).trim();
    if (!r.some(x => String(x).trim())) continue;
    const rowNo = i + 1;
    const id = videoId(get('動画URL'));
    if (!id) { rowIssue('dytica', rowNo, '動画URL が読めないので、この行は載せていません'); continue; }
    const mark = get('確認');
    if (isCross(mark)) { parseDytica.crossed.add(id); continue; }
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
    const hostKey = KEY_BY_SHORT[host] || KEY_BY_NAME[nameKey(host)];
    if (hostKey) v.h = hostKey; else if (host) v.o = host;

    const members = [];
    splitList(get('出演')).forEach(n => {
      const k = KEY_BY_SHORT[n] || KEY_BY_NAME[nameKey(n)];
      if (k) { if (members.indexOf(k) === -1) members.push(k); }
      else rowIssue('dytica', rowNo, '出演の「' + n + '」が8人の誰か分かりません（ウェン・リト・イッテツ・マナ・ライ・ロウ・ショウ・カゲツ のどれか）。外しました', id);
    });
    if (v.h && members.indexOf(v.h) === -1) members.push(v.h);
    /* コラボ相手に8人のだれかがいれば、出演に入れる。
       ⚠️ 外すだけにしないこと。Dytica の4人だけを見ていたころは、Oriens の4人はコラボ相手に入っているので、
          8人に広げたあとは、ここで出演に移さないと Oriens の人がどこにも出てこない */
    const collabs = [];
    splitList(get('コラボ相手')).forEach(n => {
      const k = KEY_BY_NAME[nameKey(n)];
      if (k) { if (members.indexOf(k) === -1) members.push(k); }
      else collabs.push(n);
    });
    v.m = sortMembers(members);
    if (collabs.length) v.c = collabs;

    const cat = get('カテゴリ'); if (cat) v.g = cat;
    v.k = kindOf(get('種別'), 'dytica', rowNo, id);
    const game = col['ゲーム'] >= 0 ? get('ゲーム') : '';
    if (game) v.gt = game;
    // クリップの印：○＝クリップにする（1）／×＝しない（0）／空・?＝自動
    const clip = col['クリップ'] >= 0 ? get('クリップ') : '';
    if (isCircle(clip)) v.clipMark = 1;
    else if (isCross(clip)) v.clipMark = 0;
    else if (/^[?？]$/.test(clip)) v.clipUnsure = 1;
    else if (clip) rowIssue('dytica', rowNo, 'クリップの印「' + clip + '」が分かりません（○ か × にしてください）。自動で決めました', id);
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
    if (!get('他チャンネル')) v.h = SHO;
    const members = [SHO];
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

/* ショウケースの「切り抜き」タブの1行 → 動画（ショウが出ている切り抜き）。
   チャンネルが8人のだれかなら、その人の枠（本人の動画なのでクリップにはならない）。ほかは scClip を付け、あとでクリップにする。
   長さの列が無いので、種別は URL で決める（/shorts/ なら Shorts）。
   ⚠️ 読めなくても止めない（無くてもサイトは成り立つ）。見出しが見つからなければ知らせて、読まなかった扱いにする */
function parseShowcaseClips(rows) {
  if (!rows) return [];
  const label = SOURCES.showcaseClips.label;
  const header = rows[0].map(h => String(h).trim());
  const col = {};
  const missing = ['動画URL', '動画タイトル', '公開日', 'チャンネル'].filter(h => (col[h] = header.indexOf(h)) < 0);
  if (missing.length) { warn(label + ' に見出しが見つからないので、読みませんでした：' + missing.join('、')); return []; }
  const out = [];
  const seen = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = h => String(r[col[h]] == null ? '' : r[col[h]]).trim();
    const url = get('動画URL');
    if (!url) continue;   // 先に番号だけ入れた空の行がある（動画情報と同じ）
    const id = videoId(url);
    if (!id || seen[id]) continue;
    seen[id] = true;
    const date = normDate(get('公開日'));
    if (!date) { rowIssue('showcaseClips', i + 1, '公開日「' + get('公開日') + '」が読めないので、載せていません', id); continue; }
    const v = { i: id, t: get('動画タイトル'), d: date, src: 'showcase', row: i + 1, m: [SHO], k: /\/shorts\//.test(url) ? 'S' : 'V' };
    const ch = get('チャンネル');
    const k = KEY_BY_NAME[nameKey(ch)];
    if (k) { v.h = k; v.m = sortMembers(Array.from(new Set([SHO, k]))); }
    else { if (ch) v.o = ch; v.scClip = 1; }
    out.push(v);
  }
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
  const crossed = parseDytica.crossed || new Set();
  sc.forEach(s => {
    if (crossed.has(s.i)) return;
    const v = byId[s.i];
    if (!v) { byId[s.i] = s; return; }
    if (v.src !== s.src) v.src = 'both';
    if (s.scClip) v.scClip = 1;
    if (!v.h && !v.o && (s.h || s.o)) { if (s.h) v.h = s.h; else v.o = s.o; }
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
  // Dytica のシートで × にした動画は、ショウケースにあっても載せない（持ち主が「載せない」と決めたもの。上の crossed で外す）
  // ⚠️ parseDytica で × の行を落とすだけにしないこと。ショウケースにある動画が、そちらから入ってきてしまう（2026-10-28 に直した）
  const list = Object.values(byId).filter(v => {
    if (!songIds.has(v.i)) return true;
    if (v.src !== 'showcase') warn('楽曲（MECHATU-NE に載っている曲）が動画のシートにあります：' + v.i + '「' + v.t.slice(0, 30) + '」。動画からは外しました（確認に × を付けてください）');
    return false;
  });
  list.sort((a, b) => (b.d + (b.s || '')).localeCompare(a.d + (a.s || '')) || a.i.localeCompare(b.i));
  return list;
}

/* 消された・非公開になった動画を外す（2026-10-29、持ち主の判断。一度公開して消された動画がカレンダーに残っていた）。
   YouTube のサムネイル（i.ytimg.com の mqdefault）が 404 なら、見られない動画とみなす。サイトの一覧が出している画像と同じで、
   消された動画は灰色の「…」の絵になる（見て分かる症状と同じものを見ている）。キーも問い合わせの上限も要らない。
   - ふだんは公開日が30日以内の動画と、前に見られなかった動画だけ確かめる。週1回は全部確かめる
     （2026-10-29 に全10,898本で83秒。見られないものは1本＝弦月藤士郎さんの「さよならインターバル」の消された方）
   - 見られなかった動画は cache/gone.json に控え、次からも外す。確かめて見られるようになっていれば戻す
   - ⚠️ 404 のときだけ外すこと。つながらない・ほかの返事のときは前回のまま（YouTube の不調でサイトの中身が消えないように）
   - ⚠️ 1回で新しく見つかった数が多すぎるとき（20本かつ確かめた数の2%を超える）は、おかしいとみなして外さない（気になることで知らせる）
   - シートの行はそのまま（消さない・× も付けない）。外した動画は「お知らせ」に出す */
const GONE_RECENT_DAYS = 30;
const GONE_REFRESH_DAYS = 7;
async function dropGoneVideos(videos, previous) {
  const prev = (previous && previous.gone) || {};
  const cache = { fullAt: prev.fullAt || '', ids: Object.assign({}, prev.ids || {}) };   // 動画ID → 見つけた日
  if (FROM && fs.existsSync(path.join(FROM, 'gone.json'))) Object.assign(cache.ids, JSON.parse(fs.readFileSync(path.join(FROM, 'gone.json'), 'utf8')).ids || {});
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (!FROM) {
    const full = !cache.fullAt || Date.now() - Date.parse(cache.fullAt) > GONE_REFRESH_DAYS * 86400e3;
    const since = new Date(Date.now() + 9 * 3600e3 - GONE_RECENT_DAYS * 86400e3).toISOString().slice(0, 10);
    const targets = full ? videos : videos.filter(v => v.d >= since || cache.ids[v.i]);
    const status = await thumbStatuses(targets.map(v => v.i));
    const found = targets.filter(v => status[v.i] === 404 && !cache.ids[v.i]);
    const failed = targets.filter(v => !status[v.i]).length;
    if (found.length > Math.max(20, targets.length * 0.02)) {
      warn('見られない動画（サムネイルが無い）が一度に ' + found.length + ' 本見つかりました（確かめた ' + targets.length + ' 本）。YouTube の不調かもしれないので、外していません');
    } else {
      found.forEach(v => { cache.ids[v.i] = today; });
    }
    targets.forEach(v => { if (status[v.i] === 200) delete cache.ids[v.i]; });
    // 1割以上確かめられなかったときは、全部確かめたことにしない（次の回にやり直す）
    if (full && failed < targets.length * 0.1) cache.fullAt = new Date().toISOString();
    console.log('見られない動画を確かめました：' + targets.length + ' 本（' + (full ? '全部' : '最近のもの') + '）・新しく見つかった ' + found.length + ' 本・確かめられなかった ' + failed + ' 本');
  }
  // 控えは、いまのデータにある動画のぶんだけ残す（シートから消した動画の分が貯まらないように）
  const have = new Set(videos.map(v => v.i));
  Object.keys(cache.ids).forEach(id => { if (!have.has(id)) delete cache.ids[id]; });
  const gone = videos.filter(v => cache.ids[v.i]);
  if (gone.length) {
    note('見られない動画（消された・非公開）' + gone.length + ' 本を外しました：' + gone.slice(0, 20).map(v =>
      v.d + '「' + v.t.slice(0, 30) + '」' + (v.src === 'dytica' ? '（Dytica のシート ' + v.row + ' 行目）' : v.src === 'showcase' ? '（ショウケース）' : '')).join('、') +
      (gone.length > 20 ? ' ほか' : '') + '。シートでは確認に × を付けてもよい（付けなくても外れます）');
  }
  dropGoneVideos.cache = cache;
  return videos.filter(v => !cache.ids[v.i]);
}

/* 「Shorts」の動画を、YouTube でもう一度確かめる（2026-10-29、持ち主の希望）。
   取り込み（Apps Script）は、3分以内の動画の youtube.com/shorts/動画ID を開いてみて、はっきりしない返事のときは Shorts とみなしている。
   Google のサーバーからだと、はっきりしない返事が多いらしく、Shorts でない動画が Shorts になっていた
   （2026-10-29 に手元で確かめた：シートの「Shorts」1,133行のうち56行が Shorts ではなかった。41行は公式チャンネルの告知・PV）。
   - youtube.com/shorts/動画ID がそのまま開ければ Shorts、ふつうの再生ページ（/watch）へ転送されれば Shorts ではない（「動画」として出す）
   - 確かめた結果は cache/shorts.json に控え、次からは新しい動画だけを確かめる（Shorts かどうかは、あとから変わらないため）
   - ⚠️ はっきりしない返事（同意画面への転送・混み合いなど）のときは、シートのまま（次の回にまた確かめる）
   - ⚠️ 一度に「Shorts ではない」が多すぎるとき（20本かつ確かめた数の3割を超える）は、おかしいとみなして直さない（気になることで知らせる）
   - シートの「種別」の列は書き換えない。直した数は「お知らせ」に出す */
async function recheckShorts(videos, previous) {
  const cache = Object.assign({}, (previous && previous.shorts) || {});   // 動画ID → 1（Shorts）／0（Shorts ではない）
  if (FROM && fs.existsSync(path.join(FROM, 'shorts.json'))) Object.assign(cache, JSON.parse(fs.readFileSync(path.join(FROM, 'shorts.json'), 'utf8')));
  if (!FROM) {
    const ask = videos.filter(v => v.k === 'S' && !(v.i in cache)).map(v => v.i);
    const found = {};
    const queue = ask.slice();
    await Promise.all(Array.from({ length: 16 }, async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const res = await fetch('https://www.youtube.com/shorts/' + id, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15000),
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' } });
          const loc = res.headers.get('location') || '';
          if (res.status === 200) found[id] = 1;
          else if (res.status >= 300 && res.status < 400 && /\/watch/.test(loc)) found[id] = 0;
        } catch (e) { /* つながらなかったものは、次の回に */ }
      }
    }));
    const notShorts = Object.values(found).filter(x => x === 0).length;
    if (notShorts > Math.max(20, ask.length * 0.3)) {
      warn('Shorts を確かめ直したところ、「Shorts ではない」が一度に ' + notShorts + ' 本ありました（確かめた ' + ask.length + ' 本）。YouTube の返事がおかしいかもしれないので、直していません');
    } else {
      Object.assign(cache, found);
    }
    console.log('Shorts を確かめ直しました：' + ask.length + ' 本・Shorts ではなかった ' + notShorts + ' 本・はっきりしなかった ' + (ask.length - Object.keys(found).length) + ' 本');
  }
  const have = new Set(videos.map(v => v.i));
  Object.keys(cache).forEach(id => { if (!have.has(id)) delete cache[id]; });
  let fixed = 0;
  videos.forEach(v => { if (v.k === 'S' && cache[v.i] === 0) { v.k = 'V'; fixed++; } });
  if (fixed) note('シートで「Shorts」でも、YouTube では Shorts ではなかった動画 ' + fixed + ' 本を「動画」として出しました（シートはそのまま）');
  recheckShorts.cache = cache;
}

/* 同じ日に同じサムネイルの絵が並ばないようにする印（dt＝先に出る同じ絵の動画ID。2026-10-29、持ち主の希望）。
   カレンダーのマスに、同じ絵が2回出ていた。小柳が同じ日の2本の配信に同じサムネイルを使った日（10/12・10/18）と、
   アルバムの曲が同じジャケットで並んだ日（10/24 に5曲）。サイトは、先の絵がマスに出ているときだけ、dt のある絵を出さない。
   - 絵を比べるのは、同じ日に同じ枠の人の動画が2本以上あるときと、同じ日の楽曲だけ（全部の絵を読むと重いため）
   - 絵の中身の印は cache/thumbs.json に控え、次からは新しい動画だけを読む
   - ⚠️ 読めなかった絵は比べない（印を付けない） */
async function markSameThumbs(videos, songs, previous) {
  const cache = Object.assign({}, (previous && previous.thumbs) || {});   // 動画ID → 絵の中身の印
  if (FROM && fs.existsSync(path.join(FROM, 'thumbs.json'))) Object.assign(cache, JSON.parse(fs.readFileSync(path.join(FROM, 'thumbs.json'), 'utf8')));
  // 比べる組：同じ日・同じ枠の人の動画（クリップを除く）と、同じ日の楽曲
  const groups = {};
  videos.forEach(v => { if (!v.cl) (groups[v.d + '|' + (v.h || v.o || '')] = groups[v.d + '|' + (v.h || v.o || '')] || []).push(v); });
  songs.forEach(x => { if (x.d) (groups[x.d + '|♪'] = groups[x.d + '|♪'] || []).push(x); });
  const targets = Object.values(groups).filter(l => l.length >= 2);
  if (!FROM) {
    const ask = [...new Set(targets.flat().map(v => v.i))].filter(id => !(id in cache));
    const queue = ask.slice();
    await Promise.all(Array.from({ length: 16 }, async () => {
      while (queue.length) {
        const id = queue.shift();
        try {
          const res = await fetch('https://i.ytimg.com/vi/' + id + '/mqdefault.jpg', { signal: AbortSignal.timeout(15000) });
          if (res.ok) cache[id] = crypto.createHash('sha1').update(Buffer.from(await res.arrayBuffer())).digest('hex').slice(0, 10);
        } catch (e) { /* 読めなかった絵は比べない */ }
      }
    }));
    console.log('サムネイルの絵を読みました：' + ask.length + ' 本');
  }
  let marked = 0;
  targets.forEach(list => {
    const first = {};
    list.slice().sort((a, b) => (a.s || '').localeCompare(b.s || '')).forEach(v => {
      const h = cache[v.i];
      if (!h) return;
      if (first[h]) { v.dt = first[h]; marked++; } else first[h] = v.i;
    });
  });
  const keep = new Set(targets.flat().map(v => v.i));
  Object.keys(cache).forEach(id => { if (!keep.has(id)) delete cache[id]; });
  console.log('同じ日に同じサムネイルの絵：' + marked + ' 本');
  markSameThumbs.cache = cache;
}

// サムネイルの返事（200・404 など）。つながらなかったものは 0。16本ずつ並べて問い合わせる
async function thumbStatuses(ids) {
  const out = {};
  const queue = ids.slice();
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (queue.length) {
      const id = queue.shift();
      for (let attempt = 0; attempt < 2 && !out[id]; attempt++) {
        try {
          const res = await fetch('https://i.ytimg.com/vi/' + id + '/mqdefault.jpg', { method: 'HEAD', signal: AbortSignal.timeout(15000) });
          out[id] = res.status;
        } catch (e) { out[id] = 0; }
      }
    }
  }));
  return out;
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
  need.forEach(v => {
    if (!cache[v.i]) return;
    // 枠の持ち主が8人のだれか（ショウが Oriens の人の枠に出た、など）なら、その人の枠にする
    const k = KEY_BY_NAME[nameKey(cache[v.i])];
    if (k) { v.h = k; if (v.m.indexOf(k) === -1) v.m = sortMembers(v.m.concat(k)); }
    else v.o = cache[v.i];
  });
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
        const list = await holodexPages('/channels/' + MEMBERS.find(m => m.key === SHO).channelId + '/' + kind, full ? 80 : 2, key);
        list.forEach(h => {
          const t = Date.parse(h.start_actual || '');
          // 3つ目はゲーム名（2026-10-29 に足した。同じゲームの配信を見つけるため）。前の控えには無いので、週1回の取り直しで入る
          if (!isNaN(t)) cache.items[h.id] = [Math.round(t / 1000), h.duration || 0, h.topic_id || ''];
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
    if (v.k !== 'L' || v.m.indexOf(SHO) === -1) return;
    if (!v.gt && cache.items[v.i] && cache.items[v.i][2]) v.gt = cache.items[v.i][2];
    if (v.s) return;
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

/* 同じ企画の別視点に、同じ印（p＝代表の動画ID）を付ける。一覧・カレンダーでは代表だけを出し、
   ほかは詳細カードの「ほかの視点」に出す（引き継ぎ書の「人数ぶん増えると一覧が埋まる」）。
   1) 8人の枠どうし：どちらも8人のだれかの枠の配信で、枠の持ち主が違い、お互いの出演に相手の枠の持ち主が入っていて、
      開始時刻があれば10分以上重なる（無ければ同じ日）。
   2) ほかの人の枠（2026-10-29 に足した。持ち主の判断。他視点がすべてアーカイブ・カレンダーに並んでいたため）：
      8人のだれかの枠の配信と、配信している時間が10分以上重なっていて、その人が出ている（Holodex のメンション・題名の名前）もの。
      開始時刻の差では見ない（2026-10-29 持ち主の希望。本人の10時間の配信の途中から始まったチーム練習の各視点も、他視点にするため）。
      1人が同じ時間に2つの配信に出ることはないので、同じ企画と言える（これからの配信と同じ考え）。ただし次のときは除く：
      - ゲーム名（シートの「ゲーム」の列）が両方分かっていて違うもの。本人のゲームの配信の最中に流れた公式番組の初回放送や、
        合間にほかの人の配信へ電話で少し出ただけのものが、重なり＋メンションだけだと他視点になった（2026-10-29 のデータで、増えた80本のうち十数本）
      - ゲーム名がどちらか分からないもの（公式番組・ショウケースから来た他枠など）は、重なり方で見る：
        短いほうの9割以上が重なり長いほうの6割以上も重なる、または、短いほうの6割以上が重なり題名に同じハッシュタグか【】の言葉がある
      - 逆凸・凸待ち（ゲーム名が totsu か、題名に「逆凸」「凸待ち」）。本人は電話で少し出ただけのため
      ⚠️ 1本の他枠が、同じ人の枠の2本に当たるときは、重なりが長いほうだけにまとめる（同じ人の別々の配信が、他枠を通して1つにまとまらないように）。
         伊波の41分の新衣装お披露目と、同じ時刻に始まった Rei7 さんの11時間の自主練（伊波は2時間後の顔合わせから出た）も、これで顔合わせのほうにまとまる
      実データ（2026-10-29）で確かめた：他枠の配信1,630本のうち1,086本がまとまる。10/21 の小柳の「視聴者カスタム」（10時間）と、
      5時間後に始まった本間ひまわりさん・五十嵐梨花さんのチーム練習もまとまる
   ⚠️ ほかの人の枠どうしはまとめない（8人のだれかが出ているだけでは、同じ企画と言い切れないため）
   ⚠️ 代表は8人の枠から選ぶ（ほかの人の枠を代表にしない）。8人の並び順でいちばん前の人の枠。
      サイトの groupSameCollab（src/videos.js）と buildCombos も同じ並べ方にすること */
const hostRank = v => (v.h ? memberOrder(v.h) : 99);
const TOTSU_TITLE = /逆凸|凸待ち/;
function groupSameCollab(videos) {
  const parent = {};
  const hosts = {};   // まとまりの代表の印 → その中にある8人の枠の持ち主
  const add = v => { if (!parent[v.i]) { parent[v.i] = v.i; hosts[v.i] = new Set(v.h ? [v.h] : []); } };
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const join = (a, b) => {
    const ra = find(a.i), rb = find(b.i);
    if (ra === rb) return;
    parent[ra] = rb;
    hosts[ra].forEach(h => hosts[rb].add(h));
  };
  // 同じ人の枠が2本入ることになるなら、まとめない（大会の日に、同じ人の準々決勝と準決勝が1つになった）
  const canJoin = (a, b) => {
    const ra = find(a.i), rb = find(b.i);
    return ra === rb || ![...hosts[ra]].some(h => hosts[rb].has(h));
  };
  const startOf = v => Date.parse(v.d + 'T' + v.s + ':00+09:00');
  const span = v => { const t = startOf(v); return [t, t + (v.l || 0) * 1000]; };
  const overlap = (x, y) => { const [p, q] = span(x), [r, s] = span(y); return Math.min(q, s) - Math.max(p, r); };

  // 1) 8人の枠どうし
  const cand = videos.filter(v => v.h && v.k === 'L' && v.m.length >= 2);
  cand.forEach(add);
  const byDate = {};
  cand.forEach(v => { (byDate[v.d] = byDate[v.d] || []).push(v); });
  Object.values(byDate).forEach(list => {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const x = list[a], y = list[b];
      if (x.h === y.h || x.m.indexOf(y.h) === -1 || y.m.indexOf(x.h) === -1) continue;
      if (x.s && y.s && x.l && y.l && overlap(x, y) < 10 * 60 * 1000) continue;
      join(x, y);
    }
  });

  // 2) ほかの人の枠 → 8人の枠（開始時刻と長さが分かるものだけ）
  const own = videos.filter(v => v.h && v.k === 'L' && v.s && v.l);
  const guests = videos.filter(v => !v.h && !v.cl && v.k === 'L' && v.s && v.l);
  /* 当たった組を、長いほうとの重なりが大きい順にまとめる（確かなものから先に）。
     ⚠️ 同じ人の枠が2本入るまとめ方はしない（canJoin）。大会の公式の長い配信や、相手の視点を通して、
        同じ人の別々の試合がつながってしまうため（2025-05-05 のマリカにじさんじ杯で、星導の準々決勝と準決勝が1つになった）。
        ただし 1) の8人の枠どうしは、これまでどおり（配信をやり直した2本が同じ企画にまとまる） */
  const links = [];
  guests.forEach(g => {
    const best = {};   // 8人の key → いちばん長く重なる本人の枠
    if (g.gt === 'totsu' || TOTSU_TITLE.test(g.t)) return;
    own.forEach(o => {
      if (g.m.indexOf(o.h) === -1) return;
      const ov = overlap(g, o) / 1000;
      if (ov < 10 * 60) return;
      if (g.gt && o.gt) {
        if (g.gt !== o.gt) return;   // 同じゲームなら、重なっていて出ているだけでよい
      } else {
        /* 片方のゲーム名が分かるときは、もう片方の題名にそのゲームの名前が出てくれば同じ企画とみなす（2026-10-30）。
           Holodex にもシートにもゲーム名が無い他枠があった（10/23 の叶さんの「スクリムDAY1 …#にじEX_OW」と、伊波の Overwatch の配信）。
           ⚠️ 開始時刻の差で決めないこと。決まった時刻に初めて流れる録画の番組（四季凪さんの「検証」など）が、8人の配信と同じ時刻に重なってまとまった */
        const named = g.gt ? titleHasGame(o.t, g.gt) : o.gt ? titleHasGame(g.t, o.gt) : false;
        const ofShort = ov / Math.min(g.l, o.l), ofLong = ov / Math.max(g.l, o.l);
        if (!(named || (ofShort >= 0.9 && ofLong >= 0.6) || (ofShort >= 0.6 && shareTitleWord(g.t, o.t)))) return;
      }
      if (!best[o.h] || ov > best[o.h].ov) best[o.h] = { o, ov };
    });
    Object.values(best).forEach(x => links.push({ g, o: x.o, score: x.ov / Math.max(g.l, x.o.l) }));
  });
  links.sort((a, b) => b.score - a.score);
  const linkedIds = new Set();
  links.forEach(({ g, o }) => {
    add(g); add(o);
    if (!canJoin(g, o)) return;
    join(g, o);
    linkedIds.add(g.i);
  });
  const linked = linkedIds.size;

  /* 3) 枠の立て直し（2026-10-30、持ち主の希望）。短い配信のすぐ後に枠が立ったものは、立て直しの見込みが高いので同じ企画にまとめる。
     - 同じチャンネル（8人の枠でも、ほかの人の枠でも）：10分以内の配信が終わってから10分以内に、同じチャンネルで次の配信が始まったもの。
       同じ人の枠が2本入ってよい（canJoin の決まりの例外）
     - ほかの人の枠の短い配信：10分以内で8人のだれかが出ていて、その人の配信が、短い配信のあいだか終わってから10分以内に始まったもの。
       立て直したあとの枠がデータに無いとき用（10/29 の早乙女ベリーさんの2分40秒の枠と、そのすぐ後に始まった緋八の配信）
     - ⚠️ ゲーム名が両方分かっていて違うものはまとめない。短く遊んで別のゲームに移っただけのことがある（2023-09-23 の星導の Togges 8分 → 影廊）。
       ゲーム名がどちらか分からないとき（ショウケースから来たショウの配信など）は、題名に同じハッシュタグか【】の言葉があるときと、
       短いほうの題名が「？」や名前だけのような仮の題名のとき（【】の言葉が無い）だけまとめる
     - ⚠️ 長さは10分までにすること。20〜30分の配信の後には、マイクラのハードコアの次の周や、Detroit の続きの回（別の配信）が来ることが多かった
     実データ（2026-10-30）で数えた：同じチャンネルで「10分以内の配信 → 10分以内に次の配信」は19組。どれも題名がほぼ同じか「改」「仕切り直し」「２」など */
  const RESTART_MAX_SEC = 10 * 60, RESTART_GAP_MS = 10 * 60e3;
  // a が短いほう。ゲーム名が両方分かればそれで、分からなければ題名で見る
  const sameGameOk = (a, b) => (a.gt && b.gt) ? a.gt === b.gt : (shareTitleWord(a.t, b.t) || titleWords(a.t).size === 0);
  const timed = videos.filter(v => v.k === 'L' && !v.cl && v.s && v.l && (v.h || v.o));
  const byChannel = {};
  timed.forEach(v => { const key = v.h ? 'h:' + v.h : 'o:' + v.o; (byChannel[key] = byChannel[key] || []).push(v); });
  let restarts = 0;
  Object.values(byChannel).forEach(list => {
    list.sort((a, b) => startOf(a) - startOf(b));
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1];
      if (a.l > RESTART_MAX_SEC || !sameGameOk(a, b)) continue;
      const gap = startOf(b) - (startOf(a) + a.l * 1000);
      if (gap < -5 * 60e3 || gap > RESTART_GAP_MS) continue;
      add(a); add(b); join(a, b); restarts++;
    }
  });
  guests.forEach(g => {
    if (g.l > RESTART_MAX_SEC || g.gt === 'totsu' || TOTSU_TITLE.test(g.t)) return;
    const gs = startOf(g), ge = gs + g.l * 1000;
    const best = {};
    own.forEach(o => {
      if (g.m.indexOf(o.h) === -1 || !sameGameOk(g, o)) return;
      const os = startOf(o);
      if (os < gs || os > ge + RESTART_GAP_MS) return;
      if (!best[o.h] || os < startOf(best[o.h])) best[o.h] = o;
    });
    Object.values(best).forEach(o => { add(g); add(o); if (canJoin(g, o)) { join(g, o); restarts++; } });
  });

  const members = {};
  videos.forEach(v => { if (parent[v.i]) (members[find(v.i)] = members[find(v.i)] || []).push(v); });
  let count = 0;
  Object.values(members).forEach(list => {
    if (list.length < 2) return;
    count++;
    // 同じ人の枠が2本あるとき（枠の立て直し）は、長いほう（立て直したあと）を代表にする
    list.sort((a, b) => hostRank(a) - hostRank(b) || (b.l || 0) - (a.l || 0));
    list.forEach(v => { v.p = list[0].i; });
  });
  console.log('同じ企画の別視点：' + count + ' 組（ほかの人の枠から ' + linked + ' 本・枠の立て直し ' + restarts + ' 組）');
  return count;
}

/* 同じゲームの配信（gm）。動画の詳細カードに「同じゲームの配信」として出す（2026-10-29、持ち主の希望。
   MECHATU-NE で、同じ曲を歌ったほかの枠が出るのと同じ考え）。
   ゲームは Dytica のシートの「ゲーム」の列（Holodex のゲーム名）。ショウのぶんは Holodex の控えから補う（fillShoStarts）。
   主に単発のゲームを対象にする：配信（k が L）で、同じ企画の別視点を1回と数えて、2〜15回遊ばれたゲームだけ。
   2026-10-29 のデータで数えた：ゲームの種類526のうち、2〜15回のものが295種類（2〜3回141・4〜6回96・7〜10回41・11〜15回17）。
   ⚠️ たくさん遊ばれているゲーム（16回以上）は入れないこと。ストーリーに関係なく繰り返し遊ぶもの（FPS・格闘ゲームなど）は、
      同じゲームの配信が何百本も並んで役に立たないため（スト6 424回・Apex 333回・VALORANT 254回・Overwatch 54回）
   ⚠️ 回数が少なくても、繰り返し遊ぶ種類のゲーム（REPEAT_GAMES）と、ゲームではないもの（NON_GAME_TOPICS）は入れない */
const GAME_MAX_PLAYS = 15;
const REPEAT_GAMES = new Set(['apex', 'valorant', 'Street_Fighter', 'Overwatch', 'Rainbow_Six', 'PUBG', 'Fortnite', 'Tarkov', 'battlefield',
  'Marvel_Rivals', 'XDefiant', 'The_Finals', 'Tekken', 'smash', 'League_of_Legends', 'eFootball', 'FIFA', 'Mahjong', 'Mario_Kart', 'Splatoon',
  'fallguys', 'Identity_V', 'Shadowverse', 'Pokemon_Trading_Card_Game_Pocket', 'uno', 'GTA', 'minecraft', 'ark', 'Rust']);
const NON_GAME_TOPICS = new Set(['talk', 'morning', 'singing', '3D_Stream', 'watchalong', 'Birthday', 'totsu', 'Anniversary', 'Cooking_Stream',
  'Superchat_Reading', 'Outfit_Reveal', 'unboxing', 'announce', 'mukbang', 'celebration', 'Debut_Stream', 'drawing', 'asmr', 'membership',
  'membersonly', 'Teaser', 'Review', 'Vlog', 'Animation', 'Music_Cover', 'Shopping', 'Ranking', 'Musical_Instrument', 'endurance', 'Gathering',
  'Quiz', 'TRPG', 'Situation_puzzle', 'Horse_racing', 'Language_learning', 'Fortune_telling', 'Personality_Test', 'CalorieMate']);
/* 周年記念のページの数（2026-10-30、持ち主の希望）。8人それぞれと全員の「配信」の本数・時間を、年ごとにも数える。
   数え方は組み合わせ（buildCombos）と同じ：配信（k が L）だけ、クリップと配信予定は数えない、同じ企画の別視点は1回。
   本人の枠が無い回（ほかの人の枠に出た回）も、その人の配信として数える。時間は、本人の枠があればその長さ、無ければ代表の長さ。
   2026-10-30 のデータで数えた：8人の配信 7,589本・24,848時間（2023年 1,612本 → 2024年 2,106本 → 2025年 2,033本）。
   ⚠️ 「いちばん長い配信」は出さないこと。8人とも12時間ちょうど近く（YouTube のアーカイブが残る上限）の配信が何本もあり、比べる意味が無かった
   ⚠️ 「よく遊んだゲーム」も出さないこと。ショウのぶんはゲーム名が Holodex の控えにある枠だけ（ほかの7人の1割ほど）で、並べると食い違って見えた */
function buildStats(videos) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const lives = videos.filter(v => v.k === 'L' && !v.cl && v.d <= today);
  const tally = (list, own) => {
    // 同じ企画からは1本：本人の枠（全員のときは8人の並び順で前の人の枠）→ 長いほう（枠の立て直しは立て直したあと）
    const rank = v => (own ? (v.h === own ? 0 : 1) : hostRank(v)) * 1e7 - Math.min(v.l || 0, 1e7 - 1);
    const best = {};
    list.forEach(v => { const k = v.p || v.i; if (!best[k] || rank(v) < rank(best[k])) best[k] = v; });
    const picks = Object.values(best);
    const y = {};
    picks.forEach(v => {
      const k = v.d.slice(0, 4);
      y[k] = y[k] || { n: 0, h: 0 };
      y[k].n++; y[k].h += (v.l || 0) / 3600;
    });
    Object.values(y).forEach(x => { x.h = Math.round(x.h); });
    return { n: picks.length, h: Math.round(picks.reduce((s, v) => s + (v.l || 0), 0) / 3600), y };
  };
  const members = {};
  MEMBERS.forEach(m => { members[m.key] = tally(lives.filter(v => v.m.indexOf(m.key) !== -1), m.key); });
  return { today, all: tally(lives, ''), members };
}

function markSameGames(videos) {
  const plays = {};
  const target = v => v.gt && v.k === 'L' && !v.cl && !REPEAT_GAMES.has(v.gt) && !NON_GAME_TOPICS.has(v.gt);
  videos.forEach(v => { if (target(v)) (plays[v.gt] = plays[v.gt] || new Set()).add(v.p || v.i); });
  let n = 0;
  const titles = {};
  videos.forEach(v => {
    const k = plays[v.gt] ? plays[v.gt].size : 0;
    if (target(v) && k >= 2 && k <= GAME_MAX_PLAYS) { v.gm = v.gt; n++; (titles[v.gm] = titles[v.gm] || []).push(v); }
    delete v.gt;
  });
  console.log('同じゲームの配信：' + Object.keys(titles).length + ' 種類・' + n + ' 本');
  return Object.keys(titles);
}

/* みんなで遊んだゲーム（2026-10-30、持ち主の希望）。8人のうち何人が遊んだことがあるかを、ゲームごとに数える（サイトの「ゲーム」のページ）。
   - 遊んだ：その人が出ている配信（本人の枠でも、ほかの人の枠に出た回でも）に、Holodex のゲーム名が付いているもの
   - 回数は同じ企画の別視点を1回と数える。ゲームではないもの（NON_GAME_TOPICS）は入れない。繰り返し遊ぶゲーム（APEX など）は入れる
   - 2人以上が遊んだゲームだけを書き出す（1人だけのものは「みんなで」にならないため）
   - 配信には ga（ゲーム名）を付ける。アーカイブをゲームで絞るときに使う（gm は「同じゲームの配信」に出す単発のゲームだけ）
   2026-10-30 のデータで数えた：8人全員が29種類・7人が23種類・6人が28種類（2人以上で335種類）。7人のゲームで抜けているのは小柳が14種類といちばん多い。
   ⚠️ ショウのゲーム名は Holodex の控えから補う。控えを全部取り直す前（ゲーム名を控えに入れ始めた 10-29 より前の控え）は、
      ゲーム名が分かる枠が4割ほどしかなく、8人全員が23種類と少なく出ていた（取り直して、ほかの7人と同じ8割ほどになった）
   ⚠️ markSameGames（gt を消す）より前に呼ぶこと */
function buildPlayedGames(videos) {
  const streams = {};
  videos.forEach(v => {
    if (v.k !== 'L' || v.cl || !v.gt || NON_GAME_TOPICS.has(v.gt)) return;
    v.ga = v.gt;
    (streams[v.gt] = streams[v.gt] || []).push(v);
  });
  const list = [];
  Object.keys(streams).forEach(g => {
    const m = {};
    MEMBERS.forEach(({ key }) => {
      const ps = new Set(streams[g].filter(v => v.m.indexOf(key) !== -1).map(v => v.p || v.i));
      if (ps.size) m[key] = ps.size;
    });
    if (Object.keys(m).length < 2) return;
    list.push({ g, m, c: new Set(streams[g].map(v => v.p || v.i)).size });
  });
  list.sort((a, b) => Object.keys(b.m).length - Object.keys(a.m).length || b.c - a.c || a.g.localeCompare(b.g));
  const by = {};
  list.forEach(x => { const n = Object.keys(x.m).length; by[n] = (by[n] || 0) + 1; });
  console.log('みんなで遊んだゲーム：' + Object.keys(by).sort((a, b) => b - a).map(n => n + '人 ' + by[n] + '種類').join('・'));
  return { list, streams };
}

/* 日本語のゲーム名（2026-10-30、持ち主の希望）。Holodex のゲーム名は英語（The_Dandelion_Endures.）なので、配信の題名の【】から取る。
   同じゲームの配信のうち、2本以上の題名の【】に同じ言葉があれば、それを名前にする（例：【タンポポは耐える。】）。
   - 回の番号（#2・Part3・その1・第5回・2日目など）と、そのあとの言葉は外して比べる。どの回も同じ書き方なら、番号の前までを名前にする
   - 名前の札（【星導ショウ/にじさんじ】）・ハッシュタグ・「初見」「雑談」などは名前にしない（NOT_GAME_WORD）
   - 分からないとき（題名がそろっていない・【】が無い）は空。サイトは英語の名前のまま出す
   2026-10-30 のデータで数えた：266種類のうち228種類で日本語（または題名どおりの英語）の名前が取れた。
   ⚠️ 取れた名前が違っていたら、GAME_NAMES_FIXED に正しい名前を書く（自動より先に使う） */
// シリーズ全体で1つのゲーム名になっているもの（Holodex の Pokemon など）は、題名からだと1作の名前（Pokémon LEGENDS Z-A）になるので、シリーズの名前にする
const GAME_NAMES_FIXED = {
  Pokemon: 'ポケモン', Mario_Kart: 'マリオカート', Mario_Party: 'マリオパーティ', smash: 'スマブラ', Splatoon: 'スプラトゥーン',
  // 題名の書き方がそろわず自動では取れなかったもの（題名で使われている呼び方にした）
  momotaro_dentetsu: '桃鉄',
};
const GAME_EPISODE = /\s*(?:[#＃]\s*\d+|part\.?\s*\d+|pt\.?\s*\d+|ep\.?\s*\d+|episode\s*\d+|day\s*\d+|その\s*\d+|其の\s*\d+|第\s*\d+\s*(?:回|話|夜|章|部|日)?|\d+\s*日目|\d+\s*回目|vol\.?\s*\d+|\(\s*\d+\s*\))(?:.*)$/i;
const NOT_GAME_WORD = /^(?:完全)?初見|^雑談|^歌枠|^告知|^ネタバレ|^※|^コラボ|^ホラー$|^最終回|^新作|^実況|^生配信|^耐久|^同時視聴|^作業|^朝活|^vtuber|^新人|^ゲーム実況|^初配信|^深夜|^まったり|^参加型|^概要欄|^live$|^ライブ$|^en\b|^eng\b|^日本語|^短め|^ちょっとだけ|^人生初|^お知らせ|^おしらせ/i;
function gameNameFromTitles(list) {
  const groups = {};
  const keyOf = s => s.toLowerCase().replace(/[\s・:：!！?？。、.,'’"]/g, '');
  list.forEach(v => {
    const p = v.p || v.i;
    const seen = new Set();
    (String(v.t || '').normalize('NFKC').match(/【[^】]*】|\[[^\]]*\]/g) || []).forEach(w => {
      const full = w.slice(1, -1).replace(/\s+/g, ' ').trim();
      if (full.length < 2 || /にじさんじ|nijisanji/i.test(full) || /^[#＃]/.test(full)) return;
      const base = full.replace(GAME_EPISODE, '').replace(/[\s:：]+$/, '').trim();
      if (base.length < 2 || NOT_GAME_WORD.test(base)) return;
      const k = keyOf(base);
      if (!k || seen.has(k)) return;
      seen.add(k);
      const g = groups[k] = groups[k] || { ps: new Set(), fulls: {}, bases: {} };
      g.ps.add(p);
      g.fulls[full] = (g.fulls[full] || 0) + 1;
      g.bases[base] = (g.bases[base] || 0) + 1;
    });
  });
  const best = Object.values(groups).sort((a, b) => b.ps.size - a.ps.size)[0];
  if (!best || best.ps.size < 2) return '';
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
  // どの回もほぼ同じ書き方（3分の2以上）なら、そのまま。回ごとに違えば、番号を外した形
  return top(best.fulls)[1] >= best.ps.size * 2 / 3 ? top(best.fulls)[0] : top(best.bases)[0];
}

/* 題名に同じハッシュタグか【】の中の言葉があるか（同じ企画かを見分ける手がかり）。
   ⚠️ 「にじさんじ」「vtuber」などは、どの題名にもあるので手がかりにしない */
const COMMON_TITLE_WORDS = new Set(['にじさんじ', 'nijisanji', 'vtuber', 'shorts', '新人vtuber', 'にじさんじ所属']);
function titleWords(t) {
  const s = String(t || '').normalize('NFKC').toLowerCase();
  const words = [];
  (s.match(/#[^\s#【】|/]+/g) || []).forEach(w => words.push(w.slice(1)));
  /* ⚠️ 名前の札（【星導ショウ/にじさんじ】のように「にじさんじ」を含む【】）は手がかりにしないこと。
        同じ人の配信どうしは、ゲームが違っても名前の札が同じになる（2023-09-23 の星導の Togges → 影廊 が、これで同じ企画になった） */
  (s.match(/【[^】]*】/g) || []).forEach(w => { const x = w.slice(1, -1).replace(/\s+/g, ''); if (!/にじさんじ|nijisanji/.test(x)) words.push(x); });
  return new Set(words.filter(w => w.length >= 2 && !COMMON_TITLE_WORDS.has(w)));
}
function shareTitleWord(a, b) {
  const x = titleWords(a), y = titleWords(b);
  return [...x].some(w => y.has(w));
}

/* 題名にゲームの名前が出てくるか（gt は Holodex のゲーム名）。よく遊ばれるゲームは、題名での呼び方も見る。
   英字は単語として比べる（「OW」が「show」などに当たらないように）。それ以外は、題名に含まれていればよい。
   2026-10-30 のデータで確かめた：ゲーム名が片方しか分からない他枠で、これで増えたのは2本（叶さんの OW のスクリム、でびでび・でびるさんの LoL のカスタム）。どちらも同じ企画 */
const GAME_ALIASES = {
  Overwatch: ['ow', 'ow2', 'overwatch', 'オーバーウォッチ'],
  Street_Fighter: ['sf6', 'スト6', 'ストリートファイター', 'street fighter'],
  apex: ['apex', 'エーペックス', 'エペ'],
  valorant: ['valorant', 'ヴァロ', 'ヴァロラント'],
  GTA: ['gta', 'newtown', 'madtown', 'ストグラ'],
  minecraft: ['minecraft', 'マイクラ', 'マインクラフト'],
  Mario_Kart: ['マリカ', 'マリオカート', 'mario kart'],
  Splatoon: ['splatoon', 'スプラ'],
  League_of_Legends: ['lol', 'league of legends'],
  Mahjong: ['雀魂', '麻雀', 'mahjong'],
  smash: ['スマブラ', 'smash'],
  Pokemon: ['ポケモン', 'pokemon'],
  ark: ['ark'],
  Rust: ['rust'],
  among_us: ['among us', 'アモアス', 'amongus'],
};
function titleHasGame(title, gt) {
  const t = String(title || '').normalize('NFKC').toLowerCase();
  const tokens = new Set(t.match(/[a-z0-9]+/g) || []);
  const words = new Set((GAME_ALIASES[gt] || []).map(w => w.toLowerCase()));
  String(gt).toLowerCase().split(/[_:\s]+/).filter(w => w.length >= 4).forEach(w => words.add(w));
  for (const w of words) {
    if (/^[a-z0-9]+$/.test(w) ? tokens.has(w) : t.indexOf(w) !== -1) return true;
  }
  return false;
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
    if (key === 'showcaseDisco') item.m = [SHO];
    else {
      const ms = [];
      splitList(get('参加')).forEach(n => {
        const k = KEY_BY_SHORT[n] || KEY_BY_NAME[nameKey(n)];
        if (k) { if (ms.indexOf(k) === -1) ms.push(k); }
        else rowIssue(key, rowNo, '参加の「' + n + '」が8人の誰か分かりません（ウェン・リト・イッテツ・マナ・ライ・ロウ・ショウ・カゲツ のどれか）。外しました');
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
    if (key === 'showcaseArticles') item.m = [SHO];
    else {
      const ms = [];
      splitList(get('参加')).forEach(n => {
        const k = KEY_BY_SHORT[n] || KEY_BY_NAME[nameKey(n)];
        if (k) { if (ms.indexOf(k) === -1) ms.push(k); }
        else rowIssue(key, rowNo, '参加の「' + n + '」が8人の誰か分かりません（ウェン・リト・イッテツ・マナ・ライ・ロウ・ショウ・カゲツ のどれか）。外しました');
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

/* ボイス（2026-10-30、持ち主の希望。決めたこと.md の1章で「載せる」にしていたもの）。
   ショウケースのシートの「ボイス」はショウのボイス、Dytica のシートの「ボイス」タブは「参加」に書いた人のボイス（列は同じ＋「参加」）。
   同じボイスが両方にあるとき（シリーズで全員が出すボイスなど）は、購入ページの URL で1件にし、参加した人を合わせる。
   載せるもの：ボイス名・日付（並べ替え用、無ければ販売期間の始まり）・種別・自作台本・購入ページ・お知らせ（プレスリリース）・ハッシュタグ
   ⚠️ 載せないもの：販売区分（販売終了・常設など）と購入可否（販売状況は載せないと決めた。1章）、サンプル（X のポスト）、キービジュアル（画像）、
      プレスリリースが X のポストのもの。販売期間の文字はそのまま出さない（曜日が入っているため。日付に曜日を付けない決まり）
   ⚠️ 読めなくても止めず、前回の公開のものを使う（ディスコグラフィと同じ） */
async function buildVoices(previous) {
  const scRows = await readSheetSoft('showcaseVoice');
  const dyRows = await readSheetSoft('dyticaVoice');
  if (!SOURCES.dyticaVoice.gid && !FROM) note('Dytica のシートの「ボイス」タブは、まだ読んでいません（タブを作ったら export/build.js に gid を入れる）');
  if (!scRows && !dyRows) return (previous && previous.voices) || [];
  const byKey = {};
  const order = [];
  const add = item => {
    const key = normUrl(item.u) || item.t;
    const had = byKey[key];
    if (!had) { byKey[key] = item; order.push(key); return; }
    had.m = sortMembers(Array.from(new Set(had.m.concat(item.m))));
    ['d', 'k', 'r', 'tag'].forEach(f => { if (!had[f] && item[f]) had[f] = item[f]; });
  };
  if (scRows) parseVoices(scRows, 'showcaseVoice').forEach(add);
  if (dyRows) parseVoices(dyRows, 'dyticaVoice').forEach(add);
  return order.map(k => byKey[k]).sort((a, b) => String(b.d || '').localeCompare(String(a.d || '')) || a.t.localeCompare(b.t));
}

/* ボイスのシートの1行 → ボイス。見出しはショウケースに合わせた（ぴったり同じ文字で探す）。
   ⚠️ 見出しが無いときも止めない（その表だけ読まずに知らせる） */
function parseVoices(rows, key) {
  const label = SOURCES[key].label;
  const header = rows[0].map(h => String(h).trim());
  const need = ['ボイス名', '販売期間', 'ボイス種別', '購入ページ'].concat(key === 'dyticaVoice' ? ['参加'] : []);
  const missing = need.filter(h => header.indexOf(h) === -1);
  if (missing.length) { warn(label + ' に見出しが見つかりません：' + missing.join('、') + '。この表は読んでいません'); return []; }
  const col = h => header.indexOf(h);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = h => (col(h) < 0 ? '' : String(r[col(h)] == null ? '' : r[col(h)]).trim());
    const title = get('ボイス名');
    if (!title) continue;
    const rowNo = i + 1;
    const item = { t: title };
    // 日付：並べ替え用（2026/07/10）が無ければ、販売期間の始まり（2026年10月9日(金)12時～…）から
    const m = get('販売期間').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const date = normDate(get('並べ替え用')) || (m ? normDate(m[1] + '/' + m[2] + '/' + m[3]) : '');
    if (date) item.d = date;
    else rowIssue(key, rowNo, '日付が読めません（並べ替え用に 2026/10/09 の形で入れるか、販売期間を「2026年10月9日」で始めてください）。日付なしで載せました');
    if (get('ボイス種別')) item.k = get('ボイス種別');
    if (isCircle(get('自作台本'))) item.s = 1;
    const shop = get('購入ページ'); if (/^https?:\/\//.test(shop)) item.u = shop;
    const press = get('プレスリリース'); if (/^https?:\/\//.test(press) && !/(^|\/\/|\.)(x|twitter)\.com\//i.test(press)) item.r = press;
    const tag = get('ハッシュタグ').replace(/^[#＃]/, '').trim(); if (tag) item.tag = tag;
    if (key === 'showcaseVoice') item.m = [SHO];
    else {
      const ms = [];
      splitList(get('参加')).forEach(n => {
        const k = KEY_BY_SHORT[n] || KEY_BY_NAME[nameKey(n)];
        if (k) { if (ms.indexOf(k) === -1) ms.push(k); }
        else rowIssue(key, rowNo, '参加の「' + n + '」が8人の誰か分かりません（ウェン・リト・イッテツ・マナ・ライ・ロウ・ショウ・カゲツ のどれか）。外しました');
      });
      if (!ms.length) { rowIssue(key, rowNo, '参加が空なので、この行は載せていません'); continue; }
      item.m = sortMembers(ms);
    }
    out.push(item);
  }
  return out;
}

/* ライブ（公演）。ショウケースの「ライブ」「ライブ詳細」と、Dytica のシートの同じ形のタブを読む。
   同じ ID の公演が両方にあるときは、ショウケースのほうを使う（ショウが出ている公演はショウケースが正）。
   載せるもの：公演の基本（名前・日付・会場・時刻・形態・アーカイブ・公式サイト・出演）／セットリスト／関連動画／ライブレポート・特集記事／リリース
   ⚠️ 載せないもの：写真・キービジュアル（X や販売ページの画像を直接読み込むことになるため。ディスコグラフィのジャケットと同じ）、
      ポスト（X のポストは載せないと決めた。1章）、グッズ（価格・在庫は載せないと決めた）
   ⚠️ 読めなくても止めず、前回の公開のものを使う（ディスコグラフィと同じ） */
async function buildLives(previous) {
  const sc = { ev: await readSheetSoft('showcaseLive'), de: await readSheetSoft('showcaseLiveDetail') };
  const dy = { ev: await readSheetSoft('dyticaLive'), de: await readSheetSoft('dyticaLiveDetail') };
  if (!SOURCES.dyticaLive.gid && !FROM) note('Dytica のシートの「ライブ」「ライブ詳細」タブは、まだ読んでいません（タブを作ったら export/build.js に gid を入れる）');
  if (!sc.ev && !dy.ev) return (previous && previous.lives) || [];
  const byId = {};
  const order = [];
  [['showcaseLive', 'showcaseLiveDetail', sc], ['dyticaLive', 'dyticaLiveDetail', dy]].forEach(([evKey, deKey, rows]) => {
    if (!rows.ev) return;
    const events = parseLiveEvents(rows.ev, evKey);
    const fresh = events.filter(e => {
      if (!byId[e.id]) return true;
      note(SOURCES[evKey].label + ' の「' + e.id + '」は、ショウケースのシートにもあるので、ショウケースのほうを使いました');
      return false;
    });
    fresh.forEach(e => { byId[e.id] = e; order.push(e.id); });
    if (rows.de) parseLiveDetails(rows.de, deKey, new Map(fresh.map(e => [e.id, e])), new Set(events.map(e => e.id)));
  });
  return order.map(id => byId[id]).sort((a, b) => b.d.localeCompare(a.d) || a.t.localeCompare(b.t));
}

/* 「ライブ」の1行 → 公演。見出しはショウケースに合わせた（ぴったり同じ文字で探す）。
   ⚠️ 見出しが無いときも止めない（その表だけ読まずに知らせる） */
function parseLiveEvents(rows, key) {
  const label = SOURCES[key].label;
  const header = rows[0].map(h => String(h).trim());
  const need = ['ID', 'イベント名', '日付', '出演'];
  const missing = need.filter(h => header.indexOf(h) === -1);
  if (missing.length) { warn(label + ' に見出しが見つかりません：' + missing.join('、') + '。この表は読んでいません'); return []; }
  const col = h => header.indexOf(h);
  const out = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = h => (col(h) < 0 ? '' : String(r[col(h)] == null ? '' : r[col(h)]).trim());
    const name = get('イベント名');
    if (!name) continue;
    const rowNo = i + 1;
    const id = get('ID');
    if (!/^[A-Za-z0-9_-]+$/.test(id)) { rowIssue(key, rowNo, 'ID「' + id + '」は、半角の英数字と - _ で入れてください（URL に使うため）。この行は載せていません'); continue; }
    if (seen.has(id)) { rowIssue(key, rowNo, 'ID「' + id + '」が上の行と同じです。この行は載せていません'); continue; }
    const date = normDate(get('日付'));
    if (!date) { rowIssue(key, rowNo, '日付「' + get('日付') + '」が読めません（2026/10/10 の形で、文字として入れてください）。この行は載せていません'); continue; }
    seen.add(id);
    const cast = splitList(get('出演'));
    const ev = { id, t: name, d: date, m: sortMembers(Array.from(new Set(cast.map(n => KEY_BY_NAME[nameKey(n)]).filter(Boolean)))) };
    // 8人以外の出演者の名前。公演の出演は公式の発表どおりなので、名前も載せる（動画のコラボ相手とは違う。決めたこと.md の0章）
    const others = cast.filter(n => !KEY_BY_NAME[nameKey(n)]);
    if (others.length) ev.o = others;
    if (!ev.m.length) rowIssue(key, rowNo, '出演に8人のだれも見つかりません（フルネームで入れてください）');
    ['会場:pl', '開始時刻:tm', '形態:f'].forEach(x => { const [h, f] = x.split(':'); if (get(h)) ev[f] = get(h); });
    const arch = get('アーカイブURL');
    const av = videoId(arch.replace(/^(?=(www\.)?youtu)/, 'https://'));
    if (av) { ev.a = av; const at = timeParam(arch); if (at) ev.at = at; }
    const official = get('公式URL');
    if (/^https?:\/\//.test(official)) ev.u = official;
    out.push(ev);
  }
  return out;
}

/* 「ライブ詳細」の1行 → 公演の項目。種別ごとに分ける。並びはシートの行の順のまま（曲順）。
   セットリストの表示名は「1.曲名」「24-1.曲名」（メドレーは枝番）。番号はシートの書き方のまま使う（ショウケースと同じ）。
   補足（歌った人）は、8人は key、ユニット名（MECHATU-A・Oriens・Dytica）はそのまま、ほかの人は名前のまま入れる。
   m は歌った8人（ユニット名は中の人に広げる。メンバーを選んだときに印を付けるため）
   ⚠️ 写真・ポスト・グッズは読まない（buildLives の説明） */
function parseLiveDetails(rows, key, events, allIds) {
  const label = SOURCES[key].label;
  const header = rows[0].map(h => String(h).trim());
  const need = ['イベントID', '種別', '表示名', 'URL', '補足'];
  const missing = need.filter(h => header.indexOf(h) === -1);
  if (missing.length) { warn(label + ' に見出しが見つかりません：' + missing.join('、') + '。この表は読んでいません'); return; }
  const col = h => header.indexOf(h);
  const unitByName = {};
  UNITS.forEach(u => { unitByName[nameKey(u.name)] = u; });
  unitByName[nameKey('MECHATU-A')] = { name: 'MECHATU-A', members: MEMBERS.map(m => m.key) };
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = h => (col(h) < 0 ? '' : String(r[col(h)] == null ? '' : r[col(h)]).trim());
    const id = get('イベントID'), kind = get('種別');
    if (!id || !kind) continue;
    const rowNo = i + 1;
    if (!allIds.has(id)) { rowIssue(key, rowNo, 'イベントID「' + id + '」が「ライブ」のタブにありません。この行は載せていません'); continue; }
    const ev = events.get(id);
    if (!ev) continue;   // ショウケースのほうを使った公演
    const name = get('表示名'), url = get('URL');
    const vid = videoId(url.replace(/^(?=(www\.)?youtu)/, 'https://'));
    if (kind === 'セットリスト') {
      const m = name.match(/^\s*(\d+(?:[-‐－]\d+)?)\s*[.、．)]\s*(.*)$/);
      const song = { n: m ? m[1].replace(/[‐－]/g, '-') : '', t: (m ? m[2] : name).trim(), s: [], m: [] };
      if (!song.t) continue;
      splitList(get('補足')).forEach(n => {
        const k = KEY_BY_NAME[nameKey(n)], u = unitByName[nameKey(n)];
        song.s.push(k || (u ? u.name : n));
        (k ? [k] : u ? u.members : []).forEach(x => { if (song.m.indexOf(x) === -1) song.m.push(x); });
      });
      song.m = sortMembers(song.m);
      if (vid) { song.v = vid; const at = timeParam(url); if (at) song.at = at; }
      (ev.sl = ev.sl || []).push(song);
    } else if (kind === '関連動画') {
      if (!vid) { rowIssue(key, rowNo, '関連動画の URL が YouTube の動画として読めません。この行は載せていません'); continue; }
      (ev.vids = ev.vids || []).push({ t: name, v: vid });
    } else if (kind === 'ライブレポート' || kind === '特集記事') {
      if (!/^https?:\/\//.test(url)) { rowIssue(key, rowNo, kind + 'の URL が読めません。この行は載せていません'); continue; }
      (ev.links = ev.links || []).push({ g: kind, t: name, u: url });
    } else if (kind === 'リリース') {
      if (!/^https?:\/\//.test(url)) continue;
      (ev.rel = ev.rel || []).push({ t: name, u: url });
    }
  }
}

// YouTube の URL の t=（何秒から）。「t=1918」「t=1918s」「t=1h2m3s」を秒にする。無ければ 0
function timeParam(url) {
  const m = String(url || '').match(/[?&#]t=([0-9hms]+)/);
  if (!m) return 0;
  if (/^\d+s?$/.test(m[1])) return parseInt(m[1], 10);
  const p = m[1].match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return p ? (+p[1] || 0) * 3600 + (+p[2] || 0) * 60 + (+p[3] || 0) : 0;
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
  /* ⚠️ コラボ相手（8人以外の一緒に出ている人）の名前は書き出さないこと（2026-10-29 持ち主の判断）。
        概要欄に書かれていない回もあり、正しく分かりきらないため。「ほかにも出ている人がいる」の印（x）だけ残す
        （ソロ・コラボの絞り込みと、組み合わせの「その人たちだけ」に使う） */
  const clean = v => {
    const o = Object.assign({}, v); delete o.src; delete o.row; delete o.ok;
    if (o.c) { if (o.c.length) o.x = 1; delete o.c; }
    return o;
  };
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
  write('videos/latest.json', vids.filter(v => !v.cl).slice(0, 60));
  write('videos/clips.json', vids.filter(v => v.cl));
  /* 月ごとの動画（カレンダーで使う）。
     ⚠️ カレンダーで全員ぶん（videos/all.json、圧縮後562KB）を読まないこと。8人に広げて重くなったため、
        表示している月と前後の月だけを読む（1か月ぶんは圧縮後10KB ほど） */
  const byMonth = {};
  vids.forEach(v => { (byMonth[v.d.slice(0, 7)] = byMonth[v.d.slice(0, 7)] || []).push(v); });
  Object.keys(byMonth).sort().forEach(ym => write('videos/month/' + ym + '.json', byMonth[ym]));
  // 組み合わせの数（メンバーのページで使う）。⚠️ ページを開くたびに全員ぶんを読んで数えないで済むよう、ここで先に数える
  write('combos.json', buildCombos(vids, data.songs));
  /* 同じゲームの配信（動画の詳細カードで使う）。ゲーム名 → その配信（動画の形のまま。新しい順）。
     ⚠️ 詳細カードを開くたびに全員ぶん（videos/all.json）を読まないで済むよう、対象のゲームの配信だけをここにまとめる */
  const games = {};
  vids.forEach(v => { if (v.gm) (games[v.gm] = games[v.gm] || []).push(v); });
  write('games.json', games);
  write('songs.json', data.songs);
  write('discography.json', data.discography);
  write('articles.json', data.articles);
  write('lives.json', data.lives);
  write('voices.json', data.voices);
  write('stats.json', data.stats);
  write('played-games.json', data.played);
  write('cache/hosts.json', fillGuestHosts.cache || {});
  write('cache/holodex-sho.json', fillShoStarts.cache || { fullAt: '', items: {} });
  write('cache/gone.json', dropGoneVideos.cache || { fullAt: '', ids: {} });
  write('cache/shorts.json', recheckShorts.cache || {});
  write('cache/thumbs.json', markSameThumbs.cache || {});

  const meta = {
    generatedAt: now,
    counts: data.counts,
    sameCollabGroups: data.groups,
    members: MEMBERS.map(m => ({ key: m.key, short: m.short, name: m.name, unit: m.unit, mark: m.mark, textLight: m.textLight, textDark: m.textDark, onMark: m.onMark })),
    units: UNITS,
    // 人ごとの動画の数（「メンバーを選ぶ」の画面に出す。MECHATU-NE と同じ見せ方）
    memberCounts: Object.fromEntries(MEMBERS.map(m => [m.key, vids.filter(v => v.m.indexOf(m.key) !== -1).length])),
    // 同じゲームの配信のゲーム名（gm → 日本語の名前。分かったものだけ。2026-10-30）。どのページでも読む meta に入れる（ゲーム名のためだけに別のファイルを読まないで済むように）
    gameNames: data.gameNames || {},
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

/* 組み合わせ（ペア28組と、ユニット：Oriens・Dytica・MECHATU-A）ごとの記録。メンバーのページの「組み合わせ」に出す。
   数え方はサイトで数えていたときと同じ（src/members-page.jsx から移した。2026-10-28）：
   - 一緒に出た回数：その人たちがそろって出ている回。同じ企画を別々の枠で配信したもの（p が同じ）は1回。配信予定（未来の日付）は数えない
   - うち、その人たちだけ：MECHATU-A のほかの人がいない回
   - 初めて・最近の共演は「配信」から選ぶ（動画まで含めると、どの組み合わせもデビューのティザー PV になったため）
   - その人たちだけで初めての配信は「ほかに誰もいない回」（コラボ相手も空）から選ぶ（3人の回がサシとして出たため）
   ⚠️ 同じ企画の代表の選び方を、サイトの groupSameCollab と同じにすること（組み合わせの人の枠を代表にする）。食い違うと、サイトの一覧と数が合わなくなる */
function buildCombos(vids, songs) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const keysAll = MEMBERS.map(m => m.key);
  const pick = v => (v ? { i: v.i, t: v.t, d: v.d } : null);
  const stats = (keys, name) => {
    const has = m => keys.every(k => m.indexOf(k) !== -1);
    const list = vids.filter(v => !v.cl && has(v.m) && v.d <= today);
    const groups = {};
    list.forEach(v => { if (v.p) (groups[v.p] = groups[v.p] || []).push(v); });
    const mains = [];
    const used = {};
    list.forEach(v => {
      if (!v.p) { mains.push(v); return; }
      if (used[v.p]) return;
      used[v.p] = true;
      const g = groups[v.p].slice().sort((a, b) => hostRank(a) - hostRank(b) || (b.l || 0) - (a.l || 0));
      mains.push(keys.map(k => g.find(x => x.h === k)).find(Boolean) || g[0]);
    });
    const byYear = {};
    mains.forEach(v => { byYear[v.d.slice(0, 4)] = (byYear[v.d.slice(0, 4)] || 0) + 1; });
    const lives = mains.filter(v => v.k === 'L');
    const from = lives.length ? lives : mains;
    const onlyLives = lives.filter(v => v.m.length === keys.length && !v.x);
    const out = {
      keys, count: mains.length, only: mains.filter(v => v.m.length === keys.length).length, byYear,
      first: pick(from[from.length - 1]), latest: pick(from[0]),               // データは新しい順
      firstOnly: pick(onlyLives[onlyLives.length - 1]),
      songs: songs.filter(x => has(x.m)).map(x => x.t),
    };
    if (name) out.name = name;
    return out;
  };
  const pairs = [];
  for (let a = 0; a < keysAll.length; a++) for (let b = a + 1; b < keysAll.length; b++) pairs.push(stats([keysAll[a], keysAll[b]]));
  const units = UNITS.map(u => stats(u.members, u.name)).concat([stats(keysAll, 'MECHATU-A')]);
  return { today, pairs, units };
}

// 実行のページの「Summary」に出す（GitHub Actions のときだけ）
function summary(status, meta) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = ['## データの書き出し', ''];
  if (!status.ok) lines.push('### ⛔ 止めました（公開していません。前のデータのままです）', '', ...status.errors.map(e => '- ' + e), '');
  if (meta) {
    lines.push('| | 件数 | 大きさ |', '|---|---|---|');
    const monthFiles = Object.keys(meta.files).filter(f => f.startsWith('videos/month/'));
    Object.keys(meta.files).filter(f => monthFiles.indexOf(f) === -1).forEach(f => lines.push('| ' + f + ' | | ' + Math.round(meta.files[f].bytes / 1024) + 'KB |'));
    if (monthFiles.length) lines.push('| videos/month/（' + monthFiles.length + 'か月ぶん） | | 合わせて ' + Math.round(monthFiles.reduce((n, f) => n + meta.files[f].bytes, 0) / 1024) + 'KB |');
    lines.push('', '動画 ' + meta.counts.videos + ' 件・楽曲 ' + meta.counts.songs + ' 件・ディスコグラフィ ' + meta.counts.discography + ' 件・記事 ' + meta.counts.articles + ' 件・同じ企画のまとまり ' + meta.sameCollabGroups + ' 組', '');
  }
  if (status.rows.length) {
    lines.push('### 外した行・直したい項目（' + status.rows.length + ' 件）', '', '| シート | 行 | 内容 |', '|---|---|---|');
    const SHEET = { dytica: 'Dytica', showcase: 'ショウケース', dyticaDisco: 'Dytica（ディスコグラフィ）', showcaseDisco: 'ショウケース（ディスコグラフィ）', dyticaArticles: 'Dytica（記事）', showcaseArticles: 'ショウケース（記事）', showcaseClips: 'ショウケース（切り抜き）' };
    status.rows.slice(0, 200).forEach(r => lines.push('| ' + (SHEET[r.source] || r.source) + ' | ' + r.row + ' | ' + r.message + ' |'));
    lines.push('');
  }
  if (status.warnings.length) lines.push('### 気になること（' + status.warnings.length + ' 件）', '', ...status.warnings.slice(0, 200).map(w => '- ' + w), '');
  if (status.notes.length) lines.push('### お知らせ', '', ...status.notes.map(w => '- ' + w), '');
  fs.appendFileSync(file, lines.join('\n') + '\n');
}

// ───────────────────────── 小さな道具 ─────────────────────────

// ⚠️ 「youtu.be//動画ID」（/ が2つ）も読むこと。ショウケースの「切り抜き」タブに、この形の URL がある（2026-10-28）
function videoId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/+)([A-Za-z0-9_-]{11})/);
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
