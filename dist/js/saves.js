const DB_NAME = 'ra:save-slots';
const STORE_NAME = 'states';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try {
        result = action(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export function saveKey(gameId, slotId) {
  return `${gameId}:${slotId}`;
}

export async function readSaveBytes(gameId, slotId) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(saveKey(gameId, slotId));
      request.onsuccess = () => resolve(request.result ? new Uint8Array(request.result) : null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export function writeSaveBytes(gameId, slotId, contents) {
  return withStore('readwrite', store => {
    store.put(contents, saveKey(gameId, slotId));
  });
}

export function deleteSaveBytes(gameId, slotId) {
  return withStore('readwrite', store => {
    store.delete(saveKey(gameId, slotId));
  });
}
