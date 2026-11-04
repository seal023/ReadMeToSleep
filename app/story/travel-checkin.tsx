import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  Animated, Dimensions, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  useAudioRecorder,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { getProgress, saveProgress, getVoiceSetting } from '../../services/storage';
import { checkCheckInGate, FREE_TOTAL_CHECKIN_LIMIT } from '../../services/entitlement';
import { getNewBadges, computeRewardExtras, BADGES } from '../../constants/rewards';
import { playStory, stopStory } from '../../services/playback';
import { isClonedAudioPlaying } from '../../services/clonedVoicePlayback';
import { transcribeAudio } from '../../services/voiceClone';
import { generateTravelStory } from '../../services/travelStory';
import Racco from '../../components/common/Racco';
import { CartoonMap, type MapSpot } from '../../components/ui/CartoonMap';
import { CartoonScreen } from '../../components/ui/CartoonScreen';
import { ClayIcon } from '../../components/ui/ClayIcon';
import { useLanguage } from '../../hooks/useLanguage';
import { useEntitlement } from '../../hooks/useEntitlement';
import type { Language } from '../../types';

const { width } = Dimensions.get('window');

type Step = 'locate' | 'generate' | 'play' | 'success';

/**
 * 卡通世界地图上的打卡点（面向国内外孩子）。
 * 坐标采用等距柱状投影（equirectangular）：
 *   x = (经度 + 180) / 360 * 100
 *   y = (90 - 纬度) / 180 * 100
 * 仅保证相对方位正确，不追求地理精度（儿童向示意地图）。
 *
 * v84：中英文名拆成 4 个字段。原先只有 `en: 'Tokyo · Tower'` 这种「拼好的整串」，
 * 英文界面里地图图钉、列表标题、打卡记录却仍在用中文 `cn`/`place`，
 * 结果英文界面上到处是汉字（纽约、东京·东京塔、可打卡…）。
 * 现在显示名一律走 cityName()/placeName()/fullName()，中文界面零变化。
 */
const LOCATIONS = [
  // —— 中国 ——
  { cn: '北京', place: '故宫', cityEn: 'Beijing', placeEn: 'Forbidden City', emoji: '🏯', x: 82.3, y: 27.8 },
  { cn: '上海', place: '外滩', cityEn: 'Shanghai', placeEn: 'The Bund', emoji: '🌃', x: 83.8, y: 32.7 },
  { cn: '西安', place: '兵马俑', cityEn: "Xi'an", placeEn: 'Terracotta Warriors', emoji: '🗿', x: 80.3, y: 30.9 },
  { cn: '成都', place: '大熊猫基地', cityEn: 'Chengdu', placeEn: 'Panda Base', emoji: '🐼', x: 78.9, y: 33.0 },
  { cn: '杭州', place: '西湖', cityEn: 'Hangzhou', placeEn: 'West Lake', emoji: '🛶', x: 83.4, y: 33.2 },
  { cn: '桂林', place: '漓江', cityEn: 'Guilin', placeEn: 'Li River', emoji: '⛰️', x: 80.6, y: 35.9 },
  { cn: '拉萨', place: '布达拉宫', cityEn: 'Lhasa', placeEn: 'Potala Palace', emoji: '🏔️', x: 75.3, y: 33.5 },
  { cn: '大理', place: '洱海', cityEn: 'Dali', placeEn: 'Erhai Lake', emoji: '🌊', x: 77.9, y: 35.8 },
  // —— 世界 ——
  { cn: '巴黎', place: '埃菲尔铁塔', cityEn: 'Paris', placeEn: 'Eiffel Tower', emoji: '🗼', x: 50.7, y: 22.9 },
  { cn: '伦敦', place: '大本钟', cityEn: 'London', placeEn: 'Big Ben', emoji: '🕰️', x: 50.0, y: 21.4 },
  { cn: '纽约', place: '自由女神', cityEn: 'New York', placeEn: 'Statue of Liberty', emoji: '🗽', x: 29.4, y: 27.4 },
  { cn: '东京', place: '东京塔', cityEn: 'Tokyo', placeEn: 'Tokyo Tower', emoji: '🗾', x: 88.8, y: 30.2 },
  { cn: '悉尼', place: '歌剧院', cityEn: 'Sydney', placeEn: 'Opera House', emoji: '🏝️', x: 92.0, y: 68.8 },
  { cn: '开罗', place: '金字塔', cityEn: 'Cairo', placeEn: 'Pyramids', emoji: '🐫', x: 58.6, y: 33.3 },
  { cn: '里约', place: '基督像', cityEn: 'Rio', placeEn: 'Christ the Redeemer', emoji: '⛪', x: 38.0, y: 62.8 },
];

type TravelLoc = (typeof LOCATIONS)[number];

/** 城市名（按界面语言） */
const cityName = (l: TravelLoc, lang: Language) => (lang === 'en' ? l.cityEn : l.cn);
/** 地标名（按界面语言） */
const placeName = (l: TravelLoc, lang: Language) => (lang === 'en' ? l.placeEn : l.place);
/** 「城市 · 地标」整串（按界面语言；全 App 统一的展示格式） */
const fullName = (l: TravelLoc, lang: Language) =>
  lang === 'en' ? `${l.cityEn} · ${l.placeEn}` : `${l.cn}·${l.place}`;

/**
 * 旅行打卡故事：内置离线长故事（约 5-10 分钟，零运行期 token、零延迟、可缓存）。
 * 每段以一个地标的特色「钩子」开场，随后接统一舒缓的睡前中段与晚安收尾。
 */
const TRAVEL_HOOKS: Record<string, { title: string; hook: string }> = {
  '故宫': { title: '红墙里的月亮船', hook: '深夜，月光洒在故宫的红墙上。一只小狸猫悄悄溜进太和殿，发现每块地砖下都藏着一段被遗忘的故事。' },
  '外滩': { title: '黄浦江的星光', hook: '小男孩站在外滩的栏杆旁，看着江水倒映的霓虹灯。突然一颗星星落进江里，化作一条发光的小鱼。' },
  '兵马俑': { title: '地下军队的秘密', hook: '博物馆闭馆后，兵马俑们伸了伸懒腰，开始了他们每晚的巡逻。新来的陶俑编号734号，第一次站岗。' },
  '大熊猫基地': { title: '滚滚的竹林梦', hook: '小熊猫竹宝在竹林里做了一个梦——梦见自己长出了翅膀，飞过了整座青城山。' },
  '西湖': { title: '断桥上的小纸船', hook: '一只纸船从断桥出发，顺着水流漂过三潭印月，船上坐着一只用荷叶做成斗笠的小青蛙。' },
  '漓江': { title: '山水画的守护者', hook: '漓江水中有座小石山，山上住着一只水獭爷爷。他每天都会把路人丢的垃圾叼到岸边，说这是他的职责。' },
  '布达拉宫': { title: '高原上的风铃', hook: '布达拉宫的屋顶挂着一串风铃，每当风吹过，它就会唱起古老的藏歌，歌声飘到雪山脚下。' },
  '洱海': { title: '海底的月亮集市', hook: '洱海的水底有个集市，每月十五满月时才会开放。小鱼小虾都带着发光的贝壳去赶集。' },
  '埃菲尔铁塔': { title: '铁塔上的小星星', hook: '在巴黎的夜空下，埃菲尔铁塔亮起了金色的灯光。一只小狐狸爬到塔顶，发现每盏灯里都住着一颗想家的星星。' },
  '大本钟': { title: '大本钟的钟声', hook: '伦敦的雾里，大本钟叮咚敲响了睡前的时间。一只小熊撑着小红伞，沿着泰晤士河慢慢走。' },
  '自由女神': { title: '港口的灯塔女孩', hook: '纽约的港口边，自由女神举着火炬，为夜归的小船指路。一艘小帆船迷了路，火炬的光像温柔的手牵着它靠向安静的码头。' },
  '东京塔': { title: '塔下的纸飞机', hook: '东京的夜晚，东京塔闪着红白的光。一个小男孩折了一只蓝色的纸飞机，许愿它能飞到月亮上。' },
  '歌剧院': { title: '海湾的白帆', hook: '悉尼的海湾里，歌剧院像一朵朵张开的白帆。一只小考拉趴在桅杆上，跟着海浪的节拍轻轻摇晃。' },
  '金字塔': { title: '沙漠里的月亮船', hook: '开罗的沙漠上，金字塔静静守着千年的秘密。一只小骆驼驮着一盏小灯，陪着迷路的小星星回家。' },
  '基督像': { title: '山巅的张开双臂', hook: '里约的山顶上，基督像张开双臂，像在给整座城市一个温柔的拥抱。一只小鹦鹉停在雕像的肩上，看城市灯火一盏盏熄灭。' },
};

/** 故事长度档位（与创作页一致）：short≈5分钟 / medium≈8分钟 / long≈12分钟 */
type TravelLength = 'short' | 'medium' | 'long';

/**
 * 各地「专属中段」——让旅行故事真正和地名绑定，而不只是把通用段里的「地名」替换掉。
 * 每个地标 2 段，融入当地特有的景物 / 小动物 / 氛围，AI 离线生成阶段（不联网、零 token）
 * 也能保证 15 个故事各有各的味道。缺少专属中段的地点回落到通用舒缓中段。
 */
const TRAVEL_FLAVOR: Record<string, string[]> = {
  '故宫': [
    '小浣熊牵着小朋友的手，悄悄走过乾清宫的门槛，指着屋檐上排成一队的小兽说：你瞧，它们一到夜里就会偷偷下来散步呢。',
    '太和殿前的铜龟和铜鹤都闭上了眼睛，唯有月光把金色的琉璃瓦照得发亮，好像给整座宫殿盖了一层软软的被子。',
    '小朋友跟着小浣熊数屋脊上的脊兽，从龙、凤一直数到行什；数到最后一只时，宫墙那头恰好传来一声悠长的更鼓。',
    '御花园里的老槐树把影子铺在青砖上，小浣熊说：这棵树听过几百年的晚安，今晚也听你的。',
  ],
  '外滩': [
    '小浣熊坐在江边的长椅上，看对岸的钟楼一下一下数着星星，黄浦江的水波把霓虹揉成了会流动的彩带。',
    '一艘轮渡嘟嘟地靠了岸，载着刚下班的大人和困得打哈欠的小狗，小浣熊轻轻说：我们也在回家的路上啦。',
    '海关大楼的钟敲了十下，江面上的游船把灯光拖成一条会晃动的金线，小浣熊数着数着就忘了数到几。',
    '对岸的楼群像一排安静的灯笼，风从江面吹来，带着淡淡水汽，把小朋友的头发吹得软软的。',
  ],
  '兵马俑': [
    '新来的陶俑编号734学着将军俑的样子挺直腰板，悄悄跟小朋友比了个安静的手势：嘘，今晚由我来守护这片土地。',
    '成千上万的陶俑在月光下泛着淡淡的陶土色，小浣熊数着数着，就趴在小朋友的肩头睡着了。',
    '734号悄悄告诉小朋友：他们白天一动不动，其实是在把几千年的故事站成一支队伍，等夜里讲给愿意听的孩子。',
    '坑里的灯熄了一半，陶俑的影子长长地铺在黄土上，小浣熊踮着脚走过，怕惊扰了他们。',
  ],
  '大熊猫基地': [
    '小熊猫竹宝抱着一根竹子滚到小朋友脚边，奶爸在远处打着哈欠说：它今天已经追了三圈秋千啦。',
    '竹林里飘着淡淡的竹叶香，小浣熊和竹宝并排躺着，数着从叶子缝里漏下来的月光。',
    '饲养员的手电筒在竹林深处晃了一下就灭了，竹宝翻个身，把圆滚滚的肚子朝向月亮，睡得直打呼。',
    '竹叶上的露水顺着叶尖滴下来，啪嗒一声，小浣熊竖起耳朵听了半天，才笑着说：是竹子在做梦呢。',
  ],
  '西湖': [
    '小浣熊带着小朋友坐上小纸船，从断桥慢慢摇到苏堤，荷叶底下躲着一只打着瞌睡的小青蛙。',
    '远处的雷峰塔亮起暖黄的灯，倒映在湖面上像一颗慢慢沉下去的星星。',
    '苏堤上的柳枝垂到水面，被夜风轻轻拨动，像谁在用很轻的手指，梳着湖的头发。',
    '湖心亭只剩一盏灯，小青蛙从荷叶下探出头说：今晚我守夜，你安心睡。',
  ],
  '漓江': [
    '一只鸬鹚站在渔夫的竹筏头，把头埋进翅膀里打盹，渔火在水面拉出一条长长的金色尾巴。',
    '小浣熊学着鸬鹚的样子单脚站在船头，晃了晃，逗得小朋友咯咯地笑出了声。',
    '两岸的山在夜里变成一张张安静的脸，小浣熊指给小朋友看：那座像骆驼，那座像在低头喝水。',
    '渔火一盏盏熄了，只剩水声；竹筏轻轻晃，像一只被江面抱着的摇篮。',
  ],
  '布达拉宫': [
    '小浣熊跟着转经筒一圈一圈地走，看酥油灯一盏盏亮起来，把白色的墙映成了温柔的橘黄。',
    '几只不怕人的鸽子落在小朋友肩头，布达拉宫的风铃在风里轻轻唱起古老的歌。',
    '台阶一级一级往上，小浣熊走一步歇一步，说这里的空气薄，正好适合把呼吸也放慢。',
    '远处的雪山尖上还留着最后一点光，像有人把月亮的一角，挂在了那里。',
  ],
  '洱海': [
    '小浣熊和小白族娃娃划着小木船，看海菜花在水底一闪一闪，像撒了一把会发光的小银币。',
    '远处的小普陀岛静悄悄的，只有水波一下一下拍着岸，像在给洱海唱摇篮曲。',
    '月亮从苍山背后升起来，把洱海照成一面会呼吸的镜子，小木船在上面滑得很轻很轻。',
    '白族老奶奶家的院门还留着一条缝，透出暖黄的光；小浣熊说，那是给晚归的人留的灯。',
  ],
  '埃菲尔铁塔': [
    '小浣熊爬到铁塔的台阶上，看塞纳河上的游船一艘艘滑过，灯影在河水里碎成了金色的星星。',
    '远处的摩天轮慢慢转着，小浣熊靠在铁艺栏杆上，听巴黎的夜风讲着温柔的悄悄话。',
    '整点到了，塔上的灯闪成一片细碎的星雨，小狐狸仰着头，眼睛都不舍得眨。',
    '塞纳河边的旧书摊收起了绿箱子，卖画的人卷起最后一张画，画上的天空和此刻一样蓝。',
  ],
  '大本钟': [
    '小浣熊撑着小红伞，跟着一群鸽子走过桥，大本钟当当敲了两下，像在跟小朋友说晚安。',
    '红色的双层巴士一辆辆开过，车窗里映出暖黄的灯，小浣熊说：每家每户都准备睡啦。',
    '钟楼的指针在雾里慢慢走，小浣熊说：它走得慢，是因为不想让夜晚太快过去。',
    '河边的长椅上留着一份报纸，被风吹得翻了一页，上面印着明天的天气——晴，适合做梦。',
  ],
  '自由女神': [
    '小浣熊坐上渡轮，看自由女神举着的火炬把港湾照出一条金色的水路，海鸥贴着浪花飞。',
    '布鲁克林桥的灯一串串亮起来，小朋友靠在妈妈怀里，听海风把远处的汽笛声吹得好长好长。',
    '一架夜航的飞机从远处掠过，像一颗慢慢移动的星星；那只小火炬始终安静地亮着。',
    '码头边的海鸥收起翅膀，把头埋进羽毛；小浣熊学着它的样子，也把下巴缩进了围巾。',
  ],
  '东京塔': [
    '小浣熊在塔下的小公园里，看粉色的灯笼一盏盏亮起，隅田川上漂着几只小小的赏灯船。',
    '远处传来叮叮的电车声，小浣熊学着站台上的小猫，眯起眼睛打了个小小的哈欠。',
    '塔身的红白灯光一层层往上亮，像有人在给夜空挂一串会发光的糖葫芦。',
    '街角的自动贩卖机还亮着，小浣熊买了一罐热牛奶捧在手心，说：这一半给你暖手。',
  ],
  '歌剧院': [
    '小浣熊趴在白色的船帆下，看海港大桥的钢索在月光里像一把巨大的竖琴，海鸥停在桅杆上打盹。',
    '一艘渡轮拉响低低的汽笛，小浣熊说：连大海都准备合上眼睛啦。',
    '歌剧院的贝壳屋顶在月光下泛着白，海风一吹，好像真的要启航去一个很远的地方。',
    '环形的码头上有个人在拉小提琴，曲子慢得像水波，小考拉听着听着就闭上了眼。',
  ],
  '金字塔': [
    '小骆驼驮着小浣熊慢慢走在沙丘上，星河像一条银色的河从头顶一直流到沙漠尽头。',
    '狮身人面像静静卧在月光里，小浣熊把耳朵贴在地上，听见沙子被夜风轻轻翻了翻身。',
    '小骆驼说，它爷爷的爷爷就走过这条路；沙子记性好，把每个脚印都留在原地。',
    '远处的绿洲有一小片水，映着月亮，像沙漠偷偷藏起来的一面小镜子。',
  ],
  '基督像': [
    '小浣熊坐在雨林边的长椅上，看山下的城市一盏盏熄灯，只剩基督像胸前的光还温柔地亮着。',
    '远处传来轻轻的海浪和隐约的吉他声，小浣熊说：这座城市也要睡个好觉啦。',
    '雨林里的虫鸣一层一层叠起来，像有人在很远的地方，轻轻拍手打拍子。',
    '山下的海滩上还留着白天的脚印，浪一来就抹平了；小浣熊说：大海也在收拾房间呢。',
  ],
};

/** 通用舒缓中段（地名嵌入其中，作为「专属中段」之外的兜底）。
 *  按长度返回不同段落数：short≈4段 / medium≈5段（默认）/ long≈7段，朗读时长随之变化 */
function travelMiddle(name: string, length: TravelLength = 'medium', flavorKey?: string): string {
  const flavor = flavorKey ? TRAVEL_FLAVOR[flavorKey] : undefined;
  const f1 = flavor?.[0] ?? '';
  const f2 = flavor?.[1] ?? '';
  const f3 = flavor?.[2] ?? '';
  const f4 = flavor?.[3] ?? '';
  const p1 = `夜色里的${name}渐渐安静下来。月光轻轻铺在${name}的每一处角落，远处的灯光一盏盏变得温柔，连风都放慢了脚步。星星在天上眨着眼睛，好像在悄悄守护着这座城市，也守护着这里每一个准备睡觉的小朋友。`;
  const p2 = `一只毛茸茸的小浣熊悄悄来到小朋友的窗前。它不想吵醒谁，只是轻轻坐下，用最慢、最软的声音，把${name}白天里那些好玩的事情又讲了一遍——白天热闹的街道、笑闹的声音、被阳光晒得暖暖的石头，到了晚上都变成了一个安静又温柔的梦乡。`;
  const p3 = `小浣熊带着小朋友，在故事里又慢慢地逛了一遍${name}。他们看见安静的树影在轻轻摇晃，听见远处传来的声音越来越轻，像有人在很远处哼着歌。${name}的一切都慢慢睡熟了，只剩下月亮还醒着，把银色的光轻轻盖在屋顶上。`;
  const p4 = `慢慢地，周围的声音越来越小，灯光也越来越柔和。小朋友的眼皮一点点变沉，呼吸变得轻轻的、慢慢的，就像海浪一下一下拍着岸边。小浣熊不再说话，只是陪在旁边，用软软的尾巴给小朋友当枕头。`;
  const p5 = `不知什么时候，风也停了，星星也眯起了眼。小朋友的手慢慢松开了，进入了甜甜的梦乡。`;
  // long 专属：让节奏再舒缓一点，延长助眠感
  const p6 = `小朋友在故事里打了个小小的哈欠，小浣熊轻轻拍着他的背，像在哄一个最珍贵的宝贝。远处的${name}传来若有若无的虫鸣，和着小浣熊轻轻的呼吸，哼起了一首最温柔的安眠曲。`;
  const p7 = `${name}的夜色越来越深，一朵云慢慢飘过月亮的脸，洒下斑驳的光影。小朋友的手指松开了小浣熊的尾巴，整个人都舒舒服服地陷进了软软的被窝里。`;

  // v79：每个地标补到 4 段专属内容后，中段几乎全用地标专属段落，
  // 通用段只留「收尾助眠」的部分 —— 这才是用户说的「故事真的不一样了」。
  let paras: string[];
  if (length === 'short') paras = flavor ? [f1, f2, p4, p5] : [p1, p2, p4, p5];
  else if (length === 'long') paras = flavor ? [f1, f2, f3, f4, p3, p6, p7, p4, p5] : [p1, p2, p3, p6, p7, p4, p5];
  else paras = flavor ? [f1, f2, f3, p3, p4, p5] : [p1, p2, p3, p4, p5];
  return paras.filter(Boolean).join('\n\n');
}

/** 晚安收尾（含地名），让故事安宁助眠地结束。
 *  修复 #1：原句用了全角分号「晚安，x；晚安，小朋友。」（中文里不自然），
 *  且直接套用了半角英文双引号；这里改为句号断句 + 中文全角引号「“”」。 */
function travelEnding(name: string): string {
  return `小浣熊把软软的毯子轻轻盖在小朋友身上，哼起了一首谁也听不懂、却让人心里很安稳的摇篮曲。它小声说：“晚安，${name}。晚安，小朋友。今晚的月亮会一直陪着你，做个关于星星和云的好梦吧。”说完，小浣熊也蜷起尾巴，在${name}温柔的夜色里，悄悄地睡着了。`;
}

/** 由「地标特色钩子 + 专属/通用中段 + 晚安收尾」拼成离线睡前故事（长度可选）。
 *  flavorKey 用于挑选该地标的「专属中段」，让故事真正和地名绑定而非仅替换地名。 */
function buildLongTravelStory(name: string, hook?: string, length: TravelLength = 'medium', flavorKey?: string): { title: string; content: string } {
  const head = hook
    ? `${hook}\n\n小浣熊没有打扰这份安静，它轻轻坐在旁边，想把这个地方的夜晚，讲成一个长长的、暖暖的睡前故事。`
    : `夜深了，${name}慢慢安静下来。窗外的风轻轻吹过，星星在天上眨着眼睛。一只温柔的小动物悄悄来到${name}，想给这里的小朋友讲一个甜甜的睡前故事。`;
  return {
    title: `${name}的睡前奇遇`,
    content: `${head}\n\n${travelMiddle(name, length, flavorKey)}\n\n${travelEnding(name)}`,
  };
}

const STORIES: Record<string, { title: string; content: string }> = {};
for (const [place, info] of Object.entries(TRAVEL_HOOKS)) {
  const s = buildLongTravelStory(place, info.hook, 'medium', place);
  STORIES[place] = { title: info.title, content: s.content };
}

/** 地图上没有的自定义地点，用这个通用睡前故事兜底（不依赖 AI，离线零 token） */
function genericTravelStory(name: string, length: TravelLength = 'medium'): { title: string; content: string } {
  const s = buildLongTravelStory(name, undefined, length);
  return { title: s.title, content: s.content };
}

/** 长度档位展示文案（与创作页长度选择完全一致：短 3 / 中 15 / 长 25 分钟） */
const LENGTH_LABELS: Record<TravelLength, { zh: string; en: string; tagZh: string; tagEn: string }> = {
  short: { zh: '短', en: 'Short', tagZh: '~3分钟', tagEn: '~3 min' },
  medium: { zh: '中', en: 'Medium', tagZh: '~15分钟', tagEn: '~15 min' },
  long: { zh: '长', en: 'Long', tagZh: '~25分钟', tagEn: '~25 min' },
};

/** 等待时的轮换提示：孩子不识字也靠小浣熊和动效知道「还在做，别走」 */
const GEN_HINTS = [
  { zh: '正在收拾小背包，准备出发～', en: 'Packing a little bag, getting ready…' },
  { zh: '正在数那里的星星…', en: 'Counting the stars over there…' },
  { zh: '正在把当地的小东西写进故事…', en: 'Tucking local little things into the story…' },
  { zh: '快好了，先躺好闭上眼睛吧～', en: 'Almost there — lie down and close your eyes…' },
];

const BADGE_RULES = [
  { count: 1, emoji: '🚩', label: { zh: '首次打卡', en: 'First Check-in' } },
  { count: 3, emoji: '🏅', label: { zh: '三城达人', en: '3 Cities' } },
  { count: 7, emoji: '🥈', label: { zh: '七城行者', en: '7 Cities' } },
  { count: 15, emoji: '🥇', label: { zh: '十五城传奇', en: '15 Cities Legend' } },
];

const stepConfig: { key: Step; icon: string; zh: string; en: string }[] = [
  { key: 'locate', icon: '📍', zh: '定位', en: 'Place' },
  { key: 'generate', icon: '✨', zh: '生成', en: 'Write' },
  { key: 'play', icon: '📖', zh: '播放', en: 'Listen' },
  { key: 'success', icon: '✅', zh: '打卡', en: 'Done' },
];

export default function TravelCheckinScreen() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [step, setStep] = useState<Step>('locate');
  const [location, setLocation] = useState('');
  const [selectedLoc, setSelectedLoc] = useState<typeof LOCATIONS[number] | null>(null);
  const [query, setQuery] = useState('');
  const [visitedPlaces, setVisitedPlaces] = useState<string[]>([]);
  const [story, setStory] = useState<{ title: string; content: string } | null>(null);
  // 本次故事是否退回了本地模板（AI 没写成）——给家长一个明确信号，而不是静默降级
  const [storyFallback, setStoryFallback] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [badge, setBadge] = useState<{ emoji: string; label: string } | null>(null);
  const [confetti, setConfetti] = useState<{ x: number; color: string; delay: number }[]>([]);
  const confettiAnims = useRef<Animated.Value[]>([]);
  // 奖励增强：累计打卡数 + 已得徽章列表，供 success 页陈列
  const [checkInTotal, setCheckInTotal] = useState(0);
  const [earnedBadges, setEarnedBadges] = useState<string[]>([]);
  // 故事长度选择（#3：与创作页一致，short/medium/long），默认中
  const [storyLength, setStoryLength] = useState<TravelLength>('medium');
  const { snapshot, refresh, showPaywall } = useEntitlement();

  /**
   * v91 #3：任何步骤都能退出。
   * 之前只有「打卡成功」页有返回键，故事生成出来后必须听完才走得掉。
   * 注意：退出只影响界面，打卡判定仍然只认「故事听完」（handlePlay 里播完才 handleCheckIn）。
   */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopStory(); // 离开页面立刻停声，避免「界面走了、故事还在读」
    };
  }, []);

  const handleBack = () => {
    stopStory();
    try {
      if (router.canGoBack()) {
        router.back();
        return;
      }
    } catch {
      /* 个别平台没有 canGoBack，直接兜底 */
    }
    router.replace('/(tabs)');
  };

  // 生成中的轮换提示：AI 现场写作要 10~40 秒，静止画面会让孩子以为卡住了
  const [genHintIdx, setGenHintIdx] = useState(0);
  useEffect(() => {
    if (step !== 'generate') return;
    setGenHintIdx(0);
    const id = setInterval(() => setGenHintIdx((i) => (i + 1) % GEN_HINTS.length), 3200);
    return () => clearInterval(id);
  }, [step]);

  // 语音输入：复用 expo-audio 录音 + 百炼 ASR 转写，写入搜索框并自动匹配已有城市
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'processing'>('idle');

  // 把语音/文字与预设地点做双向模糊匹配（中文常带"我想去""的"等语气词，用 includes 双向容错）
  const autoMatchLocation = (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    const lower = q.toLowerCase();
    const matched = LOCATIONS.find((l) => {
      const cn = l.cn;
      const place = l.place;
      const cityEn = l.cityEn.toLowerCase();
      const placeEn = l.placeEn.toLowerCase();
      return (
        cn.includes(q) || q.includes(cn) ||
        place.includes(q) || q.includes(place) ||
        cityEn.includes(lower) || lower.includes(cityEn) ||
        placeEn.includes(lower) || lower.includes(placeEn) ||
        lower.includes(`${cityEn} ${placeEn}`)
      );
    });
    if (matched) setSelectedLoc(matched);
  };

  const handleVoiceInput = async () => {
    // 正在听 → 停止并转写
    if (voiceState === 'listening') {
      try {
        await audioRecorder.stop();
        const u = audioRecorder.uri || null;
        setVoiceState('processing');
        if (u) {
          const text = await transcribeAudio(u);
          if (text && text.trim()) {
            const q = text.trim();
            setQuery(q);
            autoMatchLocation(q);
          }
        }
      } catch (err) {
        console.warn('[checkin] voice transcribe failed:', err);
      }
      setVoiceState('idle');
      return;
    }
    // 空闲 → 开始录音
    try {
      // 录音前先停掉正在读的提示音 / 故事（否则录进杂音、且会话切不过去会录不到）
      stopStory();
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          language === 'en' ? 'Microphone needed' : '需要麦克风权限',
          language === 'en' ? 'Please allow microphone to use voice search' : '请允许使用麦克风，才能用语音搜地点'
        );
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setVoiceState('listening');
    } catch (err) {
      console.warn('[checkin] voice record failed:', err);
      setVoiceState('idle');
    }
  };

  // 读取历史打卡，地图上已去过的地方显示金色星星
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await getProgress();
        if (cancelled) return;
        // checkIns 里存的是展示名（如「北京·故宫」），这里统一按城市名匹配
        const places = p.checkIns.map((c) => c.location.split('·')[0].trim());
        setVisitedPlaces(places);
      } catch {
        // 读不到就当没有历史，不影响打卡
      }
    })();
    return () => { cancelled = true; };
  }, [step]);

  // Generate confetti
  useEffect(() => {
    if (step === 'success') {
      const items = Array.from({ length: 20 }, () => ({
        x: Math.random() * width,
        color: ['#F2827F', '#4ECDC4', '#FFE66D', '#A8E6CF', '#DDA0DD'][Math.floor(Math.random() * 5)],
        delay: Math.random() * 1000,
      }));
      setConfetti(items);
      confettiAnims.current = items.map(() => new Animated.Value(0));
    }
  }, [step]);

  // Animate confetti
  useEffect(() => {
    if (step !== 'success' || confetti.length === 0) return;
    const animations = confetti.map((_, i) =>
      Animated.timing(confettiAnims.current[i], {
        toValue: 1, duration: 1500, delay: confetti[i].delay,
        useNativeDriver: false,
      })
    );
    Animated.parallel(animations).start();
  }, [step, confetti]);

  // 从地图上选好地点后开始打卡
  const handleStart = async () => {
    if (!selectedLoc) return;

    // 打卡额度门禁（会员不限）。放在流程入口，避免用户走完一圈才发现不能打卡
    const gate = await checkCheckInGate();
    if (!showPaywall(gate)) return;

    const loc = selectedLoc;
    // 打卡记录里存「当前界面语言」的完整名：中文存「东京·东京塔」，英文存「Tokyo · Tokyo Tower」
    setLocation(fullName(loc, language === 'en' ? 'en' : 'zh'));
    setStep('generate');

    // 本地模板先备好：AI 生成失败 / 无网 / 额度耗尽时立刻顶上，保证永远有故事可听
    const local: { title: string; content: string } = STORIES[loc.place]
      ? buildLongTravelStory(loc.place, TRAVEL_HOOKS[loc.place]?.hook, storyLength, loc.place)
      : genericTravelStory(loc.cn, storyLength);

    // 现场生成：每次都不一样，且带当地元素（脊兽、渔火、转经筒…）
    // 与「最短展示时长」并行，避免瞬间切走让等待看起来像假加载
    const [ai] = await Promise.all([
      generateTravelStory({
        place: loc.place,
        city: loc.cn,
        placeEn: fullName(loc, 'en'),
        length: storyLength,
        language: language === 'zh' ? 'zh' : 'en',
      }),
      new Promise<void>((r) => setTimeout(r, 1400)),
    ]);

    setStoryFallback(!ai);
    setStory(ai ?? local);
    setStep('play');
  };

  // Play story (真克隆声优先，未克隆则系统音)
  const handlePlay = async () => {
    if (isPlaying || !story) return;
    setIsPlaying(true);
    try {
      const saved = await getVoiceSetting();
      const lang = language === 'zh' ? 'zh' : 'en';
      // 播完（克隆声轮询 / 系统音 onDone）或被兜底超时打断后再打卡，避免流程卡住
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const timer = setTimeout(finish, Math.max(20000, story.content.length * 280));
        playStory(story.content, saved, lang, () => {
          clearTimeout(timer);
          finish();
        }).catch(() => {
          clearTimeout(timer);
          finish();
        });
      });
    } catch (err) {
      console.warn('[checkin] tts failed:', err);
    }
    /**
     * v84 反馈 #5：「打卡成功」在故事还没讲完时就跳出来了。
     * 播完回调有可能早到（音频时长刚加载 / 云端合成音起点抖动），此时故事其实还在讲。
     * 打卡是「听完才算」的仪式感，宁可多等：只要音频还在响就继续等，
     * 直到它真的停下（上限按正文长度放宽，避免异常情况下无限等待）。
     */
    const waitCapMs = Math.max(60000, (story?.content.length ?? 0) * 400);
    const waitStart = Date.now();
    while (isClonedAudioPlaying() && Date.now() - waitStart < waitCapMs) {
      await new Promise((r) => setTimeout(r, 300));
    }
    setIsPlaying(false);
    // 已经离开页面（点了返回）：不记打卡，避免「没听完也打卡成功」
    if (!aliveRef.current) return;
    handleCheckIn();
  };

  // Check-in
  const handleCheckIn = async () => {
    const progress = await getProgress();
    const checkIn = { location, date: new Date().toISOString(), storyId: `travel_${Date.now()}` };
    const newCheckIns = [...progress.checkIns, checkIn];
    const total = newCheckIns.length;

    // Determine new badge（本地打卡里程碑 + 全局收听激励，如月度小达人 / 年度陪伴）
    let newBadge: { emoji: string; label: string } | null = null;
    for (const rule of BADGE_RULES) {
      if (total >= rule.count && !progress.badges.includes(rule.emoji)) {
        newBadge = { emoji: rule.emoji, label: rule.label[language] };
      }
    }

    const extras = computeRewardExtras(progress.listenLog);
    const freshGlobal = getNewBadges(
      {
        listenedCount: progress.listenedStories.length,
        streakDays: progress.streakDays,
        checkInCount: progress.checkIns.length,
        monthCount: extras.monthCount,
        listenSpanDays: extras.listenSpanDays,
      },
      progress.badges,
    );
    // 把全局新勋章也并入「已得徽章」墙；若没有本地打卡徽章，则用第一个全局新勋章做弹窗提示
    const freshGlobalEmoji = freshGlobal.map((b) => b.id);
    const merged = [...progress.badges];
    for (const id of freshGlobalEmoji) if (!merged.includes(id)) merged.push(id);
    if (!newBadge && freshGlobal.length) {
      const fb = freshGlobal[0];
      newBadge = {
        emoji: fb.emoji,
        label: language === 'en' ? fb.nameEn : fb.name,
      };
    }

    const newBadges = newBadge && !progress.badges.includes(newBadge.emoji)
      ? [...merged, newBadge.emoji]
      : merged;
    await saveProgress({ ...progress, checkIns: newCheckIns, badges: newBadges });
    await refresh();

    setBadge(newBadge);
    setCheckInTotal(total);
    setEarnedBadges(newBadges);
    setStep('success');
  };

  // 地图数据：把 LOCATIONS 转成 CartoonMap 需要的格式，并标出已打卡的
  const mapSpots: MapSpot[] = LOCATIONS.map((l) => ({
    id: l.place,
    // 英文界面只出现英文名：地图图钉上的字也跟着界面语言走
    name: cityName(l, language),
    place: placeName(l, language),
    emoji: l.emoji,
    x: l.x,
    y: l.y,
    // 打卡记录里存的是当时的界面语言（中文「东京」或英文「Tokyo」），两种都认
    visited: visitedPlaces.includes(l.cn) || visitedPlaces.includes(l.cityEn),
  }));

  /**
   * 星星墙上的地名：打卡记录保存的是「打卡当时的界面语言」，
   * 切到英文界面后要重新映射成英文，否则会出现一串中文地名。
   * 自定义地点（地图上没有的）原样显示。
   */
  const localizedVisited = (stored: string) => {
    const hit: TravelLoc | undefined = LOCATIONS.find(
      (l) =>
        l.cn === stored ||
        l.cityEn === stored ||
        l.place === stored ||
        l.placeEn === stored
    );
    if (!hit) return stored;
    return language === 'en' ? hit.cityEn : hit.cn;
  };

  // Step indicator
  const stepIdx = stepConfig.findIndex(s => s.key === step);
  const StepIndicator = () => (
    <View style={styles.stepRow}>
      {stepConfig.map((s, i) => (
        <React.Fragment key={s.key}>
          <View style={[
            styles.stepCircle,
            i < stepIdx && styles.stepDone,
            i === stepIdx && styles.stepActive,
          ]}>
            {i < stepIdx ? (
              <Text style={styles.stepDoneIcon}>✓</Text>
            ) : (
              <Text style={[styles.stepIcon, i === stepIdx && styles.stepIconActive]}>{s.icon}</Text>
            )}
          </View>
          <Text style={[styles.stepLabel, i === stepIdx && styles.stepLabelActive]}>
            {language === 'en' ? s.en : s.zh}
          </Text>
          {i < stepConfig.length - 1 && <View style={styles.stepLine} />}
        </React.Fragment>
      ))}
    </View>
  );

  // Confetti render
  const renderConfetti = () =>
    confetti.map((c, i) => (
      <Animated.View
        key={i}
        style={{
          position: 'absolute', left: c.x, top: -20,
          transform: [
            { translateY: confettiAnims.current[i]?.interpolate({ inputRange: [0, 1], outputRange: [0, 600] }) ?? 0 },
            { translateX: confettiAnims.current[i]?.interpolate({ inputRange: [0, 1], outputRange: [0, (Math.random() - 0.5) * 100] }) ?? 0 },
          ],
          opacity: confettiAnims.current[i] ?? 1,
          width: 10, height: 10, borderRadius: 5, backgroundColor: c.color,
        }}
      />
    ));

  return (
    <CartoonScreen gradient="day" decor wide={false}>
      <View style={styles.container}>
      {/* Background confetti */}
      {step === 'success' && renderConfetti()}

      {/* v91 #3：常驻返回键（所有步骤都有）。
          故事生成后也能直接退出，不必非听完；打卡仍以「听完」为准。 */}
      <TouchableOpacity style={styles.floatBackBtn} onPress={handleBack} activeOpacity={0.75}>
        <Text style={styles.floatBackText}>←</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.header}>{language === 'en' ? 'Travel Check-in' : '旅行打卡'}</Text>
        <StepIndicator />

        {/* ── Step: Locate ── */}
        {step === 'locate' && (
          <View style={styles.card}>
            <Text style={styles.cardEmoji}>🗺️</Text>
            <Text style={styles.cardTitle}>
              {language === 'en' ? 'Tap a pin to pick a place' : '点一下地图上的小图钉'}
            </Text>
            <Text style={styles.cardDesc}>
              {language === 'en'
                ? 'Tap a pin on the map, or say the place you arrived at into the microphone — then we\'ll tell a story about it'
                : '点一下地图上的小图钉，或者对着麦克风说你抵达的地方，我们会为那里讲一个故事'}
            </Text>

            {/* 搜索框：可过滤预设地点，也可输入地图上没有的地名直接打卡 */}
            <View style={styles.searchBox}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                value={query}
                placeholder={language === 'en' ? 'Search or say a place name' : '搜索或语音说出地点'}
                placeholderTextColor="#999"
                onChangeText={setQuery}
              />
              {voiceState === 'processing' ? (
                <ActivityIndicator size="small" color="#FF8A65" style={{ marginLeft: 6 }} />
              ) : (
                <TouchableOpacity
                  style={[styles.micBtn, voiceState === 'listening' && styles.micBtnActive]}
                  onPress={handleVoiceInput}
                >
                  {voiceState === 'listening' ? (
                    <Text style={styles.micIcon}>⏹️</Text>
                  ) : (
                    <ClayIcon name="mic" size={30} />
                  )}
                </TouchableOpacity>
              )}
              {query && voiceState === 'idle' ? (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <Text style={styles.clearBtn}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {voiceState === 'listening' && (
              <View style={styles.voiceHint}>
                <Text style={styles.voiceHintText}>
                  {language === 'en' ? 'Listening… tap 🎤 again to stop' : '正在听你说… 再点一下 🎤 停止'}
                </Text>
              </View>
            )}
            {voiceState === 'processing' && (
              <View style={styles.voiceHint}>
                <Text style={styles.voiceHintText}>
                  {language === 'en' ? 'Recognizing…' : '识别中…'}
                </Text>
              </View>
            )}

            <CartoonMap
              spots={mapSpots}
              selectedId={selectedLoc ? selectedLoc.place : null}
              onSelect={(spot) =>
                setSelectedLoc(LOCATIONS.find((l) => l.place === spot.id) ?? null)
              }
              legend={
                language === 'en'
                  ? { todo: 'To visit', done: 'Visited' }
                  : { todo: '可打卡', done: '已打卡' }
              }
              hint={
                selectedLoc
                  ? (language === 'en'
                      ? `Selected: ${fullName(selectedLoc, 'en')}`
                      : `已选好：${fullName(selectedLoc, 'zh')}`)
                  : (language === 'en' ? 'No place picked yet' : '还没选地点哦～')
              }
            />

            {/* 列表选择：图钉重叠 / 底部点不到时，直接从列表选，保证每个地点都能选 */}
            <Text style={styles.listTitle}>
              {language === 'en' ? 'Or pick from the list' : '或从列表里选一个'}
            </Text>
            <ScrollView style={styles.locList} nestedScrollEnabled>
              {(() => {
                const q = query.trim();
                const ql = q.toLowerCase();
                // 中英文名都参与匹配：英文界面输入 Tokyo、中文界面输入 东京 都能命中
                const matches = (l: TravelLoc) =>
                  l.cn.includes(q) ||
                  l.place.includes(q) ||
                  l.cityEn.toLowerCase().includes(ql) ||
                  l.placeEn.toLowerCase().includes(ql);
                const filtered = q ? LOCATIONS.filter(matches) : LOCATIONS;
                const exact = q
                  ? LOCATIONS.some(
                      (l) =>
                        l.cn === q ||
                        l.place === q ||
                        l.cityEn.toLowerCase() === ql ||
                        l.placeEn.toLowerCase() === ql ||
                        fullName(l, 'en').toLowerCase() === ql ||
                        fullName(l, 'zh') === q
                    )
                  : true;
                const customSel = !!selectedLoc && selectedLoc.place === q && !exact;
                return (
                  <>
                    {q && !exact && (
                      <TouchableOpacity
                        style={[styles.locItem, customSel && styles.locItemActive]}
                        onPress={() =>
                          setSelectedLoc({
                            cn: q,
                            place: q,
                            cityEn: q,
                            placeEn: q,
                            emoji: '📍',
                            x: 50,
                            y: 30,
                          })
                        }
                      >
                        <Text style={styles.locEmoji}>📍</Text>
                        <View style={styles.locTextWrap}>
                          <Text style={styles.locName}>{q}</Text>
                          <Text style={styles.locEn}>
                            {language === 'en' ? 'Use this custom place' : '使用这个地点打卡'}
                          </Text>
                        </View>
                        {customSel && <Text style={styles.locCheck}>✓</Text>}
                      </TouchableOpacity>
                    )}
                    {filtered.map((l) => {
                      const isSel = selectedLoc?.place === l.place;
                      return (
                        <TouchableOpacity
                          key={l.place}
                          style={[styles.locItem, isSel && styles.locItemActive]}
                          onPress={() => setSelectedLoc(l)}
                        >
                          <Text style={styles.locEmoji}>{l.emoji}</Text>
                          <View style={styles.locTextWrap}>
                            {/*
                              中文界面：主行「城市·地标」+ 英文副行（方便双语家庭）；
                              英文界面：只留英文主行，不再出现任何汉字。
                            */}
                            <Text style={styles.locName}>{fullName(l, language)}</Text>
                            {language === 'zh' ? (
                              <Text style={styles.locEn}>{`${l.cityEn} · ${l.placeEn}`}</Text>
                            ) : null}
                          </View>
                          {isSel && <Text style={styles.locCheck}>✓</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                );
              })()}
            </ScrollView>

            {snapshot && !snapshot.premium && snapshot.checkInsRemaining !== null
              && FREE_TOTAL_CHECKIN_LIMIT < 100 && (
              <Text style={styles.quota}>
                {language === 'en'
                  ? `${snapshot.checkInsRemaining} check-ins left · Unlimited with membership`
                  : `还可打卡 ${snapshot.checkInsRemaining} 次 · 会员不限`}
              </Text>
            )}

            {/* 故事长度选择（#3：与创作页一致） */}
            <View style={styles.lengthWrap}>
              <Text style={styles.lengthTitle}>
                {language === 'en' ? 'Story length' : '故事长度'}
              </Text>
              <View style={styles.lengthRow}>
                {(['short', 'medium', 'long'] as TravelLength[]).map((k) => (
                  <TouchableOpacity
                    key={k}
                    style={[styles.lengthChip, storyLength === k && styles.lengthChipActive]}
                    onPress={() => setStoryLength(k)}
                  >
                    <Text style={[styles.lengthChipText, storyLength === k && styles.lengthChipTextActive]}>
                      {language === 'en' ? LENGTH_LABELS[k].en : LENGTH_LABELS[k].zh}
                    </Text>
                    <Text style={[styles.lengthChipSub, storyLength === k && styles.lengthChipSubActive]}>
                      {language === 'en' ? LENGTH_LABELS[k].tagEn : LENGTH_LABELS[k].tagZh}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, !selectedLoc && styles.primaryBtnDisabled]}
              onPress={handleStart}
              disabled={!selectedLoc}
            >
              <Text style={styles.primaryBtnText}>
                {selectedLoc
                  ? (language === 'en'
                      ? `Start Check-in · ${LENGTH_LABELS[storyLength].en}`
                      : `去 ${selectedLoc.cn} 打卡 · ${LENGTH_LABELS[storyLength].zh}`)
                  : (language === 'en' ? 'Pick a place first' : '先选一个地方吧')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step: Generate ── */}
        {step === 'generate' && (
          <View style={styles.card}>
            <Racco state="thinking" size={100} />
            <Text style={styles.generatingText}>
              {GEN_HINTS[genHintIdx][language === 'en' ? 'en' : 'zh']}
            </Text>
            <Text style={styles.generatingSub}>
              {language === 'en'
                ? `Writing a story that only belongs to ${location}…`
                : `正在为「${location}」写一个只属于这里的故事…`}
            </Text>
            <ActivityIndicator size="small" color="#FF8A65" style={{ marginTop: 12 }} />
          </View>
        )}

        {/* ── Step: Play ── */}
        {step === 'play' && story && (
          <View style={styles.card}>
            <Text style={styles.storyTitle}>{story.title}</Text>
            {storyFallback && (
              <Text style={styles.fallbackTag}>
                {language === 'en'
                  ? 'Offline story · AI not reachable this time'
                  : '离线故事 · 这次没连上 AI，先讲一个本地的'}
              </Text>
            )}
            <View style={styles.storyBox}>
              <Text style={styles.storyContent}>{story.content}</Text>
            </View>
            <TouchableOpacity
              style={[styles.playBtn, isPlaying && styles.playingBtn]}
              onPress={handlePlay}
              disabled={isPlaying}
            >
              <Text style={styles.playBtnText}>
                {isPlaying
                  ? (language === 'en' ? 'Playing...' : '播放中...')
                  : (language === 'en' ? '▶ Play Story' : '▶ 播放故事')}
              </Text>
            </TouchableOpacity>
            <View style={{ marginTop: 16, alignItems: 'center' }}>
              <Racco state="talking" size={60} />
            </View>
          </View>
        )}

        {/* ── Step: Success ── */}
        {step === 'success' && (
          <View style={styles.card}>
            <Text style={styles.celebrateEmoji}>🎉</Text>
            <Text style={styles.successTitle}>
              {language === 'en' ? 'Check-in Complete!' : '打卡成功！'}
            </Text>
            <Text style={styles.successLocation}>📍 {location}</Text>

            {badge && (
              <View style={styles.badgeWrap}>
                <Text style={styles.badgeEmoji}>{badge.emoji}</Text>
                <Text style={styles.badgeLabel}>
                  {language === 'en' ? 'New Badge Unlocked!' : '获得新勋章！'}
                </Text>
                <Text style={styles.badgeName}>{badge.label}</Text>
              </View>
            )}

            {/* 累计打卡数 */}
            <View style={styles.rewardStats}>
              <Text style={styles.rewardCount}>
                {language === 'en' ? `You've checked in ${checkInTotal} place(s)!` : `已打卡 ${checkInTotal} 个地方 ✨`}
              </Text>
            </View>

            {/* 勋章墙：陈列所有已得徽章（含本地打卡里程碑与全局收听激励） */}
            {earnedBadges.length > 0 && (
              <View style={styles.badgeWall}>
                <Text style={styles.badgeWallTitle}>
                  {language === 'en' ? 'Your Badges' : '我的勋章墙'}
                </Text>
                <View style={styles.badgeRow}>
                  {earnedBadges.map((key) => {
                    const local = BADGE_RULES.find((r) => r.emoji === key);
                    const global = BADGES.find((b) => b.id === key);
                    const emoji = local ? local.emoji : global ? global.emoji : key;
                    const label = local
                      ? local.label[language]
                      : global
                      ? (language === 'en' ? global.nameEn : global.name)
                      : '';
                    return (
                      <View key={key} style={styles.badgeChip}>
                        <Text style={styles.badgeChipEmoji}>{emoji}</Text>
                        <Text style={styles.badgeChipName}>{label}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* 星星墙：已打卡地点金色星星 */}
            {visitedPlaces.length > 0 && (
              <View style={styles.starWall}>
                <Text style={styles.starWallTitle}>
                  {language === 'en' ? 'Places You Visited' : '去过的地方'}
                </Text>
                <View style={styles.starRow}>
                  {visitedPlaces.map((p, i) => (
                    <Text key={`${p}-${i}`} style={styles.starChip}>⭐ {localizedVisited(p)}</Text>
                  ))}
                </View>
              </View>
            )}

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                setStep('locate');
                setLocation('');
                setSelectedLoc(null);
                setStory(null);
                setBadge(null);
                setConfetti([]);
                confettiAnims.current = [];
              }}
            >
              <Text style={styles.primaryBtnText}>
                {language === 'en' ? 'Check-in Again' : '再来一次'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Text style={styles.backBtnText}>
                {language === 'en' ? '← Back' : '← 返回'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      </View>
    </CartoonScreen>
  );
}

// ─── Styles ────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 48, paddingBottom: 40 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#3D3229', textAlign: 'center', marginBottom: 28 },
  quota: { fontSize: 12, color: '#7A6A5D', textAlign: 'center', marginBottom: 12 },

  // 故事长度选择（#3）
  lengthWrap: { width: '100%', marginBottom: 16, alignItems: 'center' },
  lengthTitle: { fontSize: 14, color: '#7A6A5D', fontWeight: '600', marginBottom: 10 },
  lengthRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  lengthChip: {
    backgroundColor: '#FFF8F0', borderRadius: 22, paddingVertical: 10, paddingHorizontal: 16,
    borderWidth: 1, borderColor: '#F0D9B5', alignItems: 'center', minWidth: 84,
  },
  lengthChipActive: { backgroundColor: '#FFE0D6', borderColor: '#F7A072', borderWidth: 2 },
  lengthChipText: { fontSize: 15, fontWeight: '700', color: '#3D3229' },
  lengthChipTextActive: { color: '#F2827F' },
  lengthChipSub: { fontSize: 11, color: '#A8988A', marginTop: 2 },
  lengthChipSubActive: { color: '#F7A072' },

  // 搜索框
  searchBox: {
    flexDirection: 'row', alignItems: 'center', width: '100%',
    backgroundColor: '#FFF8F0', borderRadius: 26, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#F0D9B5', height: 42, marginBottom: 12,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#3D3229', height: '100%' },
  micBtn: {
    marginLeft: 6, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 22, backgroundColor: '#FFF0ED',
  },
  micBtnActive: { backgroundColor: '#F7A072' },
  micIcon: { fontSize: 18 },
  clearBtn: { fontSize: 14, color: '#A8988A', marginLeft: 4 },
  voiceHint: { alignItems: 'center', marginBottom: 8 },
  voiceHintText: { fontSize: 12, color: '#F7A072' },

  // 地点列表（地图图钉选不到时的可靠替代）
  listTitle: { fontSize: 14, color: '#7A6A5D', marginTop: 16, marginBottom: 8, fontWeight: '600' },
  locList: { maxHeight: 300, width: '100%' },
  locItem: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF8F0',
    borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#F0D9B5',
  },
  locItemActive: { backgroundColor: '#FFE0D6', borderColor: '#F7A072', borderWidth: 2 },
  locEmoji: { fontSize: 22, marginRight: 12 },
  locTextWrap: { flex: 1 },
  locName: { fontSize: 15, fontWeight: '600', color: '#3D3229' },
  locEn: { fontSize: 11, color: '#A8988A', marginTop: 2 },
  locCheck: { fontSize: 18, color: '#F2827F', fontWeight: 'bold', marginLeft: 8 },

  // Step indicator
  stepRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 32 },
  stepCircle: {
    width: 40, height: 40, borderRadius: 24, backgroundColor: '#E8DCCF',
    justifyContent: 'center', alignItems: 'center',
  },
  stepDone: { backgroundColor: '#81C784' },
  stepActive: { backgroundColor: '#F7A072', borderWidth: 2, borderColor: '#F2827F' },
  stepIcon: { fontSize: 18 },
  stepIconActive: { fontSize: 20 },
  stepDoneIcon: { fontSize: 18, color: '#FFF', fontWeight: 'bold' },
  stepLabel: { fontSize: 11, color: '#A8988A', textAlign: 'center', marginTop: 4 },
  stepLabelActive: { color: '#F2827F', fontWeight: 'bold' },
  stepLine: { width: 30, height: 2, backgroundColor: '#E0D5C7', marginHorizontal: 4 },

  // Card
  card: {
    backgroundColor: '#FFF', borderRadius: 26, padding: 24, alignItems: 'center',
    elevation: 2, boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
  },
  cardEmoji: { fontSize: 56, marginBottom: 16 },
  cardTitle: { fontSize: 20, fontWeight: 'bold', color: '#3D3229', textAlign: 'center', marginBottom: 8 },
  cardDesc: { fontSize: 14, color: '#7A6A5D', textAlign: 'center', marginBottom: 24 },

  // Generate
  generatingText: { fontSize: 16, color: '#7A6A5D', textAlign: 'center', marginTop: 16 },
  generatingSub: { fontSize: 13, color: '#A89887', textAlign: 'center', marginTop: 8, paddingHorizontal: 12 },

  // Story
  storyTitle: { fontSize: 22, fontWeight: 'bold', color: '#3D3229', marginBottom: 12, textAlign: 'center' },
  fallbackTag: { fontSize: 12, color: '#B08968', textAlign: 'center', marginTop: -6, marginBottom: 12 },
  storyBox: {
    backgroundColor: '#FFFDF7', borderRadius: 22, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: '#FFE0B2',
  },
  storyContent: { fontSize: 15, lineHeight: 26, color: '#3D3229' },

  // Buttons
  primaryBtn: {
    backgroundColor: '#EE8B5E', borderRadius: 30, paddingVertical: 14, paddingHorizontal: 40,
    elevation: 2, marginTop: 8,
  },
  primaryBtnText: { fontSize: 16, fontWeight: 'bold', color: '#3D3229' },
  primaryBtnDisabled: { backgroundColor: '#D8CFC5', elevation: 0 },
  playBtn: {
    backgroundColor: '#9B7EDE', borderRadius: 26, paddingVertical: 12, paddingHorizontal: 32,
    elevation: 2,
  },
  playingBtn: { backgroundColor: '#651FFF', opacity: 0.8 },
  playBtnText: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  backBtn: { marginTop: 12, paddingVertical: 8 },
  backBtnText: { fontSize: 14, color: '#7A6A5D' },
  // 常驻返回键：悬浮在内容之上，任何步骤都在同一个位置（孩子记得住）
  floatBackBtn: {
    position: 'absolute',
    top: 46,
    left: 16,
    zIndex: 20,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  floatBackText: { fontSize: 22, color: '#3D3229', fontWeight: '700' },

  // Success
  celebrateEmoji: { fontSize: 64, marginBottom: 12 },
  successTitle: { fontSize: 24, fontWeight: 'bold', color: '#3D3229', marginBottom: 8 },
  successLocation: { fontSize: 16, color: '#7A6A5D', marginBottom: 24 },
  badgeWrap: {
    backgroundColor: '#FFF8E1', borderRadius: 24, paddingVertical: 20, paddingHorizontal: 28,
    alignItems: 'center', borderWidth: 2, borderColor: '#FFD54F', marginBottom: 24,
  },
  badgeEmoji: { fontSize: 48, marginBottom: 8 },
  badgeLabel: { fontSize: 14, color: '#FF8F00', marginBottom: 4 },
  badgeName: { fontSize: 18, fontWeight: 'bold', color: '#3D3229' },

  // 奖励增强：累计 / 勋章墙 / 星星墙
  rewardStats: { alignItems: 'center', marginBottom: 16 },
  rewardCount: { fontSize: 16, fontWeight: '700', color: '#F7A072' },
  badgeWall: { alignItems: 'center', marginBottom: 20, width: '100%' },
  badgeWallTitle: { fontSize: 14, color: '#7A6A5D', marginBottom: 10 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  badgeChip: {
    backgroundColor: '#FFF8E1', borderRadius: 22, paddingVertical: 10, paddingHorizontal: 14,
    alignItems: 'center', borderWidth: 2, borderColor: '#FFD54F', minWidth: 72,
  },
  badgeChipEmoji: { fontSize: 32, marginBottom: 4 },
  badgeChipName: { fontSize: 11, color: '#3D3229', textAlign: 'center' },
  starWall: { alignItems: 'center', marginBottom: 20, width: '100%' },
  starWallTitle: { fontSize: 14, color: '#7A6A5D', marginBottom: 10 },
  starRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  starChip: {
    fontSize: 13, color: '#3D3229', backgroundColor: '#FFF3E0',
    borderRadius: 22, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: '#FFE0B2',
  },
});
