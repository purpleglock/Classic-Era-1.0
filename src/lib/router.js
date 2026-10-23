/** Маршруты через адресную строку: #/, #/cabinet, #/admin. */
const routes = new Map();
let current = null;
let onChange = () => {};

export function route(path, render) { routes.set(path, render); }
export function setRouteListener(fn) { onChange = fn; }
export function currentPath() { return (location.hash.replace(/^#/, '') || '/').split('?')[0]; }
export function go(path) {
  if (currentPath() === path) render();
  else location.hash = path;
}

export async function render() {
  const path = currentPath();
  const view = routes.get(path) || routes.get('/');
  current = path;
  onChange(path);
  await view();
  window.scrollTo(0, 0);
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  return render();
}
export const routeNow = () => current;
