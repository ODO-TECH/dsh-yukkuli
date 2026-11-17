'use strict';

/**
 * WAV 头解析。
 *
 * 为什么值得单独一个模块：AQTK10 的输出采样率**不是固定的**。
 * fsc 参数直接改采样率（16000 × fsc / 100），而 F3 预设的 fsc = 148，
 * 输出就是 23680Hz。
 *
 * 之前好几处硬编码 16000 / 32000 算时长，遇到 F3 声音就会算错，
 * 界面上显示的秒数跟实际对不上。
 */

/**
 * @param {Buffer} buf
 * @returns {{hz:number, channels:number, bits:number, seconds:number}}
 */
function wavInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length <= 44) {
    return { hz: 0, channels: 0, bits: 0, seconds: 0 };
  }

  // 不是 RIFF 就不猜
  if (buf.slice(0, 4).toString() !== 'RIFF') {
    return { hz: 0, channels: 0, bits: 0, seconds: 0 };
  }

  const channels = buf.readUInt16LE(22) || 1;
  const hz = buf.readUInt32LE(24) || 16000;
  const bits = buf.readUInt16LE(34) || 16;
  const bytesPerFrame = (bits / 8) * channels;

  return {
    hz,
    channels,
    bits,
    seconds: (buf.length - 44) / bytesPerFrame / hz,
  };
}

/** 只要秒数时用这个 */
function wavSeconds(buf) {
  return wavInfo(buf).seconds;
}


/**
 * 音高调整：改 WAV 头的采样率。
 *
 * 为什么是「改头」而不是重采样：
 *   AQTK1 / AQTK2 没有音高参数，只有速度。
 *   把采样率乘 N，播放器就以 N 倍速播 —— 音高和语速同时乘 N。
 *   这跟 AQTK10 的 fsc 是同一个道理（手册：「サンプリング周波数を変化するだけ」）。
 *
 * 所以想「音高升 4% 且语速慢 4%」= speed 92 + pitch 1.04。
 * 语速由引擎的 speed 参数控制，音高由这里控制，两者互相补偿。
 *
 * 只改头部 4 个字节，不重采样：无失真、零 CPU 开销。
 *
 * @param {Buffer} buf WAV
 * @param {number} factor 倍数，>0；1 表示不变
 * @returns {Buffer}
 */
function shiftPitch(buf, factor) {
  if (!(factor > 0)) {
    throw new Error('pitch 必须是正数，收到: ' + factor);
  }
  if (!Buffer.isBuffer(buf) || buf.length <= 44 || buf.slice(0, 4).toString() !== 'RIFF') {
    return buf;
  }
  if (factor === 1) return buf;

  const out = Buffer.from(buf);
  const hz = out.readUInt32LE(24) || 16000;
  out.writeUInt32LE(Math.round(hz * factor), 24);
  return out;
}

module.exports = { wavInfo, wavSeconds, shiftPitch };
