# 知君取消任务预算：分支交付说明

日期：2026-10-15
分支：`codex/remove-task-budgets-20261015`
基线：CodeUp `origin/master`，`fca39e8`。

本次产品决定是取消发送前报价、预算授权、执行令牌、任务上限提示、额度暂停与追加按钮。知君直接通过原有 WANX Host 转发对话，原有身份隔离、私人知识库和工具审批继续生效。积分余额与用量查看在万象完成，真实支付及应用自动扣费不开启。

## 本提交范围

CodeUp 最新 master 本身没有本机实验预算功能。因此不为制造删除记录而重新加入旧预算代码，本分支在最新 master 上增加两个回归测试：

- Host 转发对话不访问 `/api/credits/`，不发送 billing_task_id、gateway_task_id、gateway_execution_token，不输出任务上限提示。
- UI 忽略退休的 budget_paused 事件，仍可发送普通 user_turn，不出现“追加任务预算”区域。

附 `docs/integration/remove-experimental-budget.patch` 保存本机实验版到取消版的代码差异，供已接入该实验的分支集成。包含 server/app.mjs 预算调用移除和 Chat.tsx 预算状态/按钮移除。先运行 `git apply --check`；没有实验功能的 master 无需应用。应用补丁后同时删除旧 `server/billing.mjs` 与专用 `tests/billing.test.mjs`，重新构建再验证。

没有混入本机其他 bootstrap/provision/角色开发修改，没有上传数据或安装包。WANX 对应同名分支提供账号账本、非阻断用量记录和取消预算后的客户端；完整范围见其 `docs/remove-task-budgets-handoff.md`。

## 独立分支验证

- `npm test`：117 项通过。
- `npm run test:ui`：88 项通过。
- `npm --prefix desktop test`：22 项通过。
- `npm run build`：通过；保留已有 bundle size 提示。
- 本机集成版本此前已在 WANX 中完成无需预算授权的对话与预计用量查看；该集成目录包含其他开发功能，不将它作为此独立分支的生产或 Windows 验收。

## 合并与同步

CodeUp 是核心仓库；GitHub 同名分支只同步完全一致提交。不覆盖 main/master，不自动合并。生产部署、市场包发布和版本号升级均未在本次分支提交中执行；正式发布时按项目要求统一客户端、桌面和市场清单版本。

没有开启真实支付，没有充值、赠送或补扣真实积分。
