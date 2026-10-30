# portfolio-web

个人主页入口容器，每位作者的实际网站在独立仓库中维护。

| 主页 | 独立仓库 |
| --- | --- |
| L · Sailing Log | [maze-mirror/portfolio_sailingLog](https://github.com/maze-mirror/portfolio_sailingLog) |

本容器的 `/` 和 `/sailing_log/` 显示仓库链接，不加载 sailing_log 源码，也不部署或代理独立网站。

## 本地运行入口页

```sh
pnpm --filter portfolio-web dev --host 127.0.0.1 --port 5175
```

## 本地维护 Sailing Log

已有的 `sailing_log/` 目录现在是独立 Git 仓库，已被 school-web 忽略。在其中运行 `pnpm dev`、提交和推送只影响个人网站仓库。

新克隆 school-web 时不会包含该目录。如需在对应位置继续维护：

```sh
git clone https://github.com/maze-mirror/portfolio_sailingLog.git apps/portfolio-web/sailing_log
cd apps/portfolio-web/sailing_log
pnpm install --frozen-lockfile
pnpm dev
```

这是普通仓库链接和一个可选的本地独立 checkout，不是 Git 子模块；school-web 不保存个人网站的提交指针或源码副本。其他作者的主页可以在上表添加独立链接。
