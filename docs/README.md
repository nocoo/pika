# Pika 文档

[中文项目说明](../README.md) · [English README](README.en.md)

| 文档 | 内容 |
| --- | --- |
| [00 · 架构](00-architecture.md) | 单 Worker 拓扑、鉴权与数据模型；部分命令和发布描述保留了旧实现 |
| [01 · 开发与使用](01-development.md) | 当前来源目录、CLI 行为、本地验证、配置与部署前置条件 |

新环境从开发与使用说明开始。当前站点由 `packages/web-worker` 同时提供 SPA 和 API；Release 是独立工作流，D1 迁移不在自动部署步骤中。
