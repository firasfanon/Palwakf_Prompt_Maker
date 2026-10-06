'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Ports/Adapters for persistence and export.
 *
 * Port interfaces (documentation, not enforced by the language):
 *
 * ProjectRepository:
 *   save(projectId, data) -> Promise<void>
 *   load(projectId) -> Promise<data|null>
 *   list() -> Promise<string[]>   // project ids
 *   remove(projectId) -> Promise<void>
 *
 * ExportAdapter:
 *   exportFile(filename, content) -> Promise<{path: string}>
 *
 * The core engine (index.js / blueprintCompiler.js / etc.) never imports a
 * concrete adapter directly — only this module's factory functions are
 * wired in by the caller (CLI or test). This keeps the compiler itself
 * storage-agnostic.
 */

function createMemoryProjectRepository() {
  const store = new Map();
  return {
    async save(projectId, data) { store.set(projectId, JSON.parse(JSON.stringify(data))); },
    async load(projectId) { return store.has(projectId) ? JSON.parse(JSON.stringify(store.get(projectId))) : null; },
    async list() { return Array.from(store.keys()); },
    async remove(projectId) { store.delete(projectId); }
  };
}

function createMemoryExportAdapter() {
  const files = new Map();
  return {
    async exportFile(filename, content) { files.set(filename, content); return { path: `memory://${filename}` }; },
    _files: files
  };
}

/**
 * createFileProjectRepository — a REAL filesystem-backed implementation of
 * the ProjectRepository port. This is the environment-appropriate adapter
 * here (Claude Code has a real filesystem, unlike the claude.ai artifact
 * runtime this project was previously built for, which only offered a
 * claude.use('db') capability). Same port interface, different
 * implementation — exactly what the ports/adapters separation is for.
 */
function createFileProjectRepository(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  const fileFor = (id) => {
    // An id is a file NAME, never a path: refuse anything that could escape baseDir.
    if (typeof id !== 'string' || id === '' || /[\\/\0]/.test(id) || id === '.' || id === '..' || id.indexOf('..') !== -1) {
      throw new Error('invalid project id: ' + JSON.stringify(id));
    }
    return path.join(baseDir, `${id}.json`);
  };
  return {
    async save(projectId, data) {
      fs.writeFileSync(fileFor(projectId), JSON.stringify(data, null, 2));
    },
    async load(projectId) {
      const f = fileFor(projectId);
      if (!fs.existsSync(f)) return null;
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    },
    async list() {
      if (!fs.existsSync(baseDir)) return [];
      return fs.readdirSync(baseDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    },
    async remove(projectId) {
      const f = fileFor(projectId);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  };
}

function createFileExportAdapter(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  return {
    async exportFile(filename, content) {
      const p = path.join(baseDir, filename);
      fs.writeFileSync(p, content);
      return { path: p };
    }
  };
}

module.exports = {
  createMemoryProjectRepository,
  createMemoryExportAdapter,
  createFileProjectRepository,
  createFileExportAdapter
};
