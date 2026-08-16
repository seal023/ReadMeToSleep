const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = ['js', 'jsx', 'ts', 'tsx', 'json', 'cjs', 'mjs'];

config.resolver.assetExts = config.resolver.assetExts.filter(ext => ext !== 'svg');

config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer'),
  minifierConfig: {
    keep_classnames: true,
    keep_fnames: true,
  },
};

const path = require('path');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('.css') || moduleName.endsWith('.module.css')) {
    const mockFile = path.join(__dirname, 'mock-css.js');
    return {
      type: 'sourceFile',
      filePath: mockFile,
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;