'use strict';
const { redactText } = require('../gfpi/redaction');
/** All companion logging goes through this: secrets/PII patterns are removed and length is bounded. Request bodies are never logged. */
function scrub(s) { return redactText(String(s)).text.slice(0, 500); }
function createLogger(sink) { return { log: (event, detail) => sink(JSON.stringify({ event: scrub(event), detail: detail === undefined ? undefined : scrub(typeof detail === 'string' ? detail : JSON.stringify(detail)) })) }; }
module.exports = { scrub, createLogger };
