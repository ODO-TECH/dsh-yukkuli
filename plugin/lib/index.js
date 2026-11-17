// DSH 油库里朗读 · 宿主半边
//
// 盯着你选的会话 → 轮次结束时切段合成 → 通过 HTTP 路由喂给前端播放。
//
// 监听/筛选那套照 dsh-tts-bridge 的做法（同一套 DSH 验证过），
// 但发声换成本地 AQTK10：不依赖浏览器、不依赖任何网页端。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { createWatcher } from './watch.cjs';
import { createPoller } from './poller.cjs';
import { createPipeline } from './pipeline.cjs';
import { createTuiPlayer } from './player-tui.cjs';
import { resolveCorePath } from './core-path.cjs';

export const name = 'yukkuri-tts';

// 只声明真正的硬依赖。
//
// 教训（来自 dsh-bionic-memory 的注释）：Cordis 的 ctx 是代理对象，
// 只放行 inject 声明过的属性；碰未声明的会抛。
// 而 TUI 端**没有 webServer** —— 把它写进 inject 会让整个插件在 TUI 里拒绝加载。
// 所以 webServer / sessionTitle 一律用 ctx.inject 按需获取。
export const inject = ['sessions'];

const P = '/dsh-yukkuri';

// ---------- 进程级的「轮次只处理一次」 ----------
//
// 现象（用户实测）：同一段话被念好几遍。服务端的一次性投递只保证
// 「同一个段不会被拉两次」，挡不住「同一轮被触发多次」—— 触发两次就
// 合成出两套 id 不同的段，每套都只投递一次，于是全都播出来。
//
// 触发次数为什么会涨到 N：插件被重复 apply（热重载 / 多次注入）时，
// 每个实例都有自己的 watcher + poller，各自按自己的游标走一遍同一轮。
// 闭包不共享，所以幂等表必须挂在 globalThis 上（同一进程内共享）。
const G = globalThis;

const seenTurns = G.__yukkuriSeenTurns || (G.__yukkuriSeenTurns = new Map());
const stats = G.__yukkuriStats || (G.__yukkuriStats = {
  applies: 0,
  triggers: 0,      // onTurn 被调了几次
  dups: 0,          // 其中被幂等挡掉的
  plays: 0,         // 真正交给播放器（TUI 的 mpv）的段数
  turns: [],        // 最近触发记录（最多 50 条）
});
// 老进程里可能已经有一份没有 plays 字段的表（热重载），补上
if (typeof stats.plays !== 'number') stats.plays = 0;

// 播放层面的去重：同一段音频在这个进程里最多播一次。
//
// claimTurn 保证「同一轮只合成一次」，但那只管到合成。
// 段一旦进了共享队列，理论上任何持有队列的实例都能把它交给播放器；
// 这个集合让「同一段播两遍」在播放这最后一环也堵死。
const playedIds = G.__yukkuriPlayed || (G.__yukkuriPlayed = new Set());
const MAX_PLAYED = 1000;
// 每次 apply 自增：这个数字 > 1 就说明插件被重复加载了
stats.applies += 1;

const MAX_SEEN = 500;
const MAX_STATS_TURNS = 50;

/**
 * 认领一轮。返回 false 表示这一轮已经被别的实例处理过。
 * sessionId + turn 是天然的主键：一轮只该合成一次。
 */
function claimTurn(sessionId, turn) {
  const key = String(sessionId) + ':' + String(turn);
  if (seenTurns.has(key)) return false;
  seenTurns.set(key, Date.now());

  // 有界：超过上限按写入时间清掉最老的一批，防止长跑进程无限涨
  if (seenTurns.size > MAX_SEEN) {
    const entries = Array.from(seenTurns.entries()).sort((a, b) => a[1] - b[1]);
    for (const [k] of entries.slice(0, seenTurns.size - MAX_SEEN)) seenTurns.delete(k);
  }
  return true;
}

// 配置落盘，重启也在。
// YUKKURI_CFG_PATH 可以整个覆盖 —— 测试用它能避免污染真实配置。
const CFG_DIR = process.env.DSH_HOME || join(homedir(), '.dsh');
const CFG_PATH = process.env.YUKKURI_CFG_PATH || join(CFG_DIR, 'yukkuri-tts.json');

const DEFAULTS = {
  enabled: true,
  watch: [],
  voice: 'reimu',
  emotion: 'neutral',
  maxKana: 100,
  intervalMs: 1500,
  keepSegments: 40,   // 保留最近多少段音频在内存里给前端取
  // 念出来的声音往哪送：auto（自己判断）| tui（本机 mpv）| web（浏览器来取）
  //
  // 为什么要这个开关：TUI 进程里也有 webServer（dsh-tui-webserver 为 OAuth
  // 挂在 127.0.0.1 的随机端口上），所以「有没有 webServer」分不出 TUI 和 Web。
  // 分不出来的后果就是 TUI 里一句不响 —— 音频全进了 /pending，而没人来取。
  mode: 'auto',
};

const MODES = ['auto', 'tui', 'web'];

// 命令失败时的返回值：DSH 的 CommandResult 错误分支
const fail = (text) => ({ kind: 'error', text });

function loadCfg() {
  try {
    const raw = JSON.parse(readFileSync(CFG_PATH, 'utf8'));
    return {
      ...DEFAULTS,
      ...raw,
      watch: Array.isArray(raw.watch) ? raw.watch.map(String) : [],
      mode: MODES.includes(raw.mode) ? raw.mode : DEFAULTS.mode,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveCfg(cfg) {
  try {
    mkdirSync(CFG_DIR, { recursive: true });
    writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('[油库里] 存配置失败：' + (err && err.message));
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 100000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
};

export function apply(ctx) {
  const cfg = loadCfg();
  const say = (m) => console.log('[油库里] ' + m);

  // 可选服务：拿不到就降级，不影响插件加载
  let sessionTitle = null;
  try {
    ctx.inject(['sessionTitle'], (scope) => {
      sessionTitle = scope.sessionTitle;
    });
  } catch {}

  const titleOf = (s) => {
    if (!sessionTitle) return '(未命名)';
    try {
      const snap = sessionTitle.get(s);
      return (snap && snap.title) || '(未命名)';
    } catch {
      return '(未命名)';
    }
  };

  // core 延迟加载：插件启动时不碰 DLL，避免拖慢 DSH 开机
  const require = createRequire(import.meta.url);
  let coreMod = null;
  let pipeline = null;
  let wavSeconds = (buf) => (buf && buf.length > 44 ? (buf.length - 44) / 2 / 16000 : 0);

  function ensureCore() {
    if (coreMod) return coreMod;

    // core 路径：环境变量 > 同仓库的 ../core/src > node_modules/yukkuri-core
    // 三条都不通就抛出带候选清单的错误 —— 这里没有写死的本机路径兜底，
    // 写死的那种兜底在作者机器上永远「刚好能用」，在别人机器上指向空气。
    const resolved = resolveCorePath({
      siblingBase: fileURLToPath(new URL('../../core/src', import.meta.url)),
      resolveModule: (id) => require.resolve(id),
    });
    const corePath = resolved.path;
    coreMod = require(corePath);

    // 采样率不是固定的（F3 声库 fsc=148 → 23680Hz），所以要读 WAV 头
    try {
      wavSeconds = require(corePath + '/wav').wavSeconds;
    } catch {
      wavSeconds = (buf) => (buf && buf.length > 44 ? (buf.length - 44) / 2 / 16000 : 0);
    }

    pipeline = createPipeline({
      synth: coreMod.synthe,
      extract: require(corePath + '/text/extract').extract,
      segment: require(corePath + '/text/segment').segment,
      onError: (err, info) => say('合成失败 [' + JSON.stringify(info) + ']: ' + (err && err.message)),
    });
    say('core 已加载（' + resolved.source + '）: ' + corePath);
    return coreMod;
  }

  // TUI 播放器：TUI 端没有 webServer，只能自己 spawn mpv
  const tuiPlayer = createTuiPlayer({
    onError: (err, info) => say('TUI 播放失败: ' + (err && err.message)),
    // YUKKURI_MUTE=1：只记账不 spawn。测试会加载真 core 与真插件，
    // 不静音的话跑一次单测就会在用户扬声器里念好几遍。
    mute: process.env.YUKKURI_MUTE === '1',
  });

  // webServer 是否真的挂上了（决定路由要不要注册）
  let hasWebServer = false;

  // 有没有浏览器真的在取音频 —— 只数 /pending，那是客户端唯一的轮询入口。
  //
  // 判断「这一轮该用 mpv 还是该交给浏览器」不能用 hasWebServer：
  // TUI 进程里也有 webServer（dsh-tui-webserver，只为 OAuth 挂在随机端口），
  // 于是插件在 TUI 里会以为前端在听，把音频全塞进 /pending，而 TUI 没有浏览器 ——
  // 表现就是「插件加载了、开关开着、一句不响」。这个 bug 真发生过（0.2.4）。
  let clientPolls = 0;
  let lastClientPollAt = 0;

  /**
   * 有没有浏览器接上过。
   *
   * 一旦接上就一直算接上（粘性），不做「最近 N 秒还活着吗」的新鲜度判断：
   * 浏览器切到后台会把定时器节流到一分钟一次，按新鲜度判断的话，
   * 用户切个标签页，下一轮就突然从服务器音箱里冒出来了。
   */
  function browserAttached() {
    return clientPolls > 0;
  }

  /**
   * 这一轮合成出来的声音交给谁：
   *   'tui' —— 本机 mpv 直接放
   *   'web' —— 进广播队列，等浏览器轮询来取
   */
  function deliverMode() {
    if (cfg.mode === 'tui' || cfg.mode === 'web') return cfg.mode;
    if (!hasWebServer) return 'tui';
    return browserAttached() ? 'web' : 'tui';
  }

  // 音频段：保留最近 N 段给前端取。
  //
  // 存在 globalThis 上而不是闭包里 —— 这是「重复触发」修复的另一半。
  // 插件被重复 apply 时会有多个实例，如果各持一份队列：
  //   ① 只有持有路由的那个实例的段能被前端拿到，别的实例合成出来的是死数据；
  //   ② 反过来，若路由被后注册的实例覆盖，而合成发生在先注册的实例上，
  //      用户就会「听不到」（比念两遍更糟）。
  // 共享一份队列之后，谁合成、谁服务都不影响结果：队列只有一条，
  // 配合 claimTurn 的轮次幂等，同一轮既不会合成两次，也不会丢。
  const store = G.__yukkuriStore || (G.__yukkuriStore = {
    segments: new Map(),
    order: [],
    nextId: 1,
  });
  const segments = store.segments;
  const order = store.order;

  /**
   * 存一段音频。
   *
   * broadcast 决定它进不进「自动朗读」的待播队列（/pending）：
   *   自动朗读（onTurn 合成）→ true，让浏览器轮询来取
   *   手动朗读（/speak、/say）→ false，调用方自己已经拿到并播了
   *
   * 这个区分是必须的：手动朗读的段如果也进广播队列，
   * 浏览器轮询会把它再播一遍 —— 表现就是「点一次念两遍」，
   * 而且按了暂停之后又被轮询拉回来，感觉像停不掉。
   */
  function pushSegment(sessionId, turn, seg, { broadcast = true } = {}) {
    const id = String(store.nextId++);
    const item = {
      id,
      sessionId,
      turn,
      index: seg.index,
      text: seg.text,
      seconds: seg.seconds,
      wav: seg.wav,
      broadcast,
      // delivered 是「已经交给某个浏览器」的标记，见 /pending。
      // 一次性投递：谁先拉走，别人就拿不到了。
      delivered: false,
      at: Date.now(),
    };
    segments.set(id, item);
    order.push(id);

    while (order.length > cfg.keepSegments) {
      segments.delete(order.shift());
    }
    return item;
  }

  // ---------- 监听到一轮结束 ----------
  const watcher = createWatcher({
    onError: (err, id) => say('监听出错 [' + id + ']: ' + (err && err.message)),
    onTurn: async ({ sessionId, turn, text }) => {
      stats.triggers += 1;

      // 幂等闸门：同一轮只合成一次，不管外面有几个 watcher 在跑。
      // 放在最前面 —— 连 enabled 判断之前，这样「关着的时候被触发过」
      // 也会被记下来，不会因为中途打开又补念一遍。
      if (!claimTurn(sessionId, turn)) {
        stats.dups += 1;
        say('跳过重复触发 [' + sessionId + ' / turn ' + turn + '] 第 ' + stats.triggers + ' 次触发');
        return;
      }

      stats.turns.push({ sessionId, turn, at: Date.now(), chars: text.length });
      if (stats.turns.length > MAX_STATS_TURNS) stats.turns.shift();

      if (!cfg.enabled) {
        say('朗读已关闭，跳过这一轮');
        return;
      }
      say('收到一轮 [' + sessionId + ' / turn ' + turn + ']，' + text.length + ' 字');

      try {
        ensureCore();
        const segs = await pipeline.render(text, {
          voice: cfg.voice,
          emotion: cfg.emotion,
          maxKana: cfg.maxKana,
        });

        const mode = deliverMode();
        // 只有交给浏览器的段才进广播队列。TUI 自己放了，还留在队列里的话，
        // 万一以后有浏览器接上，就会把过去听过的再念一遍。
        const items = segs.map((seg) => pushSegment(sessionId, turn, seg, { broadcast: mode === 'web' }));

        // Web：段留在内存里等前端拉。
        // TUI：直接交给 mpv 播 —— 但同一段只播一次。
        if (mode === 'tui') {
          for (const item of items) {
            if (playedIds.has(item.id)) continue;
            playedIds.add(item.id);
            stats.plays += 1;
            tuiPlayer.play(item.wav, { sessionId, turn: item.turn, text: item.text });
          }

          if (playedIds.size > MAX_PLAYED) {
            const keep = Array.from(playedIds).slice(-MAX_PLAYED / 2);
            playedIds.clear();
            for (const k of keep) playedIds.add(k);
          }
        }

        say('合成完成，' + segs.length + ' 段（' + (mode === 'tui' ? 'TUI 直接播放' : '等浏览器取') + '）');
      } catch (err) {
        say('整轮合成失败: ' + (err && err.message));
      }
    },
  });

  watcher.setWatching(cfg.watch);

  // 这个实例自己轮询了多少次（诊断用：用来确认「基线已经立好了」）
  let polls = 0;

  // 监听名单是不是「全都指向不存在的会话」——只提示一次。
  //
  // TUI 端最容易踩的坑：名单里存的是上一个会话（比如从 Web 切过来），
  // 那些 id 在当前进程里根本不存在，于是 watcher 永远匹配不上，
  // 表现就是「插件明明加载了、开关也开着，却一句都不念」，而且没有任何提示。
  let staleWarned = false;

  const poller = createPoller({
    list: () => ctx.sessions.list(),
    onPoll: (sessions) => {
      polls += 1;

      let watching = cfg.watch;

      // TUI 兜底：监听名单为空、或者指向的是别的进程里的会话时，
      // 退化成「念当前进程里的会话」。
      //
      // 为什么需要这一段：TUI 没有勾选界面，watch 往往是上次在 Web 端选的，
      // 切到 TUI 后那些 id 在当前进程里根本不存在 —— 插件加载正常、开关也开着，
      // 却一句都不念，而且没有任何提示。用户只会觉得「坏的」。
      //
      // 三个前提缺一不可：
      //   · 从来没有浏览器来取过音频（真 TUI；Web 端客户端 1.5s 就拉一次）
      //   · 已经轮询过几轮（也给 webServer 注册留出时间，避免启动瞬间乱绑）
      //   · 名单为空或全都不在线
      //
      // 判据是 clientPolls 而不是 hasWebServer：TUI 里也有 webServer。
      if (clientPolls === 0 && polls >= 4 && cfg.enabled) {
        const live = sessions.map((s) => String(s.id));
        const anyLive = cfg.watch.some((id) => live.includes(String(id)));
        if (live.length && !anyLive) {
          watching = live;
          if (!staleWarned) {
            staleWarned = true;
            say(
              'TUI 端没有可用的监听名单（现在是 ' + (cfg.watch.join(', ') || '空') + '），' +
              '先按当前进程里的 ' + live.length + ' 个会话来念。' +
              '想固定下来就 /yukkuri on。'
            );
          }
        }
      }

      watcher.setWatching(watching);
      watcher.poll(sessions);
    },
    onError: (err) => say('轮询出错: ' + (err && err.message)),
  });

  // ---------- 路由 ----------
  // 路由只在 webServer 存在时注册（TUI 没有 webServer，这里什么都不做）
  let routesMounted = 0;
  const route = (path, handler) => {
    try {
      ctx.inject(['webServer'], (scope) => {
        hasWebServer = true;
        ctx.effect(() =>
          scope.webServer.register({
            kind: 'exact',
            path,
            handler: async (req, res) => {
              try {
                await handler(req, res);
              } catch (err) {
                say('路由 ' + path + ' 出错：' + (err && err.message));
                try {
                  res.writeHead(500, JSON_HEADERS);
                  res.end(JSON.stringify({ ok: false, error: String(err && err.message) }));
                } catch {}
              }
            },
          })
        );
        routesMounted += 1;
      });
    } catch (err) {
      say('跳过路由 ' + path + '：' + (err && err.message));
    }
  };

  const reply = (res, code, obj) => {
    res.writeHead(code, JSON_HEADERS);
    res.end(JSON.stringify(obj));
  };

  route(P + '/state', async (req, res) => {
    reply(res, 200, {
      ok: true,
      cfg,
      segments: order.length,
      latest: order.length ? order[order.length - 1] : null,
      // 诊断：applies > 1 说明插件被重复加载过；dups > 0 说明确实有重复触发被挡住
      diag: {
        applies: stats.applies,
        triggers: stats.triggers,
        dups: stats.dups,
        plays: stats.plays,
      },
      // 声音往哪送（诊断 TUI 不响时先看这个）
      mode: cfg.mode,
      deliver: deliverMode(),
    });
  });

  /**
   * 诊断用：到底是一轮里头被触发了 N 次，还是客户端播了 N 遍？
   *
   * 看 applies：> 1 → 插件被重复 apply（热重载累积），这是重复的源头。
   * 看 triggers / dups：triggers 涨而 dups 不涨，说明每次触发都是「新的一轮」；
   *   triggers 涨 dups 也涨，说明同一轮被反复触发，已被幂等挡住。
   * 看 turns：最近触发过的 (sessionId, turn) 列表，重复的 turn 会在这里露出来。
   */
  route(P + '/stats', async (req, res) => {
    reply(res, 200, {
      ok: true,
      applies: stats.applies,
      triggers: stats.triggers,
      dups: stats.dups,
      // 真正交给播放器的段数。它比 segments 小，就说明 playedIds 在挡重复播放。
      plays: stats.plays,
      seenTurns: seenTurns.size,
      segments: order.length,
      polls,
      poller: poller.isRunning ? { running: true, intervalMs: poller.getInterval() } : { running: false },
      watch: cfg.watch,
      enabled: cfg.enabled,
      hasWebServer,
      mode: cfg.mode,
      deliver: deliverMode(),
      clientPolls,
      turns: stats.turns.slice(-20),
    });
  });

  // ---------- 按 messageId 找消息文字 ----------
  // 网页端插槽同时给 sessionId 和 messageId；
  // 桌面端只给 messageId —— 那就挨个会话找一遍（几次内存查找而已）。
  const textOfMessage = (sessionId, messageId) => {
    if (!sessionId || !messageId) return '';
    const s = ctx.sessions.get(sessionId);
    if (!s) return '';

    const pick = (m) => {
      const parts = [];
      if (Array.isArray(m && m.content)) {
        for (const b of m.content) {
          if (b && b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
            parts.push(b.text.trim());
          }
        }
      }
      if (!parts.length && typeof (m && m.text) === 'string' && m.text.trim()) {
        parts.push(m.text.trim());
      }
      return parts.join('\n\n');
    };

    // ① 官方推导（首选）
    try {
      if (typeof s.deriveMessages === 'function') {
        const list = s.deriveMessages() || [];
        for (let i = list.length - 1; i >= 0; i--) {
          const m = list[i];
          if (!m || String(m.id) !== String(messageId)) continue;
          const t = pick(m);
          if (t) return t;
        }
      }
    } catch {}

    // ② 退路：自己扒事件
    let events = [];
    try {
      events = s.snapshotEvents(0);
    } catch {
      return '';
    }
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type !== 'assistant/message') continue;
      const m = ev.data && ev.data.message;
      if (!m || String(m.id) !== String(messageId)) continue;
      const t = pick(m);
      if (t) return t;
      // ③ 恢复过的会话：文字在 stream 的 text-chunks 里
      const chunks = ev.data && ev.data.stream;
      if (Array.isArray(chunks)) {
        const acc = [];
        for (const r of chunks) {
          if (r && r.type === 'text-chunks' && Array.isArray(r.texts)) {
            for (const x of r.texts) if (typeof x === 'string' && x.trim()) acc.push(x.trim());
          }
        }
        if (acc.length) return acc.join('');
      }
      return '';
    }
    return '';
  };

  const locate = (sessionId, messageId) => {
    const tries = [];
    const add = (id) => {
      const s = String(id || '');
      if (s && !tries.includes(s)) tries.push(s);
    };
    add(sessionId);
    try {
      for (const s of ctx.sessions.list()) add(s.id);
    } catch {}
    for (const id of tries) {
      const text = textOfMessage(id, messageId);
      if (text) return { sessionId: id, text };
    }
    return null;
  };

  route(P + '/config', async (req, res) => {
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'POST only' });
    const body = await readJson(req);

    for (const k of ['enabled', 'voice', 'emotion', 'maxKana', 'intervalMs', 'keepSegments']) {
      if (body[k] !== undefined) cfg[k] = body[k];
    }
    if (Array.isArray(body.watch)) {
      // 名单变了：忘掉旧游标，避免把「没在听」期间的话补念出来
      cfg.watch = body.watch.map(String);
      watcher.reset();
      // 游标没了，要等下一轮轮询重新立基线。
      // polls 归零让外部（测试 / 诊断）能看出「基线还没立好」。
      polls = 0;
    }

    saveCfg(cfg);
    say('配置已更新: 监听 ' + cfg.watch.length + ' 个会话，声源 ' + cfg.voice);
    reply(res, 200, { ok: true, cfg });
  });

  route(P + '/sessions', async (req, res) => {
    const list = [];
    try {
      for (const s of ctx.sessions.list()) {
        list.push({
          id: String(s.id),
          title: titleOf(s),
          watching: cfg.watch.includes(String(s.id)),
        });
      }
    } catch (err) {
      return reply(res, 500, { ok: false, error: String(err && err.message) });
    }
    reply(res, 200, { ok: true, sessions: list });
  });

  /**
   * 待播队列：**一次性投递**。
   *
   * 这一段为什么不靠「客户端选主」解决重复播放：
   * 实测下来重复的来源不止一种 —— 脚本被加载多次、开了多个标签页、
   * 主标签页心跳过期被别人接管，任何一种都会让同一段被拉好几遍。
   * 每多一份就多一个 <audio>，听感是同一句话叠着念，
   * 而且按暂停只停得住自己那一个，剩下的还在响。
   *
   * 所以把「谁是唯一的播放者」这件事放到服务端裁决：
   * 段被拉走的那一刻就打上 delivered，后面的请求一律拿不到。
   * 客户端就算有十个实例、十个标签页，也只有一个能拿到这一段。
   *
   * 代价：如果拉走它的那个客户端没能播放（比如浏览器拦截了自动播放），
   * 这段就没人播了。这是刻意选的 —— 漏播一次可以手动点小喇叭补，
   * 叠加播五遍却是必须停下来的噪音。
   */
  route(P + '/pending', async (req, res) => {
    // 有人在轮询 = 有浏览器在听。deliverMode() 靠它区分 TUI 和 Web。
    clientPolls += 1;
    lastClientPollAt = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const after = url.searchParams.get('after') || '0';
    const list = [];
    for (const id of order) {
      if (Number(id) <= Number(after)) continue;
      const s = segments.get(id);
      // 手动朗读 / 试听的段不进广播流（否则会被再播一遍）
      if (!s || !s.broadcast || s.delivered) continue;

      s.delivered = true;
      list.push({
        id: s.id,
        sessionId: s.sessionId,
        turn: s.turn,
        index: s.index,
        text: s.text,
        seconds: s.seconds,
        url: P + '/audio?id=' + s.id,
      });
    }
    reply(res, 200, { ok: true, segments: list });
  });

  route(P + '/audio', async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const id = url.searchParams.get('id');
    const seg = segments.get(String(id));
    if (!seg) return reply(res, 404, { ok: false, error: 'no such segment' });
    res.writeHead(200, {
      'content-type': 'audio/wav',
      'content-length': seg.wav.length,
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    });
    res.end(seg.wav);
  });

  // 念指定的那一条回复（点小喇叭时调这个）
  route(P + '/speak', async (req, res) => {
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'POST only' });
    const body = await readJson(req);
    const found = locate(body.sessionId, body.messageId);
    if (!found) {
      return reply(res, 404, { ok: false, error: '找不到这条消息（可能已被归档或清理）' });
    }

    try {
      ensureCore();
      const segs = await pipeline.render(found.text, {
        voice: cfg.voice,
        emotion: cfg.emotion,
        maxKana: cfg.maxKana,
      });

      const out = [];
      for (const seg of segs) {
        const item = pushSegment(found.sessionId, null, seg, { broadcast: false });
        // TUI 里没有浏览器来播，直接走 mpv —— 否则点了小喇叭什么也听不到
        if (deliverMode() === 'tui') tuiPlayer.play(item.wav, { sessionId: found.sessionId, text: item.text });
        out.push({
          id: item.id,
          index: item.index,
          text: item.text,
          seconds: item.seconds,
          url: P + '/audio?id=' + item.id,
        });
      }

      say('手动朗读 [' + found.sessionId + '] ' + out.length + ' 段');
      reply(res, 200, { ok: true, segments: out });
    } catch (err) {
      reply(res, 500, { ok: false, error: String(err && err.message) });
    }
  });

  /**
   * 把没播成的段还回队列。
   *
   * /pending 是一次性投递（拉走就置 delivered），代价是：
   * 浏览器因为自动播放策略拒绝了 play()，这一段就永远没人播了。
   * 那是「静默吞掉用户的朗读」，比重复播放更难发现 —— 用户只会觉得没反应。
   *
   * 所以客户端播不出来时，把 id 还回来，让它下一轮还能被取走。
   * 还回来的段保持 broadcast，仍在原广播流里。
   */
  route(P + '/release', async (req, res) => {
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'POST only' });
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    let released = 0;
    for (const id of ids) {
      const s = segments.get(id);
      if (s && s.broadcast && s.delivered) {
        s.delivered = false;
        released += 1;
      }
    }
    reply(res, 200, { ok: true, released });
  });

  // 立刻念一句（试听 / 调试）
  route(P + '/say', async (req, res) => {
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'POST only' });
    const body = await readJson(req);
    const text = String(body.text || '').trim();
    if (!text) return reply(res, 400, { ok: false, error: 'text 不能为空' });

    const t0 = Date.now();
    try {
      const c = ensureCore();
      const wav = await c.synthe(text, {
        voice: body.voice || cfg.voice,
        emotion: body.emotion || cfg.emotion,
      });
      // 试听的段不进广播队列（调用方自己播，别再被轮询捞一次）
      const item = pushSegment(null, null, { index: 0, text, seconds: wavSeconds(wav), wav }, { broadcast: false });
      reply(res, 200, { ok: true, id: item.id, url: P + '/audio?id=' + item.id, ms: Date.now() - t0 });
    } catch (err) {
      reply(res, 500, { ok: false, error: String(err && err.message) });
    }
  });

  // 清空队列
  route(P + '/clear', async (req, res) => {
    segments.clear();
    order.length = 0;
    reply(res, 200, { ok: true });
  });

  // 当前会话 id：命令 handler 会带上 agent，从里面找 session
  let lastSessionId = null;
  function currentSessionId() {
    return lastSessionId;
  }

  // TUI 里改声源要能看见有哪些可选。core 的 presets.listAll() 是唯一真相，
  // 但 core 没加载成功时别把命令整条弄挂 —— 返回 null，调用方回一句提示即可。
  function voiceTable() {
    try {
      const all = ensureCore().presets.listAll();
      const ids = all.map((v) => v.id);
      const presets = all.filter((v) => v.kind === 'preset').map((v) => v.id);
      const chars = all.filter((v) => v.kind === 'character').map((v) => v.id);
      const lines = [
        '  预设: ' + presets.join(' '),
        '  角色: ' + chars.join(' '),
      ].join('\n');
      return { ids, lines };
    } catch {
      return null;
    }
  }

  function emotionList() {
    try {
      return Object.keys(ensureCore().presets.EMOTIONS);
    } catch {
      return null;
    }
  }

  // 命令实现：成功时返回字符串，失败时返回 { kind:'error', text }，
  // 由上面注册的 handler 统一包成 DSH 的 CommandResult。
  // 加子命令时只写字符串，不会漏包对象。
  async function runCommand(invocation, legacyMeta) {
    const inv = invocation && typeof invocation === 'object' ? invocation : null;
    const meta = legacyMeta || null;

    // 记下当前会话 —— /yukkuri on 要靠它只监听当前这个
    try {
      const sid =
        (inv && inv.agent && inv.agent.session && inv.agent.session.id) ||
        (inv && inv.agent && inv.agent.id) ||
        (inv && inv.sessionId) ||
        (meta && meta.sessionId) ||
        (meta && meta.agent && meta.agent.session && meta.agent.session.id) ||
        (meta && meta.agent && meta.agent.id);
      if (sid) lastSessionId = String(sid);
    } catch {}

    const raw = typeof invocation === 'string'
      ? invocation
      : (inv && typeof inv.rawInput === 'string' ? inv.rawInput : '');
    const sub = String(raw || '').trim();

    if (!sub || sub === 'status') {
      return [
        '油库里朗读: ' + (cfg.enabled ? '开' : '关'),
        '  监听会话: ' + (cfg.watch.length ? cfg.watch.join(', ') : '(无)'),
        '  声源/情绪: ' + cfg.voice + ' / ' + cfg.emotion,
        '  出声方式: ' + cfg.mode + '（现在走 ' + deliverMode() + '）',
        '  分段上限: ' + cfg.maxKana + ' 假名 · 轮询 ' + poller.getInterval() + 'ms · 保留 ' + cfg.keepSegments + ' 段',
        '  段落: ' + order.length + ' 个在内存里',
        '  改设置: /yukkuri help',
      ].join('\n');
    }

    if (sub === 'mode' || sub.startsWith('mode ')) {
      const arg = sub.slice(4).trim();
      if (!arg) {
        return '出声方式: ' + cfg.mode + '（现在走 ' + deliverMode() + '）' +
          '\n  auto —— 有浏览器在轮询就走浏览器，否则直接用 mpv' +
          '\n  tui  —— 总是用本机 mpv 放' +
          '\n  web  —— 总是留给浏览器取';
      }
      if (!MODES.includes(arg)) return fail('只能是 auto / tui / web，收到: ' + arg);
      cfg.mode = arg;
      saveCfg(cfg);
      return '出声方式已设为: ' + arg + '（现在走 ' + deliverMode() + '）';
    }

    if (sub === 'on') {
      cfg.enabled = true;
      // TUI 没有「听谁」的界面，所以「开」= 只听当前这个会话。
      // 拿不到当前会话就只开总开关，不擅自把别的会话也拉进来。
      const cur = currentSessionId();
      if (cur && !cfg.watch.includes(cur)) {
        cfg.watch = [cur];
        watcher.reset();
      }
      saveCfg(cfg);
      return cur
        ? '油库里朗读已开启，只听当前会话 ' + cur
        : '油库里朗读已开启（拿不到当前会话，需要主动 /yukkuri watch <id>）';
    }

    if (sub === 'off') {
      cfg.enabled = false;
      saveCfg(cfg);
      return '油库里朗读已关闭';
    }

    if (sub === 'stop') {
      tuiPlayer.stop();
      return '已停止（TUI 播放队列已清空）';
    }

    if (sub === 'watch') {
      return '当前监听: ' + (cfg.watch.length ? cfg.watch.join(', ') : '(无)') +
        '\n用 /yukkuri watch <id> 或 /yukkuri watch all 修改';
    }

    if (sub.startsWith('watch ')) {
      const arg = sub.slice(6).trim();
      if (arg === 'all') {
        cfg.watch = ctx.sessions.list().map((s) => String(s.id));
      } else if (arg === 'none') {
        cfg.watch = [];
      } else if (arg === 'current') {
        const cur = currentSessionId();
        if (!cur) return fail('拿不到当前会话 id');
        cfg.watch = [cur];
      } else {
        cfg.watch = arg.split(/[,\s]+/).filter(Boolean);
      }
      watcher.reset();
      saveCfg(cfg);
      return '监听已改为: ' + (cfg.watch.length ? cfg.watch.join(', ') : '(无)');
    }

    if (sub === 'help' || sub === '?') {
      return [
        '用法: /yukkuri <子命令>',
        '  status              看当前设置',
        '  on / off            开 / 关自动朗读（on 只绑当前会话）',
        '  mode [auto|tui|web] 声音往哪送',
        '  voice [id]          声源；不带参数列出全部可用',
        '  emotion [id]        情绪；不带参数列出全部',
        '  maxkana [n]         每段最多几个假名（10-500，默认 100）',
        '  interval [ms]       看会话列表的间隔（300-10000，默认 1500）',
        '  keep [n]            内存里保留多少段（5-500，默认 40）',
        '  watch [id|all|none|current]  监听哪些会话',
        '  say <文本>          立刻念一句',
        '  stop                清空播放队列',
      ].join('\n');
    }

    // 声源 / 情绪：不带参数就列出来，带参数要校验 ——
    // 打错一个字就静默合成失败，比直接回一句「没有这个声源」难查得多。
    if (sub === 'voice' || sub === 'voices') {
      const info = voiceTable();
      if (!info) return fail('拿不到声源列表（core 没加载成功）');
      return '可用声源（当前 ' + cfg.voice + '）:\n' + info.lines + '\n用 /yukkuri voice <id> 切换';
    }

    if (sub.startsWith('voice ')) {
      const id = sub.slice(6).trim();
      const info = voiceTable();
      if (info && !info.ids.includes(id)) {
        return fail('没有这个声源: ' + id + '\n' + info.lines);
      }
      cfg.voice = id;
      saveCfg(cfg);
      return '声源已切到: ' + id + '（下一轮生效）';
    }

    if (sub === 'emotion' || sub === 'emotions') {
      const list = emotionList();
      if (!list) return fail('拿不到情绪列表（core 没加载成功）');
      return '可用情绪（当前 ' + cfg.emotion + '）: ' + list.join(' / ') +
        '\n用 /yukkuri emotion <id> 切换';
    }

    if (sub.startsWith('emotion ')) {
      const id = sub.slice(8).trim();
      const list = emotionList();
      if (list && !list.includes(id)) {
        return fail('没有这个情绪: ' + id + '\n可用: ' + list.join(' / '));
      }
      cfg.emotion = id;
      saveCfg(cfg);
      return '情绪已切到: ' + id + '（下一轮生效）';
    }

    if (sub === 'maxkana' || sub.startsWith('maxkana ')) {
      const arg = sub.slice(7).trim();
      if (!arg) return '每段最多 ' + cfg.maxKana + ' 个假名（/yukkuri maxkana <10-500>）';
      const n = Number(arg);
      if (!Number.isInteger(n) || n < 10 || n > 500) return fail('要 10 到 500 的整数，收到: ' + arg);
      cfg.maxKana = n;
      saveCfg(cfg);
      return '分段上限已设为 ' + n + ' 个假名（下一轮生效）';
    }

    if (sub === 'interval' || sub.startsWith('interval ')) {
      const arg = sub.slice(8).trim();
      if (!arg) return '轮询间隔 ' + poller.getInterval() + 'ms（/yukkuri interval <300-10000>）';
      const n = Number(arg);
      if (!Number.isFinite(n) || n < 300 || n > 10000) return fail('要 300 到 10000 的毫秒数，收到: ' + arg);
      cfg.intervalMs = Math.round(n);
      saveCfg(cfg);
      // 真的重启定时器，不然要等下次启动才生效
      poller.start(cfg.intervalMs);
      return '轮询间隔已设为 ' + cfg.intervalMs + 'ms（立即生效）';
    }

    if (sub === 'keep' || sub.startsWith('keep ')) {
      const arg = sub.slice(4).trim();
      if (!arg) return '内存里保留最近 ' + cfg.keepSegments + ' 段（/yukkuri keep <5-500>）';
      const n = Number(arg);
      if (!Number.isInteger(n) || n < 5 || n > 500) return fail('要 5 到 500 的整数，收到: ' + arg);
      cfg.keepSegments = n;
      // 立刻按新上限裁一遍，不然要等到下一段才收
      while (order.length > cfg.keepSegments) {
        const old = order.shift();
        segments.delete(old);
      }
      saveCfg(cfg);
      return '保留段数已设为 ' + n + '（当前 ' + order.length + ' 段）';
    }

    if (sub.startsWith('say ')) {
      const text = sub.slice(4).trim();
      if (!text) return fail('用法: /yukkuri say <要念的话>');
      try {
        const c = ensureCore();
        const wav = await c.synthe(text, { voice: cfg.voice, emotion: cfg.emotion });
        const seconds = wavSeconds(wav);
        // 手动触发的段不进广播队列
        const item = pushSegment(null, null, { index: 0, text, seconds, wav }, { broadcast: false });

        const sec = seconds.toFixed(2) + 's';
        if (deliverMode() === 'tui') {
          // TUI：直接放出来听
          tuiPlayer.play(wav, { text });
          return '正在念（' + sec + '）';
        }
        return '已生成: ' + P + '/audio?id=' + item.id + '（' + sec + '）';
      } catch (err) {
        return fail('合成失败: ' + (err && err.message));
      }
    }

    return fail('未知子命令: ' + sub + '\n用 /yukkuri help 看全部用法');
  }

  // ---------- 命令（TUI 用） ----------
  try {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        name: 'yukkuri',
        description: '油库里朗读：状态 / 开关 / 声源 / 试听',
        recordInput: false,
        // DSH 真正传进来的只有一个对象：
        //   { commandId, agent, rawInput, attachments, signal }
        // 早先按 (args, meta) 写，结果 args 是那个对象本身 ——
        // String(args) === '[object Object]'，任何子命令都匹配不上，
        // 表现是「/yukkuri on 永远回未知子命令」，TUI 里也就绑不上当前会话。
        // 这里两种约定都收，旧的字符串调用仍然能走。
        // DSH 只认 CommandResult：{ kind: 'success' | 'error', text }。
        // 返回裸字符串会被直接判错 —— "command handler must return a CommandResult"，
        // TUI 里表现就是每次敲 /yukkuri 都报这一行，什么都没执行。
        // 实现放在下面的 runCommand 里，这里只负责包装。
        handler: async (invocation, legacyMeta) => {
          try {
            const out = await runCommand(invocation, legacyMeta);
            if (out && typeof out === 'object') return out; // fail(...)
            return { kind: 'success', text: String(out) };
          } catch (err) {
            return { kind: 'error', text: '油库里执行失败: ' + (err && err.message) };
          }
        },
      });
    });
  } catch (err) {
    say('命令注册失败（可能没有 commands 服务）: ' + (err && err.message));
  }

  // ---------- 启动轮询 ----------
  //
  // 不用 ctx.interval：它属于 timer 服务，而 ctx 是代理对象，
  // 没 inject 'timer' 就访问会抛 "cannot get property timer without inject"。
  // 实测这个坑会让轮询**完全不启动** —— 插件看着加载成功，但永远不朗读。
  // 自己开 setInterval 反而两端都稳（.unref() 保证不拖住进程退出）。
  try {
    // 环境变量可以覆盖，方便调参与测试（默认走配置里的 1500ms）
    const intervalMs = Number(process.env.YUKKURI_INTERVAL_MS) || cfg.intervalMs;

    // 上一份实例还在跑就把它停掉。
    //
    // 这是「一句话念五遍」的另一半根因：插件被重复 apply（热重载 / 重复注入）后，
    // 旧实例的定时器不会自己停，于是进程里躺着 N 个 poller，每个都盯着同一批会话。
    // claimTurn 已经保证「同一轮只合成一次」，但让旧的别再空转更干净 ——
    // 而且 applies 这个计数会一直涨，用户能直接看出来。
    const host = G.__yukkuriHost || (G.__yukkuriHost = { owner: null, stopPolling: null });
    // 测试用：把这个打开就能让两份实例同时跑，用来验证「轮次幂等」本身
    const keepOld = process.env.YUKKURI_KEEP_INSTANCES === '1';
    if (!keepOld && typeof host.stopPolling === 'function') {
      try {
        host.stopPolling();
        say('上一份实例还在跑，已停掉它的轮询');
      } catch (err) {
        say('停旧实例失败: ' + (err && err.message));
      }
    }

    const token = Symbol('yukkuri-host');
    poller.start(intervalMs);
    host.owner = token;
    host.stopPolling = () => poller.stop();

    ctx.effect(() => () => {
      poller.stop();
      // 只清自己那一份：新实例接管后，旧实例的 dispose 不该把新的一起清掉
      if (host.owner === token) {
        host.owner = null;
        host.stopPolling = null;
      }
    });
    say('轮询已启动（' + intervalMs + 'ms）');
  } catch (err) {
    say('轮询启动失败: ' + (err && err.message));
  }

  say('已加载 · 监听 ' + cfg.watch.length + ' 个会话 · 声源 ' + cfg.voice);
}
