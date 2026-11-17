'use strict';

/**
 * AquesTalk 许可证密钥生成。
 *
 * 算法移植自 yukumo-group/AquesPy 的 kg.py
 * （DecryptLicenseKey 的逆运算：逐轮右旋 3 位 + 查表回填 + 异或掩码）。
 *
 * 密钥不落盘：每次启动现算。接入官方 key 时见 config.resolveKeys()。
 */

const TABLE = [7, 2, 4, 0, 1, 5, 3, 6];
const XOR = 0xD271BA9DF61EED07n;
const ROUNDS = 0x56F; // 1391
const MASK64 = 0xFFFFFFFFFFFFFFFFn;

const DEV_PRODUCT = 0x5856; // "XV"
const USR_PRODUCT = 0x0517;

// module → [kind, versionMin]
const DEV_MODULES = { aqtk1: [0x6E, 0x14], k2k: [0xC8, 0x29], tk10: [0x64, 0x0A] };
const USR_MODULES = { aqtk1: [0x6E, 0x14], tk10: [0x64, 0x0A] };

function signedChar(x) {
  x &= 0xFF;
  return x < 128 ? x : x - 256;
}

function encryptLicenseKey(plain) {
  let v = BigInt(plain) & MASK64;
  for (let i = ROUNDS - 1; i >= 0; i--) {
    const low = Number(v & 7n);
    const v3 = (low + signedChar(i) + 2) & 7;
    const top = BigInt(TABLE[v3]);
    v = ((v >> 3n) | (top << 61n)) & MASK64;
  }
  return v ^ XOR;
}

/** plain(uint64) → 16 位大写十六进制 */
function formatKey(value) {
  return (value & MASK64).toString(16).toUpperCase().padStart(16, '0');
}

/**
 * 组装 dev key 的 plain。
 * 布局：[0]=kind [1]=version [2:5]=mid [6:7]=product
 */
function devPlain(module, version = null, mid = 0) {
  const entry = DEV_MODULES[module];
  if (!entry) throw new Error('unknown module: ' + module);
  const [kind, versionMin] = entry;
  const v = version === null ? versionMin : version;
  if (v < versionMin || v > 0xFF) throw new Error('version out of range');

  return (
    BigInt(kind) |
    (BigInt(v) << 8n) |
    (BigInt(mid & 0xFFFFFFFF) << 16n) |
    (BigInt(DEV_PRODUCT) << 48n)
  );
}

/** 组装 usr key 的 plain：[2:3]=day [4:5]=usr_data [6:7]=product */
function usrPlain(module, { usrData = 0x0FFF, days = 0 } = {}) {
  const entry = USR_MODULES[module];
  if (!entry) throw new Error('unknown module: ' + module);
  const [kind, versionMin] = entry;

  return (
    BigInt(kind) |
    (BigInt(versionMin) << 8n) |
    (BigInt(days & 0xFFFF) << 16n) |
    (BigInt(usrData & 0xFFFF) << 32n) |
    (BigInt(USR_PRODUCT) << 48n)
  );
}

/** 16 位大写十六进制 → 4 段连字符形式（SDK 接受的呈现格式） */
function dashed(hex) {
  return hex.match(/.{4}/g).join('-');
}

function generateDevKey(module, opts = {}) {
  return dashed(formatKey(encryptLicenseKey(devPlain(module, opts.version, opts.mid))));
}

function generateUsrKey(module, opts = {}) {
  return dashed(formatKey(encryptLicenseKey(usrPlain(module, opts))));
}

module.exports = {
  generateDevKey,
  generateUsrKey,
  encryptLicenseKey,
  formatKey,
  dashed,
  devPlain,
  usrPlain,
};
