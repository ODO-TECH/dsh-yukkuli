'use strict';

/**
 * 文本提取：从助手回复里挑出「能念的」自然语言。
 *
 * 判据来自 dsh-tts-bridge 的 turn-scanner：只认 block.type === 'text'。
 * 在此基础上再做 Markdown 清理 —— 代码块、表格、链接、路径念出来都是噪音。
 */

/** 哪些 block 类型算「自然语言」 */
const TEXT_BLOCK = 'text';

function stripCodeFences(text) {
  // ```lang\n...\n```  整块删掉
  return text.replace(/```[\s\S]*?```/g, '');
}

function stripInlineCode(text) {
  // `code` → code（保留内容去掉反引号，短片段念出来还能懂）
  return text.replace(/`([^`]*)`/g, '$1');
}

function stripTables(text) {
  // 表格行：以 | 开头或包含 |---| 分隔
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (/^\|.*\|$/.test(t)) return false;
      if (/^\s*[-:|\s]+$/.test(t) && t.includes('|')) return false;
      return true;
    })
    .join('\n');
}

function stripLinks(text) {
  // [文字](url) → 文字
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

function stripBareUrls(text) {
  return text.replace(/https?:\/\/\S+/g, '');
}

function stripPaths(text) {
  // Windows 盘符路径、UNC 路径、类 Unix 绝对路径（至少两级，避免误伤 a/b 这种）
  return text
    .replace(/[A-Za-z]:\\[^\s，。、]+/g, '')
    .replace(/\\\\[\w.$-]+\\[^\s，。、]+/g, '')
    .replace(/(?:^|\s)\/[\w.-]+\/[^\s，。、]*/g, ' ');
}

function stripMarkup(text) {
  return text
    // 标题 ### xxx → xxx
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    // 引用 > xxx → xxx
    .replace(/^\s{0,3}>\s?/gm, '')
    // 列表符号 - * + 1. → 去掉符号
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    // 分隔线 --- ***
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, '')
    // 粗体/斜体标记
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1');
}

function stripEmoji(text) {
  // 常见符号区与补充平面 emoji、变体选择符
  return text
    .replace(/[\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u25A0-\u27BF]/g, '')
    .replace(/[\uFE0F\u20E3]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/[\u{1F000}-\u{1F2FF}]/gu, '');
}

function tidy(text) {
  return text
    // 全角空格转半角
    .replace(/\u3000/g, ' ')
    // 行内多余空白
    .replace(/[ \t]+/g, ' ')
    // 三行以上空行压成两行
    .replace(/\n{3,}/g, '\n\n')
    // 每行首尾空白
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}

/**
 * 从助手消息里提取可朗读文本。
 *
 * @param {Array|string|null} input
 *   - 数组：消息 content blocks（只取 type==='text'）
 *   - 字符串：已经是纯文本，直接清理
 * @returns {string} 可朗读的纯文本；没有可念的内容时返回空串
 */
function extract(input) {
  if (!input) return '';

  let raw;
  if (typeof input === 'string') {
    raw = input;
  } else if (Array.isArray(input)) {
    raw = input
      .filter((b) => b && b.type === TEXT_BLOCK && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n\n');
  } else {
    return '';
  }

  if (!raw.trim()) return '';

  let text = raw;
  text = stripCodeFences(text);
  text = stripTables(text);
  text = stripInlineCode(text);
  text = stripLinks(text);
  text = stripBareUrls(text);
  text = stripPaths(text);
  text = stripMarkup(text);
  text = stripEmoji(text);
  text = tidy(text);

  return text;
}

module.exports = { extract };
