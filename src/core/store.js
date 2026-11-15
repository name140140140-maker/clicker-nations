/* React-обгортка над storeCore: підписники отримують лише ті зміни, які зачіпають їхній селектор.
   Використовується для «живого» стану клікера, щоб кожен клік не перемальовував кореневий App. */
import { useSyncExternalStore } from "react";
export { createStore } from "./storeCore.js";

/** Селектор має повертати примітив або стабільне посилання (не новий об'єкт на кожен виклик). */
export function useStore(store, selector) {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}
