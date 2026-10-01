// The server the desktop smoke test points the app at (E2E_DESKTOP_PORT,
// default 3190, away from the web suite's 3100).
export const desktopPort = Number(process.env.E2E_DESKTOP_PORT ?? 3190);
export const desktopBaseUrl = `http://localhost:${desktopPort}`;
