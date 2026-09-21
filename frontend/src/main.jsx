import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

/* Typefaces are self-hosted rather than pulled from Google Fonts: one less
   third-party request on the critical path, no render-blocking round trip to
   another origin, and the site keeps its typography if that CDN is unreachable.
   Vite fingerprints the woff2 files and they deploy to S3 with everything else. */
import '@fontsource-variable/fraunces';
import '@fontsource/karla/400.css';
import '@fontsource/karla/500.css';
import '@fontsource/karla/600.css';
import '@fontsource/karla/700.css';

import App from './App.jsx';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
