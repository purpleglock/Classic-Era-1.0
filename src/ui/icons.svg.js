// Спрайт иконок и заглушек гербов. Вставляется в начало <body> один раз.
export const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0c6" stop-opacity=".95"/><stop offset=".7" stop-color="#e9b949" stop-opacity=".85"/><stop offset="1" stop-color="#e9b949" stop-opacity=".1"/></linearGradient></defs>
  <symbol id="tyan" viewBox="0 0 200 260"><g fill="url(#hg)">
    <path d="M100 22c-38 0-62 28-62 66 0 22 6 40 4 58-2 14-12 26-16 36 18-4 30-14 36-26 6 10 20 16 38 16s32-6 38-16c6 12 18 22 36 26-4-10-14-22-16-36-2-18 4-36 4-58 0-38-24-66-62-66z" opacity=".45"/>
    <ellipse cx="100" cy="96" rx="38" ry="44" opacity=".75"/>
    <path d="M58 86c4-30 22-48 42-48s38 18 42 48c-12-14-26-20-42-20s-30 6-42 20z" opacity=".95"/>
    <rect x="88" y="136" width="24" height="34" opacity=".6"/>
    <path d="M24 260c2-56 34-90 76-90s74 34 76 90z" opacity=".7"/></g></symbol>
  <symbol id="e1" viewBox="0 0 100 100"><path d="M50 8l34 12v28c0 22-15 36-34 44C31 84 16 70 16 48V20z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M30 44l20 14 20-14M50 26v32" fill="none" stroke="currentColor" stroke-width="3"/></symbol>
  <symbol id="e2" viewBox="0 0 100 100"><circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="3"/><path d="M50 26l6 17h18l-14 11 5 18-15-11-15 11 5-18-14-11h18z" fill="currentColor"/></symbol>
  <symbol id="e3" viewBox="0 0 100 100"><path d="M22 22l56 56M78 22L22 78" stroke="currentColor" stroke-width="5"/><circle cx="50" cy="50" r="12" fill="#070706" stroke="currentColor" stroke-width="3"/></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></symbol>
  <symbol id="i-map" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-20 12 12)"/></symbol>
  <symbol id="i-lore" viewBox="0 0 24 24"><path d="M4 5h6a2 2 0 012 2v12a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v12a2 2 0 012-2h6z"/></symbol>
  <symbol id="i-news" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 16h5"/></symbol>
  <symbol id="i-rules" viewBox="0 0 24 24"><path d="M12 3v18M5 7h14M5 7l-2 6h4zM19 7l-2 6h4zM8 21h8"/></symbol>
  <symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.7-2.5 2-2.5 4M12 17h.01"/></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0"/></symbol>
  <symbol id="i-down" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></symbol>
  <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
  <symbol id="i-scroll" viewBox="0 0 24 24"><path d="M7 4h11v13a3 3 0 01-3 3H6a2 2 0 01-2-2v-2h11v2a2 2 0 002 2M7 4a2 2 0 00-2 2v10M10 8h5M10 12h5"/></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path d="M5 5h14a1 1 0 011 1v10a1 1 0 01-1 1h-7l-4 3v-3H5a1 1 0 01-1-1V6a1 1 0 011-1zM9 11h.01M15 11h.01"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 4.5a3.5 3.5 0 010 7M21 20c0-3-1.6-5.3-4-5.8"/></symbol>
  <symbol id="i-guide" viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11M9 8h6"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/></symbol>
  <symbol id="i-stat" viewBox="0 0 24 24"><path d="M5 20V10M10 20V4M15 20v-7M20 20V8"/></symbol>
  <symbol id="i-crown" viewBox="0 0 24 24"><path d="M4 17l-1-10 5 4 4-6 4 6 5-4-1 10zM4 20h16"/></symbol>
  <symbol id="i-flag" viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></symbol>
  <symbol id="i-planet" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M3 15c3 2 15-3 18-8"/></symbol>
  <symbol id="i-grid" viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></symbol>
  <symbol id="i-pick" viewBox="0 0 24 24"><path d="M14 4c3 0 6 2 7 5-3-1-6-1-9 1M14 4c-3 0-6 2-7 5 3-1 6-1 9 1M12 9L4 20"/></symbol>
  <symbol id="i-cart" viewBox="0 0 24 24"><path d="M3 6h3l2 10h10l2-7H7M9 20h.01M17 20h.01"/></symbol>
  <symbol id="i-ship" viewBox="0 0 24 24"><path d="M12 3l4 9-4 9-4-9zM4 14l4-2M20 14l-4-2"/></symbol>
  <symbol id="i-wrench" viewBox="0 0 24 24"><path d="M15 4a4 4 0 00-5 5L4 15l3 3 6-6a4 4 0 005-5l-2 2-2-1-1-2z"/></symbol>
  <symbol id="i-sword" viewBox="0 0 24 24"><path d="M14 4h6v6L9 21l-6-6zM6 14l4 4M4 20l2-2"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></symbol>
  <symbol id="i-arena" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="5"/><path d="M3 12v4c0 3 4 5 9 5s9-2 9-5v-4M9 12l6 0"/></symbol>
  <symbol id="i-glass" viewBox="0 0 24 24"><path d="M6 3h12l-1 6a5 5 0 01-10 0zM12 14v7M8 21h8"/></symbol>
  <symbol id="i-coin" viewBox="0 0 24 24"><ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3 3 7 3s7-1.3 7-3v-5"/></symbol>
  <symbol id="i-fuel" viewBox="0 0 24 24"><path d="M4 21V6a2 2 0 012-2h6a2 2 0 012 2v15M3 21h12M4 10h10M14 8l3 2v7a1.5 1.5 0 003 0V9l-3-3"/><path d="M9 13.5c-1 1.2-1.5 2-1.5 2.6a1.5 1.5 0 003 0c0-.6-.5-1.4-1.5-2.6z"/></symbol>
  <symbol id="i-flask" viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3M7 15h10"/></symbol>
  <symbol id="i-trend" viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></symbol>
  <symbol id="i-back" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></symbol>
  <symbol id="i-logout" viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M10 16l-4-4 4-4M6 12h10"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
  <symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/></symbol>
  <symbol id="i-cube" viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3l1.8 5.6L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.4zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></symbol>
  <symbol id="i-list" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></symbol>
</svg>`;
