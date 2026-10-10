import json,sys,re,pathlib
sys.path.insert(0, sys.argv[1])
from consumer import adapter as A
out=pathlib.Path(sys.argv[2]); bp=json.loads(pathlib.Path(sys.argv[3]).read_text(encoding="utf-8"))
prov=json.loads((out/A.PROVENANCE_FILE).read_text(encoding="utf-8")); pin=A.load_pin(verify=True)
files_ok=all(A.sha256_lf((out/k).read_bytes())==v for k,v in prov["files"].items())
listed=set(prov["files"]); actual=set(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file() and "node_modules" not in p.parts and p.relative_to(out).as_posix()!=A.PROVENANCE_FILE)
subset=json.loads((out/A.SUBSET_FILE).read_text(encoding="utf-8"))
secrets=[str(p) for p in out.rglob("*") if p.is_file() and "node_modules" not in p.parts and A.scan_secrets(p.name, p.read_text(encoding="utf-8", errors="ignore"))]
tokens=[str(p) for p in out.rglob("*") if p.is_file() and "node_modules" not in p.parts and p.suffix in (".md",".json",".html",".ts",".tsx",".dart",".yaml") and re.search(r"\{\{[A-Z_]+\}\}", p.read_text(encoding="utf-8", errors="ignore"))]
docs=sorted(p.name for p in (out/"docs/ai").glob("*.md"))
print(json.dumps({"producer_contract_commit":prov["producer_contract_commit"],"pin_commit":pin["producer_contract_commit"],"mapping_ok":prov["profile_mapping_sha256"]==pin["profile_mapping_sha256"],"schema_ok":prov["consumer_schema_sha256"]==pin["consumer_schema_sha256"],"profile":prov["profile"],"files_ok":files_ok,"unlisted":sorted(actual-listed),"missing":sorted(listed-actual),"subset_sha_ok":prov["blueprint_subset_sha256"]==A.sha256_lf((out/A.SUBSET_FILE).read_bytes()),"subset_equals_factory_extract":subset==A.extract_subset(bp),"secrets":secrets,"tokens":tokens,"docs_ai_md":len(docs),"scope_note_ok":"NOT execution authority" in prov.get("scope_note","")}, ensure_ascii=False))