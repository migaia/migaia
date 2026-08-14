import { createRoot } from 'react-dom/client';
import { StoreProvider, useStore } from '@migaia/store-react';
import { createStore } from '@migaia/store-light';

const store = createStore({ count: 0 });

function Counter() {
  const count = useStore(store, (value) => value.count);
  return <button id="counter" onClick={() => { store.count += 1; }}>{count}</button>;
}

createRoot(document.querySelector('#root')!).render(
  <StoreProvider><Counter /></StoreProvider>
);

declare global {
  interface Window { disposeStoreReactE2E(): void }
}

window.disposeStoreReactE2E = () => store.$dispose();
