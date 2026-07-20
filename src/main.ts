import { initApp } from "./views";

void initApp();

// Navigating to a URL that differs only by its fragment (e.g. this same
// origin's own "Make your own Card" link, which points at the bare path
// with no hash) is a same-document navigation per spec — the browser
// updates location.hash and fires "hashchange" without reloading the page,
// so initApp()'s one-time run above never sees the new fragment. Re-running
// it here is what actually shows the recipient view (or falls back to the
// stack once the hash is gone) in that case, instead of leaving whatever
// was on screen before the navigation.
window.addEventListener("hashchange", () => void initApp());
