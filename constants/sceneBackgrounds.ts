/**
 * 6 板块场景背景图映射表（唯一 require 表）。
 * Metro 只重写字面量 require，因此这里必须逐个写死路径，不能用动态拼接。
 * 目前只有首页完成「小浣熊坐在场景里」的一体化图；其余页面后续补齐后在此登记。
 */
export const SCENE_BACKGROUNDS: Record<string, any> = {
  home: require('../assets/scenes/scene_home_with_racco.png'),
};

/** 首页场景图（静态浣熊已画在图里，页面不要再叠动态 Racco 组件） */
export const HOME_SCENE = SCENE_BACKGROUNDS.home;
