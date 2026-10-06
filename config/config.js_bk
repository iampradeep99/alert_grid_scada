require('dotenv').config()

module.exports = {
  development: {
    port: process.env.DB_PORT,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.RDS_NAME,
    host: process.env.DB_HOSTNAME,
    dialect: 'mysql'
  },
  test: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.RDS_NAME,
    host: process.env.DB_HOSTNAME,
    dialect: 'mysql'
  },
  production: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.RDS_NAME,
    host: process.env.DB_HOSTNAME,
    dialect: 'mysql'
  }
}
