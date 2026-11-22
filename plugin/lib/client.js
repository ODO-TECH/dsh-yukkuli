// DSH 油库里朗读 · 客户端半边
//
// 两个东西：
//   1. 每条助手回复下面的 ▶ 朗读 / ⏸ 停止 小喇叭
//   2. 设置页「油库里」：选听哪些会话 / 声源 / 情绪 / 试听
//
// 音频从宿主的 /dsh-yukkuri/audio 拿，用 <audio> 播 —— 不依赖任何网页端。

window.__ModuleLoader__.load({
  id: 'dsh-yukkuri-tts',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const inject = ['slots'];
    const B = '/dsh-yukkuri';

    // ---------------- 样式 ----------------
    const CSS = [
      '.yk-act{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex}',
      '.yk-act:hover,.yk-act[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);color:var(--dsw-alias-label-secondary,#5f6875)}',
      '.yk-act:disabled{cursor:default;opacity:.45}',
    ].join('');

    if (typeof document !== 'undefined' && !document.getElementById('yk-css')) {
      const st = document.createElement('style');
      st.id = 'yk-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    // ---------------- 请求 ----------------
    const get = (p) =>
      fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    const post = (p, body) =>
      fetch(B + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
        .then((r) => r.json())
        .catch(() => null);

    // ---------------- 播放器（单例） ----------------
    // 整个页面只用一个 <audio>，避免多条同时出声
    // 整个页面只该有一份播放器 / 选主状态 / 轮询。
    // DSH 可能多次加载这份脚本（HMR、多次注入），每次加载都会执行到这里；
    // 各建一份的话同一段音频会被播好几遍，而且多个 <audio> 同时响。
    // 所以统一挂在 window 上，后来者直接复用。
    const G = (window.__dshYukkuri = window.__dshYukkuri || {});
    G.loadCount = (G.loadCount || 0) + 1;
    // DSH 有时会把客户端脚本加载多次（HMR / 多次注入）。
    // 看到这个数字 > 1 不是故障 —— 下面的单例逻辑保证只有一条轮询在跑。
    if (G.loadCount > 1) {
      console.info('[油库里] 客户端脚本被重复加载，累计 ' + G.loadCount + ' 次（播放器与轮询仍只有一份）');
    }

    const player = G.player || (G.player = {
      el: null,
      queue: [],
      current: null,
      playing: false,
      subs: new Set(),

      audio() {
        if (this.el) return this.el;
        const a = new Audio();
        a.addEventListener('ended', () => this.next());
        a.addEventListener('error', () => this.next());
        this.el = a;
        return a;
      },

      notify() {
        for (const fn of this.subs) {
          try { fn(); } catch (e) {}
        }
      },

      enqueue(segments) {
        for (const s of segments) this.queue.push(s);
        if (!this.playing) this.next();
        this.notify();
      },

      next() {
        const seg = this.queue.shift();
        if (!seg) {
          this.playing = false;
          this.current = null;
          this.notify();
          return;
        }
        this.current = seg;
        this.playing = true;
        const a = this.audio();
        a.src = seg.url;
        a.play().catch((err) => {
          // 只有「浏览器不让自动播放」才把段还回队列。
          //
          // 别把任何失败都还回去：Chrome 在 play() 的 promise 还没落地时
          // 换 src 会抛 AbortError（'The play() request was interrupted by a new load request'），
          // 那是「自己打断自己」，段其实已经播过/正在播。还回去之后
          // 下一轮轮询又取到它、再播一遍 —— 正是「同一句话念两遍」。
          this.playing = false;
          this.notify();
          const name = (err && err.name) || '';
          if (seg.id && name === 'NotAllowedError') {
            post('/release', { ids: [seg.id] }).catch(() => {});
          }
        });
        this.notify();
      },

      stop() {
        this.queue.length = 0;
        this.current = null;
        this.playing = false;
        // 记号：用户主动按了停。轮询拿到的下一段仍然会播（那是新的一轮），
        // 但当前这一段被打断产生的 AbortError 不能再触发 release。
        this.stoppedAt = Date.now();
        if (this.el) {
          this.el.pause();
          this.el.removeAttribute('src');
        }
        this.notify();
      },

      toggle() {
        if (this.playing) this.stop();
        else this.next();
      },
    });

    // ---------------- 图标 ----------------
    const icon = (kind) => {
      const d =
        kind === 'play'
          ? 'M5.6 3.6 12.2 8l-6.6 4.4z'
          : 'M6.2 3.9v8.2M9.8 3.9v8.2';
      return React.createElement(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        React.createElement('path', { d }),
      );
    };

    // ---------------- 每条回复下的小喇叭 ----------------
    function SpeakAction(props) {
      const messageId = String((props && props.messageId) || '');
      const sessionId = String((props && props.sessionId) || '');
      const [, force] = React.useState(0);
      const [busy, setBusy] = React.useState(false);

      React.useEffect(() => {
        const fn = () => force((n) => n + 1);
        player.subs.add(fn);
        return () => player.subs.delete(fn);
      }, []);

      const onPlay = async () => {
        setBusy(true);
        const r = await post('/speak', { sessionId, messageId });
        setBusy(false);
        if (r && r.ok && Array.isArray(r.segments)) {
          player.stop();
          player.enqueue(r.segments);
        }
      };

      const playing = player.playing;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'yk-act',
            title: '用油库里念这一条',
            'aria-label': '用油库里念这一条',
            disabled: busy,
            onClick: onPlay,
          },
          icon('play'),
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'yk-act',
            title: '停止朗读',
            'aria-label': '停止朗读',
            'aria-pressed': playing,
            onClick: () => player.stop(),
          },
          icon('pause'),
        ),
      );
    }

    // ---------------- 设置页 ----------------
    function SettingsPage() {
      const [cfg, setCfg] = React.useState(null);
      const [sessions, setSessions] = React.useState([]);
      const [msg, setMsg] = React.useState('');
      // 诊断：插件被加载了几次、触发了几次、挡掉几次重复
      const [diag, setDiag] = React.useState(null);
      // SDK 自检：合成不出声时，用户第一眼要能看到「路径对不对」
      const [sdk, setSdk] = React.useState(null);
      const [sdkPath, setSdkPath] = React.useState('');
      const [testText, setTestText] = React.useState('ゆっくりしていってね。');

      const flash = (t) => {
        setMsg(t);
        setTimeout(() => setMsg(''), 2200);
      };

      const load = async () => {
        const st = await get('/state');
        if (st && st.ok) {
          setCfg(st.cfg);
          setSdk(st.sdk || null);
          setSdkPath(st.cfg.sdkRoot || '');
        }
        const ss = await get('/sessions');
        if (ss && ss.ok) setSessions(ss.sessions || []);
        const sg = await get('/stats');
        if (sg && sg.ok) setDiag(sg);
      };

      React.useEffect(() => { load(); }, []);

      if (!cfg) return React.createElement('div', null, '加载中…');

      const save = async (patch) => {
        const r = await post('/config', patch);
        if (r && r.ok) {
          setCfg(r.cfg);
          flash('已保存');
          load();
        } else {
          flash('保存失败');
        }
      };

      const toggleWatch = (id) => {
        const cur = Array.isArray(cfg.watch) ? cfg.watch : [];
        const next = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id);
        save({ watch: next });
      };

      const trySay = async () => {
        const r = await post('/say', { text: testText });
        if (r && r.ok) {
          player.stop();
          player.enqueue([{ url: r.url, id: r.id, seconds: 0 }]);
          flash('试听中…');
        } else {
          flash('合成失败: ' + ((r && r.error) || '未知'));
        }
      };

      // SDK 路径：写配置文件 + 立刻注入 env + 重载 core，服务端会回新的自检结果
      const applySdk = async () => {
        const r = await post('/config', { sdkRoot: sdkPath.trim() });
        if (r && r.ok) {
          setCfg(r.cfg);
          setSdk(r.sdk || null);
          flash('SDK 已更新');
          load();
        } else {
          flash('SDK 设置失败: ' + ((r && r.error) || '未知'));
        }
      };

      // 配色一律走 DSH 的主题变量，回退值也按深色给 ——
      // 之前 select 用 transparent，原生下拉就套了浏览器默认的白底，
      // 而文字继承主题的浅色 → 白底浅字，几乎看不见。
      const V = {
        bgLayer1: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.07))',
        bgLayer2: 'var(--dsw-alias-bg-layer-2, #2a2a30)',
        labelPrimary: 'var(--dsw-alias-label-primary, inherit)',
        labelSecondary: 'var(--dsw-alias-label-secondary, inherit)',
        border: 'var(--dsw-alias-border-l2, rgba(128,128,128,.35))',
        hover: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))',
      };

      const box = { padding: 12, borderRadius: 10, background: V.bgLayer1, marginTop: 10 };
      const small = { fontSize: 12, color: V.labelSecondary, opacity: 0.85, lineHeight: 1.6 };
      const row = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' };
      const btn = {
        padding: '4px 10px', borderRadius: 6, border: '1px solid ' + V.border,
        background: 'transparent', color: V.labelPrimary, cursor: 'pointer', fontSize: 12,
      };
      const sel = {
        padding: '4px 8px', borderRadius: 6, border: '1px solid ' + V.border,
        // 关键：给下拉一个实底，原生列表才不会用浏览器默认白底
        background: V.bgLayer2, color: V.labelPrimary, fontSize: 12, cursor: 'pointer',
      };
      // option 也要单独给色 —— 弹出列表用的是这一层
      const opt = { background: V.bgLayer2, color: V.labelPrimary };
      const inp = {
        padding: '5px 9px', borderRadius: 6, border: '1px solid ' + V.border,
        background: V.bgLayer2, color: V.labelPrimary, fontSize: 12, flex: 1, minWidth: 160,
      };
      const sectionTitle = { fontWeight: 600, fontSize: 13, color: V.labelPrimary };
      const fieldLabel = { fontSize: 12, color: V.labelSecondary };

      // 带主题配色的下拉（省得每处都写一遍 option 样式）
      // list 可以是字符串数组，也可以是 [value, label] 对
      const select = (value, onChange, list) =>
        React.createElement(
          'select',
          { style: sel, value, onChange },
          list.map((item) => {
            const v = Array.isArray(item) ? item[0] : item;
            const label = Array.isArray(item) ? item[1] : item;
            return React.createElement('option', { key: v, value: v, style: opt }, label);
          }),
        );

      // 角色在前（带中文名，一眼能认），后面是原始预设声库。
      // 加新角色时这里要跟着加 —— core/src/voice/characters.js 是唯一真相源。
      // 角色按对照表各走各的引擎（AQTK10 / AQTK1 / AQTK2），音色就是表里的
      // 会话列表：已加载的正常显示；已勾选但当前没加载的也要列出来（灰一点、标"未加载"），
      // 否则「明明勾了三个，这里只显示两个」，看不出第三个去哪了。
      function renderSessionRows() {
        const known = new Set(sessions.map((s) => s.id));
        const missing = (cfg.watch || []).filter((id) => !known.has(id));

        if (sessions.length === 0 && missing.length === 0) {
          return React.createElement('div', { style: small }, '（没有可见的会话）');
        }

        const rows = [];

        const rowStyle = (dim) => ({
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '6px 0',
          cursor: 'pointer',
          borderBottom: '1px solid ' + V.border,
          opacity: dim ? 0.6 : 1,
        });

        const titleStyle = {
          display: 'block',
          fontSize: 12,
          color: V.labelPrimary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        };

        const idStyle = {
          display: 'block',
          fontSize: 10,
          color: V.labelSecondary,
          opacity: 0.6,
          fontFamily: 'ui-monospace, Consolas, monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        };

        // 1) 已勾选但没加载的
        for (const id of missing) {
          rows.push(
            React.createElement(
              'label',
              {
                key: 'missing-' + id,
                title: '这个会话当前没加载，暂时监听不到。切过去打开一次就会恢复。',
                style: rowStyle(true),
              },
              React.createElement('input', {
                type: 'checkbox',
                checked: true,
                onChange: () => toggleWatch(id),
                style: { marginTop: 2, flexShrink: 0 },
              }),
              React.createElement(
                'span',
                { style: { flex: 1, minWidth: 0 } },
                React.createElement('span', { style: titleStyle }, '（未加载）'),
                React.createElement('span', { style: idStyle }, id),
              ),
            ),
          );
        }

        // 2) 当前可监听的
        for (const s of sessions) {
          rows.push(
            React.createElement(
              'label',
              { key: s.id, style: rowStyle(false) },
              React.createElement('input', {
                type: 'checkbox',
                checked: (cfg.watch || []).includes(s.id),
                onChange: () => toggleWatch(s.id),
                style: { marginTop: 2, flexShrink: 0 },
              }),
              React.createElement(
                'span',
                { style: { flex: 1, minWidth: 0 } },
                React.createElement('span', { title: s.title || s.id, style: titleStyle }, s.title || '(未命名)'),
                React.createElement('span', { style: idStyle }, s.id),
              ),
            ),
          );
        }

        return React.createElement(
          'div',
          {
            style: {
              marginTop: 8,
              maxHeight: 220,
              overflowY: 'auto',
              border: '1px solid ' + V.border,
              borderRadius: 8,
              padding: '2px 8px',
            },
          },
          rows,
        );
      }

      const voices = [
        ['reimu', '博丽灵梦'],
        ['marisa', '雾雨魔理沙'],
        ['cirno', '琪露诺'],
        ['tenshi', '比那名居天子'],
        ['patchouli', '帕秋莉·诺蕾姬'],
        ['patchouli_bass', '低音炮帕秋莉'],
        ['f1', '预设 f1'],
        ['f2', '预设 f2'],
        ['f3', '预设 f3'],
        ['m1', '预设 m1'],
        ['m2', '预设 m2'],
        ['r1', '预设 r1'],
        ['r2', '预设 r2'],
      ];
      const emotions = ['neutral','happy','angry','sad','surprised','shy','sleepy'];

      return React.createElement(
        'div',
        null,
        React.createElement('div', { style: small }, '把会话里的话用油库里念出来。本地 AQTK10 合成，不依赖浏览器。'),

        React.createElement('div', { style: box },
          React.createElement('div', { style: sectionTitle }, '自动朗读'),
          React.createElement('div', { style: row },
            React.createElement('button', { style: btn, onClick: () => save({ enabled: !cfg.enabled }) },
              cfg.enabled ? '● 已开启（点此关闭）' : '○ 已关闭（点此开启）'),
            React.createElement('span', { style: small }, '开启后，下面勾选的会话在每轮结束时自动念'),
          ),
        ),

        React.createElement('div', { style: box },
          React.createElement('div', { style: sectionTitle }, '声音'),
          React.createElement('div', { style: row },
            React.createElement('span', { style: fieldLabel }, '声源'),
            select(cfg.voice, (e) => save({ voice: e.target.value }), voices),
            React.createElement('span', { style: fieldLabel }, '情绪'),
            select(cfg.emotion, (e) => save({ emotion: e.target.value }), emotions),
          ),
          React.createElement('div', { style: row },
            React.createElement('input', { style: inp, value: testText, onChange: (e) => setTestText(e.target.value), placeholder: '试听文本' }),
            React.createElement('button', { style: btn, onClick: trySay }, '试听'),
          ),
        ),

        // SDK：默认值是 ~/yukkuri-sdk（不写死盘符），本机装在别处时默认值就是错的，
        // 而失败现场只有一句「找不到指定的模块」。所以把路径与自检摆到界面上。
        React.createElement('div', { style: box },
          React.createElement('div', { style: sectionTitle }, 'SDK（合成引擎）'),
          React.createElement('div', {
            style: {
              fontSize: 12,
              marginTop: 4,
              lineHeight: 1.5,
              color: sdk && !sdk.ok ? '#e0a030' : V.labelPrimary,
            },
          },
            sdk
              ? (sdk.ok ? '✓ ' : '✗ ') + (sdk.sdkRoot || '(未设置)') + (sdk.ok ? '' : ' —— ' + (sdk.message || sdk.code))
              : '读取中…'),
          React.createElement('div', { style: row },
            React.createElement('input', {
              style: inp,
              value: sdkPath,
              placeholder: '留空 = 默认 ~/yukkuri-sdk',
              onChange: (e) => setSdkPath(e.target.value),
            }),
            React.createElement('button', { style: btn, onClick: applySdk }, '应用'),
          ),
          React.createElement('div', { style: { fontSize: 11, opacity: 0.55, marginTop: 6, lineHeight: 1.5 } },
            '路径必须是纯 ASCII：AqKanji2Koe 用 ANSI 读词典，中文路径会让它读不出词典。'),
        ),

        React.createElement('div', { style: box },
          React.createElement('div', { style: sectionTitle }, '听哪些会话'),
          React.createElement('div', { style: small },
            (cfg.watch || []).length === 0 ? '现在一个都不听。勾一个开始。' : '已勾选 ' + (cfg.watch || []).length + ' 个'),
          React.createElement(
            'div',
            { style: { fontSize: 11, opacity: 0.55, marginTop: 2, lineHeight: 1.5 } },
            '只列出当前已加载的会话。其他工作区的会话要先切过去打开一次，才会出现在这里。',
          ),
          renderSessionRows(),
        ),

        React.createElement('div', { style: box },
          React.createElement('div', { style: sectionTitle }, '播放'),
          React.createElement('div', { style: row },
            React.createElement('button', { style: btn, onClick: () => player.toggle() }, player.playing ? '⏸ 停止' : '▶ 继续'),
            React.createElement('button', { style: btn, onClick: () => player.stop() }, '清空队列'),
            React.createElement('span', { style: small }, '队列 ' + player.queue.length + ' 段'),
          ),
        ),

        // 诊断：这几个数字是排查「一句话念好几遍」的入口。
        // 插件加载 > 1 → 热重载累积了多个实例（旧实例的定时器还在跑）。
        // 挡住重复 > 0 → 同一轮确实被触发了多次，幂等闸门把它拦下来了。
        diag
          ? React.createElement('div', { style: box },
              React.createElement('div', { style: sectionTitle }, '诊断'),
              React.createElement('div', { style: small },
                '插件加载 ' + (diag.applies || 0) + ' 次 · 触发 ' + (diag.triggers || 0) +
                  ' 次 · 挡住重复 ' + (diag.dups || 0) + ' 次 · 队列里 ' + (diag.segments || 0) + ' 段'),
              (diag.applies || 0) > 1
                ? React.createElement('div', { style: { ...small, color: '#e0a030' } },
                    '插件被重复加载了 ' + diag.applies + ' 次 —— 重启 DSH 可清掉旧实例。')
                : null,
            )
          : null,

        msg ? React.createElement('div', { style: { fontSize: 12, marginTop: 8, opacity: 0.8 } }, msg) : null,
      );
    }

    // ---------------- 谁在播：多标签页选主 ----------------
    //
    // 每个标签页都会轮询 /pending，如果都播，同一句话会响两遍，
    // 而且点暂停只停得住当前这个。用 localStorage 选一个主。
    //
    // 心跳 3 秒；超过 6 秒没更新就认为原主已关，可以接管。
    const leader = G.leader || (G.leader = {
      KEY: 'yukkuri-tts-leader',
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      active: false, // 是否已抢到谁在播的锁（不能用 isLeader 这个名字，会和方法撞）

      storage() {
        try {
          // 隐私模式 / 被禁用时访问会抛，返回 null 表示退化
          if (typeof localStorage === 'undefined' || !localStorage) return null;
          return localStorage;
        } catch {
          return null;
        }
      },

      read() {
        const s = this.storage();
        if (!s) return null;
        try {
          const raw = s.getItem(this.KEY);
          if (!raw) return null;
          const obj = JSON.parse(raw);
          return obj && obj.id ? obj : null;
        } catch {
          return null;
        }
      },

      write() {
        const s = this.storage();
        if (!s) return;
        try {
          s.setItem(this.KEY, JSON.stringify({ id: this.id, at: Date.now() }));
        } catch {}
      },

      /** 尝试成为/保持主。返回是否为当前主 */
      tryAcquire() {
        const cur = this.read();

        // 没有 localStorage：退化成一个标签页自己播（多开就会重复，但总比不播强）
        if (!this.storage()) {
          this.active = true;
          return true;
        }

        if (!cur) {
          this.write();
          this.active = true;
          return true;
        }

        if (cur.id === this.id) {
          this.write(); // 刷新心跳
          this.active = true;
          return true;
        }

        // 别人是主：心跳还新鲜就让给它
        if (Date.now() - Number(cur.at || 0) < 6000) {
          this.active = false;
          return false;
        }

        // 心跳过期 → 接管
        this.write();
        this.active = true;
        return true;
      },

      /**
       * 我是不是当前的主。
       *
       * ⚠ 已经是主的时候也必须续心跳 —— 这条不是优化，是修 bug。
       * 原来的写法是「已经在当主了就直接 return true」，心跳只在 tryAcquire
       * 成功的那一次写过，之后再不更新。6 秒后别人读到的心跳就过期了，
       * 于是第二个标签页接管、第三个也接管……最后每个标签页都以为自己是主，
       * 各播各的，按暂停只停得住自己那一个。
       */
      isLeader(lazy = true) {
        if (this.active) {
          this.write(); // 续心跳：证明我还活着，别人别抢
          return true;
        }
        return lazy ? this.tryAcquire() : false;
      },
    });

    // ---------------- 自动朗读：轮询待播段 ----------------
    //
    // 宿主在每轮结束时把音频段放进内存队列，但**浏览器不会自己知道**。
    // 这一环不接上，自动朗读就等于没做（服务端合成完，没人播）。
    const autoplay = G.autoplay || (G.autoplay = {
      lastId: 0,
      timer: null,
      started: false,
      failures: 0,

      async tick() {
        try {
          const r = await get('/pending?after=' + this.lastId);
          if (!r || !r.ok || !Array.isArray(r.segments) || r.segments.length === 0) {
            this.failures = 0;
            return;
          }

          this.failures = 0;
          const fresh = [];
          for (const s of r.segments) {
            const id = Number(s.id);
            if (Number.isFinite(id) && id > this.lastId) this.lastId = id;
            fresh.push({ url: s.url, id: s.id, seconds: s.seconds });
          }

          if (fresh.length) player.enqueue(fresh);
        } catch (err) {
          this.failures += 1;
          // 连续失败太多次就放慢，别把控制台刷满
          if (this.failures === 5) {
            console.warn('[油库里] 拉取待播段多次失败，检查宿主是否还活着');
          }
        }
      },

      async start(intervalMs = 1500) {
        if (this.started) return;
        this.started = true;

        // 先问一次当前最新 id —— 页面刚打开时不该把之前的对话全念一遍
        try {
          const st = await get('/state');
          if (st && st.ok && st.latest) this.lastId = Number(st.latest) || 0;
        } catch (err) {
          // 拿不到就从 0 开始，最多多念一条
        }

        if (typeof setInterval !== 'function') {
          console.warn('[油库里] 环境里没有 setInterval，自动朗读不可用（手动点小喇叭仍然可以）');
          return;
        }

        // 多标签页只让一个播：否则同一句话会从两个标签页同时响，
        // 而点暂停只能停当前这个。
        leader.tryAcquire();

        this.timer = setInterval(() => {
          if (leader.isLeader()) {
            this.tick();
          } else {
            leader.tryAcquire();
          }
        }, intervalMs);
      },
    });

    // ---------------- 挂载 ----------------
    function apply(ctx) {
      const slots = ctx.slots;

      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: 'yukkuri-tts', order: 61, label: '油库里' }, SettingsPage),
      );

      slots.inject('conversation.chat.assistant-actions', () =>
        slots.register({ name: 'conversation.chat.assistant-actions', id: 'yukkuri-tts', order: 31 }, SpeakAction),
      );

      // 自动朗读的接收端：一直在后台拉，宿主有新的段就播
      autoplay.start(1500);
    }

    exports.inject = inject;
    exports.apply = apply;
    // 供测试断言"多次加载共用同一份"
    exports.__player = G.player;
    return module.exports;
  },
});
