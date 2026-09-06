// Standalone entry point — only used by `npm run dev` / `npm run build` here.
// The Semma app imports ./UnoGame directly instead.
import React from 'react';
import { createRoot } from 'react-dom/client';
import UnoGame from './UnoGame';
import './uno.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UnoGame />
  </React.StrictMode>,
);
