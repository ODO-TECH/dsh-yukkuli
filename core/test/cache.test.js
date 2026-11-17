const test = require('node:test');
const assert = require('node:assert');
const { LruCache } = require('../src/cache');

// 纯内存 LRU：不落盘，进程退出即清

test('基本存取', () => {
  const c = new LruCache(3);
  c.set('a', 1);
  assert.strictEqual(c.get('a'), 1);
  assert.strictEqual(c.get('nope'), undefined);
});

test('超过容量淘汰最久未用', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.get('a');           // a 变新
  c.set('c', 3);        // 应淘汰 b
  assert.strictEqual(c.get('a'), 1, 'a 应保留');
  assert.strictEqual(c.get('b'), undefined, 'b 应被淘汰');
  assert.strictEqual(c.get('c'), 3);
});

test('容量 1 也能工作', () => {
  const c = new LruCache(1);
  c.set('a', 1);
  c.set('b', 2);
  assert.strictEqual(c.get('a'), undefined);
  assert.strictEqual(c.get('b'), 2);
});

test('重复 set 同键会更新值并变新', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.set('b', 2);
  c.set('a', 99);
  c.set('c', 3);        // b 应被淘汰
  assert.strictEqual(c.get('a'), 99);
  assert.strictEqual(c.get('b'), undefined);
});

test('统计命中与未命中', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.get('a');   // hit
  c.get('x');   // miss
  const s = c.stats();
  assert.strictEqual(s.hits, 1);
  assert.strictEqual(s.misses, 1);
  assert.strictEqual(s.size, 1);
});

test('clear 清空', () => {
  const c = new LruCache(2);
  c.set('a', 1);
  c.clear();
  assert.strictEqual(c.size, 0);
  assert.strictEqual(c.get('a'), undefined);
});

test('非法容量报错', () => {
  assert.throws(() => new LruCache(0), /capacity|容量/i);
  assert.throws(() => new LruCache(-1), /capacity|容量/i);
});

test('keys 按最近使用排序（最新在前）', () => {
  const c = new LruCache(3);
  c.set('a', 1); c.set('b', 2); c.set('c', 3);
  c.get('a');
  assert.deepStrictEqual(c.keys(), ['a', 'c', 'b']);
});
