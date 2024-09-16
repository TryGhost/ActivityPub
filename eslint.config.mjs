// @ts-check

// See https://typescript-eslint.io/getting-started/

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// @TODO: Enable recommendedTypeChecked once all @typescript-eslint/no-explicit-any errors are fixed
export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.stylistic,
    //...tseslint.configs.recommendedTypeChecked,
    {
        // languageOptions: {
        //     parserOptions: {
        //         projectService: true,
        //         tsconfigRootDir: import.meta.dirname,
        //     },
        // },
        rules: {
            '@typescript-eslint/no-explicit-any': ['warn'],
        },
    },
);
