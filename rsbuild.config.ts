import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSass } from '@rsbuild/plugin-sass';
import { pluginBasicSsl } from '@rsbuild/plugin-basic-ssl';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// So any device can report which build it's running without opening
// DevTools: readable at https://<host>/build-info.json. Written into
// public/ (gitignored, see .gitignore) so rsbuild's existing `output.copy`
// rule for the whole public/ directory (below) picks it up for free - no
// separate copy rule needed. Runs on every `dev`/`build` invocation, so it's
// always current for whatever's actually being served.
const writeBuildInfo = () => {
    let commit = 'unknown';
    try {
        commit = execSync('git rev-parse HEAD').toString().trim();
    } catch {
        // Not a git checkout (e.g. a source archive with no .git) - leave 'unknown'.
    }
    const buildInfo = {
        commit,
        built_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(__dirname, 'public', 'build-info.json'), JSON.stringify(buildInfo, null, 2));
    return buildInfo;
};

const buildInfo = writeBuildInfo();

export default defineConfig({
    plugins: [
        pluginSass({
            sassLoaderOptions: {
                sourceMap: true,
                sassOptions: {
                    // includePaths: [path.resolve(__dirname, 'src')],
                },
                // additionalData: `@use "${path.resolve(__dirname, 'src/components/shared/styles')}" as *;`,
            },
            exclude: /node_modules/,
        }),
        pluginReact(),
        pluginBasicSsl(),
    ],
    source: {
        entry: {
            index: './src/main.tsx',
        },
        define: {
            'process.env': {
                APP_ENV: JSON.stringify(process.env.APP_ENV),
                BUILD_COMMIT: JSON.stringify(buildInfo.commit),
                BUILD_TIME: JSON.stringify(buildInfo.built_at),
                CLIENT_ID: JSON.stringify(process.env.CLIENT_ID),
                // Local-dev-only opt-in (.env, gitignored) - see
                // useProductionHostsLocally, src/components/shared/utils/config/config.ts
                FORCE_PRODUCTION_HOSTS: JSON.stringify(process.env.FORCE_PRODUCTION_HOSTS),
                APP_ID: JSON.stringify(process.env.APP_ID),
                GD_CLIENT_ID: JSON.stringify(process.env.GD_CLIENT_ID),
                GD_APP_ID: JSON.stringify(process.env.GD_APP_ID),
                GD_API_KEY: JSON.stringify(process.env.GD_API_KEY),
            },
        },
        alias: {
            react: path.resolve('./node_modules/react'),
            'react-dom': path.resolve('./node_modules/react-dom'),
            '@/external': path.resolve(__dirname, './src/external'),
            '@/components': path.resolve(__dirname, './src/components'),
            '@/hooks': path.resolve(__dirname, './src/hooks'),
            '@/utils': path.resolve(__dirname, './src/utils'),
            '@/constants': path.resolve(__dirname, './src/constants'),
            '@/stores': path.resolve(__dirname, './src/stores'),
        },
    },
    output: {
        copy: [
            {
                from: 'node_modules/@deriv-com/smartcharts-champion/dist/*',
                to: 'js/smartcharts/[name][ext]',
                globOptions: {
                    ignore: ['**/*.LICENSE.txt'],
                },
            },
            { from: 'node_modules/@deriv-com/smartcharts-champion/dist/assets/*', to: 'assets/[name][ext]' },
            {
                from: 'node_modules/@deriv-com/smartcharts-champion/dist/assets/fonts/*',
                to: 'assets/fonts/[name][ext]',
            },
            {
                from: 'node_modules/@deriv-com/smartcharts-champion/dist/assets/shaders/*',
                to: 'assets/shaders/[name][ext]',
            },
            // The two rules above (assets/fonts, assets/shaders) only ever
            // covered those two top-level subfolders - assets/packages/**
            // (deriv_chart's own icon font + ~101 market-symbol PNGs, nested
            // under packages/deriv_chart/assets/...) was never addressed by
            // any rule, upstream or ours (confirmed identical in
            // upstream/master - this predates our fork). The broad
            // assets/* rule above doesn't recurse into subdirectories
            // either, so this whole subtree was silently missing from
            // dist/ - the browser's requests for it were falling through
            // to Cloudflare's SPA fallback (index.html) instead of 404ing
            // cleanly. [path] preserves the matched glob's own relative
            // directory structure instead of flattening every file into one
            // folder (which is what the rules above do). context is
            // rspack's own required pairing for that ("should be explicitly
            // set only when from contains a glob" - RawCopyPattern docs) -
            // but it's PREPENDED to `from`, not merely used for output-path
            // trimming (confirmed by a failed build: setting both to the
            // same full path duplicated it, "unable to locate
            // .../packages\node_modules/.../packages/**/*"). So context
            // carries the full directory, and from is just the glob
            // relative to it.
            {
                from: '**/*',
                to: 'assets/packages/[path][name][ext]',
                context: 'node_modules/@deriv-com/smartcharts-champion/dist/assets/packages',
            },
            { from: path.join(__dirname, 'public') },
        ],
    },
    html: {
        template: './index.html',
    },
    server: {
        port: 8443,
        compress: true,
    },
    dev: {
        hmr: true,
    },
    performance: {
        // Configure Rsbuild's native bundle analyzer
        bundleAnalyze:
            process.env.BUNDLE_ANALYZE === 'true'
                ? {
                      analyzerMode: 'server',
                      analyzerHost: 'localhost',
                      analyzerPort: 8888,
                      openAnalyzer: true,
                      generateStatsFile: true,
                      statsFilename: 'stats.json',
                  }
                : undefined,
    },
    tools: {
        rspack: {
            plugins: [],
            resolve: {},
            module: {
                rules: [
                    {
                        test: /\.xml$/,
                        exclude: /node_modules/,
                        use: 'raw-loader',
                    },
                ],
            },
        },
    },
});
