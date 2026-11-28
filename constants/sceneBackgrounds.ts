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

/**
 * Ground clearance below the raccoon is baked into the image itself (see
 * pad_ground.py): the scene was shifted up inside the bitmap and empty ground
 * added beneath the feet. An extra transform here would lift the image bottom
 * off the screen edge and expose the container background as a seam above the
 * tab bar, so this stays at 0.
 */
export const SCENE_SHIFT_Y = 0;

/** Home scene image (static raccoon baked in; do not stack an animated Racco) */
export const HOME_SCENE = SCENE_BACKGROUNDS.home;
