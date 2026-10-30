# 📷 照片取件（photo-pickup）

给摄影师用的**原画质照片交付站**：老师在管理端建相册、批量上传原片，把生成的取件码发给客人；客人在首页输入取件码即可预览和下载，全程不压缩画质（告别微信 QQ 传图被压）。

部署目标：**Vercel 免费版**（存储用 Vercel Blob，同样有免费额度，不用绑卡）。

## 功能

- 客人端：输取件码 → 缩略图画廊 → 点开大图 → 单张下载 / 浏览器打包 ZIP 下载 / 逐张下载
- 管理端 `/admin`（密码登录）：
  - 新建相册（自动生成 8 位取件码，可选 3/7/14 天后过期）
  - 拖拽 / 选文件 / 选整个文件夹批量上传，2 张并发，实时进度
  - 上传时浏览器自动生成 420px 小缩略图，画廊秒开
  - 复制取件码、删除相册（立即失效）
- 每天凌晨 3 点（北京时间）自动删除过期相册，释放免费额度
- 照片**浏览器直传 / 直下** Blob 存储，不经过服务器：不受 Vercel 4.5MB 请求体限制，原图多大都行

## 原理（无数据库）

文件在 Blob 里的布局（`batchId` 是随机 12 位，外人拿到链接也无法枚举其他相册）：

```
b/{batchId}/meta.json          相册信息：取件码、名字、创建/过期时间
b/{batchId}/f/{序号}-{文件名}   原图
b/{batchId}/t/{序号}.webp      缩略图
```

- 建相册 = 写一个 `meta.json`；列相册 = 按前缀 `b/` 列出所有 meta
- 客人输码 → 服务端找到对应相册 → 按前缀列出文件 → 返回直链
- 定时任务（`vercel.json` 里的 cron）每天扫一遍，删掉过期的

## 本地跑起来

```bash
npm install
```

先去 Vercel 建好 Blob 存储（见下面部署第 3 步），拿到 Token 后：

```bash
# Windows (PowerShell)
Copy-Item .env.example .env.local
```

编辑 `.env.local` 填三项：`ADMIN_PASSWORD`（自己设的长密码）、`BLOB_READ_WRITE_TOKEN`（Vercel 控制台 Copy Token）、`CRON_SECRET`（随便一串随机字符）。

```bash
npm run dev
```

- 取件页：http://localhost:3000
- 管理端：http://localhost:3000/admin

## 部署到 Vercel（免费）

1. **推到 GitHub**

   ```bash
   git init
   git add .
   git commit -m "照片取件站"
   # 在 GitHub 上新建一个空仓库 photo-pickup 后：
   git remote add origin https://github.com/你的用户名/photo-pickup.git
   git branch -M main
   git push -u origin main
   ```

2. **导入项目**：[vercel.com](https://vercel.com) 用 GitHub 账号登录 → Add New… → Project → 选中 `photo-pickup` → 其他都不用改。

3. **创建 Blob 存储**：项目页顶部 **Storage** 标签 → Create Database → 选 **Blob** → 名字随意 → 创建后点 **Connect to Project**（会自动把 `BLOB_READ_WRITE_TOKEN` 注入环境变量）。

4. **加环境变量**：Settings → Environment Variables，添加两个：
   - `ADMIN_PASSWORD` = 你的管理密码（设长一点！这就是唯一的管理凭证）
   - `CRON_SECRET` = 一串随机字符（和定时清理接口对暗号用）

5. **Deploy**。完成后访问 `https://你的项目.vercel.app`，管理端在 `/admin`。`vercel.json` 里的每日清理任务会自动生效。

6. （可选）**绑自己的域名**：Settings → Domains。`vercel.app` 在国内多数时候能访问但偶尔慢，绑个自己买的域名通常更稳。

## 免费额度与限制（Hobby 计划）

- Blob：**1GB 存储**、每月 10GB 读取流量、少量写入次数（以 Vercel 官网价格页为准）
- 1GB ≈ 60~150 张相机原片。靠"3~14 天自动过期 + 每日自动清理"保持不超；不够时先手动删旧相册
- 真到量大那天（比如单相册就要好几个 GB），升级路线：换 Cloudflare R2（10GB 内免费）或腾讯云 COS（国内速度快、按量计费），代码只需改 `lib/blob.ts` 和上传接口两处

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 上传时报 401 | 没登录或 Cookie 过期，刷新页面重新登录 |
| 本地报 `BLOB_READ_WRITE_TOKEN` 缺失 | `.env.local` 没填 Token，先去 Vercel 建好 Blob 存储 |
| 客人说取件码无效 | 过期了 / 被删了 / 输错了（大小写、横线都随意，8 位对上就行） |
| 打包 ZIP 失败 | 相册太大或网络不稳，改用"逐张下载" |
| 想改管理密码 | 改 Vercel 环境变量 `ADMIN_PASSWORD` 再 Redeploy，所有已登录会话自动失效 |
| 上传中途关了页面 | 没传完的不算，重新选中相册再选一次文件即可续传（不会覆盖老照片） |

## 目录结构

```
app/
  page.tsx                  客人取件页（输码 → 画廊 → 下载）
  admin/page.tsx            管理端（登录 → 建相册 → 上传）
  api/
    pickup/[code]/route.ts  按取件码返回文件列表
    auth-upload/route.ts    给浏览器签发直传凭证（校验登录 + 路径白名单）
    admin/login|logout      登录登出
    admin/batches           相册 增/删/查
    cron/cleanup/route.ts   每日清理过期相册
lib/
  blob.ts                   Blob 存取封装（元数据、列举、删除）
  auth.ts                   HMAC 签名 Cookie 登录态
  codes.ts                  取件码生成/规范化
  thumb.ts                  浏览器端缩略图生成
```
