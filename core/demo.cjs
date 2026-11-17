'use strict';

const fs = require('node:fs');
const { synthe, toKoe, hasChinese } = require('./src');

const OUT = '../output-core';
fs.mkdirSync(OUT, { recursive: true });

const cases = [
  ['01_zh_f1_neutral',   '你好呀，我是油库里。今天也一起玩吧！', { voice: 'f1' }],
  ['02_zh_f1_happy',     '你好呀，我是油库里。今天也一起玩吧！', { voice: 'f1', emotion: 'happy' }],
  ['03_zh_f1_sad',       '你好呀，我是油库里。今天也一起玩吧！', { voice: 'f1', emotion: 'sad' }],
  ['04_zh_f2_shy',       '早上好，天气真不错呢。', { voice: 'f2', emotion: 'shy' }],
  ['05_jp_m1_angry',     'われわれは、ゆっくりを虐待するぞ！', { voice: 'm1', emotion: 'angry' }],
  ['06_jp_f3_surprised', 'ゆっくりしていってね！', { voice: 'f3', emotion: 'surprised' }],
  ['07_zh_r1_sleepy',    '困了，要睡觉了。', { voice: 'r1', emotion: 'sleepy' }],
  ['08_zh_f1_angry',     '不许欺负油库里！', { voice: 'f1', emotion: 'angry' }],
];

(async () => {
  console.log('文件'.padEnd(24) + '声库  情绪        时长   语言  音素');
  console.log('-'.repeat(110));

  for (const [name, text, opts] of cases) {
    const wav = await synthe(text, opts);
    fs.writeFileSync(OUT + '/' + name + '.wav', wav);
    const sec = ((wav.length - 44) / 2 / 16000).toFixed(2);

    console.log(
      (name + '.wav').padEnd(24) +
      opts.voice.padEnd(6) +
      (opts.emotion || 'neutral').padEnd(12) +
      (sec + 's').padEnd(7) +
      (hasChinese(text) ? 'zh' : 'ja').padEnd(6) +
      toKoe(text)
    );
  }

  console.log('');
  console.log('输出目录:', OUT);
})();
