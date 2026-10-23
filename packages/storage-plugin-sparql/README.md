# SPARQL 原生端点

`@migaia/storage-plugin-sparql/http` 创建调用方拥有的 SPARQL 1.1 Protocol 端点。配置 queryUrl、updateUrl，可选 graphStoreUrl 与 Basic/Bearer 凭据。工厂不执行 I/O。通用 HTTP 不声明 atomicUpdate；认证只进入原生请求头。

`@migaia/storage-plugin-sparql/oxigraph` 借入调用方的 oxigraph.Store，从不关闭它。atomicUpdate 只执行一次原生 Store.update。图替换经 n3 解析后在一个完整原生 Update 中完成；合并使用原生事务 load。本包支持 oxigraph 0.4.11、n3 1.26.0 与真实 RDF/JS 声明。

SELECT/ASK 使用同一个 SPARQL JSON parser。CONSTRUCT 和 RDF 文档使用真实 n3 parser/writer，保留 RDF 1.1 字面量与单响应内的 blank 身份。图格式仅支持 Turtle 与 N-Triples；每次文档解析产生独立 blank 前缀。不支持 RDF-star 或变量文档。

HTTP HEAD404 返回不存在，GET404 拒绝。其它 4xx 为 SPARQL_REQUEST_FAILED，读取的 5xx/网络错误为 SPARQL_UNAVAILABLE。已发送修改的结果不确定时为 SPARQL_COMMIT_UNKNOWN，不重放。原 status、正文、cause 保持可达，不复制认证配置。解析失败为 SPARQL_RESPONSE_INVALID，本地非法参数沿共享 INVALID_ARGUMENT。
