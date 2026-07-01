# Layout 工具类设计

## 概述

为项目添加语义化的布局工具类，替代重复的手写 flex 声明。

## 类定义

4 个基础布局类，命名带 `layout-` 前缀：

```css
/* ========== Layout Utilities ========== */
.layout-y-queue { display: flex; flex-direction: column; }
.layout-y-stack { display: flex; flex-direction: column-reverse; }
.layout-x-queue { display: flex; flex-direction: row; }
.layout-x-stack { display: flex; flex-direction: row-reverse; }
```

## 命名语义

| 类名 | 方向 | DOM顺序 → 视觉顺序 |
|------|------|-------------------|
| `y-queue` | 纵向 | 上 → 下（正向） |
| `y-stack` | 纵向 | 下 → 上（反向） |
| `x-queue` | 横向 | 左 → 右（正向） |
| `x-stack` | 横向 | 右 → 左（反向） |

## 放置位置

放在 `:root` Design Tokens 之后、`/* ========== Base ========== */` 区块之前。

## 使用示例

```html
<!-- 原来 -->
<div style="display: flex; flex-direction: column;">...</div>

<!-- 现在 -->
<div class="layout-y-queue">...</div>
```

## 修饰类（后续）

gap、align、justify、wrap、flex-fill 等修饰类之后再说，不在本次范围。