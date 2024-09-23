const express = require('express');
const { MongoClient } = require('mongodb');
const os = require('os');

const app = express();
const port = 3000;

app.use(express.json());

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

// API to retrieve data
app.post('/getData', async (req, res) => {
    const { mongoURI, dbName, collectionName, query, page = 1, pageSize = 10 } = req.body;

    if (!mongoURI || !dbName || !collectionName) {
        return res.status(400).json({ message: "Please provide mongoURI, dbName, and collectionName." });
    }

    try {
        const client = new MongoClient(mongoURI);
        await client.connect();

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        const filter = query || {};
        const skip = (page - 1) * pageSize;
        const limit = pageSize;
        const totalRecords = await collection.countDocuments(filter);
        const data = await collection.find(filter).skip(skip).limit(limit).toArray();

        res.json({
            data,
            meta: {
                totalRecords,
                currentPage: page,
                pageSize,
                totalPages: Math.ceil(totalRecords / pageSize)
            }
        });
    } catch (err) {
        console.error('Error querying data:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Example for retrieving data API
app.get('/getData', (req, res) => {
    const example = {
        description: "Example request to retrieve data from MongoDB",
        method: "POST",
        url: "/getData",
        requestBody: {
            mongoURI: "mongodb://your-mongo-uri",
            dbName: "your-database-name",
            collectionName: "your-collection-name",
            query: {
                field: "value"
            },
            page: 1,
            pageSize: 10
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
        const client = new MongoClient(mongoURI);
        await client.connect();

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        let result;

        if (multi) {
            result = await collection.updateMany(query, update, { upsert });
        } else {
            result = await collection.updateOne(query, update, { upsert });
        }

        res.json({
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            upsertedCount: result.upsertedCount || 0,
            upsertedId: result.upsertedId || null,
            message: 'Update operation successful'
        });
    } catch (err) {
        console.error('Error updating data:', err);
        res.status(500).json({ message: 'Server error' });
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
        const client = new MongoClient(mongoURI);
        await client.connect();

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        let result;

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
        console.error('Error deleting data:', err);
        res.status(500).json({ message: 'Server error' });
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
app.listen(port, () => {
    const ipAddress = getLocalIPAddress();
    console.log(`API server running at http://${ipAddress}:${port}`);
});
