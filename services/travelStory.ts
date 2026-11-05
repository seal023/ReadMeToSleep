/**
 * services/travelStory.ts — 旅行打卡故事的 AI 现场生成
 *
 * 与「AI 创作故事」共用同一套生成能力（services/ai.ts），区别只在 prompt 的组织方式：
 * 这里不让孩子自己输主题，而是把「地点 + 当地元素」写进细节约束里。
 *
 * 为什么不再用离线模板拼接：
 *   模板只有 15 个骨架，孩子打卡几次就会发现「换了地方和名字，故事还是那个」。
 *   AI 现场写则每次都不一样，且能带出当地的具体事物（脊兽、渔火、转经筒…）。
 *
 * 代价与护栏：
 *   1. 需要联网 + 消耗 token → 失败、超配额、无网时一律返回 null，
 *      由调用方降级到本地模板（永远有故事可听，绝不空屏）。
 *   2. 生成耗时 10~40 秒（取决于长度档）→ 调用方必须展示真实的等待动效。
 *   3. 家长设置的敏感词照常传给 AI，生成后仍走 ai.ts 的硬过滤。
 */

import { generateStory } from './ai';
import { getChildName, getSensitiveWords } from './storage';
import type { Language } from '../types';

export type TravelLength = 'short' | 'medium' | 'long';

interface PlaceElements {
  zh: string[];
  en: string[];
}

/**
 * 每个地标的「当地元素」——AI 的现场感来源。
 * 原则：具体、可视、能被孩子想象出来的物件或声音，而不是抽象形容。
 * 注意：key 必须与 LOCATIONS 里的 place 字段完全一致。
 */
export const PLACE_ELEMENTS: Record<string, PlaceElements> = {
  '故宫': {
    zh: ['屋脊上排队的脊兽', '宫墙的朱红', '御花园里的老槐树', '太和殿前的铜鹤', '琉璃瓦上淌下来的月光', '远处传来的更鼓'],
    en: ['the little beasts lined up on the roof ridge', 'the deep red palace walls', 'the old locust tree in the imperial garden', 'the bronze cranes before the great hall', 'moonlight sliding off glazed tiles', 'a distant night watch drum'],
  },
  '外滩': {
    zh: ['海关大楼的钟声', '江面上拖着灯光的游船', '对岸一排排楼群的灯', '吹过江面的风', '外白渡桥的钢架', '码头边卖热豆浆的小摊'],
    en: ['the chime of the customs house clock', 'tour boats dragging ribbons of light', 'the rows of lit windows across the river', 'wind coming off the water', 'the steel girders of the old bridge', 'a little stall selling warm soy milk'],
  },
  '兵马俑': {
    zh: ['站成方阵的陶俑', '黄土坑里的灯', '陶俑头上的发髻', '铜车马的轮子', '博物馆闭馆时的脚步声', '编号 734 号陶俑'],
    en: ['clay soldiers standing in formation', 'the lamps in the earthen pit', 'the topknot on each warrior', 'the wheels of the bronze chariot', 'footsteps when the museum closes', 'warrior number 734'],
  },
  '大熊猫基地': {
    zh: ['沙沙响的竹林', '抱着竹子啃的滚滚', '竹笋尖上的露水', '饲养员推的小车', '山坡上的木栈道'],
    en: ['bamboo leaves rustling', 'a panda hugging a bamboo stalk', 'dew on the tip of a bamboo shoot', 'the keeper pushing a little cart', 'the wooden walkway up the hill'],
  },
  '西湖': {
    zh: ['断桥的石栏', '三潭印月的石塔', '苏堤垂到水面的柳枝', '荷叶上的青蛙', '雷峰塔的轮廓', '湖心亭的一盏灯'],
    en: ['the stone railing of Broken Bridge', 'the little stone pagodas in the lake', 'willow branches dipping into the water', 'a frog on a lotus leaf', 'the outline of Leifeng Pagoda', 'one lamp in the lake pavilion'],
  },
  '漓江': {
    zh: ['顺水漂的竹筏', '船头站着的鸬鹚', '岸边的渔火', '像骆驼的山影', '水牛泡在水里', '被水磨圆的鹅卵石'],
    en: ['a bamboo raft drifting downstream', 'a cormorant standing at the bow', 'fishing lanterns along the bank', 'a hill shaped like a camel', 'a water buffalo soaking in the river', 'pebbles polished round by the water'],
  },
  '布达拉宫': {
    zh: ['白墙与红墙', '转个不停的转经筒', '酥油灯的小火苗', '屋顶的风铃', '远处的雪山尖', '风里飘动的经幡'],
    en: ['white walls and red walls', 'prayer wheels turning', 'the small flame of a butter lamp', 'wind chimes on the roof', 'the snowy peak far away', 'prayer flags fluttering'],
  },
  '洱海': {
    zh: ['苍山背后升起的月亮', '摇晃的小木船', '白族院门缝里的灯光', '水面上会呼吸的倒影', '洱海里的海菜花'],
    en: ['the moon rising behind Cangshan', 'a small wooden boat rocking', 'light through a gap in a courtyard door', 'reflections breathing on the water', 'white water flowers floating on the lake'],
  },
  '埃菲尔铁塔': {
    zh: ['整点闪成星雨的塔身', '塞纳河边的旧书摊', '刚出炉的可颂', '转得很慢的旋转木马', '桥下的游船'],
    en: ['the tower sparkling on the hour', 'the old book stalls by the Seine', 'a warm fresh croissant', 'a slow carousel', 'a boat passing under the bridge'],
  },
  '大本钟': {
    zh: ['雾里的钟声', '泰晤士河上的倒影', '红色的双层巴士', '卫兵换岗的脚步声', '河边的长椅'],
    en: ['clock chimes in the fog', 'reflections on the Thames', 'a red double-decker bus', 'the footsteps of the changing guard', 'a bench beside the river'],
  },
  '自由女神': {
    zh: ['一直亮着的小火炬', '晚班的渡轮', '码头边收翅膀的海鸥', '远处的曼哈顿灯火', '夜航的飞机'],
    en: ['the little torch that never goes out', 'the last evening ferry', 'gulls folding their wings at the pier', 'the lights of Manhattan far away', 'a plane crossing the night sky'],
  },
  '东京塔': {
    zh: ['一层层往上亮的红白灯光', '街角亮着的自动贩卖机', '刚买的热牛奶', '开过的电车', '樱花树下的长椅'],
    en: ['red and white lights climbing the tower', 'a glowing vending machine on the corner', 'a can of warm milk', 'a tram rattling past', 'a bench under the cherry trees'],
  },
  '歌剧院': {
    zh: ['像贝壳一样的屋顶', '海湾大桥的灯', '环形的码头', '拉小提琴的人', '停在栏杆上的海鸥'],
    en: ['roofs shaped like seashells', 'the lights of the harbour bridge', 'the curved waterfront', 'someone playing a violin', 'a seagull perched on the railing'],
  },
  '金字塔': {
    zh: ['驮着小灯的骆驼', '会记住脚印的沙子', '远处的绿洲', '狮身人面像的侧脸', '沙漠上特别亮的星星'],
    en: ['a camel carrying a small lamp', 'sand that remembers footprints', 'an oasis far away', 'the profile of the sphinx', 'unusually bright stars over the desert'],
  },
  '基督像': {
    zh: ['张开双臂的雕像', '雨林里一层层的虫鸣', '山下的海滩', '停在肩上的小鹦鹉', '城市灯火一盏盏熄灭'],
    en: ['the statue with open arms', 'layers of insects singing in the rainforest', 'the beach below the mountain', 'a little parrot on its shoulder', 'city lights going out one by one'],
  },
};

export interface TravelStoryRequest {
  /** 地标名，须与 LOCATIONS.place 一致（自定义地点可传中文地名） */
  place: string;
  /** 所属城市，如「北京」 */
  city?: string;
  /** 英文展示名，如 'Beijing · Forbidden City' */
  placeEn?: string;
  length: TravelLength;
  language: Language;
}

/**
 * 现场生成一篇带当地元素的睡前故事。
 * 返回 null 表示「这一篇没写成」，调用方应立刻降级到本地模板。
 */
export async function generateTravelStory(
  req: TravelStoryRequest
): Promise<{ title: string; content: string } | null> {
  const { place, city, placeEn, length, language } = req;
  const isZh = language === 'zh';

  // 地点展示名：中文用「北京·故宫」，英文用传入的英文名
  const spot = isZh
    ? city && city !== place
      ? `${city}的${place}`
      : place
    : placeEn || place;

  const el = PLACE_ELEMENTS[place];
  const elements = el ? (isZh ? el.zh : el.en) : [];

  let childName = '';
  let sensitiveWords: string[] = [];
  try {
    childName = (await getChildName()) || '';
    const s = await getSensitiveWords();
    sensitiveWords = [...s.words, ...s.phrases];
  } catch {
    // 读不到设置不影响生成，用空值继续
  }

  const who = childName
    ? isZh
      ? `小朋友「${childName}」`
      : `a child named ${childName}`
    : isZh
      ? '一位小朋友'
      : 'a child';

  const theme = isZh ? `${spot}的睡前奇遇` : `A bedtime adventure at ${spot}`;

  const protagonist = isZh
    ? `一只背着书的小浣熊，和${who}`
    : `a little raccoon carrying a storybook, and ${who}`;

  const details = (
    isZh
      ? [
          `故事必须发生在${spot}的夜晚，地点感要真实可辨。`,
          elements.length
            ? `故事里必须自然用上下面这些当地事物，至少 4 个，要融进情节里，不能像清单一样罗列：${elements.join('、')}。`
            : '',
          `主角是${who}和那只小浣熊，小浣熊负责讲睡前故事、陪着入睡。`,
          `故事要有一次小小的、温柔的奇遇，不要打斗、不要紧张。`,
          `结尾孩子在${spot}的夜色里安心睡着，最后一句是晚安。`,
        ]
      : [
          `The story must take place at ${spot} at night, and the place must feel real and recognisable.`,
          elements.length
            ? `Naturally weave in at least 4 of these local things, as part of the plot rather than a list: ${elements.join(', ')}.`
            : '',
          `The main characters are ${who} and the little raccoon, who tells the bedtime story and stays until the child falls asleep.`,
          `Include one small, gentle wonder — nothing scary or tense.`,
          `End with the child falling asleep in the night of ${spot}, and the last line is goodnight.`,
        ]
  )
    .filter(Boolean)
    .join('\n');

  try {
    const r = await generateStory({
      theme,
      protagonist,
      details,
      language,
      length,
      sensitiveWords,
      // 旅行打卡也是「真调 AI 生成」，同样计入当日生成次数（source 只影响埋点归因）。
      // 打卡页在进入生成流程前会先过 checkStoryGate，额度满了不会走到这里。
      source: 'travel',
    });
    // fallback = AI 没写成（无网/超额度/未配置 Key），此时 ai.ts 给的是通用童话，
    // 不带当地元素，不如本地旅行模板，故交回调用方降级
    if (r.fallback) return null;
    if (!r.content || r.content.trim().length < 150) return null;
    return { title: r.title, content: r.content };
  } catch (err: any) {
    console.warn('[travelStory] generate failed:', err?.message ?? err);
    return null;
  }
}
