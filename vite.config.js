import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative assets work both at localhost and under GitHub Pages /Bill-Tracker/.
  base: './'
});
