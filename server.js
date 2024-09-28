const express = require('express');
const { MongoClient } = require('mongodb');
const os = require('os');
const cors = require('cors')
const path = require('path');

const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./api/swagger.json');

const app = express();
var port = 3000;

app.use(express.json());
app.use(cors());

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
app.get('/', (req, res) => {
    res.redirect('/api');
});

// API to find data
app.post('/find', async (req, res) => {
    const { mongoURI, dbName, collectionName, query, options} = req.body;

    if (!mongoURI || !dbName || !collectionName) {
        return res.status(400).json({ message: "Please provide mongoURI, dbName, and collectionName." });
    }

    try {
        const client = new MongoClient(mongoURI, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });
        await client.connect();

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        query = (typeof(query) === "object") ? query : {}
        options = (typeof(options) === "object") ? options : {}

        let data = await collection.find(query, options);
        await client.close()

        res.json({
            results: data,
        });
    } catch (err) {
        res.status(500).json({ 
            status: 'Server error',
            message: err
        });
    }
});

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

// API to update data
app.post('/update', async (req, res) => {
    const { mongoURI, dbName, collectionName, query, update, upsert = false, multi = false } = req.body;

    if (!mongoURI || !dbName || !collectionName || !query || !update) {
        return res.status(400).json({ message: "Please provide mongoURI, dbName, collectionName, query, and update." });
    }

    try {
        const client = new MongoClient(mongoURI,{
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });
        await client.connect();

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        let result;

        if (multi) {
            result = await collection.updateMany(query, update, { upsert });
        } else {
            result = await collection.updateOne(query, update, { upsert });
        }
        await client.close()
        res.json({
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            upsertedCount: result.upsertedCount || 0,
            upsertedId: result.upsertedId || null,
            message: 'Update operation successful'
        });
    } catch (err) {
        res.status(500).json({ 
            status: 'Server error',
            message: err
        });
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

    try {
        const client = new MongoClient(mongoURI,{
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            }
        });
        await client.connect();

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        let result;

        if (multi) {
            result = await collection.deleteMany(query);
        } else {
            result = await collection.deleteOne(query);
        }
        await client.close()
        res.json({
            deletedCount: result.deletedCount,
            message: `Delete operation successful, deleted ${result.deletedCount} record(s)`
        });
    } catch (err) {
        res.status(500).json({ 
            status: 'Server error',
            message: err
        });
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