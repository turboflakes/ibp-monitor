'use strict'

const GOSSIP_PORT = process.env.GOSSIP_PORT || 30000 // 0 for development/debugging, 30000 for deployment
const HTTP_PORT = process.env.HTTP_PORT || 30001
const API_PORT = process.env.API_PORT || 30002

// you can overwrite this in config.local.js

const config = {
  dateTimeFormat: 'DD/MM/YYYY HH:mm',
  sequelize: {
    database: 'ibp_monitor',
    username: 'ibp_monitor',
    password: 'ibp_monitor',
    options: {
      dialect: 'mariadb',
      // hostname = docker service name
      host: 'ibp-datastore',
      port: 3306,
      logging: false,
    },
  },
  redis: {
    // hostname = docker service name
    host: 'ibp-redis',
    port: 6379,
    username: "",
    password: 'ibp_redis_password',
    maxRetriesPerRequest: null,
  },
  httpPort: HTTP_PORT,
  listenPort: GOSSIP_PORT,
  apiPort: API_PORT,
  allowedTopics: ['/ibp', '/ibp/services', '/ibp/healthCheck', '/ibp/signedMessage'],
  updateInterval: 5 * 60 * 1000, // 5 mins, as milliseconds
  bootstrapPeers: [
    // metaspan:dns
    '/dns4/ibp-monitor.metaspan.io/tcp/30000/p2p/12D3KooWK88CwRP1eHSoHheuQbXFcQrQMni2cgVDmB8bu9NtaqVu',
    // helikon:dns
    '/dns4/ibp-monitor.helikon.io/tcp/30000/p2p/12D3KooWFZzcMsKumdpNyTKtivcGPukPfQAtCaW5o8qinFzSzHuf',
    // turboflakes:dns
    '/dns4/ibp-monitor.turboflakes.io/tcp/30000/p2p/12D3KooWQv2KCogXS3qmJL1ND1gPMzmRwiGAtEAEsMSMmW4G9L4c',
  ],
  gossipResults: true,
  relay: null,
  pruning: {
    age: 90 * 24 * 60 * 60, // 90 days as seconds
    interval: 1 * 60 * 60, // 1 hour as seconds
  },
  performance: {
    sla: 500, // ms - used for performance graph, and later for alerts
  },
  alertsEngine: {
    enabled: false,
    queueName: 'alerts',
    webhook: 'http://ibp-abot:5001/api/v1/alerts',
    apiKey: 'alerts-bot-api-key',
    thresholds: {
      blockDrift: 20 // 20 blocks out of sync
    }
  }
}

export { config }
