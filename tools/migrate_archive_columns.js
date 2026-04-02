const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const rootDir = path.resolve(__dirname, '..');
const envLocalPath = path.join(rootDir, '.env.local');
const envPath = path.join(rootDir, '.env');

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const dbPort = Number.parseInt(process.env.DB_PORT || process.env.MYSQL_PORT || '3306', 10);

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number.isInteger(dbPort) ? dbPort : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cite_es',
};

const columnsToEnsure = [
  { table: 'courses', ddl: 'ALTER TABLE courses ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0' },
  { table: 'evaluations', ddl: 'ALTER TABLE evaluations ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0' },
  { table: 'comments', ddl: 'ALTER TABLE comments ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0' },
  { table: 'academic_periods', ddl: 'ALTER TABLE academic_periods ADD COLUMN is_archived TINYINT(1) NOT NULL DEFAULT 0' },
];

async function columnExists(conn, dbName, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [dbName, table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function run() {
  const connection = await mysql.createConnection(config);
  try {
    console.log(`Connected to MySQL at ${config.host}:${config.port} (${config.database})`);

    for (const item of columnsToEnsure) {
      const exists = await columnExists(connection, config.database, item.table, 'is_archived');
      if (!exists) {
        await connection.execute(item.ddl);
        console.log(`Added ${item.table}.is_archived`);
      } else {
        console.log(`Exists ${item.table}.is_archived`);
      }

      await connection.execute(
        `UPDATE ${item.table} SET is_archived = 0 WHERE is_archived IS NULL`
      );
    }

    console.log('Archive columns migration complete.');
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error('Archive columns migration failed:', error.message || error);
  process.exit(1);
});
