# Interior Mapping（室内视差映射）原理与三端实现

> **参考灵感**：[@KanaWorks_AI 在 X 上的 Three.js 复现与原理拆解](https://x.com/KanaWorks_AI/status/2125460581532737923)（复现《漫威蜘蛛侠》纽约高楼零建模窗内房间技术，含 4 条图文解析回复）。

本文记录 `streets` 街景项目中，如何在 **Web Three.js（GLSL）**、**ThreeRT 硬件光追（WGSL）** 和 **Blender Cycles 离线渲染（Metal GPU 原生节点组 + 一楼真 3D 商铺）** 三套管线中实现室内纵深效果。

---

## 一、核心原理：解析射线-箱体求交（而非传统高度图视差贴图）

Interior Mapping 常被归类为“视差 Shader”，但它**不是**依赖高度图（Height Map）步进采样的传统视差贴图（Parallax / BumpOffset / POM），而是利用“房间本身是一个规则长方体箱子”的几何先验，在片元着色器里做**零循环的解析射线-包围盒求交（Analytic Ray-Box Intersection）**：

| 对比维度 | 传统高度图视差（Parallax / POM） | Interior Mapping（室内映射） |
| :--- | :--- | :--- |
| 依赖数据 | 高度图（Height Map） | 无需高度图，用箱体几何公式解析求交 |
| 深度表现 | 适合浅凹凸表面（砖缝、浮雕）；90° 垂直侧墙易拉伸撕裂 | 适合 2–5 m 深的直角室内空腔，侧墙、天花板、地板透视完全准确 |
| GPU 开销 | POM 需多次循环 Raymarch 采样 | **0 循环、0 额外高度采样**，核心仅 3 次除法 + 2 次 `min` |

### 1. 局部坐标系与 3 行求交公式

在任意一面竖直窗户（朝向 ±X / ±Z 均可）的片元着色器中：

1. **现场构造窗面切线基**（无需额外切线顶点属性）：
   - Y-up（Three.js / ThreeRT）：`B = (0, 1, 0)`，`T = normalize(cross(B, N))`
   - Z-up（Blender Cycles）：`B = (0, 0, 1)`，`T = normalize(cross(B, N))`
2. **把视线转入窗内局部空间**：
   - 从摄像机射向窗面像素的单位向量 `rayWorld`（GLSL 中为 `normalize(worldPos - cameraPosition)`；ThreeRT 中为 `-i.view`；Cycles 中为 `-Geometry.Incoming`）。
   - 投影到 `(T, B, N)` 得到向房间内行进的射线方向 `d = (dot(rayWorld, T), dot(rayWorld, B), min(dot(rayWorld, N), -0.002))`（沿 `-N` 进入房间，因此 `d.z < 0`）。
3. **求射线到 3 组平面的最近交点**（以窗高为 `1.0`、窗宽为 `aspect` 的真实比例单位）：
   ```glsl
   // 虚拟房间半宽 rx、半高 ry、进深 rz（箱体范围 x ∈ [-rx, rx], y ∈ [-ry, ry], z ∈ [-rz, 0]）
   vec3 p = vec3((uv.x - 0.5) * aspect, (uv.y - 0.5) + winOffsetY, 0.0);

   float tx = (abs(d.x) > 1e-4) ? ((d.x > 0.0 ? rx : -rx) - p.x) / d.x : 1e6; // 左 / 右侧墙
   float ty = (abs(d.y) > 1e-4) ? ((d.y > 0.0 ? ry : -ry) - p.y) / d.y : 1e6; // 天花板 / 地板
   float tz = (-rz - p.z) / d.z;                                              // 后墙

   float t = min(tz, min(tx, ty));
   vec3 hit = p + d * t; // 精确 3D 命中点
   ```
   - 仰视二楼窗户时 `d.y > 0`，`ty` 最小，先撞到天花板 → 露出日式圆形吸顶灯（シーリングライト）；
   - 横向走过窗户时 `d.x` 变大，`tx` 最小，先撞到对应侧墙 → 侧墙随视角自然转出。

### 2. 三层深度视差（窗面 → 中层家具板 → 房间 5 面盒）

为了打破“空盒子”感，在房间中途 `z_mid = -rz * k`（约 `0.22–0.45` 进深处）额外插入一张虚拟平行平面，再做一次一步求交：

```glsl
float tMid = (zMid - p.z) / d.z;
if (tMid > 0.0 && tMid < t) {
  vec2 midPos = p.xy + d.xy * tMid;
  // 若落在沙发/餐桌/电视/吊灯/书架轮廓内，则遮挡后墙
}
```

这样就形成 **外窗框/褶皱窗帘/百叶窗（`z = 0`） → 中层家具与悬吊吊灯（`z = z_mid`） → 房间后墙/侧墙/顶/地（`z = hit.z`）** 三层不同速度的真实透视视差。

```mermaid
flowchart LR
    Cam["摄像机视线 rayWorld"] --> Glass["窗面层 z=0<br/>外窗框 / 木格栅 / 褶皱窗帘 / 百叶窗 / Fresnel反射"]
    Glass --> Mid["中层平面 z=zMid<br/>吊灯 / 沙发餐桌 / 电视柜 / 货架剪影"]
    Mid --> Box["房间五面盒 z=-rz<br/>后墙 / 左右侧墙 / 吸顶灯天花板 / 木地板 + 墙角AO"]
```

---

## 二、工程关键技巧（合批网格 + 跨管线兼容）

### 1. 合批 Mesh 的每窗独立种子与宽高比编码（零新增顶点属性）
`streets` 场景为了把 Draw Call 压在 ~65 次以内，通过 `Bucket` 将全街区数千扇窗合并为 6 个大 Mesh，着色器无法用 `Object ID` 区分单扇窗。

我们在 [`streets/web/japanese-buildings.js`](web/japanese-buildings.js) 的 `windowPaneBox(w, h, d, cellX, cellY)` 中，直接用 **UV0 整数格偏移** 传递每窗元数据：
- 正面（`+Z`）UV 映射为 `[cellX + 0.002, cellX + 0.998] × [cellY + 0.002, cellY + 0.998]`：
  - **`cellX`（0–127）**：每扇窗独立的确定性随机种子（决定房间配色、进深、家具款式、窗帘开合度与亮度起伏）；
  - **`cellY`（`round(aspect * 10)`）**：每扇窗真实的宽高比，防止宽条窗或窄长窗里的吸顶灯和家具被压扁拉伸；
  - **内缩 `0.002..0.998`**：彻底杜绝边界 `u = 1.0` 时 `floor()` 跳变导致的 1 像素接缝。
- **跨管线零损耗**：将回退 2D 贴图改为 `RepeatWrapping` 后，通过 `GLTFExporter` 导出为 `playground_street_rt.glb`，ThreeRT 和 Blender Cycles 都能原封不动地读到同一套 UV0 种子。
  - **注意 glTF 垂直翻转**：Three.js 的 `v = cellY + v_up` 经 glTF 导出（image convention `v` 向下）后变成 `1.0 - v_three`，因此在 **ThreeRT (WGSL)** 与 **Blender Cycles** 中统一解码为：
    ```text
    cellX = floor(uv.x),        u_loc = fract(uv.x)
    cellY = abs(floor(uv.y)),   v_up  = 1.0 - fract(uv.y)
    ```

### 2. 一楼商铺像素级玻璃遮罩
商店街一楼 6 类商铺（`kissaten` 純喫茶、`bookstore` 书店、`konbini` 便利店、`pharmacy` 药局、`izakaya` 居酒屋、`ramen` 中华そば）原本已有严格绘制的 `emissiveMap`：外墙砖、门窗框、门横档、木护墙板与居酒屋木格栅（木格子）均为纯黑 `#000000`，仅玻璃窗区域有亮度。

三端均直接复用这份 `emissiveMap` 作为像素级 `glassMask`：
- `glassMask == 0`：保留原样哑光不发光的门框、护墙板与木格栅；
- `glassMask == 1`：玻璃区域替换为三维商铺内景（或 Cycles 的物理透明反射玻璃），并自动将玻璃粗糙度压低到 `0.05–0.06` 呈现通透反光。

---

## 三、本仓库三套渲染管线的实现对照

| 渲染管线 | 实现文件 | 楼上 / 民宅窗 | 一楼商店街商铺 | 特点与优势 |
| :--- | :--- | :--- | :--- | :--- |
| **Web Three.js（实时）** | [`streets/web/interior-mapping.js`](web/interior-mapping.js)<br>[`streets/web/street.js`](web/street.js) | GLSL `onBeforeCompile` 注入 `MeshStandardMaterial` | 同上（`applyShopInteriorMapping`，用 `emissiveMap` 遮罩） | 0 增面、60 fps，完整复用 `atmosphere.js` 的 24H 昼夜 `emissiveIntensity` 过渡与 PMREM 环境反射 |
| **ThreeRT（硬件光追）** | [`streets/native/rt-interior-mapping.ts`](native/rt-interior-mapping.ts)<br>[`streets/native/playground-street.ts`](native/playground-street.ts) | WGSL `MaterialFunction`（`windowInterior`），挂在 `GLTFModel.functions` | WGSL `MaterialFunction`（`shopInterior`），用 `base.emissive` 遮罩 | 0 增面、原生 Apple M4 硬件光追；支持真实街道/水洼镜面反射与面光源 GI，非直视漫反射通过 `!i.near` 跳过细节保持高速 |
| **Blender Cycles（离线）** | [`streets/native/cycles_interiors.py`](native/cycles_interiors.py)<br>[`streets/native/render_cycles.py`](native/render_cycles.py) | 原生 Cycles Metal GPU 节点组 `Cycles_Interior_Mapping_v1`（避开 CPU-only 的 OSL） | **混合升级**：619 间空心一楼商铺动态建出**真 3D 实体房间** + 透明阴影物理玻璃；实心背墙商铺自动回退到 GPU 节点组视差 | 100% Apple Metal GPU 加速；近景一楼商铺有真实 3D 球形吊灯、货架、吧台及穿过木格栅投向人行道的真实暖光阴影 |

### 几个重要细节备忘
1. **为何 Blender 不用 OSL**：macOS Apple Metal GPU 后端不支持 Cycles 的 `ShaderNodeScript`（OSL 会强制回退 CPU，渲染慢 5–10 倍）。将 GLSL 公式 1:1 翻译为 `Geometry` / `UV Map` / `Vector Math` / `Math` / `White Noise Texture` 原生节点组后，Cycles 会直接将其编译为 Metal GPU 原生代码，且同时兼容 EEVEE。
2. **Blender 空心商铺的双面剔除**：Three.js 的 `BoxGeometry` 每个面顶点独立未焊接，导入 Blender 后厚 `0.14 m` 的商铺盒正面与背面是两个独立连通片。[`cycles_interiors.py`](native/cycles_interiors.py) 通过头顶 `+Z` 射线检测屋顶/二楼楼板来 100% 区分“朝街正面”与“朝屋内背面”，并删除空心铺面背后 `0.14 m` 处的背面挡板，确保视线直通真 3D 室内。
3. **车窗隔离**：轻型车玻璃使用独立材质 `carGlass`，避免住宅 `windowUnlit` 室内映射错误出现在汽车车窗上。

---

## 四、后续可扩展方向

当前三端着色器在算出命中面 `face` 与交点坐标 `hit` 后，采用**纯代码程序化绘制**（零额外贴图内存、风格可控）。如果未来追求《漫威蜘蛛侠》级的写实室内软装细节，只需保留前面整套解析射线求交逻辑不变，将最后“按 `face` 和 `hit` 着色”的一段替换为采样 4–8 张预先渲染好的 **360° 室内全景图 / Cubemap 图集** 即可。
