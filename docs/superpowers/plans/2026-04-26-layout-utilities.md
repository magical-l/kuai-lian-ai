# Layout 工具类实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CSS 中添加 4 个语义化布局工具类

**Architecture:** 直接在现有 HTML 文件的 style 区块插入新类定义，无需新增文件

**Tech Stack:** 纯 CSS，无依赖

---

### Task 1: 添加布局工具类 CSS

**Files:**
- Modify: `kuai-lian-ai.html:78` (在 :root 后、Base 区块前插入)

- [ ] **Step 1: 插入 CSS 代码**

在 `kuai-lian-ai.html` 第 78 行（`:root` 结束后的空行处，`/* ========== Base ========== */` 之前）插入：

```css
/* ========== Layout Utilities ========== */
.layout-y-queue { display: flex; flex-direction: column; }
.layout-y-stack { display: flex; flex-direction: column-reverse; }
.layout-x-queue { display: flex; flex-direction: row; }
.layout-x-stack { display: flex; flex-direction: row-reverse; }
```

- [ ] **Step 2: 验证插入位置正确**

打开 `kuai-lian-ai.html`，确认新代码块位于：
- `:root` Design Tokens 之后
- `/* ========== Base ========== */` 之前

- [ ] **Step 3: 提交**

```bash
git add kuai-lian-ai.html
git commit -m "feat: 添加 layout 工具类 (y-queue/y-stack/x-queue/x-stack)"

# 同时更新版本号（根据项目规范）
```

---

## 验证清单

实现完成后，确认：
1. CSS 类定义位于正确位置
2. 命名符合设计文档：`layout-y-queue`、`layout-y-stack`、`layout-x-queue`、`layout-x-stack`
3. 版本号已更新
4. Git 提交完成