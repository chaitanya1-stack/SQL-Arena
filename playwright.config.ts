import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',timeout:180000,fullyParallel:false,use:{baseURL:process.env.E2E_BASE_URL||'http://localhost:3000',trace:'retain-on-failure'},projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}]});
