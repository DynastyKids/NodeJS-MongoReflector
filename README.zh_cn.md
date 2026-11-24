# MongoDB 反射器 API 服务器

***Readme内容由AI在无监督环境下生成，如果文档内容有误按实际API和运行结果为准***

**中文** | [English](./README.md)

一个轻量级的 MongoDB 代理 API 服务器，使前端应用程序能够在没有专用后端基础架构的情况下执行数据库操作。可在 Vercel/Render 上部署为无服务器或容器化函数。

## 🌟 功能特性

- **前端优先架构**: 不需要后端代码即可直接从前端应用执行 MongoDB 操作
- **轻量级快速**: 单文件 Express.js 服务器，具有连接池管理
- **多语言文档**: 英文和中文 API 文档，附带语言选择器
- **生产就绪**: 在 Vercel/Render 上部署，已启用 CORS
- **时间序列支持**: MongoDB 时间序列集合的特殊端点
- **查询安全**: 内置的正则表达式清理和参数验证
- **复杂查询**: 聚合管道、`findOne`、`count`、`bulkWrite`、`findOneAnd*`、管道式更新、`arrayFilters`
- **真实 BSON 类型**: 通过 MongoDB Extended JSON 支持 ObjectId、Date、Decimal128 等（`{"$oid": "..."}`）
- **安全控制**: 主机白名单、内网地址拦截、带有效期的用户访问密钥、限流、只读模式、服务端保管连接串（均为可选开启）
- **交互式文档**: Swagger UI 包含完整的端点示例

## 📋 目录

- [快速开始](#快速开始)
- [安装](#安装)
- [配置](#配置)
- [API 端点](#api-端点)
- [架构](#架构)
- [部署](#部署)
- [示例](#示例)
- [贡献](#贡献)

## 🚀 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/DynastyKids/NodeJS-MongoReflector.git
cd NodeJS-MongoReflector
```

### 2. 安装依赖

```bash
npm install
```

### 3. 创建 `.env` 文件（可选）

复制示例文件后按需修改（`.env` 已被 git 忽略）：

```bash
cp .env.example .env
```

所有配置项都是可选的，各项含义见 [配置](#配置)。

### 4. 启动服务器

```bash
npm start
```

服务器将在 `http://localhost:3000` 启动

### 5. 访问 API 文档

- **语言选择**: http://localhost:3000/
- **英文文档**: http://localhost:3000/api/en
- **中文文档**: http://localhost:3000/api/zh_cn

## 📦 安装

### 前提条件

- Node.js 14+
- npm 或 yarn
- MongoDB 实例（Atlas、自托管或本地）

### 安装依赖包

```bash
npm install
```

**依赖项**：
- `express` ^4.21.0 - Web 框架
- `mongodb` ^7.0.0 - 支持 ServerAPI v1 的 MongoDB 驱动
- `cors` ^2.8.5 - 跨域资源共享
- `swagger-ui-express` ^5.0.0 - API 文档 UI

## ⚙️ 配置

### 环境变量

可写在 `.env`（参考 `.env.example`）或部署平台的环境变量中。所有安全相关配置**默认关闭**，已有部署在开启之前行为不变。

| 变量 | 默认值 | 作用 |
|---|---|---|
| `PORT` | `3000` | HTTP 端口 |
| `ALLOW_PUBLIC_USE` | `true` | `false` = 只有 `ALLOWED_KEYPAIRS` 中且 key 未过期的用户能调用 POST 接口。`true` 或不设置 = 任何人都可访问。其他值一律按 `false` 处理 |
| `ALLOWED_KEYPAIRS` | – | 用户与密钥列表，见 [访问密钥](#访问密钥) |
| `ALLOWED_ORIGINS` | –（任意） | 允许从浏览器调用的 CORS 来源，逗号分隔 |
| `RATE_LIMIT_PER_MINUTE` | `0`（关闭） | 每个客户端 IP 每分钟允许的 POST 请求数 |
| `TRUST_PROXY` | – | Express 的 `trust proxy` 值（在 Vercel / Render / Nginx 后面一般设 `1`），让限流拿到真实客户端 IP |
| `READ_ONLY` | `false` | 拒绝所有写入和删除接口 |
| `DEFAULT_MONGO_URI` | – | 请求没带 `mongoURI` 时使用的连接串，数据库凭据不必再放进前端代码 |
| `ALLOW_CLIENT_MONGO_URI` | `true` | 设为 `false` 时拒绝自带 `mongoURI` 的请求（配合 `DEFAULT_MONGO_URI` 使用） |
| `ALLOWED_MONGO_HOSTS` | –（任意） | 请求中 `mongoURI` 允许连接的主机，如 `*.mongodb.net,db.example.com` |
| `BLOCK_PRIVATE_HOSTS` | `false` | 拒绝解析到内网、回环、链路本地或云元数据地址的主机 |
| `ALLOW_UNSAFE_URI_OPTIONS` | `false` | 允许使用服务器本地文件或服务器身份的 URI 参数（`tlsCAFile`、`tlsCertificateKeyFile`、`proxyHost`、`authMechanism=MONGODB-AWS / MONGODB-OIDC / GSSAPI`） |
| `ALLOW_SERVER_SIDE_JS` | `false` | 允许 `$where`、`$function`、`$accumulator` |
| `ALLOW_AGGREGATE_WRITES` | `false` | 允许 `/aggregate` 中使用 `$out` / `$merge` |
| `EJSON_INPUT` | `true` | 转换 Extended JSON 类型包装，如 `{"$oid": "..."}` |
| `MAX_TIME_MS` | `60000` | 读操作的服务端时间上限（`0` = 不限）。客户端传更小的 `options.maxTimeMS` 时以客户端为准 |
| `MAX_FIND_RESPONSE_BYTES` | `33554432` | 列表结果的响应大小上限（32 MB） |
| `MAX_PAGINATE_LENGTH` | `500` | `/paginatefind` 的最大分页大小 |
| `MAX_DISTINCT_VALUES` | `10000` | `/distinct_field` 最多返回的值数量 |
| `BODY_LIMIT` | `1mb` | 请求体大小上限 |
| `SERVER_SELECTION_TIMEOUT_MS` | `10000` | 连接数据库的最长等待时间（URI 中设置了更小的值时以 URI 为准） |
| `MAX_CACHED_CLIENTS` | `50` | 同时保持打开的不同连接串数量上限 |
| `CLIENT_IDLE_TIMEOUT_MS` | `600000` | 缓存连接空闲多久后关闭 |

> 旧版 README 中提到的 `MONGO_URI` 服务器**并不会读取**，请使用 `DEFAULT_MONGO_URI`。

### 访问密钥

设置 `ALLOW_PUBLIC_USE=false` 后，每个 POST 请求都必须带上 `ALLOWED_KEYPAIRS` 中未过期的 key。GET 页面（文档、`/test`）仍然开放。

```bash
ALLOW_PUBLIC_USE=false
ALLOWED_KEYPAIRS=[
    {user:"warehouse_syd",token:"a-long-random-token",expiry:2524651200000},
    {user:"warehouse_mel",token:"another-random-token",expiry:1798761600},
]
```

- `expiry` 是 Unix 时间戳，可以是毫秒或秒（小于 100000000000 的值按秒处理）。每个请求都会检查，key 一到期立即失效。没有有效 `expiry` 或 `token` 少于 8 个字符的条目会被跳过，并在启动时给出警告。
- 在 `.env` 中列表可以跨多行。如果部署平台只支持单行，请使用 JSON：`[{"user":"a","token":"...","expiry":2524651200000}]`。
- 修改 `.env` 后需重启生效。token 不会写入日志；启动日志会显示有效 key 的数量，并提示 7 天内将过期的 key。

客户端在请求头中带上 key，请求体不变：

```javascript
fetch('https://your-reflector.example.com/find', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'a-long-random-token' },
  // 或：'Authorization': 'Bearer a-long-random-token'
  body: JSON.stringify({ mongoURI, dbName: 'shop', collectionName: 'orders', query: {} })
});
```

被拒绝的请求返回 `401`，`message` 为 "API key required..."、"Invalid API key." 或 "API key has expired."。

## 🔌 API 端点

### 健康检查

#### `POST /ping`
验证 MongoDB 连通性

**请求**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "testCollection"
}
```

**响应**：
```json
{
  "acknowledged": true,
  "message": "Cloud connection successful"
}
```

---

### 读取操作

#### `POST /find`
使用可选过滤器查询文档

**请求**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "testCollection",
  "query": { "status": "active" },
  "options": { "projection": { "name": 1, "email": 1 } }
}
```

**响应**：
```json
{
  "acknowledged": true,
  "results": [
    { "_id": "...", "name": "John", "email": "john@example.com" },
    { "_id": "...", "name": "Jane", "email": "jane@example.com" }
  ]
}
```

---

#### `POST /paginatefind`
DataTables 服务器端分页（支持排序、搜索和过滤）

**请求**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "testCollection",
  "query": {},
  "start": 0,
  "length": 10,
  "columns": [
    { "data": "name" },
    { "data": "email" }
  ],
  "order": [{ "column": 0, "dir": "asc" }],
  "search": { "value": "" },
  "draw": 1
}
```

**响应**：
```json
{
  "draw": 1,
  "recordsTotal": 150,
  "recordsFiltered": 150,
  "data": [...]
}
```

---

#### `POST /distinct_field`
获取字段的不同值

**请求**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "testCollection",
  "field_name": "status"
}
```

**响应**：
```json
{
  "acknowledged": true,
  "results": ["active", "inactive", "pending"]
}
```

---

### 写入操作

#### `POST /insert`
插入单个或多个文档

**请求（单个文档）**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "testCollection",
  "documents": {
    "name": "John",
    "email": "john@example.com",
    "age": 30
  }
}
```

**请求（多个文档）**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "testCollection",
  "documents": [
    { "name": "John", "email": "john@example.com" },
    { "name": "Jane", "email": "jane@example.com" }
  ]
}
```

**响应**：
```json
{
  "acknowledged": true,
  "result": {
    "insertedId": "507f1f77bcf86cd799439011"
  }
}
```

---

#### `POST /update`
更新文档（默认启用 upsert）

**请求**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "testCollection",
  "query": { "_id": { "$oid": "507f1f77bcf86cd799439011" } },
  "update": { "$set": { "status": "updated", "modified": true } },
  "options": { "upsert": true }
}
```

**响应**：
```json
{
  "acknowledged": true,
  "matchedCount": 1,
  "modifiedCount": 1,
  "upsertedCount": 0,
  "upsertedId": null
}
```

---

### 删除操作

#### `POST /delete`
删除单个或多个文档

**请求**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "testCollection",
  "query": { "status": "inactive" },
  "multi": true
}
```

**响应**：
```json
{
  "deletedCount": 5,
  "message": "5 document(s) deleted"
}
```

---

### 时间序列操作

#### `POST /insertTimeSeries`
向时间序列集合插入数据

**请求**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "myTimeSeries",
  "timeField": {
    "name": "timestamp",
    "val": "2026-01-18T10:30:00Z"
  },
  "documents": {
    "metadata": { "sensor": "temp_01" },
    "value": 23.5
  }
}
```

---

#### `POST /delete_timeseries`
从时间序列集合中删除（支持时间范围）

**请求**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "myTimeSeries",
  "query": { "metadata.sensor": "temp_01" },
  "timeField": {
    "start": "2026-01-01T00:00:00Z",
    "end": "2026-01-31T23:59:59Z"
  },
  "multi": true
}
```

---

#### `POST /delete_timeseries_legacy`
从时间序列集合中删除（MongoDB 6 兼容 - 逐个删除）

**请求**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "testDB",
  "collectionName": "myTimeSeries",
  "query": { "metadata.sensor": "temp_01" },
  "timeField": {
    "start": "2026-01-01T00:00:00Z",
    "end": "2026-01-31T23:59:59Z"
  }
}
```

**响应**：
```json
{
  "acknowledged": true,
  "deletedCount": 50,
  "failedCount": 0,
  "totalMatched": 50
}
```

---

### 复杂查询

以下接口与上面的接口一样使用 `mongoURI`、`dbName`、`collectionName` 字段，返回 `{ "acknowledged": true, ... }`。

| 接口 | 请求字段 | 响应字段 |
|---|---|---|
| `POST /findOne` | `query`、`options` | `result`（文档或 `null`） |
| `POST /count` | `query`、`options`、`estimated` | `count` |
| `POST /aggregate` | `pipeline`、`options` | `results`、`truncated`、`payloadBytes` 等（同 `/find`） |
| `POST /updateOne` | `query`、`update`、`options` | 同 `/update`，仅当 `options.upsert` 为 `true` 时 upsert |
| `POST /replaceOne` | `query`、`replacement`、`options` | 同 `/update` |
| `POST /findOneAndUpdate` | `query`、`update`、`options` | `result` |
| `POST /findOneAndReplace` | `query`、`replacement`、`options` | `result` |
| `POST /findOneAndDelete` | `query`、`options` | `result` |
| `POST /bulkWrite` | `operations`、`options` | `insertedCount`、`matchedCount`、`modifiedCount`、`deletedCount`、`upsertedCount`、`insertedIds`、`upsertedIds` |

`/update`、`/updateOne`、`/findOneAndUpdate` 的 `update` 也可以是聚合管道（数组），并支持 `options.arrayFilters`。`findOneAnd*` 默认返回修改前的文档，`options.returnDocument` 设为 `"after"` 则返回修改后的文档。

**聚合**：
```json
{
  "mongoURI": "mongodb+srv://user:password@cluster.mongodb.net",
  "dbName": "shop",
  "collectionName": "orders",
  "pipeline": [
    { "$match": { "createdAt": { "$gte": { "$date": "2026-01-01T00:00:00Z" } } } },
    { "$group": { "_id": "$customerId", "total": { "$sum": "$amount" } } },
    { "$lookup": { "from": "customers", "localField": "_id", "foreignField": "_id", "as": "customer" } },
    { "$sort": { "total": -1 } },
    { "$limit": 10 }
  ],
  "options": { "allowDiskUse": true }
}
```

**批量写入**：
```json
{
  "mongoURI": "...", "dbName": "shop", "collectionName": "products",
  "operations": [
    { "insertOne": { "document": { "sku": "A1", "qty": 5 } } },
    { "updateOne": { "filter": { "sku": "B2" }, "update": { "$inc": { "qty": -1 } }, "upsert": true } },
    { "deleteMany": { "filter": { "qty": 0 } } }
  ],
  "options": { "ordered": false }
}
```

#### Extended JSON 类型

JSON 没有 ObjectId 和 Date 类型。用 MongoDB Extended JSON 包装后，服务器会在查询、文档、更新、管道和 options 中自动转换：

```json
{
  "query": {
    "_id": { "$oid": "507f1f77bcf86cd799439011" },
    "createdAt": { "$gte": { "$date": "2026-01-01T00:00:00Z" } },
    "price": { "$lt": { "$numberDecimal": "9.99" } }
  }
}
```

支持：`$oid`、`$date`、`$numberDecimal`、`$numberLong`、`$numberInt`、`$numberDouble`、`$binary`、`$uuid`、`$timestamp`、`$regularExpression`、`$minKey`、`$maxKey`。只有恰好包含其中一个键的对象才会被转换，`$regex` / `$options` 等查询操作符保持原样。

在任意请求中加上 `"responseFormat": "ejson"`，结果会以 Extended JSON 返回（`{"$oid": "..."}`、`{"$date": "..."}`）。不加时响应与以前完全一致（ObjectId 和 Date 为普通字符串）。

#### 正则表达式

`"RegExp(pattern, flags)"` 字符串现在可以出现在查询的任意层级（`$or`、`$and`、`$in` 等内部），且正则中可以包含逗号，如 `"RegExp(^a{1,3}, i)"`。原生 `{ "$regex": "^a", "$options": "i" }` 同样可用。

---

## 🏗️ 架构

```
server.js            路由
lib/config.js        环境变量（最先加载 .env）
lib/mongo-pool.js    共享的 MongoClient 缓存
lib/uri-guard.js     检查客户端传入的连接串
lib/query.js         Extended JSON / RegExp 解析、禁用操作符
lib/errors.js        HTTP 错误、隐藏错误信息中的凭据
```

### 连接池管理

每个连接串对应一个 `MongoClient`，所有读写接口共用。并发请求共享同一次连接；连接失败不会被缓存；空闲超过 `CLIENT_IDLE_TIMEOUT_MS` 的连接会被关闭。最多保留 `MAX_CACHED_CLIENTS` 个，全部繁忙时新的连接串返回 `503`，而不是无限制地打开新连接。

### 错误处理

所有错误都以 JSON 返回：

```json
{ "acknowledged": false, "message": "E11000 duplicate key error ...", "code": 11000, "status": "Server error", "timestamp": "2026-01-18T10:30:00.000Z" }
```

参数错误 → `400`，访问密钥缺失、无效或过期 → `401`，被安全设置拒绝 → `403`，请求过多 → `429`，连接缓存已满 → `503`，数据库错误 → `500`。不会返回堆栈、文件路径或连接串中的密码。

## 🚀 部署

### Vercel 部署

项目包含用于无服务器部署的 `vercel.json`：

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
vercel
```

`vercel.json` 中的配置：
- 使用 `@vercel/node` 构建 `server.js`
- 根据流量自动扩展
- 预配置 CORS 头

### Render 部署

```bash
# 在 render.com 上创建新的 Web 服务
# 连接您的 GitHub 仓库
# 设置启动命令：npm start
# 设置环境：Node
```

### Docker 部署

```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t mongo-reflector .
docker run -p 3000:3000 mongo-reflector
```

## 📚 示例

### JavaScript/前端示例

```javascript
// 查询文档
async function findUsers() {
  const response = await fetch('http://api.example.com/find', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mongoURI: process.env.MONGO_URI,
      dbName: 'myapp',
      collectionName: 'users',
      query: { status: 'active' },
      options: { projection: { email: 1, name: 1 } }
    })
  });
  
  const { results } = await response.json();
  return results;
}

// 插入文档
async function createUser(user) {
  const response = await fetch('http://api.example.com/insert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mongoURI: process.env.MONGO_URI,
      dbName: 'myapp',
      collectionName: 'users',
      documents: user
    })
  });
  
  return response.json();
}
```

### React 示例

```jsx
import { useState } from 'react';

export function UserForm() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleFetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mongoURI: import.meta.env.VITE_MONGO_URI,
          dbName: 'myapp',
          collectionName: 'users'
        })
      });
      const { results } = await response.json();
      setUsers(results);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={handleFetchUsers} disabled={loading}>
        {loading ? '加载中...' : '加载用户'}
      </button>
      <ul>
        {users.map(user => (
          <li key={user._id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
}
```

## 🔒 安全

发送 `mongoURI` 的人本身就持有该数据库的凭据，数据库本身由数据库用户的权限保护。主要风险在于**运行 MongoReflector 的服务器**，以及**放在前端代码里的凭据**。

### 默认开启的防护

- 拒绝使用服务器本地文件或服务器身份的连接串参数：`tlsCAFile`、`tlsCertificateKeyFile`、`proxyHost`、`authMechanism=MONGODB-AWS | MONGODB-OIDC | GSSAPI`。否则调用者可以让服务器读取本地文件，或用服务器的云凭据去登录其他服务。
- 拒绝 `$where`、`$function`、`$accumulator`（在数据库服务器上执行 JavaScript）；`/aggregate` 中拒绝 `$out` / `$merge`。
- 错误中不包含堆栈、文件路径或连接串密码；请求数据不写入日志。
- 限制请求体大小、读操作时间（`MAX_TIME_MS`）和打开的连接数量。

### 公网部署建议

1. **限制主机**：`ALLOWED_MONGO_HOSTS=*.mongodb.net`（至少开启 `BLOCK_PRIVATE_HOSTS=true`）。否则任何人都能借服务器探测其内网主机。
2. **凭据不进前端**：设置 `DEFAULT_MONGO_URI` 和 `ALLOW_CLIENT_MONGO_URI=false`，请求中不再携带 `mongoURI`。请同时设置 `ALLOW_PUBLIC_USE=false`，否则任何人都能使用该数据库。
3. **最小权限的数据库用户**：数据库用户的角色才是真正的访问控制。只授权需要的数据库，能只读就只读（并开启 `READ_ONLY=true`）。
4. **限流与访问密钥**：`RATE_LIMIT_PER_MINUTE` + `TRUST_PROXY`；`ALLOW_PUBLIC_USE=false` 配合 `ALLOWED_KEYPAIRS`（每个用户一个带有效期的 key，可以单独停用某个用户）。放在公开网页里的 key 任何人都能看到，只能挡住随手滥用，挡不住有意攻击。
5. **`ALLOWED_ORIGINS`** 只限制哪些网站能从浏览器调用，挡不住脚本或 curl。
6. 只通过 HTTPS 提供服务。

> 在 Vercel 上，`vercel.json` 也会给每个响应加 CORS 头。设置 `ALLOWED_ORIGINS` 时请同步修改这些头。

已知限制：`BLOCK_PRIVATE_HOSTS` 只在首次建立连接时检查 DNS，DNS 重绑定可以绕过，优先使用 `ALLOWED_MONGO_HOSTS`。限流计数保存在单个服务实例的内存中。

## 🔄 0.3.0 变更

请求格式没有变化。以下响应或行为有变化：

- 错误一律返回 JSON（部分接口以前返回带堆栈的 HTML 页面）。`message` 现在是字符串（以前是序列化后的错误对象），并附带 `code` / `codeName`。参数错误返回 `400` 而不是 `500`。
- 除非设置 `ALLOW_SERVER_SIDE_JS=true`，否则拒绝 `$where` / `$function` / `$accumulator`。
- 除非设置 `ALLOW_UNSAFE_URI_OPTIONS=true`，否则拒绝使用服务器文件或服务器身份的连接串。
- `/paginatefind`：搜索时保留 `query` 中的 `$or`（以前会被覆盖）；不是合法正则的搜索词按普通文本匹配（以前返回 `500`）；`length: -1` 返回最大分页（以前只返回 1 条）；会使用所有 `order` 项。
- `/delete`、`/deleteTimeseries`：`multi: "false"` / `"0"` 现在表示 false（以前任何非空字符串都算 true）；`query` 必须是对象。
- `/deleteTimeseries` 使用 `timeField.name`（以前固定为 `timestamp`，现在仍是默认值）。`/deleteTimeseries_legacy` 现在会应用 `timeField` 时间范围（以前被忽略）。
- `/insertTimeSeries`：`timeField` 可选，`documents` 可以是数组，缺少 `timeField.val` 时使用当前时间。
- `/datatables_paginatefind`、`/timeseries_insert`、`/timeseries_delete` 直接处理请求，不再返回 307 重定向。README 中提到的 `/delete_timeseries`、`/delete_timeseries_legacy` 现在可用。
- `"RegExp(...)"` 字符串在查询任意层级都会转换（以前只转换顶层字段）。
- 读操作不再使用 Stable API *strict* 模式（只会减少报错），并有 60 秒上限（`MAX_TIME_MS`）。
- 写操作复用缓存连接；连接数据库最多等待 10 秒（以前写操作为 30 秒）。
- `.env` 中的 `MAX_*` 配置现在会生效（以前在加载 `.env` 之前就读取了）。

## 🐛 故障排除

### 连接超时

```
Error: Server selection timed out after 5000ms
```

**解决方案**：
- 验证 MongoDB 连接字符串是否正确
- 检查防火墙是否允许出站连接
- 验证 MongoDB Atlas 中的 IP 白名单

### 模块未找到

```
Error: Cannot find module 'mongodb'
```

**解决方案**：
```bash
npm install
```

### 端口已被使用

```
Error: listen EADDRINUSE: address already in use :::3000
```

**解决方案**：
```bash
# 关闭使用端口 3000 的进程
lsof -ti:3000 | xargs kill -9
# 或更改端口
PORT=3001 npm start
```

## 📖 文档

- **Swagger UI**: http://localhost:3000/api/en
- **中文文档**: http://localhost:3000/api/zh_cn
- **GitHub**: https://github.com/DynastyKids/NodeJS-MongoReflector

## 🤝 贡献

欢迎贡献！请按以下步骤操作：

1. Fork 仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

## 📄 许可证

此项目采用 Apache License 2.0 许可证 - 有关详细信息，请参阅 LICENSE 文件。

## 🙏 致谢

- [Express.js](http://expressjs.com/) - Web 框架
- [MongoDB Node.js 驱动](https://docs.mongodb.com/drivers/node/) - 数据库驱动
- [Swagger UI](https://swagger.io/tools/swagger-ui/) - API 文档
- [Vercel](https://vercel.com/) - 部署平台

## 📞 支持

如有问题、疑问或建议：
- 开启 [Issue](https://github.com/DynastyKids/NodeJS-MongoReflector/issues)
- 查看 [讨论](https://github.com/DynastyKids/NodeJS-MongoReflector/discussions)
- 邮箱：support@example.com

---

**最后更新**: 2026 年 1 月 18 日  
**版本**: 1.0.1
