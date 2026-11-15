// 試験用の「にせの AI の会社」。本物の AI は呼ばない。受け取った依頼（見出し・本文）を全部とっておく。
// Anthropic の /v1/messages と OpenAI の /v1/chat/completions の形をまねる（逐次の返事も）。
import http from 'node:http';

export function createFakeUpstream(o = {}) {
  const state = { requests: [], failNext: 0, delayMs: o.delayMs ?? 0, streamGapMs: o.streamGapMs ?? 0, omitUsage: false, inflight: 0, maxInflight: 0 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = {}; try { body = JSON.parse(raw); } catch { /* そのまま */ }
      state.requests.push({ path: req.url, headers: req.headers, raw, body });
      state.inflight++; state.maxInflight = Math.max(state.maxInflight, state.inflight);
      try {
        if (state.delayMs) await sleep(state.delayMs);
        if (state.failNext > 0) { state.failNext--; res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"type":"error","error":{"type":"api_error","message":"にせの誤り"}}'); }
        // 入力の使用量：本文の messages の文字数の半分（使いすぎ番の見込みより必ず少ない）。出力：上限いっぱい（いちばん高い場合）
        const input = Math.floor(JSON.stringify(body.messages || []).length / 2);
        const output = Number(body.max_tokens ?? body.max_completion_tokens ?? 16);
        const isAnthropic = req.url === '/v1/messages';
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
          const ev = (name, data) => res.write((isAnthropic ? `event: ${name}\n` : '') + `data: ${JSON.stringify(data)}\n\n`);
          if (isAnthropic) {
            ev('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: body.model, content: [], usage: state.omitUsage ? {} : { input_tokens: input, output_tokens: 1 } } });
            ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
            ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '（架空の返事・前半）' } });
            if (state.streamGapMs) await sleep(state.streamGapMs);
            ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '（後半）' } });
            ev('content_block_stop', { type: 'content_block_stop', index: 0 });
            ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: state.omitUsage ? {} : { output_tokens: output } });
            ev('message_stop', { type: 'message_stop' });
          } else {
            ev('', { id: 'cc_fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '（架空の返事・前半）' } }] });
            if (state.streamGapMs) await sleep(state.streamGapMs);
            ev('', { id: 'cc_fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '（後半）' }, finish_reason: 'stop' }] });
            if (body.stream_options?.include_usage && !state.omitUsage) ev('', { id: 'cc_fake', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } });
            res.write('data: [DONE]\n\n');
          }
          return res.end();
        }
        const json = isAnthropic
          ? { id: 'msg_fake', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: '（架空の返事）' }], stop_reason: 'end_turn', usage: state.omitUsage ? undefined : { input_tokens: input, output_tokens: output } }
          : { id: 'cc_fake', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: '（架空の返事）' }, finish_reason: 'stop' }], usage: state.omitUsage ? undefined : { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      } finally { state.inflight--; }
    });
  });
  return {
    state,
    listen() { return new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))); },
    close() { return new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }); },
  };
}
