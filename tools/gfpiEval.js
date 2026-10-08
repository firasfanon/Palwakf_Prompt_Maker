#!/usr/bin/env node
'use strict';
// node tools/gfpiEval.js write-corpus|check-corpus|review-status|selftest
const fs = require('fs'); const path = require('path');
const H = require('../eval/harness');
const root = path.join(__dirname, '..');
const corpusPath = path.join(root, 'eval', 'corpus', 'corpus.v1.json');
const reviewPath = path.join(root, 'eval', 'review', 'review_records.json');
const cmd = process.argv[2];
if (cmd === 'write-corpus') { fs.writeFileSync(corpusPath, JSON.stringify(H.corpusDocument(), null, 2) + '\n'); console.log('corpus written'); }
else if (cmd === 'check-corpus') {
  const doc = JSON.parse(fs.readFileSync(corpusPath, 'utf8')); const v = H.validateCorpus(doc);
  const fresh = H.corpusDocument();
  if (fresh.corpus_sha256 !== doc.corpus_sha256) { console.error('corpus.v1.json is stale vs corpusSource.js'); process.exit(1); }
  console.log(JSON.stringify(v)); process.exit(v.valid ? 0 : 1);
} else if (cmd === 'review-status') {
  const doc = JSON.parse(fs.readFileSync(corpusPath, 'utf8')); const rec = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  const s = H.reviewStatus(doc, rec); console.log(s.status + ' (' + s.reasons.length + ' open reasons)');
} else { console.error('usage: write-corpus | check-corpus | review-status'); process.exit(2); }
