// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	output: 'server',
	security: {
		checkOrigin: false
	},
	devToolbar: {
		enabled: false
	},
	adapter: vercel()
});
