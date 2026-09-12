import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * The service worker is what makes the web app installable and usable offline.
 *
 * It is deliberately skipped inside the Android build: there the files are
 * already on the device, so the worker adds nothing — and its precache would
 * keep serving the previous version's UI after an app update until someone
 * cleared the app's data.
 */
const isNative = Boolean(
  (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform?.(),
);

if (!isNative && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
