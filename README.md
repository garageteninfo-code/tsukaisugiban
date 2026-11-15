# 使いすぎ番 0.1.1 — AI の「使いすぎ」と「情報の出しすぎ」を、送る前に止める小さな中継

社員がふだん使う AI の道具（Dify・自作の道具・受付のボットなど）と AI の会社（Anthropic・OpenAI）の API の間に置く、**小さな中継（試作版）**です。
人・道具ごとに「1 日・1 か月 何円まで」の上限を付け、送る前に鍵・カード番号・マイナンバーなどを伏せ、改ざんに気づける記録と日本語の月の報告を残します。

> **試作版です。** 本物の AI の API・本物の Dify とつないだ確認はまだです（試験はすべて、試験用の「にせの AI の会社」が相手です）。
> これは認証・認定・保証ではありません。金額は目安で、伏せ字は完全ではありません（下の「限り」をご覧ください）。

- 提供：HARVEST（ハーベスト）／お問い合わせ：garageten.info@gmail.com（旧称 GARAGE TEN のときのアドレスです）
- 料金：無料（現在）
- ライセンス：**All rights reserved**（松岡颯大（HARVEST））。閲覧と、自分・自分の会社の中で道具として使うこと（仕事で使うことを含む）は無料です。写して配る・売る・変えて配る・ほかの製品に組み込むには、事前の書面の許可が要ります（お問い合わせは上のアドレスへ）→ [`LICENSE`](LICENSE)
- 利用条件：[`利用条件.md`](利用条件.md)（英語：[`TERMS-en.md`](TERMS-en.md)）
- 導入の手順：[`導入手順書.md`](導入手順書.md)

## AI の API キーについて（大切）

- 使いすぎ番は、**お客様自身の AI の API キー**（お客様が AI の会社と直接契約したもの）を、**お客様自身の PC・サーバーの中で**使う道具です。
- **HARVEST は、AI の API の利用を提供・再販しません。** API キーを預かりません。本文・使用量・記録を HARVEST に送りません。
- AI の利用料は、お客様と AI の会社との契約に従って、AI の会社からお客様に請求されます。
- お客様は、使う AI の会社の利用規約・利用の方針に従ってください。

---

## だれのためか

- 会社の API キー 1 本を、いくつもの道具・何人もの社員で共有している、技術者のいない小さな会社（5〜50 人ほど）
- 取引先・親会社から「AI に何を送っているか」「AI の費用を管理しているか」を聞かれる**下請けの会社**
- 親会社の AI 利用の決まりに従う必要がある**子会社**
- お客様の道具に AI を組み込む、小さな受託の開発者

## 何をするか

道具の「送り先」を使いすぎ番に変え、道具には会社の API キーでなく**社員ごとの鍵**（`tsk_…`）を入れます。

1. 社員の鍵を確かめる（無い・違う・無効なら 401。AI の会社には届かない）
2. 単価の分かるモデルだけ送る（単価が無いと上限を守れないため）
3. AI の会社の誤りが 5 回続いたら、30 秒はすぐ断る
4. 出力の上限を下げる（既定：1 回 4,096 トークンまで）
5. **送る前に伏せる**：鍵・パスワード・カード番号・マイナンバーは**いつも**。電話・メール・住所・氏名・生年月日は設定で（道具ごとに「伏せない」も可）
6. **見込みの金額で予約してから送る**：会社全体・人・道具 × 今日・今月（日本時間）の 6 つの上限に収まるときだけ通す
7. 会社の API キーに付け替えて送る（社員の鍵は外に出ない。会社の鍵は環境変数だけで、ファイルに書かない）
8. 逐次の返事をためずに流す（社員が途中でやめたら、AI の会社への依頼も切る）
9. 実際の使用量で金額を記録する（本文は残さない。伏せた情報は種類と数だけ）
10. 上限の 8 割・上限に達したときに知らせる（管理画面と記録）

- **管理画面**（日本語・この PC の中からだけ開ける・外の読み込みなし）：上限・使用量・社員の鍵の発行と無効化・知らせ・記録の確かめ・月の報告・単価・為替・伏せ方の設定。
- **改ざんに気づける記録**：1 行ごとに前の行の指紋をつなぐ鎖と、鎖の外の控え。月の報告に印刷される「指紋」を、社長・親会社・取引先が控えておく運用を前提にしています。
- **AI のモデルの単価は、初めは入っていません。** 使うモデルの単価を、AI の会社の公式の料金表を見て、利用者が管理画面で入れてください。

## いちばん簡単な使い方（ダブルクリック）

1. [Node.js](https://nodejs.org/ja) の「LTS」を入れます（無料）。
2. Releases の zip を展開して、**`1_見本を見る.cmd`** をダブルクリックします。
   - 架空の社員 3 人の見本の管理画面が、ブラウザに開きます。
   - 窓に出る「管理画面の鍵（見本用）」を入れて中を見ます。
   - 見終わったら窓を閉じます。
3. 本番で使うときは、先に会社の API キーを Windows の環境変数に入れます（[`導入手順書.md`](導入手順書.md) の 2 章）。
4. そのあと **`2_起動する.cmd`** をダブルクリックします。
   - 窓を開いている間だけ動きます。
   - 初回だけ、窓に管理画面の鍵が出ます。控えてください。

- 「Windows によって PC が保護されました」と出たときは、中身を確かめてから「詳細情報」→「実行」を選んでください。
  - 配るファイルには、まだ署名が付いていません。

## 動かし方（コマンドで使う場合）

用意する物：Node.js 20 以上（試したのは 24）。`npm install` は不要です（外部のパッケージ 0）。

```
node bin/start.mjs
```

- 会社の API キーは環境変数で渡します：`TSUKAISUGI_ANTHROPIC_KEY` / `TSUKAISUGI_OPENAI_KEY`（ファイルに書かないでください）。
- 初回に、管理画面の鍵が 1 回だけ表示されます。`http://127.0.0.1:8787/admin` をこの PC のブラウザで開きます。
- 道具の側の送り先：Anthropic 形式は `http://（使いすぎ番の PC）:8787/anthropic`、OpenAI 形式は `http://（使いすぎ番の PC）:8787/openai/v1`。API キーの欄には社員の鍵（`tsk_…`）を入れます。
- 見本：`node bin/demo.mjs`（にせの AI の会社と架空の社員 3 人。本物の AI は呼ばず、API キーも要りません）。

くわしくは [`導入手順書.md`](導入手順書.md)。

### 試験

```
npm test
```

試験の相手はすべて、試験の中で立ち上げる「にせの AI の会社」です（本物の AI は呼びません・API キーは要りません）。試験のデータはすべて架空です。

## 測った数字（開発中の PC の中で・2026-11-14〜15）

| 何を | 結果 |
|---|---|
| 試験（`npm test`） | **24 / 24 合格**（開発中に 2 回、公開用の写しで 2 回。どれも同じ結果） |
| 同時に 30 件送る | 会社の 1 日 100 円の上限を超えなかった（止めた分は AI の会社に 1 件も届かない・予約が残らない） |
| 伏せ字 | 電話・カード・鍵・メールが AI の会社に届かない（Anthropic 形式・OpenAI 形式・system・配列・道具の説明の中）。道具ごとに個人情報を伏せない設定でも、鍵とカードは伏せる |
| 記録の鎖 | 書き換え・途中の削除・入れ替え・末尾の削除・控えの削除に気づく（6 件）。鎖と控えを丸ごと作り直されると鎖だけでは気づけない（月の報告の指紋で気づく） |
| 逐次の返事 | 前半が後半を待たずに届く（400ms の間を空けても前半は 300ms 未満） |
| 遮断 | AI の会社の誤り 5 回で、6 回目は送らず 503 |

- 同じ検出の部品（日本の個人情報・鍵の検出）を、別の製品（配信番）で初見の架空データで測った数字：番号と鍵は 46 件中 38 件（83%）、**氏名は 19 件中 3 件（16%）**。使いすぎ番の中では別に測っていません。

## 限り（正直に）

- **金額は目安**です（単価 × 為替）。請求の正は AI の会社の請求書です。
- 見込みは文字数で数えます（英語は実際より多め・日本語はほぼ同じか多め＝早めに止まる側）。実際の使用量が見込みより多かった場合は、その 1 回分だけ上限を少し超えることがあります。画像は 1 枚 1,600 トークンと仮定しています。
- **1 台・1 つの処理**で動かす前提です。2 台に分けると上限は台ごとになります。中継が止まると AI も使えません。
- **平文の http** です。社内の別の PC から使うときは、信頼できる社内の網の中だけで（暗号化は未対応）。
- **伏せ字は規則で見つけます**：見落とし・誤検出があります。氏名は「様」「氏名：」などの手がかりが無いと見つけにくいです。伏せると AI の答えが悪くなることがあります。「漏れを 0 にする」ものではなく「減らして、記録に残す」ものです。
- この PC の管理者が記録と控えを両方作り直すと、鎖だけでは分かりません（報告の指紋を第三者が控える運用が前提）。
- 社員が会社の API キーそのものを知っていれば、使いすぎ番を通らずに使えます（鍵は使いすぎ番の PC だけに置き、必要なら AI の会社の画面でキーを作り直してください）。
- 対応しているのは Anthropic の Messages と OpenAI の Chat Completions だけです。**本物の AI・本物の Dify とつないだ確認はまだです。**
- 知らせは画面と記録だけです（メール・LINE の通知はありません）。本文を残さないので、「何を送ったか」の中身の監査はできません。
- この道具は法律の判断をしません。取引先・親会社の決まりに合っているかは、貴社と先方でご判断ください。

## フォルダ

```
bin/start.mjs   … 起動（node bin/start.mjs）
bin/demo.mjs    … 見本（にせの AI の会社＋架空の社員）
lib/            … 中継と管理の API・円の上限と予約・記録の鎖・伏せ字・設定・月の報告
web/            … 管理画面（HTML・JS・CSS。外の読み込みなし）
test/           … 試験（node:test）と、試験用のにせの AI の会社
```

（`bin/` は組み立ての出力ではなく、起動用のスクリプトです。）

---

## English (summary)

**Tsukaisugi-ban 0.1.1** is a prototype local gateway placed between your staff's AI tools (Dify, in-house tools, chatbots) and the Anthropic / OpenAI APIs. It stops overspending and over-sharing **before** a request is sent.

- **Your own API key, on your own machine.** The customer uses their **own** AI API key (their own contract with the AI provider) on their **own** PC or server. **HARVEST does not provide or resell AI API access**, does not hold your keys, and receives none of your content, usage or logs. You must follow the AI provider's terms and usage policies; the provider bills you directly.
- **What it does:** per-staff keys (`tsk_…`) instead of sharing the company key; yen caps per company / person / tool, per day and per month (Japan time), enforced by reserving the estimated cost before sending (30 concurrent requests did not exceed a 100-yen daily cap in tests); always redacts keys, passwords, card numbers and My Number before sending (phone, email, address, name, date of birth optional); tamper-evident usage log (hash chain + checkpoint) and a Japanese monthly report with a fingerprint; streaming pass-through; circuit breaker.
- **Model prices are not pre-filled.** The user must enter the price of each AI model from the provider's official price list.
- **How to run:** `node bin/start.mjs` (no `npm install`, zero dependencies). Company keys via environment variables `TSUKAISUGI_ANTHROPIC_KEY` / `TSUKAISUGI_OPENAI_KEY`. Admin page: `http://127.0.0.1:8787/admin` on the same PC. Demo: `node bin/demo.mjs` (fake AI provider, no API key). Tests: `npm test` — 24/24 passed, all against a fake AI provider with fictional data.
- **Limits:** prototype; **not yet tested with a real AI API or real Dify**; costs are estimates (the provider's invoice is authoritative); plain HTTP; single process; rule-based redaction misses things (personal names especially); only Anthropic Messages and OpenAI Chat Completions.
- **Not a certification or guarantee.** Provided free of charge by HARVEST (Japan). Contact: garageten.info@gmail.com.
- **License: All rights reserved** (松岡颯大 / HARVEST). You may view the source and use the tool within yourself or your own company free of charge, including for work. Copying and distributing, selling, distributing modified versions or incorporating it into other products requires prior written permission. See [`LICENSE`](LICENSE) and [`TERMS-en.md`](TERMS-en.md).
