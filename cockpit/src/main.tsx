import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/schibsted-grotesk/400.css';
import '@fontsource/schibsted-grotesk/500.css';
import '@fontsource/schibsted-grotesk/600.css';
import '@fontsource/schibsted-grotesk/700.css';
import '@fontsource/fragment-mono/400.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/documents.css';
import './styles/gate.css';
import './styles/logs.css';
import './styles/plan.css';
import './styles/concepts.css';
import './styles/repo.css';
import './styles/views.css';
import { prefersDark } from './hooks/usePrefs.ts';
import { initialTheme, safeStorage } from './lib/prefs.ts';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('The cockpit page is missing its #root element');
document.documentElement.dataset['theme'] = initialTheme(safeStorage(), prefersDark());
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
