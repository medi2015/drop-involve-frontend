// Backend, served from the Vultr VPS behind nginx.
//
// Previously Render's free tier, which slept after 15 minutes and took 30-60s
// to wake — that cold start was the long wait before a verification code
// arrived. Render still runs the same code as a fallback for desktop builds
// older than 0.1.19, which have the old URL compiled in.
export const API_BASE =
  import.meta.env.VITE_API_URL || 'https://file.involve.no';

// Not a secret: this ships in the bundle and is meaningless without the
// authorised origins configured alongside it in Google Cloud Console.
export const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  '775361670070-lhbie6ojinp3phi3a1tcjmsg1lusnkej.apps.googleusercontent.com';

// Separate OAuth client for the desktop apps. Google Identity Services needs
// an https or http://localhost origin and a Tauri window is neither, so desktop
// uses the loopback flow with this client instead.
export const GOOGLE_DESKTOP_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID ||
  '775361670070-pdhk6rnnf8k5pcqeqtpo8cicu5p280di.apps.googleusercontent.com';

export const isDesktop = () =>
  typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
