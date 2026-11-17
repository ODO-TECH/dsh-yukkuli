const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// 设置页的真实渲染（带假数据），用来锁住配色与布局

const CFG = {
  enabled: true,
  // session-a 故意不在 SESSIONS 里 —— 模拟「勾选了但当前没加载」的会话
  watch: ['session-a'],
  voice: 'reimu',
  emotion: 'neutral',
  maxKana: 100,
  intervalMs: 1500,
  keepSegments: 40,
};

const SESSIONS = [
  { id: 'session-2d1d6ab-b0da-4b40-8e5b-e468af3e2edc', title: '(未命名)' },
  { id: 'session-d8815dc2-b235-4d4b-b7ba-24b11377bb9b', title: '网络操作与源码分析' },
];

function renderSettings() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8');
  let booted = null;

  const sandbox = {
    window: { __ModuleLoader__: { load: ({ id, factory }) => { booted = { id, factory }; } } },
    document: {
      getElementById: () => null,
      createElement: () => ({ set textContent(v) {}, id: '' }),
      head: { appendChild: () => {} },
    },
    Audio: class { play() { return Promise.resolve(); } pause() {} removeAttribute() {} addEventListener() {} },
    fetch: (url) => {
      if (String(url).includes('/state')) return Promise.resolve({ json: () => Promise.resolve({ ok: true, cfg: CFG }) });
      if (String(url).includes('/sessions')) return Promise.resolve({ json: () => Promise.resolve({ ok: true, sessions: SESSIONS }) });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    },
    console, URLSearchParams, setTimeout: () => 0, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  };
  sandbox.window.document = sandbox.document;
  sandbox.window.Audio = sandbox.Audio;
  sandbox.window.fetch = sandbox.fetch;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  // 假 React：useState 按调用顺序返回预设值，useEffect 直接不执行
  let stateCall = 0;
  const fake = Object.assign(Object.create(null), React);
  fake.createElement = React.createElement;
  fake.Fragment = React.Fragment;
  fake.useState = () => {
    const i = stateCall++;
    if (i === 0) return [CFG, () => {}];
    if (i === 1) return [SESSIONS, () => {}];
    if (i === 2) return ['', () => {}];
    return ['ゆっくりしていってね。', () => {}];
  };
  fake.useEffect = () => {};

  const mod = booted.factory((name) => {
    if (name === 'react') return fake;
    throw new Error('unexpected require: ' + name);
  });

  const reg = [];
  mod.apply({
    slots: {
      register: (meta, comp) => { reg.push({ meta, comp }); return () => {}; },
      inject: (name, fn) => fn(),
    },
  });

  const page = reg.find((r) => r.meta.name === 'settings.section');
  stateCall = 0;
  return renderToStaticMarkup(React.createElement(page.comp, {}));
}

const html = renderSettings();

test('下拉的每个 option 都有显式背景色', () => {
  const options = html.match(/<option[^>]*>/g) || [];
  assert.ok(options.length > 0, '应有 option');
  for (const o of options) {
    assert.ok(
      o.includes('background:var(--dsw-alias-bg-layer-2'),
      'option 必须带背景色，否则深色主题下会白底浅字: ' + o
    );
  }
});

test('下拉本身有实底，不透明', () => {
  const selects = html.match(/<select[^>]*>/g) || [];
  assert.ok(selects.length >= 2, '应有声源与情绪两个下拉');
  for (const s of selects) {
    assert.ok(s.includes('var(--dsw-alias-bg-layer-2'), '下拉不能透明: ' + s);
  }
});

test('使用主题变量，不写死颜色', () => {
  assert.ok(html.includes('--dsw-alias-label-primary'), '文字色应走主题变量');
  assert.ok(html.includes('--dsw-alias-border-l2'), '边框色应走主题变量');
});

test('会话行是两行布局（标题会省略，id 不挤）', () => {
  assert.ok(html.includes('text-overflow:ellipsis'), '标题应可省略');
  assert.ok(html.includes('ui-monospace'), 'id 应用等宽字体');
  // id 单独一层，不与标题同行
  assert.ok(html.includes('网络操作与源码分析'));
});

test('列表容器有边框与滚动', () => {
  assert.ok(html.includes('max-height:220px') || html.includes('max-height: 220px'), '应有最大高度');
  assert.ok(html.includes('overflow-y:auto') || html.includes('overflow-y: auto'), '应可滚动');
});
test('已勾选但没加载的会话也要列出来', () => {
  assert.ok(html.includes('（未加载）'), '应标出未加载的会话');
  assert.ok(html.includes('session-a'), '应显示它的 id');
  assert.ok(
    html.includes('切过去打开一次'),
    '应给出恢复方法',
  );
});

test('可监听的会话仍然正常列出', () => {
  assert.ok(html.includes('网络操作与源码分析'));
  assert.ok(html.includes('(未命名)'));
});
