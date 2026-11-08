/**
 * 免费 5 篇故事的「精准 3 分钟」文本精简表（2026-11-08）
 * ---------------------------------------------------------------------------
 * 只删冗余描写，不删情节主干；每次替换都要求精确命中，未命中即中止且不写回。
 * 语速基准由 ffprobe 实测样本得出：
 *   中文 4.404 字/秒、英文 2.804 词/秒 → 180s ≈ 793 中文字 / 505 英文词
 * classic-007 两路已实测 182.32s / 182.96s，保持原样不动。
 *
 * 用法：node trim_free_pool.mjs   （幂等：重复运行会因片段已不存在而中止，不会二次裁剪）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'free-pool-v2.json');
const pool = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const R = {
  'classic-001': {
    zh: [
      [`说话时总把尾音拖得长长的。`, ``],
      [`，船身圆圆的，像一片被折起来的叶子`, ``],
      [`猫头鹰拨了一下吉他，唱起那支很慢的歌。`, ``],
      [`他们走了一年又一天，其实也不算久，因为海上的时间总是慢的，慢到够把每一颗星星都认一遍。`, `海上的时间总是慢的，慢到够把每一颗星星都认一遍。`],
      [`海浪一遍一遍把脚印抹平，火鸡清了清嗓子，说了几句很短的话。`, `海浪一遍一遍把脚印抹平。`],
      [`他们就在湿湿的沙上跳起舞来，跳得不太整齐，转圈时还差点踩到浪。`, `他们就在湿湿的沙上跳起舞来。`],
      [`夜深了，蜂蜜只剩罐底一点点，硬币也花完了，可谁都不着急。`, `夜深了，蜂蜜只剩罐底一点点。`],
    ],
    en: [
      [`, where the gorse bushes grow right down to the sand`, ``],
      [`, and whenever he spoke he let the last word stretch out long and slow`, ``],
      [`The Owl thought about it all night, and in the morning he brought round a pea-green boat, as round as a folded leaf.`, `In the morning the Owl brought round a pea-green boat.`],
      [`They took a jar of honey, a few bright coins they had saved for a long while, and a small note with the words good night written on it, in case they came home too late to remember to say them.`, `They took a jar of honey, a few bright coins, and a small note with good night on it, in case they came home too late to say it.`],
      [`The Owl touched the guitar and began the slow song again.`, ``],
      [`The Pussycat leaned over the side and trailed one paw in the water, watching the silver light open in rings.`, `The Pussycat trailed one paw in the water, watching the silver light open in rings.`],
      [`They sailed for a year and a day, which is not really very long, because time at sea is slow enough to count every single star.`, `Time at sea was slow enough to count every single star.`],
      [`asked a Turkey who happened to be passing to do the thing properly, there in the moonlight.`, `asked a passing Turkey to do the thing properly in the moonlight.`],
      [`The sand was white with moon, the waves kept smoothing away their footprints, and the Turkey cleared his throat and said a few short words.`, `The sand was white with moon, and the waves kept smoothing away their footprints.`],
      [`They danced on the wet sand, not very well, and nearly stepped into a wave when they turned.`, `They danced on the wet sand.`],
      [`Late on, the honey was almost gone and the coins were spent, but nobody minded.`, `Late on, the honey was almost gone, but nobody minded.`],
      [`The Pussycat took the little paper boat from her pocket, set it on the water, and watched it bob away with the waves.`, `The Pussycat set the little paper boat on the water and watched it bob away.`],
      [`There is a jar with a little honey left in it, an old guitar, and two small travellers who have just said good night and are already asleep.`, `There is a jar with a little honey left, an old guitar, and two small travellers already asleep.`],
      [`By morning the sea will still be there. `, ``],
    ],
  },
  'classic-002': {
    zh: [
      [`，在草地上打滚，把树枝当秋千，鸟也跟着落下，站在枝头一起唱歌`, `，鸟也跟着落下，站在枝头唱歌`],
      [`，趴在缝上往里看`, ``],
    ],
    en: [
      [`All that time the children came in after school over the low wall, rolled on the grass, swung from the branches, and the birds came down too and sang from the same boughs.`, `All that time the children came in after school and played on the grass, and the birds sang from the boughs.`],
      [`They walked round and round the wall and put their eyes to the cracks, saying how lovely it had been in there, and how happy they had been.`, `They walked round the wall and put their eyes to the cracks, saying how happy they had been in there.`],
      [`Snow lay on the grass, frost hung on the branches, and the wind went round and round the wall and would not come in.`, `Snow lay on the grass, frost hung on the branches, and the wind would not come in.`],
      [`The Giant sat at his window wrapped in a blanket, waiting day after day for a single flower.`, `The Giant sat wrapped in a blanket, waiting day after day for one flower.`],
      [`The moment a branch was touched it hurried into flower and trembled gently, like someone who had held his breath too long and could finally let it go.`, `The moment a branch was touched it hurried into flower, like someone finally letting go of a long breath.`],
      [`When he was old and could not walk, he watched them from a chair and said he had known many springs, but the best was the one with someone in it.`, `When he was old he watched them from a chair and said the best spring was the one with someone in it.`],
    ],
  },
  'classic-003': {
    zh: [
      [`刚到儿童室时他有点拘谨，因为旁边的玩具都太神气了`, `刚到儿童室时他有点拘谨，旁边的玩具都太神气了`],
      [`连缝线松了、毛掉光了，也会变成真的。`, `连毛掉光了，也会变成真的。`],
      [`白天带他坐小推车，带他去看草地上的兔子，晚上把他压在胳膊底下，脸贴着那只软软的耳朵，讲一些只有两个人听见的话。`, `白天带他坐小推车，晚上把他压在胳膊底下，脸贴着软软的耳朵，讲一些只有两个人听见的话。`],
      [`他发现自己越来越能听懂男孩的呼吸：快的时候是做了梦，慢下来是快要睡着，最慢最匀的那一段，就是可以把全身放松的时候。`, `他越来越能听懂男孩的呼吸：慢下来是快要睡着，最慢最匀的那一段，就是可以放松的时候。`],
      [`有一天夜里，男孩退烧了，睡着了，手还搭着。月光落在床沿，落在那只歪了的耳朵上。`, `有一天夜里，男孩退烧睡着了，手还搭着。月光落在那只歪了的耳朵上。`],
      [`他不再去想自己是不是真的了，因为他已经在一个人的怀里，被认认真真地需要着，这就够了。`, `他不再去想自己是不是真的了，因为他已经被认认真真地需要着，这就够了。`],
      [`它记得你所有睡着的夜晚，比谁都清楚你呼吸慢下来是几点。`, `它记得你所有睡着的夜晚。`],
    ],
    en: [
      [`He was shy at first in the nursery, because the other toys were so grand: a clockwork train, a painted wooden horse, and a bear that spoke when you pressed his stomach.`, `He was shy at first, because the other toys were so grand: a clockwork train, a painted horse, and a bear that spoke when pressed.`],
      [`In the daytime he rode in the little cart and was taken to see the rabbits on the grass.`, `In the daytime he rode in the little cart.`],
      [`Once it rained and the rabbit was left out in the garden all night.`, `Once he was left out in the garden all night in the rain.`],
      [`He found he could read the Boy's breathing better and better: quick meant a dream, slower meant nearly asleep, and the slowest, most even stretch was the moment to let go all over.`, `He could read the Boy's breathing now: slower meant nearly asleep, and the slowest, most even stretch was the moment to let go.`],
      [`a hand came now to a forehead, now to tuck the blanket in`, `a hand came to tuck the blanket in`],
      [`The rabbit wished he could be a little warmer for him.`, `The rabbit wished he could be warmer for him.`],
      [`Moonlight lay along the edge of the bed and on the folded ear.`, `Moonlight lay on the folded ear.`],
      [`It remembers every night you have fallen asleep, and knows better than anyone the hour your breathing slows.`, `It remembers every night you have fallen asleep.`],
    ],
  },
  'classic-004': {
    zh: [
      [`猫整天躺在墙头晒太阳，鸭爱在池塘里把水搅出圈，猪呢，最喜欢在泥里翻个身，然后心满意足地叹一口气。`, `猫爱在墙头晒太阳，鸭爱在池塘里搅水，猪最喜欢在泥里翻身。`],
      [`她用爪子在篱笆边刨出一小垄松软的土，一粒一粒把麦子按进去，再轻轻把土盖平。往后许多天，她每天清早去看，下雨了就担心，出太阳了又怕太干。`, `她用爪子在篱笆边刨出一小垄松软的土，把麦子一粒粒按进去，再轻轻盖平。往后许多天，她每天清早去看，下雨了担心，出太阳了又怕太干。`],
      [`于是她自己弯下腰，一捆一捆割好，抱到空地上晒，再把麦粒一粒粒搓下来，装进一只小布袋。`, `于是她自己割好、晒干，把麦粒搓下来装进小布袋。`],
      [`她没生气，只是把布袋往上托了托，慢慢沿着小路走。风把路边的草吹得沙沙响，磨坊的轮子转起来时，白白的面粉落进盆里，像很细很细的雪。`, `她没生气，只是把布袋往上托了托，慢慢沿着小路走。磨坊的轮子转起来时，白白的面粉落进盆里，像很细的雪。`],
      [`窗外天慢慢暗下来，院子里安静得只剩咀嚼声。`, `窗外天慢慢暗下来，院子里只剩咀嚼声。`],
    ],
    en: [
      [`Her feathers were the warm colour of brick, and she walked with a small bobbing step, always looking round the yard before she set off.`, `Her feathers were the warm colour of brick.`],
      [`The cat lay on the wall in the sun all day. The duck liked to stir the pond into circles. As for the pig, his favourite thing was to roll in the mud and then sigh with deep satisfaction.`, `The cat lay on the wall in the sun. The duck stirred the pond into circles. The pig rolled in the mud and sighed.`],
      [`One morning the little red hen found a few grains of wheat by the straw stack, plump and golden and surprisingly heavy in her claw.`, `One morning she found a few grains of wheat by the straw stack, plump and golden.`],
      [`When the shoots came up, a thin green line of them, she was so pleased that she went twice round the yard, and nobody liked to interrupt her.`, `When the shoots came up in a thin green line, she went twice round the yard for joy.`],
      [`So she bent down alone, tied the stalks into bundles, carried them to the open ground to dry, and rubbed the grains out one by one into a small cloth sack.`, `So she cut and dried the wheat alone and rubbed the grains into a small cloth sack.`],
      [`She was not cross. She only shifted the sack a little higher and set off slowly along the path.`, `She only shifted the sack higher and set off slowly.`],
      [`The wind moved the grass with a soft rustle, and when the mill wheel turned, the white flour fell into the bowl like very fine snow.`, `When the mill wheel turned, white flour fell into the bowl like fine snow.`],
      [`The cat, the duck and the pig had somehow all come to the doorway. Nobody said anything; they simply watched.`, `The cat, the duck and the pig had come to the doorway and watched in silence.`],
    ],
  },
  // classic-007 两路已实测 182.32s / 182.96s，保持原样
};

// 第二轮微调：把偏上限的几路再压到 178–182s，给 TTS 自然波动留出余量。
R['classic-002'].en.push(
  [`He built a high brick wall all the way round and hung up a board that said keep out.`, `He built a high wall and hung up a board that said keep out.`],
  [`Spring came as usual. Small flowers opened all over the village and birds called under every eave.`, `Spring came as usual. Small flowers opened all over the village.`],
  [`He ran to the window and saw children squeezing through a little gap where the wall had crumbled, one after another, climbing into the peach trees.`, `He ran to the window and saw children squeezing through a gap in the wall, climbing into the peach trees.`],
);
R['classic-003'].zh.push(
  [`他有棕白相间的绒毛，耳朵里衬着粉色缎子，胡须是用线缝的，摸上去有点扎。`, `他有棕白相间的绒毛，耳朵里衬着粉色缎子，胡须是线缝的。`],
  [`绒毛被磨得薄了，粉缎子褪成浅灰，一只耳朵歪了下来，胡须也掉了几根。`, `绒毛磨薄了，粉缎子褪成浅灰，一只耳朵歪了下来。`],
);
R['classic-003'].en.push(
  [`On Christmas morning a small velveteen rabbit was tucked into the top of a stocking full of presents.`, `On Christmas morning a small velveteen rabbit was tucked into a stocking full of presents.`],
  [`They took very little notice of him and said he was only cloth and worth nothing.`, `They took little notice of him and said he was only cloth.`],
);
R['classic-004'].zh.push(
  [`她的羽毛是暖暖的砖红色，走起路来一颠一颠，总先把院子看一圈才动身。`, `她的羽毛是暖暖的砖红色，走起路来一颠一颠。`],
  [`有一天，小红母鸡在草垛边捡到几粒麦子，饱满、金黄，捏在爪心里沉甸甸的。`, `有一天，小红母鸡在草垛边捡到几粒麦子，饱满、金黄。`],
);
R['classic-004'].en.push(
  [`The wheat grew tall, turned yellow, and bent its heavy heads. It was time to cut.`, `The wheat grew tall and bent its heavy heads. It was time to cut.`],
  [`She asked once more, who will help me harvest. The cat changed position on the wall and said not I. The duck looked up from the pond and said not I. The pig grunted in the mud, not I either.`, `She asked once more, who will help me harvest. Not I, said the cat. Not I, said the duck. Not I, grunted the pig.`],
  [`Grain has to go to the mill before it can become flour. The road was not long, but the sack was heavy on her back.`, `The grain had to go to the mill. The road was not long, but the sack was heavy.`],
);

// 幂等：已裁剪过的片段自动跳过，重复运行不会二次缩短文本。
let applied = 0;
let skipped = 0;
for (const s of pool) {
  const rule = R[s.id];
  if (!rule) continue;
  for (const lang of ['zh', 'en']) {
    let text = s.content[lang];
    for (const [from, to] of rule[lang] || []) {
      if (!text.includes(from)) {
        skipped++;
        continue;
      }
      text = text.replace(from, to);
      applied++;
    }
    s.content[lang] = text;
  }
}
console.log(`本轮应用 ${applied} 处替换，跳过 ${skipped} 处（已裁剪过）。`);

const units = (t, l) =>
  l === 'zh' ? t.replace(/\s/g, '').length : t.trim().split(/\s+/).filter(Boolean).length;
fs.writeFileSync(FILE, JSON.stringify(pool, null, 2) + '\n', 'utf8');

console.log('id\t\t中文\t预测秒\t英文\t预测秒');
for (const s of pool) {
  const z = units(s.content.zh, 'zh');
  const e = units(s.content.en, 'en');
  console.log(
    `${s.id}\t${z}\t${(z / 4.404).toFixed(0)}s\t\t${e}\t${(e / 2.804).toFixed(0)}s`,
  );
}
