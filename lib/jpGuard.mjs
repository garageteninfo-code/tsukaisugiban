// 日本の個人情報・鍵の検出と伏せ字（改良版・2026-11-14）
// 元：以前の社内の試作の検出規則（多くはそのまま引き継いだ）。依存なし・AI を使わない。
// 直した所：
//   1. 当てる前に全角→半角などをそろえる（NFKC。1文字ずつそろえて、元の文の位置に戻せるようにする）
//   2. 数字の間の長音「ー」・いろいろなダッシュを「-」とみなす
//   3. マイナンバー：検査数字を確かめる。「マイナンバー・個人番号」の言葉が前にあるか、4-4-4 の区切りの時だけ
//   4. カード：Luhn に加えて、前に「カード」などの言葉があるか、4桁ずつ区切られ発行元の頭の番号に合う時だけ
//   5. 電話：かっこ・空白の区切り、ハイフンなしの固定電話（前に「電話」などの言葉がある時）。桁数（10 / 11桁）を確かめる
//   6. 住所（都道府県・市区町村＋番地）・氏名（欄の名前・様・と申します）・生年月日（欄の名前）を新しく見つける
//   7. 「パスワードは〜」「暗証番号は〜」の形
//   8. （11/14 夜）氏名：名字・名の辞書と前後の手がかり（findNames）。試験は 名前の試験.mjs（直す前の版は jpGuard_11-14版.mjs）
// 伏せ方：初めは鍵・カード・マイナンバーだけを伏せる。personal: true で電話・メール・住所・氏名・生年月日も伏せる。

// ---------- 1. そろえる（位置の対応つき） ----------
const DASHES = new Set(['-', '‐', '‑', '‒', '–', '—', '―', '−', '－', '﹣']);
export function normalizeWithMap(input) {
  const parts = [];
  let i = 0;
  for (const ch of input) {
    let n = ch.normalize('NFKC');
    if (DASHES.has(ch) || DASHES.has(n)) n = '-';
    parts.push({ t: n, start: i, end: i + ch.length });
    i += ch.length;
  }
  // 数字に挟まれた長音（ー・ｰ）は区切りの「-」
  for (let k = 0; k < parts.length; k++) {
    if (parts[k].t === 'ー' || parts[k].t === 'ｰ') {
      const prev = parts[k - 1]?.t ?? '';
      const next = parts[k + 1]?.t ?? '';
      if (/\d$/.test(prev) && /^\d/.test(next)) parts[k].t = '-';
    }
  }
  // 字の間の空白（手書きの OCR・字間あき）を詰める：漢字かなどうし・漢字かなと数字・数字と「-」の間だけ
  const CJK = /[一-龥々ぁ-んァ-ヶー]/, DIG = /\d/;
  const join = (a, b) => (CJK.test(a) && CJK.test(b)) || (CJK.test(a) && DIG.test(b)) || (DIG.test(a) && CJK.test(b)) || (a === '-' && DIG.test(b)) || (DIG.test(a) && b === '-');
  // 「福 岡 県」のように 1 字ずつ空いている所だけ（ふつうの「山田 太郎」の空白は残す）
  const isSp = (x) => parts[x]?.t === ' ';
  const drop = [];
  for (let k = 1; k < parts.length - 1; k++) {
    if (!isSp(k)) continue;
    const pa = parts[k - 1].t, pb = parts[k + 1].t;
    if (pa.length !== 1 || pb.length !== 1 || !join(pa, pb)) continue;
    if (isSp(k - 2) || isSp(k + 2)) drop.push(k);
  }
  for (const k of drop) parts[k].t = '';
  let text = '';
  const map = []; // 正規化後の 1 文字ごと → 元の [start, end)
  for (const p of parts) {
    for (let j = 0; j < p.t.length; j++) map.push(p);
    text += p.t;
  }
  return { text, map };
}

// ---------- 検査 ----------
function luhn(num) {
  const d = num.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let s = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let x = d.charCodeAt(i) - 48; if (alt) { x *= 2; if (x > 9) x -= 9; } s += x; alt = !alt; }
  return s % 10 === 0;
}
export function myNumberValid(num) {
  const d = num.replace(/\D/g, '');
  if (d.length !== 12) return false;
  let sum = 0;
  for (let n = 1; n <= 11; n++) { const p = d.charCodeAt(11 - n) - 48; sum += p * (n <= 6 ? n + 1 : n - 5); }
  const r = sum % 11;
  return (r <= 1 ? 0 : 11 - r) === d.charCodeAt(11) - 48;
}
function cardIssuerOk(d) {
  const n = d.length;
  if (/^4/.test(d)) return n === 13 || n === 16 || n === 19;           // Visa
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return n === 16; // Mastercard
  if (/^3[47]/.test(d)) return n === 15;                               // Amex
  if (/^35(2[89]|[3-8]\d)/.test(d)) return n >= 16 && n <= 19;         // JCB
  if (/^3(0[0-5]|[689])/.test(d)) return n >= 14 && n <= 19;           // Diners
  if (/^6(011|5)/.test(d)) return n >= 16 && n <= 19;                  // Discover
  return false;
}
function phoneDigitsOk(raw) {
  let d = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) { if (!d.startsWith('81')) return d.length >= 8 && d.length <= 15; d = '0' + d.slice(2); }
  if (!d.startsWith('0')) return false;
  if (/^0[5789]0/.test(d)) return d.length === 11;
  if (/^0(120|800)/.test(d)) return d.length === 10 || d.length === 11;
  return d.length === 10;
}

// ---------- 前の言葉（文脈） ----------
const before = (text, idx, n = 24) => text.slice(Math.max(0, idx - n), idx);
const CTX = {
  card: /(カード|クレジット|card|visa|master|amex|jcb|diners|discover|決済|ビザ|マスター|アメックス|アメリカン・?エキスプレス|ダイナース|ジェーシービー|ディスカバー)/i,
  myNumber: /(マイナンバー|個人番号|my[ _]?number|kojin ?bango)/i,
  phone: /(電話|でんわ|tel|携帯|fax|連絡先|番号は)/i,
};

// ---------- 規則 ----------
const PREF = '(?:北海道|東京都|京都府|大阪府|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)県)';
const PREF_RE = new RegExp(PREF);
const MUNI = '(?:[一-龥ぁ-んァ-ヶー]{1,6}?[市区町村郡]){1,3}';
const STREET = '[一-龥ぁ-んァ-ヶー]{0,10}?';
const KN = '[一二三四五六七八九十〇]';
const NUM = `(?:\\d{1,4}(?:丁目|番地|番|号|-)(?:\\d{1,4}(?:丁目|番地|番|号|-)?){0,3}|${KN}{1,3}丁目(?:(?:${KN}{1,4}|\\d{1,4})(?:番地|番|号)){0,2})`;
const NAME = '[一-龥々]{1,4}(?:[ ]?[一-龥々]{1,4}|[ ]?(?![はがのをにともへでやか])[ぁ-ん]{1,4})?';
const NAME_STOP0 = new Set(['担当', '担当者', '皆', '各位', 'お客', '客', '管理者', '管理人', '店長', '社長', '大家', '家主', '御中', '貴社', '弊社', '者', '業者', '大工', '職人', '店員', '運転手', '皆様', '奥', '旦那', '息子', '娘', '先方', '相手', '近所', '管理会社', '医者', '患者', '生徒', '社員', '先生', '欄']);
const GIVEN_BAD = /[区市町村郡駅店社署局館院課部線通方面側口前様]/;

// ---------- 氏名の辞書と前後の言葉（ダウンロードなし・一般的な知識から作った） ----------
// 名字（よくある物の上位から約1,000。地名・会社名と重なる物は、敬称などの強い手がかりがある時だけ使う）
const SURNAME_TXT = `佐藤 鈴木 高橋 田中 伊藤 渡辺 山本 中村 小林 加藤 吉田 山田 佐々木 山口 松本 井上 木村 林 斎藤 清水 山崎 森 池田 橋本 阿部 石川 山下 中島 石井 小川 前田 岡田 長谷川 藤田 後藤 近藤 村上 遠藤 青木 坂本 斉藤 福田 太田 西村 藤井 金子 岡本 藤原 中野 三浦 原田 中川 松田 竹内 小野 田村 中山 和田 石田 森田 上田 原 内田 柴田 酒井 宮崎 横山 高木 安藤 宮本 大野 小島 谷口 今井 工藤 高田 増田 丸山 杉山 村田 大塚 新井 小山 平野 藤本 河野 上野 野口 武田 松井 千葉 岩崎 菅原 木下 久保 佐野 野村 松尾 市川 菊地 杉本 古川 大西 島田 水野 桜井 高野 渡部 吉川 山内 西田 飯田 菊池 西川 小松 北村 安田 五十嵐 川口 平田 関 中田 久保田 服部 東 岩田 土屋 川崎 福島 本田 辻 樋口 秋山 田口 永井 山中 中西 吉村 川上 石原 大橋 馬場 浅野 荒木 大久保 野田 小沢 田辺 川村 星野 黒田 堀 尾崎 望月 永田 熊谷 内藤 松村 西山 大谷 平井 大島 岩本 片山 本間 早川 横田 岡崎 荒井 大石 鎌田 成田 宮田 小田 石橋 篠原 須藤 河合 大川 高井 岡部 川端 高梨 松下 北川 吉岡 小池 山根 宮下 坂井 小西 足立 浜田 上原 西 桑原 堤 宇野 植田 田島 飯塚 竹田 津田 奥村 内山 大森 稲葉 水谷
吉野 原口 森本 小谷 青山 南 松浦 奥田 久野 白井 宮川 岩井 福井 小倉 中尾 浅井 大山 大竹 富田 小原 宮内 松原 上村 西尾 中谷 福本 長尾 竹中 北野 若林 安達 細川 根本 堀田 永野 河村 荒川 竹下 堀内 萩原 遠山 今村 松永 宮原 福岡 山岸 小森 平山 塚本 本多 寺田 大槻 小室 森川 中井 石塚 三宅 島崎 平川 沢田 藤川 黒川 杉浦 新田 堀口 栗原 石黒 寺島 佐久間 野崎 高山 大倉 片岡 桑田 野中 西岡 牧野 森下 小泉 上杉 加納 江口 岩瀬 広瀬 福永 川島 長田 中澤 中沢 吉原 大沢 浜野 戸田 木内 大場 谷川 川野 伊東 田代 大村 長島 高村 中嶋 前川 松山 小坂 宮沢 宮澤 金井 松島 神田 金田 福原 安部 矢野 関口 古賀 星 坂口 堀江 白石 三上 吉永 深沢 深澤 根岸 小暮 久我 宮脇 榎本 村井 菅野 浅田 青柳 志村 坂田 秋元 江藤 鶴田 寺尾 大和田 豊田 岸本 田上 岸 熊田 福地 本山 岡野 大前 筒井 米田 柳田 柳沢 楠 岡島 森岡 芳賀 和泉 山岡 奥山 中原 大木 宮地 石山 武藤 武井 植松 浅見 小幡 須田 小田切 近江 飯島 渋谷 上条 栗田 西野 西本 渡邊 渡邉 齋藤 齊藤 髙橋 吉澤 吉沢 小野寺 坂下 嶋田 浅川 高瀬 立花 野上 北島 中林 堀川 牧 新谷 大原 竹本 小田島 長沢 長澤 宇佐美 長谷部 阿久津 小笠原 波多野 宇都宮 東海林 伊集院 勅使河原 一ノ瀬 一之瀬 佐伯 冨田 富岡 田端 広田 廣田 広川 広野 庄司 東條 西島 南部 北原 北沢 北澤 大串 江川 江原 尾形 緒方 尾上 尾関 小関 大関 関根 関谷
新垣 比嘉 金城 大城 宮城 玉城 仲宗根 島袋 知念 照屋 喜屋武 平良 具志堅 当山 宮里 赤嶺 渡嘉敷 安里 新城 屋良 我那覇 下地 砂川 城間 外間 伊波 嘉数 仲間 上地 国吉 又吉 山城 安谷屋 宮平
相沢 相澤 青野 赤松 赤坂 秋葉 浅沼 朝倉 天野 有馬 有田 安西 飯野 井口 池上 池谷 生田 石垣 石丸 石崎 石松 泉 磯部 板倉 市村 市原 一色 井出 稲垣 稲田 犬飼 井原 今泉 今田 入江 岩上 岩下 岩永 岩村 岩谷 上島 上山 植木 臼井 内野 梅田 梅原 梅本 梅津 浦田 江崎 江本 及川 大井 大内 大河内 大越 大坂 大崎 大澤 大下 大田 大津 大坪 大貫 大庭 大畑 大平 大宮 大屋 大矢 大和 岡 岡村 岡安 荻野 奥 奥井 奥平 小黒 小此木 押田 小田原 落合 小野田 小俣 小山内 恩田 甲斐 柿沼 角田 笠原 梶 梶原 梶田 柏木 春日 片桐 片野 勝又 勝田 桂 門脇 金丸 金沢 金山 兼子 鎌倉 上川 神谷 亀井 亀田 唐沢 川合 川内 川田 河田 川西 河西 川原 河原 川本 河本 神崎 菅 菅田 菊川 岸田 北岡 北山 木戸 木原 京極 清田 桐山 草野 楠本 国井 熊沢 倉田 栗山 黒岩 黒木 黒沢 黒須 小出 小嶋 駒井 小柳 今野 紺野 西條 西城 三枝 坂上 坂元 坂野 相良 桜田 笹井 笹川 笹本 佐竹 佐田 里見 真田 沢井 沢村 塩田 塩谷 塩野 志賀 重松 宍戸 品田 篠田 篠崎 柴崎 柴山 島 島村 下田 下村 下山 白川 白鳥 末永 菅沼 菅谷 杉田 杉野 杉原 鈴村 須永 角 瀬川 関野 瀬戸 千田 相馬 曽我 曽根 園田 平 高岡 高垣 高城 高崎 高沢 高須 高月 高畑 高松 高見 高宮 高安 滝口 滝沢 滝本 竹井 竹村 武内 竹谷 田崎 田沢 但馬 立石 立川 立野 田所 谷 谷本 谷田 田畑 玉井 田丸 田宮 樽井 塚田 塚原 津川 月岡 辻本 土田 土井 常盤 坪井 津村 鶴見 出口 寺井 寺本 土肥 東郷 時田 徳田 徳永 戸塚 富永 友田 豊島 鳥居 中居 長井 長岡 中岡 長沼 中根 中畑 中浜 中平 中丸 中道 中本 中森 中矢 永山 長山 名取 鍋島 並木 成瀬 南条 新居 西沢 西谷 西原 西脇 二宮 丹羽 沼田 根津 野沢 野島 野々村 野本 萩野 橋口 橋爪 長谷 畑 畠山 畑中 八田 花田 羽田 浜口 浜崎 浜本 早坂 林田 春山 半田 坂東 東山 日高 日野 平岡 平松 平林 広岡 深井 深田 福山 藤岡 藤崎 藤沢 藤島 藤野 藤村 藤森 藤山 二見 船橋 古田 古谷 古屋 星川 細田 細谷 堀井 堀尾 本郷 本庄 前原 牧田 正木 増井 増山 松川 松崎 松沢 松谷 松野 松葉 松宮 松元 丸田 丸谷 三木 三島 水口 水沢 水上 溝口 三田 三谷 光井 皆川 南野 峰 箕輪 宮井 宮坂 宮島 宮野 三好 向井 村松 村山 室井 茂木 本村 本橋 森井 森口 森島 森谷 森永 森山 諸橋 八木 矢口 安井 安川 柳 柳井 柳原 矢部 山上 山川 山木 山際 山越 山路 山添 山名 山野 山村 山元 湯浅 湯川 横井 横内 横尾 横川 横溝 吉井 吉崎 吉住 吉成 吉松 米山 米倉 若松 若山 脇田 鷲尾 渡会
阿南 青井 赤井 赤木 赤羽 秋田 秋本 秋吉 浅岡 浅香 浅倉 芦田 東野 麻生 安部 天田 雨宮 荒谷 有賀 有村 粟野 安斎 安東 飯沼 飯村 五十嵐 生駒 池内 池永 池野 石岡 石神 石倉 石坂 石森 和泉 磯貝 磯野 板垣 板谷 市田 井戸 伊東 糸井 稲村 稲本 乾 井野 猪俣 今川 今西 今宮 入山 岩城 岩佐 岩切 岩倉 岩坂 岩淵 岩見 上岡 上坂 上西 植村 牛島 牛山 内海 内川 宇田 宇田川 梅沢 浦野 浦上 江上 江尻 江島 海老原 遠田 大木 大串 大熊 大河原 大杉 大高 大滝 大友 大坊 大政 大道 大室 大元 大柳 大和田 岡林 岡山 小方 尾形 沖 沖田 荻原 奥野 小椋 小倉 尾崎 長船 押切 尾島 小田嶋 小野塚 小畑 小浜 小原 尾身 折原 甲斐 加賀 加賀谷 香川 角谷 影山 笠井 笠松 梶谷 梶山 柏原 加瀬 片平 片山 勝山 加藤 門田 金谷 金沢 金光 狩野 加納 鎌田 上林 神山 亀山 茅野 唐木 河上 川越 川瀬 川畑 川辺 川俣 神田 菊田 木越 岸川 北口 北田 北浜 吉川 木戸 木野 木俣 木本 清原 金原 日下 日下部 草間 串田 楠田 久住 工藤 国分 国本 久保木 熊井 熊倉 倉本 栗林 栗本 黒崎 黒田 桑名 桑野 郡司 小泉 小金井 古賀 小坂 越川 小柴 児玉 小玉 後藤田 小西 小橋 小葉 小早川 小堀 駒田 小松原 小宮 小宮山 小森 小谷野 是枝 近藤 権藤 斎田 齊木 才田 佐伯 酒巻 坂巻 坂本 佐川 佐久本 桜木 迫 笹岡 笹木 笹田 佐々 指田 佐藤 真田 鮫島 沢口 沢辺 塩崎 塩見 重田 宍倉 品川 篠崎 芝 柴崎 渋川 島内 島津 清水谷 下川 下野 首藤 白鳥 新谷 新開 新藤 進藤 新保 菅井 菅原 杉江 杉崎 杉森 鈴江 須藤 砂田 角田 諏訪 瀬尾 瀬下 関本 妹尾 仙波 曽田 反町 大門 高石 高木 高久 高倉 高坂 高沢 高島 高嶋 高杉 高津 高友 高梨 高根 高橋 高浜 高原 高平 高藤 高見沢 高谷 宝田 滝 田口 竹島 武石 竹之内 竹森 竹山 田子 田沢 多田 立川 辰巳 伊達 田中 田部 田原 玉置 玉木 田村 丹野 千野 茶谷 塚越 津島 辻井 辻村 土橋 筒井 堤 綱島 恒川 角野 坪田 鶴岡 手塚 寺崎 寺西 土居 堂本 戸川 徳山 所 戸部 苫米地 富樫 友部 豊原 鳥海 内藤 直井 中江 中川 永島 中條 中津 永沼 中野 中間 長嶺 中村 永森 中谷 名倉 那須 夏目 七尾 鍋田 生田 並河 成沢 新山 西浦 西垣 西崎 西出 西森 西脇 仁科 二瓶 丹生 布川 根来 根本 野川 野原 延原 野見山 萩尾 箱崎 橋場 長谷部 畑山 蜂谷 服部 鳩山 花岡 花井 塙 羽生 浜中 早瀬 林原 原島 春田 坂野 比留間 樋渡 平賀 平沢 平塚 平尾 平賀 広中 深川 深見 吹田 福沢 福地 福見 藤 藤枝 藤代 藤平 藤巻 藤原 舟橋 舟山 古沢 古橋 古畑 別所 北條 北条 保坂 星 細井 細野 堀越 堀之内 本庄 前島 前野 真壁 牧 牧原 正岡 増渕 町田 松浦 松坂 松嶋 松平 松林 間宮 丸岡 丸尾 万代 三上 三沢 水島 水田 溝渕 三橋 三船 宮城 宮越 三宅 宮崎 宮前 宮森 宮良 三輪 向田 村岡 村瀬 村野 目黒 茂田 望月 元木 本島 籾山 百瀬 森崎 森重 守屋 八代 矢島 安原 柳川 矢吹 山岸 山県 山際 山口 山崎 山澤 山沢 山科 山尾 山浦 山影 山谷 山端 結城 湯本 横沢 横堀 吉井 吉沢 吉武 吉弘 吉丸 米沢 米津 米原 若井 若月 若菜 和気 鷲見 渡瀬 和田 藁科`;
const SURNAME_SET = new Set(SURNAME_TXT.split(/\s+/).filter(Boolean));
// 地名・駅名・会社名と重なる名字：敬称・と申します・欄などの強い手がかりがある時だけ氏名とみなす
const PLACE_SURNAME = new Set(('千葉 福島 宮崎 石川 山口 長野 福井 秋田 岡山 長崎 新潟 富山 広島 徳島 香川 高知 佐賀 大分 鹿児島 栃木 群馬 静岡 岐阜 三重 滋賀 鳥取 島根 青森 岩手 宮城 山梨 山形 熊本 ' +
  '中野 渋谷 上野 品川 目黒 板橋 高田 神田 青山 赤坂 平塚 鎌倉 小田原 川口 市川 成田 宇都宮 金沢 福岡 豊田 岡崎 大津 草津 吹田 八尾 明石 宝塚 梅田 大宮 町田 立川 船橋 藤沢 川崎 東山 北山 堺 難波 本田 三井 森永 豊島 春日 大和 日野 三田 江川 早稲田 飯田橋 荻窪 中目黒').split(' '));
// ふつうの言葉でもある名字（林・森・原・平野・小川など）：同じく強い手がかりがある時だけ
const COMMON_SURNAME = new Set('平野 小川 大橋 小島 小山 小池 大木 高木 青木 大石 石原 野原 中原 宮下 森下 松原 大森 中島 高山 大川 大野 大島 上原 高原 松林 大沢 小沢 中沢 大谷 長田 金子 西山 北川 岩本 堀江 角田 新田 大前 中間 所 迫 沖 乾 芝 塙 滝 島 谷 岡 牧 星 峰 泉 堤 平 東 西 南 林 森 原 関 堀 辻 岸 菅 楠 柳 畑 桂 梶 角 奥 藤'.split(' '));
// 名（漢字）
const GIVEN_KANJI = new Set(`太郎 次郎 三郎 一郎 健太 翔太 大輔 拓也 直樹 和也 達也 健一 浩二 誠 修 隆 浩 博 茂 実 勇 豊 剛 進 学 稔 亮 翔 蓮 悠真 陽翔 湊 大翔 悠斗 樹 陸 颯太 蒼 律 朝陽 結翔 陽太 悠人 翼 大樹 拓海 海斗 優斗 健 康介 雄一 雄太 雅人 正人 和人 直人 優太 誠一 光 聡 智 哲也 隆之 博之 秀樹 英樹 浩一 健二 恭平 恭介 亮介 大介 圭介 洋介 俊介 祐介 雄介 龍之介 竜也 翔平 航平 拓真 悠 匠 慎也 慎吾 信也 伸也 一樹 和樹 裕樹 雄大 将太 太一 大地 大貴 智也 友也 祐太 裕太 啓太 慶太 康太 浩太 颯 颯真 蒼真 湊斗 陽向 奏太 晴 晴人 斗真 琉生 碧 新 隼人 勇気 勇人 尚樹 直哉 卓也 拓哉 翔也 純一 淳 潤 敦 篤 健司 健次 賢治 賢一 憲一 正和 正樹 正彦 雅彦 和彦 信彦 晴彦 光男 幸男 秀夫 和夫 正夫 敏夫 義男 武 清 勝 昇 弘 宏 広 洋 徹 敏 明 昭 栄一 栄治 英二 修一 修二 和男 一男 文雄 正雄 秀雄 健吾 圭吾 大吾 省吾 亮太 涼太 陽介 啓介 真一 真司 慎一 伸一 晋也 亮 大和 悠太 蒼空 陽斗 律希 樹生 智史 達郎 哲郎 孝 孝之 孝明 貴之 貴志 俊 俊之 俊彦 和弘 和宏 雅之 雅樹 雅弘 正之 良太 良介 良一 恵一 忠 忠司 勲 功 実 剛志 大志 拓 将 拓人 優 優人 陽 陽一 陽平 遼 遼太 遼平 凌 琉 碧斗 湊人 律 楓太 伊織 千尋
花子 恵子 美咲 陽菜 結衣 美穂 由美子 真由美 里美 早苗 律子 香織 千代子 智子 洋子 京子 幸子 和子 久美子 裕子 直子 明美 由美 恵 愛 優子 美香 美紀 美樹 真美 麻美 亜美 彩 彩花 彩香 綾 綾香 舞 麻衣 結菜 結愛 陽葵 凛 杏 葵 芽依 莉子 心春 紬 澪 咲良 美桜 莉愛 結月 心愛 陽子 春香 遥 遥香 千夏 夏美 奈々 菜々子 奈緒 七海 美月 美羽 美結 優奈 優花 由佳 由香 由紀 有紀 友美 知美 智美 朋美 恵美 絵美 理恵 理沙 梨沙 沙織 沙耶 紗希 早紀 咲 咲希 未来 愛子 愛美 杏奈 杏子 桃子 菜穂 美奈子 加奈子 佳子 典子 紀子 順子 純子 淳子 節子 悦子 文子 信子 敏子 光子 道子 美智子 由紀子 真理子 万里子 佐知子 正子 秀子 弘子 博子 礼子 玲子 麗子 静香 君子 清子 晴美 明子 葉子 心 結 楓 椿 柚希 柚葉 琴音 花音 和花 芽衣 琴葉 美空 紗良 詩織 栞 さやか 真央 真奈 真子 麻由 麻里 舞子 美和 美保 美代子 光代 春子 秋子 冬美 夏子 雪 雪子 小百合 百合 百合子 明日香 茜 薫 瞳 渚 萌 萌香 桜 桜子 寧々 乃愛 結子 結花 彩乃 彩奈 美優 美玲 莉奈 莉央 里奈 里菜 玲奈 怜奈 菜月 奈央 千晴 千里 美里 美雪 真紀 真希 亜希子 亜紀 早希 沙也加 優衣 唯 唯花 依子 尚子 康子 靖子 恭子 啓子 慶子 圭子 敬子 景子 恵理 絵里 江里子 栄子 英子 映子`.split(/\s+/));
// 名（かな。ひらがなで持ち、カタカナも同じに扱う）
const GIVEN_KANA_H = `さくら ひなた ゆい あやか しおり みゆき まなみ ゆうと たけし はると ゆうき あおい ひかり ほのか まお みお りお かえで こはる ひまり めい ゆな あかり あやね えみ かな かおり かずき けんた こうた こうき しょうた そうた たくや たろう だいすけ なおき はなこ ひろし ひろみ まさと まさし みき みさき みほ ももか ゆか ゆり ゆみ りな りこ れん れいな わかな あきら あゆみ いちろう えり かずや けいこ けんじ こうじ さとし さやか しんじ すずか ちひろ つばさ なつみ のぞみ はるか ひでき まい まりこ みどり みのり ももこ やすこ ゆうこ ようこ りょう りょうた あすか あんな いずみ えみり かんな きよし けい こころ さき しゅん じゅん すみれ せな そら ちか ともや なな のあ はな ひとみ ふみ まこと まゆ みく みつき めぐみ ゆずき よしこ りん るな あい あき あや なお ゆき ゆう ちえ りさ かほ さな ゆめ はるき はるな ひろと ひなの ひより みつる やまと ゆいな りく そうま あやの ちなつ ななみ はづき ふうか まどか みなみ もえ ゆいか りほ れお あさひ いつき かいと けいた しょう そうすけ たいち たかし つよし とおる なおと ひろき まさる みのる ゆうた ゆうすけ ようへい りゅうせい ジョン マイケル デビッド ジェームズ ロバート ウィリアム トーマス マリア アンナ エミリー サラ ソフィア ジェシカ リサ ケビン ダニエル アレックス クリス ポール ピーター マーク ルーカス エマ オリビア ミア ノア リアム ハンナ`.split(/\s+/);
// 名字（かな）
const SURNAME_KANA_H = `さとう すずき たかはし たなか いとう わたなべ やまもと なかむら こばやし かとう よしだ やまだ ささき やまぐち まつもと いのうえ きむら はやし さいとう しみず やまざき いけだ はしもと いしかわ やました なかじま いしい おがわ まえだ おかだ はせがわ ふじた ごとう こんどう むらかみ えんどう あおき さかもと ふくだ おおた にしむら ふじい かねこ おかもと ふじわら なかの みうら はらだ なかがわ まつだ たけうち たむら なかやま いしだ もりた うえだ うちだ しばた さかい みやざき よこやま たかぎ あんどう みやもと おおの こじま たにぐち いまい くどう たかだ ますだ まるやま すぎやま むらた おおつか こやま ひらの ふじもと こうの うえの のぐち たけだ まつい いわさき すがわら きのした さの のむら まつお いちかわ きくち すぎもと ふるかわ おおにし しまだ みずの さくらい たかの わたべ よしかわ やまうち にしだ にしかわ こまつ きたむら やすだ いがらし かわぐち ひらた なかた くぼた はっとり いわた つちや かわさき ふくしま ほんだ ひぐち あきやま たぐち やまなか なかにし よしむら かわかみ いしはら おおはし まつおか あさの あらき おおくぼ おざわ たなべ かわむら ほしの くろだ おざき もちづき ながた くまがい まつむら にしやま おおたに ひらい おおしま いわもと かたやま ほんま はやかわ よこた おかざき おおいし かまた なりた みやた いしばし しのはら すどう おおかわ おかべ かわばた たかなし まつした きたがわ よしおか こいけ やまね みやした こにし あだち はまだ うえはら くわはら たじま いいづか つだ おくむら うちやま おおもり いなば みずたに きんじょう おおしろ みやぎ たましろ しまぶくろ ちねん てるや キム イ パク チェ チョン リー ワン チャン チェン リン グエン トラン ファム ホアン スミス ジョンソン ブラウン ウィリアムズ ガルシア マルティネス ロペス ゴンザレス シルバ サントス`.split(/\s+/);
const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const GIVEN_KANA = new Set(GIVEN_KANA_H.flatMap((w) => [w, toKata(w)]));
const SURNAME_KANA = new Set(SURNAME_KANA_H.flatMap((w) => [w, toKata(w)]));
// 普通の言葉と同じ形のかなの名（「です」だけでは名前とみなさない）
const KANA_AMBIG = new Set('ひかり みどり そら はな ゆめ こころ あい ゆき なな あん うた まい けい じゅん ゆう りん めい さき すみれ かな れん あや なお ふみ いずみ のぞみ つばさ はる あき まこと ひとみ めぐみ しょう みなみ もえ まどか ちか'.split(' ').flatMap((w) => [w, toKata(w)]));
// 名の終わりによく来る字（辞書に無い名を、名字の後ろで受け入れる時の手がかり）
const GIVEN_END = new Set([...'子美恵香奈菜乃枝穂沙紗那衣未優結愛彩羽陽蓮悠輝亮誠浩健博隆茂勇豊剛稔太郎介輔樹斗翔也哉平吾雄夫男彦司一二三治次志史弘宏広洋徹聡智哲敏伸晃彰昭秀英栄咲絵莉璃瑠凛杏梨桜萌瞳薫翼颯蒼湊晴朗達篤淳純潤匠登臣久弥寿泰靖恭圭啓慶慧華花江緒里希真明和正進修葉']);
// 名の終わりの字を持つが、名ではない言葉
const GIVEN_STOP = new Set(('様子 調子 菓子 帽子 椅子 扇子 障子 双子 弟子 女子 男子 王子 原子 粒子 電子 硝子 息子 拍子 紹介 介護 仲介 厄介 工夫 丈夫 長男 次男 三男 上司 寿司 政治 退治 意志 歴史 説明 証明 不明 透明 平和 昭和 調和 修正 改正 訂正 進学 入学 通学 留学 野菜 生花 造花 中華 豪華 一緒 内緒 写真 女優 俳優 言葉 紅葉 研修 監修 改修 必修 前進 推進 昇進 健康 世紀 規則 原則 特典 辞典 尊敬 観光 日光 文章 優秀 通信 返信 主人 本人 友人 知人 他人 恋人 婦人 成人 個人 大人 老人 職人 住人 犯人 証人 未来 将来 家族 親子 母子 父子 妻子 夫婦 ' +
  '会社 学校 部屋 実家 職場 名前 年齢 仕事 体調 病気 病院 誕生日 手術 入院 退院 葬儀 携帯 電話 住所 同意 署名 印鑑 代理 代わり 友達 同僚 部下 先生 担任 主治医 担当 世話 都合 予定 意見 希望 要望 判断 確認 連絡 相談 送迎 迎え 面会 実印 口座 名義 車 家 店 方 件').split(' '));
const GIVEN_BAD_END = /[駅線店屋家堂館園院寺社宮城橋町市区村郡県府道通丁番号階室棟部課係局署所場港池湖岬浜坂台丘業産品工建設薬食電機器物商事銀行校方面側口前後内外上下東西南北様殿者員長会団協組党省庁]$/;
// 敬称のように見えて、名前ではない物
const HONOR_STOP = new Set(('担当 担当者 皆 各位 お客 客 管理者 管理人 店長 社長 大家 家主 御中 貴社 弊社 者 業者 大工 職人 店員 運転手 皆様 奥 旦那 息子 娘 先方 相手 近所 管理会社 医者 歯医者 患者 生徒 社員 先生 欄 母 父 兄 姉 弟 妹 祖母 祖父 叔母 叔父 伯母 伯父 孫 嫁 婿 主人 名 両名 各 一同 神 仏 王 姫 若 坊 隣 庭師 配達員 職員 看護師 保育士 隊員 学生 新人 先輩 後輩 同僚 上司 部下 友達 友人 知人 彼 彼女 方 地主 乗客 嬢 お嬢 坊ちゃん 赤 赤ちゃん 女将 板前 料理人 会員 利用者 入居者 契約者 皆さん 業者さん 大家さん 店主 家族 親御 保護者 子ども 子供 お子 本人 当人 先代 若旦那 女房 亭主 殿様 皇').split(' '));
// カタカナの言葉＋さん（職業・会社など。名前ではない）
const KATA_STOP = new Set(('オーナー スタッフ マネージャー ドライバー ママ パパ ベビー ネコ ワン クマ ウサギ ゲスト メンバー ユーザー ファン ホスト ナース ドクター コーチ キャスト サンタ パート バイト アルバイト リーダー チーフ マスター ボス シェフ ガイド エンジニア デザイナー カメラマン ヘルパー ケアマネ ヤマト サガワ アマゾン メルカリ ニトリ ユニクロ ドコモ ラクテン グーグル アップル セブン ローソン ファミマ イオン カスタマー サポート オペレーター ホテル バス タクシー ミナ ミナサン オバ オジ オバア オジイ オネエ オニイ オカア オトウ ネエ ニイ バア ジイ カア トウ').split(' '));
// ひらがな＋ちゃん・くん で、名前ではない物
const HIRA_CHAN_STOP = new Set('あか わん ねこ いぬ おばあ おじい おにい おねえ ばあ じい にい ねえ みな おかあ おとう かあ とう うさ くま おばちゃ おじちゃ あんぱん おひめ ひめ ぼう おぼっ ぼっ おじょう じょう'.split(' '));
const ENG_STOP = new Set('Station Tower Building Hotel Park University College School City Bank Airport Street Road Avenue Center Centre Mall Hospital Line Clinic Shop Store Restaurant Cafe Group Holdings Children Customer Customers Sir Madam Team All Valued Friend Friends Colleague Colleagues Client Member Members Guest Owner Manager Support Applicant Tenant Resident Neighbor Bean President Director The A An Japanese American Sorry Happy Not Here Glad Looking Interested Writing Very So Just Also Still Your My Our Their Sales Service Office Department Inc Ltd Co Company Corporation Staff Admin User Users Hello Hi Thanks Thank Yes No Ok OK Please'.split(' '));
const CN_SURNAME = '(?:欧阳|歐陽|司马|司馬|诸葛|諸葛|上官|王|李|张|張|刘|劉|陈|陳|杨|楊|黄|黃|赵|趙|吴|吳|周|徐|孙|孫|马|馬|朱|胡|郭|何|高|林|罗|羅|郑|鄭|梁|谢|謝|宋|唐|许|許|韩|韓|冯|馮|邓|鄧|曹|彭|曾|肖|田|董|袁|潘|于|蒋|蔣|蔡|余|杜|叶|葉|程|苏|蘇|魏|吕|呂|丁|任|沈|姚|卢|盧|姜|崔|钟|鍾|谭|譚|陆|陸|汪|范|金|石|廖|贾|賈|夏|韦|韋|付|方|白|邹|鄒|孟|熊|秦|邱|江|尹|薛|闫|段|雷|侯|龙|龍|史|陶|黎|贺|賀|顾|顧|毛|郝|龚|龔|邵|万|萬|钱|錢|严|嚴|覃|武|戴|莫|孔|向|汤|湯|黃)';
const FIELD_STOP = new Set(('電話 住所 メール 年齢 性別 生年月日 連絡先 備考 職業 番号 欄 必須 任意 記入 未記入 不明 なし 無し 未定 同上 漢字 カナ フリガナ ふりがな 様 殿 各位 者 会社 法人 個人 本人 私 わたし 僕 自分 同じ 別 ご本人 わかりません 分かりません しりません ふめい ひみつ 秘密 空欄 特になし 未入力 確認中 後日 本名 名字 苗字 下の名前 フルネーム 氏名 名前 お名前').split(' ').concat([...HONOR_STOP]));
const REL_WORDS = '(?:母|父|妻|夫|主人|息子|娘|長男|次男|三男|長女|次女|三女|兄|姉|弟|妹|祖母|祖父|叔父|叔母|伯父|伯母|孫|義父|義母|家内|嫁|婿)';

const isKanji = (c) => !!c && /[一-龥々]/.test(c);
const isHira = (c) => !!c && /[ぁ-ゖ]/.test(c);
const isKata = (c) => !!c && /[ァ-ヶー]/.test(c);
const sameScript = (a, b) => (isHira(a) && isHira(b)) || (isKata(a) && isKata(b));
const PARTICLE_CH = new Set([...'はがのをにともへでやか']);
// 文の頭か（前が 行頭・句読点・空白・かぎかっこ など）
const atSentenceStart = (text, i) => { const p = text[i - 1]; return i === 0 || /[\n。．！？!?、,:「『(\s]/.test(p); };

// 名前のすぐ後ろの言葉の種類
function ctxAfter(text, k) {
  if (text[k] === ' ' && (!isKanji(text[k + 1]) || /^ (?:様|殿|氏|先生)/.test(text.slice(k)))) k++;
  const r = text.slice(k, k + 14);
  if (/^(?:さん|さま|様|ちゃん|くん|君|殿|氏(?!名)|先生|先輩|社長|部長|課長|係長|店長|主任|所長|院長|会長|専務|常務|支店長|監督|教授|宛て?|あて)/.test(r)) return 'honor';
  if (/^(?:と申し|と言い|といい|って言い|っていい|と申す|と名乗)/.test(r)) return 'self';
  if (/^(?:です|でございます)/.test(r)) return 'desu';
  if (/^(?:より|拝)(?=$|\n|[。.!！、,\s])/.test(r)) return 'sign';
  if (/^\(/.test(r)) return 'paren';
  if (/^(?:が|は|に|と|も|を|へ|や|から|、|,|の(?=(?:母|父|妻|夫|息子|娘|兄|姉|弟|妹|祖母|祖父|家族|代理|件|名義|口座|印鑑|保護者|親|子ども|お子|担当|方|ほう)))/.test(r)) return 'particle';
  if (/^(?:$|\n)/.test(r)) return 'eol';
  return null;
}
const givenOk = (g) => GIVEN_KANJI.has(g) || (g.length >= 2 && GIVEN_END.has(g.at(-1)) && !GIVEN_STOP.has(g) && !GIVEN_STOP.has(g.slice(-2)));
const givenBad = (g) => GIVEN_BAD_END.test(g) || GIVEN_STOP.has(g) || HONOR_STOP.has(g);

// 漢字の名字（辞書）から始まる氏名
function scanKanjiNames(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (!isKanji(text[i]) || isKanji(text[i - 1])) continue;
    let L = 0;
    for (let l = 4; l >= 1; l--) if (SURNAME_SET.has(text.substr(i, l))) { L = l; break; }
    if (!L) continue;
    const sur = text.substr(i, L);
    const weakSur = PLACE_SURNAME.has(sur) || COMMON_SURNAME.has(sur) || L === 1;
    const j = i + L;
    let best = -1;
    // 1) 名字だけ
    const honorNext = /^(?:先生|先輩|社長|部長|課長|係長|店長|主任|所長|院長|会長|専務|常務|支店長|監督|教授|殿|様|君|氏(?!名))/.test(text.slice(j));
    if (!isKanji(text[j]) || honorNext) {
      const c = ctxAfter(text, j);
      const ok = !(L === 1 && HONOR_STOP.has(sur)) && (c === 'honor' || c === 'self'
        || (c === 'desu' && (!weakSur || atSentenceStart(text, i))))
        || ((c === 'sign' || c === 'paren' || c === 'particle') && !weakSur && !HONOR_STOP.has(sur));
      if (ok) best = j;
    }
    // 2) 名字＋漢字の名（間に空白1つまで）
    let g0 = j; if (text[g0] === ' ') g0++;
    if (!honorNext && isKanji(text[g0])) {
      let e = g0; while (isKanji(text[e]) && e - g0 < 5) e++;
      const run = text.slice(g0, e);
      if (run.length <= 3 && !givenBad(run)) {
        const c = ctxAfter(text, e), good = givenOk(run);
        const ok = c === 'honor' || c === 'self' || c === 'desu' || c === 'paren' || ((c === 'particle' || c === 'sign' || c === 'eol') && good);
        if (ok && (good || !weakSur)) best = Math.max(best, e);
      }
    }
    // 3) 名字＋かなの名（辞書）
    if (isHira(text[g0]) || isKata(text[g0])) {
      for (let l = 6; l >= 2; l--) {
        const w = text.substr(g0, l);
        if (!GIVEN_KANA.has(w)) continue;
        if (ctxAfter(text, g0 + l)) { best = Math.max(best, g0 + l); break; }
      }
    }
    if (best > 0) out.push([i, best, sur]);
  }
  // 名字の並び（「中山、石井、藤原の3名」）：前の名前のすぐ後ろの「、・と」に続く辞書の名字
  const ends = new Set(out.map(([, b]) => b));
  for (let i = 1; i < text.length; i++) {
    if (!/[、,・と]/.test(text[i - 1]) || !ends.has(i - 1) || isKanji(text[i - 1])) continue;
    for (let l = 4; l >= 2; l--) {
      const w = text.substr(i, l);
      if (SURNAME_SET.has(w) && !isKanji(text[i + l]) && !out.some(([a]) => a === i)) { out.push([i, i + l, w]); ends.add(i + l); break; }
    }
  }
  // 並びが全部地名なら外す（「石川と福井」）
  return out.filter(([a, b, s], k, arr) => {
    if (!PLACE_SURNAME.has(s)) return true;
    const c = ctxAfter(text, b);
    return c === 'honor' || c === 'self' || (c === 'desu' && atSentenceStart(text, a)) || b - a > s.length;
  }).map(([a, b]) => [a, b]);
}

// かなの名字・名（辞書）＋敬称など
function scanKanaNames(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c0 = text[i];
    if (!isHira(c0) && !isKata(c0)) continue;
    const prev = text[i - 1];
    if (sameScript(prev, c0) && !(isHira(prev) && PARTICLE_CH.has(prev) && !isHira(text[i - 2]))) continue;
    for (let l = 6; l >= 2; l--) {
      const w = text.substr(i, l);
      const isSur = SURNAME_KANA.has(w), isGiven = GIVEN_KANA.has(w);
      if (!isSur && !isGiven) continue;
      const nx = text[i + l];
      if (sameScript(w.at(-1), nx) && !(isHira(nx) && /^(?:さん|さま|ちゃん|くん|です|と申|と言|といい|より)/.test(text.slice(i + l)))) continue;
      let end = i + l;
      // 名字＋空白＋名
      if (isSur && text[end] === ' ') {
        const m = text.slice(end + 1).match(/^(?:[ぁ-ゖ]{2,6}|[ァ-ヶー]{2,8})/);
        if (m && ctxAfter(text, end + 1 + m[0].length)) {
          const c = ctxAfter(text, end + 1 + m[0].length);
          if (c === 'honor' || c === 'self' || c === 'desu' || c === 'paren') { out.push([i, end + 1 + m[0].length]); break; }
        }
      }
      const c = ctxAfter(text, end);
      const startOk = atSentenceStart(text, i) || /[ぁ-ゖ]/.test(prev || '');
      const ok = c === 'honor' || c === 'self'
        || (c === 'desu' && !KANA_AMBIG.has(w) && l >= 3 && atSentenceStart(text, i))
        || (c === 'sign' && isGiven && startOk && !KANA_AMBIG.has(w));
      if (ok) { out.push([i, end]); break; }
    }
  }
  return out;
}

// 辞書に無いかなの名＋ちゃん・くん・さん、カタカナの氏名＋敬称
function scanKanaGeneric(text) {
  const out = [];
  // カタカナ（1語か、空白・中黒で2〜4語）＋敬称・と申します
  for (const m of text.matchAll(/(?<![ァ-ヶー])[ァ-ヶー]{2,10}(?:[ ・][ァ-ヶー]{2,10}){0,3}/g)) {
    const v = m[0], end = m.index + v.length;
    const c = ctxAfter(text, end);
    const words = v.split(/[ ・]/);
    if (words.some((w) => KATA_STOP.has(w))) continue;
    const named = words.some((w) => GIVEN_KANA.has(w) || SURNAME_KANA.has(w));
    if (words.length === 1) {
      if (c !== 'honor' && c !== 'self') continue;
      if (/ー$/.test(v) && v.length > 3 && !named) continue; // 「ドライバーさん」の形
      if (c === 'honor' && !/^(?: ?(?:さん|さま|様|ちゃん|くん|君|殿))/.test(text.slice(end))) continue;
    } else if (!(c === 'honor' || c === 'self' || ((c === 'desu' || c === 'paren') && named))) continue;
    out.push([m.index, end]);
  }
  // ひらがな＋ちゃん・くん（「ゆいちゃん」）。辞書の名が後ろにあればそれを、無ければ前に付いた助詞を外す
  for (const m of text.matchAll(/ちゃん|くん/g)) {
    let a = m.index;
    while (a > 0 && isHira(text[a - 1]) && m.index - a < 8) a--;
    const run = text.slice(a, m.index);
    if (run.length < 2) continue;
    let v = null;
    for (let l = Math.min(6, run.length); l >= 2; l--) if (GIVEN_KANA.has(run.slice(-l))) { v = run.slice(-l); break; }
    if (!v) {
      let r = run;
      while (r.length >= 3 && PARTICLE_CH.has(r[0])) r = r.slice(1);
      if (r.length > 5 || HIRA_CHAN_STOP.has(r) || /^お/.test(r) || /(?:ちゃん|くん)/.test(r)) continue;
      v = r;
    }
    out.push([m.index - v.length, m.index]);
  }
  // ひらがなの氏名（空白区切りの2語）＋敬称・と申します
  for (const m of text.matchAll(/(?<![ぁ-ゖ])[ぁ-ゖ]{2,6} [ぁ-ゖ]{2,6}(?= ?(?:さん|さま|様|くん|ちゃん|殿|と申し|と言い))/g)) out.push([m.index, m.index + m[0].length]);
  return out;
}

// 家族の言い方のあとの名（「妻の恵子が」「娘のさくら」）と、行の頭の「矢野の母です」
function scanRelations(text) {
  const out = [];
  const re = new RegExp(`(?<![一-龥々])${REL_WORDS}の(?<v>[一-龥々]{1,3}|[ぁ-ゖ]{2,6}|[ァ-ヶー]{2,8})`, 'gd');
  for (const m of text.matchAll(re)) {
    let [a, b] = m.indices.groups.v; let v = m.groups.v;
    if (isKanji(v[0])) {
      if (isKanji(text[b])) continue;
      if (!(GIVEN_KANJI.has(v) || (givenOk(v) && !givenBad(v)))) continue;
    } else {
      // かな：辞書の名で始まる所だけ
      let hitLen = 0;
      for (let l = Math.min(6, v.length); l >= 2; l--) if (GIVEN_KANA.has(v.slice(0, l))) { hitLen = l; break; }
      if (!hitLen) continue;
      b = a + hitLen; v = v.slice(0, hitLen);
    }
    if (!ctxAfter(text, b) && !/^[(\s]/.test(text.slice(b))) continue;
    out.push([a, b]);
  }
  const re2 = new RegExp(`(?:^|\\n|[。！？!?、]\\s*)(?<v>[一-龥々]{1,4})の(?:${REL_WORDS.slice(3, -1)}|家族|保護者|親)(?:です|でございます|と申します|になります|より)`, 'gd');
  for (const m of text.matchAll(re2)) {
    const v = m.groups.v;
    if (HONOR_STOP.has(v) || GIVEN_STOP.has(v) || GIVEN_BAD_END.test(v)) continue;
    out.push(m.indices.groups.v);
  }
  return out;
}

// 欄の名前のあとの氏名（漢字・かな・カタカナ・ローマ字）
const STRICT_LABEL = '(?:(?:ご|お)?(?:氏名|お名前|名前|宛名|申込者|申込人|申し込み者|契約者|入居者|同居人|予約者|依頼者|依頼人|依頼主|来店者|来場者|受取人|受け取り人|応募者|差出人|送り主|送信者|担当者|対応者|受付者|記入者|名義人|購入者|注文者|世帯主|保証人|連帯保証人|運転者|面談者|相談者|訪問者|返信者|緊急連絡先|子さま|子様|子さん|お子さま|お子様)(?:様|さま)?(?:の?(?:お?名前|氏名|名))?|(?:ご|お)?(?:代表者|保護者|利用者|患者|生徒|顧客|お客様|家族|本人|名義|担当|署名)(?:様|さま)?の?(?:お?名前|氏名|名))';
const LOOSE_LABEL = '(?:(?:ご|お)?(?:代表者|保護者|利用者|患者|生徒|顧客|お客様|ご家族|本人|名義|署名)(?:様|さま)?|(?<![A-Za-z])(?:From|To|Cc)|差出人)';
const FIELD_VALUE = '(?<v>[一-龥々]{1,4}(?: ?[一-龥々ぁ-ゖ]{1,5})?|[ぁ-ゖー]{2,8}(?: [ぁ-ゖー]{2,8})?|[ァ-ヶー]{2,10}(?:[ ・][ァ-ヶー]{2,10}){0,3}|[A-Z][A-Za-z\'-]+(?: [A-Z][A-Za-z\'-]+){0,3})';
const FIELD_RE = new RegExp(`(?:${STRICT_LABEL}(?:\\s{0,2}[:=]\\s{0,2}|\\s{1,2}|は\\s{0,2})(?:${REL_WORDS}\\s?)?|${STRICT_LABEL}${REL_WORDS}\\s?|${LOOSE_LABEL}\\s{0,2}[:=]\\s{0,2}(?:${REL_WORDS}\\s?)?)${FIELD_VALUE}`, 'gd');
function trimValue(v) {
  let prev;
  do {
    prev = v;
    v = v.replace(/(?:でございます|と申します|と言います|です|でした|ます|さん|さま|様|くん|ちゃん|殿|より|から|まで)$/, '').trimEnd();
    v = v.replace(/([一-龥々])[はがをにへともでやの]$/, '$1');
  } while (v !== prev);
  return v;
}
function scanFields(text) {
  const out = [];
  for (const m of text.matchAll(FIELD_RE)) {
    const [a] = m.indices.groups.v;
    const v = trimValue(m.groups.v);
    if (!v || FIELD_STOP.has(v) || FIELD_STOP.has(v.replace(/ /g, ''))) continue;
    if (/^[ぁ-ゖー ]+$/.test(v) && /(?:ません|ます|ない|たい|った|って|ので|けど|について|いて|して)$/.test(v)) continue;
    if (isKanji(v[0]) && GIVEN_BAD_END.test(v.replace(/ .*/, '')) && !SURNAME_SET.has(v.replace(/ .*/, ''))) continue;
    out.push([a, a + v.length]);
  }
  return out;
}

// 表（CSV・Excel から写したタブ区切り）の「氏名」「名前」の列
function scanTables(text) {
  const out = [];
  const lines = text.split('\n');
  let pos = 0, col = -1, sep = null;
  const offs = lines.map((l) => { const o = pos; pos += l.length + 1; return o; });
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const s = line.includes('\t') ? '\t' : line.includes(',') ? ',' : null;
    if (!s) { col = -1; continue; }
    const cells = line.split(s);
    const hk = cells.findIndex((c) => /^\s*(?:氏名|名前|お名前|顧客名|お客様名|契約者名?|入居者名?|担当者名?|申込者名?|予約者名?|フルネーム|氏名\(漢字\)|氏名カナ|カナ氏名|フリガナ|ふりがな|name|full ?name|customer ?name)\s*$/i.test(c));
    if (hk >= 0) { col = hk; sep = s; continue; }
    if (col < 0 || s !== sep || cells.length <= col) { if (!line.trim()) col = -1; continue; }
    const cell = cells[col], v = cell.trim();
    if (!v || v.length > 24 || /[\d@]/.test(v)) continue;
    let a = offs[li] + cells.slice(0, col).join(s).length + (col ? 1 : 0);
    a += cell.length - cell.trimStart().length;
    out.push([a, a + v.length]);
  }
  return out;
}

// 締めのあいさつの次の行だけにある名前（「よろしくお願いいたします。\n須田」）・あいさつの次の行の名字
const CLOSING = /(?:よろしく|宜しく|お願い(?:いた|致)?します|お願い申し上げます|以上|失礼(?:いた|致)?します|取り急ぎ[^\n]*|ありがとうございま(?:す|した)|お待ちしております|敬具|草々|かしこ)[。．.!！]?\s*$/;
const GREETING = /^(?:お世話になって(?:おり|い)ます|いつもお世話になっております|こんにちは|こんばんは|おはようございます|はじめまして|初めまして|お疲れ(?:様|さま)です)[。、!！]?\s*$/;
const LINE_STOP = new Set('以上 敬具 草々 かしこ 拝 担当 担当者 事務局 営業部 総務部 経理部 管理部 店長 社長 本部 窓口 運営 運営事務局 管理会社 オーナー 署名 追伸 備考 宛先 件名 本文 添付 送信 返信'.split(' '));
function scanLines(text) {
  const out = [];
  const lines = text.split('\n');
  let pos = 0;
  const offs = lines.map((l) => { const o = pos; pos += l.length + 1; return o; });
  const prevNonEmpty = (li) => { for (let k = li - 1; k >= 0; k--) if (lines[k].trim()) return lines[k]; return null; };
  for (let li = 1; li < lines.length; li++) {
    const raw = lines[li], v = raw.trim();
    if (!v || v.length > 12) continue;
    const pl = prevNonEmpty(li);
    if (!pl) continue;
    const a = offs[li] + raw.indexOf(v);
    const kanjiName = /^[一-龥々]{1,4}(?: ?[一-龥々ぁ-ゖ]{1,4})?$/.test(v), kataName = /^[ァ-ヶー]{2,8}(?:[ ・][ァ-ヶー]{2,8})?$/.test(v);
    if (!kanjiName && !kataName) continue;
    if (LINE_STOP.has(v) || HONOR_STOP.has(v) || /(株式|有限|合同|会社|事務所|不動産|商店|工業|店|部|課|係|室|センター)$/.test(v) || GIVEN_BAD_END.test(v.replace(/ .*/, '')) && !SURNAME_SET.has(v.replace(/ .*/, ''))) continue;
    if (kataName && v.split(/[ ・]/).some((w) => KATA_STOP.has(w))) continue;
    const head = v.replace(/ .*/, '');
    const inDict = [4, 3, 2, 1].some((l) => SURNAME_SET.has(head.slice(0, l)) && (head.length === l || givenOk(head.slice(l)) || / /.test(v)));
    if (CLOSING.test(pl)) {
      // 最後の行か、次の行が連絡先・会社名などの時
      const rest = lines.slice(li + 1).filter((l) => l.trim());
      if (!rest.length || inDict || rest.every((l) => /[@\d〒]|TEL|tel|電話|メール|株式会社|有限会社/.test(l))) out.push([a, a + v.length]);
    } else if (GREETING.test(pl.trim()) && inDict && kanjiName) out.push([a, a + v.length]);
  }
  return out;
}

// 英語・中国語・韓国語・ベトナム語の名前
function scanForeign(text) {
  const out = [];
  const push = (m) => { const [a, b] = m.indices.groups.v; out.push([a, b]); };
  const firstOk = (v) => !ENG_STOP.has(v.split(' ')[0]);
  for (const m of text.matchAll(/\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\.?\s+(?<v>[A-Z][A-Za-z'-]+(?:\s[A-Z][A-Za-z'-]+){0,2})/gd)) if (firstOk(m.groups.v)) push(m);
  for (const m of text.matchAll(/\bDear\s+(?!(?:Mr|Mrs|Ms|Miss|Dr|Prof)\b)(?<v>[A-Z][a-z'-]+(?:\s[A-Z][a-z'-]+){0,2})\s*[,，]/gd)) if (firstOk(m.groups.v)) push(m);
  for (const m of text.matchAll(/\b(?:[Mm]y name is|[Mm]y name's|[Cc]all me|[Tt]his is|I am|I'm)\s+(?<v>[A-Z][a-z'-]+(?:\s[A-Z][a-z'-]+){0,2})/gd)) {
    const v = m.groups.v, two = v.includes(' ');
    if (v.split(' ').some((w) => ENG_STOP.has(w))) continue;
    if (!two && !/name|call/i.test(m[0])) continue; // 「I am Japanese」を避ける：I am・This is は2語の時だけ
    push(m);
  }
  for (const m of text.matchAll(/(?:^|\n)\s*(?:Best regards|Kind regards|Warm regards|Regards|Best|Sincerely|Thanks|Thank you|Many thanks|Cheers|Yours truly|Yours sincerely)\s*,?\s*\n\s*(?<v>[A-Z][a-z'-]+(?: [A-Z][a-z'-]+){0,2})\s*(?=\n|$)/gd)) {
    if (m.groups.v.split(' ').some((w) => ENG_STOP.has(w))) continue;
    push(m);
  }
  for (const m of text.matchAll(/(?<![A-Za-z])(?<v>[A-Za-z]{2,}(?: [A-Za-z]{2,}){0,2}) ?(?:様|さん|さま|殿)/gd)) {
    const v = m.groups.v;
    if (v.replace(/ /g, '').length < 4 || ENG_STOP.has(v.split(' ')[0]) || /^(?:IT|PC|AI|OA|EC|Web|SNS)$/i.test(v)) continue;
    push(m);
  }
  for (const m of text.matchAll(new RegExp(`(?:我叫|我是|我姓|叫我|本人是|我的名字是|我的名字叫|我名叫)\\s*(?<v>${CN_SURNAME}[一-龥]{0,2})`, 'gd'))) push(m);
  for (const m of text.matchAll(/(?:이름은|저는|나는)\s*(?<v>[가-힣]{2,4}?)(?:입니다|이에요|예요|라고|이라고|이고|인데)/gd)) push(m);
  for (const m of text.matchAll(/(?<![가-힣])(?<v>[가-힣]{2,4})\s?(?:씨|님)(?![가-힣])/gd)) {
    if (/^(?:선생|고객|사장|회장|부장|과장|팀장|실장|여러분|어머|아버|손|형|누|언|교수|의사|기사|사모)$/.test(m.groups.v)) continue;
    push(m);
  }
  for (const m of text.matchAll(/(?:[Tt]ên (?:tôi |em |mình |anh |chị )?là|[Tt]ôi là|[Ee]m là|[Mm]ình là|[Tt]ôi tên|[Ee]m tên)\s+(?<v>\p{Lu}\p{Ll}*(?:\s\p{Lu}\p{Ll}*){0,3})/gdu)) push(m);
  return out;
}

export function findNames(text) {
  return [...scanKanjiNames(text), ...scanKanaNames(text), ...scanKanaGeneric(text), ...scanRelations(text), ...scanFields(text), ...scanTables(text), ...scanLines(text), ...scanForeign(text)];
}

const NAME_STOP = new Set([...NAME_STOP0, ...HONOR_STOP]);

// kind, category, level（AI に送る前に伏せるか）, 正規表現, 確かめ（任意）, 伏せる部分の名前付きの組（任意）
export const RULES = [
  { kind: 'private_key', cat: 'credential', redact: 'always', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'api_key', cat: 'credential', redact: 'always', re: /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'api_key', cat: 'credential', redact: 'always', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g },
  { kind: 'api_key', cat: 'credential', redact: 'always', re: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { kind: 'api_key', cat: 'credential', redact: 'always', re: /\bgsk_[A-Za-z0-9]{20,}\b/g },
  { kind: 'github_token', cat: 'credential', redact: 'always', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { kind: 'slack_token', cat: 'credential', redact: 'always', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'aws_key', cat: 'credential', redact: 'always', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'payment_secret', cat: 'credential', redact: 'always', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g },
  { kind: 'jwt', cat: 'credential', redact: 'always', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)?/g },
  { kind: 'bearer', cat: 'credential', redact: 'always', re: /\bbearer\s+(?<v>[A-Za-z0-9._~+/=-]{16,})/gi },
  { kind: 'url_password', cat: 'credential', redact: 'always', re: /\/\/[^\s/:@]{1,128}:(?<v>[^\s/@]{1,128})@/g },
  { kind: 'credential_assign', cat: 'credential', redact: 'always', re: /(?:password|passwd|pwd|secret|api[_-]?key|パスワード|暗証番号)\s{0,4}[:=]\s{0,4}["']?(?<v>(?=[^\s"']{0,400}\d)[^\s"']{6,400})/gi },
  { kind: 'credential_phrase', cat: 'credential', redact: 'always', re: /(?:パスワード|暗証番号|password|passcode|pin)\s{0,2}(?:は|is)\s{0,3}["']?(?<v>[!-~]{4,64})/gi,
    check: (m) => /\d/.test(m.groups.v) || m.groups.v.length >= 8 },
  // 環境変数の形（大文字の名前に KEY・SECRET・TOKEN・PASSWORD などが入る）
  { kind: 'credential_assign', cat: 'credential', redact: 'always', re: /\b[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD)(?:_[A-Z0-9]+)*\s{0,2}[:=]\s{0,2}["']?(?<v>[^\s"']{8,400})/g },
  // 「PW: 〜」「Pass: 〜」「パス：〜」
  { kind: 'credential_assign', cat: 'credential', redact: 'always', re: /(?:\bPW|\bPass|\bPASS|パス(?!ワード))\s{0,2}[:=]\s{0,2}["']?(?<v>[^\s"']{6,64})/g },
  // URL の問い合わせの部分の pass= など
  { kind: 'url_password', cat: 'credential', redact: 'always', re: /[?&](?:pass|password|passwd|pwd|token|secret|api_?key|key)=(?<v>[^&\s#]{4,})/gi },
  { kind: 'credit_card', cat: 'personal', redact: 'always', re: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
    check: (m, text) => {
      const d = m[0].replace(/\D/g, '');
      if (!luhn(d)) return false;
      if (CTX.card.test(before(text, m.index))) return true;
      return /^\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}$/.test(m[0]) && cardIssuerOk(d);
    } },
  { kind: 'my_number', cat: 'personal', redact: 'always', re: /(?<![\d-])\d{4}[ -]{0,2}\d{4}[ -]{0,2}\d{4}(?![\d-])/g,
    check: (m, text, o) => myNumberValid(m[0]) && (o.aggressive || CTX.myNumber.test(before(text, m.index)) || /^\d{4}([ -]{1,2})\d{4}\1\d{4}$/.test(m[0])) },
  { kind: 'email', cat: 'personal', redact: 'personal', re: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g,
    check: (m) => !/(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/i.test(m[0].split('@')[1] || '') },
  { kind: 'phone', cat: 'personal', redact: 'personal', re: /(?<![\d.-])0\d{1,4}(?:-|\(| |\.)\d{1,4}(?:-|\)|\) ?| |\.)\d{3,4}(?![\d.-])/g, check: (m) => phoneDigitsOk(m[0]) },
  { kind: 'phone', cat: 'personal', redact: 'personal', re: /\(0\d{1,4}\) ?\d{1,4}-\d{3,4}(?![\d-])/g, check: (m) => phoneDigitsOk(m[0]) },
  { kind: 'phone', cat: 'personal', redact: 'personal', re: /(?<!\d)0[5789]0\d{8}(?!\d)/g },
  { kind: 'phone', cat: 'personal', redact: 'personal', re: /(?<!\d)0\d{9}(?!\d)/g, check: (m, text) => CTX.phone.test(before(text, m.index, 12)) },
  { kind: 'phone', cat: 'personal', redact: 'personal', re: /(?<![\w+])\+\d{1,3}[- ]?\d{1,4}[- ]?\d{2,4}[- ]?\d{3,4}(?!\d)/g, check: (m) => phoneDigitsOk(m[0]) },
  { kind: 'address', cat: 'personal', redact: 'personal', re: new RegExp(`${PREF}?${MUNI}${STREET}${NUM}`, 'g') },
  // 郡・大字・字
  { kind: 'address', cat: 'personal', redact: 'personal', re: new RegExp(`${PREF}?${MUNI}(?:大?字[一-龥ぁ-んァ-ヶー]{1,8}){1,2}\\d{1,5}`, 'g') },
  // 京都の通り名（上ル・下ル・東入・西入）
  { kind: 'address', cat: 'personal', redact: 'personal', re: new RegExp(`${PREF}?${MUNI}[一-龥ぁ-んァ-ヶー]{0,20}?(?:上ル|下ル|上る|下る|東入ル?|西入ル?)[一-龥ぁ-んァ-ヶー]{0,10}\\d{1,4}`, 'g') },
  // 欄の名前のあとの氏名（「欄の名前：」か「欄の名前 」の形。「お名前の欄は」は当てない）
  { kind: 'name', cat: 'personal', redact: 'personal', re: new RegExp(`(?:氏名|お名前|名前|申込者|申込人|契約者|入居者|予約者|依頼者|来店者|宛名|ご依頼主|保護者|患者名|受取人|応募者|生徒名|利用者)(?:様)?(?:\\s{0,2}:\\s{0,2}| {0,2})(?!者|様|殿|各位|欄|は|を|氏名|名前|カナ)(?<v>${NAME})`, 'g'),
    check: (m) => !NAME_STOP.has(m.groups.v.replace(/ /g, '')) },
  { kind: 'name', cat: 'personal', redact: 'personal', re: new RegExp(`担当(?:者)?の?(?!者|様|殿|各位)(?<v>${NAME})(?=と申します|です|より|から|が|、|。|$)`, 'g'),
    check: (m) => !NAME_STOP.has(m.groups.v.replace(/ /g, '')) },
  // ふりがなの欄・ローマ字の欄
  { kind: 'name', cat: 'personal', redact: 'personal', re: /(?:フリガナ|ふりがな|カナ|氏名カナ)\s{0,2}:\s{0,2}(?<v>[ァ-ヶーぁ-ん ]{2,20})/g },
  { kind: 'name', cat: 'personal', redact: 'personal', re: /(?:氏名|お名前|名前|申込者|契約者|予約者|応募者|利用者)\s{0,2}:\s{0,2}(?<v>[ァ-ヶー]{2,}(?:・[ァ-ヶー]{2,}){0,3})/g },
  { kind: 'name', cat: 'personal', redact: 'personal', re: /\b(?:[A-Za-z]+ )?[Nn]ame\s{0,2}:\s{0,2}(?<v>[A-Z][A-Za-z]+ [A-Z][A-Za-z]+)/g },
  // JSON の値
  { kind: 'name', cat: 'personal', redact: 'personal', re: /"(?:name|full_?name|customer_?name|user_?name)"\s{0,2}:\s{0,2}"(?<v>[^"]{2,40})"/gi },
  { kind: 'credential_assign', cat: 'credential', redact: 'always', re: /"(?:password|passwd|pwd|pin|secret|token|api_?key|access_?token)"\s{0,2}:\s{0,2}"(?<v>[^"]{3,400})"/gi },
  // 小文字の設定の名前（aws_access_key_id = 〜 など）
  { kind: 'credential_assign', cat: 'credential', redact: 'always', re: /\b[a-z][a-z0-9_]*(?:_key|_secret|_token|password|passwd)(?:_[a-z0-9]+)*\s{0,2}[:=]\s{0,2}["']?(?<v>[^\s"']{12,400})/g },
  { kind: 'credential_assign', cat: 'credential', redact: 'always', re: /\bPIN(?:コード)?\s{0,2}:?\s{0,2}(?<v>\d{4,8})(?!\d)/g },
  // 担当の〇〇さん（かなの名も）
  { kind: 'name', cat: 'personal', redact: 'personal', re: /(?<=担当の)(?<v>[ぁ-んァ-ヶ一-龥々]{1,6})さん/g, check: (m) => !NAME_STOP.has(m.groups.v) },
  // 区切りの線のあとの署名の行（名字の一覧に無い名前も）
  { kind: 'name', cat: 'personal', redact: 'personal', re: /(?:^|\n)[-―ー=_*]{2,}\n(?:[^\n]*\n){0,2}?(?<v>[一-龥々]{1,4} ?[一-龥々ぁ-ん]{1,4})(?=\n|$)/g,
    check: (m) => !GIVEN_BAD.test(m.groups.v.slice(-1)) && !/(株式|有限|合同|会社|事務所)/.test(m.groups.v) },
  // 氏名の辞書と前後の言葉（11/14 3回目）：findNames
  { kind: 'name', cat: 'personal', redact: 'personal', fn: findNames },
  // 中黒の外国の名前
  { kind: 'name', cat: 'personal', redact: 'personal', re: /(?<v>[ァ-ヶー]{2,}(?:・[ァ-ヶー]{2,}){1,3})(?=と申します|です|様|さん|[（(])/g },
  { kind: 'name', cat: 'personal', redact: 'personal', re: new RegExp(`(?<![一-龥々\d])(?<v>${NAME})(?:様|さん|殿)(?=[、。,!！ \\n]|から|に|へ|が|は|と|の|より|も|$)`, 'g'),
    check: (m) => !NAME_STOP.has(m.groups.v.replace(/ /g, '')) && !/^ご/.test(m.groups.v) },
  { kind: 'name', cat: 'personal', redact: 'personal', re: new RegExp(`(?<=^|[、。 :のは])(?<v>${NAME})と申します`, 'g'),
    check: (m) => !NAME_STOP.has(m.groups.v.replace(/ /g, '')) },
  { kind: 'birth', cat: 'personal', redact: 'personal', re: /(?:生年月日|誕生日|生まれ|DOB|Date of birth|Birthday|birth date)(?:は)?\s{0,2}:?\s{0,2}(?<v>(?:\d{4}|(?:明治|大正|昭和|平成|令和|[MTSHR])(?:\d{1,2}|元))(?:年|[/.-])\d{1,2}(?:月|[/.-])\d{1,2}日?)/gi },
  { kind: 'birth', cat: 'personal', redact: 'personal', re: /(?<v>(?:[MTSHR]\d{1,2}|\d{4})[./-]\d{1,2}[./-]\d{1,2})(?=生まれ)/g },
  { kind: 'birth', cat: 'personal', redact: 'personal', re: /(?:DOB|Date of birth|Birthday|birth date)\s{0,2}:?\s{0,2}(?<v>(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4})/gi },
  // 日付のあとに「生まれ」
  { kind: 'birth', cat: 'personal', redact: 'personal', re: /(?<v>(?:\d{4}|(?:明治|大正|昭和|平成|令和)(?:\d{1,2}|元))年\d{1,2}月\d{1,2}日)(?=生まれ)/g },
];

// ---------- 見つける ----------
export function findAll(input, o = {}) {
  const { text, map } = normalizeWithMap(String(input ?? ''));
  const hits = [];
  for (const r of RULES) {
    if (r.fn) {
      for (const [a, b] of r.fn(text)) if (a < b) hits.push({ kind: r.kind, cat: r.cat, redact: r.redact, start: map[a].start, end: map[b - 1].end });
      continue;
    }
    for (const m of text.matchAll(r.re)) {
      if (r.check && !r.check(m, text, o)) continue;
      let a = m.index, b = m.index + m[0].length;
      if (m.groups?.v != null && m.indices === undefined) {
        const off = m[0].lastIndexOf(m.groups.v);
        a = m.index + off; b = a + m.groups.v.length;
      }
      // 住所の頭に付いた「は・の・を…」などは外し、都道府県があればそこから始める
      if (r.kind === 'address') {
        const seg = text.slice(a, b);
        const pref = seg.search(PREF_RE);
        if (pref > 0) a += pref;
        else { const lead = seg.match(/^[はのをにへでがともや]+/); if (lead) a += lead[0].length; }
      }
      if (a >= b) continue;
      hits.push({ kind: r.kind, cat: r.cat, redact: r.redact, start: map[a].start, end: map[b - 1].end });
    }
  }
  return hits;
}

export function classify(input, o = {}) {
  const kinds = {};
  for (const h of findAll(input, o)) kinds[h.kind] = (kinds[h.kind] || 0) + 1;
  return { kinds, found: Object.keys(kinds) };
}

/** AI へ送る前に伏せる。o.personal で個人情報（電話・メール・住所・氏名・生年月日）も伏せる。o.aggressive でマイナンバーを言葉なしでも伏せる。 */
export function redact(input, o = {}) {
  const s = String(input ?? '');
  const hits = findAll(s, o).filter((h) => h.redact === 'always' || (o.personal && h.redact === 'personal'));
  // 重なりは長い方・先の方を残す
  hits.sort((x, y) => x.start - y.start || (y.end - y.start) - (x.end - x.start));
  const keep = [];
  for (const h of hits) { const last = keep[keep.length - 1]; if (last && h.start < last.end) continue; keep.push(h); }
  let out = '', pos = 0;
  for (const h of keep) { out += s.slice(pos, h.start) + `[伏せ字:${h.kind}]`; pos = h.end; }
  out += s.slice(pos);
  return { text: out, count: keep.length, kinds: [...new Set(keep.map((h) => h.kind))] };
}
