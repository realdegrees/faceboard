// Static, client-rendered app — no SSR, fully prerendered so it works under
// electron-serve and when served to a phone over the LAN.
export const prerender = true;
export const ssr = false;
