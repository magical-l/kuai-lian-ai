#!/usr/bin/env python3
"""校验 docs/ 下所有模块文档的 frontmatter 格式是否完整"""
import glob, sys, os

errors = []
skip_patterns = ['index.md', 'decisions/', 'other/', 'docs/design/']

required_fields = ['title', 'covers_file', 'depends_on', 'api_signature', 'last_updated', 'why_exists']

for path in sorted(glob.glob('docs/**/*.md', recursive=True)):
    path_norm = path.replace('\\', '/')
    if any(p in path_norm for p in skip_patterns):
        continue

    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    if not content.startswith('---'):
        errors.append(f'{path}: 缺少 YAML frontmatter')
        continue

    parts = content.split('---', 2)
    if len(parts) < 3:
        errors.append(f'{path}: frontmatter 未正确关闭')
        continue

    fm_text = parts[1]
    for field in required_fields:
        if f'{field}:' not in fm_text:
            errors.append(f'{path}: 缺少字段 {field}')

if errors:
    for e in errors:
        print(f'❌ {e}')
    print(f'\n共 {len(errors)} 个问题')
    sys.exit(1)
else:
    print('✅ 全部文档格式正确')
