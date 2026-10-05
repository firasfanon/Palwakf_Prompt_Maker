'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Loads the 8 pre-existing templates (v1.1.0) as "Legacy Rendering Profiles" —
 * preserved verbatim (frontmatter, license, note all intact), never deleted,
 * never silently reinterpreted. Offered in Simple Mode as a fast-path alongside
 * the new Name+Goal flow (section 23: legacy != deprecated).
 */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;
const VARS_BLOCK_RE = /```json-vars\n([\s\S]*?)\n```\n/;

function loadLegacyTemplates(templatesDir) {
  const dir = templatesDir || path.join(__dirname, '..', 'templates');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  return files.map((file) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const fmMatch = FRONTMATTER_RE.exec(text);
    const meta = {};
    if (fmMatch) {
      fmMatch[1].split('\n').forEach((line) => {
        const idx = line.indexOf(':');
        if (idx > -1) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      });
    }
    const rest = fmMatch ? text.slice(fmMatch[0].length) : text;
    const varsMatch = VARS_BLOCK_RE.exec(rest);
    const variables = varsMatch ? JSON.parse(varsMatch[1]) : [];
    const body = varsMatch ? rest.slice(varsMatch[0].length).trim() : rest.trim();
    return {
      id: file.replace(/\.md$/, ''),
      title: meta.title || file,
      domain: meta.domain || '',
      mode: meta.execution_mode || 'direct',
      license: meta.license || '',
      note: meta.note || '',
      variables,
      body,
      _legacy: true,
    };
  });
}

module.exports = { loadLegacyTemplates };
