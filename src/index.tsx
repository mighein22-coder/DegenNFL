import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
// Self-hosted, so the app renders offline and inside a native shell. Only the
// weights the UI asks for: Inter 400/500/700 (font-normal/medium/bold) and
// Teko 500/700. Teko 400 is deliberately NOT imported: nothing set a 400 face
// before either, and the browser resolved a 400 request to the nearest face
// served (500), so adding one would change every heading.
// Imported BEFORE index.css, whose last import (print.css) must stay last.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/700.css';
import '@fontsource/teko/500.css';
import '@fontsource/teko/700.css';
import './styles/index.css';
import { watchSystemTheme } from './lib/theme';

// index.html has already applied the saved theme; this keeps "System" live.
watchSystemTheme();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find #root to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
