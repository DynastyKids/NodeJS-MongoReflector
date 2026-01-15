const express = require('express');
const { MongoClient, Timestamp, ServerApiVersion, Decimal128 } = require('mongodb');
const os = require('os');
const cors = require('cors')
const path = require('path');

const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./api/swagger.json');

const app = express();
var port = process.env.PORT || 3000;

// --- 1. 连接池管理 (改进点1) ---
// 在内存中缓存连接，避免每个请求都进行三次握手
const clientCache = new Map();

async function getMongoCollection(mongoURI, dbName, collectionName) {
    let client;
    if (clientCache.has(mongoURI)) {
        client = clientCache.get(mongoURI);
    } else {
        client = new MongoClient(mongoURI, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
            maxPoolSize: 10, // 2026 云端推荐：限制连接池大小
            serverSelectionTimeoutMS: 5000
        });
        await client.connect();
        clientCache.set(mongoURI, client);
    }
    return client.db(dbName).collection(collectionName);
}

app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

// 异步错误处理装饰器 (改进点3)
const asyncHandler = fn => (req, res, next) => 
    Promise.resolve(fn(req, res, next)).catch(next);

// 安全清理查询条件 (改进点2)
function sanitizeQuery(query) {
    if (!query || typeof query !== 'object') return {};
    const safe = { ...query };
    // 转换正则字符串为真正的 RegExp 对象
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


// Get local IP address
function getLocalIPAddress() {
    const interfaces = os.networkInterfaces();
    for (const interfaceName in interfaces) {
        const iface = interfaces[interfaceName];
        for (const alias of iface) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '127.0.0.1'; // Return localhost if unable to get IP
}

// Home page refer to Swagger UI Interface
app.use(express.static(path.join(__dirname, 'node_modules/swagger-ui-dist')));
app.use("/api", swaggerUi.serve, swaggerUi.setup(swaggerDocument))
app.get("/api", swaggerUi.setup(swaggerDocument))
app.get('/', (req, res) => {
    res.redirect('/api');
});

// --- 4. 错误处理与启动 ---
// 全局异常捕获中间件 (改进点3)
app.use((err, req, res, next) => {
    console.error("Cloud API Error:", err);
    res.status(500).json({
        acknowledged: false,
        message: err.message || "Internal Server Error",
        timestamp: new Date().toISOString()
    });
});

// Ping 接口 - 检查连通性
app.post('/ping', asyncHandler(async (req, res) => {
    const { mongoURI, dbName, collectionName } = req.body;
    if (!mongoURI || !dbName || !collectionName) {
        return res.status(400).json({ acknowledged: false, message: "Missing params" });
    }
    
    const client = new MongoClient(mongoURI); // Ping 操作建议短连接
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    await client.close();
    
    res.json({ acknowledged: true, message: "Cloud connection successful" });
}));

app.get('/find', (req, res) => {
    const example = {
        description: "Example request to find data from MongoDB. If 'page' and 'pageSize' are not provided, all matching data will be returned.",
        method: "POST",
        url: "/find",
        requestBody: {
            mongoURI: "mongodb://localhost:27017 [string, Mandatory]",
            dbName: "testDB [string, Mandatory]",
            collectionName: "testCollection [string, Mandatory]",
            query: {
                field: "value [string, Mandatory]"
            },

            page: "1 [int, Optional]",
            pageSize: "10  [int, Optional]"
        }
    };
    res.json(example);
});

// Find 接口 - 核心查询逻辑
app.post('/find', asyncHandler(async (req, res) => {
    const { mongoURI, dbName, collectionName, query, options } = req.body;
    
    const collection = await getMongoCollection(mongoURI, dbName, collectionName);
    const safeQuery = sanitizeQuery(query);
    const data = await collection.find(safeQuery, options || {}).toArray();
    
    res.json({ acknowledged: true, results: data });
}));

// DataTables 分页查询
app.post('/paginatefind', asyncHandler(async (req, res) => {
    let { mongoURI, dbName, collectionName, query, start, length, order, search, columns } = req.body;
    const collection = await getMongoCollection(mongoURI, dbName, collectionName);
    const skip = parseInt(start) || 0;
    const limit = parseInt(length) || 10;
    let filter = sanitizeQuery(query);

    // 处理全局搜索
    if (search?.value) {
        const searchRegex = new RegExp(search.value, 'i');
        filter["$or"] = columns.filter(c => c.data).map(c => ({ [c.data]: searchRegex }));
    }

    // 处理排序
    let sort = {};
    if (order && order.length > 0 && columns) {
        const colIdx = order[0].column;
        const colName = columns[colIdx].data;
        sort[colName] = order[0].dir === 'asc' ? 1 : -1;
    }

    const [data, total, filteredTotal] = await Promise.all([
        collection.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
        collection.countDocuments({}),
        collection.countDocuments(filter)
    ]);

    res.json({
        draw: parseInt(req.body.draw) || 1,
        recordsTotal: total,
        recordsFiltered: filteredTotal,
        data: data
    });
}));

// Distinct 接口 Gemini3 Testing
app.post('/distinct_field', asyncHandler(async (req, res) => {
    const { mongoURI, dbName, collectionName, field_name } = req.body;
    const collection = await getMongoCollection(mongoURI, dbName, collectionName);
    const result = await collection.distinct(field_name);
    res.json({ acknowledged: true, results: result });
}));

app.post('/insertTimeSeries', async (req, res) => {
    let { mongoURI, dbName, collectionName, timeField, documents, options } = req.body;
    if (!mongoURI || !dbName || !collectionName || !documents) {
        return res.status(400).json({
            acknowledged: false,
            message: "Please provide mongoURI, dbName, collectionName, timeField, documents and options(not mandatory)."
        });
    }

    const client = new MongoClient(mongoURI, {
        serverApi: {
            version: ServerApiVersion.v1,
            useNewUrlParser: true,
            useUnifiedTopology: true,
        }
    })
    try {
        await client.connect()
        const collection = client.db(dbName).collection(collectionName)

        documents[`${timeField.name}`] = new Date(timeField.val)
        console.log(documents)
        let result = await collection.insertOne(documents, options);

        res.json({
            acknowledged: true,
            result: result
        });
    } catch (err) {
        console.error('Error inserting data:', err);
        res.status(500).json({
            acknowledged: false,
            status: 'Server error',
            message: err
        });
    } finally {
        await client.close()
    }
});

app.post('/insert', async (req, res) => {
    let { mongoURI, dbName, collectionName, documents, options } = req.body;
    if (!mongoURI || !dbName || !collectionName || !documents) {
        return res.status(400).json({
            acknowledged: false,
            message: "Please provide mongoURI, dbName, collectionName, documents and options(not mandatory)."
        });
    }

    const client = new MongoClient(mongoURI, {
        serverApi: {
            version: ServerApiVersion.v1,
            useNewUrlParser: true,
            useUnifiedTopology: true,
        }
    });

    try {
        await client.connect()
        const collection = client.db(dbName).collection(collectionName)
        let result

        if (Array.isArray(documents)) {
            result = await collection.insertMany(documents, options);
        } else {
            result = await collection.insertOne(documents, options);
        }

        res.json({
            acknowledged: true,
            result: result
        });
    } catch (err) {
        console.error('Error inserting data:', err);
        res.status(500).json({
            acknowledged: false,
            status: 'Server error',
            message: err
        });
    } finally {
        await client.close()
    }
});


app.get('/insert', (req, res) => {
    const example = {
        description: "Example request to insert multiple data from MongoDB.",
        method: "POST",
        url: "/find",
        requestBody: {
            mongoURI: "mongodb://localhost:27017 [string, Mandatory]",
            dbName: "testDB [string, Mandatory]",
            collectionName: "testCollection [string, Mandatory]",
            documents: ["values"],
            options: {
                field: "values"
            }
        }
    };
    res.json(example);
});

// API to update data
app.post('/update', async (req, res) => {
    const { mongoURI, dbName, collectionName, query, update, options } = req.body;

    if (!mongoURI || !dbName || !collectionName || !query || !update) {
        return res.status(400).json({
            acknowledged: false,
            message: "Please provide mongoURI, dbName, collectionName, query, and update."
        });
    }

    const client = new MongoClient(mongoURI, {
        serverApi: {
            version: ServerApiVersion.v1,
            useNewUrlParser: true,
            useUnifiedTopology: true,
        }
    });

    try {
        await client.connect()
        const db = client.db(dbName)
        const collection = db.collection(collectionName)
        console.log(query, update)

        let result = await collection.updateMany(query, update, (options === {} ? { "upsert": true } : options));

        res.json({
            acknowledged: true,
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            upsertedCount: result.upsertedCount || 0,
            upsertedId: result.upsertedId || null,
            message: 'Update operation successful'
        });
    } catch (err) {
        console.log(err)
        res.status(500).json({
            acknowledged: false,
            message: err
        });
    } finally {
        await client.close()
    }
});

// Example for update data API
app.get('/update', (req, res) => {
    const example = {
        description: "Example request to update data in MongoDB",
        method: "POST",
        url: "/update",
        requestBody: {
            mongoURI: "mongodb://your-mongo-uri",
            dbName: "your-database-name",
            collectionName: "your-collection-name",
            query: {
                field: "value"
            },
            update: {
                "$set": { "fieldToUpdate": "newValue" }
            },
            upsert: true,
            multi: false
        }
    };
    res.json(example);
});

// API to delete data
app.post('/delete', async (req, res) => {
    const { mongoURI, dbName, collectionName, query, multi = false } = req.body;

    if (!mongoURI || !dbName || !collectionName || !query) {
        return res.status(400).json({ message: "Please provide mongoURI, dbName, collectionName, and query." });
    }

    const client = new MongoClient(mongoURI, {
        serverApi: {
            version: ServerApiVersion.v1,
            useNewUrlParser: true,
            useUnifiedTopology: true,
        }
    });

    try {
        await client.connect()
        const db = client.db(dbName)
        const collection = db.collection(collectionName)
        let result

        if (multi) {
            result = await collection.deleteMany(query);
        } else {
            result = await collection.deleteOne(query);
        }

        res.json({
            deletedCount: result.deletedCount,
            message: `Delete operation successful, deleted ${result.deletedCount} record(s)`
        });
    } catch (err) {
        res.status(500).json({
            status: 'Server error',
            message: err
        });
    } finally {
        await client.close()
    }
});

// Example for delete data API
app.get('/delete', (req, res) => {
    const example = {
        description: "Example request to delete data from MongoDB",
        method: "POST",
        url: "/delete",
        requestBody: {
            mongoURI: "mongodb://your-mongo-uri",
            dbName: "your-database-name",
            collectionName: "your-collection-name",
            query: {
                field: "value"
            },
            multi: false
        }
    };
    res.json(example);
});

// Start server
const server = app.listen(port, () => {
    const ipAddress = getLocalIPAddress();
    console.log(`API server running at http://${ipAddress}:${port}`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is in use, trying another port...`);
        // Automatically try the next available port
        const newServer = app.listen(0, () => {
            const newPort = newServer.address().port;
            console.log(`API server running at http://localhost:${newPort}`);
        });
    } else {
        console.error(`Server error: ${err.message}`);
    }
});
