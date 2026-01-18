const express = require('express');
const { MongoClient, Timestamp, ServerApiVersion, Decimal128 } = require('mongodb');
const os = require('os');
const cors = require('cors')
const path = require('path');

const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./api/swagger.json');
const swaggerDocumentZh = require('./api/swagger.zh_cn.json');
// const fs = require('fs');
// const swaggerDocument = JSON.parse(fs.readFileSync('./api/swagger.json', 'utf8'));
// const swaggerDocumentZh = JSON.parse(fs.readFileSync('./api/swagger.zh_cn.json', 'utf8'));

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
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>API文档 / API Documentation</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: sans-serif; padding: 40px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                h1 { color: #333; text-align: center; margin-bottom: 30px; }
                .selector { display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
                .lang-btn { padding: 15px 30px; font-size: 16px; border: 2px solid #4CAF50; background: white; color: #4CAF50; border-radius: 5px; cursor: pointer; text-decoration: none; transition: all 0.3s; font-weight: bold; }
                .lang-btn:hover { background: #4CAF50; color: white; }
                .info { margin-top: 30px; padding: 15px; background: #f0f0f0; border-left: 4px solid #4CAF50; border-radius: 4px; }
                .info p { margin: 8px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Mongo Reflector</h1>
                <h1>🌐 API Documentation Language / 选择语言 : </h1>
                <div class="selector">
                    <a href="/api/zh_cn" class="lang-btn">中文 🇨🇳</a>
                    <a href="/api/en" class="lang-btn">English 🇬🇧</a>
                </div>
            </div>
        </body>
        </html>
    `);
});
app.get('/api', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>API文档 / API Documentation</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: sans-serif; padding: 40px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                h1 { color: #333; text-align: center; margin-bottom: 30px; }
                .selector { display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
                .lang-btn { padding: 15px 30px; font-size: 16px; border: 2px solid #4CAF50; background: white; color: #4CAF50; border-radius: 5px; cursor: pointer; text-decoration: none; transition: all 0.3s; font-weight: bold; }
                .lang-btn:hover { background: #4CAF50; color: white; }
                .info { margin-top: 30px; padding: 15px; background: #f0f0f0; border-left: 4px solid #4CAF50; border-radius: 4px; }
                .info p { margin: 8px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Mongo Reflector</h1>
                <h1>🌐 API Documentation Language / 选择语言 : </h1>
                <div class="selector">
                    <a href="/api/zh_cn" class="lang-btn">中文 🇨🇳</a>
                    <a href="/api/en" class="lang-btn">English 🇬🇧</a>
                </div>
            </div>
        </body>
        </html>
    `);
});
// app.use("/api/en", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
// app.use("/api/zh_cn", swaggerUi.serve, swaggerUi.setup(swaggerDocumentZh));
app.use("/api/en", swaggerUi.serve, (req, res) => {
    swaggerUi.setup(swaggerDocument, {
        explorer: true,
        customSiteTitle: "MongoReflector API Documentation"
    })(req, res);
});

app.use("/api/zh_cn", swaggerUi.serve, (req, res) => {
    swaggerUi.setup(swaggerDocumentZh, {
        explorer: true,
        customSiteTitle: "MongoReflector 文档"
    })(req, res);
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

// API to delete data from TimeSeries collection
app.post('/deleteTimeseries', async (req, res) => {
    const { mongoURI, dbName, collectionName, query, metaField, timeField, multi = false } = req.body;

    if (!mongoURI || !dbName || !collectionName || !query) {
        return res.status(400).json({
            acknowledged: false,
            message: "Please provide mongoURI, dbName, collectionName, and query."
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
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        
        // Build filter with time range if timeField is provided
        let filter = { ...query };
        if (timeField && (timeField.start || timeField.end)) {
            filter.timestamp = {};
            if (timeField.start) {
                filter.timestamp.$gte = new Date(timeField.start);
            }
            if (timeField.end) {
                filter.timestamp.$lte = new Date(timeField.end);
            }
        }

        console.log('TimeSeries delete filter:', filter);
        let result;

        if (multi) {
            result = await collection.deleteMany(filter);
        } else {
            result = await collection.deleteOne(filter);
        }

        res.json({
            acknowledged: true,
            deletedCount: result.deletedCount,
            message: `Delete operation successful, deleted ${result.deletedCount} record(s) from TimeSeries collection`
        });
    } catch (err) {
        console.error('Error deleting TimeSeries data:', err);
        res.status(500).json({
            acknowledged: false,
            status: 'Server error',
            message: err.message || err
        });
    } finally {
        await client.close();
    }
});

// API to delete data from TimeSeries collection (Legacy - MongoDB 6 compatible)
// Deletes documents one by one using deleteOne for better compatibility
app.post('/deleteTimeseries_legacy', async (req, res) => {
    const { mongoURI, dbName, collectionName, query, timeField } = req.body;

    if (!mongoURI || !dbName || !collectionName || !query) {
        return res.status(400).json({
            acknowledged: false,
            message: "Please provide mongoURI, dbName, collectionName, and query."
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
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        
        // Build filter with time range if timeField is provided
        let filter = { ...query };
        if (timeField && (timeField.start || timeField.end)) {
            filter.timestamp = {};
            if (timeField.start) {
                filter.timestamp.$gte = new Date(timeField.start);
            }
            if (timeField.end) {
                filter.timestamp.$lte = new Date(timeField.end);
            }
        }

        console.log('TimeSeries legacy delete filter:', filter);
        
        // Find all matching documents first
        const documentsToDelete = await collection.find(filter).toArray();
        const totalCount = documentsToDelete.length;
        let deletedCount = 0;
        let failedCount = 0;

        // Delete one by one for better compatibility with older MongoDB versions
        for (const doc of documentsToDelete) {
            try {
                const result = await collection.deleteOne({ _id: doc._id });
                if (result.deletedCount > 0) {
                    deletedCount++;
                }
            } catch (deleteErr) {
                console.error(`Failed to delete document ${doc._id}:`, deleteErr);
                failedCount++;
            }
        }

        res.json({
            acknowledged: true,
            deletedCount: deletedCount,
            failedCount: failedCount,
            totalMatched: totalCount,
            message: `Legacy delete operation successful, deleted ${deletedCount}/${totalCount} record(s) from TimeSeries collection${failedCount > 0 ? `, ${failedCount} failed` : ''}`
        });
    } catch (err) {
        console.error('Error deleting TimeSeries data (legacy):', err);
        res.status(500).json({
            acknowledged: false,
            status: 'Server error',
            message: err.message || err
        });
    } finally {
        await client.close();
    }
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
