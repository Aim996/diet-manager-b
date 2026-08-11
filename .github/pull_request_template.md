## Summary

- 变更目标：
- 用户可观察结果：
- 明确非目标：

## Verification

- [ ] 已先证明相关测试在修复前失败
- [ ] `pnpm handoff:validate`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm plugin:validate`
- [ ] `git diff --check`

## Data and security

- [ ] 业务数据新增为 0，或已在批准的 PRODUCT 事务范围内精确说明
- [ ] 未提交令牌、密钥、`.env`、真实饮食数据、SQLite/DB/JSONL、备份或 raw evidence
- [ ] 未恢复 A/C 并行实现
- [ ] 失败日志没有被解释为记录成功
- [ ] 安装、迁移或清理没有越过精确授权目录

## Documentation and release

- [ ] 已更新受影响的 README、START-HERE、开发进度、work-item 或总计划状态
- [ ] 当前版本仍被正确标记为 foundation 或 PRODUCT
- [ ] 若涉及未来开源，许可证状态和公开范围没有被擅自改变

## Rollback

说明如何安全撤回本变更，以及撤回是否影响业务数据、Schema 或安装状态：
