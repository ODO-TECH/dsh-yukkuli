'use strict';

/**
 * TUI 播放器：用外部 mpv 播 WAV。
 *
 * 为什么 TUI 需要单独一套：TUI 端没有 webServer，
 * 服务端那条 /audio?id= 的链接在那边根本没有意义。
 * 所以直接落临时文件 → spawn mpv → 播完删掉。
 *
 * 临时文件用完即删：语音内容不该在硬盘上留痕。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// mpv 从 PATH 找 —— 装好 mpv 后把它的目录加进 PATH 就行。
// 想指定某一个具体的那份：设 YUKKURI_MPV，或者调用时传 mpvPath。
// （以前这里写死过一个本机绝对路径，别人装上去必然 spawn ENOENT。）
const DEFAULT_MPV = 'mpv';

/**
 * @param {{mpvPath?: string, spawnFn?: Function, onError?: Function, mute?: boolean}} [opts]
 *
 * mute：只记账、不落盘、不 spawn。测试用 —— 跑测试时用户正坐在同一台机器前，
 * 让单测把扬声器叫起来既吓人又没法判断「到底是不是插件在念」。
 */
function createTuiPlayer(opts = {}) {
  const mpvPath = opts.mpvPath || process.env.YUKKURI_MPV || DEFAULT_MPV;
  const spawnFn = opts.spawnFn || spawn;
  const onError = opts.onError || (() => {});
  const mute = opts.mute === true || process.env.YUKKURI_MUTE === '1';

  let dir = null;
  let seq = 0;
  let proc = null;
  let current = null;
  const queue = [];
  let stopped = false;
  let plays = 0;

  function ensureDir() {
    if (!dir) {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yukkuri-'));
    }
    return dir;
  }

  function cleanup(file) {
    if (!file) return;
    try { fs.unlinkSync(file); } catch {}
    // 目录空了就顺手删掉，别等 dispose()。
    // dispose() 只在正常退出时执行；TUI 直接关窗口（或进程被强杀）时它不会跑，
    // 于是每起一次进程就在 %TEMP% 里留一个空目录 —— 实测攒了两百多个。
    // 队列里还有待播文件时目录非空，rmdir 会失败，正好保留。
    if (dir) {
      try {
        fs.rmdirSync(dir);
        dir = null;
      } catch {}
    }
  }

  function next() {
    if (stopped) return;
    const item = queue.shift();
    if (!item) {
      current = null;
      return;
    }
    current = item;

    let child;
    try {
      child = spawnFn(mpvPath, ['--no-video', '--really-quiet', '--no-terminal', item.file], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (err) {
      onError(err, item);
      cleanup(item.file);
      next();
      return;
    }

    proc = child;

    const done = () => {
      if (proc === child) proc = null;
      cleanup(item.file);
      if (stopped) return;
      next();
    };

    child.on('exit', done);
    child.on('error', (err) => {
      onError(err, item);
      done();
    });
  }

  return {
    /** 排进队列；空闲就立刻播 */
    play(wav, meta) {
      if (!wav || !wav.length) return null;
      stopped = false;
      plays += 1;

      if (mute) return { file: null, meta: meta || null };

      const file = path.join(ensureDir(), 'seg-' + ++seq + '.wav');
      fs.writeFileSync(file, wav);

      const item = { file, meta: meta || null };
      queue.push(item);
      if (!proc) next();
      return item;
    },

    stop() {
      stopped = true;
      queue.length = 0;
      if (proc) {
        try { proc.kill(); } catch {}
        proc = null;
      }
      const cur = current;
      current = null;
      if (cur) cleanup(cur.file);
    },

    isPlaying() {
      return proc !== null;
    },

    /** 累计被要求播放的段数（mute 时也记账） */
    playedCount() {
      return plays;
    },

    /** 队列长度（含正在播的那条） */
    depth() {
      return queue.length + (proc ? 1 : 0);
    },

    /** 退出时把临时目录一起清掉 */
    dispose() {
      this.stop();
      if (dir) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
        dir = null;
      }
    },
  };
}

module.exports = { createTuiPlayer, DEFAULT_MPV };
