// schemes.js - 内置输入方案注册表（码表 / 拆分 / 字根 / 编码基准布局）
// 每个方案声明自己的数据源与编码基准布局：
//   codeBaseLayout: 码表编码所基于的键盘布局（'qwerty' 星陈 / 'gallman' 灵铭）
// 翻译规则：码表编码 → 基准布局键帽 → 当前布局键帽（codeBaseLayout === 当前布局时原样）

export const BUILTIN_SCHEMES = {
  'star-builtin': {
    key: 'star-builtin',
    name: '宇浩星陈（内置）',
    codeTable: { url: 'assets/code-tables/mabiao-star.txt', direction: 'code-left' },
    chaifen: { url: 'assets/data/chaifen.json', cacheKey: 'star-chaifen-v1' },
    zigen: { url: 'assets/data/zigen-star.json' },
    codeBaseLayout: 'qwerty', // 星陈编码基于 QWERTY 键位
    defaultTranslate: true,   // 默认翻译到当前布局
  },
  'ling-builtin': {
    key: 'ling-builtin',
    name: '灵铭（内置）',
    codeTable: { url: 'assets/code-tables/mabiao-ling.txt', direction: 'code-left', cacheKey: 'ling-builtin-v2' },
    chaifen: { url: 'assets/data/chaifen-ling.json', cacheKey: 'ling-chaifen-v2' },
    zigen: { url: 'assets/data/zigen-ling.json?v=3' },
    codeBaseLayout: 'gallman', // 灵铭编码原生基于 Gallman 键位
    defaultTranslate: false,  // 默认不翻译（编码即按键）
  },
};

/** 当前方案配置（由 main.js 注入，避免循环依赖） */
export let currentScheme = null;

export function setCurrentScheme(scheme) {
  currentScheme = scheme;
}

/** 方案是否已配置（含用户自定义码表，无拆分/字根） */
export function isCustomScheme(key) {
  return !BUILTIN_SCHEMES[key];
}
