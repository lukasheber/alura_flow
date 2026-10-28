// Shared options for `npm run lint`, `npm run build` and `npm start`.
export default {
    ignoreFiles: [
        'package.json',
        'package-lock.json',
        'web-ext-config.mjs',
        'tests',
        'tests/**',
        'web-ext-artifacts',
        'web-ext-artifacts/**'
    ]
};
