/**
 * Scene background map for the six tabs (the single require table).
 * Metro only rewrites literal require(), so paths must be written out - no dynamic concat.
 * All six images are integrated scenes with the raccoon baked in; pages using a
 * scene image must not stack an animated Racco component on top.
 */
export const SCENE_BACKGROUNDS: Record<string, any> = {
  home: require('../assets/scenes/scene_home_with_racco.png'),
  create: require('../assets/scenes/scene_create_with_racco.png'),
  library: require('../assets/scenes/scene_library_with_racco.png'),
  stories: require('../assets/scenes/scene_stories_with_racco.png'),
  record: require('../assets/scenes/scene_record_with_racco.png'),
  settings: require('../assets/scenes/scene_settings_with_racco.png'),
};

/** Home scene image (static raccoon baked in; do not stack an animated Racco) */
export const HOME_SCENE = SCENE_BACKGROUNDS.home;
