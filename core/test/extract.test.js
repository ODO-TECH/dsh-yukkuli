const test = require('node:test');
const assert = require('node:assert');
const { extract } = require('../src/text/extract');

// 只读自然语言文本，结构化输出不读

test('只保留 text 类型 block', () => {
  const blocks = [
    { type: 'text', text: '你好呀' },
    { type: 'tool_use', name: 'bash', input: { command: 'ls' } },
    { type: 'tool_result', content: 'file1\nfile2' },
    { type: 'text', text: '再见' },
  ];
  assert.strictEqual(extract(blocks), '你好呀\n\n再见');
});

test('去掉代码块', () => {
  const text = '这是说明。\n\n```js\nconst a = 1;\n```\n\n继续说话。';
  const out = extract(text);
  assert.ok(!out.includes('const a'), '不应包含代码，实际: ' + out);
  assert.ok(out.includes('这是说明'), '应保留正文');
  assert.ok(out.includes('继续说话'), '应保留后续正文');
});

test('去掉行内代码与反引号', () => {
  const out = extract('运行 `npm test` 就好');
  assert.ok(!out.includes('`'), '不应有反引号: ' + out);
  assert.ok(out.includes('npm test'), '内容保留');
});

test('去掉表格', () => {
  const text = '前面。\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n后面。';
  const out = extract(text);
  assert.ok(!out.includes('|---'), '不应有表格分隔行: ' + out);
  assert.ok(out.includes('前面') && out.includes('后面'));
});

test('去掉标题标记保留文字', () => {
  const out = extract('## 小节标题\n\n正文内容');
  assert.ok(!out.includes('##'), '不应有井号: ' + out);
  assert.ok(out.includes('小节标题'));
  assert.ok(out.includes('正文内容'));
});

test('去掉链接只留文字', () => {
  const out = extract('看 [这个文档](https://example.com/x) 吧');
  assert.ok(!out.includes('https://'), '不应有 URL: ' + out);
  assert.ok(out.includes('这个文档'), '应保留链接文字: ' + out);
});

test('去掉裸 URL 和文件路径', () => {
  const out = extract('文件在 D:\\Users\\a\\b.txt，见 https://x.com/y');
  assert.ok(!out.includes('D:\\Users'), '不应有路径: ' + out);
  assert.ok(!out.includes('https://'), '不应有 URL: ' + out);
});

test('去掉列表符号与引用符号', () => {
  const out = extract('- 第一项\n- 第二项\n> 引用');
  assert.ok(!out.includes('- 第一'), '不应有列表符号: ' + out);
  assert.ok(out.includes('第一项'));
  assert.ok(!out.includes('>'), '不应有引用符');
});

test('去掉 emoji 与装饰符号', () => {
  const out = extract('✅ 完成了 ✔️ 真棒 🎉');
  assert.ok(!/[✅✔️🎉]/.test(out), '不应有 emoji: ' + out);
  assert.ok(out.includes('完成了'));
});

test('空输入返回空串', () => {
  assert.strictEqual(extract(''), '');
  assert.strictEqual(extract(null), '');
  assert.strictEqual(extract([]), '');
});

test('纯结构化内容返回空串', () => {
  assert.strictEqual(extract([{ type: 'tool_use', name: 'x' }]), '');
  assert.strictEqual(extract('```js\ncode\n```'), '');
});
