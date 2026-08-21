// recorder client bundle 配置（JS 版：Node 22.16 无法原生加载 .ts 配置，需 .mjs）
// 运行：node <tsdown cli> --config-loader native --config typecheck-tmp/tsdown.config.mjs （cwd 不限）
const PLUGIN_ID = 'dsh-ai-recorder'
const ROOT = 'D:/AI/默认工作流/dsh-plugins/dsh-AIrecorder/dsh-v0.1.1-rc.1/plugin'

const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-runtime/client',
]

export default [{
  entry: { client: ROOT + '/src/client/index.tsx' },
  outDir: ROOT + '/lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (id) => !CLIENT_EXTERNALS.includes(id),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PLUGIN_ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}]
