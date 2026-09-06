import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Only used when running this game on its own. Inside the Semma app the game
// is imported as a component and built by the app's own Vite config.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
