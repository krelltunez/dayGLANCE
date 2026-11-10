// Node 25 has Web Storage built in: `localStorage` and `sessionStorage` are
// getters on globalThis (Node 22, which CI runs, has neither). The host tests
// prove the package runs in plain Node with no browser storage, so they hide
// Node's own before the package loads: imported FIRST, since ES modules run
// in import order. Whatever Node runs them, the package is tested without it.
for (const name of ['localStorage', 'sessionStorage']) {
  if (Object.getOwnPropertyDescriptor(globalThis, name)?.configurable) {
    Object.defineProperty(globalThis, name, { value: undefined, configurable: true, writable: true });
  }
}
