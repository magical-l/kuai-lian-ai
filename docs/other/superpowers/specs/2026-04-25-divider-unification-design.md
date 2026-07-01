# Divider 统一化设计

**日期：** 2026-04-25

## 目标

将 `#divider-left` 和 `#divider-right` 统一为 `.divider`，消除 `isLeft` 参数传递，使 divider 逻辑变成通用的"控制对应 sidebar 宽度"。

## 设计

### HTML 结构

DOM 顺序保持不变：

```html
<aside class="sidebar left">...</aside>
<div class="divider control sidebar left"></div>
<main id="main-content">...</main>
<div class="divider control sidebar right"></div>
<aside class="sidebar right">...</aside>
```

- `sidebar` + `left/right` 标识侧栏及其方向
- `divider control` + `sidebar left/right` 标识分隔线及其控制的侧栏
- divider 和 sidebar 共用方向 class，通过去除 `divider control` 得到对应 sidebar 的选择器

### CSS

统一为 `.divider` 规则：

```css
.divider {
  width: 6px;
  background: var(--border-subtle);
  cursor: col-resize;
  flex-shrink: 0;
  transition: background var(--transition-fast), width var(--transition-fast);
  position: relative;
  z-index: 10;
}

.divider:hover {
  background: var(--accent-primary);
  width: 8px;
}
```

删除 `#divider-left` 和 `#divider-right` 的 ID 规则。

### JS 逻辑

一个监听器处理所有 `.divider.control`：

```js
$$('.divider.control').forEach(div => {
  div.on('mousedown', e => {
    const sidebarClass = div.className.replace('divider', '').replace('control', '').trim();
    // 得到 '.sidebar.left' 或 '.sidebar.right'
    const sidebar = $(sidebarClass);
    const isLeft = sidebar.classList.contains('left');
    const startWidth = sidebar.offsetWidth;
    startX = e.clientX;
    curDiv = { sidebar, isLeft, storageKey: sidebarClass.replace('.', '-').replace(' ', '-') + '-width' };
  });
});

function doDrag(e) {
  const dx = e.clientX - startX;
  const newWidth = curDiv.isLeft ? curDiv.startWidth + dx : curDiv.startWidth - dx;
  // min/max 限制...
  curDiv.sidebar.style.width = clamped + 'px';
}
```

判断 `isLeft` 只在计算 `newWidth` 时使用一次，不再作为函数参数传递。

### localStorage key

格式：`sidebar-left-width` 和 `sidebar-right-width`（保持现有格式，用户无需迁移）

## 改动清单

1. HTML：替换 ID 为 class
2. CSS：合并为 `.divider` 规则
3. JS：统一事件监听和拖拽逻辑
4. 删除冗余代码：`dividerLeft`、`dividerRight` 变量，`startDrag` 函数的 `isLeft` 参数