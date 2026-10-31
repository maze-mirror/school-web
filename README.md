# 2026秋软件工程实验项目

## 本地启动

school-web 日常使用 `main`，其中已包含最新代码统计和个人主页仓库链接。两个网页分别在两个终端运行，不需要来回切分支；终端关闭或按 Ctrl+C 后，对应服务停止。

**代码统计**（首次使用或依赖变化时，先在 school-web 根目录执行 `pnpm install --frozen-lockfile`）：

```powershell
Set-Location D:\Projects\school-web
pnpm --filter code-meter-web dev --host 127.0.0.1 --port 5173 --strictPort
```

打开 http://127.0.0.1:5173/。支持 C、C++、Python、Java、JavaScript、TypeScript，详见 [代码统计 README](apps/code-meter-web/README.md)。

**个人主页 Sailing Log**（独立仓库，已在本地保留该目录时）：

```powershell
Set-Location D:\Projects\school-web\apps\portfolio-web\sailing_log
pnpm dev --host 127.0.0.1 --port 5177 --strictPort
```

打开 http://127.0.0.1:5177/。源码、依赖、提交和推送均属于 [portfolio_sailingLog 独立仓库](https://github.com/maze-mirror/portfolio_sailingLog)，不随 school-web 同步。新克隆 school-web 不包含该目录，安装方式见 [主页入口说明](apps/portfolio-web/README.md)。

## 1.代码统计工具

## 2.四则运算出题

## 3.双人主页
