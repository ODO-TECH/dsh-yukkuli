const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// 用真 React 渲染，验证组件不会抛错、输出结构正确

function loadClient() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  let booted = null;
  const sandbox = {
    window: {
      __ModuleLoader__: { load: ({ id, factory }) => { booted = { id, factory }; } },
    },
    document: {
      getElementById: () => null,
      createElement: () => ({ set textContent(v) {}, id: '' }),
      head: { appendChild: () => {} },
    },
    Audio: class { play() { return Promise.resolve(); } pause() {} removeAttribute() {} addEventListener() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true, cfg: {}, sessions: [] }) }),
    console, URLSearchParams, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.Audio = sandbox.Audio;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return booted.factory((name) => {
    if (name === 'react') return React;
    throw new Error('unexpected require: ' + name);
  });
}

function mount() {
  const mod = loadClient();
  const registered = [];
  mod.apply({
    slots: {
      register: (meta, comp) => { registered.push({ meta, comp }); return () => {}; },
      inject: (name, fn) => fn(),
    },
  });
  return registered;
}

test('回复按钮渲染出两个带图标的按钮', () => {
  const reg = mount();
  const a = reg.find((r) => r.meta.name === 'conversation.chat.assistant-actions');
  const html = renderToStaticMarkup(React.createElement(a.comp, { messageId: 'm1', sessionId: 's1' }));

  assert.ok(html.includes('用油库里念这一条'), '应有播放按钮: ' + html);
  assert.ok(html.includes('停止朗读'), '应有停止按钮');
  assert.strictEqual((html.match(/<button/g) || []).length, 2, '应有两个按钮');
  assert.strictEqual((html.match(/<svg/g) || []).length, 2, '每个按钮一个图标');
  assert.ok(html.includes('yk-act'), '应带样式类');
});

test('设置页初始渲染不抛错', () => {
  const reg = mount();
  const s = reg.find((r) => r.meta.name === 'settings.section');
  const html = renderToStaticMarkup(React.createElement(s.comp, {}));
  assert.ok(html.length > 0);
  assert.ok(html.includes('加载中'), '首次应为加载态: ' + html);
});

test('播放按钮不带 disabled（空闲时可点）', () => {
  const reg = mount();
  const a = reg.find((r) => r.meta.name === 'conversation.chat.assistant-actions');
  const html = renderToStaticMarkup(React.createElement(a.comp, { messageId: 'm1', sessionId: 's1' }));
  assert.ok(!html.includes('disabled'), '空闲时不该 disabled: ' + html);
});
