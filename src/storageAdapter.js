'use strict';

/**
 * storageAdapter.js — ProjectRepository over ANY Web-Storage-like object
 * (getItem / setItem / removeItem / key(i) / length): the browser's localStorage,
 * sessionStorage, or a plain test double in Node. It is the smallest real
 * persistence adapter for the browser: no backend, no network, no dependency.
 *
 * It implements the same port as the memory and filesystem repositories
 * (save / load / list / remove, all Promise-returning), so the core stays
 * storage-agnostic: swapping this for IndexedDB or a file adapter changes
 * nothing outside the adapter.
 */
function createStorageProjectRepository(storage, namespace) {
  const prefix = namespace || 'prompt-maker:project:';
  const keyOf = (id) => prefix + id;
  return {
    save(id, data) {
      return new Promise((resolve, reject) => {
        try { storage.setItem(keyOf(id), JSON.stringify(data)); resolve(); } catch (e) { reject(e); }
      });
    },
    load(id) {
      return new Promise((resolve, reject) => {
        let raw;
        try { raw = storage.getItem(keyOf(id)); } catch (e) { reject(e); return; }
        if (raw === null || raw === undefined) { resolve(null); return; }
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('corrupted saved project "' + id + '"')); }
      });
    },
    list() {
      return new Promise((resolve, reject) => {
        try {
          const ids = [];
          for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (k && k.indexOf(prefix) === 0) ids.push(k.slice(prefix.length));
          }
          resolve(ids.sort());
        } catch (e) { reject(e); }
      });
    },
    remove(id) {
      return new Promise((resolve, reject) => {
        try { storage.removeItem(keyOf(id)); resolve(); } catch (e) { reject(e); }
      });
    },
  };
}

module.exports = { createStorageProjectRepository };
