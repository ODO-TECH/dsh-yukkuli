const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const { wrap } = require('./result-text.cjs');

process.env.YUKKURI_CFG_PATH = path.join(os.tmpdir(), 'yukkuri-cmd-' + process.pid + '.json');

/**
 * DSH 的命令 handler 只收到一个对象：
 *   { commandId, agent, rawInput, attachments, signal }
 * （见 @deepseek-ai/dsh-commands 的 CommandInvocation）
 *
 * 这一条是线上事故回归：早先按 (args, meta) 写，args 变成那个对象本身，
 * String(args) === '[object Object]'，所有子命令都匹配不上，
 * 于是 /yukkuri on 在 TUI 里永远返回「未知子命令」，
 * 当前会话也就永远绑不进监听名单 —— 自动朗读一句都不响。
 */

async function mount() {
  const global = globalThis;
  delete global.__yukkuriSeenTurns;
  delete global.__yukkuriStats;
  delete global.__yukkuriStore;
  delete global.__yukkuriHost;

  const commands = [];
  const SESSION_ID = 'aaaa1111-2222-3333-4444-555566667777';
  const ctx = {
    sessions: { list: () => [{ id: SESSION_ID }], get: () => undefined },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {}; },
    inject(deps, fn) {
      const scope = {};
      if (deps.includes('commands')) {
        // 平时断言文本（wrap 会把 CommandResult 拆成 text），
        // 另留 rawHandler 专门验证形状确实是 DSH 要的那个对象。
        scope.commands = { register: (c) => commands.push({ ...c, rawHandler: c.handler, handler: wrap(c.handler) }) };
      }
      fn(scope); // 故意不给 webServer —— 这就是 TUI
    },
  };

  const url = 'file://' + path.resolve(__dirname, '../lib/index.js').replace(/\\/g, '/');
  const mod = await import(url + '?v=' + Math.random());
  mod.apply(ctx);

  return { commands, SESSION_ID };
}

function invocation(rawInput, sessionId) {
  return {
    commandId: 'cmd-1',
    agent: { id: 'agent-1', session: { id: sessionId } },
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  };
}

test('handler 按 DSH 的真实签名收到对象：rawInput 被正确解析', async () => {
  const { commands } = await mount();
  const def = commands.find((c) => c.name === 'yukkuri');
  assert.ok(def, '应注册 yukkuri 命令');

  const out = await def.handler(invocation(' status ', 'sess-x'));
  assert.ok(out.startsWith('油库里朗读:'), '应回状态而不是未知子命令，实际: ' + out);
  assert.ok(!out.includes('[object Object]'), '不该把调用对象当字符串用: ' + out);
});

test('/yukkuri on 能把当前会话绑进监听名单', async () => {
  const { commands, SESSION_ID } = await mount();
  const def = commands.find((c) => c.name === 'yukkuri');

  const out = await def.handler(invocation(' on', SESSION_ID));
  assert.ok(out.includes(SESSION_ID), '应回报绑定的会话 id，实际: ' + out);
  assert.ok(!out.includes('未知子命令'), '实际: ' + out);

  const status = await def.handler(invocation('', SESSION_ID));
  assert.ok(status.includes(SESSION_ID), '状态里应列出这个会话，实际: ' + status);
});

test('老的字符串调用约定仍然能用（不会因为改签名砸掉测试或别的入口）', async () => {
  const { commands } = await mount();
  const def = commands.find((c) => c.name === 'yukkuri');

  const out = await def.handler('status');
  assert.ok(out.startsWith('油库里朗读:'), '实际: ' + out);
});

test('未知子命令仍然报未知', async () => {
  const { commands } = await mount();
  const def = commands.find((c) => c.name === 'yukkuri');

  const out = await def.handler(invocation(' blahblah', 'sess-x'));
  assert.ok(out.includes('未知子命令'), '实际: ' + out);
});
// ---- TUI 里改设置：每一项都该有回执，且真的写进配置 ----

test('/yukkuri help 列出全部子命令', async () => {
  const { commands } = await mount();
  const def = commands.find((c) => c.name === 'yukkuri');

  const out = await def.handler(invocation(' help', 'sess-x'));
  for (const word of ['status', 'on', 'mode', 'voice', 'emotion', 'maxkana', 'interval', 'keep', 'say']) {
    assert.ok(out.includes(word), '帮助里应有 ' + word + '，实际: ' + out);
  }
});

test('maxkana / interval / keep 能改、能读回、坏值被拒', async () => {
  const { commands } = await mount();
  const def = commands.find((c) => c.name === 'yukkuri');

  assert.ok((await def.handler(invocation(' maxkana 40', 's'))).includes('40'));
  assert.ok((await def.handler(invocation(' interval 800', 's'))).includes('800'));
  assert.ok((await def.handler(invocation(' keep 12', 's'))).includes('12'));

  const status = await def.handler(invocation(' status', 's'));
  assert.ok(status.includes('40 假名'), '状态里应有分段上限 40，实际: ' + status);
  assert.ok(status.includes('800ms'), '状态里应有轮询 800ms，实际: ' + status);
  assert.ok(status.includes('保留 12 段'), '状态里应有保留 12 段，实际: ' + status);

  assert.ok((await def.handler(invocation(' maxkana 9', 's'))).includes('10 到 500'));
  assert.ok((await def.handler(invocation(' interval 20', 's'))).includes('300 到 10000'));
  assert.ok((await def.handler(invocation(' keep 2', 's'))).includes('5 到 500'));
});

test('voice / emotion 打错会被拦下来，不会静默写进配置', async () => {
  const { commands } = await mount();
  const def = commands.find((c) => c.name === 'yukkuri');

  const bad = await def.handler(invocation(' voice 不存在的声源', 's'));
  assert.ok(bad.includes('没有这个声源'), '实际: ' + bad);

  const badEmo = await def.handler(invocation(' emotion 生气', 's'));
  assert.ok(badEmo.includes('没有这个情绪'), '实际: ' + badEmo);
  assert.ok(badEmo.includes('angry'), '应顺手列出可用情绪，实际: ' + badEmo);

  const ok = await def.handler(invocation(' emotion angry', 's'));
  assert.ok(ok.includes('angry'), '实际: ' + ok);
  const status = await def.handler(invocation(' status', 's'));
  assert.ok(status.includes('angry'), '配置里应已切到 angry，实际: ' + status);
});

test('不带参数的 voice / emotion 列出可选项', async () => {
  const { commands } = await mount();
  const def = commands.find((c) => c.name === 'yukkuri');

  const voices = await def.handler(invocation(' voice', 's'));
  assert.ok(voices.includes('f1'), '应列出预设，实际: ' + voices);
  assert.ok(voices.includes('reimu'), '应列出角色，实际: ' + voices);

  const emos = await def.handler(invocation(' emotion', 's'));
  for (const e of ['neutral', 'happy', 'sad']) {
    assert.ok(emos.includes(e), '情绪列表缺 ' + e + '，实际: ' + emos);
  }
});
// 这一条是线上事故回归（2026-11-17）：
// handler 返回裸字符串时，DSH 每次都报
//   ! /yukkuri  command "yukkuri" handler must return a CommandResult
// 命令一条都没执行，用户只看到这行红字。
test('handler 返回的是 DSH 要的 CommandResult，不是裸字符串', async () => {
  const { commands } = await mount();
  const def = commands.find((c) => c.name === 'yukkuri');

  const ok = await def.rawHandler(invocation(' status', 'sess-x'));
  assert.ok(ok && typeof ok === 'object', '不能是裸字符串: ' + typeof ok);
  assert.deepStrictEqual(Object.keys(ok).sort(), ['kind', 'text'], '形状应是 {kind, text}，实际: ' + JSON.stringify(ok));
  assert.strictEqual(ok.kind, 'success');
  assert.ok(ok.text.includes('油库里朗读'), '实际: ' + ok.text);

  const bad = await def.rawHandler(invocation(' 不存在的子命令', 'sess-x'));
  assert.strictEqual(bad.kind, 'error', '未知子命令应回 error，实际: ' + JSON.stringify(bad));
  assert.ok(bad.text.includes('未知子命令'), '实际: ' + bad.text);
});
