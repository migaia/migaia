import { createRoot } from 'react-dom/client';
import { StoreProvider, useStore } from '@migaia/store-react';
import { createStore } from '@migaia/store-light';

const store = createStore({ count: 0 });

function Counter() {
  const count = useStore(store, (value) => value.count);
  return (
    <button
      id="counter"
      onClick={() => {
        store.count += 1;
      }}
    >
      {count}
    </button>
  );
}

function Parity() {
  const parity = useStore(store, (value) => value.count % 2);
  return <output id="parity">{parity}</output>;
}

const root = createRoot(document.querySelector('#root')!);
root.render(
  <StoreProvider>
    <Counter />
    <Parity />
  </StoreProvider>
);

declare global {
  interface Window {
    batchStoreReactE2E(): void;
    disposeStoreReactE2E(): Promise<void>;
  }
}

window.batchStoreReactE2E = () => {
  store.$batch((draft) => {
    draft.count += 1;
    draft.count += 1;
  });
};
window.disposeStoreReactE2E = async () => {
  root.unmount();
  await store.$dispose();
};
