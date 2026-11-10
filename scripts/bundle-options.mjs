/** esbuild settings shared by the plugin build and the benchmark page. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Rewrite one module-relative asset URL so it resolves without a sibling file.
 * @param {string} path - absolute module path.
 * @param {string} expression - exact URL expression in the module.
 * @param {string} replacement - inlined URL expression.
 * @param {'js' | 'ts'} [loader] - module language.
 * @returns {{ contents: string, loader: 'js' | 'ts' }} the rewritten module.
 */
function rewriteAsset(path, expression, replacement, loader = 'js') {
  const source = readFileSync(path, 'utf8');
  if (!source.includes(expression)) throw new Error(`Asset reference changed in ${path}: ${expression}`);
  return { contents: source.replace(expression, () => replacement), loader };
}

/**
 * Turns the diagram engine bundle into the URL expression the text-diagram module fetches it from.
 * @callback EngineReference
 * @param {string} file - absolute path of the engine bundle.
 * @returns {string} URL expression.
 */

/** @type {EngineReference} Single-file bundles carry the engine inside, as a blob URL. */
const inlineEngine = file => `new URL(URL.createObjectURL(new Blob([${JSON.stringify(readFileSync(file, 'utf8'))}], { type: "text/javascript" })))`;

/**
 * Sibling assets referenced through import.meta.url, which esbuild does not copy.
 * @param {EngineReference} engineReference - where the diagram engine comes from.
 * @returns {import('esbuild').Plugin} the plugin.
 */
const moduleAssets = engineReference => ({
  name: 'module-assets',
  /** @param {import('esbuild').PluginBuild} context - esbuild plugin context. */
  setup(context) {
    context.onLoad({ filter: /text-diagram\/dist\/browser\.mjs$/ }, args => rewriteAsset(
      args.path,
      'new URL("./diagram-frame.iife.js", import.meta.url)',
      engineReference(join(dirname(args.path), 'diagram-frame.iife.js')),
    ));
    context.onLoad({ filter: /text-diagram\/src\/browser\/isolated\.ts$/ }, args => rewriteAsset(
      args.path,
      'new URL("../../dist/diagram-frame.iife.js", import.meta.url)',
      engineReference(join(dirname(args.path), '..', '..', 'dist', 'diagram-frame.iife.js')),
      'ts',
    ));
    context.onLoad({ filter: /pdfkit\/js\/pdfkit\.browser\.mjs$/ }, (args) => {
      const profile = readFileSync(join(dirname(args.path), 'data', 'sRGB_IEC61966_2_1.icc')).toString('base64');
      return rewriteAsset(
        args.path,
        "new URL('./data/sRGB_IEC61966_2_1.icc', import.meta.url).href",
        JSON.stringify(`data:application/vnd.iccprofile;base64,${profile}`),
      );
    });
  },
});

/** A QuireKit checkout to build against, to try unreleased editor changes before publishing. */
const LOCAL_QUIREKIT = process.env.QUIREKIT_LOCAL;

/** Enters QuireKit through the checkout's docs app, whose workspace links reach every package, with one Vue. */
const localQuireKit = {
  name: 'local-quirekit',
  /** @param {import('esbuild').PluginBuild} context - esbuild plugin context. */
  setup(context) {
    if (LOCAL_QUIREKIT === undefined) return;
    const resolveDir = join(LOCAL_QUIREKIT, 'apps', 'msfe-docs');
    context.onResolve({ filter: /^(?:vue$|@quirekit\/(?:md-editor|md-editor-comments|msfe-comments|ui|unocss-preset)(?:\/|$))/ }, (args) => {
      if (args.pluginData?.local === true) return undefined;
      return context.resolve(args.path, { kind: args.kind, resolveDir, pluginData: { local: true } });
    });
  },
};

// Workspace packages can export Vue sources that the published packages ship compiled.
const localPlugins = LOCAL_QUIREKIT === undefined ? [] : [localQuireKit, (await import('unplugin-vue/esbuild')).default({ isProduction: true, sourceMap: false })];

const PLATFORM_MODULES = /^(react|react\/jsx-runtime|react-dom|react-dom\/client)$/;

/** Platform modules exist only behind the factory's require, so dynamic imports must reach it too. */
const dynamicPlatformImports = {
  name: 'dynamic-platform-imports',
  /** @param {import('esbuild').PluginBuild} context - esbuild plugin context. */
  setup(context) {
    context.onResolve({ filter: PLATFORM_MODULES }, args => (
      args.kind === 'dynamic-import' ? { path: args.path, namespace: 'platform-module' } : undefined
    ));
    context.onLoad({ filter: /.*/, namespace: 'platform-module' }, args => ({
      contents: `module.exports = require(${JSON.stringify(args.path)});`,
      loader: 'js',
    }));
  },
};

/** Settings for bundling the editor; each build adds its own entry and output. */
export const bundleOptions = {
  plugins: [...localPlugins, dynamicPlatformImports, moduleAssets(inlineEngine)],
  absWorkingDir: root,
  bundle: true,
  platform: 'browser',
  target: ['chrome122'],
  jsx: 'automatic',
  conditions: ['production'],
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'],
  loader: { '.woff2': 'dataurl', '.woff': 'empty', '.ttf': 'empty', '.png': 'dataurl', '.svg': 'dataurl' },
  define: {
    'process.env.NODE_ENV': '"production"',
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
};

/**
 * Settings for an ES module build split into chunks that load on demand, all written to one directory.
 * @param {string} directory - output directory, which also receives the diagram engine as its own file.
 * @returns {import('esbuild').BuildOptions} build settings without an entry.
 */
export function splitBundleOptions(directory) {
  /** @type {EngineReference} The engine is fetched from beside the chunks only when a diagram renders. */
  const emitEngine = (file) => {
    const bytes = readFileSync(file);
    const name = `diagram-engine-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.js`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name), bytes);
    return `new URL(${JSON.stringify(`./${name}`)}, import.meta.url)`;
  };
  return {
    ...bundleOptions,
    plugins: [...localPlugins, dynamicPlatformImports, moduleAssets(emitEngine)],
    outdir: directory,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunk-[hash]',
  };
}

/** Whether this build uses a QuireKit checkout instead of the published packages. */
export const usesLocalQuireKit = LOCAL_QUIREKIT !== undefined;
