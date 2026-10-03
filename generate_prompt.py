#!/usr/bin/env python3
"""
مصنع البرومبتات — يولّد برومبتًا جاهزًا للصق من قالب جاهز + إجابات المستخدم.
يكتشف المتغيرات المطلوبة تلقائيًا من كل قالب (بلا تعديل يدوي للأداة عند إضافة قالب جديد).
"""
import json
import re
import sys
from pathlib import Path
from datetime import date

TEMPLATES_DIR = Path(__file__).parent / "templates"
OUTPUT_DIR = Path(__file__).parent / "generated"
REGISTRY_FILE = Path(__file__).parent / "PROMPTS_REGISTRY.md"

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
VARS_BLOCK_RE = re.compile(r"```json-vars\n(.*?)\n```\n", re.DOTALL)


def parse_frontmatter(text):
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    raw = m.group(1)
    meta = {}
    for line in raw.splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    rest = text[m.end():]
    return meta, rest


def parse_vars_block(text):
    m = VARS_BLOCK_RE.match(text)
    if not m:
        return [], text
    variables = json.loads(m.group(1))
    body = text[m.end():]
    return variables, body


def list_templates():
    return sorted(TEMPLATES_DIR.glob("*.md"))


def load_template(path):
    text = path.read_text(encoding="utf-8")
    meta, rest = parse_frontmatter(text)
    variables, body = parse_vars_block(rest)
    return meta, variables, body


def main():
    templates = list_templates()
    if not templates:
        print("⚠️  لا توجد قوالب في templates/", file=sys.stderr)
        sys.exit(1)

    print("🏭 مصنع البرومبتات — القوالب المتاحة:")
    print("════════════════════════════════════")
    for i, path in enumerate(templates, start=1):
        meta, variables, _ = load_template(path)
        mode = {"direct": "تنفيذ مباشر", "agentic-build": "بناء أداة (Codex)"}.get(
            meta.get("execution_mode"), meta.get("execution_mode", "")
        )
        var_note = f"{len(variables)} حقل متغيّر" if variables else "بلا متغيرات — جاهز كما هو"
        print(f"  {i}) {meta.get('title', path.stem)}")
        print(f"     المجال: {meta.get('domain', '—')} | {mode} | {var_note}")

    choice = input("\nاختر رقم القالب: ").strip()
    try:
        idx = int(choice) - 1
        path = templates[idx]
    except (ValueError, IndexError):
        print("❌ اختيار غير صحيح.", file=sys.stderr)
        sys.exit(1)

    meta, variables, body = load_template(path)

    print(f"\n📋 {meta.get('title')}")
    values = {}
    if variables:
        print("أدخل قيمة كل حقل (Enter للترك فارغًا إن لم تحدده بعد):\n")
        for var in variables:
            val = input(f"  {var['label']}: ").strip()
            values[var["name"]] = val or f"[{var['label']}]"
    else:
        print("هذا القالب جاهز بلا متغيرات مطلوبة.")

    final_prompt = body
    for name, val in values.items():
        final_prompt = final_prompt.replace("{{" + name + "}}", val)

    OUTPUT_DIR.mkdir(exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")
    out_name = f"{date.today().isoformat()}-{slug}.md"
    out_path = OUTPUT_DIR / out_name
    out_path.write_text(final_prompt.strip() + "\n", encoding="utf-8")

    if REGISTRY_FILE.exists():
        with open(REGISTRY_FILE, "a", encoding="utf-8") as f:
            f.write(f"| {meta.get('title')} | {meta.get('domain')} | {date.today().isoformat()} | {out_name} |\n")

    print(f"\n✅ البرومبت جاهز: {out_path}")
    print("—" * 40)
    print(final_prompt.strip())
    print("—" * 40)


if __name__ == "__main__":
    main()
