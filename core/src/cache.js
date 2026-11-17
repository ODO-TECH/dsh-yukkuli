'use strict';

/**
 * 纯内存 LRU 缓存。
 *
 * 为什么不落盘（这是权衡过的，不是偷懒）：
 *   - 合成一段只要 ~8ms，重算成本几乎为零，落盘收益抵不过管理成本
 *   - 语音内容不留在硬盘上，隐私上更干净
 *   - 不用设计淘汰目录、不用管残留文件
 *
 * 代价：进程重启后缓存清空。对 8ms/段 的合成速度来说，这个代价可以忽略。
 */

class LruCache {
  /**
   * @param {number} capacity 最多存多少个条目
   */
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('LruCache capacity 必须是 >= 1 的整数，收到: ' + capacity);
    }
    this.capacity = capacity;
    // Map 保证插入顺序：第一个 key 就是最久未用的
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get size() {
    return this.map.size;
  }

  /**
   * 取一个值。命中会把它移到「最新」位置。
   * @returns {*} 命中返回值，未命中返回 undefined
   */
  get(key) {
    if (!this.map.has(key)) {
      this.misses += 1;
      return undefined;
    }
    const value = this.map.get(key);
    // 删了再插 = 移到队尾（最新）
    this.map.delete(key);
    this.map.set(key, value);
    this.hits += 1;
    return value;
  }

  /**
   * 存一个值。超容量时淘汰最久未用的。
   */
  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);

    while (this.map.size > this.capacity) {
      // Map 的 keys() 第一个就是最久未用的
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  has(key) {
    return this.map.has(key);
  }

  delete(key) {
    return this.map.delete(key);
  }

  /** 清空内容**并重置统计**（统计是相对「上一次 clear」的） */
  clear() {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** 按最近使用排序的 key 列表（最新在前） */
  keys() {
    return Array.from(this.map.keys()).reverse();
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.map.size,
      capacity: this.capacity,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}

module.exports = { LruCache };
