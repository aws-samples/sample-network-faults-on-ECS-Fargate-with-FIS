import express, { Request, Response, NextFunction } from 'express';
import { CloudWatch } from '@aws-sdk/client-cloudwatch';
import { Connection, RowDataPacket, createConnection } from 'mysql2/promise';
import { MONITORING_CONSTANTS } from './shared-app-const';

const app = express();
const port: number = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const cloudwatch = new CloudWatch();

// Add middleware to parse JSON bodies
app.use(express.json());

// Database configuration
interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

// Set default values for required configuration
const dbConfig: DbConfig = {
  host: process.env.DATABASE_HOST || 'localhost',
  port: process.env.DATABASE_PORT ? parseInt(process.env.DATABASE_PORT) : 3306,
  user: process.env.DATABASE_USER || 'root',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME || 'demo'
};

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Database initialization
async function initializeDatabase() {
  let connection: Connection;
  try {
    connection = await createConnection(dbConfig);
    
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        price DECIMAL(10,2)
      )
    `;
    
    await connection.execute(createTableQuery);

    // Truncate the table to start fresh
    await connection.execute('TRUNCATE TABLE items');

    console.log('Database table initialized successfully');
    await connection.end();
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

// Health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  try {
    const connection: Connection = await createConnection(dbConfig);
    await connection.ping();
    await connection.end();
    res.status(200).json({ status: 'healthy' });
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({ status: 'unhealthy', error: error.message });
    } else {
      res.status(500).json({ status: 'unhealthy', error: 'An unknown error occurred' });
    }
  }
});

// Define Item interface
interface Item extends RowDataPacket {
  id: number;
  name: string;
  description: string;
  category: string;
  price: number;
}

// GET all items
app.get('/api/items', asyncHandler(async (req: Request, res: Response) => {
  const connection: Connection = await createConnection(dbConfig);
  const startTime = Date.now();
  const [rows] = await connection.execute<Item[]>('SELECT * FROM items');
  await connection.end();
  const endTime = Date.now();
  const latency = endTime - startTime;
  await sendMetricToCloudWatch('SELECT', latency);
  res.json(rows);
}));

// POST new item
app.post('/api/items', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, category, price } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  const connection: Connection = await createConnection(dbConfig);
  const startTime = Date.now();
  const [result] = await connection.execute(
    'INSERT INTO items (name, description, category, price) VALUES (?, ?, ?, ?)',
    [name, description, category, price]
  );
  await connection.end();
  
  const endTime = Date.now();
  const latency = endTime - startTime;
  await sendMetricToCloudWatch('INSERT', latency);

  res.status(201).json({
    message: 'Item created successfully',
    id: (result as any).insertId
  });
}));

// DELETE item
app.delete('/api/items/:id', asyncHandler(async (req: Request, res: Response) => {
  const connection: Connection = await createConnection(dbConfig);
  const startTime = Date.now();
  const [result] = await connection.execute(
    'DELETE FROM items WHERE id = ?',
    [req.params.id]
  );
  await connection.end();

  const endTime = Date.now();
  const latency = endTime - startTime;
  await sendMetricToCloudWatch('DELETE', latency);

  if ((result as any).affectedRows === 0) {
    res.status(404).json({ error: 'Item not found' });
  } else {
    res.json({ message: 'Item deleted successfully' });
  }
}));

// Update item
app.put('/api/items/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, category, price } = req.body;
  
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  const connection: Connection = await createConnection(dbConfig);
  const startTime = Date.now();
  const [result] = await connection.execute(
    'UPDATE items SET name = ?, description = ?, category = ?, price = ? WHERE id = ?',
    [name, description, category, price, req.params.id]
  );
  await connection.end();

  const endTime = Date.now();
  const latency = endTime - startTime;
  await sendMetricToCloudWatch('UPDATE', latency);

  if ((result as any).affectedRows === 0) {
    res.status(404).json({ error: 'Item not found' });
  } else {
    res.json({ message: 'Item updated successfully' });
  }
}));
// Call initialization before starting the server
app.listen(port, async () => {
  try {
    await initializeDatabase();
    console.log(`Server running on port ${port}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
});

async function sendMetricToCloudWatch(queryType: string, value: number) {
  try {
    await cloudwatch.putMetricData({
      MetricData: [{
        MetricName: MONITORING_CONSTANTS.METRICS.DATABASE_QUERY_LATENCY,
        Value: value,
        Unit: 'Milliseconds',
        Dimensions: [
          {
            Name: MONITORING_CONSTANTS.DIMENSIONS.SERVICE_NAME,
            Value: MONITORING_CONSTANTS.DIMENSIONS.SERVICE_VALUE
          },
          {
            Name: MONITORING_CONSTANTS.DIMENSIONS.QUERY_TYPE,
            Value: queryType
          }
        ]
      }],
      Namespace: MONITORING_CONSTANTS.NAMESPACE
    });
  } catch (error) {
    console.error('Failed to send metric to CloudWatch:', error);
  }
}
