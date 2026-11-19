# apps/part-catalog

part 平台的目录服务，只在本机运行，不部署。它保存项目的版本快照、远端模块及其源码与环境指针，按 ETag 下发快照，处理晋级与回滚，保存编辑器草稿并处理原子变更集，提供目录查询与审计。

## 运行

```bash
bun src/main.ts token create --data ./catalog-data --project orders --envs dev,staging,prod --scope write --actor alice
bun src/main.ts env set --data ./catalog-data --project orders --env prod --public-read true
bun src/main.ts serve --data ./catalog-data --project-dir ../my-app --allow-origin http://127.0.0.1:5173
```

- 只监听 `127.0.0.1`，启动后打印 `{ "url": … }`；数据在 `<data>/catalog.sqlite`。
- 令牌只打印一次，库里只存它的 SHA-256；令牌绑定一个项目、一组环境与 `read`/`write` 范围。草稿、变更集、上传与审计属于 `dev` 环境；每个令牌每分钟最多 60 次写请求。
- 设为公开读取的环境，其快照可无令牌读取；已上传的发布模块 `/p/<project>/m/<文件>` 公开可取。
- `--allow-origin` 列出的源会得到 CORS 头；其他源没有。
- `--project-dir` 指向应用仓库：变更集中的 TS 模块用 `partom remote build` 在该目录内构建。这会在本机执行提交者的代码，写令牌按仓库写权限对待。

## 接口

| 方法与路径 | 权限 | 说明 |
|---|---|---|
| `PUT /p/:project/m/:file` | write | 上传模块字节，文件名须为其内容哈希 |
| `PUT /p/:project/snapshots/:hash` | write | 上传 `snapshot.json` 原字节，校验哈希、模块、内置规则与定义 |
| `PUT /p/:project/snapshots/:hash/sources` | write | 上传该快照模块的源码 |
| `GET /p/:project/env/:env/snapshot` | read / 公开 | 快照原字节，`ETag` 为快照哈希 |
| `POST /p/:project/env/:env/publish\|promote\|rollback` | write | 移动环境指针并记录历史 |
| `GET /p/:project/env/:env/history` | read | 指针历史，最新在前 |
| `GET /p/:project/drafts` | read | 草稿（含服务端计算的哈希与冲突） |
| `POST /p/:project/drafts/changesets` | write | 原子变更集，返回每个产物的结果 |
| `GET /p/:project/drafts/m/:file` | read | 草稿模块字节 |
| `GET /p/:project/catalog` | read | 描述符查询，带 `ETag` |
| `GET /p/:project/audit` | write | 审计记录 |

错误体为 `{ error: { source: 'part.catalog', code, message } }`，校验失败另带 `issues`。开发环境指针变化时草稿自动变基，冲突列在草稿的 `conflicts` 中。

## 验证

```bash
bun run fmt && bun run lint && bun run typecheck && bun run typecheck:test && bun run test
```
