const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 客户端是浏览器脚本（window.__ModuleLoader__），不能直接 require。
// 用一个假的 window + 假 React 把它跑起来，验证注册行为。

function runClient(overrides = {}) {
  const src = fs.readFileSync(path.join(__dirname, '../lib/client.js'), 'utf8');

  const registered = [];
  const injected = [];
  let booted = null;

  // 极简 React：createElement 只记录，不渲染
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Fragment: 'Fragment',
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (v) => ({ current: v }),
  };

  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: ({ id, factory }) => {
          booted = { id, factory };
        },
      },
    },
    document: {
      getElementById: () => null,
      createElement: () => ({ set textContent(v) {}, id: '' }),
      head: { appendChild: () => {} },
    },
    Audio: class { play() { return Promise.resolve(); } pause() {} removeAttribute() {} addEventListener() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) }),
    console,
    URLSearchParams,
    setTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    clearTimeout,
    ...overrides,
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.Audio = sandbox.Audio;
  sandbox.window.fetch = sandbox.fetch;

  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  assert.ok(booted, '应调用 __ModuleLoader__.load');
  assert.strictEqual(booted.id, 'dsh-yukkuri-tts');

  const mod = booted.factory((name) => {
    if (name === 'react') return React;
    throw new Error('unexpected require: ' + name);
  });

  return { mod, React, registered, injected };
}

function makeSlots(registered, injected) {
  return {
    register: (meta, comp) => {
      registered.push({ meta, comp });
      return () => {};
    },
    inject: (name, fn) => {
      injected.push(name);
      fn();
    },
  };
}

test('客户端能加载并声明 slots 依赖', () => {
  const { mod } = runClient();
  // 跨 VM 上下文的数组原型不同，deepStrictEqual 会因「不是同一引用」而报错，
  // 所以比较内容而不是结构
  assert.strictEqual(Array.from(mod.inject).join(','), 'slots');
  assert.strictEqual(typeof mod.apply, 'function');
});

test('注册了设置页与回复按钮两个插槽', () => {
  const { mod, registered, injected } = runClient();
  const slots = makeSlots(registered, injected);
  mod.apply({ slots });

  assert.strictEqual(injected.length, 2, '应注入两个插槽点');
  assert.ok(injected.includes('settings.section'));
  assert.ok(injected.includes('conversation.chat.assistant-actions'));

  const names = registered.map((r) => r.meta.name);
  assert.ok(names.includes('settings.section'));
  assert.ok(names.includes('conversation.chat.assistant-actions'));

  for (const r of registered) {
    assert.strictEqual(r.meta.id, 'yukkuri-tts');
    assert.strictEqual(typeof r.comp, 'function', '组件应是函数');
  }
});

test('设置页标签是「油库里」', () => {
  const { mod, registered, injected } = runClient();
  mod.apply({ slots: makeSlots(registered, injected) });
  const s = registered.find((r) => r.meta.name === 'settings.section');
  assert.strictEqual(s.meta.label, '油库里');
});

test('回复按钮组件能渲染出两个按钮（播放/停止）', () => {
  const { mod, React, registered, injected } = runClient();
  mod.apply({ slots: makeSlots(registered, injected) });
  const a = registered.find((r) => r.meta.name === 'conversation.chat.assistant-actions');

  const tree = a.comp({ messageId: 'm1', sessionId: 's1' });
  // Fragment 包着两个 button
  assert.strictEqual(tree.type, React.Fragment);
  assert.strictEqual(tree.children.length, 2, '应是两个按钮');
  for (const btn of tree.children) {
    assert.strictEqual(btn.type, 'button');
    assert.strictEqual(btn.props.className, 'yk-act');
  }
});

test('设置页组件不崩溃', () => {
  const { mod, registered, injected } = runClient();
  mod.apply({ slots: makeSlots(registered, injected) });
  const s = registered.find((r) => r.meta.name === 'settings.section');
  // 首次渲染 cfg 为 null，应返回「加载中」而不是崩
  const tree = s.comp({});
  assert.ok(tree, '应返回元素');
});
