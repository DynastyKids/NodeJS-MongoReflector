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

### 3. 启动服务器

```bash
npm start
```

服务器将在 `http://localhost:3000` 启动

### 4. 访问 API 文档

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

```bash
# 端口配置（默认：3000）
PORT=3000

# 可选：自定义 MongoDB 连接（用于部署）
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net
```

### 服务器配置

服务器自动配置 MongoDB 连接：

```javascript
{
  maxPoolSize: 10,                    // 连接池大小
  serverSelectionTimeoutMS: 5000,     // 连接超时
  serverApi: ServerApiVersion.v1,     // 强制 API 版本
  strict: true,
  deprecationErrors: true
}
```

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
  "query": { "_id": "507f1f77bcf86cd799439011" },
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

## 🏗️ 架构

### 连接池管理

服务器使用 `Map` 在内存中缓存 MongoDB 连接，避免重连开销：

```javascript
const clientCache = new Map();

async function getMongoCollection(mongoURI, dbName, collectionName) {
  if (clientCache.has(mongoURI)) {
    client = clientCache.get(mongoURI);
  } else {
    client = new MongoClient(mongoURI, { /* 配置 */ });
    await client.connect();
    clientCache.set(mongoURI, client);
  }
  return client.db(dbName).collection(collectionName);
}
```

### 查询安全

内置查询清理功能，将正则表达式字符串转换为真正的对象：

```javascript
function sanitizeQuery(query) {
  // 将 "RegExp(...)" 字符串转换为 RegExp 对象
  for (const key in safe) {
    if (typeof safe[key] === 'string' && safe[key].startsWith('RegExp(')) {
      const match = safe[key].match(/^RegExp\((.*)\)$/);
      if (match) {
        const [pattern, flags] = match[1].split(',').map(s => s.trim());
        safe[key] = new RegExp(pattern, flags || '');
      }
    }
  }
  return safe;
}
```

### 错误处理

使用装饰器模式的全局异步错误处理：

```javascript
const asyncHandler = fn => (req, res, next) => 
  Promise.resolve(fn(req, res, next)).catch(next);

app.use((err, req, res, next) => {
  console.error("API Error:", err);
  res.status(500).json({
    acknowledged: false,
    message: err.message
  });
});
```

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

## 🔒 安全考虑

> ⚠️ **警告**：此 API 设计用于**开发和内部使用**。未经身份验证和授权，请勿将其暴露于公网。

### 建议

1. **身份验证**: 在生产环境中添加 JWT 或 OAuth2 中间件
2. **速率限制**: 实施请求速率限制
3. **验证**: 添加 MongoDB 查询参数验证
4. **防火墙**: 通过 IP 白名单限制 MongoDB 访问
5. **HTTPS**: 在生产环境中始终使用 HTTPS
6. **环境变量**: 不要硬编码 MongoDB 凭据

### 使用身份验证中间件的示例

```javascript
const jwt = require('jsonwebtoken');

app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/api') {
    return next();
  }
  
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ message: 'Invalid token' });
  }
});
```

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
