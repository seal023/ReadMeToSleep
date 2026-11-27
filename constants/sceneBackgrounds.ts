/**
 * 6 板块场景背景图映射表（唯一 require 表）。
 * Metro 只重写字面量 require，因此这里必须逐个写死路径，不能用动态拼接。
 * 6 张均为「小浣熊画在场景里」的一体化图；页面用了对应场景图后不要再叠动态 Racco 组件。
 */
export const SCENE_BACKGROUNDS: Record<string, any> = {
  home: require('../assets/scenes/scene_home_with_racco.png'),
  create: require('../assets/scenes/scene_create_with_racco.png'),
  library: require('../assets/scenes/scene_library_with_racco.png'),
  stories: require('../assets/scenes/scene_stories_with_racco.png'),
  record: require('../assets/scenes/scene_record_with_racco.png'),
  settings: require('../assets/scenes/scene_settings_with_racco.png'),
};

/** 首页场景图（静态浣熊已画在图里，页面不要再叠动态 Racco 组件） */
export const HOME_SCENE = SCENE_BACKGROUNDS.home;
