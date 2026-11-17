'use strict';

const fs = require('node:fs');
const { synthe } = require('./src');
const { list, resolve } = require('./src/voice/characters');
const { wavInfo } = require('./src/wav');

const OUT = '../output-chars';
fs.mkdirSync(OUT, { recursive: true });

const LINES = {
  cirno:          '我可是最强的！才不会输给你呢！',
  tenshi:         '天人有天人的骄傲，这点小事算什么。',
  patchouli:      '书是不会骗人的，你倒是常常骗人呢。',
  marisa:         '这种事情，用魔法一口气解决吧！',
  reimu:          '真是的，又来给我添麻烦。',
  patchouli_bass: '这些书，我一本都不会借给你。',
};

(async () => {
  console.log('角色'.padEnd(20) + '引擎  声库  参数          速率   时长');
  console.log('-'.repeat(78));

  for (const c of list()) {
    const text = LINES[c.id];
    if (!text) continue;

    const t = resolve(c.id);
    const extra = [];
    if (t.params.speed && t.params.speed !== 100) extra.push('speed=' + t.params.speed);
    if (t.params.pitch) extra.push('pitch=' + t.params.pitch);

    const wav = await synthe(text, { voice: c.id });
    fs.writeFileSync(OUT + '/' + c.id + '.wav', wav);
    const info = wavInfo(wav);

    console.log(
      c.name.padEnd(18) + c.engine.padEnd(7) + String(c.lib).padEnd(5) +
      extra.join(' ').padEnd(14) +
      String(info.hz).padEnd(7) + info.seconds.toFixed(2) + 's'
    );
  }

  // 清掉已移除角色的样本
  for (const old of ['remilia.wav', 'sakuya.wav', 'suika.wav']) {
    try { fs.unlinkSync(OUT + '/' + old); console.log('已删旧样本:', old); } catch {}
  }

  console.log('');
  console.log('输出目录:', OUT);
})();
