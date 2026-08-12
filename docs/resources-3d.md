# 3D 与工具资源档 · Resources — 3D & Tooling

> 与"视觉参考"分开：这里存的是**技术/工具资源**（做首页 3D 形象 + 落地会用到的东西）。
> 每条标清：是什么 · 对我有没有用 · 注意事项。

---

## 首页 3D 方案：两条实现路线

我的首页 = 艺术化 3D 自我形象 hero + 滚动缩放转场 + 签名交互（形象跟随鼠标）。
资产我自己做（Blender 建场景 + 风格化形象），下面是"集成 + 交互 + 上网页"的两条路。

### 路线 A · Spline（首选，设计师友好）
- **是什么**：可视化 3D 编辑器，能搭场景、调材质光照、把滚动绑定到相机缩放、导出嵌网页。
- **网址**：https://spline.design
- **对我**：门槛最低，自己在编辑器里就能调"下滑=镜头推进"。**推荐先走这条**。
- **Blender → Spline**：导 **GLB**（单文件带纹理，最稳）；导出前 apply 变换；材质到 Spline 重调；控制面数（低面/decimate）；可在 Blender 烘焙光影进贴图更省性能。

### 路线 B · React Three Fiber（R3F，效果上限高，Claude Code 帮写）
- **是什么**：用 React 写 Three.js，在网页里做真 3D / WebGL。
- **示例库**：https://r3f.docs.pmnd.rs/getting-started/examples
- **官网/生态**：https://pmnd.rs （Poimandres / pmndrs — R3F 及一系列 3D 网页库的维护者）
- **对我**：Spline 不够用时的进阶路线——用 R3F 加载同一个 Blender 导出的 GLB，用 Lenis(平滑滚动)+GSAP/ScrollTrigger 把滚动进度映射到相机 z 或物体缩放。**交给 Claude Code 实现**。
- **注意**：比 Spline 重、要调代码；先用 Spline，除非需要更强控制再上 R3F。

---

## 看源码 & 官方 MCP（Phase 4 用）

### pmndrs 官方 Claude Code plugin / MCP（强烈推荐）
- **是什么**：pmndrs 文档站（documentation.pmnd.rs）提供官方 MCP + plugin，让 Claude Code 直接查 R3F / Drei / React Spring 等全部文档与示例源码。
- **安装命令**（Phase 4 在 Claude Code 里敲）：
  ```
  /plugin marketplace add pmndrs/claude-code-plugin
  /plugin install pmndrs@pmndrs
  ```
- **对我**：不用手翻 GitHub——直接问 Claude Code"某效果怎么实现"，它查官方源。找示例源码的最快方式。
- 补充：每个库还暴露 `llms.txt` / `llms-full.txt`（给 AI 读的文档）。

### 手动看某个示例源码
- 文档站每张库卡片下有 **Documentation**（用法）和 **GitHub**（源码）两个入口。
- 示例页常带 **CodeSandbox / StackBlitz**（在线编辑器，完整源码可实时改）或 **GitHub 图标**。
- 逛 `github.com/pmndrs` 看所有库与示例；进仓库先看 **LICENSE**（多为 MIT，允许学习/复用，需保留署名）。

### 学习姿势（合规）
- ✅ 学手法、读源码、用同样的库做**你自己的**东西；❌ 整段照搬（除非许可证允许且署名）。
- 很多效果背后是 **@react-three/drei** 的现成封装——优先用官方封装，比逆向单个示例更稳更合规。

---

## 护栏（两条路线通用，Phase 4 记得）
- 移动端退化为静态图（窄屏不跑重 3D）。
- 首屏懒加载 3D，别拖秒开。
- 尊重 `prefers-reduced-motion`。
- 模型低面数、纹理压缩，保证加载性能（呼应"招聘者秒开"）。

---

*版本 v0.1 · 资源档，随用随补。*
